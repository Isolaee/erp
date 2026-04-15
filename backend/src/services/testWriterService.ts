import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { emit } from './sseService';
import { listDirectory, getFileContent, commitFiles, DirEntry } from './githubService';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// Safety limits — keep context window manageable
const MAX_TOOL_ROUNDS  = 12;
const MAX_READ_BYTES   = 120_000; // total chars read across all read_file calls
const MAX_FILES_WRITTEN = 10;

const COMMIT_MESSAGE_PREFIX = '[test-update]';

const SYSTEM_PROMPT = `You are an expert test engineer embedded in a CI pipeline. \
You will be given a git diff showing recent code changes. Your job is to bring the \
test suite up to date so it covers those changes.

Workflow (follow this order):
1. Call list_directory("") to see the repo root, then explore subdirectories to \
locate test files (look for __tests__, test, spec, *.test.*, *.spec.* patterns).
2. Call read_file on the most relevant existing test files to learn the framework \
(Jest, Vitest, Mocha, pytest, etc.) and coding conventions.
3. Call write_file for each test file you need to create or update. Write complete \
file contents — do not use placeholders or abbreviations.

Rules:
- Only write test files, never source files.
- Match the existing framework, assertion style, and file-naming convention exactly.
- Prefer updating an existing test file over creating a new one.
- Cover the happy path AND meaningful edge cases for every changed function/method.
- Do not delete or weaken existing tests unless the behaviour they test has changed.
- When you are done writing all needed files, stop calling tools and write a short \
plain-text summary of what you changed and why.`;

// ─── Tool definitions ─────────────────────────────────────────────────────────

const tools: Anthropic.Tool[] = [
  {
    name: 'list_directory',
    description:
      'List files and subdirectories at a path in the repository. ' +
      'Pass an empty string "" for the repo root.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path relative to repo root, e.g. "src/__tests__"' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read the full contents of a file. Use to understand existing test patterns before writing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to repo root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create or fully overwrite a test file with new content. ' +
      'Write the complete file — no ellipses or placeholders.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path:    { type: 'string', description: 'File path relative to repo root' },
        content: { type: 'string', description: 'Complete file content' },
        reason:  { type: 'string', description: 'One-sentence reason for this change' },
      },
      required: ['path', 'content', 'reason'],
    },
  },
];

// ─── Tool executor ────────────────────────────────────────────────────────────

