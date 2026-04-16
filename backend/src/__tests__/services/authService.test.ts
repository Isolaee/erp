import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

// Mock prisma before importing authService
jest.mock('../../lib/prisma', () => ({
  prisma: {
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

// Mock redis helpers — no Redis in test environment
jest.mock('../../lib/redis', () => ({
  redisSetex: jest.fn().mockResolvedValue(undefined),
  redisExists: jest.fn().mockResolvedValue(false),
}));

import { prisma } from '../../lib/prisma';
import {
  signAccessToken,
  hashPassword,
  verifyPassword,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  blacklistAccessToken,
  isAccessTokenBlacklisted,
} from '../../services/authService';
import { config } from '../../config';
import { redisSetex, redisExists } from '../../lib/redis';

const mockRT = prisma.refreshToken as any;

describe('signAccessToken', () => {
  it('returns a JWT with correct claims', () => {
    const token = signAccessToken('user-1', 'alice@test.com', UserRole.MEMBER);
    const payload = jwt.verify(token, config.JWT_SECRET) as any;
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('alice@test.com');
    expect(payload.role).toBe('MEMBER');
  });

  it('token expires in ~15 minutes', () => {
    const token = signAccessToken('u', 'u@t.com', UserRole.ADMIN);
    const payload = jwt.decode(token) as any;
    const diff = payload.exp - payload.iat;
    expect(diff).toBe(900); // 15 * 60
  });
});

describe('hashPassword / verifyPassword', () => {
  it('round-trips correctly', async () => {
    const hash = await hashPassword('supersecret');
    expect(hash).not.toBe('supersecret');
    await expect(verifyPassword('supersecret', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrongpassword', hash)).resolves.toBe(false);
  });
});

describe('createRefreshToken', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a DB record and returns a raw 80-char hex token', async () => {
    mockRT.create.mockResolvedValue({ id: 'rt-1' });

    const raw = await createRefreshToken('user-1');

    expect(raw).toHaveLength(80);
    expect(mockRT.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1' }),
      }),
    );
  });
});

describe('rotateRefreshToken', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns new tokens when the refresh token is valid', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mockRT.findUnique.mockResolvedValue({
      id: 'rt-1',
      revokedAt: null,
      expiresAt: futureDate,
      user: { id: 'user-1', email: 'alice@test.com', role: UserRole.MEMBER },
    });
    mockRT.update.mockResolvedValue({});
    mockRT.create.mockResolvedValue({ id: 'rt-2' });

    const result = await rotateRefreshToken('some-valid-raw-token');

    expect(result).not.toBeNull();
    expect(result!.accessToken).toBeTruthy();
    expect(result!.refreshToken).toHaveLength(80);
    // Old token must be revoked
    expect(mockRT.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
    );
  });

  it('returns null when token is not found', async () => {
    mockRT.findUnique.mockResolvedValue(null);
    const result = await rotateRefreshToken('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when token is revoked', async () => {
    mockRT.findUnique.mockResolvedValue({
      id: 'rt-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
      user: { id: 'u1', email: 'e@t.com', role: UserRole.MEMBER },
    });
    const result = await rotateRefreshToken('revoked-token');
    expect(result).toBeNull();
  });

  it('returns null when token is expired', async () => {
    mockRT.findUnique.mockResolvedValue({
      id: 'rt-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      user: { id: 'u1', email: 'e@t.com', role: UserRole.MEMBER },
    });
    const result = await rotateRefreshToken('expired-token');
    expect(result).toBeNull();
  });
});

describe('revokeRefreshToken', () => {
  it('calls updateMany to revoke the token by hash', async () => {
    mockRT.updateMany.mockResolvedValue({ count: 1 });
    await revokeRefreshToken('some-raw-token');
    expect(mockRT.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
    );
  });
});

describe('blacklistAccessToken / isAccessTokenBlacklisted', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores token in redis with correct TTL', async () => {
    await blacklistAccessToken('my-token', 900);
    expect(redisSetex).toHaveBeenCalledWith('blacklist:my-token', 900, '1');
  });

  it('returns false when token is not blacklisted', async () => {
    (redisExists as jest.Mock).mockResolvedValue(false);
    const result = await isAccessTokenBlacklisted('clean-token');
    expect(result).toBe(false);
  });
});
