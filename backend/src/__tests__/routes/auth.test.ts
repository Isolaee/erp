import 'express-async-errors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    invite: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../../lib/redis', () => ({
  redisSetex: jest.fn().mockResolvedValue(undefined),
  redisExists: jest.fn().mockResolvedValue(false),
  redis: null,
}));

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { createApp } from '../helpers/createApp';
import authRouter from '../../routes/auth';

const app = createApp('/api/auth', authRouter);

const mockUser = prisma.user as any;
const mockInvite = prisma.invite as any;
const mockRT = prisma.refreshToken as any;

function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'alice@test.com',
    name: 'Alice',
    role: UserRole.MEMBER,
    passwordHash: null,
    githubId: null,
    githubToken: null,
    avatarUrl: null,
    deletedAt: null,
    ...overrides,
  };
}

function futureDate() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

describe('POST /api/auth/login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns accessToken and sets refresh cookie on valid credentials', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('password123', 12);
    mockUser.findUnique.mockResolvedValue(makeUser({ passwordHash: hash }));
    mockRT.create.mockResolvedValue({ id: 'rt-1' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@test.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe('alice@test.com');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('returns 401 for unknown email', async () => {
    mockUser.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('returns 401 for wrong password', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correctpassword', 12);
    mockUser.findUnique.mockResolvedValue(makeUser({ passwordHash: hash }));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@test.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/refresh', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rotates refresh token and returns new accessToken', async () => {
    mockRT.findUnique.mockResolvedValue({
      id: 'rt-1',
      revokedAt: null,
      expiresAt: futureDate(),
      user: { id: 'user-1', email: 'alice@test.com', role: UserRole.MEMBER },
    });
    mockRT.update.mockResolvedValue({});
    mockRT.create.mockResolvedValue({ id: 'rt-2' });

    // We need a real refresh token string — use a 80-char hex string
    const raw = 'a'.repeat(80);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${raw}`);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('returns 401 when no refresh cookie is present', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('returns 401 when refresh token is not found in DB', async () => {
    mockRT.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=invalid-token');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('clears refresh cookie and revokes token', async () => {
    mockRT.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'refresh_token=some-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockRT.updateMany).toHaveBeenCalled();
  });

  it('succeeds even without a refresh cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the current user profile for a valid token', async () => {
    mockUser.findUnique.mockResolvedValue(makeUser());
    const token = jwt.sign(
      { sub: 'user-1', email: 'alice@test.com', role: 'MEMBER' },
      config.JWT_SECRET,
      { expiresIn: '15m' },
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('alice@test.com');
    expect(res.body.githubToken).toBeUndefined();
    expect(res.body.hasGithubToken).toBe(false);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 404 when user no longer exists', async () => {
    mockUser.findUnique.mockResolvedValue(null);
    const token = jwt.sign(
      { sub: 'deleted', email: 'gone@test.com', role: 'MEMBER' },
      config.JWT_SECRET,
      { expiresIn: '15m' },
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/auth/register', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates user and returns tokens when invite is valid', async () => {
    const token = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockInvite.findUnique.mockResolvedValue({
      id: 'invite-1',
      token,
      email: 'bob@test.com',
      status: 'PENDING',
      expiresAt: futureDate(),
      role: UserRole.MEMBER,
      teamId: null,
      team: null,
    });
    mockUser.create.mockResolvedValue(makeUser({ id: 'user-2', email: 'bob@test.com', name: 'Bob' }));
    mockInvite.update.mockResolvedValue({});
    mockRT.create.mockResolvedValue({ id: 'rt-new' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ token, name: 'Bob', password: 'securepassword123' });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.name).toBe('Bob');
  });

  it('returns 400 for an expired invite', async () => {
    const token = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockInvite.findUnique.mockResolvedValue({
      id: 'invite-1',
      token,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1000), // expired
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ token, name: 'Bob', password: 'securepassword123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-UUID token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ token: 'not-a-uuid', name: 'Bob', password: 'securepassword123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for password shorter than 8 chars', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ token: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Bob', password: 'short' });

    expect(res.status).toBe(400);
  });
});
