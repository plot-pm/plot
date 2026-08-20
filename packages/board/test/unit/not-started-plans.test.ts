import { describe, it, expect } from 'vitest';
import {
  isUnbegun,
  planWaitingDays,
  sortByWaiting,
  waveSummaryFor,
  showsWaveFold,
  groupByPlan,
  type PlanGroup,
} from '../../src/app/components/AgentList.js';
import { ELIGIBLE_NOTE, type AgentRow } from '../../src/contract/schema.js';

/**
 * NOT STARTED counts PLANS — the decisions, as pure functions.
 *
 * The section's rows are not branches. Measured on the live board of
 * 2026-08-17, every one of them carried `pr=—` and `age=—`, because the name
 * came out of the plan's `## Branches` section and no branch was ever created
 * for it: **6 rows for 4 plans**, with `activity-shows-itself` appearing three
 * times for one waiting plan. Compare WAITING ON YOU in the same pulse — 4 rows,
 * all 4 with a real PR and a real age — where the branch IS the subject.
 *
 * What only a browser can settle (the fold's interaction, the grid alignment)
 * lives in `test/integration/not-started-plans.browser.test.ts`. What is here is
 * every decision that reduces to a function.
 */
const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: null, group: 'not-started', ageMinutes: null,
  // The FIELD is what the code reads; the note rides along because that is
  // what the server sends beside it.
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false,
  ...over,
});

/** A group built the way the view builds it — through `groupByPlan`. */
const groupOf = (...rows: AgentRow[]): PlanGroup => groupByPlan(rows)[0];

describe('isUnbegun — a branch that is a name and nothing else', () => {
  it('is true for the open rows that made up the section', () => {
    // The measured shape: no PR, no tip, a name from the plan file.
    expect(isUnbegun(row({ state: 'open' }))).toBe(true);
  });

  it('is FALSE for a deferred branch, which was started and then shelved', () => {
    // The pairing that matters, and the half a naive "group by plan" erases.
    // `fleet.ts` records the cost of flattening it: "a branch started and then
    // shelved read as never begun, with its age and its PR erased."
    expect(isUnbegun(row({ state: 'deferred' }))).toBe(false);
  });

  it('is false outside the section, whatever the state says', () => {
    // `state === 'open'` occurs elsewhere; this predicate is about the rows of
    // ONE section, and applying it across the fleet would fold branches whose
    // subject is rightly the branch.
    expect(isUnbegun({ group: 'quiet', state: 'open' })).toBe(false);
    expect(isUnbegun({ group: 'waiting-on-you', state: 'open' })).toBe(false);
  });
});

describe('planWaitingDays — the plan clock, read off the group', () => {
  it('reads the plan\'s own wait rather than the branch clock that is not there', () => {
    // `plot-sprint-support` carries 187 days on a branch with no tip at all.
    const group = groupOf(row({ plan: 'plot-sprint-support', waitingDays: 187 }));
    expect(planWaitingDays(group)).toBe(187);
  });

  it('survives one row of the plan carrying no date', () => {
    // A deferred branch beside unstarted ones need not carry the field; taking
    // the largest keeps a recorded date from being lost behind a null.
    const group = groupOf(
      row({ branch: 'a', waitingDays: null }),
      row({ branch: 'b', waitingDays: 42 }),
    );
    expect(planWaitingDays(group)).toBe(42);
  });

  it('is NULL where nothing is dated, never zero', () => {
    // The half an implementation reaching for `?? 0` gets wrong: `waitingLabel(0)`
    // renders "today", which would claim an approval date nobody recorded.
    const group = groupOf(row({ waitingDays: null }));
    expect(planWaitingDays(group)).toBeNull();
  });
});

