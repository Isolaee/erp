import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import {
  signAccessToken, createRefreshToken, rotateRefreshToken,
  revokeRefreshToken, hashPassword, verifyPassword,
} from '../services/authService';
import { createError } from '../middleware/errorHandler';
import { config } from '../config';

const router = Router();

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email, deletedAt: null } });
  if (!user || !user.passwordHash) {
    throw createError(401, 'Invalid credentials');
  }
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    throw createError(401, 'Invalid credentials');
  }
  const accessToken = signAccessToken(user.id, user.email, user.role);
  const refreshToken = await createRefreshToken(user.id);
  res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, sameSite: 'lax', maxAge: REFRESH_MAX_AGE });
  res.json({ accessToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!raw) throw createError(401, 'No refresh token');
  const tokens = await rotateRefreshToken(raw);
  if (!tokens) throw createError(401, 'Invalid or expired refresh token');
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { httpOnly: true, sameSite: 'lax', maxAge: REFRESH_MAX_AGE });
  res.json({ accessToken: tokens.accessToken });
});

// POST /api/auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (raw) await revokeRefreshToken(raw);
  res.clearCookie(REFRESH_COOKIE);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', verifyAccessToken, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id, deletedAt: null },
    select: { id: true, email: true, name: true, role: true, avatarUrl: true, createdAt: true, githubId: true, githubToken: true },
  });
  if (!user) throw createError(404, 'User not found');
  res.json({ ...user, hasGithubToken: !!user.githubToken, githubToken: undefined });
});

// POST /api/auth/register — invite token based
router.post('/register', async (req: Request, res: Response) => {
  const body = z.object({
    token: z.string().uuid(),
    name: z.string().min(1),
    password: z.string().min(8),
  }).parse(req.body);

  const invite = await prisma.invite.findUnique({
    where: { token: body.token },
    include: { team: true },
  });

  if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
    throw createError(400, 'Invalid or expired invite');
  }

  const passwordHash = await hashPassword(body.password);

  const user = await prisma.user.create({
    data: {
      email: invite.email ?? `user-${Date.now()}@erp.local`,
      name: body.name,
      passwordHash,
      role: invite.role,
    },
  });

  if (invite.teamId) {
    await prisma.teamMember.create({
      data: { userId: user.id, teamId: invite.teamId, role: invite.role },
    });
  }

  await prisma.invite.update({
    where: { id: invite.id },
    data: { status: 'ACCEPTED', recipientId: user.id, acceptedAt: new Date() },
  });

  const accessToken = signAccessToken(user.id, user.email, user.role);
  const refreshToken = await createRefreshToken(user.id);
  res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, sameSite: 'lax', maxAge: REFRESH_MAX_AGE });
  res.status(201).json({ accessToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// ─── GitHub OAuth ────────────────────────────────────────────────────────────

// GET /api/auth/github — redirect to GitHub authorization
router.get('/github', (req: Request, res: Response) => {
  if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CALLBACK_URL) {
    return res.redirect(`${config.FRONTEND_URL}/login?error=github_not_configured`);
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID,
    redirect_uri: config.GITHUB_CALLBACK_URL,
    scope: 'read:user user:email repo',
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GET /api/auth/github/callback — GitHub redirects here after authorization
router.get('/github/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as { code?: string; state?: string };
  const savedState = req.cookies?.oauth_state as string | undefined;
  res.clearCookie('oauth_state');

  if (!state || state !== savedState) {
    return res.redirect(`${config.FRONTEND_URL}/login?error=invalid_state`);
  }
  if (!code) {
    return res.redirect(`${config.FRONTEND_URL}/login?error=no_code`);
  }

  // Exchange code for GitHub access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: config.GITHUB_CALLBACK_URL,
    }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    return res.redirect(`${config.FRONTEND_URL}/login?error=oauth_failed`);
  }
  const githubToken = tokenData.access_token;

  // Fetch GitHub user profile
  const profileRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github.v3+json' },
  });
  const githubUser = await profileRes.json() as {
    id: number; login: string; name?: string; email?: string; avatar_url?: string;
  };

  // Get primary verified email (may not be in public profile)
  let email = githubUser.email ?? null;
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github.v3+json' },
    });
    const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
    email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
  }
  if (!email) {
    return res.redirect(`${config.FRONTEND_URL}/login?error=no_email`);
  }

  // Find existing user by GitHub ID first, then fall back to email match
  let user = await prisma.user.findFirst({ where: { githubId: String(githubUser.id), deletedAt: null } });
  if (!user) {
    user = await prisma.user.findUnique({ where: { email, deletedAt: null } });
  }

  // No existing account — require an invite
  if (!user) {
    return res.redirect(`${config.FRONTEND_URL}/login?error=no_account`);
  }

  // Link / update GitHub info on the account
  user = await prisma.user.update({
    where: { id: user.id },
    data: {
      githubId: String(githubUser.id),
      githubToken,
      avatarUrl: user.avatarUrl ?? githubUser.avatar_url ?? null,
    },
  });

  const accessToken = signAccessToken(user.id, user.email, user.role);
  const refreshToken = await createRefreshToken(user.id);
  res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, sameSite: 'lax', maxAge: REFRESH_MAX_AGE });
  res.redirect(`${config.FRONTEND_URL}/auth/callback?accessToken=${encodeURIComponent(accessToken)}`);
});

export default router;
