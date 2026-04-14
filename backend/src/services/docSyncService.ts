import { prisma } from '../lib/prisma';
import { getCommits, getPulls } from './githubService';
import { autoUpdateDoc } from './docAiService';
import * as sse from './sseService';

function buildRepoSummary(owner: string, repo: string, commits: any[], pulls: any[]): string {
  const lines = [`Repository: ${owner}/${repo}`, ''];

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
    for (const p of pulls.slice(0, 10)) {
      lines.push(`  - [${p.state}] #${p.number} ${p.title}`);
    }
  }

  return lines.join('\n');
}

async function syncDoc(docId: string): Promise<void> {
  const doc = await prisma.doc.findUnique({
    where: { id: docId },
    include: {
      repoFollow: true,
      team: { include: { members: true } },
    },
  });

  if (!doc || !doc.repoFollow) return;

  const { owner, repo } = doc.repoFollow;
  const since = doc.lastAutoSyncAt?.toISOString()
    ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const [commits, pulls] = await Promise.all([
      getCommits(owner, repo, 1),
      getPulls(owner, repo, 1),
    ]);

    const newCommits = (commits as any[]).filter(
      (c) => c.commit?.author?.date && c.commit.author.date > since,
    );
    const newPulls = (pulls as any[]).filter(
      (p) => p.updated_at && p.updated_at > since,
    );

    if (newCommits.length === 0 && newPulls.length === 0) return;

    const repoSummary = buildRepoSummary(owner, repo, newCommits, newPulls);
    await autoUpdateDoc(docId, repoSummary);

    await prisma.doc.update({
      where: { id: docId },
      data: { lastAutoSyncAt: new Date() },
    });

    if (doc.team) {
      sse.broadcast(
        doc.team.members.map((m) => m.userId),
        'doc.auto_updated',
        { docId },
      );
    }
  } catch (err) {
    console.error(`[docSync] Failed to sync doc ${docId}:`, err);
  }
}

export function startDocSyncPoller(intervalMs = 15 * 60 * 1000): void {
  const tick = async () => {
    try {
      // Only sync docs that haven't been manually touched in the last 30 min
      const cutoff = new Date(Date.now() - 30 * 60 * 1000);
      const docs = await prisma.doc.findMany({
        where: {
          deletedAt:     null,
          repoFollowId:  { not: null },
          updatedAt:     { lt: cutoff },
        },
        select: { id: true },
      });

      for (const doc of docs) {
        await syncDoc(doc.id);
      }
    } catch (err) {
      console.error('[docSync] Poller tick error:', err);
    }
  };

  // Run first tick after initial interval, not immediately on startup
  setInterval(tick, intervalMs);
  console.log(`[docSync] Background poller started (interval: ${intervalMs / 1000}s)`);
}
