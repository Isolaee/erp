import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyAccessToken } from '../../middleware/auth';
import { config } from '../../config';

function makeReq(authHeader?: string): Partial<Request> {
  return { headers: authHeader ? { authorization: authHeader } : {} } as Partial<Request>;
}

function makeRes(): { status: jest.Mock; json: jest.Mock } {
  const res = { status: jest.fn(), json: jest.fn() } as any;
  res.status.mockReturnValue(res);
  return res;
}

describe('verifyAccessToken', () => {
  const next: NextFunction = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('calls next() and attaches req.user for a valid token', () => {
    const token = jwt.sign(
      { sub: 'user-1', email: 'alice@test.com', role: 'MEMBER' },
      config.JWT_SECRET,
      { expiresIn: '15m' },
    );
    const req = makeReq(`Bearer ${token}`) as any;
    const res = makeRes() as any;

    verifyAccessToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: 'user-1', email: 'alice@test.com', role: 'MEMBER' });
  });

  it('returns 401 when Authorization header is missing', () => {
    const req = makeReq() as any;
    const res = makeRes() as any;

    verifyAccessToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing authorization header' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is not a Bearer token', () => {
    const req = makeReq('Basic sometoken') as any;
    const res = makeRes() as any;

    verifyAccessToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is expired', () => {
    const token = jwt.sign(
      { sub: 'user-1', email: 'alice@test.com', role: 'MEMBER' },
      config.JWT_SECRET,
      { expiresIn: -1 },
    );
    const req = makeReq(`Bearer ${token}`) as any;
    const res = makeRes() as any;

    verifyAccessToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is signed with wrong secret', () => {
    const token = jwt.sign({ sub: 'x', email: 'x@x.com', role: 'MEMBER' }, 'wrong-secret');
    const req = makeReq(`Bearer ${token}`) as any;
    const res = makeRes() as any;

    verifyAccessToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
