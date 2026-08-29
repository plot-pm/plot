import { describe, it, expect } from 'vitest';
import {
  BranchStateSchema,
  SliceVerdictSchema,
  WorkerStateSchema,
  WorkerActivitySchema,
  FleetBranchSchema,
  FleetSliceSchema,
  FleetPlanSchema,
  FleetPulseSchema,
} from '../src/index.js';

/**
 * The entity graph, specified where it now lives.
 *
 * These entities arrived by a MOVE, already exercised by the board's 53
 * importers, so the board's own suite — passing unedited — is the proof that
 * behaviour was preserved. What that suite cannot do is state the contract
 * from the domain's side: it reaches these shapes through the board's
 * re-exports, so it would still pass if the package resolved to something
 * subtly different.
 *
 * These tests read the package DIRECTLY, and they pin the properties the moved
 * prose argues for — chiefly the defaults, which exist so that a pulse from an
 * OLDER scan still validates. That is a compatibility promise, and a promise
 * with no test is a comment.
 */

/** The smallest branch the schema accepts — every defaulted field omitted. */
const bareBranch = { branch: 'feature/x', state: 'open', deferred: false, claimed: '' };

/** The smallest pulse the schema accepts. */
const bareSummary = {
  plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0,
};

describe('the scan vocabularies are closed sets', () => {
  it('names the five branch states and refuses a sixth', () => {
    expect(BranchStateSchema.options).toEqual(['open', 'wip', 'merged', 'claimed', 'deferred']);
    expect(BranchStateSchema.safeParse('abandoned').success).toBe(false);
  });

  it('names the four slice verdicts, `unapproved` among them', () => {
    expect(SliceVerdictSchema.options).toEqual(['complete', 'eligible', 'blocked', 'unapproved']);
    // `unapproved` is kept apart from `blocked` deliberately: blocked resolves
    // by merging work, this resolves by a person approving the plan.
    expect(SliceVerdictSchema.safeParse('unapproved').success).toBe(true);
    expect(SliceVerdictSchema.safeParse('startable').success).toBe(false);
  });

  it('keeps the six process states and the two task states apart', () => {
    // Every worker exits 0, so the exit code cannot say whether the TASK
    // finished — `waiting` and `stalled` are the two that answer that, and
    // collapsing them into the process six is the defect they exist to fix.
    expect(WorkerStateSchema.options).toEqual([
      'running', 'finished', 'failed', 'ended', 'none', 'elsewhere', 'waiting', 'stalled',
    ]);
    expect(WorkerStateSchema.safeParse('hung').success).toBe(false);
  });

  it('makes the activity cue three-valued, empty included', () => {
    // A CUE, not a sixth worker state. `''` is the value on every state but
    // `running`, where the question has no answer.
    expect(WorkerActivitySchema.options).toEqual(['working', 'idle', '']);
    expect(WorkerActivitySchema.parse('')).toBe('');
  });
});

