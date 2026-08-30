import { describe, it, expect } from 'vitest';
import {
  dispatch,
  decided,
  refused,
  type DispatchCandidate,
  type DispatchReadings,
  type PlanGateReadings,
} from '../src/workflows/index.js';

/**
 * THE PLAN'S BAR FOR THIS SLICE, and what these tests are:
 *
 *   "every `plot-dispatch.sh` refusal is a named `Refusal` assertable without
 *    a repository, and the `--dry-run` reasoning is reproducible from the
 *    domain alone."
 *
 * So every test below runs against plain values. No repository, no host, no
 * process — which is the whole argument for expressing the refusals here at
 * all: each one is a MEASUREMENT, and a measurement can be handed to a
 * function.
 */

const gate = (over: Partial<PlanGateReadings> = {}): PlanGateReadings => ({
  refResolved: true,
  file: 'docs/plans/2026-08-28-a-plan.md',
  parsed: true,
  phase: 'approved',
  impl: 'own-branches',
  source: 'origin/main@abcd1234:docs/plans/2026-08-28-a-plan.md',
  ...over,
});

/** A branch nobody holds, with a brief on the shared ref. */
const candidate = (over: Partial<DispatchCandidate> = {}): DispatchCandidate => ({
  branch: 'feature/one',
  heldBy: '',
  heldWorkUnlanded: false,
  worktree: '/repo/.worktrees/feature-one',
  worktreeExists: false,
  briefPresent: true,
  ...over,
});

const estate = (over: Partial<DispatchReadings> = {}): DispatchReadings => ({
  inRepository: true,
  slug: 'a-plan',
  defaultBranch: 'main',
  gate: gate(),
  candidates: [candidate()],
  workerCommand: 'configured',
  ...over,
});

describe('dispatch — the refusals that stop a whole run', () => {
  it('refuses outside a repository, before anything else is asked', () => {
    const out = dispatch(estate({ inRepository: false }));
    expect(refused(out) && out.reason).toBe('not-a-repository');
  });

  it('refuses a --max that is not a number rather than treating it as no bound', () => {
    const out = dispatch(estate(), { maxIsNumeric: false });
    expect(refused(out) && out.reason).toBe('max-not-a-number');
  });

  it('refuses without a slug — a fan-out needs a plan to fan out', () => {
    const out = dispatch(estate({ slug: '' }));
    expect(refused(out) && out.reason).toBe('slug-missing');
  });

  it('refuses when no gate was read at all, rather than dispatching ungated', () => {
    const out = dispatch(estate({ gate: undefined }));
    expect(refused(out) && out.reason).toBe('plan-not-found');
  });
});

describe('dispatch — the phase gate, read from the shared ref', () => {
  it('FAILS CLOSED when origin/<main> cannot be resolved', () => {
    const out = dispatch(estate({ gate: gate({ refResolved: false }) }));
    expect(refused(out) && out.reason).toBe('ref-unreadable');
    // The escape is NAMED in the refusal, so an operator learns it exists at
    // the moment they need it.
    expect(refused(out) && out.detail).toContain('--allow-local');
  });

  it('--allow-local reads the working tree instead, and dispatches', () => {
    const out = dispatch(
      estate({ gate: gate({ refResolved: false, source: 'docs/plans/a.md (working tree)' }) }),
      { allowLocal: true },
    );
    expect(decided(out)).toBe(true);
  });

  it('refuses a plan that exists only in this working tree', () => {
    const out = dispatch(estate({ gate: gate({ file: '' }) }));
    expect(refused(out) && out.reason).toBe('plan-not-found');
    expect(refused(out) && out.detail).toContain('has not been shared yet');
  });

  it('says it differently under --allow-local, where there is no shared ref to blame', () => {
    const out = dispatch(estate({ gate: gate({ file: '' }) }), { allowLocal: true });
    expect(refused(out) && out.reason).toBe('plan-not-found');
    expect(refused(out) && out.detail).not.toContain('shared');
  });

  it('refuses an unparseable plan rather than falling back to the working tree', () => {
    const out = dispatch(estate({ gate: gate({ parsed: false }) }));
    expect(refused(out) && out.reason).toBe('plan-unreadable');
  });

  it('refuses a Draft plan — an approval nobody else can see is not one', () => {
    const out = dispatch(estate({ gate: gate({ phase: 'draft' }) }));
    expect(refused(out) && out.reason).toBe('phase-draft');
    expect(refused(out) && out.detail).toContain('push that approval');
  });

  it.each(['delivered', 'released'])('refuses a %s plan — its work is done', (phase) => {
    const out = dispatch(estate({ gate: gate({ phase }) }));
    expect(refused(out) && out.reason).toBe('phase-terminal');
  });

  it.each(['', 'NONE'])('refuses an unreadable phase (%s) rather than guessing', (phase) => {
    const out = dispatch(estate({ gate: gate({ phase }) }));
    expect(refused(out) && out.reason).toBe('phase-unreadable');
  });

  it('refuses a phase it does not recognise', () => {
    const out = dispatch(estate({ gate: gate({ phase: 'design' }) }));
    expect(refused(out) && out.reason).toBe('phase-wrong');
  });
});

