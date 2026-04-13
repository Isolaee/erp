import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

export const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  withCredentials: true, // send refresh cookie
});

// Store access token in module scope (not localStorage — avoids XSS)
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getSSEUrl(): string {
  return `${BASE_URL}/api/events?token=${accessToken ?? ''}`;
}

// Attach access token to every request
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Auto-refresh on 401
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const isAuthRoute = original.url?.startsWith('/auth/');
    if (error.response?.status !== 401 || original._retry || isAuthRoute) {
      return Promise.reject(error);
    }
    original._retry = true;

    if (!refreshing) {
      refreshing = api.post<{ accessToken: string }>('/auth/refresh')
        .then((res) => {
          accessToken = res.data.accessToken;
          return accessToken;
        })
        .finally(() => { refreshing = null; });
    }

    try {
      const newToken = await refreshing;
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch {
      // Refresh failed → clear token, let caller handle redirect
      accessToken = null;
      return Promise.reject(error);
    }
  },
);

export default api;
