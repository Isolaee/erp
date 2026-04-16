import 'express-async-errors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    invite: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../../lib/redis', () => ({
  redis: null,
  redisSetex: jest.fn(),
  redisExists: jest.fn().mockResolvedValue(false),
}));

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { createApp } from '../helpers/createApp';
import invitesRouter from '../../routes/invites';

const app = createApp('/api/invites', invitesRouter);
const mockInvite = prisma.invite as any;

function bearerToken(id = 'user-1', role: UserRole = UserRole.TEAM_LEAD) {
  return `Bearer ${jwt.sign({ sub: id, email: `${id}@t.com`, role }, config.JWT_SECRET, { expiresIn: '15m' })}`;
}

function futureDate() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function makeInvite(overrides = {}) {
  return {
    id: 'invite-1',
    token: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    email: 'newuser@test.com',
    status: 'PENDING',
    role: UserRole.MEMBER,
    teamId: 'team-1',
    senderId: 'user-1',
    expiresAt: futureDate(),
    createdAt: new Date().toISOString(),
    sender: { name: 'Alice' },
    team: { name: 'Engineering' },
    ...overrides,
  };
}

describe('GET /api/invites/:token/preview (public)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns invite preview for a valid pending invite', async () => {
    mockInvite.findUnique.mockResolvedValue(makeInvite());

    const res = await request(app)
      .get('/api/invites/a1b2c3d4-e5f6-7890-abcd-ef1234567890/preview');

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('newuser@test.com');
    expect(res.body.teamName).toBe('Engineering');
    expect(res.body.senderName).toBe('Alice');
  });

  it('returns 404 for an expired invite', async () => {
    mockInvite.findUnique.mockResolvedValue(makeInvite({
      expiresAt: new Date(Date.now() - 1000),
    }));

    const res = await request(app)
      .get('/api/invites/some-token/preview');

    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-PENDING invite', async () => {
    mockInvite.findUnique.mockResolvedValue(makeInvite({ status: 'ACCEPTED' }));

    const res = await request(app)
      .get('/api/invites/some-token/preview');

    expect(res.status).toBe(404);
  });

  it('returns 404 when invite does not exist', async () => {
    mockInvite.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/invites/nonexistent/preview');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/invites/:token/accept (public)', () => {
  it('redirects to /api/auth/register', async () => {
    const res = await request(app)
      .post('/api/invites/some-token/accept')
      .send({ name: 'Bob', password: 'password123' });

    expect(res.status).toBe(307);
    expect(res.headers.location).toBe('/api/auth/register');
  });
});

describe('POST /api/invites', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates an invite and returns invite URL for TEAM_LEAD', async () => {
    const invite = makeInvite();
    mockInvite.create.mockResolvedValue(invite);

    const res = await request(app)
      .post('/api/invites')
      .set('Authorization', bearerToken('user-1', UserRole.TEAM_LEAD))
      .send({ email: 'newuser@test.com', teamId: 'a0b1c2d3-e4f5-6789-abcd-ef0123456789' });

    expect(res.status).toBe(201);
    expect(res.body.inviteUrl).toContain('/register/');
    expect(mockInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ senderId: 'user-1' }),
      }),
    );
  });

  it('returns 403 for a MEMBER', async () => {
    const res = await request(app)
      .post('/api/invites')
      .set('Authorization', bearerToken('user-1', UserRole.MEMBER))
      .send({ email: 'newuser@test.com' });

    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid email', async () => {
    const res = await request(app)
      .post('/api/invites')
      .set('Authorization', bearerToken())
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/invites')
      .send({ email: 'newuser@test.com' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/invites', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns invites visible to the TEAM_LEAD', async () => {
    mockInvite.findMany.mockResolvedValue([makeInvite()]);

    const res = await request(app)
      .get('/api/invites')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe('invite-1');
  });

  it('ADMIN sees all invites (empty where clause)', async () => {
    mockInvite.findMany.mockResolvedValue([makeInvite()]);

    const res = await request(app)
      .get('/api/invites')
      .set('Authorization', bearerToken('admin-1', UserRole.ADMIN));

    expect(res.status).toBe(200);
    // Admin uses empty where clause — findMany called without team filter
    expect(mockInvite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('returns 403 for a MEMBER', async () => {
    const res = await request(app)
      .get('/api/invites')
      .set('Authorization', bearerToken('user-1', UserRole.MEMBER));

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/invites/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('revokes an invite for a TEAM_LEAD', async () => {
    mockInvite.update.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/invites/invite-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(204);
    expect(mockInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'REVOKED' } }),
    );
  });

  it('returns 403 for a MEMBER', async () => {
    const res = await request(app)
      .delete('/api/invites/invite-1')
      .set('Authorization', bearerToken('user-1', UserRole.MEMBER));

    expect(res.status).toBe(403);
  });
});
