import { describe, it, expect } from 'vitest';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import { planStoreFixture, planRecord } from '@plot-pm/domain/adapters/plan-store/plan-store-fixture';
import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';
import type { CommitStatusWrite, Host, HostRefusal } from '@plot-pm/domain/ports/host';
import type { PortResult } from '@plot-pm/domain';
import type { PlanStore } from '@plot-pm/domain/ports/plan-store';
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

/** A `Trees` stub for the `Impl: same branch` path: the plan's branch is local, and every write succeeds. */
const sameBranchTreesStub = (staged: string[][]): Trees => ({
  originHead: async () => answered('main'),
  hasRef: async (_root, ref) => answered(ref === `refs/heads/feature/${SLUG}`),
  fetch: async () => answered(undefined),
  hasStagedChanges: async () => answered(true),
  stage: async (_root, paths) => {
    staged.push([...paths]);
    return answered(undefined);
  },
  commitStaged: async () => answered(undefined),
  currentBranch: async () => answered(`feature/${SLUG}`),
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

  it('refuses a plan-PR with no head SHA on bitbucket too, which pins like every host', async () => {
    const statuses: CommitStatusWrite[] = [];
    const calls: string[][] = [];
    const ctx = ctxFor(statuses, calls);
    withHead(ctx, statuses, '', 'bitbucket');

    await expect(
      perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {}),
    ).rejects.toThrow(Refused);

    expect(calls.filter((args) => args[0] === 'pr-merge')).toEqual([]);
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

describe('approve perform — sprint annotation by sprintOfPlan, not by directory scan', () => {
  const SPRINT_FILE = 'docs/sprints/2026-10-20-w43.md';
  // `applyLocalWrites` and `annotateSprint` run on `ctx.repoRoot` directly for
  // the `Impl: same branch` path, with no booking worktree — so they build
  // absolute targets (`path.join(root, rel)`) the fixture must hold under.
  const ABS_PLAN = '/repo/docs/plans/active/a-plan.md';
  const ABS_SPRINT = `/repo/${SPRINT_FILE}`;
  const PLAN_TEXT = '# P\n\n## Status\n\n- **State:** Approved\n- **Approved:** 2026-10-01 by jw\n';

  /** The `Impl: same branch` path: no merge, so `applyLocalWrites` runs on `ctx.repoRoot` directly and reaches `annotateSprint`. */
  const ctxSameBranch = (files: Record<string, string>, staged: string[][]): Context => ({
    repoRoot: '/repo',
    scriptDir: '/repo/skills/plot/scripts',
    host: hostFixture({
      prs: [{
        number: 42, repo: '', head: `feature/${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
        draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
        url: '', author: '', headSha: HEAD,
      }],
      commitStatuses: [],
    }),
    planStore: planStoreFixture({
      files: Object.assign(files, { [FILE]: PLAN_TEXT, [ABS_PLAN]: PLAN_TEXT }),
      plans: [FILE, ABS_PLAN].map((file) => planRecord({
        file, phase: 'approved', review: 'pr', impl: 'same-branch', branches: [`feature/${SLUG}`], sprint: '',
        approvedRaw: '2026-10-01 by jw',
      })),
    }),
    refs: refsFixture(),
    scripts: scriptsStub([]),
    trees: sameBranchTreesStub(staged),
  });

  it('annotates the sprint item although the plan carries no Sprint: field', async () => {
    const staged: string[][] = [];
    const files: Record<string, string> = {
      [ABS_SPRINT]: ['### Must Have', '', `- [ ] [${SLUG}] the plan`, ''].join('\n'),
    };
    const ctx = ctxSameBranch(files, staged);

    await perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {});

    expect(files[ABS_SPRINT]).toContain(`pr: #42`);
    expect(staged.flat()).toContain(SPRINT_FILE);
  });
});

describe('approve perform — a refused open-PR listing is reported as a host refusal', () => {
  const REFUSAL_429: HostRefusal = { kind: 'failed', said: 'HTTP 429: rate limit exceeded' };

  /** Wraps a `hostFixture` so `prState(idea/<slug>)` answers "no PR", and `prList` refuses — the production report's host answers. */
  const hostRefusingOpenList = (): Host => {
    const base = hostFixture({});
    return {
      ...base,
      prState: async (ref) => (String(ref) === `idea/${SLUG}` ? { ok: true, value: null } : base.prState(ref)),
      prList: async () => ({ ok: false, why: 'failed' }),
      lastRefusal: (): HostRefusal | null => REFUSAL_429,
    };
  };

  /** A plan in the checkout (the idea-worktree shape): `findPlanFile` resolves it locally, so `perform` never reads `origin/<main>`. */
  const ctxInCheckout = (calls: string[][]): Context => ({
    repoRoot: '/repo',
    scriptDir: '/repo/skills/plot/scripts',
    host: hostRefusingOpenList(),
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

  it('reports the host refusal, not "no PR found", when pr-list refuses from the idea-worktree shape', async () => {
    const calls: string[][] = [];
    const ctx = ctxInCheckout(calls);

    let message = '';
    try {
      await perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {});
      expect.fail('expected perform() to throw Refused');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      message = (err as Error).message;
    }

    expect(message).toContain('the host could not list its open PRs');
    expect(message).toContain('HTTP 429: rate limit exceeded');
    expect(message).not.toContain('no PR found');
    expect(message).not.toContain('/plot-idea');
  });

  /** A plan not in the checkout (the default-branch shape): `findPlanFile` finds nothing locally, so `remotePlanOf` reads `origin/<main>` and, finding no plan there, lists the open PRs — where the refusal fires. */
  const ctxDefaultBranch = (calls: string[][]): Context => ({
    repoRoot: '/repo',
    scriptDir: '/repo/skills/plot/scripts',
    host: hostRefusingOpenList(),
    planStore: planStoreFixture({ files: {} }),
    refs: refsFixture(),
    scripts: scriptsStub(calls),
    trees: treesStub(),
  });

  it('reports the host refusal, not "no plan found", when pr-list refuses from the default-branch-checkout shape', async () => {
    const calls: string[][] = [];
    const ctx = ctxDefaultBranch(calls);

    let message = '';
    try {
      await perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {});
      expect.fail('expected perform() to throw Refused');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      message = (err as Error).message;
    }

    expect(message).toContain('the host could not list its open PRs');
    expect(message).toContain('HTTP 429: rate limit exceeded');
    expect(message).not.toContain('no plan found');
    expect(message).not.toContain('/plot-idea');
  });

  /**
   * `slice-unnamed` is computed from `readings.slices`, not `readings.pr`,
   * and the domain reaches it before `perform()` ever checks `hostRefusal`.
   * So it still surfaces first even while a host refusal is held — the one
   * true reason nothing could be decided comes after a plan-intrinsic
   * refusal, never ahead of it.
   */
  it('reports slice-unnamed, not a held host refusal, when a plan fact refuses first', async () => {
    const calls: string[][] = [];
    const ctx: Context = {
      repoRoot: '/repo',
      scriptDir: '/repo/skills/plot/scripts',
      host: hostRefusingOpenList(),
      planStore: planStoreFixture({
        files: { [FILE]: 'placeholder' },
        plans: [planRecord({
          file: FILE,
          phase: 'draft',
          review: 'pr',
          impl: 'own-branches',
          branches: ['feature/one'],
          slices: [{ name: '', branches: [{ branch: 'feature/one' }] }],
        })],
      }),
      refs: refsFixture(),
      scripts: scriptsStub(calls),
      trees: treesStub(),
    };

    let message = '';
    try {
      await perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {});
      expect.fail('expected perform() to throw Refused');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      message = (err as Error).message;
    }

    expect(message).toContain('under no slice heading');
    expect(message).not.toContain('the host could not list its open PRs');
  });
});

describe('approve perform — a plan found only on an open PR (the Bitbucket plain-arm shape)', () => {
  const PLAN_FILE = `docs/plans/${SLUG}.md`;
  const SHORT_SHA = 'c0ffeec0ffee';
  const FULL_SHA = `${SHORT_SHA}${'0'.repeat(40 - SHORT_SHA.length)}`;
  const PLAN_TEXT = '# P\n\n## Status\n\n- **State:** Draft\n- **Review:** pr\n- **Impl:** own branches\n';

  /**
   * `readPlanAt` writes the shown text to a scratch path it names itself
   * (a random temp directory plus the file's basename) and reads it back
   * through `planStore.readPlan`. A fixture keyed by the real plan path
   * cannot predict that scratch path, so this wraps the base fixture's
   * store to resolve any path by basename against the one registered plan.
   */
  const planStoreResolvingByBasename = (plan: ReturnType<typeof planRecord>): PlanStore => {
    const base = planStoreFixture({ files: {} });
    const basename = plan.file.slice(plan.file.lastIndexOf('/') + 1);
    return {
      ...base,
      readPlan: async (file) => (file.endsWith(`/${basename}`) || file === basename ? answered(plan) : base.readPlan(file)),
    };
  };

  /** A plan not in the checkout and not on the default branch, found only on the head of an open PR whose host-reported `headSha` is a short (12-hex) sha — the shape a Bitbucket `pr-list` row names. */
  const ctxOpenPrOnly = (calls: string[][]): Context => ({
    repoRoot: '/repo',
    scriptDir: '/repo/skills/plot/scripts',
    host: hostFixture({
      prs: [{
        number: 975, repo: '', head: `idea/batch-${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
        draft: true, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
        url: '', author: '', headSha: SHORT_SHA,
      }],
    }),
    planStore: planStoreResolvingByBasename(planRecord({
      file: PLAN_FILE, phase: 'draft', review: 'pr', impl: 'own-branches', branches: ['feature/one'],
    })),
    refs: refsFixture({
      shas: { [`${SHORT_SHA}^{commit}`]: FULL_SHA },
      changedFiles: { [FULL_SHA]: [PLAN_FILE] },
      files: { [`${FULL_SHA}:${PLAN_FILE}`]: PLAN_TEXT },
    }),
    scripts: scriptsStub(calls),
    trees: treesStub(),
  });

  it('resolves a short headSha to the full sha, finds the plan, and pins the merge to the full sha', async () => {
    const calls: string[][] = [];
    const ctx = ctxOpenPrOnly(calls);

    await expect(perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {})).rejects.toThrow(Refused);

    const readyCallIndex = calls.findIndex((args) => args[0] === 'pr-ready');
    expect(readyCallIndex).toBeGreaterThanOrEqual(0);
    expect(calls[readyCallIndex]).toContain(String(975));

    const mergeCallIndex = calls.findIndex((args) => args[0] === 'pr-merge');
    expect(mergeCallIndex).toBeGreaterThanOrEqual(0);
    expect(calls[mergeCallIndex]).toContain(String(975));
    const matchHeadIndex = calls[mergeCallIndex].indexOf('--match-head');
    expect(matchHeadIndex).toBeGreaterThanOrEqual(0);
    expect(calls[mergeCallIndex][matchHeadIndex + 1]).toBe(FULL_SHA);
  });
});

describe('approve perform — an open PR the host named with no head commit is named, not silently dropped', () => {
  /** A plan not in the checkout and not on the default branch; the only open PR is own-repo but carries no `headSha` — the shape that previously made `openPrsOf` drop it and report "no plan found". */
  const ctxUnreadOpenPr = (calls: string[][]): Context => ({
    repoRoot: '/repo',
    scriptDir: '/repo/skills/plot/scripts',
    host: hostFixture({
      prs: [{
        number: 975, repo: '', head: `idea/batch-${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
        draft: false, mergeable: 'unknown', review: 'none', checks: 'unknown', failingChecks: [],
        url: '', author: '',
      }],
    }),
    planStore: planStoreFixture({ files: {} }),
    refs: refsFixture(),
    scripts: scriptsStub(calls),
    trees: treesStub(),
  });

  it('names the unread PR in the plan-not-found refusal', async () => {
    const calls: string[][] = [];
    const ctx = ctxUnreadOpenPr(calls);

    let message = '';
    try {
      await perform(ctx, { dryRun: false, spike: false, who: 'jwloka', slug: SLUG }, () => {}, () => {});
      expect.fail('expected perform() to throw Refused');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      message = (err as Error).message;
    }

    expect(message).toContain('no plan found');
    expect(message).toContain('#975');
    expect(message).toContain('the host named no head commit');
  });
});
