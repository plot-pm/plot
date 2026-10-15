import { describe, it, expect } from 'vitest';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import { planStoreFixture, planRecord } from '@plot-pm/domain/adapters/plan-store/plan-store-fixture';
import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';
import type { CommitStatusWrite } from '@plot-pm/domain/ports/host';
import type { PortResult } from '@plot-pm/domain';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { perform, Refused, type Context } from '../../src/server/entry/approve.js';

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });
const HEAD = 'a'.repeat(40);
const SLUG = 'a-plan';
const FILE = `docs/plans/active/${SLUG}.md`;

/** A `Scripts` stub answering only the `## Plot Config` keys and `host()` calls this path reaches. */
const scriptsStub = (calls: string[][]): Scripts => ({
  planMeta: async () => answered(''),
  planMetaSync: () => answered(''),
  config: async (key, fallback) => answered(({
    'Plan directory': 'docs/plans/',
    'Active index': 'docs/plans/active/',
    'Sprint directory': 'docs/sprints/',
    People: 'jwloka=Jan Wloka',
  })[key] ?? fallback),
  configSync: (_key, fallback) => answered(fallback),
  agentSettings: async () => ({ stdout: '', stderr: '', code: 0 }),
  host: async (args) => {
    calls.push([...args]);
    // The merge call: recorded, then refused so the test never reaches the
    // booking-worktree write pipeline this ordering assertion does not need.
    if (args[0] === 'pr-merge') return { ok: false, why: 'failed' };
    return answered('');
  },
  hostSaid: async () => ({ answer: 'answered', stdout: '' }),
  awaited: async () => ({ stdout: '', stderr: '', code: 0 }),
  start: () => ({ pid: 0, started: false }),
  stream: async () => undefined,
  sourced: () => answered(''),
  pathOf: (script: string) => `/repo/skills/plot/scripts/${script}`,
} as unknown as Scripts);

/** A `Trees` stub: `originHead` answers so `resolveMain` never asks the host. */
const treesStub = (): Trees => ({
  originHead: async () => answered('main'),
  hasRef: async () => answered(false),
  fetch: async () => answered(undefined),
  hasStagedChanges: async () => answered(false),
} as unknown as Trees);

/** A fixture `Context` whose plan-PR lookup resolves on the FIRST ask (`idea/<slug>`), so `Refs` is never read. */
const ctxFor = (statuses: CommitStatusWrite[], calls: string[][]): Context => ({
  repoRoot: '/repo',
  scriptDir: '/repo/skills/plot/scripts',
  host: hostFixture({
    prs: [{
      number: 42, repo: '', head: `idea/${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
      draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
      url: '', author: '', headSha: HEAD,
    }],
    commitStatuses: statuses,
  }),
  planStore: planStoreFixture({
    files: { [FILE]: 'placeholder' },
    plans: [planRecord({
      file: FILE, phase: 'draft', review: 'pr', impl: 'own-branches', branches: ['feature/one'],
    })],
  }),
  refs: refsFixture(),
  scripts: scriptsStub(calls),
  trees: treesStub(),
});

describe('approve perform — plan-PR merge ordering', () => {
  it('writes plot/review on the PR head, naming the merged PR', async () => {
    const statuses: CommitStatusWrite[] = [];
    const calls: string[][] = [];
    const ctx = ctxFor(statuses, calls);

    await expect(
      perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {}),
    ).rejects.toThrow(Refused);

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ sha: HEAD, state: 'success', context: 'plot/review' });

    const mergeCallIndex = calls.findIndex((args) => args[0] === 'pr-merge');
    expect(mergeCallIndex).toBeGreaterThanOrEqual(0);
    expect(calls[mergeCallIndex]).toContain(String(42));
  });

  it('writes the status BEFORE calling pr-merge — a single combined sequence, not two independent facts', async () => {
    const sequence: string[] = [];
    const statuses: CommitStatusWrite[] = [];
    const calls: string[][] = [];
    const ctx = ctxFor(statuses, calls);
    const originalCommitStatus = ctx.host.commitStatus.bind(ctx.host);
    ctx.host.commitStatus = async (write) => {
      sequence.push('commitStatus');
      return originalCommitStatus(write);
    };
    const originalHost = ctx.scripts.host.bind(ctx.scripts);
    ctx.scripts.host = async (args, options) => {
      if (args[0] === 'pr-merge') sequence.push('pr-merge');
      return originalHost(args, options);
    };

    await expect(
      perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {}),
    ).rejects.toThrow(Refused);

    expect(sequence).toEqual(['commitStatus', 'pr-merge']);
  });

  it('refuses a plan-PR with no head SHA, and calls no pr-merge', async () => {
    const statuses: CommitStatusWrite[] = [];
    const calls: string[][] = [];
    const ctx = ctxFor(statuses, calls);
    ctx.host = hostFixture({
      prs: [{
        number: 42, repo: '', head: `idea/${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
        draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
        url: '', author: '', headSha: '',
      }],
      commitStatuses: statuses,
    });

    await expect(
      perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {}),
    ).rejects.toThrow(Refused);

    expect(calls.some((args) => args[0] === 'pr-merge')).toBe(false);
  });

  const withHead = (ctx: Context, statuses: CommitStatusWrite[], headSha: string, backend: string): void => {
    ctx.host = hostFixture({
      backend,
      prs: [{
        number: 42, repo: '', head: `idea/${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
        draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
        url: '', author: '', headSha,
      }],
      commitStatuses: statuses,
    });
  };

  it('merges a plan-PR with no head SHA on a host that cannot pin, and sends no pin', async () => {
    const statuses: CommitStatusWrite[] = [];
    const calls: string[][] = [];
    const ctx = ctxFor(statuses, calls);
    withHead(ctx, statuses, '', 'bitbucket');

    await expect(
      perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {}),
    ).rejects.toThrow(Refused);

    expect(calls.filter((args) => args[0] === 'pr-merge')).toEqual([['pr-merge', '42', '--delete-branch']]);
  });

  it('pins the merge to the head SHA on a host that can pin', async () => {
    const statuses: CommitStatusWrite[] = [];
    const calls: string[][] = [];
    const ctx = ctxFor(statuses, calls);
    withHead(ctx, statuses, HEAD, 'github');

    await expect(
      perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {}),
    ).rejects.toThrow(Refused);

    expect(calls.filter((args) => args[0] === 'pr-merge')).toEqual([['pr-merge', '42', '--match-head', HEAD, '--delete-branch']]);
  });
});
