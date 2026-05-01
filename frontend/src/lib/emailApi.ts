import { getAccessToken } from './api';

export const EMAIL_BASE = import.meta.env.VITE_EMAIL_API_URL ?? 'http://localhost:8000';

export function getEmailSSEUrl(): string {
  return `${EMAIL_BASE}/api/events?token=${getAccessToken() ?? ''}`;
}

function authHeaders(): HeadersInit {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${EMAIL_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${EMAIL_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${EMAIL_BASE}${path}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${EMAIL_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EmailSummary {
  id: number;
  account_id: number;
  account_email: string;
  provider: string;
  message_id: string;
  thread_id: string | null;
  subject: string;
  sender: string;
  recipients: string[];
  date: string | null;
  is_read: boolean;
  is_starred: boolean;
  labels: string[];
  snippet: string;
}

export interface EmailDetail extends EmailSummary {
  body_text: string;
}

export interface Account {
  id: number;
  email: string;
  provider: string;
  display_name: string;
  last_synced_at: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  attendees: string[];
  calendar_id: string;
}

export interface CreateEventInput {
  title: string;
  description: string;
  location: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  attendees: string[];
  calendar_id: string;
  reminder_minutes?: number | null;
}

export interface AuthStatus {
  google: boolean;
  microsoft: Record<string, boolean>;
}

export interface LabelUpdateResult { id: number; labels: string[] }
export interface SendResult { ok: boolean; sent_id: string | null }

// ── Emails ─────────────────────────────────────────────────────────────────────

export const listEmails = (params?: { account_id?: number; search?: string; unread_only?: boolean; limit?: number; offset?: number }) => {
  const q = new URLSearchParams();
  if (params?.account_id) q.set('account_id', String(params.account_id));
  if (params?.search) q.set('search', params.search);
  if (params?.unread_only) q.set('unread_only', 'true');
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  return get<EmailSummary[]>(`/api/emails?${q}`);
};

export const getEmail = (id: number) => get<EmailDetail>(`/api/emails/${id}`);
export const listAccounts = () => get<Account[]>('/api/emails/accounts/list');

export const updateLabels = (id: number, add: string[], remove: string[]) =>
  patch<LabelUpdateResult>(`/api/emails/${id}/labels`, { add, remove });

export const sendEmail = (account_id: number, to: string, subject: string, body: string) =>
  post<SendResult>('/api/emails/send', { account_id, to, subject, body });

export const replyToEmail = (email_id: number, body: string) =>
  post<SendResult>(`/api/emails/${email_id}/reply`, { body });

// ── Calendar ───────────────────────────────────────────────────────────────────

export const listEvents = (start?: string, end?: string) => {
  const q = new URLSearchParams();
  if (start) q.set('start', start);
  if (end) q.set('end', end);
  return get<CalendarEvent[]>(`/api/calendar?${q}`);
};

export const createEvent = (body: CreateEventInput) => post<CalendarEvent>('/api/calendar', body);
export const deleteEvent = (id: string) => del(`/api/calendar/${id}`);
export const syncCalendar = () => post<{ synced: number }>('/api/calendar/sync', {});

// ── Auth ───────────────────────────────────────────────────────────────────────

export const authStatus = () => get<AuthStatus>('/api/auth/status');
export const getGoogleAuthUrl = () => get<{ url: string }>('/api/auth/google');
export const getMicrosoftAuthUrl = (account?: string) => {
  const q = account ? `?account=${encodeURIComponent(account)}` : '';
  return get<{ url: string }>(`/api/auth/microsoft${q}`);
};

// ── Agent chat (SSE streaming) ─────────────────────────────────────────────────

export async function* streamChat(messages: { role: string; content: string }[]): AsyncGenerator<string> {
  const res = await fetch(`${EMAIL_BASE}/api/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        if (parsed.delta) yield parsed.delta;
      } catch {}
    }
  }
}