describe('dispatch — the ceremony gate', () => {
  it.each([
    ['same-branch', 'impl-same-branch'],
    ['other-repo', 'impl-other-repo'],
    ['none', 'impl-none'],
    ['sideways', 'impl-unrecognised'],
  ])("refuses 'Impl: %s' with %s", (impl, reason) => {
    const out = dispatch(estate({ gate: gate({ impl }) }));
    expect(refused(out) && out.reason).toBe(reason);
  });

  it.each(['own-branches', 'NONE', ''])(
    "dispatches under 'Impl: %s' — the two empties predate the question",
    (impl) => {
      expect(decided(dispatch(estate({ gate: gate({ impl }) })))).toBe(true);
    },
  );
});

describe('dispatch — the held-branch gate, which needs BOTH halves', () => {
  it('refuses a branch whose worktree holds unlanded work, and names the desk', () => {
    const held = candidate({ heldBy: '/repo/../plot-wt-one', heldWorkUnlanded: true });
    const out = dispatch(estate({ candidates: [held] }));
    expect(decided(out)).toBe(true);
    expect(decided(out) && out.detail.skipped).toEqual([
      { branch: 'feature/one', reason: 'held', worktree: '/repo/../plot-wt-one' },
    ]);
    // It NEVER CLAIMS on the operator's behalf: a claim ref for a worktree this
    // did not create is a record in git nobody asked for.
    expect(decided(out) && out.writes).toEqual([]);
  });

  it('dispatches a leftover desk whose work already landed — 6 of 36 on this disk', () => {
    // A worktree with no unlanded work is a LEFTOVER, not a held branch.
    // Refusing it would fire on exactly the branches that are safe, the fastest
    // way to teach an operator to route around a gate.
    const leftover = candidate({ heldBy: '/repo/../plot-wt-one', heldWorkUnlanded: false });
    const out = dispatch(estate({ candidates: [leftover] }));
    expect(decided(out) && out.detail.dispatched).toEqual(['feature/one']);
  });

  it('does not hold on a branch with unlanded work but no worktree — no desk, nobody at it', () => {
    // Plenty of local branches exist for other reasons; a branch alone is not
    // a hold.
    const orphan = candidate({ heldBy: '', heldWorkUnlanded: true });
    expect(decided(dispatch(estate({ candidates: [orphan] }))) && true).toBe(true);
    const out = dispatch(estate({ candidates: [orphan] }));
    expect(decided(out) && out.detail.dispatched).toEqual(['feature/one']);
  });

  it('survives --allow-local, which says nothing about whether someone is mid-edit', () => {
    const held = candidate({ heldBy: '/repo/../plot-wt-one', heldWorkUnlanded: true });
    const out = dispatch(estate({ candidates: [held], gate: gate({ refResolved: false }) }), {
      allowLocal: true,
    });
    expect(decided(out) && out.detail.skipped[0]?.reason).toBe('held');
  });

  it('refuses a held branch in a DRY RUN identically — one predicate, both loops', () => {
    const held = candidate({ heldBy: '/repo/../plot-wt-one', heldWorkUnlanded: true });
    const out = dispatch(estate({ candidates: [held] }), { dryRun: true });
    expect(decided(out) && out.detail.skipped[0]?.reason).toBe('held');
    expect(decided(out) && out.detail.dispatched).toEqual([]);
  });
});

