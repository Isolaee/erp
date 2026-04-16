import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestCase {
  suiteName: string;
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration?: number;
  errorMessage?: string;
  errorStack?: string;
}

export interface SuiteResult {
  suite: 'backend' | 'frontend';
  passed: boolean;
  tests: TestCase[];
  error?: string;
}

export interface RunResult {
  passed: boolean;
  suites: SuiteResult[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout: 300_000, // 5 min per suite
    env: { ...process.env, ...env },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

// Jest and Vitest both emit the same JSON shape when --reporter=json / --json is used.
function parseTestJson(raw: string, suite: 'backend' | 'frontend'): TestCase[] {
  let data: Record<string, unknown>;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    data = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return [];
  }

  const cases: TestCase[] = [];
  const suiteResults = (data.testResults ?? []) as Array<Record<string, unknown>>;

  for (const file of suiteResults) {
    const suiteName = path.basename((file.testFilePath as string | undefined) ?? '');
    // jest uses assertionResults; vitest uses testResults at the file level
    const assertions = ((file.assertionResults ?? file.testResults) ?? []) as Array<Record<string, unknown>>;

    for (const t of assertions) {
      const status = t.status === 'passed' ? 'passed'
        : t.status === 'pending' || t.status === 'skipped' || t.status === 'todo' ? 'skipped'
        : 'failed';

      const failures = (t.failureMessages as string[] | undefined) ?? [];

      cases.push({
        suiteName,
        testName: (t.fullName ?? t.title ?? '') as string,
        status,
        duration: (t.duration as number | undefined) ?? undefined,
        errorMessage: failures[0]?.split('\n')[0],
        errorStack: failures[0],
      });
    }
  }
  return cases;
}

// ─── Clone ────────────────────────────────────────────────────────────────────

function cloneRepo(owner: string, repo: string, sha: string, token: string | null, dir: string): void {
  const url = token
    ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  // Shallow clone then checkout the specific commit
  const clone = run('git', ['clone', '--depth=100', url, dir], os.tmpdir());
  if (clone.exitCode !== 0) {
    throw new Error(`git clone failed: ${clone.stderr.slice(0, 500)}`);
  }

  const checkout = run('git', ['checkout', sha], dir);
  if (checkout.exitCode !== 0) {
    throw new Error(`git checkout ${sha} failed: ${checkout.stderr.slice(0, 500)}`);
  }
}

// ─── Suite runners ────────────────────────────────────────────────────────────

function runBackend(repoDir: string): SuiteResult {
  const dir = path.join(repoDir, 'backend');
  if (!fs.existsSync(dir)) {
    return { suite: 'backend', passed: true, tests: [], error: 'No backend directory — skipped' };
  }

  const install = run('npm', ['install', '--prefer-offline'], dir, { NODE_ENV: 'test' });
  if (install.exitCode !== 0) {
    return { suite: 'backend', passed: false, tests: [], error: `npm install failed:\n${install.stderr.slice(0, 800)}` };
  }

  // Generate Prisma client (needed for type imports even though tests mock the DB)
  run('npx', ['prisma', 'generate'], dir, { NODE_ENV: 'test' });

  const testEnv: Record<string, string> = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'test-jwt-secret-at-least-16chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-16chars',
    ANTHROPIC_API_KEY: 'test-key',
    ADMIN_EMAIL: 'admin@test.com',
    ADMIN_PASSWORD: 'testpassword123',
    FRONTEND_URL: 'http://localhost:5173',
  };

  // jest --json outputs structured JSON to stdout; --forceExit prevents hangs
  const result = run('npm', ['test', '--', '--json', '--silent', '--forceExit'], dir, testEnv);
  const tests = parseTestJson(result.stdout, 'backend');

  return {
    suite: 'backend',
    passed: result.exitCode === 0,
    tests,
    error: result.exitCode !== 0 && tests.length === 0
      ? result.stderr.slice(0, 1000)
      : undefined,
  };
}

function runFrontend(repoDir: string): SuiteResult {
  const dir = path.join(repoDir, 'frontend');
  if (!fs.existsSync(dir)) {
    return { suite: 'frontend', passed: true, tests: [], error: 'No frontend directory — skipped' };
  }

  const install = run('npm', ['install', '--prefer-offline'], dir);
  if (install.exitCode !== 0) {
    return { suite: 'frontend', passed: false, tests: [], error: `npm install failed:\n${install.stderr.slice(0, 800)}` };
  }

  // vitest --reporter=json outputs Jest-compatible JSON to stdout
  const result = run('npx', ['vitest', 'run', '--reporter=json'], dir, { NODE_ENV: 'test' });
  const tests = parseTestJson(result.stdout, 'frontend');

  return {
    suite: 'frontend',
    passed: result.exitCode === 0,
    tests,
    error: result.exitCode !== 0 && tests.length === 0
      ? result.stderr.slice(0, 1000)
      : undefined,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runTests(
  owner: string,
  repo: string,
  sha: string,
  token: string | null,
): Promise<RunResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `run-${sha.slice(0, 7)}-`));

  try {
    cloneRepo(owner, repo, sha, token, dir);

    const backend = runBackend(dir);
    const frontend = runFrontend(dir);

    return {
      passed: backend.passed && frontend.passed,
      suites: [backend, frontend],
    };
  } finally {
    // Always clean up the cloned repo
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
