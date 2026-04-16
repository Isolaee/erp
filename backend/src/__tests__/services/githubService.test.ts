// Mock @octokit/rest BEFORE importing githubService
jest.mock('@octokit/rest', () => {
  const mockOctokit = {
    repos: {
      get: jest.fn(),
      listCommits: jest.fn(),
      getCommit: jest.fn(),
      getContent: jest.fn(),
    },
    issues: { listForRepo: jest.fn() },
    pulls: { list: jest.fn(), listFiles: jest.fn() },
    git: {
      getRef: jest.fn(),
      getCommit: jest.fn(),
      createBlob: jest.fn(),
      createTree: jest.fn(),
      createCommit: jest.fn(),
      updateRef: jest.fn(),
    },
  };
  return { Octokit: jest.fn().mockImplementation(() => mockOctokit) };
});

jest.mock('../../lib/redis', () => ({
  redis: null,
  redisGet: jest.fn().mockResolvedValue(null), // always cache miss
  redisSetex: jest.fn().mockResolvedValue(undefined),
}));

import { Octokit } from '@octokit/rest';
import { redisGet, redisSetex } from '../../lib/redis';
import {
  getRepo,
  getIssues,
  getPulls,
  getCommits,
  getCommitFiles,
  getPullRequestFiles,
  listDirectory,
  getFileContent,
  commitFiles,
} from '../../services/githubService';

// Get the shared mock octokit instance
const mockOctokit = new (Octokit as any)() as any;

describe('getRepo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches and maps repo data', async () => {
    mockOctokit.repos.get.mockResolvedValue({
      data: {
        id: 123,
        full_name: 'acme/widget',
        description: 'A widget',
        stargazers_count: 42,
        forks_count: 5,
        open_issues_count: 3,
        html_url: 'https://github.com/acme/widget',
        default_branch: 'main',
        private: false,
      },
    });

    const result = await getRepo('acme', 'widget', null);

    expect(result).toEqual({
      id: 123,
      fullName: 'acme/widget',
      description: 'A widget',
      stars: 42,
      forks: 5,
      openIssues: 3,
      url: 'https://github.com/acme/widget',
      defaultBranch: 'main',
      private: false,
    });
    expect(redisSetex).toHaveBeenCalledWith(
      expect.stringContaining('gh:repo:acme:widget'),
      300,
      expect.any(String),
    );
  });

  it('returns cached result on cache hit', async () => {
    const cached = { id: 99, fullName: 'acme/cached' };
    (redisGet as jest.Mock).mockResolvedValueOnce(JSON.stringify(cached));

    const result = await getRepo('acme', 'cached');

    expect(result).toEqual(cached);
    expect(mockOctokit.repos.get).not.toHaveBeenCalled();
  });

  it('uses "pub" token suffix when no token provided', async () => {
    mockOctokit.repos.get.mockResolvedValue({ data: { id: 1, full_name: 'a/b', description: null, stargazers_count: 0, forks_count: 0, open_issues_count: 0, html_url: '', default_branch: 'main', private: false } });

    await getRepo('a', 'b');

    expect(redisGet).toHaveBeenCalledWith(expect.stringContaining(':pub'));
  });
});

describe('getIssues', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps issues and filters out pull requests', async () => {
    mockOctokit.issues.listForRepo.mockResolvedValue({
      data: [
        { number: 1, title: 'Real issue', state: 'open', html_url: 'u1', user: { login: 'alice' }, labels: [{ name: 'bug' }], created_at: '2024-01-01', pull_request: undefined },
        { number: 2, title: 'PR disguised as issue', state: 'open', html_url: 'u2', user: { login: 'bob' }, labels: [], created_at: '2024-01-02', pull_request: { url: 'x' } },
      ],
    });

    const result = await getIssues('acme', 'widget', 1, null);

    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(1);
    expect(result[0].labels).toEqual(['bug']);
  });
});

describe('getPulls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps pull request data', async () => {
    mockOctokit.pulls.list.mockResolvedValue({
      data: [
        { number: 10, title: 'Add feature', state: 'open', html_url: 'pu', user: { login: 'alice' }, draft: false, created_at: '2024-01-01' },
      ],
    });

    const result = await getPulls('acme', 'widget', 1, null);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ number: 10, title: 'Add feature', draft: false });
  });
});

describe('getCommits', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps commits truncating SHA to 8 chars and first line of message', async () => {
    mockOctokit.repos.listCommits.mockResolvedValue({
      data: [
        {
          sha: 'abcdef1234567890',
          commit: { message: 'Fix bug\n\nDetailed explanation', author: { name: 'Alice', date: '2024-01-01' } },
          html_url: 'https://github.com/acme/widget/commit/abcdef12',
        },
      ],
    });

    const result = await getCommits('acme', 'widget', 1, null);

    expect(result[0].sha).toBe('abcdef12');
    expect(result[0].message).toBe('Fix bug');
    expect(result[0].author).toBe('Alice');
  });
});

