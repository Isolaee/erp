import { Request, Response, NextFunction } from 'express';
import { ZodError, z } from 'zod';
import { Prisma } from '@prisma/client';
import { errorHandler, createError } from '../errorHandler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  // Wire json to the chained object returned by status()
  (status as jest.Mock).mockReturnValue({ json });
  return { res, status, json };
}

const req = {} as Request;
const next: NextFunction = jest.fn();

// ---------------------------------------------------------------------------
// Helper to create a real ZodError
// ---------------------------------------------------------------------------
function makeZodError(): ZodError {
  const result = z.object({ name: z.string(), age: z.number() }).safeParse({ name: 42 });
  if (!result.success) return result.error;
  throw new Error('Expected parse to fail');
}

// ---------------------------------------------------------------------------
// Helper to create a Prisma known request error
// ---------------------------------------------------------------------------
function makePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('DB error', {
    code,
    clientVersion: '5.0.0',
  });
}

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
// errorHandler
// ===========================================================================
describe('errorHandler', () => {
  it('handles ZodError → 400 with field errors', () => {
    const { res, status, json } = makeRes();
    const err = makeZodError();

    errorHandler(err, req, res, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation error', details: expect.any(Object) }),
    );
  });

  it('ZodError details contains per-field errors', () => {
    const { res, json } = makeRes();
    const err = makeZodError();

    errorHandler(err, req, res, next);

    const payload = json.mock.calls[0][0];
    // 'name' should fail (expected string, got number); 'age' missing
    expect(payload.details).toHaveProperty('name');
    expect(payload.details).toHaveProperty('age');
  });

  it('handles Prisma P2002 (unique constraint) → 409', () => {
    const { res, status, json } = makeRes();

    errorHandler(makePrismaError('P2002'), req, res, next);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: 'Resource already exists' });
  });

  it('handles Prisma P2025 (record not found) → 404', () => {
    const { res, status, json } = makeRes();

    errorHandler(makePrismaError('P2025'), req, res, next);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'Resource not found' });
  });

  it('handles custom status error (via createError) → correct status', () => {
    const { res, status, json } = makeRes();
    const err = createError(403, 'Forbidden access');

    errorHandler(err, req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden access' });
  });

  it('handles custom 404 status error', () => {
    const { res, status, json } = makeRes();
    const err = createError(404, 'Not found');

    errorHandler(err, req, res, next);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('handles unknown errors → 500 Internal Server Error', () => {
    const { res, status, json } = makeRes();
    const err = new Error('Something unexpected');

    // Suppress console.error output during this test
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    errorHandler(err, req, res, next);
    consoleSpy.mockRestore();

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('handles non-Error thrown values → 500', () => {
    const { res, status, json } = makeRes();

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    errorHandler('raw string error', req, res, next);
    consoleSpy.mockRestore();

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });
});

// ===========================================================================
// createError
// ===========================================================================
describe('createError', () => {
  it('returns an Error with a .status property', () => {
    const err = createError(422, 'Unprocessable');
    expect(err).toBeInstanceOf(Error);
    expect((err as any).status).toBe(422);
    expect(err.message).toBe('Unprocessable');
  });

  it('works for any HTTP status code', () => {
    for (const code of [400, 401, 403, 404, 409, 422, 500]) {
      const err = createError(code, `Error ${code}`);
      expect((err as any).status).toBe(code);
    }
  });
});
