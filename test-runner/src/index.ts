import 'express-async-errors';
import express, { Request, Response } from 'express';
import { runTests, RunResult } from './runner';

const app = express();
app.use(express.json());

const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? '';
const PORT = parseInt(process.env.PORT ?? '4000', 10);

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ─── Run job ──────────────────────────────────────────────────────────────────

interface RunJobBody {
  testRunId: string;
  owner: string;
  repo: string;
  sha: string;
  branch: string;
  token: string | null;
  callbackUrl: string;
  secret: string;
}

app.post('/run', (req: Request, res: Response) => {
  const body = req.body as RunJobBody;

  if (!body.testRunId || !body.owner || !body.repo || !body.sha || !body.callbackUrl) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  // Acknowledge immediately — job runs async
  res.status(202).json({ accepted: true, testRunId: body.testRunId });

  // Run in background
  executeJob(body).catch((err) => {
    console.error(`[runner] Unhandled error for ${body.testRunId}:`, err);
  });
});

// ─── Job executor ─────────────────────────────────────────────────────────────

async function executeJob(job: RunJobBody): Promise<void> {
  const { testRunId, owner, repo, sha, token, callbackUrl, secret } = job;
  console.log(`[runner] Starting ${owner}/${repo}@${sha.slice(0, 7)} (run ${testRunId})`);

  let result: RunResult;
  let runError: string | undefined;

  try {
    result = await runTests(owner, repo, sha, token);
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
    result = { passed: false, suites: [] };
    console.error(`[runner] runTests threw for ${testRunId}:`, runError);
  }

  console.log(
    `[runner] Done ${testRunId} — passed=${result.passed}`,
    result.suites.map((s) => `${s.suite}:${s.passed ? 'PASS' : 'FAIL'}`).join(' '),
  );

  // Post results back to backend
  try {
    const resp = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify({ result, error: runError }),
    });

    if (!resp.ok) {
      console.error(`[runner] Callback ${callbackUrl} returned ${resp.status}`);
    }
  } catch (err) {
    console.error(`[runner] Callback failed for ${testRunId}:`, err);
  }
}

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
  console.error('[runner] Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`[runner] Listening on port ${PORT}`);
});