describe('a branch from an older scan still validates', () => {
  it('accepts a branch carrying only its four required fields', () => {
    expect(FleetBranchSchema.safeParse(bareBranch).success).toBe(true);
  });

  it('defaults every field a pre-field scan could not have reported', () => {
    const b = FleetBranchSchema.parse(bareBranch);
    // Absent is the same answer these fields gave before they existed.
    expect(b.deferred_reason).toBe('');
    expect(b.local_dirty).toBe(false);
    expect(b.local_locked).toBe(false);
    expect(b.local_worktree).toBe('');
    expect(b.held).toBe(false);
    expect(b.ref_held).toBe(false);
    expect(b.local_ahead).toBe(0);
    expect(b.worker_pid).toBe('');
    expect(b.worker_exit).toBe('');
    expect(b.worker_dirty_paths).toEqual([]);
    expect(b.conflicts).toEqual([]);
    expect(b.conflicts_known).toBe(false);
    expect(b.changed_paths).toEqual([]);
  });

  it('distinguishes "no worktree here" from "no worker"', () => {
    // `elsewhere` is the honest default: a machine with no worktree for the
    // branch cannot answer the question, which is not the same as answering
    // `none`. Being wrong in the reassuring direction is the worst way to be
    // wrong.
    expect(FleetBranchSchema.parse(bareBranch).worker).toBe('elsewhere');
    expect(FleetBranchSchema.parse(bareBranch).worker_activity).toBe('');
  });

  it('defaults the two timing fields to null rather than to zero', () => {
    // `null` means the scan did not say. `0` would mean "just now", and a
    // freshly-changed branch is precisely what the board acts on.
    const b = FleetBranchSchema.parse(bareBranch);
    expect(b.changed_ago_seconds).toBeNull();
    expect(b.changed_at).toBeNull();
  });

  it('carries the timing fields through when the scan does report them', () => {
    const b = FleetBranchSchema.parse({ ...bareBranch, changed_ago_seconds: 42, changed_at: 1700000000 });
    expect(b.changed_ago_seconds).toBe(42);
    expect(b.changed_at).toBe(1700000000);
  });

  it('refuses a branch whose state is not one of the five', () => {
    expect(FleetBranchSchema.safeParse({ ...bareBranch, state: 'nearly' }).success).toBe(false);
  });

  it('requires the fields that have no honest default', () => {
    // `branch` names the thing; there is no value that could stand in for it.
    expect(FleetBranchSchema.safeParse({ state: 'open', deferred: false, claimed: '' }).success).toBe(false);
  });
});

describe('a slice is a verdict over branches', () => {
  it('requires a verdict — a slice with no verdict is not a slice', () => {
    expect(FleetSliceSchema.safeParse({ name: 'Moving', branches: [] }).success).toBe(false);
  });

  it('nests its branches through the branch schema', () => {
    const s = FleetSliceSchema.parse({ name: 'Moving', verdict: 'eligible', branches: [bareBranch] });
    // The defaults apply at any depth, which is what makes the graph — rather
    // than the top-level object — the compatibility promise.
    expect(s.branches[0].worker).toBe('elsewhere');
  });

  it('rejects a branch that is invalid inside an otherwise valid slice', () => {
    expect(FleetSliceSchema.safeParse({
      name: 'Moving', verdict: 'eligible', branches: [{ ...bareBranch, state: 'bogus' }],
    }).success).toBe(false);
  });
});

describe('a plan is slices plus its own phase', () => {
  it('defaults the phase to empty, which renders as nothing rather than a guess', () => {
    const p = FleetPlanSchema.parse({ file: 'docs/plans/x.md', slices: [] });
    expect(p.phase).toBe('');
  });

  it('carries the phase the helper normalized when there is one', () => {
    expect(FleetPlanSchema.parse({ file: 'x.md', phase: 'approved', slices: [] }).phase).toBe('approved');
  });
});

/**
 * THE COMPATIBILITY PROMISE OF THE RENAME, asserted on BOTH inputs.
 *
 * `plot-fleet-scan.sh` is a separate process that ships separately and still
 * emits `waves`, so a board built from this package must read either spelling.
 * A test that feeds one and asserts about the other is the failure these cover:
 * each case parses its own input and the two results are compared directly.
 */
