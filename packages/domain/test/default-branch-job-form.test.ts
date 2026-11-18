import { describe, expect, it } from 'vitest';

import { buildActions } from '../src/adapters/build/build-actions.js';
import { buildFor } from '../src/adapters/build/build-resolve.js';
import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { apiForReads, recordHostReads } from '../src/adapters/host/process-host-reads.js';
import type { GithubApi, GithubAnswer, GithubRequest } from '../src/adapters/host/github-api.js';
import type { WorkflowShaRun } from '../src/entities/build.js';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '../src/entities/repair-record.js';
import { repairMergeVerdict } from '../src/rules/repair-pr.js';
import { readRepair } from '../src/workflows/merge.js';
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
    expect(workflowOfCheck('folder/job', false)).toBe('folder/job');
  });
});

describe('workflowOfCheck', () => {
  it.each([
    ['CI/validate', true, 'CI'],
    ['CI', true, 'CI'],
    ['CI/validate', false, 'CI/validate'],
  ])('%s with job form %s is %s', (name, jobForm, workflow) => {
    expect(workflowOfCheck(name, jobForm)).toBe(workflow);
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

  it("adds the declared job beside the run, with the job's end and the run's start, in one jobs read", async () => {
    const { api, jobsReads } = apiThat(answered);
    const read = await buildActions(CONTEXT, api).runsForSha('main', 'abc', ['CI/validate']);
    expect(read.ok && read.value.map((run) => run.workflow)).toEqual(['CI', 'CI/validate']);
    const job = read.ok ? read.value[1] : undefined;
    expect(job).toMatchObject({ conclusion: 'success', completedAt: '2026-11-17T10:16:10Z', startedAt: '2026-11-17T10:00:00Z' });
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

describe('the repair read of a red commit under the job form', () => {
  const red = {
    ok: true,
    reply: {
      status: 200,
      headers: {},
      body: {
        jobs: [
          { name: 'validate', status: 'completed', conclusion: 'failure', html_url: 'j', started_at: '2026-11-17T10:00:10Z', completed_at: '2026-11-17T10:16:10Z' },
        ],
      },
    },
  } as GithubAnswer;

  it('folds red through the connector a merge arm builds over the composed client', async () => {
    const { api } = apiThat(red);
    const root: ShellContext = { repoRoot: '/nonexistent/repair-job-form', scriptDir: '/nonexistent' };
    recordHostReads(root.repoRoot, hostFixture({}), api);
    const read = await buildFor('github-actions', root, apiForReads(root)).runsForSha('main', 'abc', ['CI/validate']);
    expect(read.ok && foldRuns(declaredRuns(read.value, ['CI/validate']))).toBe('red');
  });

  it('reads the red commit red in readRepair, so the repair PR is admitted', async () => {
    const { api } = apiThat(red);
    const root: ShellContext = { repoRoot: '/nonexistent/repair-job-form-admit', scriptDir: '/nonexistent' };
    recordHostReads(root.repoRoot, hostFixture({}), api);
    const green = 'a'.repeat(40);
    const record: RepairRecord = {
      v: REPAIR_RECORD_VERSION,
      branch: 'main',
      state: 'idle',
      lastGreenSha: green,
      firstRedSha: 'abc',
      redSince: '2026-11-17T10:00:00Z',
      candidates: [],
      rerun: 'none',
      preRevertRerun: 'none',
      at: '2026-11-17T10:00:00Z',
      repairPr: 42,
    };
    const ports = {
      repair: { read: async () => ({ ok: true as const, value: record }) },
      refs: { firstParentLine: async () => ({ ok: true as const, value: ['abc'] }) },
      build: buildFor('github-actions', root, apiForReads(root)),
      checks: ['CI/validate'],
    };
    const reading = await readRepair(ports as never, 'main', { sha: 'abc', state: 'red' }, 42);
    expect(reading.redRuns).toBe('red');
    expect(repairMergeVerdict(reading, { number: 42, head: `bug/main-repair-${green.slice(0, 12)}` })).toEqual({ verdict: 'admitted', role: 'repair' });
  });
});