describe('dispatch — the claim, and what a lost race costs', () => {
  it('claims by pushing a branch cut from the shared ref', () => {
    const out = dispatch(estate());
    expect(decided(out) && out.writes[0]).toEqual({
      kind: 'branch-create',
      branch: 'feature/one',
      base: 'origin/main',
      push: true,
    });
  });

  it('skips a branch another session claimed first, and leaves its worktree alone', () => {
    const out = dispatch(estate({ candidates: [candidate({ claimWins: false })] }));
    expect(decided(out) && out.detail.skipped).toEqual([
      { branch: 'feature/one', reason: 'claim-lost', worktree: '/repo/.worktrees/feature-one' },
    ]);
    expect(decided(out) && out.writes).toEqual([]);
  });

  it('skips a branch whose worktree cannot be created at all', () => {
    const out = dispatch(estate({ candidates: [candidate({ worktreeCreatable: false })] }));
    expect(decided(out) && out.detail.skipped[0]?.reason).toBe('worktree-uncreatable');
  });

  it('adopts an existing worktree rather than duplicating it, and claims nothing', () => {
    // A dispatcher that died halfway through a fan-out is safe to re-run: the
    // reused desk was claimed and booked by the run that first took it.
    const out = dispatch(estate({ candidates: [candidate({ worktreeExists: true })] }));
    expect(decided(out) && out.detail.reused).toEqual(['feature/one']);
    expect(decided(out) && out.detail.dispatched).toEqual([]);
    expect(decided(out) && out.writes).toEqual([]);
  });
});

describe('dispatch — the brief gate, between preparing and starting', () => {
  it('prepares but does not start a branch with no brief on the shared ref', () => {
    const out = dispatch(estate({ candidates: [candidate({ briefPresent: false })] }));
    // The worktree and the claim STAND; only the launch is refused.
    expect(decided(out) && out.detail.dispatched).toEqual(['feature/one']);
    expect(decided(out) && out.detail.started).toBe(0);
    expect(decided(out) && out.detail.prepared[0]?.notStartedBecause).toBe('no-brief');
  });

  it('--no-brief starts anyway, which is the override being on the record', () => {
    const out = dispatch(estate({ candidates: [candidate({ briefPresent: false })] }), {
      noBrief: true,
    });
    expect(decided(out) && out.detail.started).toBe(1);
  });

  it('starts a worker where the brief is present', () => {
    const out = dispatch(estate());
    expect(decided(out) && out.detail.prepared[0]).toEqual({
      branch: 'feature/one',
      worktree: '/repo/.worktrees/feature-one',
      reused: false,
      started: true,
      notStartedBecause: '',
    });
  });
});

describe('dispatch — worker=, which travels for the caller who reads only the summary', () => {
  it('reports suppressed under --no-start, a CHOICE rather than a gap', () => {
    const out = dispatch(estate(), { noStart: true });
    expect(decided(out) && out.detail.worker).toBe('suppressed');
    expect(decided(out) && out.detail.prepared[0]?.notStartedBecause).toBe('no-start');
  });

  it('reports suppressed even where a Worker command exists — the flag wins', () => {
    const out = dispatch(estate({ workerCommand: 'configured' }), { noStart: true });
    expect(decided(out) && out.detail.worker).toBe('suppressed');
  });

  it('reports unconfigured where nobody was ever asked', () => {
    const out = dispatch(estate({ workerCommand: 'unconfigured' }));
    expect(decided(out) && out.detail.worker).toBe('unconfigured');
    expect(decided(out) && out.detail.prepared[0]?.notStartedBecause).toBe('worker-unconfigured');
    // Prepared regardless: the claim and the desk are correct.
    expect(decided(out) && out.detail.dispatched).toEqual(['feature/one']);
  });

  it('reports declined where the repo answered "we start them by hand"', () => {
    // A DELIBERATE absence, kept apart from a missing key so the skill stops
    // asking. `none` is never run as a command.
    const out = dispatch(estate({ workerCommand: 'declined' }));
    expect(decided(out) && out.detail.worker).toBe('declined');
    expect(decided(out) && out.detail.prepared[0]?.notStartedBecause).toBe('worker-declined');
  });
});

