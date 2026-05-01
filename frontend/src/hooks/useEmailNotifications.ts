import { useEffect, useRef } from 'react';
import { getEmailSSEUrl } from '../lib/emailApi';
import { getAccessToken } from '../lib/api';

interface NewEmailEvent {
  type: 'new_email';
  subject: string;
  sender: string;
}

export function useEmailNotifications(onNewEmail?: () => void) {
  const cbRef = useRef(onNewEmail);
  cbRef.current = onNewEmail;

  useEffect(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission();

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function connect() {
      if (stopped || !getAccessToken()) return;

      es = new EventSource(getEmailSSEUrl());

      es.onmessage = (e) => {
        try {
          const data: NewEmailEvent = JSON.parse(e.data);
          if (data.type !== 'new_email') return;
          if (Notification.permission === 'granted') {
            new Notification(data.subject || '(no subject)', {
              body: data.sender,
              icon: '/favicon.ico',
              tag: 'email-new',
            });
          }
          cbRef.current?.();
        } catch {}
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!stopped) {
          // Wait 30s then reconnect with whatever token is current (may have refreshed by then)
          retryTimer = setTimeout(connect, 30_000);
        }
      };
    }

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, []);
}
