import crypto from 'crypto';
import { Octokit } from '@octokit/rest';
import { config } from '../config';
import { redisGet, redisSetex } from '../lib/redis';

const CACHE_TTL = 300; // 5 minutes

function makeOctokit(userToken?: string | null): Octokit {
  return new Octokit({ auth: userToken ?? config.GITHUB_TOKEN ?? undefined });
}

// Short hash of token used as cache-key discriminator (never stored as-is)
function tokenSuffix(token?: string | null): string {
  if (!token) return 'pub';
  return crypto.createHash('sha1').update(token).digest('hex').slice(0, 8);
}

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = await redisGet(key);
  if (hit) return JSON.parse(hit) as T;
  const data = await fetcher();
  await redisSetex(key, CACHE_TTL, JSON.stringify(data));
  return data;
}

export async function getRepo(owner: string, repo: string, token?: string | null) {
  const cacheKey = `gh:repo:${owner}:${repo}:${tokenSuffix(token)}`;
  return cached(cacheKey, async () => {
    const { data } = await makeOctokit(token).repos.get({ owner, repo });
    return {
      id: data.id,
      fullName: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      url: data.html_url,
      defaultBranch: data.default_branch,
      private: data.private,
    };
  });
}

export async function getIssues(owner: string, repo: string, page = 1, token?: string | null) {
  const cacheKey = `gh:issues:${owner}:${repo}:${page}:${tokenSuffix(token)}`;
  return cached(cacheKey, async () => {
    const { data } = await makeOctokit(token).issues.listForRepo({
      owner, repo, state: 'open', per_page: 20, page,
    });
    return data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        url: i.html_url,
        author: i.user?.login,
        labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
        createdAt: i.created_at,
      }));
  });
}

export async function getPulls(owner: string, repo: string, page = 1, token?: string | null) {
  const cacheKey = `gh:pulls:${owner}:${repo}:${page}:${tokenSuffix(token)}`;
  return cached(cacheKey, async () => {
    const { data } = await makeOctokit(token).pulls.list({
      owner, repo, state: 'open', per_page: 20, page,
    });
    return data.map((p) => ({
      number: p.number,
      title: p.title,
      state: p.state,
      url: p.html_url,
      author: p.user?.login,
      draft: p.draft,
      createdAt: p.created_at,
    }));
  });
}

// Returns per-file diffs for a single commit. Not cached — commit SHAs are immutable
// but we only ever fetch each once (triggered by a webhook event).
export async function getCommitFiles(owner: string, repo: string, sha: string, token?: string | null) {
  const { data } = await makeOctokit(token).repos.getCommit({ owner, repo, ref: sha });
  return (data.files ?? []).map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch ?? null,
  }));
}

// Returns per-file diffs for a pull request. Not cached.
export async function getPullRequestFiles(
  owner: string,
  repo: string,
  pullNumber: number,
  token?: string | null,
) {
  const { data } = await makeOctokit(token).pulls.listFiles({
    owner, repo, pull_number: pullNumber, per_page: 100,
  });
  return data.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch ?? null,
  }));
}

// ─── File I/O (used by testWriterService) ────────────────────────────────────

export type DirEntry = { name: string; path: string; type: 'file' | 'dir' };

// List files/dirs at a path. Returns [] for missing paths or non-directories.
export async function listDirectory(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token?: string | null,
): Promise<DirEntry[]> {
  try {
    const { data } = await makeOctokit(token).repos.getContent({ owner, repo, path, ref });
    if (!Array.isArray(data)) return [];
    return data.map((e) => ({ name: e.name, path: e.path, type: e.type === 'dir' ? 'dir' : 'file' }));
  } catch {
    return [];
  }
}

// Read a single file. Returns null for missing files, binary files, or files > maxBytes.
export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token?: string | null,
  maxBytes = 100_000,
): Promise<{ content: string; sha: string } | null> {
  try {
    const { data } = await makeOctokit(token).repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== 'file') return null;
    if (!data.content) return null;
    const decoded = Buffer.from(data.content, 'base64').toString('utf8');
    if (decoded.length > maxBytes) return null; // too large — skip
    return { content: decoded, sha: data.sha };
  } catch {
    return null;
  }
}

// Commit multiple file writes as a single Git commit using the Data API.
// Returns the new commit SHA. Requires a token with repo write access.
export async function commitFiles(
  owner: string,
  repo: string,
  branch: string,
  files: Array<{ path: string; content: string }>,
  message: string,
  token?: string | null,
): Promise<string> {
  const octokit = makeOctokit(token);

  // 1. Resolve current HEAD
  const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const headSha = refData.object.sha;

  // 2. Get the tree SHA of the current commit
  const { data: commitData } = await octokit.git.getCommit({ owner, repo, commit_sha: headSha });
  const baseTreeSha = commitData.tree.sha;

  // 3. Create a blob for every file
  const treeItems = await Promise.all(
    files.map(async (f) => {
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo,
        content: Buffer.from(f.content).toString('base64'),
        encoding: 'base64',
      });
      return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
    }),
  );

  // 4. Create new tree on top of the existing one
  const { data: newTree } = await octokit.git.createTree({
    owner, repo, base_tree: baseTreeSha, tree: treeItems,
  });

  // 5. Create the commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner, repo, message, tree: newTree.sha, parents: [headSha],
  });

  // 6. Fast-forward the branch ref
  await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });

  return newCommit.sha;
}

export async function getCommits(owner: string, repo: string, page = 1, token?: string | null) {
  const cacheKey = `gh:commits:${owner}:${repo}:${page}:${tokenSuffix(token)}`;
  return cached(cacheKey, async () => {
    const { data } = await makeOctokit(token).repos.listCommits({
      owner, repo, per_page: 20, page,
    });
    return data.map((c) => ({
      sha: c.sha.slice(0, 8),
      message: c.commit.message.split('\n')[0],
      author: c.commit.author?.name,
      date: c.commit.author?.date,
      url: c.html_url,
    }));
  });
}
