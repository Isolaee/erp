import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api, { setAccessToken } from '../lib/api';
import type { User } from '../types/api';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null, isLoading: true });

  const refresh = useCallback(async () => {
    try {
      const res = await api.post<{ accessToken: string }>('/auth/refresh');
      const token = res.data.accessToken;
      setAccessToken(token);
      const meRes = await api.get<User>('/auth/me');
      setState({ user: meRes.data, accessToken: token, isLoading: false });
    } catch {
      setAccessToken(null);
      setState({ user: null, accessToken: null, isLoading: false });
    }
  }, []);

  // Try to restore session on mount
  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ accessToken: string; user: User }>('/auth/login', { email, password });
    setAccessToken(res.data.accessToken);
    setState({ user: res.data.user, accessToken: res.data.accessToken, isLoading: false });
  }, []);

  // Used after GitHub OAuth callback — token arrives in the URL
  const loginWithToken = useCallback(async (token: string) => {
    setAccessToken(token);
    const meRes = await api.get<User>('/auth/me');
    setState({ user: meRes.data, accessToken: token, isLoading: false });
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setAccessToken(null);
    setState({ user: null, accessToken: null, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, loginWithToken, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
