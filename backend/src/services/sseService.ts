import { Response } from 'express';

// In-memory SSE registry: userId → SSE response object
const connections = new Map<string, Response>();

export function registerConnection(userId: string, res: Response): void {
  // Close any existing connection for this user
  const existing = connections.get(userId);
  if (existing) {
    try { existing.end(); } catch { /* ignore */ }
  }
  connections.set(userId, res);
}

export function removeConnection(userId: string): void {
  connections.delete(userId);
}

export function emit(userId: string, type: string, payload: unknown): void {
  const res = connections.get(userId);
  if (!res) return;
  try {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch {
    connections.delete(userId);
  }
}

export function broadcast(userIds: string[], type: string, payload: unknown): void {
  for (const userId of userIds) {
    emit(userId, type, payload);
  }
}

// Broadcast to all connected users (e.g. for org-wide events)
export function broadcastAll(type: string, payload: unknown): void {
  for (const [userId] of connections) {
    emit(userId, type, payload);
  }
}
