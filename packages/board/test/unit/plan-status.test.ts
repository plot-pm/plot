import { describe, it, expect } from 'vitest';
import { planStatus } from '../../src/server/board.js';
import { PlanMetaSchema, PlanStatusSchema, type FleetPulse } from '../../src/contract/schema.js';

// `status` is the plan's MEASURED state — derived every scan from its waves,
// stored nowhere — beside `phase`, the DECISION a human writes into the file.
// The two are independently observable, and `deliverable` is the value that
// earns the field: the measurement has arrived (every wave complete) and the
// decision has not (phase still Approved).
//
// Every fixture here reads the plan file and the pulse and returns one of seven
// values. It flips no phase and writes no record: `planStatus` returns a string
// and touches nothing, exactly as `allWavesMerged` returns a boolean and does.

const meta = (over: Record<string, unknown> = {}) =>
  PlanMetaSchema.parse({
    file: '/repo/docs/plans/2026-08-23-a-plan-has-a-phase-and-a-status.md',
    format: 'canonical',
    phase: 'approved',
    ...over,
  });

/** One wave, whatever branches it holds — the state tuple is what varies. */
const wave = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred']>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: '',
    local_dirty: false,
    local_worktree: '',
  })),
});

const pulse = (file: string, waves: ReturnType<typeof wave>[]): FleetPulse => ({
  main: 'main',
  head: 'abc1234',
  plans: [{ file, waves }],
  summary: {
    plans: 1, waves: waves.length, branches: 0, claimed: 0,
    eligible: 0, blocked: 0, deferred: 0,
  },
});

const SLUG = '2026-08-23-a-plan-has-a-phase-and-a-status.md';
const oneOpen = pulse(SLUG, [wave('Measured', 'eligible', [['feature/a', 'open']])]);
const oneMerged = pulse(SLUG, [wave('Measured', 'complete', [['feature/a', 'merged']])]);

describe('planStatus — the seven values, each reachable', () => {
  it('draft — created, discovery going on, no plan PR', () => {
    // A plan under review with an in-session channel never has a plan PR.
    const m = meta({ phase: 'draft', review: 'in-session' });
    expect(planStatus(m, oneOpen)).toBe('draft');
  });

  it('open — discovery done, a plan PR is up for review', () => {
    // `Review: pr` is the channel that leaves a PR to observe; a draft plan on
    // that channel is out for approval, which is `open`.
    const m = meta({ phase: 'draft', review: 'pr' });
    expect(planStatus(m, oneOpen)).toBe('open');
  });

  it('approved — development possible, nothing started', () => {
    // Approved, no `Started:` record, no claim: the queue the Start button
    // serves.
    const m = meta({ phase: 'approved', started_raw: [] });
    expect(planStatus(m, oneOpen)).toBe('approved');
  });

  it('in-progress — a Started: record exists', () => {
    const m = meta({ phase: 'approved', started_raw: ['2026-08-23, jwloka'] });
    expect(planStatus(m, oneOpen)).toBe('in-progress');
  });

  it('deliverable — every wave complete, phase still approved', () => {
    const m = meta({ phase: 'approved', started_raw: ['2026-08-23, jwloka'] });
    expect(planStatus(m, oneMerged)).toBe('deliverable');
  });

  it('delivered — the decision caught up', () => {
    const m = meta({ phase: 'delivered' });
    expect(planStatus(m, oneMerged)).toBe('delivered');
  });

  it('released — terminal', () => {
    const m = meta({ phase: 'released' });
    expect(planStatus(m, oneMerged)).toBe('released');
  });
});

