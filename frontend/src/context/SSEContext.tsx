import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getSSEUrl, getAccessToken } from '../lib/api';
import { queryClient } from '../lib/queryClient';

export interface SSEEvent {
  type: string;
  payload: unknown;
}

interface SSEContextValue {
  connected: boolean;
  notificationCount: number;
  clearNotifications: () => void;
}

const SSEContext = createContext<SSEContextValue>({
  connected: false,
  notificationCount: 0,
  clearNotifications: () => {},
});

export function SSEProvider({ children, enabled }: { children: React.ReactNode; enabled: boolean }) {
  const [connected, setConnected] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !getAccessToken()) return;

    const es = new EventSource(getSSEUrl());
    esRef.current = es;

    es.addEventListener('connected', () => setConnected(true));

    // Task events → invalidate task/list queries
    const taskEvents = ['task.created', 'task.updated', 'task.deleted', 'task.moved'];
    taskEvents.forEach((evt) => {
      es.addEventListener(evt, () => {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['lists'] });
      });
    });

    // Assignment events → badge + invalidate
    es.addEventListener('assignment.created', () => {
      setNotificationCount((n) => n + 1);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
    es.addEventListener('assignment.updated', () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
    es.addEventListener('assignment.withdrawn', () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });

    // Doc events → invalidate docs queries
    es.addEventListener('doc.updated', () => {
      queryClient.invalidateQueries({ queryKey: ['docs'] });
    });
    es.addEventListener('doc.auto_updated', () => {
      setNotificationCount((n) => n + 1);
      queryClient.invalidateQueries({ queryKey: ['docs'] });
    });

    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      setConnected(false);
    };
  }, [enabled]);

  const clearNotifications = () => setNotificationCount(0);

  return (
    <SSEContext.Provider value={{ connected, notificationCount, clearNotifications }}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSE(): SSEContextValue {
  return useContext(SSEContext);
}
