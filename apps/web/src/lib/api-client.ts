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

const API_BASE_URL = resolveApiBaseUrl();

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

        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
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
