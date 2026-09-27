import { describe, it, expect } from 'vitest';
import {
  OWES_A_PERSON,
  owesAPerson,
  supervisionCauseWord,
  reportedCause,
  FLEET_TICK_STALE_SECONDS,
  type SupervisionCause,
} from '../src/index.js';

/**
 * Who owes a desk with no live worker — asserted with NO BROWSER, NO BOARD, NO
 * SHELL.
 *
 * The defect, measured 2026-09-27: three causes produce one appearance. A desk
 * deferred on `no-headroom`, one the fleet is restarting after `no-progress`, and
 * one that has spent its correction budget all look identical — a desk, a claim,
 * no live pid — and `/api/fleet` was 31,240 bytes over 22 rows with no cause
 * field anywhere. An operator intervened on two such desks that day; the fleet
 * had already restarted one and correctly deferred the other.
 */

const ALL: readonly SupervisionCause[] = [
  'worker-alive',
  'gates-passed',
  'gates-failed',
  'declaration-absent',
  'declaration-unreadable',
  'agent-blocked',
  'budget-spent',
  'no-progress',
  'no-headroom',
];

describe('OWES_A_PERSON — the mapping is the rule', () => {
  it('answers every one of the nine causes', () => {
    // THE KEY SET IS THE CONTRACT, and a record rather than a string test is
    // what makes a tenth cause fail the build instead of defaulting to false.
    // Asserted as a set so a cause added to the type with no entry here is
    // caught by a test as well as by tsc.
    expect(Object.keys(OWES_A_PERSON).sort()).toEqual([...ALL].sort());
  });

  it('names the four that leave nothing automatic', () => {
    expect(owesAPerson('budget-spent')).toBe(true);
    expect(owesAPerson('agent-blocked')).toBe(true);
    expect(owesAPerson('declaration-absent')).toBe(true);
    expect(owesAPerson('declaration-unreadable')).toBe(true);
  });

  it('leaves the fleet the ones the fleet still serves', () => {
    expect(owesAPerson('no-headroom')).toBe(false);
    expect(owesAPerson('worker-alive')).toBe(false);
    expect(owesAPerson('gates-passed')).toBe(false);
    expect(owesAPerson('gates-failed')).toBe(false);
  });

  /**
   * THE CONTESTED ENTRY, NAMED EXPLICITLY because it decides most rows.
   *
   * Measured across both registry logs to 2026-09-27: `no-progress` 1200,
   * `no-headroom` 1122, `budget-spent` 498, and zero for the other six. At 60%
   * of all emissions this one entry answers the majority of desks, so it gets
   * its own test rather than a line in a table above.
   *
   * It is `false` because it is what the fleet RESTARTS on, and `budget-spent`
   * is the transition to a person. A `no-progress` desk routed to a person
   * would send them to a desk the supervisor is already handling.
   */
  it('does not charge a person for no-progress, and does for budget-spent', () => {
    expect(owesAPerson('no-progress')).toBe(false);
    expect(owesAPerson('budget-spent')).toBe(true);
  });

  it('reads an unjudged desk as owing nothing, and that is not a cause', () => {
    // ABSENT IS NOT FALSE, and here the two coincide without meaning the same
    // thing: null owes nobody because nothing was measured, not because the
    // desk is fine. The caller must not render a word for it — `reportedCause`
    // below is what keeps null out of the renderer.
    expect(owesAPerson(null)).toBe(false);
  });
});

describe('supervisionCauseWord — every cause has a word a reader can act on', () => {
  it('answers all nine, with no empty string', () => {
    for (const cause of ALL) {
      expect(supervisionCauseWord(cause), cause).not.toBe('');
    }
  });

  it('says what the fleet is doing, not what the mechanism is called', () => {
    // `waiting for room` rather than `deferred`: the first tells an operator to
    // do nothing, the second names a mechanism they must interpret.
    expect(supervisionCauseWord('no-headroom')).toBe('waiting for room');
    expect(supervisionCauseWord('no-progress')).toBe('restarting');
  });

  it('says the three that want a person as demands', () => {
    expect(supervisionCauseWord('budget-spent')).toBe('out of attempts');
    expect(supervisionCauseWord('agent-blocked')).toBe('blocked, asked you');
    expect(supervisionCauseWord('declaration-absent')).toBe('declaration missing');
  });
});

describe('reportedCause — a stale report is not current', () => {
  const now = 1_000_000_000;

  it('carries a fresh cause', () => {
    expect(reportedCause({ at: now - 30_000, cause: 'no-headroom' }, now)).toBe('no-headroom');
  });

  /**
   * THE PERSISTED-VERDICT FAILURE, which is the one this record could have
   * reproduced. `fleet.ts` refuses to present a recorded answer as a current
   * one, and a cause is a statement about a desk NOW: a `no-headroom` from
   * hours ago says nothing about whether the machine has headroom, because the
   * whole point of that cause is that the next tick re-asks it.
   *
   * Dropped rather than aged down, so a reader cannot act on it at all.
   */
  it('drops a cause older than the bound', () => {
    const stale = now - (FLEET_TICK_STALE_SECONDS + 1) * 1_000;
    expect(reportedCause({ at: stale, cause: 'budget-spent' }, now)).toBeNull();
  });

  it('drops one exactly at the bound', () => {
    const atBound = now - FLEET_TICK_STALE_SECONDS * 1_000;
    expect(reportedCause({ at: atBound, cause: 'budget-spent' }, now)).toBeNull();
  });

  it('reads a report with no clock as unusable', () => {
    // A report that cannot prove it is fresh is not fresh. Carrying the cause
    // anyway would be exactly the stale-as-current move above.
    expect(reportedCause({ at: null, cause: 'no-headroom' }, now)).toBeNull();
  });

  it('keeps a report from the future rather than calling it stale', () => {
    // A clock adjustment between the daemon's write and the board's read is not
    // the failure this guards, and discarding a report for being too new would
    // drop a fresh one.
    expect(reportedCause({ at: now + 5_000, cause: 'no-headroom' }, now)).toBe('no-headroom');
  });

  it('answers null where the tick judged no such desk', () => {
    expect(reportedCause({ at: now, cause: null }, now)).toBeNull();
  });
});
