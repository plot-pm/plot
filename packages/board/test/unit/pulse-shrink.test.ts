import { describe, it, expect } from 'vitest';
import { pulseShrink } from '../../src/server/fleet.js';
import { shrinkNote } from '../../src/app/lib/agent-rows/actions.js';
import { FleetSchema, type FleetPulse } from '../../src/contract/schema.js';

// The defect, measured 2026-08-18: rows vanished from the Agents tab and came
// back seconds later — including WORKING rows for agents that were demonstrably
// running — with no error and no staleness marker.
//
// The cache guards against a FAILED refresh overwriting good data and says why.
// The success path had no equivalent guard, because the rule carried an unstated
// assumption: that the only way to be less informative is to fail. A scan can
// exit 0, emit schema-valid JSON, and describe fewer plans than the one before.
//
// Tested as a pure function on a pair of pulses rather than through a live
// cache and a subprocess: the comparison IS the fix, and everything around it is
// plumbing.

const branch = (name: string, state = 'wip') =>
  ({ branch: name, state, deferred: false, claimed: '' }) as FleetPulse['plans'][0]['waves'][0]['branches'][0];

const pulseOf = (plans: { file: string; branches: string[] }[]): FleetPulse => ({
  main: 'main',
  head: 'abc1234',
  plans: plans.map((p) => ({
    file: p.file,
    phase: 'approved',
    waves: [{ name: 'Implementation', verdict: 'eligible' as const, branches: p.branches.map((b) => branch(b)) }],
  })),
  summary: {
    plans: plans.length,
    waves: plans.length,
    branches: plans.reduce((n, p) => n + p.branches.length, 0),
    claimed: 0, eligible: 1, blocked: 0, deferred: 0,
  },
});

const AT = 1_700_000_000_000;

describe('a successful scan that lost plans is marked, not swallowed', () => {
  // THE reproduction, and the exact sandbox measurement from the plan:
  // origin/main carried three plans, the scan reported two, and the smaller
  // answer was cached and rendered without comment.
  const three = pulseOf([
    { file: 'a.md', branches: ['bug/one'] },
    { file: 'b.md', branches: ['bug/two'] },
    { file: 'c.md', branches: ['bug/three'] },
  ]);
  const two = pulseOf([
    { file: 'a.md', branches: ['bug/one'] },
    { file: 'b.md', branches: ['bug/two'] },
  ]);

  it('reports the plan that vanished, by name', () => {
    const shrink = pulseShrink(three, two, AT);
    expect(shrink).not.toBeNull();
    expect(shrink!.plans).toEqual(['c.md']);
  });

  it('reports the branches that vanished with it', () => {
    // The sharper half of the signal: a plan file going away has an innocent
    // explanation an operator performs by hand, a WORKING branch disappearing
    // while its agent runs does not.
    expect(pulseShrink(three, two, AT)!.branches).toEqual(['bug/three']);
  });

  it('dates the mark from the LARGER pulse, not from this one', () => {
    // The tab needs "how long ago the board knew more" — seconds is a scan that
    // read a moving working tree, minutes is a plan that genuinely went away.
    expect(pulseShrink(three, two, AT)!.previousAt).toBe(AT);
  });

  it('ACCEPTS the smaller pulse rather than rejecting it', () => {
    // Stated in the plan and deliberately not re-litigated: a plan legitimately
    // delivered would keep a dead row forever, and a monitoring view that cannot
    // shrink is a different kind of lie. The function's job is to describe the
    // loss, never to veto it — it returns a mark, not a replacement pulse.
    const shrink = pulseShrink(three, two, AT);
    expect(shrink).toMatchObject({ plans: ['c.md'] });
    // Nothing here hands back the previous pulse or mutates the incoming one.
    expect(two.plans).toHaveLength(2);
  });
});

describe('a pulse that lost nothing produces no mark at all', () => {
  // A view flagged on every poll is a view nobody reads. The overwhelmingly
  // common case must render nothing.
  const two = pulseOf([
    { file: 'a.md', branches: ['bug/one'] },
    { file: 'b.md', branches: ['bug/two'] },
  ]);

  it('is null for an identical pulse', () => {
    expect(pulseShrink(two, two, AT)).toBeNull();
  });

  it('is null when the pulse GREW', () => {
    const three = pulseOf([
      { file: 'a.md', branches: ['bug/one'] },
      { file: 'b.md', branches: ['bug/two'] },
      { file: 'c.md', branches: ['bug/three'] },
    ]);
    expect(pulseShrink(two, three, AT)).toBeNull();
  });

  it('is null on the FIRST scan, which has no predecessor', () => {
    // A cold start and a bridge miss both arrive with nothing to compare
    // against. Calling that a loss would flag every process launch.
    expect(pulseShrink(null, two, null)).toBeNull();
    expect(pulseShrink(null, two, AT)).toBeNull();
  });

  it('is null when there is a previous pulse but no timestamp for it', () => {
    expect(pulseShrink(two, two, null)).toBeNull();
  });
});

