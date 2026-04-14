import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DocVisibility, Prisma, UserRole } from '@prisma/client';
import multer, { FileFilterCallback } from 'multer';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { canUserAccessDoc, canUserWriteDoc } from '../services/accessControl';
import { rebuildSections } from '../services/docIndexService';
import { refineDocWithStream } from '../services/docAiService';
import { getCommits, getPulls } from '../services/githubService';
import * as sse from '../services/sseService';

const router = Router();
router.use(verifyAccessToken);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const ok =
      file.mimetype === 'text/markdown' ||
      file.mimetype === 'text/plain' ||
      file.originalname.endsWith('.md');
    cb(null, ok);
  },
});

// ─── Doc summary select ───────────────────────────────────────────────────────

const summarySelect = {
  id: true,
  title: true,
  visibility: true,
  ownerId: true,
  teamId: true,
  repoFollowId: true,
  lastAutoSyncAt: true,
  createdAt: true,
  updatedAt: true,
  owner:      { select: { id: true, name: true } },
  team:       { select: { id: true, name: true } },
  repoFollow: { select: { id: true, owner: true, repo: true } },
} as const;

// Helper: safely cast route param to string (ParamsDictionary is typed as string | string[])
const p = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

// ─── GET /api/docs ────────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const q      = req.query.q      ? String(req.query.q)      : undefined;
  const teamId = req.query.teamId ? String(req.query.teamId) : undefined;
  const page   = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
  const limit  = 20;
  const userId = req.user!.id;

  if (q && q.trim().length > 0) {
    type FtsRow = { id: string };
    const rawResults = await prisma.$queryRaw<FtsRow[]>`
      SELECT id
      FROM "Doc"
      WHERE "deletedAt" IS NULL
        AND to_tsvector('english', title || ' ' || content)
            @@ plainto_tsquery('english', ${q.trim()})
        ${teamId ? Prisma.sql`AND "teamId" = ${teamId}::uuid` : Prisma.empty}
      ORDER BY ts_rank(
        to_tsvector('english', title || ' ' || content),
        plainto_tsquery('english', ${q.trim()})
      ) DESC
      LIMIT ${limit + 30}
    `;

    const visible: FtsRow[] = [];
    for (const row of rawResults) {
      if (visible.length >= limit) break;
      if (await canUserAccessDoc(userId, row.id)) visible.push(row);
    }

    const ids = visible.map((r) => r.id);
    const docs = await prisma.doc.findMany({
      where: { id: { in: ids } },
      select: summarySelect,
    });
    const ordered = ids.map((id) => docs.find((d) => d.id === id)!).filter(Boolean);
    return res.json({ docs: ordered, page, q });
  }

  const allDocs = await prisma.doc.findMany({
    where: { deletedAt: null, ...(teamId && { teamId }) },
    select: summarySelect,
    orderBy: { updatedAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit + 30,
  });

  const visible: typeof allDocs = [];
  for (const doc of allDocs) {
    if (visible.length >= limit) break;
    if (await canUserAccessDoc(userId, doc.id)) visible.push(doc);
  }

  res.json({ docs: visible, page });
});

// ─── POST /api/docs/import (BEFORE /:id) ─────────────────────────────────────

router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) throw createError(400, 'No .md file uploaded');

  const content      = req.file.buffer.toString('utf-8');
  const defaultTitle = req.file.originalname.replace(/\.md$/i, '');

  const body = z.object({
    title:        z.string().min(1).optional(),
    visibility:   z.nativeEnum(DocVisibility).optional().default(DocVisibility.PRIVATE),
    teamId:       z.string().uuid().optional(),
    repoFollowId: z.string().uuid().optional(),
  }).parse(req.body);

  const doc = await prisma.doc.create({
    data: {
      title:        body.title?.trim() || defaultTitle,
      content,
      visibility:   body.visibility,
      ownerId:      req.user!.id,
      teamId:       body.teamId ?? null,
      repoFollowId: body.repoFollowId ?? null,
    },
    select: summarySelect,
  });

  await rebuildSections(doc.id, content);
  res.status(201).json(doc);
});

