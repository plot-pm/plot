import { describe, it, expect } from 'vitest';
import { groupByPlan } from '../../src/app/components/AgentList.js';
import { type AgentRow } from '../../src/contract/schema.js';

/**
 * `groupByPlan` orders plans of EQUAL AGE by name — the tiebreak #267 landed
 * for NOT STARTED, applied where the same defect had been sitting unexamined.
 *
 * The finding is the reason this is its own file. The flicker was found,
 * diagnosed, fixed and merged in NOT STARTED's own comparator
 * (`sortByWaiting`), and the identical line sat four hundred lines away in the
 * same file: `groupByPlan`'s `Math.max(...rows.map((r) => r.ageMinutes ?? -1))`,
 * ordering the plan groups of the OTHER five sections — WAITING ON YOU among
 * them — on a coarse key with no tiebreak behind it. Nobody had watched *this*
 * section reshuffle. **A fix is not finished when the reported instance stops.**
 *
 * Why the fix is in `groupByPlan` and not scoped to WAITING ON YOU: the
 * function serves every section but NOT STARTED, which re-sorts its output
 * through `sortByWaiting`. A tiebreak scoped to the one reported section would
 * leave the identical flicker in WORKING, WAITING ON A MACHINE, QUIET and DONE
 * — repeating the mistake this branch exists to close.
 *
 * The two clocks are deliberately different and both are coarse:
 * `sortByWaiting` keys on `waitingDays` (the plan's approval clock, moving at
 * midnight), `groupByPlan` on `ageMinutes` (the branch tip's clock). Neither is
 * fine enough to separate the rows a real pulse carries.
 */
const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'wip', phase: null, group: 'waiting-on-you', ageMinutes: 10,
  waitingOn: 'click' as const, note: '', pr: null, branchUrl: '',
  localDirty: false, localLocked: false,
  ...over,
});

describe('groupByPlan — plans of equal age order by name', () => {
  it('orders plans of the SAME age by name, so the list holds still', () => {
    // THE DEFECT. `ageMinutes` is a coarse key: the WAITING ON YOU rows of one
    // pulse routinely share an age, so those comparisons return 0 and the
    // surviving order is whatever the Map's insertion order happened to be.
    //
    // `Array.prototype.sort` is stable since ES2019, so it faithfully preserves
    // that arrival order. The arrival order is what is not stable — it is
    // rebuilt from a fresh scan every four seconds. Stability preserving an
    // unstable input is why this looks like a sorting bug and is not one.
    //
    // Passed in deliberately unsorted, so a comparator that only compares age
    // returns them in THIS order and fails.
    const groups = groupByPlan([
      row({ plan: 'zebra', branch: 'a', ageMinutes: 30 }),
      row({ plan: 'alpha', branch: 'b', ageMinutes: 30 }),
      row({ plan: 'mango', branch: 'c', ageMinutes: 30 }),
    ]);
    expect(groups.map((g) => g.plan)).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('holds that order across pulses, whatever order the rows arrive in', () => {
    // What the reader actually experiences. The same three plans, delivered in
    // three different arrival orders the way three consecutive scans would, must
    // render identically — otherwise a row clicked at the moment of a pulse can
    // be a different row than the one aimed at.
    const plans = ['zebra', 'alpha', 'mango'];
    const pulses = [
      ['zebra', 'alpha', 'mango'],
      ['mango', 'zebra', 'alpha'],
      ['alpha', 'mango', 'zebra'],
    ];
    const rendered = pulses.map((order) =>
      groupByPlan(order.map((plan, i) => row({ plan, branch: `b${i}`, ageMinutes: 30 })))
        .map((g) => g.plan),
    );
    expect(rendered).toEqual([plans.slice().sort(), plans.slice().sort(), plans.slice().sort()]);
  });

  it('leaves the age ordering unchanged where ages DIFFER', () => {
    // The tiebreak is a TIEBREAK. `alpha` sorts first alphabetically and must
    // still sit below the plan holding the older row, or the grouping stops
    // answering the question it exists for: which plan has the most urgent row.
    const groups = groupByPlan([
      row({ plan: 'alpha', branch: 'a', ageMinutes: 5 }),
      row({ plan: 'zebra', branch: 'b', ageMinutes: 500 }),
    ]);
    expect(groups.map((g) => g.plan)).toEqual(['zebra', 'alpha']);
  });

  it('still ranks a plan by its MOST URGENT row, not by its name', () => {
    // The pre-existing rule the tiebreak must not disturb: a plan holding one
    // stale branch outranks one whose branch just moved, and it is the max over
    // the plan's rows that decides — not the first row, and not the name.
    const groups = groupByPlan([
      row({ plan: 'zebra', branch: 'a', ageMinutes: 1 }),
      row({ plan: 'zebra', branch: 'b', ageMinutes: 900 }),
      row({ plan: 'alpha', branch: 'c', ageMinutes: 100 }),
    ]);
    expect(groups.map((g) => g.plan)).toEqual(['zebra', 'alpha']);
  });

  it('orders plans of UNKNOWN age by name too, keeping them last', () => {
    // Rows with no tip all score -1, so they are the population most exposed to
    // this — and "we do not know" is not "ancient", so they stay last as a
    // group, which the comparator's own note requires.
    const groups = groupByPlan([
      row({ plan: 'yak', branch: 'a', ageMinutes: null }),
      row({ plan: 'bison', branch: 'b', ageMinutes: null }),
      row({ plan: 'dated', branch: 'c', ageMinutes: 2 }),
    ]);
    expect(groups.map((g) => g.plan)).toEqual(['dated', 'bison', 'yak']);
  });

  it('keeps each plan\'s ROWS in the order the server sent them', () => {
    // Two levels, two questions — the same split `sortByWaiting` records. The
    // tiebreak orders the GROUPS; the server's row order inside a group answers
    // *which branch do I pick up* and survives untouched.
    const groups = groupByPlan([
      row({ plan: 'alpha', branch: 'newest', ageMinutes: 1 }),
      row({ plan: 'alpha', branch: 'middle', ageMinutes: 50 }),
      row({ plan: 'alpha', branch: 'oldest', ageMinutes: 900 }),
    ]);
    expect(groups[0].rows.map((r) => r.branch)).toEqual(['newest', 'middle', 'oldest']);
  });
});
