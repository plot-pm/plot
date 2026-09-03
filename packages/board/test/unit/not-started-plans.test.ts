import {
  describe,
  it,
  expect } from 'vitest';
import { groupByPlan, planWaitingDays, showsWaveFold, sortByWaiting, type PlanGroup, ungroupedRows, waveGroupsFor, waveSummaryFor } from '../../src/app/lib/agent-rows/sections.js';
import { groupByWave } from '../../src/app/lib/agent-rows/waves.js';
import { isUnbegun } from '../../src/app/lib/agent-rows/row-identity.js';
import { ELIGIBLE_NOTE, type AgentRow, type Wave } from '../../src/contract/schema.js';

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
  // Default: eligible, open branch with brief → startable.
  startability: 'start-work' as const,
  ...over,
});

/** A group built the way the view builds it — through `groupByPlan`. */
const groupOf = (...rows: AgentRow[]): PlanGroup => groupByPlan(rows)[0];

/**
 * A server-derived `Wave` the way `deriveWaves` writes it, for the head that
 * now reads `fleet.waves` rather than re-grouping rows. Defaults to an
 * unstarted, incomplete wave — the shape the count summarises.
 */
const wave = (over: Partial<Wave> = {}): Wave => ({
  plan: 'a-plan', name: 'w', branches: ['feature/x'],
  verdict: 'eligible', section: 'not-started', complete: false,
  ...over,
});

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
      row({ plan: 'old-and-blocked', branch: 'a', waitingDays: 180, waitingOn: 'time', note: 'blocked by Truth', startability: null }),
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
    // THREE DISTINCT WAVES, and the `wave` field is what makes them three.
    // These rows carried three branch names and ONE wave (`w`, the fixture
    // default) until 2026-08-20, and counted as three while the count was of
    // ROWS. It is now of waves, so the fixture has to say what it means — a plan
    // with three branches in one wave is one wave, which is the reading
    // `groupByWave` enforces and the one the estate's five-branch wave needs.
    const group = groupOf(
      row({ plan: 'activity-shows-itself', wave: 'Shaped', branch: 'feature/activity-marker-glows', note: ELIGIBLE_NOTE }),
      row({ plan: 'activity-shows-itself', wave: 'Marked', branch: 'feature/group-shows-inner-activity', waitingOn: 'time', note: 'blocked by Truth', startability: null }),
      row({ plan: 'activity-shows-itself', wave: 'Moved', branch: 'feature/unpushed-work-shows-still', waitingOn: 'time', note: 'blocked by Truth', startability: null }),
    );
    expect(waveSummaryFor(group)).toBe('3 slices, first eligible');
  });

  it('omits "first eligible" where nothing in the plan can be started', () => {
    // The summary must not promise an action the row menu then refuses — it
    // reads `isStartable`, the same predicate the menu does.
    const group = groupOf(
      row({ wave: 'Marked', branch: 'a', waitingOn: 'time', note: 'blocked by Truth', startability: null }),
      row({ wave: 'Moved', branch: 'b', waitingOn: 'time', note: 'blocked by Truth', startability: null }),
    );
    expect(waveSummaryFor(group)).toBe('2 slices');
  });

  it('says "1 slice", not "1 slices"', () => {
    expect(waveSummaryFor(groupOf(row()))).toBe('1 slice, first eligible');
  });

  it('counts only what is in THIS SECTION', () => {
    // The limit, recorded rather than hidden. A plan whose first wave already
    // merged has that wave in DONE, so the section reports the REMAINDER — two
    // where the plan file lists three. That is the honest number for the
    // question the section asks, and the plan link carries the full arc.
    const group = groupOf(
      row({ plan: 'partly-done', wave: 'Second', branch: 'wave-2' }),
      row({ plan: 'partly-done', wave: 'Third', branch: 'wave-3' }),
    );
    expect(waveSummaryFor(group)).toBe('2 slices, first eligible');
  });

  it('does not count a deferred branch as an unstarted wave', () => {
    // It gets a row of its own with its own PR and age, so counting it here
    // would describe it twice and in the wrong terms: not a wave nobody reached,
    // a branch somebody set down.
    const group = groupOf(
      row({ wave: 'Shaped', branch: 'never-begun' }),
      row({ wave: 'Shelved', branch: 'shelved', state: 'deferred', ageMinutes: 400, note: 'last commit 6h ago' }),
    );
    expect(waveSummaryFor(group)).toBe('1 slice, first eligible');
  });

  it('is empty where a plan holds nothing but a deferred branch', () => {
    // Nothing to summarise — the caller renders no summary rather than "0 slices".
    const group = groupOf(row({ state: 'deferred', ageMinutes: 400 }));
    expect(waveSummaryFor(group)).toBe('');
  });

  it('falls back to the group\'s rows when no wave list is supplied', () => {
    // The pre-wave-model server sends no `fleet.waves` (and the board CASTS the
    // payload, so the field is `undefined`, not `[]`). Absent that list the head
    // still answers, from the rows it already holds — the derivation stays as
    // the safety net for an older server, not the live path.
    const group = groupOf(row({ wave: 'Shaped' }), row({ wave: 'Moved', branch: 'b' }));
    expect(waveSummaryFor(group, undefined)).toBe('2 slices, first eligible');
  });
});