describe('sortByWaiting — oldest plan first', () => {
  it('puts a plan approved 187 days ago above one approved today', () => {
    // The defect exactly. `groupByPlan` scores every group here
    // `Math.max(...ageMinutes ?? -1)` = -1, so the comparator returns 0 for
    // every pair and the sort does NOTHING — `plot-sprint-support` sat wherever
    // insertion order put it, beside a plan from that afternoon.
    const groups = groupByPlan([
      row({ plan: 'fresh', branch: 'a', waitingDays: 0 }),
      row({ plan: 'plot-sprint-support', branch: 'b', waitingDays: 187 }),
    ]);
    expect(sortByWaiting(groups).map((g) => g.plan)).toEqual(['plot-sprint-support', 'fresh']);
  });

  it('orders plans of the SAME age by name, so the list holds still', () => {
    // THE MEASURED DEFECT, 2026-08-20: the NOT STARTED section reordered on
    // almost every 4 s pulse. Waiting days is a coarse key — most plans here
    // were approved the same day — so most comparisons return 0 and the
    // surviving order is whatever `groups` arrived in.
    //
    // `Array.prototype.sort` is stable since ES2019, so it faithfully preserves
    // that arrival order. The arrival order is what is not stable: it is
    // rebuilt from a fresh scan every pulse. Stability preserved an unstable
    // input, which is why this looked like a sorting bug and was not one.
    //
    // Passed in deliberately unsorted, so a comparator that only compares
    // waiting days returns them in THIS order and fails.
    const groups = groupByPlan([
      row({ plan: 'zebra', branch: 'a', waitingDays: 3 }),
      row({ plan: 'alpha', branch: 'b', waitingDays: 3 }),
      row({ plan: 'mango', branch: 'c', waitingDays: 3 }),
    ]);
    expect(sortByWaiting(groups).map((g) => g.plan))
      .toEqual(['alpha', 'mango', 'zebra']);
  });

  it('keeps age above the name — a name never promotes a younger plan', () => {
    // The tiebreak is a TIEBREAK. `alpha` sorts first alphabetically and must
    // still sit below a plan that has waited longer, or the section stops
    // answering the question it exists for.
    const groups = groupByPlan([
      row({ plan: 'alpha', branch: 'a', waitingDays: 1 }),
      row({ plan: 'zebra', branch: 'b', waitingDays: 90 }),
    ]);
    expect(sortByWaiting(groups).map((g) => g.plan)).toEqual(['zebra', 'alpha']);
  });

  it('orders UNDATED plans by name too, keeping them last', () => {
    // Undated plans all score -1, so they are the population most exposed to
    // this — and they sort last as a group, which the comparator's own note
    // requires.
    const groups = groupByPlan([
      row({ plan: 'yak', branch: 'a', waitingDays: null }),
      row({ plan: 'bison', branch: 'b', waitingDays: null }),
      row({ plan: 'dated', branch: 'c', waitingDays: 2 }),
    ]);
    expect(sortByWaiting(groups).map((g) => g.plan))
      .toEqual(['dated', 'bison', 'yak']);
  });

  it('does not sort startable-first', () => {
    // Considered and rejected: it reads as more actionable and buys less. The
    // startable plans are already marked by their own note, and burying a
    // six-month-old plan under a fresh one hides exactly the drift this section
    // exists to surface. The pairing that matters — the fresh plan here is the
    // ELIGIBLE one, so a startable-first sort would invert this.
    const groups = groupByPlan([
      row({ plan: 'old-and-blocked', branch: 'a', waitingDays: 180, waitingOn: 'time', note: 'blocked by Truth' }),
      row({ plan: 'fresh-and-eligible', branch: 'b', waitingDays: 1, note: ELIGIBLE_NOTE }),
    ]);
    expect(sortByWaiting(groups).map((g) => g.plan)).toEqual(['old-and-blocked', 'fresh-and-eligible']);
  });

  it('sorts an undated plan LAST rather than above one approved today', () => {
    // -1 would claim a wait nobody measured, and put it above a real one.
    const groups = groupByPlan([
      row({ plan: 'undated', branch: 'a', waitingDays: null }),
      row({ plan: 'today', branch: 'b', waitingDays: 0 }),
      row({ plan: 'ancient', branch: 'c', waitingDays: 200 }),
    ]);
    expect(sortByWaiting(groups).map((g) => g.plan)).toEqual(['ancient', 'today', 'undated']);
  });

  it('does not mutate the array it was given', () => {
    // The caller renders `groupByPlan`'s output for five other sections; a sort
    // in place would reorder a list those share.
    const groups = groupByPlan([
      row({ plan: 'fresh', branch: 'a', waitingDays: 1 }),
      row({ plan: 'old', branch: 'b', waitingDays: 90 }),
    ]);
    const before = groups.map((g) => g.plan);
    sortByWaiting(groups);
    expect(groups.map((g) => g.plan)).toEqual(before);
  });
});

