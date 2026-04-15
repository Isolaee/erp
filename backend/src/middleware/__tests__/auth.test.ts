import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyAccessToken } from '../auth';
import { UserRole } from '@prisma/client';

// config is loaded from env vars set in setup.ts — no mock needed here
const JWT_SECRET = process.env.JWT_SECRET!;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(authHeader?: string): Partial<Request> {
  return { headers: authHeader ? { authorization: authHeader } : {} } as Partial<Request>;
}

function makeRes(): { res: Partial<Response>; statusMock: jest.Mock; jsonMock: jest.Mock } {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  const res: Partial<Response> = { status: statusMock, json: jsonMock } as any;
  return { res, statusMock, jsonMock };
}

const next: NextFunction = jest.fn();

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
// verifyAccessToken
// ===========================================================================
describe('verifyAccessToken', () => {
  it('responds 401 when Authorization header is missing', () => {
    const req = makeReq();
    const { res, statusMock, jsonMock } = makeRes();

    verifyAccessToken(req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Missing authorization header' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 when Authorization header does not start with "Bearer "', () => {
    const req = makeReq('Basic dXNlcjpwYXNz');
    const { res, statusMock, jsonMock } = makeRes();

    verifyAccessToken(req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Missing authorization header' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 for an invalid (malformed) token', () => {
    const req = makeReq('Bearer not.a.real.token');
    const { res, statusMock, jsonMock } = makeRes();

    verifyAccessToken(req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 for a token signed with the wrong secret', () => {
    const badToken = jwt.sign({ sub: 'user-1', email: 'u@test.com', role: 'MEMBER' }, 'wrong-secret');
    const req = makeReq(`Bearer ${badToken}`);
    const { res, statusMock, jsonMock } = makeRes();

    verifyAccessToken(req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
  });

  it('responds 401 for an expired token', () => {
    // Sign with expiresIn: 0 to get an immediately-expired token
    const expired = jwt.sign(
      { sub: 'user-1', email: 'u@test.com', role: 'MEMBER' },
      JWT_SECRET,
      { expiresIn: -1 }, // already expired
    );
    const req = makeReq(`Bearer ${expired}`);
    const { res, statusMock, jsonMock } = makeRes();

    verifyAccessToken(req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
  });

  it('attaches req.user and calls next() for a valid token', () => {
    const token = jwt.sign(
      { sub: 'user-42', email: 'valid@test.com', role: UserRole.TEAM_LEAD },
      JWT_SECRET,
      { expiresIn: '15m' },
    );
    const req = makeReq(`Bearer ${token}`) as Request & { user?: unknown };
    const { res } = makeRes();

    verifyAccessToken(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).user).toMatchObject({
      id: 'user-42',
      email: 'valid@test.com',
      role: UserRole.TEAM_LEAD,
    });
  });

  it('attaches correct id (from sub claim) to req.user', () => {
    const token = jwt.sign(
      { sub: 'specific-id-123', email: 'x@test.com', role: UserRole.ADMIN },
      JWT_SECRET,
      { expiresIn: '15m' },
    );
    const req = makeReq(`Bearer ${token}`) as Request;

    verifyAccessToken(req, makeRes().res as Response, next);

    expect((req as any).user.id).toBe('specific-id-123');
  });
});
