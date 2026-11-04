import { describe, it, expect } from 'vitest';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import { planStoreFixture } from '@plot-pm/domain/adapters/plan-store/plan-store-fixture';
import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';
import type { PortResult } from '@plot-pm/domain';
import type { PlanStore, PlanRecord } from '@plot-pm/domain/ports/plan-store';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { perform, Refused, type Context } from '../../src/server/entry/needs-design.js';

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });
const SLUG = 'a-plan';
const PLAN_FILE = `docs/plans/${SLUG}.md`;
const HEAD = 'a'.repeat(40);
const RIVAL_HEAD = 'b'.repeat(40);
const PLAN_TEXT = '# P\n\n## Status\n\n- **State:** Draft\n- **Review:** pr\n- **Impl:** own branches\n';
const RIVAL_TEXT = '# P (rival copy)\n\n## Status\n\n- **State:** Draft\n- **Review:** pr\n- **Impl:** own branches\n';

/** A `Scripts` stub answering only the `## Plot Config` keys this path reaches. */
const scriptsStub = (): Scripts => ({
  config: async (key, fallback) => answered(({
    'Plan directory': 'docs/plans/',
    'Active index': 'docs/plans/active/',
  })[key] ?? fallback),
} as unknown as Scripts);

/** A `Trees` stub: `originHead` answers so `resolveMain` never asks the host; `fetch`/`addBranch`/`push` never reached when the test expects a refusal first. */
const treesStub = (overrides: Partial<Trees> = {}): Trees => ({
  originHead: async () => answered('main'),
  fetch: async () => answered(undefined),
  userName: async () => answered('jwloka'),
  mainRoot: async () => answered('/repo'),
  excludePath: async () => answered(undefined),
  ...overrides,
} as unknown as Trees);

/**
 * `readPlanAt` writes the shown text to a scratch path it names itself (a
 * random temp directory plus the file's basename) and reads it back through
 * `planStore.readPlan`. A fixture keyed by the real plan path cannot predict
 * that scratch path, so this wraps the base fixture's store to resolve any
 * path by basename against the one registered plan.
 */
const planStoreResolvingByBasename = (plan: PlanRecord): PlanStore => {
  const base = planStoreFixture({ files: {} });
  const basename = plan.file.slice(plan.file.lastIndexOf('/') + 1);
  return {
    ...base,
    readPlan: async (file) => (file.endsWith(`/${basename}`) || file === basename ? answered(plan) : base.readPlan(file)),
  };
};

const planRecordFor = (file: string): PlanRecord => ({
  file,
  format: 'canonical',
  phase: 'draft',
  phaseRaw: 'Draft',
  type: '',
  title: '',
  sprint: '',
  story: '',
  assignee: '',
  branches: [],
  prs: [],
  deferredPrs: [],
  slices: [],
  review: 'pr',
  impl: 'own-branches',
  approvedRaw: '',
  spikeApprovedRaw: '',
  deliveredRaw: '',
  releasedRaw: '',
  startedRaw: [],
  rejectedRaw: '',
  unreadBranchItems: [],
});