describe('waveSummaryFor — reads the server Wave, not a re-grouping of rows', () => {
  // THE HEAD ASKS THE WAVE. `the-contract-carries-a-wave` put a server-derived
  // `Wave` on the payload — one entry per (plan, wave), carrying the ONE section
  // the server placed it in. The head's count was re-deriving that from rows via
  // `groupByWave`, a second answer to a question the server already answered.
  // These pin that the count now comes from `fleet.waves`.

  it('counts the plan\'s waves the server placed in THIS section', () => {
    // Two unstarted waves for this plan, plus one the server put in DONE and one
    // that belongs to another plan — neither is counted here. The head reads the
    // server's placement rather than re-grouping the rows in front of it.
    const group = groupOf(
      row({ plan: 'p', wave: 'First', branch: 'a' }),
      row({ plan: 'p', wave: 'Second', branch: 'b' }),
    );
    const waves = [
      wave({ plan: 'p', name: 'First' }),
      wave({ plan: 'p', name: 'Second' }),
      wave({ plan: 'p', name: 'Done', section: 'done', complete: true }),
      wave({ plan: 'other', name: 'Elsewhere' }),
    ];
    expect(waveSummaryFor(group, waves)).toBe('2 slices, first eligible');
  });

  it('counts a multi-branch wave as ONE, from the server entry', () => {
    // A five-branch wave is one `Wave`, so it counts once — the reading the row
    // derivation only reached by re-grouping. The server already collapsed it.
    const group = groupOf(
      row({ plan: 'p', wave: 'Implementation', branch: 'a' }),
      row({ plan: 'p', wave: 'Implementation', branch: 'b' }),
      row({ plan: 'p', wave: 'Implementation', branch: 'c' }),
    );
    const waves = [wave({ plan: 'p', name: 'Implementation', branches: ['a', 'b', 'c'] })];
    expect(waveSummaryFor(group, waves)).toBe('1 slice, first eligible');
  });

  it('counts a not-started wave whose rows are blocked, which the row filter drops', () => {
    // THE DISCRIMINATING CASE. `isUnbegun` counts only `open` rows in
    // not-started; a wave blocked by an earlier one carries `wip` rows there, so
    // the row derivation counts it as ZERO and the summary would vanish. The
    // server placed the wave in not-started all the same — it IS unstarted work,
    // waiting on an earlier wave — so asking the wave counts one where re-grouping
    // the rows counts none. The two answers differ, and the wave's is right.
    const group = groupOf(
      row({ plan: 'p', wave: 'Blocked', branch: 'b', state: 'wip', waitingOn: 'time', note: 'blocked by earlier wave', startability: 'someone-is-on-it' }),
    );
    const waves = [wave({ plan: 'p', name: 'Blocked', verdict: 'blocked' })];
    expect(waveSummaryFor(group, waves)).toBe('1 slice');
  });

  it('reads completeness once — the same answer the DONE section reads', () => {
    // The point is not the value but that there is ONE source. A wave the server
    // marked complete is complete for every consumer; the head does not compute a
    // second completeness from the rows and risk disagreeing.
    const complete = wave({ plan: 'p', name: 'Done', section: 'done', complete: true });
    const open = wave({ plan: 'p', name: 'Open' });
    const group = groupOf(row({ plan: 'p', wave: 'Open', branch: 'b' }));
    // Only the incomplete, not-started wave is summarised here.
    expect(waveSummaryFor(group, [complete, open])).toBe('1 slice, first eligible');
  });
});

