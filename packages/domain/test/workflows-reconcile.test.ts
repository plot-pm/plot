import { describe, it, expect } from 'vitest';
import {
  reconcile,
  type PlanDrift,
  type ReconcileReadings,
  type SprintDrift,
} from '../src/workflows/index.js';
import { decided, refused } from '../src/workflows/decision.js';
import type { Worktree } from '../src/entities/worktree.js';

/**
 * A plan with nothing wrong with it.
 *
 * Every drift is opted INTO, so a test naming one condition is a test about
 * that condition — the same reason `workflows-reap.test.ts` defaults `hasLog`
 * to false.
 */
const plan = (over: Partial<PlanDrift> = {}): PlanDrift => ({
  slug: 'a-plan',
  phaseSymlinkDrift: false,
  mergedNotDelivered: false,
  concurrentDelivery: false,
  attention: '',
  deliveredNotReleased: false,
  ...over,
});

const sprint = (over: Partial<SprintDrift> = {}): SprintDrift => ({
  slug: 'a-sprint',
  members: ['a-plan'],
  staleTally: [],
  shippedRelease: '',
  ...over,
});

const desk = (over: Partial<Worktree> = {}): Worktree => ({
  path: '/repo/.worktrees/one',
  branch: 'feature/one',
  detached: false,
  isMain: false,
  clean: true,
  agentSession: 'sess-1',
  prunable: false,
  ...over,
});

/** A finished desk: merged, nothing running, clean, unblocked. */
const finishedDesk = (over: Partial<Worktree> = {}) => ({
  tree: desk(over),
  evidence: {
    workerAlive: false,
    blockedMarker: false,
    hasMergedPr: true,
    isDispatchTree: true,
    manifest: '.plot/agents/sess-1.json',
    hasLog: false,
  },
});

const estate = (over: Partial<ReconcileReadings> = {}): ReconcileReadings => ({
  plans: [plan()],
  sprints: [sprint()],
  branches: [],
  claims: [],
  trees: [],
  desks: { candidates: [], orphanedManifests: [], defaultBranch: 'main' },
  ...over,
});

describe('reconcile — a scope naming nothing is refused', () => {
  it('refuses a plan scope no reading holds, rather than answering empty', () => {
    const out = reconcile(estate(), { kind: 'plan', slug: 'no-such' });
    expect(refused(out)).toBe(true);
    if (!refused(out)) return;
    expect(out.reason).toBe('no-such-plan');
    expect(out.workflow).toBe('reconcile');
  });

  it('refuses a sprint scope no reading holds', () => {
    const out = reconcile(estate(), { kind: 'sprint', slug: 'no-such' });
    expect(refused(out)).toBe(true);
    if (!refused(out)) return;
    expect(out.reason).toBe('no-such-sprint');
  });

  it('says WHY an empty answer would have been wrong, for the person reading it', () => {
    const out = reconcile(estate(), { kind: 'plan', slug: 'no-such' });
    if (!refused(out)) throw new Error('expected a refusal');
    expect(out.detail).toContain('no-such');
    expect(out.detail).toContain('nothing has drifted');
  });

  // The workspace scope names nothing, so it can never be refused — and an
  // estate with no plans at all is a legitimately empty answer rather than a
  // scope that failed to resolve.
  it('never refuses the workspace scope, which names nothing to miss', () => {
    const out = reconcile(estate({ plans: [], sprints: [] }), { kind: 'workspace' });
    expect(decided(out)).toBe(true);
  });
});

