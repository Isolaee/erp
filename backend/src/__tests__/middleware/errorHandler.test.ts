import { Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { Prisma } from '@prisma/client';
import { errorHandler, createError } from '../../middleware/errorHandler';

function makeRes() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

const noop = jest.fn();

describe('createError', () => {
  it('creates an Error with a status property', () => {
    const err = createError(404, 'Not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Not found');
    expect((err as any).status).toBe(404);
  });
});

describe('errorHandler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 for ZodError with field errors', () => {
    const schema = z.object({ name: z.string() });
    let zodErr: ZodError | null = null;
    try { schema.parse({}); } catch (e) { zodErr = e as ZodError; }
    const res = makeRes();
    errorHandler(zodErr!, {} as Request, res, noop);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation error' }));
  });

  it('returns 409 for Prisma P2002 (unique constraint)', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '1.0',
    });
    const res = makeRes();
    errorHandler(err, {} as Request, res, noop);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Resource already exists' });
  });

  it('returns 404 for Prisma P2025 (record not found)', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Not found', {
      code: 'P2025',
      clientVersion: '1.0',
    });
    const res = makeRes();
    errorHandler(err, {} as Request, res, noop);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Resource not found' });
  });

  it('returns the status from a createError-style error', () => {
    const err = createError(403, 'Forbidden');
    const res = makeRes();
    errorHandler(err, {} as Request, res, noop);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('returns 500 for unexpected errors', () => {
    const res = makeRes();
    errorHandler(new Error('boom'), {} as Request, res, noop);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });
});