describe('showsWaveFold — an expander only where it reveals something', () => {
  it('gives a plan with three unstarted waves a fold', () => {
    expect(showsWaveFold(groupOf(
      row({ wave: 'Shaped', branch: 'a' }),
      row({ wave: 'Marked', branch: 'b' }),
      row({ wave: 'Moved', branch: 'c' }),
    ))).toBe(true);
  });

  it('gives a plan with ONE unstarted wave none', () => {
    // A control that reveals a row it already shows is noise — the same rule
    // `showPlanHeading` applies one level up.
    expect(showsWaveFold(groupOf(row()))).toBe(false);
  });

  it('gives a plan with three branches in ONE wave none', () => {
    // COUNTED IN WAVES, and this is the case the row count got wrong. NOT
    // STARTED renders one row per WAVE, so a plan whose single wave holds three
    // branches has three rows and ONE child row — a fold here promised three and
    // would reveal one. The three branches are disclosed by the WAVE's own fold,
    // one level down.
    //
    // Real: `opus5-longhorizon-hardening :: Implementation` holds five branches.
    expect(showsWaveFold(groupOf(
      row({ wave: 'Implementation', branch: 'a' }),
      row({ wave: 'Implementation', branch: 'b' }),
      row({ wave: 'Implementation', branch: 'c' }),
    ))).toBe(false);
  });

  it('gives a fold to one unstarted wave beside a deferred branch in another', () => {
    // Two rows to show, and the deferred one carries a PR and an age that appear
    // nowhere else — counting only the unbegun rows would hide it behind no
    // control at all.
    //
    // TWO WAVES, and the fixture now says so. A deferred branch sharing a wave
    // with an unbegun one is a different case, pinned below: the wave row is one
    // row, and the deferred branch's PR and age are reached through the WAVE's
    // fold rather than the plan's. Either way it stays reachable, which is the
    // property this test defends.
    expect(showsWaveFold(groupOf(
      row({ wave: 'Shaped', branch: 'never-begun' }),
      row({ wave: 'Shelved', branch: 'shelved', state: 'deferred', ageMinutes: 400 }),
    ))).toBe(true);
  });
});

