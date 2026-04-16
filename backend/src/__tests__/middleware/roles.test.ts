import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { requireRole } from '../../middleware/roles';

function makeReq(role?: UserRole): Partial<Request> {
  const req: any = {};
  if (role !== undefined) req.user = { id: 'u1', email: 'u@test.com', role };
  return req;
}

function makeRes() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('requireRole', () => {
  const next = jest.fn() as NextFunction;

  beforeEach(() => jest.clearAllMocks());

  it('calls next() when user has the exact required role', () => {
    const mw = requireRole(UserRole.MEMBER);
    mw(makeReq(UserRole.MEMBER) as Request, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() when user role is higher than required', () => {
    const mw = requireRole(UserRole.MEMBER);
    mw(makeReq(UserRole.ADMIN) as Request, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() for TEAM_LEAD when MEMBER is required', () => {
    const mw = requireRole(UserRole.MEMBER);
    mw(makeReq(UserRole.TEAM_LEAD) as Request, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when user role is below the required role', () => {
    const mw = requireRole(UserRole.ADMIN);
    const res = makeRes();
    mw(makeReq(UserRole.MEMBER) as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for MEMBER when TEAM_LEAD is required', () => {
    const mw = requireRole(UserRole.TEAM_LEAD);
    const res = makeRes();
    mw(makeReq(UserRole.MEMBER) as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when req.user is not set', () => {
    const mw = requireRole(UserRole.MEMBER);
    const res = makeRes();
    mw(makeReq() as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthenticated' });
    expect(next).not.toHaveBeenCalled();
  });
});
