import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

describe('deliverable is exactly status === deliverable — the one word', () => {
  // The card's `deliverable` bit and the auto-bump into Testing both read
  // `planStatus(...) === 'deliverable'` now. This asserts that word means the
  // SAME thing the old inline boolean (`mapped === 'Development' &&
  // allWavesMerged`) did — approved AND every non-deferred branch merged — so
  // the Deliver button, the column bump and the reported status cannot disagree.
  const oldDeliverable = (m: ReturnType<typeof meta>, p: FleetPulse | null) =>
    m.phase === 'approved'
    && p !== null
    && (() => {
      const plan = p.plans.find((x) => x.file === SLUG);
      if (!plan) return false;
      let merged = 0;
      for (const w of plan.waves) for (const b of w.branches) {
        if (b.state === 'deferred') continue;
        if (b.state !== 'merged') return false;
        merged += 1;
      }
      return merged > 0;
    })();

  const cases: Array<[string, ReturnType<typeof meta>, FleetPulse | null]> = [
    ['approved+all-merged', meta({ phase: 'approved' }), oneMerged],
    ['approved+one-open', meta({ phase: 'approved' }), oneOpen],
    ['approved+started', meta({ phase: 'approved', started_raw: ['x'] }), oneOpen],
    ['delivered', meta({ phase: 'delivered' }), oneMerged],
    ['released', meta({ phase: 'released' }), oneMerged],
    ['draft', meta({ phase: 'draft', review: 'pr' }), oneOpen],
    ['no pulse', meta({ phase: 'approved' }), null],
  ];
  it.each(cases)('%s: the bit equals the word', (_name, m, p) => {
    expect(planStatus(m, p) === 'deliverable').toBe(oldDeliverable(m, p));
  });
});

describe('status appears nowhere on disk — nothing new is written', () => {
  // The whole design: `status` is a DERIVED payload field, re-computed every
  // scan, never a line in a plan file. The plan-format CONTRACT is the place to
  // assert this — a raw grep for "Status:" false-matches prose (three plans here
  // carry `Status: Not started` in a worker report), while the real guarantee is
  // that `plot-plan-meta.sh` neither reads nor emits a `status` field and the
  // schema that types its output has no such key.

  it('PlanMetaSchema — the parser contract — carries no `status` field', () => {
    // If the plan format ever grew `status`, the schema would gain the key and a
    // parsed object would carry it. It must not: `status` is the board's
    // derivation, not the plan's record.
    const parsed = PlanMetaSchema.parse({
      file: '/repo/docs/plans/x.md', format: 'canonical', phase: 'approved',
    }) as Record<string, unknown>;
    expect('status' in parsed).toBe(false);
  });

  it('no plan file records a `status` phase-field the way it records `Phase:`', () => {
    // `Phase:` is the DECISION, written as a `- **Phase:** approved` record in
    // the `## Status` section. `status` must never appear in that same shape — a
    // measurement written to disk is the staleness this field exists to avoid.
    // Matches the record form only, so `Status: Not started` prose in a body is
    // not an offender; a `**Status:** approved` phase-record would be.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const plansDir = path.resolve(here, '../../../../docs/plans');
    const files = readdirSync(plansDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) =>
      /^-\s*\*\*Status:\*\*/mi.test(readFileSync(path.join(plansDir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