describe('waveGroupsFor — which sections group by wave, and from which rows', () => {
  const pr = (n: number) => ({ number: n, url: `https://h/pr/${n}`, draft: false, state: 'green' as const });

  it('groups reviewable branches in WAITING ON YOU', () => {
    // *"Technically the PR with branch and the wave is a WAVE"* — in the section
    // that asks *what needs a decision*, where three PRs of one wave are ONE
    // decision about that wave.
    const rows = [
      row({ wave: 'Modelled', branch: 'a', state: 'wip', pr: pr(304) }),
      row({ wave: 'Modelled', branch: 'b', state: 'wip', pr: pr(307) }),
    ];
    const groups = waveGroupsFor(rows, 'waiting-on-you');
    expect(groups).toHaveLength(1);
    expect(groups[0].wave).toBe('Modelled');
    expect(groups[0].rows).toHaveLength(2);
  });

  it('makes a LONE reviewable branch its wave, not a PR', () => {
    // THE REVERSAL, and the reasoning it corrects is my own. This asserted
    // `toHaveLength(0)` on `showsWaveFold`'s rule — *a heading over one row saves
    // no repetition* — which answers a different question. A fold is about
    // saving repetition; a KIND is about what the row is ABOUT, and a branch cut
    // for the wave `Modelled` is that wave's work whether the wave holds one
    // branch or five.
    //
    // Measured on the live board: all **12** waves in WAITING ON YOU hold exactly
    // one branch, so the threshold fired only through the mock's hand-made
    // two-branch wave — a rule reachable only from a fixture.
    const rows = [row({ wave: 'Modelled', branch: 'a', state: 'wip', pr: pr(304) })];
    const groups = waveGroupsFor(rows, 'waiting-on-you');
    expect(groups).toHaveLength(1);
    expect(groups[0].wave).toBe('Modelled');
    // And nothing is left over, so the branch renders once — as its wave.
    expect(ungroupedRows(rows, 'waiting-on-you')).toHaveLength(0);
  });

  it('claims a branch with no PR too — its PLAN is what waits', () => {
    // THE SECOND REVERSAL, and the section is what forced it: WAITING ON YOU
    // holds TWO kinds of wait. A branch with an open PR waits to be MERGED; a
    // branch whose plan is still in review waits to be APPROVED. Both are
    // decisions, and this asserted that only the first counted.
    //
    // Measured on the live board: **12 of the 14** wave-bearing rows here had no
    // PR — all reading `open` with *plan not approved yet — still in review* —
    // so the narrow predicate left the section showing 12 near-identical branch
    // rows where it should show a plan and its waves.
    const rows = [
      row({ wave: 'Modelled', branch: 'a', state: 'wip', pr: pr(304) }),
      row({ wave: 'Modelled', branch: 'b', state: 'open', pr: null }),
    ];
    const groups = waveGroupsFor(rows, 'waiting-on-you');
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.branch)).toEqual(['a', 'b']);
    expect(ungroupedRows(rows, 'waiting-on-you')).toHaveLength(0);
  });

  it('excludes a MERGED branch from WAITING ON YOU', () => {
    // What the predicate still refuses: merged work is done and belongs to DONE.
    // That is the one exclusion the widening kept.
    const rows = [
      row({ wave: 'Modelled', branch: 'a', state: 'wip', pr: pr(304) }),
      row({ wave: 'Modelled', branch: 'b', state: 'merged', pr: pr(300) }),
    ];
    expect(waveGroupsFor(rows, 'waiting-on-you')[0].rows.map((r) => r.branch))
      .toEqual(['a']);
  });

  it('groups stalled branches in QUIET and delivered ones in DONE', () => {
    const stale = [
      row({ wave: 'Batched', branch: 'a', state: 'wip', ageMinutes: 6 * 1440 }),
      row({ wave: 'Batched', branch: 'b', state: 'wip', ageMinutes: 8 * 1440 }),
    ];
    expect(waveGroupsFor(stale, 'quiet')).toHaveLength(1);
    const landed = [
      row({ wave: 'Slows', branch: 'a', state: 'merged' }),
      row({ wave: 'Slows', branch: 'b', state: 'merged' }),
    ];
    expect(waveGroupsFor(landed, 'done')).toHaveLength(1);
    // And DONE does not claim an unmerged branch, nor QUIET a merged one — each
    // section counts what its own word means.
    expect(waveGroupsFor(stale, 'done')).toHaveLength(0);
    expect(waveGroupsFor(landed, 'quiet')).toHaveLength(0);
  });

  it('groups NOTHING in WORKING or WAITING ON A MACHINE', () => {
    // An agent works and a build runs; neither is a wave. A wave row in either
    // would claim a subject that section does not have — the grammar
    // `every-section-has-one-subject` settles it.
    const rows = [
      row({ wave: 'Modelled', branch: 'a', state: 'wip', pr: pr(304) }),
      row({ wave: 'Modelled', branch: 'b', state: 'wip', pr: pr(307) }),
    ];
    expect(waveGroupsFor(rows, 'working')).toHaveLength(0);
    expect(waveGroupsFor(rows, 'waiting-on-machine')).toHaveLength(0);
    // …and every row then renders as itself, so nothing is lost.
    expect(ungroupedRows(rows, 'working')).toHaveLength(2);
  });

  it('skips an unnamed wave rather than heading a group `(unnamed)`', () => {
    // A label that labels nothing — the same reason `showPlanHeading` refuses a
    // nameless plan.
    const rows = [
      row({ wave: '', branch: 'a', state: 'wip', pr: pr(1) }),
      row({ wave: '', branch: 'b', state: 'wip', pr: pr(2) }),
    ];
    expect(waveGroupsFor(rows, 'waiting-on-you')).toHaveLength(0);
  });

  it('renders every row exactly once, grouped or not', () => {
    // The property that matters: `ungroupedRows` is the complement of
    // `waveGroupsFor` over the same input, computed from the claimed SET rather
    // than by re-deriving the predicate — two spellings of *which rows are
    // grouped* is how a row ends up rendered twice or not at all.
    const rows = [
      row({ wave: 'Modelled', branch: 'a', state: 'wip', pr: pr(304) }),
      row({ wave: 'Modelled', branch: 'b', state: 'wip', pr: pr(307) }),
      row({ wave: 'Alone', branch: 'c', state: 'wip', pr: pr(9) }),
      row({ wave: '', branch: 'd', state: 'open', pr: null }),
    ];
    const grouped = waveGroupsFor(rows, 'waiting-on-you').flatMap((g) => g.rows);
    const loose = ungroupedRows(rows, 'waiting-on-you');
    expect(grouped.length + loose.length).toBe(rows.length);
    expect(new Set([...grouped, ...loose]).size).toBe(rows.length);
  });
});