describe('reconcile — the three scopes answer differently for one estate', () => {
  const wide = estate({
    plans: [plan({ mergedNotDelivered: true }), plan({ slug: 'other-plan', attention: 'no phase' })],
    sprints: [sprint({ members: ['a-plan'], shippedRelease: 'v2.13.0' })],
    desks: {
      candidates: [finishedDesk()],
      orphanedManifests: [],
      defaultBranch: 'main',
    },
  });

  it('reports one plan’s drift at a plan scope and not the estate’s', () => {
    const out = reconcile(wide, { kind: 'plan', slug: 'a-plan' });
    if (!decided(out)) throw new Error('expected a decision');
    expect(out.detail.findings.map((f) => f.subject)).toEqual(['a-plan']);
  });

  it('reports the sprint’s own facts plus its members’, and no others', () => {
    const out = reconcile(wide, { kind: 'sprint', slug: 'a-sprint' });
    if (!decided(out)) throw new Error('expected a decision');
    const kinds = out.detail.findings.map((f) => f.kind);
    expect(kinds).toContain('merged-not-delivered'); // its member plan's
    expect(kinds).toContain('sprint-outlived-release'); // the sprint's own
    expect(kinds).not.toContain('needs-attention'); // the non-member plan's
  });

  it('reports desks at the workspace scope and at neither narrower one', () => {
    const kindsAt = (scope: Parameters<typeof reconcile>[1]) => {
      const out = reconcile(wide, scope);
      if (!decided(out)) throw new Error('expected a decision');
      return out.detail.findings.map((f) => f.kind);
    };
    expect(kindsAt({ kind: 'workspace' })).toContain('worktree');
    expect(kindsAt({ kind: 'plan', slug: 'a-plan' })).not.toContain('worktree');
    expect(kindsAt({ kind: 'sprint', slug: 'a-sprint' })).not.toContain('worktree');
  });

  // The property the plan states: a scope is not a filter over one output. If
  // it were, the three answers would be subsets of one list and this would hold
  // by construction — the sprint's own findings are what break that.
  it('gives the sprint scope a finding no plan scope can reach', () => {
    const perPlan = reconcile(wide, { kind: 'plan', slug: 'a-plan' });
    const perSprint = reconcile(wide, { kind: 'sprint', slug: 'a-sprint' });
    if (!decided(perPlan) || !decided(perSprint)) throw new Error('expected decisions');
    expect(perPlan.detail.findings.map((f) => f.kind)).not.toContain('sprint-outlived-release');
    expect(perSprint.detail.findings.map((f) => f.kind)).toContain('sprint-outlived-release');
  });
});

describe('reconcile — it performs nothing', () => {
  it('carries no write at any scope, even where reap decided several', () => {
    const withDesks = estate({
      desks: {
        candidates: [finishedDesk(), finishedDesk({ path: '/repo/.worktrees/two' })],
        orphanedManifests: [{ file: '.plot/agents/gone.json', worktree: '/repo/.worktrees/gone' }],
        defaultBranch: 'main',
      },
    });
    for (const scope of [
      { kind: 'workspace' } as const,
      { kind: 'plan', slug: 'a-plan' } as const,
      { kind: 'sprint', slug: 'a-sprint' } as const,
    ]) {
      const out = reconcile(withDesks, scope);
      if (!decided(out)) throw new Error('expected a decision');
      expect(out.writes).toEqual([]);
    }
  });

  it('names the repair as text and never as a write', () => {
    const out = reconcile(
      estate({ desks: { candidates: [finishedDesk()], orphanedManifests: [], defaultBranch: 'main' } }),
      { kind: 'workspace' },
    );
    if (!decided(out)) throw new Error('expected a decision');
    const found = out.detail.findings.find((f) => f.kind === 'worktree');
    expect(found?.repair).toBe('git worktree remove /repo/.worktrees/one');
    expect(out.writes).toEqual([]);
  });
});

describe('reconcile — which desks are drift and which are noise', () => {
  const deskEstate = (candidate: ReturnType<typeof finishedDesk>) =>
    estate({ desks: { candidates: [candidate], orphanedManifests: [], defaultBranch: 'main' } });

  const deskFindings = (candidate: ReturnType<typeof finishedDesk>) => {
    const out = reconcile(deskEstate(candidate), { kind: 'workspace' });
    if (!decided(out)) throw new Error('expected a decision');
    return out.detail.findings.filter((f) => f.kind === 'worktree');
  };

  it('does not report a desk a live worker sits at — a finding nobody can act on', () => {
    const live = { ...finishedDesk(), evidence: { ...finishedDesk().evidence, workerAlive: true } };
    expect(deskFindings(live)).toEqual([]);
  });

  it('does not report a merely unfinished desk, which is every active branch', () => {
    const unfinished = {
      ...finishedDesk(),
      evidence: { ...finishedDesk().evidence, hasMergedPr: false },
    };
    expect(deskFindings(unfinished)).toEqual([]);
  });

  // The case that strands finished code: measured twice on 2026-09-09, one desk
  // held 75 finished lines and another 324, both rescued by a person.
  it('reports a dirty desk as NEEDING A PERSON and offers no command', () => {
    const dirty = finishedDesk({ clean: false });
    const [finding] = deskFindings(dirty);
    expect(finding?.evidence).toContain('uncommitted-changes');
    expect(finding?.repair).toBe('');
  });

  it('reports a blocked desk, which is an agent waiting on an answer', () => {
    const blocked = {
      ...finishedDesk(),
      evidence: { ...finishedDesk().evidence, blockedMarker: true },
    };
    expect(deskFindings(blocked)[0]?.evidence).toContain('blocked-marker');
  });

  it('names the desk path, because the repair is per-directory', () => {
    expect(deskFindings(finishedDesk())[0]?.subject).toBe('/repo/.worktrees/one');
  });

  // reap()'s own population boundary, carried through rather than re-decided.
  it('says nothing about a hand-made worktree, which is not this population', () => {
    const handMade = {
      ...finishedDesk(),
      evidence: { ...finishedDesk().evidence, isDispatchTree: false },
    };
    expect(deskFindings(handMade)).toEqual([]);
  });
});

