import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { redisSetex, redisExists } from '../lib/redis';
import { UserRole } from '@prisma/client';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 7;
const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

export function signAccessToken(userId: string, email: string, role: UserRole): string {
  return jwt.sign({ sub: userId, email, role }, config.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export async function createRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(40).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  await prisma.refreshToken.create({ data: { userId, tokenHash: hash, expiresAt } });
  return raw;
}

export async function rotateRefreshToken(rawToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) return null;

  // Revoke old token
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  const accessToken = signAccessToken(stored.user.id, stored.user.email, stored.user.role);
  const refreshToken = await createRefreshToken(stored.user.id);
  return { accessToken, refreshToken };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await prisma.refreshToken.updateMany({ where: { tokenHash: hash }, data: { revokedAt: new Date() } });
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Blacklist access token in Redis until it expires (for logout before TTL)
export async function blacklistAccessToken(token: string, ttlSeconds: number): Promise<void> {
  await redisSetex(`blacklist:${token}`, ttlSeconds, '1');
}

export async function isAccessTokenBlacklisted(token: string): Promise<boolean> {
  return redisExists(`blacklist:${token}`);
}