describe('waveGroupsFor — asks the server-derived wave, not a per-section state predicate', () => {
  const pr = (n: number) => ({ number: n, url: `https://h/pr/${n}`, draft: false, state: 'green' as const });

  /** A server-derived Wave, the entity #349 put on `fleet.waves`. */
  const wave = (over: Partial<Wave> = {}): Wave => ({
    plan: 'a-plan', name: 'Modelled', branches: [], verdict: 'complete',
    section: 'done', complete: true, ...over,
  });

  it('claims a DONE wave the server marks done, even where a row is not yet merged', () => {
    // THE DISCRIMINATING CASE. The old predicate kept only `r.state === 'merged'`
    // for DONE, so a wave the SERVER calls done (`section: 'done'`) but holding a
    // row that still reads `wip` would lose that row — two answers to *is this
    // wave done*, the row's and the wave's, disagreeing. Asking the wave, the
    // whole wave is DONE's and every one of its rows renders under it.
    const rows = [
      row({ wave: 'Modelled', branch: 'a', state: 'merged', pr: pr(1) }),
      row({ wave: 'Modelled', branch: 'b', state: 'wip', pr: pr(2) }),
    ];
    const waves = [wave({ name: 'Modelled', branches: ['a', 'b'], section: 'done', complete: true })];
    const groups = waveGroupsFor(rows, 'done', waves);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.branch)).toEqual(['a', 'b']);
    // …and a non-done section does NOT also claim it — one wave, one section.
    expect(waveGroupsFor(rows, 'not-started', waves)).toHaveLength(0);
  });

  it('keeps a NOT-STARTED wave out of DONE though a stray row is merged', () => {
    // The converse, and the `Inverted` shape in miniature. A wave the server
    // calls `not-started` (its unfinished work is what places it) holds one
    // merged branch. The old `=== 'merged'` predicate would drag that lone row
    // into DONE; the wave says the whole wave is not-started, so DONE claims none
    // of it.
    const rows = [
      row({ wave: 'Inverted', branch: 'a', state: 'merged' }),
      row({ wave: 'Inverted', branch: 'b', state: 'open' }),
    ];
    const waves = [wave({ name: 'Inverted', branches: ['a', 'b'], verdict: 'eligible', section: 'not-started', complete: false })];
    expect(waveGroupsFor(rows, 'done', waves)).toHaveLength(0);
    expect(waveGroupsFor(rows, 'not-started', waves).map((g) => g.rows.map((r) => r.branch)))
      .toEqual([['a', 'b']]);
  });

  it('groups NOTHING in WORKING or WAITING ON A MACHINE — a wave is not an agent or a build', () => {
    // The grammar survives the move: a wave never claims these sections whatever
    // its own section says, because an agent works and a build runs and neither
    // is a wave.
    const rows = [
      row({ wave: 'Modelled', branch: 'a', state: 'wip', pr: pr(1) }),
      row({ wave: 'Modelled', branch: 'b', state: 'wip', pr: pr(2) }),
    ];
    const waves = [wave({ name: 'Modelled', branches: ['a', 'b'], section: 'not-started', complete: false })];
    expect(waveGroupsFor(rows, 'working', waves)).toHaveLength(0);
    expect(waveGroupsFor(rows, 'waiting-on-machine', waves)).toHaveLength(0);
  });

  it('falls back to the row-state predicate when the wave list is ABSENT — a pre-wave pulse', () => {
    // THE CAST GUARD. The client casts the payload, so `fleet.waves` is
    // `undefined` on a pulse from a server predating #349 — not `[]`, because a
    // Zod `.default()` never reaches a cast. Undefined must degrade to the old
    // behaviour rather than throw or drop every wave.
    const rows = [
      row({ wave: 'Modelled', branch: 'a', state: 'wip', pr: pr(1) }),
      row({ wave: 'Modelled', branch: 'b', state: 'wip', pr: pr(2) }),
    ];
    const groups = waveGroupsFor(rows, 'waiting-on-you', undefined);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.branch)).toEqual(['a', 'b']);
  });

  it('still renders every row exactly once through ungroupedRows', () => {
    // `ungroupedRows` is the complement over the same input and the same wave
    // list, so a row grouped by the wave lookup is not also loose.
    const rows = [
      row({ wave: 'Modelled', branch: 'a', state: 'merged' }),
      row({ wave: 'Modelled', branch: 'b', state: 'wip' }),
      row({ wave: '', branch: 'c', state: 'merged' }),
    ];
    const waves = [wave({ name: 'Modelled', branches: ['a', 'b'], section: 'done', complete: true })];
    const grouped = waveGroupsFor(rows, 'done', waves).flatMap((g) => g.rows);
    const loose = ungroupedRows(rows, 'done', waves);
    expect(grouped.length + loose.length).toBe(rows.length);
    expect(new Set([...grouped, ...loose]).size).toBe(rows.length);
  });
});

