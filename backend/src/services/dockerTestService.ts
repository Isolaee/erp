import { config } from '../config';

export async function startDockerTestRun(
  testRunId: string,
  owner: string,
  repo: string,
  sha: string,
  branch: string,
  token: string | null,
): Promise<void> {
  const callbackUrl = `${config.BACKEND_URL}/api/internal/test-complete/${testRunId}`;

  const response = await fetch(`${config.TEST_RUNNER_URL}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      testRunId,
      owner,
      repo,
      sha,
      branch,
      token,
      callbackUrl,
      secret: config.INTERNAL_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`Test runner rejected job: HTTP ${response.status}`);
  }
}
