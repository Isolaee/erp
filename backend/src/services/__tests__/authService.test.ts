import jwt from 'jsonwebtoken';
import {
  signAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  hashPassword,
  verifyPassword,
  blacklistAccessToken,
  isAccessTokenBlacklisted,
} from '../authService';
import { UserRole } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
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

jest.mock('../../lib/redis', () => ({
  redisSetex: jest.fn(),
  redisExists: jest.fn(),
}));

import { prisma } from '../../lib/prisma';
import { redisSetex, redisExists } from '../../lib/redis';

const mockRefreshTokenCreate = prisma.refreshToken.create as jest.Mock;
const mockRefreshTokenFindUnique = prisma.refreshToken.findUnique as jest.Mock;
const mockRefreshTokenUpdate = prisma.refreshToken.update as jest.Mock;
const mockRefreshTokenUpdateMany = prisma.refreshToken.updateMany as jest.Mock;
const mockRedisSetex = redisSetex as jest.Mock;
const mockRedisExists = redisExists as jest.Mock;

const TEST_JWT_SECRET = process.env.JWT_SECRET!;

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
// signAccessToken
// ===========================================================================
describe('signAccessToken', () => {
  it('returns a valid JWT with correct claims', () => {
    const token = signAccessToken('user-1', 'user@test.com', UserRole.MEMBER);
    const decoded = jwt.verify(token, TEST_JWT_SECRET) as Record<string, unknown>;

    expect(decoded.sub).toBe('user-1');
    expect(decoded.email).toBe('user@test.com');
    expect(decoded.role).toBe(UserRole.MEMBER);
  });

  it('token expires (iat + exp difference is ~15 minutes)', () => {
    const token = signAccessToken('user-1', 'user@test.com', UserRole.ADMIN);
    const decoded = jwt.decode(token) as Record<string, number>;

    // exp - iat should be 15 minutes = 900 seconds
    expect(decoded.exp - decoded.iat).toBe(900);
  });

  it('encodes ADMIN role correctly', () => {
    const token = signAccessToken('admin-1', 'admin@test.com', UserRole.ADMIN);
    const decoded = jwt.verify(token, TEST_JWT_SECRET) as Record<string, unknown>;
    expect(decoded.role).toBe(UserRole.ADMIN);
  });

  it('encodes TEAM_LEAD role correctly', () => {
    const token = signAccessToken('lead-1', 'lead@test.com', UserRole.TEAM_LEAD);
    const decoded = jwt.verify(token, TEST_JWT_SECRET) as Record<string, unknown>;
    expect(decoded.role).toBe(UserRole.TEAM_LEAD);
  });
});

// ===========================================================================
// hashPassword / verifyPassword
// ===========================================================================
describe('hashPassword + verifyPassword', () => {
  it('produces a bcrypt hash from a plain password', async () => {
    const hash = await hashPassword('my-secret-password');
    expect(hash).toMatch(/^\$2[ab]\$12\$/);
  });

  it('verifyPassword returns true for the correct password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('correct-password', hash)).toBe(true);
  });

  it('verifyPassword returns false for the wrong password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('two hashes of the same password are different (salt randomness)', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
    // Both should still verify correctly
    expect(await verifyPassword('same-password', hash1)).toBe(true);
    expect(await verifyPassword('same-password', hash2)).toBe(true);
  });
});