describe('getCommitFiles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns file diff list for a commit (not cached)', async () => {
    mockOctokit.repos.getCommit.mockResolvedValue({
      data: {
        files: [
          { filename: 'src/index.ts', status: 'modified', additions: 5, deletions: 2, patch: '@@ -1,2 +1,5 @@' },
        ],
      },
    });

    const result = await getCommitFiles('acme', 'widget', 'abc123', null);

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('src/index.ts');
    expect(result[0].patch).toBe('@@ -1,2 +1,5 @@');
    // Not cached
    expect(redisSetex).not.toHaveBeenCalled();
  });

  it('returns empty array when commit has no files', async () => {
    mockOctokit.repos.getCommit.mockResolvedValue({ data: { files: undefined } });

    const result = await getCommitFiles('acme', 'widget', 'abc123', null);
    expect(result).toHaveLength(0);
  });
});

describe('getPullRequestFiles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns file diff list for a PR', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [
        { filename: 'src/lib.ts', status: 'added', additions: 10, deletions: 0, patch: '+new line' },
      ],
    });

    const result = await getPullRequestFiles('acme', 'widget', 42, null);

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('src/lib.ts');
  });
});

describe('listDirectory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns directory entries', async () => {
    mockOctokit.repos.getContent.mockResolvedValue({
      data: [
        { name: 'index.ts', path: 'src/index.ts', type: 'file' },
        { name: 'utils', path: 'src/utils', type: 'dir' },
      ],
    });

    const result = await listDirectory('acme', 'widget', 'src', 'main', null);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'index.ts', path: 'src/index.ts', type: 'file' });
    expect(result[1].type).toBe('dir');
  });

  it('returns [] when path is a single file not a directory', async () => {
    mockOctokit.repos.getContent.mockResolvedValue({ data: { type: 'file', content: '' } });

    const result = await listDirectory('acme', 'widget', 'src/index.ts', 'main', null);
    expect(result).toHaveLength(0);
  });

  it('returns [] on error (path not found)', async () => {
    mockOctokit.repos.getContent.mockRejectedValue(new Error('Not found'));

    const result = await listDirectory('acme', 'widget', 'missing', 'main', null);
    expect(result).toHaveLength(0);
  });
});

describe('getFileContent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('decodes base64 content and returns it with SHA', async () => {
    const content = Buffer.from('export const x = 1;').toString('base64');
    mockOctokit.repos.getContent.mockResolvedValue({
      data: { type: 'file', content, sha: 'filesha123' },
    });

    const result = await getFileContent('acme', 'widget', 'src/x.ts', 'main', null);

    expect(result).not.toBeNull();
    expect(result!.content).toBe('export const x = 1;');
    expect(result!.sha).toBe('filesha123');
  });

  it('returns null when getContent returns a directory listing', async () => {
    mockOctokit.repos.getContent.mockResolvedValue({ data: [] });

    const result = await getFileContent('acme', 'widget', 'src', 'main', null);
    expect(result).toBeNull();
  });

  it('returns null when content is too large', async () => {
    const bigContent = Buffer.from('x'.repeat(200_000)).toString('base64');
    mockOctokit.repos.getContent.mockResolvedValue({
      data: { type: 'file', content: bigContent, sha: 'sha' },
    });

    const result = await getFileContent('acme', 'widget', 'big.ts', 'main', null, 100_000);
    expect(result).toBeNull();
  });

  it('returns null on error', async () => {
    mockOctokit.repos.getContent.mockRejectedValue(new Error('Not found'));

    const result = await getFileContent('acme', 'widget', 'missing.ts', 'main', null);
    expect(result).toBeNull();
  });
});

describe('commitFiles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates blobs, tree, commit, and updates branch ref', async () => {
    mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: 'headsha' } } });
    mockOctokit.git.getCommit.mockResolvedValue({ data: { tree: { sha: 'treesha' } } });
    mockOctokit.git.createBlob.mockResolvedValue({ data: { sha: 'blobsha' } });
    mockOctokit.git.createTree.mockResolvedValue({ data: { sha: 'newtreesha' } });
    mockOctokit.git.createCommit.mockResolvedValue({ data: { sha: 'newcommitsha' } });
    mockOctokit.git.updateRef.mockResolvedValue({});

    const sha = await commitFiles(
      'acme', 'widget', 'main',
      [{ path: 'src/test.ts', content: 'test content' }],
      'Add tests',
      null,
    );

    expect(sha).toBe('newcommitsha');
    expect(mockOctokit.git.createBlob).toHaveBeenCalledTimes(1);
    expect(mockOctokit.git.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Add tests', parents: ['headsha'] }),
    );
    expect(mockOctokit.git.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/main', sha: 'newcommitsha' }),
    );
  });
});