describe('branches are compared even when their plan survives', () => {
  // The reported symptom precisely: WORKING rows vanishing while the plan they
  // belong to stays on the board. A plan-only comparison sees nothing here.
  const full = pulseOf([{ file: 'a.md', branches: ['bug/one', 'bug/two', 'bug/three'] }]);
  const partial = pulseOf([{ file: 'a.md', branches: ['bug/one'] }]);

  it('names the missing branches', () => {
    const shrink = pulseShrink(full, partial, AT)!;
    expect(shrink.branches).toEqual(['bug/three', 'bug/two']);
    expect(shrink.plans).toEqual([]);
  });
});

describe('identities catch what counts cannot', () => {
  // The Open Points question, answered in code. One plan arriving as another
  // leaves nets to zero, so a count comparison passes it in silence — while a
  // row really did vanish.
  it('flags a swap that leaves the totals unchanged', () => {
    const before = pulseOf([
      { file: 'a.md', branches: ['bug/one'] },
      { file: 'b.md', branches: ['bug/two'] },
    ]);
    const after = pulseOf([
      { file: 'a.md', branches: ['bug/one'] },
      { file: 'c.md', branches: ['bug/three'] },
    ]);
    expect(after.summary.plans).toBe(before.summary.plans);
    expect(after.summary.branches).toBe(before.summary.branches);

    const shrink = pulseShrink(before, after, AT)!;
    expect(shrink).not.toBeNull();
    expect(shrink.plans).toEqual(['b.md']);
    expect(shrink.branches).toEqual(['bug/two']);
  });
});

describe('the mark is stable while the condition is', () => {
  it('sorts names, so the same loss renders identically on every poll', () => {
    const before = pulseOf([{ file: 'a.md', branches: ['z/last', 'a/first', 'm/mid'] }]);
    const after = pulseOf([{ file: 'a.md', branches: [] }]);
    expect(pulseShrink(before, after, AT)!.branches).toEqual(['a/first', 'm/mid', 'z/last']);
  });
});

describe('the mark survives the wire', () => {
  it('validates as part of a Fleet payload', () => {
    const parsed = FleetSchema.parse({
      generatedAt: new Date(AT).toISOString(),
      ageSeconds: 3,
      ready: true,
      error: null,
      shrink: { plans: ['c.md'], branches: ['bug/three'], previousAt: AT },
      rows: [],
      summary: { plans: 2, waves: 2, branches: 2, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
      prAgeSeconds: null,
      prError: null,
    });
    expect(parsed.shrink).toMatchObject({ plans: ['c.md'] });
  });

  it('defaults to null on a payload from an older server', () => {
    // *Nothing was compared*, which for that server is true — and is a
    // different statement from *nothing was lost*.
    const parsed = FleetSchema.parse({
      generatedAt: new Date(AT).toISOString(),
      ageSeconds: 3,
      ready: true,
      error: null,
      rows: [],
      summary: { plans: 2, waves: 2, branches: 2, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
      prAgeSeconds: null,
      prError: null,
    });
    expect(parsed.shrink).toBeNull();
  });
});

describe('shrinkNote — what the operator actually reads', () => {
  it('names the branch that vanished rather than counting it', () => {
    const note = shrinkNote({ plans: [], branches: ['bug/three'], previousAt: AT }, 6);
    expect(note).toContain('bug/three');
    expect(note).toContain('6s');
  });

  it('says the scan SUCCEEDED, never that it failed', () => {
    // The one thing this banner may not do is impersonate the error banner. The
    // rows below are the NEW answer, not the last good one, and a reader told
    // "last scan failed" would draw the opposite conclusion about them.
    const note = shrinkNote({ plans: ['c.md'], branches: [], previousAt: AT }, 4);
    expect(note).toContain('succeeded');
    expect(note).not.toContain('failed');
  });

  it('names branches before plans when both were lost', () => {
    const note = shrinkNote({ plans: ['c.md'], branches: ['bug/three'], previousAt: AT }, 5);
    expect(note.indexOf('bug/three')).toBeLessThan(note.indexOf('c.md'));
  });

  it('caps the list and counts the remainder rather than truncating in silence', () => {
    const note = shrinkNote(
      { plans: [], branches: ['b/1', 'b/2', 'b/3', 'b/4', 'b/5'], previousAt: AT }, 5);
    expect(note).toContain('b/1, b/2, b/3');
    expect(note).toContain('2 more');
    expect(note).not.toContain('b/4');
  });

  it('uses the singular for a single loss', () => {
    expect(shrinkNote({ plans: ['c.md'], branches: [], previousAt: AT }, 5)).toContain('plan c.md');
  });
});
