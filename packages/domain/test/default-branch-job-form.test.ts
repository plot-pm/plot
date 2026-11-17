import { describe, expect, it } from 'vitest';

import { buildActions } from '../src/adapters/build/build-actions.js';
import type { GithubApi, GithubAnswer, GithubRequest } from '../src/adapters/host/github-api.js';
import type { WorkflowShaRun } from '../src/entities/build.js';
import type { ShellContext } from '../src/adapters/scripts.js';
import { declaredRuns, foldRuns, unmatchedChecks, workflowOfCheck } from '../src/rules/default-branch.js';

const entry = (workflow: string, conclusion: string | null, status = 'completed'): WorkflowShaRun =>
  ({ sha: 's', status, conclusion, url: 'u', startedAt: '', workflow }) as WorkflowShaRun;

describe('Default branch checks — the job form', () => {
  it('reads a census failure beside a green validate as green under CI/validate and red under CI', () => {
    const runs = [entry('CI', 'failure'), entry('CI/validate', 'success')];
    expect(foldRuns(declaredRuns(runs, ['CI/validate']))).toBe('green');
    expect(foldRuns(declaredRuns(runs, ['CI']))).toBe('red');
  });

  it('reads a job no entry names as unknown and reports it', () => {
    const runs = [entry('CI', 'success'), entry('CI/validate', 'success')];
    expect(foldRuns(declaredRuns(runs, ['CI/nope']))).toBe('unknown');
    expect(unmatchedChecks(runs, ['CI/nope', 'CI/validate'])).toEqual(['CI/nope']);
  });

  it('matches a Jenkins job path that contains a slash as a whole name', () => {
    const runs = [entry('folder/job', 'success')];
    expect(declaredRuns(runs, ['folder/job'])).toEqual(runs);
    expect(unmatchedChecks(runs, ['folder/job'])).toEqual([]);
    expect(workflowOfCheck('folder/job', 'jenkins')).toBe('folder/job');
  });
});

describe('workflowOfCheck', () => {
  it.each([
    ['CI/validate', 'github-actions', 'CI'],
    ['CI', 'github-actions', 'CI'],
    ['CI/validate', 'jenkins', 'CI/validate'],
  ])('%s under %s is %s', (name, system, workflow) => {
    expect(workflowOfCheck(name, system)).toBe(workflow);
  });
});

/** A client that answers the three paths one `runsForSha` read asks, and counts the jobs reads. */
const apiThat = (jobsReply: GithubAnswer): { api: GithubApi; jobsReads: () => number } => {
  let jobs = 0;
  const reply = (body: unknown): GithubAnswer => ({ ok: true, reply: { status: 200, headers: {}, body } });
  const api = {
    origin: { host: 'github.com', slug: 'o/r' },
    request: async (request: GithubRequest): Promise<GithubAnswer> => {
      if (request.path.includes('/jobs')) {
        jobs += 1;
        return jobsReply;
      }
      if (request.path.includes('/actions/workflows')) return reply({ total_count: 1, workflows: [{ id: 1, name: 'CI' }] });
      return reply({
        workflow_runs: [
          { id: 77, workflow_id: 1, head_sha: 'abc', status: 'in_progress', conclusion: null, run_started_at: '2026-11-17T10:00:00Z', html_url: 'run-url' },
        ],
      });
    },
  } as unknown as GithubApi;
  return { api, jobsReads: () => jobs };
};

const CONTEXT: ShellContext = { repoRoot: '/nonexistent', scriptDir: '/nonexistent' };

describe('buildActions.runsForSha — job entries', () => {
  const jobs = {
    jobs: [
      { name: 'gates', status: 'completed', conclusion: 'success', html_url: 'g', started_at: '2026-11-17T10:00:10Z', completed_at: '2026-11-17T10:01:00Z' },
      { name: 'validate', status: 'completed', conclusion: 'success', html_url: 'j', started_at: '2026-11-17T10:00:10Z', completed_at: '2026-11-17T10:16:10Z' },
    ],
  };
  const answered = { ok: true, reply: { status: 200, headers: {}, body: jobs } } as GithubAnswer;

  it('adds the declared job beside the run, with its own times, in one jobs read', async () => {
    const { api, jobsReads } = apiThat(answered);
    const read = await buildActions(CONTEXT, api).runsForSha('main', 'abc', ['CI/validate']);
    expect(read.ok && read.value.map((run) => run.workflow)).toEqual(['CI', 'CI/validate']);
    const job = read.ok ? read.value[1] : undefined;
    expect(job).toMatchObject({ conclusion: 'success', completedAt: '2026-11-17T10:16:10Z', startedAt: '2026-11-17T10:00:10Z' });
    expect(jobsReads()).toBe(1);
  });

  it('reads no jobs for a bare workflow name or no declared names', async () => {
    const { api, jobsReads } = apiThat(answered);
    await buildActions(CONTEXT, api).runsForSha('main', 'abc', ['CI']);
    await buildActions(CONTEXT, api).runsForSha('main', 'abc');
    expect(jobsReads()).toBe(0);
  });

  it('adds no entry for a job the run does not carry, so the name folds unknown', async () => {
    const { api } = apiThat(answered);
    const read = await buildActions(CONTEXT, api).runsForSha('main', 'abc', ['CI/nope']);
    expect(read.ok && foldRuns(declaredRuns(read.value, ['CI/nope']))).toBe('unknown');
  });

  it('answers unaskable where the jobs read fails, never an answer without the job', async () => {
    const refused = { ok: false, refusal: { kind: 'failed', said: 'HTTP 502' }, reply: null } as GithubAnswer;
    const { api } = apiThat(refused);
    const connector = buildActions(CONTEXT, api);
    expect(await connector.runsForSha('main', 'abc', ['CI/validate'])).toMatchObject({ ok: false, why: 'unaskable' });
    expect(connector.lastRefusal()).toBe('HTTP 502');
  });
});