describe('planStatus — the pairings the plan insists on', () => {
  it('approved and in-progress split on the Started: record, not the phase', () => {
    // Two otherwise-identical approved plans, one carrying the record. An
    // implementation that reads only `phase` collapses them.
    const untouched = meta({ phase: 'approved', started_raw: [] });
    const running = meta({ phase: 'approved', started_raw: ['2026-08-23, jwloka'] });
    expect(planStatus(untouched, oneOpen)).toBe('approved');
    expect(planStatus(running, oneOpen)).toBe('in-progress');
  });

  it('a claimed branch alone makes a plan in-progress', () => {
    // The fleet sees a claim ref for the same fact `Started:` records. Either
    // signal means someone picked the plan up.
    const m = meta({ phase: 'approved', started_raw: [] });
    const claimed = pulse(SLUG, [
      { ...wave('Measured', 'eligible', [['feature/a', 'claimed']]) },
    ]);
    expect(planStatus(m, claimed)).toBe('in-progress');
  });

  it('a Review: in-session plan reaches approved without ever reporting open', () => {
    // It has no plan PR to observe. An implementation that treats a missing PR
    // as an error rather than as a legal path breaks every in-session plan.
    const draft = meta({ phase: 'draft', review: 'in-session' });
    const approved = meta({ phase: 'approved', review: 'in-session', started_raw: [] });
    expect(planStatus(draft, oneOpen)).toBe('draft');
    expect(planStatus(approved, oneOpen)).toBe('approved');
    expect(planStatus(approved, oneOpen)).not.toBe('open');
  });

  it('draft, delivered and released never disagree with phase', () => {
    // They are derived FROM the phase. A pulse that would make them disagree
    // must not: a delivered plan with an open branch is still delivered.
    expect(planStatus(meta({ phase: 'delivered' }), oneOpen)).toBe('delivered');
    expect(planStatus(meta({ phase: 'released' }), oneOpen)).toBe('released');
    expect(planStatus(meta({ phase: 'draft', review: 'in-session' }), oneMerged))
      .toBe('draft');
  });

  it('one wave open reports in-progress, not deliverable', () => {
    const m = meta({ phase: 'approved', started_raw: ['2026-08-23, jwloka'] });
    const mixed = pulse(SLUG, [
      wave('Measured', 'complete', [['feature/a', 'merged']]),
      wave('Verified', 'eligible', [['feature/b', 'open']]),
    ]);
    expect(planStatus(m, mixed)).toBe('in-progress');
  });

  it('an approved plan with one wave open but nothing started is approved', () => {
    const m = meta({ phase: 'approved', started_raw: [] });
    expect(planStatus(m, oneOpen)).toBe('approved');
  });

  it('a deferred branch does not block deliverable — the scan exempts it', () => {
    const m = meta({ phase: 'approved', started_raw: ['2026-08-23, jwloka'] });
    const withShelf = pulse(SLUG, [
      wave('Measured', 'complete', [['feature/a', 'merged'], ['feature/shelved', 'deferred']]),
    ]);
    expect(planStatus(m, withShelf)).toBe('deliverable');
  });

  it('a plan in Testing (delivered) reports delivered, not deliverable', () => {
    const m = meta({ phase: 'delivered' });
    expect(planStatus(m, oneMerged)).toBe('delivered');
  });
});

describe('planStatus — the release gate reads phase, never status', () => {
  it('a deliverable plan still carries phase approved — the two are independent', () => {
    // The assertion that stops a measurement from becoming a commitment: a
    // deliverable plan has NOT been delivered, so its phase is unchanged and
    // any gate reading `phase` refuses it exactly as before.
    const m = meta({ phase: 'approved', started_raw: ['2026-08-23, jwloka'] });
    expect(planStatus(m, oneMerged)).toBe('deliverable');
    expect(m.phase).toBe('approved');
  });
});

describe('PlanStatusSchema — the enum is exactly the seven', () => {
  it('parses each of the seven and rejects an eighth', () => {
    for (const v of ['draft', 'open', 'approved', 'in-progress',
      'deliverable', 'delivered', 'released']) {
      expect(PlanStatusSchema.parse(v)).toBe(v);
    }
    expect(PlanStatusSchema.safeParse('reviewing').success).toBe(false);
  });
});
