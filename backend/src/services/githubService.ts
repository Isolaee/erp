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