describe('reconcile — each plan drift names its own repair', () => {
  const only = (over: Partial<PlanDrift>) => {
    const out = reconcile(estate({ plans: [plan(over)] }), { kind: 'plan', slug: 'a-plan' });
    if (!decided(out)) throw new Error('expected a decision');
    return out.detail.findings;
  };

  it('reports a plan whose phase and index symlink disagree', () => {
    const [f] = only({ phaseSymlinkDrift: true });
    expect(f?.kind).toBe('phase-symlink-drift');
    expect(f?.repair).toBe('/plot-reconcile --plan a-plan');
    expect(f?.blocking).toBe(true);
  });

  // Two plans mid-delivery is a collision a person resolves — naming a command
  // would be naming one of the two, which is the judgement this does not make.
  it('reports a concurrent delivery and offers no command', () => {
    const [f] = only({ concurrentDelivery: true });
    expect(f?.kind).toBe('concurrent-delivery');
    expect(f?.repair).toBe('');
    expect(f?.blocking).toBe(true);
  });

  it('reports a delivered plan whose release is tagged, and names the release', () => {
    const [f] = only({ deliveredNotReleased: true });
    expect(f?.kind).toBe('delivered-not-released');
    expect(f?.repair).toBe('/plot-release a-plan');
  });

  // What the scan could not parse is carried through as the evidence, never
  // summarised: the sentence is the half a person acts on.
  it('carries the scan’s own words for a plan needing attention', () => {
    const [f] = only({ attention: 'no State: field' });
    expect(f?.kind).toBe('needs-attention');
    expect(f?.evidence).toBe('no State: field');
  });
});

describe('reconcile — what blocks a delivery', () => {
  it('counts the blocking findings so a gate asks one field', () => {
    const out = reconcile(
      estate({ plans: [plan({ mergedNotDelivered: true, attention: 'no phase' })] }),
      { kind: 'plan', slug: 'a-plan' },
    );
    if (!decided(out)) throw new Error('expected a decision');
    expect(out.detail.blocking).toBe(2);
  });

  it('orders blocking findings first, whatever order they were read in', () => {
    const out = reconcile(
      estate({
        plans: [plan({ mergedNotDelivered: true })],
        sprints: [sprint({ shippedRelease: 'v2.13.0' })],
      }),
      { kind: 'sprint', slug: 'a-sprint' },
    );
    if (!decided(out)) throw new Error('expected a decision');
    const flags = out.detail.findings.map((f) => f.blocking);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
  });

  // A sprint's own drift is a report, never a gate: a shipped release says the
  // sprint's window passed, not that its work is done, so a person closes it.
  it('never blocks on a sprint’s own drift', () => {
    const out = reconcile(
      estate({ sprints: [sprint({ shippedRelease: 'v2.13.0', staleTally: ['an item'] })] }),
      { kind: 'sprint', slug: 'a-sprint' },
    );
    if (!decided(out)) throw new Error('expected a decision');
    expect(out.detail.blocking).toBe(0);
    expect(out.detail.findings.length).toBe(2);
  });

  it('clears with no findings where nothing has drifted', () => {
    const out = reconcile(estate(), { kind: 'plan', slug: 'a-plan' });
    if (!decided(out)) throw new Error('expected a decision');
    expect(out.detail.findings).toEqual([]);
    expect(out.detail.blocking).toBe(0);
  });
});

