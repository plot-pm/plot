import { describe, expect, it } from 'vitest';

import { buildActions } from '../src/adapters/build/build-actions.js';
import type { GithubAnswer, GithubApi, GithubRequest } from '../src/adapters/host/github-api.js';
import type { ShellContext } from '../src/adapters/scripts.js';

const FIRST_RED = '35539a20c'.padEnd(40, '0');
const LATER_RED = '501d32861'.padEnd(40, '0');

const reply = (body: unknown): GithubAnswer => ({ ok: true, reply: { status: 200, headers: {}, body } }) as GithubAnswer;

const job = (name: string, conclusion: string): Record<string, string> => ({
  name,
  status: 'completed',
  conclusion,
  html_url: `job-${name}`,
  started_at: '2026-11-06T10:00:10Z',
  completed_at: '2026-11-06T10:16:10Z',
});

/** Two failed runs of the one `CI` workflow, each failing in another job. */
const api = {
  origin: { host: 'github.com', slug: 'o/r' },
  request: async (request: GithubRequest): Promise<GithubAnswer> => {
    if (request.path.includes('/runs/1/jobs')) return reply({ jobs: [job('board-integration', 'failure'), job('validate', 'failure')] });
    if (request.path.includes('/runs/2/jobs')) return reply({ jobs: [job('ports-real-state', 'failure'), job('validate', 'failure')] });
    if (request.path.includes('/actions/workflows')) return reply({ total_count: 1, workflows: [{ id: 1, name: 'CI' }] });
    return reply({
      workflow_runs: [
        { id: 2, workflow_id: 1, head_sha: LATER_RED, status: 'completed', conclusion: 'failure', run_started_at: '2026-11-06T10:43:00Z', html_url: 'run-2' },
        { id: 1, workflow_id: 1, head_sha: FIRST_RED, status: 'completed', conclusion: 'failure', run_started_at: '2026-11-06T10:18:00Z', html_url: 'run-1' },
      ],
    });
  },
} as unknown as GithubApi;

const CONTEXT: ShellContext = { repoRoot: '/nonexistent', scriptDir: '/nonexistent' };

describe('buildActions.runsForSha — failing job names under one declared check', () => {
  it('lets a reader tell two failed runs of one workflow apart by their failing jobs', async () => {
    const build = buildActions(CONTEXT, api);
    const first = await build.runsForSha('main', FIRST_RED, ['CI/validate']);
    const later = await build.runsForSha('main', LATER_RED, ['CI/validate']);
    expect(first.ok && later.ok).toBe(true);
    // The probe: is any failing job name other than the declared one readable off the listing?
    expect(JSON.stringify(first.ok ? first.value : null)).toContain('board-integration');
    expect(JSON.stringify(later.ok ? later.value : null)).toContain('ports-real-state');
  });
});