describe('a plan parses under either spelling', () => {
  const slice = { name: 'Reading', verdict: 'eligible', branches: [bareBranch] };

  it('reads the new `slices` and the old `waves` to the identical object', () => {
    const fromNew = FleetPlanSchema.parse({ file: 'x.md', slices: [slice] });
    const fromOld = FleetPlanSchema.parse({ file: 'x.md', waves: [slice] });
    expect(fromOld).toEqual(fromNew);
    // Not vacuous: both really did resolve the slice, rather than both being empty.
    expect(fromNew.slices).toHaveLength(1);
    expect(fromOld.slices[0].name).toBe('Reading');
  });

  it('carries NO `waves` out, under either input', () => {
    // The parsed plan speaks one vocabulary. `waves` was carried out as an
    // alias while the board's call sites moved across; they have moved, and
    // two names for one array is the defect this rename removes. The inbound
    // spelling is still accepted — that is the assertion above, and a
    // different mechanism.
    for (const input of [{ file: 'x.md', slices: [slice] }, { file: 'x.md', waves: [slice] }]) {
      const parsed = FleetPlanSchema.parse(input);
      expect(parsed).not.toHaveProperty('waves');
      expect(parsed.slices).toHaveLength(1);
    }
  });

  it('prefers `slices` when a pulse somehow carries both', () => {
    const parsed = FleetPlanSchema.parse({
      file: 'x.md', slices: [slice], waves: [{ ...slice, name: 'Stale' }],
    });
    expect(parsed.slices).toHaveLength(1);
    expect(parsed.slices[0].name).toBe('Reading');
  });

  it('still refuses a malformed slice under the legacy key', () => {
    // The fallback renames a key; it does not soften validation behind it.
    expect(FleetPlanSchema.safeParse({ file: 'x.md', waves: 'not an array' }).success).toBe(false);
    expect(FleetPlanSchema.safeParse({ file: 'x.md' }).success).toBe(false);
  });

  it('leaves a non-object alone for the schema to reject', () => {
    // The preprocessor must never be the thing that reports a type error.
    for (const notAPlan of [null, 'plan', 42, [] as unknown]) {
      expect(FleetPlanSchema.safeParse(notAPlan).success).toBe(false);
    }
  });

  it('parses a whole pulse in the legacy spelling, nested', () => {
    const pulse = FleetPulseSchema.parse({
      main: 'main', head: 'abc1234',
      plans: [{ file: 'docs/plans/x.md', waves: [slice] }],
      summary: bareSummary,
    });
    expect(pulse.plans[0].slices[0].branches[0].worker).toBe('elsewhere');
  });
});

describe('the pulse is the whole document', () => {
  const barePulse = { main: 'main', head: 'abc1234', plans: [], summary: bareSummary };

  it('validates a pulse carrying only what every scan has always emitted', () => {
    expect(FleetPulseSchema.safeParse(barePulse).success).toBe(true);
  });

  it('leaves read_ref and local_head absent rather than substituting head', () => {
    // THE PRECISE BUG THIS PAIR EXISTS TO END. `head` is the local checkout;
    // `read_ref` is `origin/<main>`, the ref the scan actually read. Mapping
    // one onto the other is the defect, so absent must stay absent.
    const p = FleetPulseSchema.parse(barePulse);
    expect(p.read_ref).toBeUndefined();
    expect(p.local_head).toBeUndefined();
    expect(p.head).toBe('abc1234');
  });

  it('keeps the scan’s explicit `unknown` for an unresolvable ref', () => {
    // A said-so-explicitly absence, deliberately NOT rewritten to the local
    // head — substituting there reintroduces the defect where it is hardest
    // to notice.
    expect(FleetPulseSchema.parse({ ...barePulse, read_ref: 'unknown' }).read_ref).toBe('unknown');
  });

  it('requires every counter of the summary', () => {
    const { deferred, ...short } = bareSummary;
    expect(deferred).toBe(0);
    expect(FleetPulseSchema.safeParse({ ...barePulse, summary: short }).success).toBe(false);
  });

  it('composes the whole graph in one parse', () => {
    const p = FleetPulseSchema.parse({
      ...barePulse,
      plans: [{ file: 'docs/plans/x.md', waves: [{ name: 'Moving', verdict: 'complete', branches: [bareBranch] }] }],
      summary: { ...bareSummary, plans: 1, waves: 1, branches: 1 },
    });
    expect(p.plans[0].phase).toBe('');
    expect(p.plans[0].slices[0].branches[0].branch).toBe('feature/x');
    expect(p.plans[0].slices[0].branches[0].deferred_reason).toBe('');
  });

  it('refuses a pulse whose plans are not an array', () => {
    // The shape `readBridge` is defending against: a payload written by a
    // build that is not this one.
    expect(FleetPulseSchema.safeParse({ ...barePulse, plans: 'not an array' }).success).toBe(false);
  });
});
