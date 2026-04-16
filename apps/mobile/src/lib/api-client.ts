import axios from 'axios';
import Constants from 'expo-constants';
import { getToken, getShopId, setToken, setRefreshToken, getRefreshToken, clearAll } from './storage';

const API_BASE_URL =
  Constants.expoConfig?.extra?.apiBaseUrl ??
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  'http://localhost:3000';

const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach token and shop ID
apiClient.interceptors.request.use(
  async (config) => {
    const [token, shopId] = await Promise.all([getToken(), getShopId()]);

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (shopId) {
      config.headers['X-Shop-Id'] = shopId;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor: handle 401 with token refresh
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Only attempt refresh on 401, and not on the refresh endpoint itself
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
        const refreshToken = await getRefreshToken();
        if (!refreshToken) {
          await clearAll();
          processQueue(new Error('No refresh token'), null);
          return Promise.reject(error);
        }

        const response = await axios.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
          refreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken } = response.data.data;
        await setToken(accessToken);
        await setRefreshToken(newRefreshToken);

        processQueue(null, accessToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        await clearAll();
        processQueue(refreshError, null);
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
