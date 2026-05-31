/**
 * Platform-admin API client — distinct from the per-tenant `apiClient`
 * because:
 *   - Platform tokens live under their OWN localStorage keys so a
 *     tenant logout can't accidentally clear them (and vice versa).
 *   - We never send `X-Tenant-Slug` here — platform routes are
 *     tenant-agnostic (bypassed by the API's tenantResolver).
 *   - Refresh hits `/api/v1/platform/auth/refresh`.
 *
 * Keys:
 *   localStorage.platformAccessToken
 *   localStorage.platformRefreshToken
 */
import axios from 'axios';

function normalizeApiUrl(url: string) {
  const trimmedUrl = url.replace(/\/$/, '');
  return trimmedUrl.endsWith('/api/v1') ? trimmedUrl : `${trimmedUrl}/api/v1`;
}

function resolveApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_URL;
  if (configuredUrl) return normalizeApiUrl(configuredUrl);
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const apiHost =
    host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1'
      ? 'localhost'
      : host;
  return `http://${apiHost}:3001/api/v1`;
}

const API_BASE_URL = resolveApiBaseUrl();

export const PLATFORM_ACCESS_TOKEN_KEY = 'platformAccessToken';
export const PLATFORM_REFRESH_TOKEN_KEY = 'platformRefreshToken';

export const platformApiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

platformApiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(PLATFORM_ACCESS_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — silent refresh on 401, identical pattern to the
// tenant api-client.
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  failedQueue = [];
}

platformApiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/platform/auth/refresh') &&
      !originalRequest.url?.includes('/platform/auth/login')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return platformApiClient(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = localStorage.getItem(PLATFORM_REFRESH_TOKEN_KEY);
        if (!refreshToken) throw new Error('No platform refresh token');

        const { data } = await axios.post(`${API_BASE_URL}/platform/auth/refresh`, {
          refreshToken,
        });
        const newAccessToken = data.data.accessToken;
        const newRefreshToken = data.data.refreshToken;

        localStorage.setItem(PLATFORM_ACCESS_TOKEN_KEY, newAccessToken);
        localStorage.setItem(PLATFORM_REFRESH_TOKEN_KEY, newRefreshToken);

        processQueue(null, newAccessToken);
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return platformApiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem(PLATFORM_ACCESS_TOKEN_KEY);
        localStorage.removeItem(PLATFORM_REFRESH_TOKEN_KEY);
        // Redirect to the platform login screen — handled by the
        // PlatformProtectedRoute on the next render.
        if (typeof window !== 'undefined' && !window.location.pathname.endsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  },
);
