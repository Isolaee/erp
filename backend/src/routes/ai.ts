import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { verifyAccessToken } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { canUserAccessList, canUserAccessTask } from '../services/accessControl';
import { refineWithStream } from '../services/aiService';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(verifyAccessToken);

// POST /api/ai/refine — SSE streaming response
router.post('/refine', async (req: Request, res: Response) => {
  const body = z.object({
    targetType: z.enum(['task', 'list']),
    targetId: z.string().uuid(),
    prompt: z.string().min(1).max(2000),
  }).parse(req.body);

  // Access check
  if (body.targetType === 'list') {
    if (!(await canUserAccessList(req.user!.id, body.targetId))) throw createError(403, 'Forbidden');
  } else {
    if (!(await canUserAccessTask(req.user!.id, body.targetId))) throw createError(403, 'Forbidden');
  }

  // Set up SSE for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const { response, toolCalls } = await refineWithStream(
      body.targetType,
      body.targetId,
      body.prompt,
      req.user!.id,
      res,
    );

    // Persist refinement record
    await prisma.aiRefinement.create({
      data: {
        taskId: body.targetType === 'task' ? body.targetId : null,
        listId: body.targetType === 'list' ? body.targetId : null,
        prompt: body.prompt,
        response,
        toolCalls: toolCalls as any,
        createdById: req.user!.id,
      },
    });

    res.write(`event: done\ndata: ${JSON.stringify({ toolCallCount: toolCalls.length })}\n\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI error';
    res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
  } finally {
    res.end();
  }
});

// GET /api/ai/refinements — list refinements for a task or list
router.get('/refinements', async (req: Request, res: Response) => {
  const { taskId, listId } = req.query as { taskId?: string; listId?: string };
  const refinements = await prisma.aiRefinement.findMany({
    where: {
      ...(taskId && { taskId }),
      ...(listId && { listId }),
    },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json(refinements);
});

export default router;
