import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { registerConnection, removeConnection } from '../services/sseService';
import { AccessTokenPayload } from '../middleware/auth';

const router = Router();

// GET /api/events?token=<accessToken>
// Using query param token because EventSource API doesn't support custom headers
router.get('/', (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET) as AccessTokenPayload;
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  registerConnection(payload.sub, res);

  // Send a heartbeat every 30s to keep the connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 30_000);

  // Initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ userId: payload.sub })}\n\n`);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeConnection(payload.sub);
  });
});

export default router;