describe('needs-design perform — a rival open PR with a differing copy refuses pr-copies-differ', () => {
  it('refuses and pushes nothing', async () => {
    const pushed: string[] = [];
    const ctx: Context = {
      repoRoot: '/repo',
      scriptDir: '/repo/skills/plot/scripts',
      host: hostFixture({
        prs: [
          {
            number: 42, repo: '', head: `idea/${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
            draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
            url: '', author: '', headSha: HEAD,
          },
          {
            number: 43, repo: '', head: `idea/batch-${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
            draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
            url: '', author: '', headSha: RIVAL_HEAD,
          },
        ],
      }),
      planStore: planStoreResolvingByBasename(planRecordFor(PLAN_FILE)),
      refs: refsFixture({
        shas: { [`${HEAD}^{commit}`]: HEAD, [`${RIVAL_HEAD}^{commit}`]: RIVAL_HEAD },
        changedFiles: { [HEAD]: [PLAN_FILE], [RIVAL_HEAD]: [PLAN_FILE] },
        files: { [`${HEAD}:${PLAN_FILE}`]: PLAN_TEXT, [`${RIVAL_HEAD}:${PLAN_FILE}`]: RIVAL_TEXT },
      }),
      scripts: scriptsStub(),
      trees: treesStub({
        addBranch: async () => { throw new Error('must not reach a booking worktree'); },
        push: async () => { pushed.push('push'); return answered(undefined); },
      }),
    };

    await expect(
      perform(ctx, { who: 'jwloka', slug: SLUG, channel: 'board' }, () => {}, () => {}),
    ).rejects.toThrow(Refused);

    expect(pushed).toHaveLength(0);
  });
});

describe('needs-design perform — idea/<slug> closed with another open PR carrying the plan refuses plan-pr-absent', () => {
  it('refuses rather than writing onto the other PR', async () => {
    const pushed: string[] = [];
    const ctx: Context = {
      repoRoot: '/repo',
      scriptDir: '/repo/skills/plot/scripts',
      host: hostFixture({
        prs: [
          {
            number: 42, repo: '', head: `idea/${SLUG}`, state: 'CLOSED', mergedAt: null, mergeCommit: '',
            draft: false, mergeable: 'unknown', review: 'none', checks: 'unknown', failingChecks: [],
            url: '', author: '',
          },
          {
            number: 43, repo: '', head: `idea/batch-${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
            draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
            url: '', author: '', headSha: RIVAL_HEAD,
          },
        ],
      }),
      planStore: planStoreFixture({ files: {} }),
      refs: refsFixture({
        shas: { [`${RIVAL_HEAD}^{commit}`]: RIVAL_HEAD },
        changedFiles: { [RIVAL_HEAD]: [PLAN_FILE] },
      }),
      scripts: scriptsStub(),
      trees: treesStub({
        addBranch: async () => { throw new Error('must not reach a booking worktree'); },
        push: async () => { pushed.push('push'); return answered(undefined); },
      }),
    };

    let message = '';
    try {
      await perform(ctx, { who: 'jwloka', slug: SLUG, channel: 'board' }, () => {}, () => {});
      expect.fail('expected perform() to throw Refused');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toMatch(/plan-pr-absent|is closed, not open/);
    expect(message).toMatch(/#42/);
    expect(pushed).toHaveLength(0);
  });
});

describe('needs-design perform — origin/<head> moved between the read and the booking fetch', () => {
  it('refuses and pushes nothing', async () => {
    const pushed: string[] = [];
    const ctx: Context = {
      repoRoot: '/repo',
      scriptDir: '/repo/skills/plot/scripts',
      host: hostFixture({
        prs: [{
          number: 42, repo: '', head: `idea/${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
          draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
          url: '', author: '', headSha: HEAD,
        }],
      }),
      planStore: planStoreResolvingByBasename(planRecordFor(PLAN_FILE)),
      refs: refsFixture({
        // The booking fetch resolves `refs/remotes/origin/idea/<slug>` to a sha
        // that differs from the one the record was read at (HEAD) — the shape
        // of a push landing between the read and the write.
        shas: {
          [`${HEAD}^{commit}`]: HEAD,
          [`refs/remotes/origin/idea/${SLUG}`]: RIVAL_HEAD,
        },
        changedFiles: { [HEAD]: [PLAN_FILE] },
        files: { [`${HEAD}:${PLAN_FILE}`]: PLAN_TEXT },
      }),
      scripts: scriptsStub(),
      trees: treesStub({
        addBranch: async () => { throw new Error('must not reach a booking worktree'); },
        push: async () => { pushed.push('push'); return answered(undefined); },
      }),
    };

    let message = '';
    try {
      await perform(ctx, { who: 'jwloka', slug: SLUG, channel: 'board' }, () => {}, () => {});
      expect.fail('expected perform() to throw Refused');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toMatch(/moved since the plan was read/);
    expect(pushed).toHaveLength(0);
  });
});