describe('dispatch — --max, an operator bound rather than a fact about a branch', () => {
  it('stops after N CLAIMS and names the rest max-reached', () => {
    const out = dispatch(
      estate({
        candidates: [
          candidate({ branch: 'feature/one' }),
          candidate({ branch: 'feature/two' }),
          candidate({ branch: 'feature/three' }),
        ],
      }),
      { max: 2 },
    );
    expect(decided(out) && out.detail.dispatched).toEqual(['feature/one', 'feature/two']);
    expect(decided(out) && out.detail.skipped).toEqual([
      { branch: 'feature/three', reason: 'max-reached', worktree: '' },
    ]);
  });

  it('does not spend a slot on a branch it skipped', () => {
    const out = dispatch(
      estate({
        candidates: [
          candidate({ branch: 'feature/held', heldBy: '/wt', heldWorkUnlanded: true }),
          candidate({ branch: 'feature/two' }),
        ],
      }),
      { max: 1 },
    );
    expect(decided(out) && out.detail.dispatched).toEqual(['feature/two']);
  });
});

describe('dispatch — a dry run, which is inert by construction', () => {
  it('names what a real run would take and writes nothing at all', () => {
    const out = dispatch(estate({ candidates: [candidate(), candidate({ branch: 'feature/two' })] }), {
      dryRun: true,
    });
    expect(decided(out) && out.detail.dispatched).toEqual(['feature/one', 'feature/two']);
    expect(decided(out) && out.writes).toEqual([]);
    expect(decided(out) && out.detail.dryRun).toBe(true);
  });

  it('names no cause for not starting — a dry run never consulted the config', () => {
    const out = dispatch(estate({ workerCommand: 'unconfigured' }), { dryRun: true });
    expect(decided(out) && out.detail.prepared[0]?.notStartedBecause).toBe('');
    expect(decided(out) && out.detail.started).toBe(0);
  });

  it('books no Started: record, because it claimed nothing', () => {
    const out = dispatch(estate(), { dryRun: true });
    expect(decided(out) && out.writes).toEqual([]);
  });
});

describe('dispatch — the Started: record, booked after the fan-out', () => {
  it('books one record per NEWLY CLAIMED branch, then commits and pushes once', () => {
    const out = dispatch(
      estate({ candidates: [candidate(), candidate({ branch: 'feature/two' })] }),
    );
    expect(decided(out) && out.writes.map((w) => w.kind)).toEqual([
      'branch-create',
      'branch-create',
      'plan-record',
      'plan-record',
      'commit',
      'push',
    ]);
  });

  it('books nothing for a branch it merely re-adopted', () => {
    // A reused worktree was dispatched by an earlier run, which booked it.
    const out = dispatch(estate({ candidates: [candidate({ worktreeExists: true })] }));
    expect(decided(out) && out.writes).toEqual([]);
  });

  it('stages the plan file alone, never the whole tree', () => {
    const out = dispatch(estate());
    const commit = decided(out) && out.writes.find((w) => w.kind === 'commit');
    expect(commit).toEqual({
      kind: 'commit',
      message: 'plot: record start of a-plan',
      paths: ['docs/plans/2026-08-28-a-plan.md'],
    });
  });

  it('decides with no writes where every candidate was skipped', () => {
    // An empty set is a legitimate decision, not a refusal: the question is
    // asked of every branch separately.
    const out = dispatch(
      estate({ candidates: [candidate({ heldBy: '/wt', heldWorkUnlanded: true })] }),
    );
    expect(decided(out)).toBe(true);
    expect(decided(out) && out.writes).toEqual([]);
  });

  it('decides with no writes on an empty fleet', () => {
    const out = dispatch(estate({ candidates: [] }));
    expect(decided(out) && out.detail.dispatched).toEqual([]);
  });
});
