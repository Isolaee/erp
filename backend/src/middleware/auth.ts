import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
}

export function verifyAccessToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as AccessTokenPayload;
    req.user = { id: payload.sub, email: payload.email, role: payload.role as any };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