describe('groupByWave — a wave has branches, not the other way round', () => {
  it('gives a wave holding three branches ONE group', () => {
    const groups = groupByWave([
      row({ wave: 'Implementation', branch: 'a' }),
      row({ wave: 'Implementation', branch: 'b' }),
      row({ wave: 'Implementation', branch: 'c' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].wave).toBe('Implementation');
    expect(groups[0].rows).toHaveLength(3);
  });

  it('keeps the arrival order rather than sorting', () => {
    // `groupByPlan` spends twenty lines on why ties must not be left to arrival
    // order — the rows of one pulse share an age and the input is rebuilt every
    // four seconds. This function does not sort at all: a Map yields groups in
    // first-appearance order, which IS the age order they came in. Sorting here
    // would reintroduce that flicker one level down, and the wave sequence is the
    // plan file's order rather than something to recompute.
    const groups = groupByWave([
      row({ wave: 'Shaped', branch: 'a' }),
      row({ wave: 'Marked', branch: 'b' }),
      row({ wave: 'Moved', branch: 'c' }),
    ]);
    expect(groups.map((g) => g.wave)).toEqual(['Shaped', 'Marked', 'Moved']);
  });

  it('takes the verdict from the first row that carries one', () => {
    // Every branch of a wave receives the same `wave.verdict` from the server,
    // so any of them answers. Taking the first NON-NULL rather than the first
    // row means a five-branch wave still reports its verdict where one row's is
    // absent.
    const groups = groupByWave([
      row({ wave: 'Implementation', branch: 'a', verdict: null }),
      row({ wave: 'Implementation', branch: 'b', verdict: 'blocked' }),
    ]);
    expect(groups[0].verdict).toBe('blocked');
  });

  it('groups an unnamed wave rather than dropping it', () => {
    // Six of this estate's 71 waves have no name — all in plans written before
    // the naming convention. A board that dropped them would make six real waves
    // invisible to punish six old plan files.
    const groups = groupByWave([row({ wave: '', branch: 'a' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].wave).toBe('');
  });

  it('keeps a deferred branch reachable when it shares a wave with an unbegun one', () => {
    // The pairing `showsWaveFold` defends, in the case where one wave holds
    // both. The plan-level fold is gone (one wave), so the WAVE's fold is what
    // discloses them — and it exists, because the wave holds two rows. The
    // deferred branch's PR and age are one click further in, never lost.
    const groups = groupByWave([
      row({ wave: 'Shaped', branch: 'never-begun' }),
      row({ wave: 'Shaped', branch: 'shelved', state: 'deferred', ageMinutes: 400 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.branch)).toEqual(['never-begun', 'shelved']);
  });
});