describe('waveSummaryFor — counted from the group\'s own rows', () => {
  it('names how many waves remain and that the first is eligible', () => {
    // `activity-shows-itself`, the plan that printed three identical rows.
    const group = groupOf(
      row({ plan: 'activity-shows-itself', branch: 'feature/activity-marker-glows', note: ELIGIBLE_NOTE }),
      row({ plan: 'activity-shows-itself', branch: 'feature/group-shows-inner-activity', waitingOn: 'time', note: 'blocked by Truth' }),
      row({ plan: 'activity-shows-itself', branch: 'feature/unpushed-work-shows-still', waitingOn: 'time', note: 'blocked by Truth' }),
    );
    expect(waveSummaryFor(group)).toBe('3 waves, first eligible');
  });

  it('omits "first eligible" where nothing in the plan can be started', () => {
    // The summary must not promise an action the row menu then refuses — it
    // reads `isStartable`, the same predicate the menu does.
    const group = groupOf(
      row({ branch: 'a', waitingOn: 'time', note: 'blocked by Truth' }),
      row({ branch: 'b', waitingOn: 'time', note: 'blocked by Truth' }),
    );
    expect(waveSummaryFor(group)).toBe('2 waves');
  });

  it('says "1 wave", not "1 waves"', () => {
    expect(waveSummaryFor(groupOf(row()))).toBe('1 wave, first eligible');
  });

  it('counts only what is in THIS SECTION', () => {
    // The limit, recorded rather than hidden. A plan whose first wave already
    // merged has that wave in DONE, so the section reports the REMAINDER — two
    // where the plan file lists three. That is the honest number for the
    // question the section asks, and the plan link carries the full arc.
    const group = groupOf(
      row({ plan: 'partly-done', branch: 'wave-2' }),
      row({ plan: 'partly-done', branch: 'wave-3' }),
    );
    expect(waveSummaryFor(group)).toBe('2 waves, first eligible');
  });

  it('does not count a deferred branch as an unstarted wave', () => {
    // It gets a row of its own with its own PR and age, so counting it here
    // would describe it twice and in the wrong terms: not a wave nobody reached,
    // a branch somebody set down.
    const group = groupOf(
      row({ branch: 'never-begun' }),
      row({ branch: 'shelved', state: 'deferred', ageMinutes: 400, note: 'last commit 6h ago' }),
    );
    expect(waveSummaryFor(group)).toBe('1 wave, first eligible');
  });

  it('is empty where a plan holds nothing but a deferred branch', () => {
    // Nothing to summarise — the caller renders no summary rather than "0 waves".
    const group = groupOf(row({ state: 'deferred', ageMinutes: 400 }));
    expect(waveSummaryFor(group)).toBe('');
  });

  it('adds no field to the contract to carry any of this', () => {
    // `waveSummary` on the schema lives on the CARD; a fleet row knows only its
    // own wave. The group already HOLDS every row of the plan, so the count is
    // derived — this pins that the summary reads nothing a row does not carry.
    const group = groupOf(row(), row({ branch: 'b' }));
    const fields = new Set(Object.keys(group.rows[0]));
    expect(fields.has('waveSummary')).toBe(false);
    expect(waveSummaryFor(group)).toBe('2 waves, first eligible');
  });
});

describe('showsWaveFold — an expander only where it reveals something', () => {
  it('gives a plan with three unstarted waves a fold', () => {
    expect(showsWaveFold(groupOf(row({ branch: 'a' }), row({ branch: 'b' }), row({ branch: 'c' }))))
      .toBe(true);
  });

  it('gives a plan with ONE unstarted wave none', () => {
    // A control that reveals a row it already shows is noise — the same rule
    // `showPlanHeading` applies one level up.
    expect(showsWaveFold(groupOf(row()))).toBe(false);
  });

  it('gives a fold to one unstarted wave beside a deferred branch', () => {
    // Two rows to show, and the deferred one carries a PR and an age that appear
    // nowhere else — counting only the unbegun rows would hide it behind no
    // control at all.
    expect(showsWaveFold(groupOf(
      row({ branch: 'never-begun' }),
      row({ branch: 'shelved', state: 'deferred', ageMinutes: 400 }),
    ))).toBe(true);
  });
});
