import { describe, it, expect } from 'vitest';
import {
  groupByPlan,
  countdown,
  waitingLabel,
  showPlanHeadings,
  isStartable,
  GROUPS,
} from '../../src/app/components/AgentList.js';
import { GROUP_ORDER } from '../../src/server/fleet.js';
import { ELIGIBLE_NOTE, type AgentRow } from '../../src/contract/schema.js';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'wip', phase: null, group: 'quiet', ageMinutes: 10, note: '', pr: null,
  branchUrl: '', waitingDays: null, ...over,
});

describe('groupByPlan', () => {
  it('groups rows by plan and orders plans by their most urgent row', () => {
    // Otherwise a plan holding one stale branch would outrank a plan whose
    // branch just moved — the opposite of what an age-sorted list is for.
    const rows = [
      row({ branch: 'a', plan: 'fresh', ageMinutes: 5 }),
      row({ branch: 'b', plan: 'stale', ageMinutes: 900 }),
      row({ branch: 'c', plan: 'fresh', ageMinutes: 3 }),
    ];
    expect(groupByPlan(rows).map((g) => g.plan)).toEqual(['stale', 'fresh']);
  });

  it('keeps each plan\'s rows in the age order they arrived in', () => {
    // `sortRows` already ordered by age descending; grouping must not disturb
    // that INSIDE a plan, only gather it.
    const rows = [
      row({ branch: 'old', plan: 'p', ageMinutes: 300 }),
      row({ branch: 'mid', plan: 'p', ageMinutes: 60 }),
      row({ branch: 'new', plan: 'p', ageMinutes: 2 }),
    ];
    expect(groupByPlan(rows)[0].rows.map((r) => r.branch)).toEqual(['old', 'mid', 'new']);
  });

  it('treats an unknown age as least urgent rather than most', () => {
    // null must not sort to the front: "we do not know" is not "ancient".
    const rows = [
      row({ branch: 'unknown', plan: 'nulls', ageMinutes: null }),
      row({ branch: 'known', plan: 'ages', ageMinutes: 1 }),
    ];
    expect(groupByPlan(rows).map((g) => g.plan)).toEqual(['ages', 'nulls']);
  });

  it('returns one group for rows that all share a plan', () => {
    // The caller uses the COUNT to decide whether a sub-heading earns its place.
    const groups = groupByPlan([row({ branch: 'a' }), row({ branch: 'b' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('returns nothing for no rows', () => {
    expect(groupByPlan([])).toEqual([]);
  });
});

describe('group order — actionable before diagnostic', () => {
  it('puts NOT STARTED above QUIET', () => {
    // Work a person can pick up right now outranks work they must go
    // investigate: not-started offers an opportunity, quiet assigns an errand.
    const keys = GROUPS.map((g) => g.key);
    expect(keys.indexOf('not-started')).toBeLessThan(keys.indexOf('quiet'));
  });

  it('renders groups in exactly the order the server sorts rows into', () => {
    // Two arrays that must agree is precisely the duplication that drifts in a
    // later refactor — and a disagreement would sort rows into one sequence and
    // render the sections in another, which reads as rows landing in the wrong
    // group rather than as two lists disagreeing.
    expect(GROUPS.map((g) => g.key)).toEqual(GROUP_ORDER);
  });
});

describe('waitingLabel', () => {
  it('scales the unit so a wait never reads "180d"', () => {
    // The same defect humanAge fixed for commit ages: past a couple of months,
    // days are arithmetic the reader has to do.
    expect(waitingLabel(3)).toBe('3d');
    expect(waitingLabel(45)).toBe('45d');
    expect(waitingLabel(60)).toBe('2mo');
    expect(waitingLabel(180)).toBe('6mo');
  });

  it('says "today" rather than "0d"', () => {
    // A plan approved this morning has not been waiting a measurable stretch,
    // and "0d" reads like a stopped clock.
    expect(waitingLabel(0)).toBe('today');
  });
});

describe('countdown', () => {
  it('counts down from the age toward the interval', () => {
    // The git counter is derived: the client owns FLEET_POLL_MS, so "next in"
    // is the interval minus however much of it has elapsed.
    expect(countdown(1, 4)).toBe(3);
    expect(countdown(3, 4)).toBe(1);
  });

  it('never goes below zero when the age has overrun the interval', () => {
    // A poll can be late — a hidden tab, a slow response. "next in -2s" is not
    // a thing a reader can act on.
    expect(countdown(9, 4)).toBe(0);
    expect(countdown(4, 4)).toBe(0);
  });

  it('is null when the age is unknown', () => {
    expect(countdown(null, 4)).toBeNull();
  });
});

describe('groupByPlan with unplanned rows', () => {
  const row = (branch: string, plan: string) =>
    ({ repo: 'plot', branch, plan, planFile: '', wave: '', state: 'wip',
       group: 'waiting-on-you', ageMinutes: 1, note: '', branchUrl: '',
       pr: null, waitingDays: null }) as never;

  it('keeps unplanned rows together under one nameless group', () => {
    // They share `plan: ''` by construction, so they collapse into one group
    // whose name is empty. That is fine — but the RENDERER must not head it,
    // or it prints a bare "(3)" that labels nothing. Pinned here because the
    // grouping is what makes such a group possible at all.
    const groups = groupByPlan([row('a', ''), row('b', ''), row('c', 'real-plan')]);
    const nameless = groups.find((g) => g.plan === '');
    expect(nameless?.rows).toHaveLength(2);
    expect(groups.filter((g) => g.plan === '')).toHaveLength(1);
  });
});

describe('showPlanHeadings', () => {
  // Both halves of the rule, and each is the case the other version got wrong.
  it('labels several plans, so two names cannot run together unlabelled', () => {
    expect(showPlanHeadings(2, 2)).toBe(true);
  });

  it('labels one plan holding several rows, instead of printing its name on each', () => {
    // The case that motivated grouping: six QUIET rows of one plan. `plans > 1`
    // said no heading, so the plan name appeared six times down the column.
    expect(showPlanHeadings(6, 1)).toBe(true);
  });

  it('stays quiet for a single row, where a heading separates and saves nothing', () => {
    expect(showPlanHeadings(1, 1)).toBe(false);
  });

  it('stays quiet for an empty group', () => {
    expect(showPlanHeadings(0, 0)).toBe(false);
  });
});

describe('isStartable — which NOT STARTED rows offer work', () => {
  const notStarted = (over: Partial<AgentRow> = {}) =>
    row({ group: 'not-started', state: 'open', ageMinutes: null, note: ELIGIBLE_NOTE, ...over });

  it('offers a branch no earlier wave blocks', () => {
    expect(isStartable(notStarted())).toBe(true);
  });

  it('offers NOTHING on a branch blocked by an earlier wave', () => {
    // The load-bearing negative, and the half a naive `group === 'not-started'`
    // implementation gets wrong: the group holds both kinds. A button here
    // would offer to skip the ordering waves exist to express, and
    // plot-dispatch.sh refuses that branch — so the board would be inviting an
    // action the tool declines.
    expect(isStartable(notStarted({ note: 'blocked by an earlier wave' }))).toBe(false);
  });

  it('reads the eligible note from the contract, not from a copy of the sentence', () => {
    // The split survives onto a row only as this note — the row carries no
    // verdict field. A second copy of the sentence would let a reword take the
    // button away with nothing failing, so the test asserts the SHARED
    // constant is what the row is matched against.
    expect(isStartable(notStarted({ note: ELIGIBLE_NOTE }))).toBe(true);
    expect(isStartable(notStarted({ note: `${ELIGIBLE_NOTE} (probably)` }))).toBe(false);
  });

  it('offers nothing on a row that already has a branch and a claim', () => {
    // Working and quiet rows are somebody's already. Offering to start one
    // invites exactly the double-dispatch fleet-sees-merged-branches prevents.
    for (const group of ['working', 'quiet', 'waiting-on-you', 'done'] as const) {
      expect(isStartable(row({ group, state: 'open', note: ELIGIBLE_NOTE }))).toBe(false);
    }
  });

  it('offers nothing on a deferred branch, whatever group it lands in', () => {
    // Deferred rows are `not-started` by group — nobody is working on them —
    // but the work was handed back deliberately, not left untaken. Starting it
    // is a decision about whether the branch is wanted at all, which is not
    // what this button does.
    expect(isStartable(row({ group: 'not-started', state: 'deferred', note: ELIGIBLE_NOTE })))
      .toBe(false);
  });
});