// ===========================================================================
// createRefreshToken
// ===========================================================================
describe('createRefreshToken', () => {
  it('creates a DB record and returns a raw hex token', async () => {
    mockRefreshTokenCreate.mockResolvedValue({});

    const raw = await createRefreshToken('user-1');

    // 40 random bytes → 80 hex characters
    expect(raw).toHaveLength(80);
    expect(raw).toMatch(/^[0-9a-f]+$/);

    expect(mockRefreshTokenCreate).toHaveBeenCalledTimes(1);
    const callArg = mockRefreshTokenCreate.mock.calls[0][0];
    expect(callArg.data.userId).toBe('user-1');
    // The stored hash should NOT equal the raw token
    expect(callArg.data.tokenHash).not.toBe(raw);
    expect(callArg.data.expiresAt).toBeInstanceOf(Date);
  });

  it('stores a SHA-256 hash (64 hex chars) in the DB', async () => {
    mockRefreshTokenCreate.mockResolvedValue({});
    await createRefreshToken('user-1');
    const storedHash = mockRefreshTokenCreate.mock.calls[0][0].data.tokenHash;
    expect(storedHash).toHaveLength(64);
  });

  it('sets expiry ~7 days in the future', async () => {
    mockRefreshTokenCreate.mockResolvedValue({});
    const before = Date.now();
    await createRefreshToken('user-1');
    const after = Date.now();
    const expiresAt: Date = mockRefreshTokenCreate.mock.calls[0][0].data.expiresAt;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

// ===========================================================================
// rotateRefreshToken
// ===========================================================================
describe('rotateRefreshToken', () => {
  const storedUser = { id: 'user-1', email: 'user@test.com', role: UserRole.MEMBER };

  it('returns null when token is not found', async () => {
    mockRefreshTokenFindUnique.mockResolvedValue(null);
    expect(await rotateRefreshToken('nonexistent-token')).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    mockRefreshTokenFindUnique.mockResolvedValue({
      id: 'rt-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 10_000),
      user: storedUser,
    });
    expect(await rotateRefreshToken('some-raw-token')).toBeNull();
  });

  it('returns null for an expired token', async () => {
    mockRefreshTokenFindUnique.mockResolvedValue({
      id: 'rt-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000), // already expired
      user: storedUser,
    });
    expect(await rotateRefreshToken('some-raw-token')).toBeNull();
  });

  it('revokes old token and issues new access + refresh tokens', async () => {
    mockRefreshTokenFindUnique.mockResolvedValue({
      id: 'rt-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
      user: storedUser,
    });
    mockRefreshTokenUpdate.mockResolvedValue({});
    mockRefreshTokenCreate.mockResolvedValue({});

    const result = await rotateRefreshToken('valid-raw-token');

    expect(result).not.toBeNull();
    expect(typeof result!.accessToken).toBe('string');
    expect(typeof result!.refreshToken).toBe('string');

    // Old token should be revoked
    expect(mockRefreshTokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rt-1' } }),
    );
    // New refresh token created
    expect(mockRefreshTokenCreate).toHaveBeenCalledTimes(1);

    // Access token contains correct claims
    const decoded = jwt.verify(result!.accessToken, TEST_JWT_SECRET) as Record<string, unknown>;
    expect(decoded.sub).toBe('user-1');
    expect(decoded.email).toBe('user@test.com');
  });
});

// ===========================================================================
// revokeRefreshToken
// ===========================================================================
describe('revokeRefreshToken', () => {
  it('calls updateMany with the token hash and sets revokedAt', async () => {
    mockRefreshTokenUpdateMany.mockResolvedValue({ count: 1 });
    await revokeRefreshToken('raw-token-value');

    expect(mockRefreshTokenUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockRefreshTokenUpdateMany.mock.calls[0][0];
    expect(call.data.revokedAt).toBeInstanceOf(Date);
    // tokenHash is a SHA-256 of the raw token (not the raw token itself)
    expect(call.where.tokenHash).not.toBe('raw-token-value');
    expect(call.where.tokenHash).toHaveLength(64);
  });
});

// ===========================================================================
// blacklistAccessToken / isAccessTokenBlacklisted
// ===========================================================================
describe('blacklistAccessToken', () => {
  it('calls redisSetex with the prefixed key and provided TTL', async () => {
    mockRedisSetex.mockResolvedValue(undefined);
    await blacklistAccessToken('some.jwt.token', 300);
    expect(mockRedisSetex).toHaveBeenCalledWith('blacklist:some.jwt.token', 300, '1');
  });
});

describe('isAccessTokenBlacklisted', () => {
  it('returns true when Redis has the key', async () => {
    mockRedisExists.mockResolvedValue(true);
    expect(await isAccessTokenBlacklisted('blacklisted.token')).toBe(true);
    expect(mockRedisExists).toHaveBeenCalledWith('blacklist:blacklisted.token');
  });

  it('returns false when Redis does not have the key', async () => {
    mockRedisExists.mockResolvedValue(false);
    expect(await isAccessTokenBlacklisted('valid.token')).toBe(false);
  });
});