// ─── POST /api/docs ───────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const body = z.object({
    title:        z.string().min(1),
    content:      z.string().optional().default(''),
    visibility:   z.nativeEnum(DocVisibility).optional().default(DocVisibility.PRIVATE),
    teamId:       z.string().uuid().optional(),
    repoFollowId: z.string().uuid().optional(),
  }).parse(req.body);

  const doc = await prisma.doc.create({
    data: {
      title:        body.title,
      content:      body.content,
      visibility:   body.visibility,
      ownerId:      req.user!.id,
      teamId:       body.teamId ?? null,
      repoFollowId: body.repoFollowId ?? null,
    },
    select: summarySelect,
  });

  if (body.content) await rebuildSections(doc.id, body.content);
  res.status(201).json(doc);
});

// ─── GET /api/docs/:id ────────────────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  const id = p(req.params.id);
  if (!(await canUserAccessDoc(req.user!.id, id))) throw createError(403, 'Forbidden');

  const doc = await prisma.doc.findUnique({
    where: { id, deletedAt: null },
    include: {
      owner:      { select: { id: true, name: true } },
      team:       { select: { id: true, name: true } },
      repoFollow: { select: { id: true, owner: true, repo: true } },
      sections: {
        select: { id: true, heading: true, level: true, order: true },
        orderBy: { order: 'asc' },
      },
      aiRefinements: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { createdBy: { select: { id: true, name: true } } },
      },
    },
  });
  if (!doc) throw createError(404, 'Doc not found');
  res.json(doc);
});

// ─── GET /api/docs/:id/sections/:order ───────────────────────────────────────

router.get('/:id/sections/:order', async (req: Request, res: Response) => {
  const id = p(req.params.id);
  if (!(await canUserAccessDoc(req.user!.id, id))) throw createError(403, 'Forbidden');

  const order = parseInt(p(req.params.order), 10);
  if (isNaN(order)) throw createError(400, 'Invalid section order');

  const section = await prisma.docSection.findFirst({ where: { docId: id, order } });
  if (!section) throw createError(404, 'Section not found');
  res.json(section);
});

// ─── PATCH /api/docs/:id ──────────────────────────────────────────────────────

router.patch('/:id', async (req: Request, res: Response) => {
  const id = p(req.params.id);
  if (!(await canUserWriteDoc(req.user!.id, id))) throw createError(403, 'Forbidden');

  const body = z.object({
    title:        z.string().min(1).optional(),
    content:      z.string().optional(),
    visibility:   z.nativeEnum(DocVisibility).optional(),
    repoFollowId: z.string().uuid().nullable().optional(),
  }).parse(req.body);

  const doc = await prisma.doc.update({
    where: { id },
    data: {
      ...(body.title        !== undefined && { title: body.title }),
      ...(body.content      !== undefined && { content: body.content }),
      ...(body.visibility   !== undefined && { visibility: body.visibility }),
      ...(body.repoFollowId !== undefined && { repoFollowId: body.repoFollowId }),
    },
    select: summarySelect,
  });

  if (body.content !== undefined) await rebuildSections(doc.id, body.content);

  if (doc.teamId) {
    const members = await prisma.teamMember.findMany({ where: { teamId: doc.teamId } });
    sse.broadcast(members.map((m) => m.userId), 'doc.updated', { docId: doc.id });
  }

  res.json(doc);
});

// ─── DELETE /api/docs/:id ─────────────────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  const id = p(req.params.id);
  const doc = await prisma.doc.findUnique({ where: { id, deletedAt: null } });
  if (!doc) throw createError(404, 'Doc not found');

  const canDelete = req.user!.role === UserRole.ADMIN || doc.ownerId === req.user!.id;
  if (!canDelete) throw createError(403, 'Forbidden');

  await prisma.doc.update({ where: { id }, data: { deletedAt: new Date() } });
  res.status(204).end();
});