interface PendingWrite { path: string; content: string; reason: string }

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  owner: string,
  repo: string,
  ref: string,
  token: string | null,
  pendingWrites: PendingWrite[],
  readBudget: { remaining: number },
): Promise<string> {
  switch (name) {
    case 'list_directory': {
      const path = (input.path as string) ?? '';
      const entries: DirEntry[] = await listDirectory(owner, repo, path, ref, token);
      if (entries.length === 0) return JSON.stringify({ error: 'Directory not found or empty' });
      const lines = entries.map((e) => `${e.type === 'dir' ? '[dir]' : '[file]'} ${e.path}`);
      return JSON.stringify({ entries: lines });
    }

    case 'read_file': {
      const path = input.path as string;
      if (readBudget.remaining <= 0) {
        return JSON.stringify({ error: 'Read budget exhausted — stop reading and start writing tests' });
      }
      const file = await getFileContent(owner, repo, path, ref, token);
      if (!file) return JSON.stringify({ error: `File not found or too large: ${path}` });
      readBudget.remaining -= file.content.length;
      return JSON.stringify({ path, content: file.content });
    }

    case 'write_file': {
      const path    = input.path    as string;
      const content = input.content as string;
      const reason  = input.reason  as string;
      if (pendingWrites.length >= MAX_FILES_WRITTEN) {
        return JSON.stringify({ error: `Write limit (${MAX_FILES_WRITTEN} files) reached` });
      }
      // Deduplicate — last write for a given path wins
      const existing = pendingWrites.findIndex((w) => w.path === path);
      if (existing >= 0) pendingWrites.splice(existing, 1);
      pendingWrites.push({ path, content, reason });
      return JSON.stringify({ success: true, path });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface WriteTestsResult {
  filesWritten: string[];
  newCommitSha: string | undefined;
  summary: string;
}

export async function writeTests(
  testRunId: string,
  diffText: string,
): Promise<WriteTestsResult> {
  // Load run + repo context
  const testRun = await prisma.testRun.findUnique({
    where: { id: testRunId },
    include: {
      repoFollow: {
        include: { team: { include: { members: { select: { userId: true } } } } },
      },
    },
  });
  if (!testRun) return { filesWritten: [], newCommitSha: undefined, summary: 'TestRun not found' };

  const { repoFollow } = testRun;
  const { owner, repo } = repoFollow;
  const branch = testRun.branch ?? 'main';
  const token  = repoFollow.team.githubPat ?? config.GITHUB_TOKEN ?? null;

  // Notify team that writing is starting
  for (const m of repoFollow.team.members) {
    emit(m.userId, 'testRun.writing', { testRunId, owner, repo, branch });
  }

  // ── Build the user message ──────────────────────────────────────────────────
  const contextLines = [
    `Repository: ${owner}/${repo}`,
    `Branch: ${branch}`,
    testRun.commitSha     ? `Commit: ${testRun.commitSha}`                  : null,
    testRun.commitMessage ? `Commit message: ${testRun.commitMessage}`       : null,
    '',
    '## Diff',
    diffText || '(diff not available)',
  ].filter((l): l is string => l !== null).join('\n');

  // ── Tool-use loop ───────────────────────────────────────────────────────────
  const pendingWrites: PendingWrite[]  = [];
  const readBudget = { remaining: MAX_READ_BYTES };
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: contextLines }];
  let summary = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 8096,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools,
      messages,
    });

    // Collect any text Claude wrote
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    if (textBlocks.length > 0) summary = textBlocks.map((b) => b.text).join('');

    // Stop if no tool calls
    if (response.stop_reason !== 'tool_use') break;

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (toolUseBlocks.length === 0) break;

    // Execute each tool call
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const result = await executeTool(
        block.name,
        block.input as Record<string, unknown>,
        owner, repo, branch, token,
        pendingWrites, readBudget,
      );
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }

    // Extend conversation for next round
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user',      content: toolResults });
  }

  // ── Commit all written files as a single commit ─────────────────────────────
  let newCommitSha: string | undefined;
  if (pendingWrites.length > 0 && token) {
    try {
      const commitMsg =
        `${COMMIT_MESSAGE_PREFIX} update tests for ${testRun.commitSha?.slice(0, 7) ?? branch}\n\n` +
        pendingWrites.map((w) => `- ${w.path}: ${w.reason}`).join('\n');

      newCommitSha = await commitFiles(
        owner, repo, branch,
        pendingWrites.map((w) => ({ path: w.path, content: w.content })),
        commitMsg,
        token,
      );

      console.log(
        `[testWriter] Committed ${pendingWrites.length} file(s) to ${owner}/${repo}@${branch} — ${newCommitSha}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[testWriter] Commit failed for ${testRunId}:`, msg);
      summary += `\n\n⚠️ Commit failed: ${msg}`;
    }
  } else if (pendingWrites.length > 0 && !token) {
    console.warn(`[testWriter] ${pendingWrites.length} file(s) ready but no write token — skipping commit`);
    summary += '\n\n⚠️ No GitHub write token configured — test files were not committed.';
  }

  // ── Notify team ─────────────────────────────────────────────────────────────
  const filesWritten = pendingWrites.map((w) => w.path);
  for (const m of repoFollow.team.members) {
    emit(m.userId, 'testRun.written', {
      testRunId, owner, repo,
      filesWritten,
      newCommitSha,
      summary,
    });
  }

  return { filesWritten, newCommitSha, summary };
}

export { COMMIT_MESSAGE_PREFIX };
