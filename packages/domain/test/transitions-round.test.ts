import { describe, it, expect } from 'vitest';
import { recordRound, isDecision, isRefusal } from '../src/transitions/round.js';

/**
 * `recordRound`, tested at the domain boundary.
 *
 * The plan's done-when: every refusal pinned, and the increment-not-set rule.
 * Each test below names the estate measurement behind the gate it covers, so
 * a later reader can tell a rule that was reasoned from a rule that was
 * guessed.
 */

const plan = (over: Partial<Parameters<typeof recordRound>[0]> = {}) =>
  recordRound({ slug: 'a-plan', phase: 'draft', current: null, ...over });

describe('recordRound — it increments, and never sets', () => {
  it('records the first round on a plan carrying no field', () => {
    const out = plan({ current: null });
    if (!isDecision(out)) throw new Error(`expected a decision, got ${out.reason}`);
    expect(out.rounds).toBe(1);
    expect(out.previous).toBeNull();
    expect(out.field).toBe('Rounds');
  });

  it('adds one to what the plan carries, rather than setting a count', () => {
    const out = plan({ current: '2' });
    if (!isDecision(out)) throw new Error(`expected a decision, got ${out.reason}`);
    expect(out.rounds).toBe(3);
    expect(out.previous).toBe(2);
  });

  // A plan can face a panel twice — `a-waiting-loop-has-not-finished` was the
  // rewrite of a plan a panel had already rejected, and both were rounds. The
  // count must keep climbing rather than reset.
  it('keeps climbing across repeated interrogations', () => {
    let current = '1';
    for (const expected of [2, 3, 4]) {
      const out = plan({ current });
      if (!isDecision(out)) throw new Error('expected a decision');
      expect(out.rounds).toBe(expected);
      current = String(out.rounds);
    }
  });

  it('reads a padded field rather than refusing it', () => {
    const out = plan({ current: '  3  ' });
    if (!isDecision(out)) throw new Error('expected a decision');
    expect(out.rounds).toBe(4);
  });
});

describe('recordRound — the five refusals', () => {
  // `docs/plans/` holds decision logs and worker reports. The estate states
  // this rule twice already, in plot-reconcile-scan.sh and plot-fleet-scan.sh:
  // a file with no `State:` is not a plan.
  it('refuses a file that declares no phase', () => {
    const out = plan({ phase: '' });
    if (!isRefusal(out)) throw new Error('expected a refusal');
    expect(out.reason).toBe('not-a-plan');
    expect(out.detail).toContain('decision log');
  });

  // Measured over the 112 plans carrying the field: 96 Released, 8 Rejected,
  // 4 Delivered, 2 Superseded. The gate governs what may be ADDED — every one
  // of those records stays where it is.
  for (const phase of ['delivered', 'released', 'rejected', 'superseded']) {
    it(`refuses a ${phase} plan — the interrogation is history`, () => {
      const out = plan({ phase, current: '2' });
      if (!isRefusal(out)) throw new Error('expected a refusal');
      expect(out.reason).toBe('phase-terminal');
    });
  }

  it('accepts a plan that is approved but not yet delivered', () => {
    const out = plan({ phase: 'approved', current: '1' });
    expect(isDecision(out)).toBe(true);
  });

  it('reads the phase without regard to case', () => {
    const out = plan({ phase: 'Released', current: '1' });
    if (!isRefusal(out)) throw new Error('expected a refusal');
    expect(out.reason).toBe('phase-terminal');
  });

  // A field that cannot be read is a defect to report. Overwriting it would
  // destroy the evidence, which is why this refuses rather than resetting.
  it('refuses a count that is not a number', () => {
    const out = plan({ current: 'two' });
    if (!isRefusal(out)) throw new Error('expected a refusal');
    expect(out.reason).toBe('count-unparseable');
    expect(out.detail).toContain('destroy the evidence');
  });

  // `0` means questioned to no effect; the template omits the line instead.
  // Incrementing it would invent a first round that never happened.
  it('refuses a recorded zero rather than incrementing it', () => {
    const out = plan({ current: '0' });
    if (!isRefusal(out)) throw new Error('expected a refusal');
    expect(out.reason).toBe('zero-rounds');
  });

  // The moderation's existence is a fact the domain cannot measure. It arrives
  // as a reading, the way transitions/plan.ts takes a PR check — a path would
  // only let this rule pretend to verify it.
  it('refuses when the caller reports no moderation', () => {
    const out = plan({
      preconditions: [{ name: 'no moderation written', met: false, detail: '.plot/panels/x/panel.md' }],
    });
    if (!isRefusal(out)) throw new Error('expected a refusal');
    expect(out.reason).toBe('precondition-unmet');
    expect(out.detail).toContain('no moderation written');
  });

  it('records the round when the caller reports one', () => {
    const out = plan({ preconditions: [{ name: 'moderation present', met: true }] });
    expect(isDecision(out)).toBe(true);
  });

  // A caller reporting no moderation is refused whatever the field says.
  // Parsing first would answer `count-unparseable` for a plan whose round
  // never completed, which names the wrong defect.
  it('names the missing moderation, not the broken count, when both hold', () => {
    const out = plan({
      current: 'two',
      preconditions: [{ name: 'no moderation written', met: false }],
    });
    if (!isRefusal(out)) throw new Error('expected a refusal');
    expect(out.reason).toBe('precondition-unmet');
  });

  // And a terminal phase outranks a missing moderation: there is no round to
  // record either way, and the phase is the more specific fact.
  it('names the terminal phase ahead of a missing moderation', () => {
    const out = plan({
      phase: 'released',
      preconditions: [{ name: 'no moderation written', met: false }],
    });
    if (!isRefusal(out)) throw new Error('expected a refusal');
    expect(out.reason).toBe('phase-terminal');
  });
});