// ─── POST /api/docs/:id/ai-refine — SSE stream ───────────────────────────────

router.post('/:id/ai-refine', async (req: Request, res: Response) => {
  const id = p(req.params.id);
  if (!(await canUserAccessDoc(req.user!.id, id))) throw createError(403, 'Forbidden');

  const { prompt } = z.object({ prompt: z.string().min(1).max(2000) }).parse(req.body);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const { response, toolCalls } = await refineDocWithStream(id, prompt, req.user!.id, res);

    await prisma.aiRefinement.create({
      data: {
        docId:       id,
        prompt,
        response,
        toolCalls:   toolCalls as any,
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

// ─── POST /api/docs/:id/trigger-sync ─────────────────────────────────────────

router.post('/:id/trigger-sync', async (req: Request, res: Response) => {
  const id = p(req.params.id);
  if (!(await canUserAccessDoc(req.user!.id, id))) throw createError(403, 'Forbidden');

  const doc = await prisma.doc.findUnique({
    where: { id, deletedAt: null },
    include: {
      repoFollow: true,
      team: { include: { members: true } },
    },
  });
  if (!doc) throw createError(404, 'Doc not found');
  if (!doc.repoFollow) throw createError(400, 'Doc has no linked repository');

  const { owner, repo } = doc.repoFollow;
  const since = doc.lastAutoSyncAt?.toISOString()
    ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const fullUser = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { githubToken: true },
  });
  const token = fullUser?.githubToken ?? undefined;

  const [commits, pulls] = await Promise.all([
    getCommits(owner, repo, 1, token),
    getPulls(owner, repo, 1, token),
  ]);

  const newCommits = (commits as any[]).filter(
    (c) => c.commit?.author?.date && c.commit.author.date > since,
  );
  const newPulls = (pulls as any[]).filter(
    (p2) => p2.updated_at && p2.updated_at > since,
  );

  if (newCommits.length === 0 && newPulls.length === 0) {
    return res.json({ triggered: false, reason: 'No new repo activity since last sync' });
  }

  const repoContext = buildRepoContext(owner, repo, newCommits, newPulls);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const autoPrompt = `New activity in ${owner}/${repo} since last sync. Update the documentation to reflect these changes.`;
    const { response, toolCalls } = await refineDocWithStream(
      doc.id, autoPrompt, req.user!.id, res, repoContext,
    );

    await prisma.$transaction([
      prisma.doc.update({ where: { id: doc.id }, data: { lastAutoSyncAt: new Date() } }),
      prisma.aiRefinement.create({
        data: {
          docId:       doc.id,
          prompt:      autoPrompt,
          response,
          toolCalls:   toolCalls as any,
          createdById: req.user!.id,
        },
      }),
    ]);

    if (doc.team) {
      sse.broadcast(doc.team.members.map((m) => m.userId), 'doc.auto_updated', { docId: doc.id });
    }

    res.write(`event: done\ndata: ${JSON.stringify({ toolCallCount: toolCalls.length })}\n\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync error';
    res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
  } finally {
    res.end();
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRepoContext(owner: string, repo: string, commits: any[], pulls: any[]): string {
  const lines: string[] = [`Repository: ${owner}/${repo}`, ''];

  if (commits.length > 0) {
    lines.push('Recent commits:');
    for (const c of commits.slice(0, 10)) {
      const msg  = c.commit?.message?.split('\n')[0] ?? 'no message';
      const date = c.commit?.author?.date?.substring(0, 10) ?? '';
      lines.push(`  - [${date}] ${msg}`);
    }
    lines.push('');
  }

  if (pulls.length > 0) {
    lines.push('Recent pull requests:');
    for (const p2 of pulls.slice(0, 10)) {
      lines.push(`  - [${p2.state}] #${p2.number} ${p2.title}`);
    }
  }

  return lines.join('\n');
}

export default router;