describe('reconcile — the leftovers come from sweepable.ts', () => {
  it('reports a merged branch no worktree holds, and names the deletion', () => {
    const out = reconcile(
      estate({
        branches: [
          { branch: 'feature/landed', defaultBranch: 'main', hasMergedPr: true, checkedOut: false },
        ],
      }),
      { kind: 'workspace' },
    );
    if (!decided(out)) throw new Error('expected a decision');
    const found = out.detail.findings.find((f) => f.kind === 'local-branch');
    expect(found?.repair).toBe('git branch -D feature/landed');
  });

  // An unreachable host answers "not merged", so silence is never permission.
  it('says nothing about a branch the host did not confirm merged', () => {
    const out = reconcile(
      estate({
        branches: [
          { branch: 'feature/live', defaultBranch: 'main', hasMergedPr: false, checkedOut: false },
        ],
      }),
      { kind: 'workspace' },
    );
    if (!decided(out)) throw new Error('expected a decision');
    expect(out.detail.findings.map((f) => f.kind)).not.toContain('local-branch');
  });

  it('reports an abandoned empty claim and leaves a bare one to a person', () => {
    const out = reconcile(
      estate({
        claims: [
          { branch: 'feature/given-up', isEmptyClaim: true, disposition: 'abandoned' },
          { branch: 'feature/unclear', isEmptyClaim: true, disposition: 'unresolved' },
        ],
      }),
      { kind: 'workspace' },
    );
    if (!decided(out)) throw new Error('expected a decision');
    const claims = out.detail.findings.filter((f) => f.kind === 'claim-ref');
    expect(claims.map((f) => f.subject)).toEqual(['feature/given-up']);
  });

  it('reports a dirty tree nobody owns and offers no command', () => {
    const out = reconcile(
      estate({
        trees: [
          { path: '/repo/.worktrees/orphan', branch: 'feature/x', dirtyCount: 3, workerPid: null, manifest: '' },
          { path: '/repo/.worktrees/owned', branch: 'feature/y', dirtyCount: 3, workerPid: '123', manifest: '' },
        ],
      }),
      { kind: 'workspace' },
    );
    if (!decided(out)) throw new Error('expected a decision');
    const dirty = out.detail.findings.filter((f) => f.kind === 'dirty-tree');
    expect(dirty.map((f) => f.subject)).toEqual(['/repo/.worktrees/orphan']);
    expect(dirty[0]?.repair).toBe('');
  });
});

describe('reconcile — a tree it cannot classify is reported, not skipped', () => {
  /**
   * A tree under the worktree root that neither recognition test placed.
   *
   * `isDispatchTree` is false, so `reap()` never sees it — which is the whole
   * point: today that combination is silence.
   */
  const unclassifiedDesk = (over: Partial<Worktree> = {}) => ({
    tree: desk({ path: '/repo/.worktrees/feature-stranded', ...over }),
    evidence: {
      workerAlive: false,
      blockedMarker: false,
      hasMergedPr: false,
      isDispatchTree: false,
      unclassified: true,
      manifest: '',
      hasLog: false,
    },
  });

  const findingsFor = (candidate: { tree: Worktree; evidence: Record<string, unknown> }) => {
    const out = reconcile(
      estate({
        desks: {
          candidates: [candidate as never],
          orphanedManifests: [],
          defaultBranch: 'main',
        },
      }),
      { kind: 'workspace' },
    );
    if (!decided(out)) throw new Error('expected a decision');
    return out.detail.findings;
  };

  // The regression this slice fixes. `plot-reap.sh:384` hit `continue` on a
  // tree matching neither test — not reaped, not kept, not counted, not named.
  it('reports a tree under the worktree root that no recognition test placed', () => {
    const found = findingsFor(unclassifiedDesk()).filter((f) => f.kind === 'unclassified-tree');
    expect(found.length).toBe(1);
    expect(found[0]?.subject).toBe('/repo/.worktrees/feature-stranded');
  });

  // The failure mode worse than today's silence: a person's checkout turned
  // into a removal instruction.
  it('says nothing at all about a hand-made worktree outside the root', () => {
    const handMade = {
      ...unclassifiedDesk({ path: '/tmp/plot-baseline-main' }),
      evidence: { ...unclassifiedDesk().evidence, unclassified: false },
    };
    expect(findingsFor(handMade)).toEqual([]);
  });

  // The recognition test stays exactly as strict; only the silence goes.
  it('never offers a removal for a tree it could not classify', () => {
    const [found] = findingsFor(unclassifiedDesk()).filter((f) => f.kind === 'unclassified-tree');
    expect(found?.repair).toBe('');
    expect(found?.blocking).toBe(false);
  });

  it('says what it could not tell, so a person knows what to look at', () => {
    const [found] = findingsFor(unclassifiedDesk()).filter((f) => f.kind === 'unclassified-tree');
    expect(found?.evidence).toContain('could not be classified');
  });

  // `unclassified` and `isDispatchTree` answer two questions, and a tree the
  // reaper judges is never also reported as unplaceable.
  it('reports a recognised desk once, through reap(), and not as unclassified', () => {
    const kinds = findingsFor(finishedDesk()).map((f) => f.kind);
    expect(kinds).toEqual(['worktree']);
  });

  // An absent reading is false: a caller that measured nothing has not
  // discovered every tree is unplaceable.
  it('reads an absent unclassified flag as false, never as a finding', () => {
    const silent = {
      ...unclassifiedDesk(),
      evidence: {
        workerAlive: false,
        blockedMarker: false,
        hasMergedPr: false,
        isDispatchTree: false,
        manifest: '',
        hasLog: false,
      },
    };
    expect(findingsFor(silent)).toEqual([]);
  });
});
