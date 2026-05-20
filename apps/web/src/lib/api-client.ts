import axios from 'axios';

function normalizeApiUrl(url: string) {
  const trimmedUrl = url.replace(/\/$/, '');
  return trimmedUrl.endsWith('/api/v1') ? trimmedUrl : `${trimmedUrl}/api/v1`;
}

function resolveApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_URL;
  if (configuredUrl) return normalizeApiUrl(configuredUrl);

  const host = window.location.hostname;
  const apiHost = host === 'localhost' || host === '127.0.0.1' ? 'localhost' : host;
  return `http://${apiHost}:3001/api/v1`;
}

/**
 * Resolve the active tenant slug from the current browser hostname.
 *
 * Resolution order (must mirror `apps/api/src/middleware/tenant-resolver.ts`):
 *   1. `VITE_TENANT_SLUG` env override (useful for E2E + LAN dev).
 *   2. `*.localhost` → first label (`vn.localhost:5173` → `vn`).
 *   3. `localhost` / `127.0.0.1` → `VITE_DEFAULT_TENANT_SLUG` (defaults to `vn`).
 *   4. `<slug>.<apex>` for any apex listed in `VITE_TENANT_APEX_DOMAINS`
 *      (comma-separated, defaults to `retailerp.com`).
 *   5. `null` — the api-client falls back to leaving the header off and
 *      lets the API reject with 404; the LoginPage shows a clear error.
 */
export function resolveTenantSlug(): string | null {
  const envSlug = import.meta.env.VITE_TENANT_SLUG;
  if (typeof envSlug === 'string' && envSlug.trim().length > 0) {
    return envSlug.trim().toLowerCase();
  }
  const defaultSlug =
    (import.meta.env.VITE_DEFAULT_TENANT_SLUG as string | undefined)?.trim().toLowerCase() ||
    'vn';
  const apexList = (
    (import.meta.env.VITE_TENANT_APEX_DOMAINS as string | undefined) ?? 'retailerp.com'
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const host = (typeof window !== 'undefined' ? window.location.hostname : '').toLowerCase();
  if (!host) return null;

  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
    return defaultSlug;
  }
  if (host.endsWith('.localhost')) {
    const sub = host.split('.')[0];
    return sub.length > 0 ? sub : defaultSlug;
  }
  for (const apex of apexList) {
    if (host === apex) return null;
    if (host.endsWith(`.${apex}`)) {
      const sub = host.slice(0, -1 - apex.length);
      if (!sub.includes('.')) return sub;
    }
  }
  return null;
}

const API_BASE_URL = resolveApiBaseUrl();
const TENANT_SLUG = resolveTenantSlug();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Recursively trim every string value in an object / array. Used by the
 * request interceptor below so all text inputs (form fields, search boxes,
 * etc.) are sent to the API without leading/trailing whitespace, without
 * having to add `.trim()` to every input on every page.
 */
function trimStringsDeep(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(trimStringsDeep);
  if (value && typeof value === 'object') {
    // Skip Blob / File / FormData / Date so we don't break uploads.
    if (
      value instanceof Blob ||
      (typeof File !== 'undefined' && value instanceof File) ||
      (typeof FormData !== 'undefined' && value instanceof FormData) ||
      value instanceof Date
    ) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = trimStringsDeep(v);
    }
    return out;
  }
  return value;
}

// Request interceptor: attach auth token + shop ID, trim string fields
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Tenant slug derived from hostname at module load. Sent on every
  // request so the API's tenantResolver middleware can identify the
  // tenant without needing the browser to be on the actual subdomain
  // (helpful in LAN-IP and reverse-proxy dev environments).
  if (TENANT_SLUG) {
    config.headers['X-Tenant-Slug'] = TENANT_SLUG;
  }

  const shopId = localStorage.getItem('currentShopId');
  if (shopId) {
    config.headers['X-Shop-Id'] = shopId;
  }

  // Trim string values in JSON bodies and query params.
  if (config.data && !(config.data instanceof FormData)) {
    config.data = trimStringsDeep(config.data);
  }
  if (config.params && typeof config.params === 'object') {
    config.params = trimStringsDeep(config.params) as typeof config.params;
  }

  return config;
});

// Response interceptor: handle 401 (token expired) with refresh
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  failedQueue = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/login')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) throw new Error('No refresh token');

        const { data } = await axios.post(
          `${API_BASE_URL}/auth/refresh`,
          { refreshToken },
          { headers: TENANT_SLUG ? { 'X-Tenant-Slug': TENANT_SLUG } : undefined },
        );
        const newAccessToken = data.data.accessToken;
        const newRefreshToken = data.data.refreshToken;

        localStorage.setItem('accessToken', newAccessToken);
        localStorage.setItem('refreshToken', newRefreshToken);

        processQueue(null, newAccessToken);
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);
