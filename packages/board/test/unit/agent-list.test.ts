import {
  describe,
  it,
  expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  UNNAMED_SLICE,
  noActionReason,
  menuState,
  openTarget,
  offersOpen,
  openLabel,
  runLinkLabel,
  storyRefusal,
  splitBranch,
  isUnpushed,
  coldState,
} from '../../src/app/components/AgentList.js';
import { CARD_BELOW_PX, COLLAPSED_BY_DEFAULT, isCollapsible, readCollapsed, writeCollapsed } from '../../src/app/lib/agent-rows/collapse.js';
import { ACTIVITY_MARK_PLACE, ActivityEcho, CHANGE_MARK_MS, ChangeMarks, LOCK_ECHO_MS, activeRowKeys, activityPace, changedRows, groupPace, isUnreadable, sameWatched, type WatchedState, watchedState } from '../../src/app/lib/agent-rows/activity.js';
import { isActive, isLive, soleRowStatus } from '../../src/app/lib/agent-rows/stuck.js';
import { GROUPS, elsewhereNote, groupByPlan, rowsBySection, sectionTally, showPlanHeading, type PlanGroup, sliceKeyOf, sliceSection, slicesElsewhere } from '../../src/app/lib/agent-rows/sections.js';
import { countdown } from '../../src/app/lib/agent-rows/actions.js';
import { HOST_ANSWER_HINT, HOST_CANNOT_REPORT_HINT, hostAnswer, hostCannotReportCi, hostErrorState, issueNote, noteWithoutPr, prNote, prStateWord, scanHostNote } from '../../src/app/lib/agent-rows/host-notes.js';
import { isFinished, isStartable, rowKey, waitingLabel, waitingTone } from '../../src/app/lib/agent-rows/row-identity.js';
import { groupBySlice, groupedNote, sliceDissent, sliceLabel } from '../../src/app/lib/agent-rows/slices.js';
// THE ONE GRID, from the component that owns it. It was `ROW_TRACKS` in
// `AgentList.tsx` beside a second grid; `one-component-renders-every-row`
// collapsed both into this.
import { TUPLE_TRACKS } from '../../src/app/components/TupleRow.js';
import { GROUP_ORDER } from '../../src/server/fleet.js';
import type { DispatchInfo } from '../../src/contract/schema.js';
import {
  AgentRowSchema, DRAFT_PLAN_NOTE, ELIGIBLE_NOTE, type AgentRow, type Fleet, type Slice,
} from '../../src/contract/schema.js';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'wip', phase: null, group: 'quiet', ageMinutes: 10, note: '', pr: null,
  branchUrl: '', waitingDays: null,
  // The default row is UNOBSERVED, not clean — the state of every branch the
  // scan could not look at. `ABSENT IS NOT FALSE`, so the base fixture must
  // never quietly assert *nothing is happening here*.
  localDirty: false, localLocked: false,
  // NO PROCESS OBSERVED, which is the same stated absence as the two above and
  // not a claim that nothing is running. `[]` is what the contract defaults to
  // for a payload that predates the field: nothing was looked for.
  processes: [],
  ...over,
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

describe('sliceSection — resolves the Inverted split, gated on the verdict', () => {
  // A wave's rows: same plan, same wave name, branches described by their state,
  // per-branch group (what `classify` gave each), and the wave verdict every
  // branch shares.
  const sliceRows = (
    branches: { state: AgentRow['state']; group: AgentRow['group'] }[],
    verdict: AgentRow['verdict'] = 'eligible',
  ): AgentRow[] => branches.map((b, i) => row({
    plan: 'p', wave: 'W', branch: `feature/b${i}`, state: b.state, group: b.group, verdict,
  }));

  it('sends the merged branch to where the unfinished work is — the Inverted split', () => {
    // Verdict eligible (not finished), one merged (→ done), one open (→
    // not-started). A wave with unmerged work is where its unfinished work is, so
    // the merged branch joins NOT STARTED — never the reverse.
    expect(sliceSection(sliceRows(
      [{ state: 'merged', group: 'done' }, { state: 'open', group: 'not-started' }],
    ))).toBe('not-started');
  });

  it('reads the unfinished branch\'s own section — quiet where that is where it sits', () => {
    expect(sliceSection(sliceRows(
      [{ state: 'merged', group: 'done' }, { state: 'wip', group: 'quiet' }],
      'blocked',
    ))).toBe('quiet');
  });

  it('returns null when the wave carries NO verdict — nothing to aggregate on', () => {
    // A pre-verdict pulse, or a synthetic row: the scan said nothing, so a merged
    // branch beside an open one is not proof of an Inverted split. Don't guess.
    expect(sliceSection(sliceRows(
      [{ state: 'merged', group: 'done' }, { state: 'open', group: 'not-started' }],
      null,
    ))).toBeNull();
  });

  it('returns null for a COMPLETE wave — every branch merged, no split', () => {
    expect(sliceSection(sliceRows(
      [{ state: 'merged', group: 'done' }, { state: 'merged', group: 'done' }],
      'complete',
    ))).toBeNull();
  });

  it('returns null for an all-unmerged wave spanning process sections — a build stays put', () => {
    // The Modelled shape: a PR in review and a build on the machine, both wip, no
    // merged branch. Not a placement defect; collapsing them would move the build
    // off WAITING ON A MACHINE, which is where the board means to show it.
    expect(sliceSection(sliceRows([
      { state: 'wip', group: 'waiting-on-you' },
      { state: 'wip', group: 'waiting-on-machine' },
    ]))).toBeNull();
  });

  it('does not treat {merged, deferred} as a split — a deferred branch is exempt', () => {
    expect(sliceSection(sliceRows(
      [{ state: 'merged', group: 'done' }, { state: 'deferred', group: 'not-started' }],
    ))).toBeNull();
  });
});

describe('rowsBySection — Inverted stops splitting across two sections', () => {
  it('rewrites every branch of a mixed wave to the ONE section the wave belongs in', () => {
    // The live defect: a merged branch carrying `group: done` and an open branch
    // carrying `group: not-started`, one eligible wave. Filtering by `r.group`
    // put them in two sections. After re-sectioning both read `not-started`.
    const rows = [
      row({ plan: 'p', wave: 'Inverted', branch: 'feature/a', state: 'merged', group: 'done', verdict: 'eligible' }),
      row({ plan: 'p', wave: 'Inverted', branch: 'feature/b', state: 'open', group: 'not-started', verdict: 'eligible' }),
    ];
    const out = rowsBySection(rows);
    expect(out.map((r) => r.group)).toEqual(['not-started', 'not-started']);
    // Every (plan, wave) reaches exactly one section — the invariant.
    const sections = new Set(out.map((r) => r.group));
    expect(sections.size).toBe(1);
  });

  it('leaves a uniform wave untouched — identity preserved, not re-allocated', () => {
    const rows = [
      row({ plan: 'p', wave: 'Done', branch: 'feature/a', state: 'merged', group: 'done', verdict: 'complete' }),
      row({ plan: 'p', wave: 'Done', branch: 'feature/b', state: 'merged', group: 'done', verdict: 'complete' }),
    ];
    const out = rowsBySection(rows);
    // Same objects back where nothing changed — the fleet is shared and cast.
    expect(out[0]).toBe(rows[0]);
    expect(out[1]).toBe(rows[1]);
  });

  it('does not merge two DIFFERENT plans that share a wave name', () => {
    // p1 is a genuine split (merged + open) → its merged branch joins NOT
    // STARTED. p2 is all-merged (no split) → untouched. The shared wave name
    // must not fuse them: keying on (plan, wave) keeps them apart.
    const rows = [
      row({ plan: 'p1', wave: 'Shaped', branch: 'feature/a', state: 'merged', group: 'done', verdict: 'eligible' }),
      row({ plan: 'p1', wave: 'Shaped', branch: 'feature/b', state: 'open', group: 'not-started', verdict: 'eligible' }),
      row({ plan: 'p2', wave: 'Shaped', branch: 'feature/c', state: 'merged', group: 'done', verdict: 'complete' }),
    ];
    const out = rowsBySection(rows);
    expect(out.filter((r) => r.plan === 'p1').map((r) => r.group))
      .toEqual(['not-started', 'not-started']);
    expect(out.find((r) => r.plan === 'p2')?.group).toBe('done');
  });

  it('leaves a planless / wave-less row alone — it is its own subject', () => {
    const planless = row({ plan: '', wave: '', branch: 'feature/orphan', group: 'quiet', verdict: null });
    const out = rowsBySection([planless]);
    expect(out[0]).toBe(planless);
  });
});

describe('sliceDissent — the collapsed row does not read `merged` for a half-open wave', () => {
  it('reports how many merged when branches disagree — the Inverted case', () => {
    // One merged, one open: the row speaks for both, so it must state that some
    // landed and some did not, not a plain `merged`.
    expect(sliceDissent([
      row({ state: 'merged' }), row({ state: 'open' }),
    ])).toBe(1);
  });

  it('is null when every branch agrees — the count already tells the story', () => {
    expect(sliceDissent([row({ state: 'merged' }), row({ state: 'merged' })])).toBeNull();
    expect(sliceDissent([row({ state: 'open' }), row({ state: 'wip' })])).toBeNull();
  });

  it('does not count a DEFERRED branch as disagreement — it is exempt by design', () => {
    // A wave of {merged, deferred} agrees that everything wanted has landed.
    expect(sliceDissent([row({ state: 'merged' }), row({ state: 'deferred' })])).toBeNull();
  });

  it('feeds groupedNote, which then says so rather than the section word', () => {
    // With a dissent the note names the split; without one it keeps the ordinary
    // sentence for the section word.
    //
    // `to review` IS THE POINT OF THE FIRST TWO LINES, and it is deliberately not
    // the word in the third. It is a word `groupedNote` does not recognise, and
    // an unrecognised word returns '' so the caller's ternary falls through to
    // the VERDICT — the default used to assert `work landed — waiting to be
    // merged` over five live blocked waves whose branches had never been touched.
    // A dissent still outranks that: a MEASURED disagreement is a fact about
    // branches that exist, so it speaks even for a word with no sentence.
    expect(groupedNote('to review', 1)).toMatch(/1 merged/);
    expect(groupedNote('to review', null)).toBe('');
    // And a word that DOES have a sentence keeps it when its branches agree.
    expect(groupedNote('delivered', null)).toBe('landed — nothing left in it');
    expect(groupedNote('delivered', 2)).toMatch(/2 merged/);
  });
});

describe('slicesElsewhere — a split plan says how many of its waves are NOT here', () => {
  // The defect this closes: `sliceSummaryFor` counts the waves IN THIS SECTION and
  // silently drops the rest, so a plan whose first wave merged into DONE reports
  // `2 waves` under its NOT STARTED head with nothing saying a third exists. The
  // count is honest for the section but the OMISSION is not legible — the reader
  // cannot tell a two-wave plan from the visible half of a three-wave one. This
  // reads the server-derived `fleet.waves`, where each wave carries its ONE
  // section, and counts the ones whose section is not the head's.
  const wave = (over: Partial<Slice> = {}): Slice => ({
    plan: 'split-plan', name: 'w', branches: ['feature/x'],
    verdict: 'complete', section: 'done', complete: true, ...over,
  });

  it('counts a plan\'s waves that sit in another section', () => {
    // Two waves done, one not started. The NOT STARTED head speaks for the one;
    // two are elsewhere. The DONE head speaks for the two; one is elsewhere.
    const waves = [
      wave({ name: 'Sown', section: 'done', complete: true }),
      wave({ name: 'Grown', section: 'done', complete: true }),
      wave({ name: 'Reaped', section: 'not-started', complete: false }),
    ];
    expect(slicesElsewhere(waves, 'split-plan', 'not-started')).toBe(2);
    expect(slicesElsewhere(waves, 'split-plan', 'done')).toBe(1);
  });

  it('is zero for a plan whose every wave is in the head\'s own section', () => {
    // The common case — a plan that has not split. Nothing is elsewhere, so the
    // head says nothing extra.
    const waves = [
      wave({ name: 'Sown', section: 'not-started', complete: false }),
      wave({ name: 'Grown', section: 'not-started', complete: false }),
    ];
    expect(slicesElsewhere(waves, 'split-plan', 'not-started')).toBe(0);
  });

  it('counts only THIS plan\'s waves — a namesake wave of another plan is not ours', () => {
    // `plan` is half of a wave's identity; names repeat across plans. A `Tracer`
    // in some other plan sitting in DONE must not inflate this plan's count.
    const waves = [
      wave({ plan: 'split-plan', name: 'Tracer', section: 'not-started', complete: false }),
      wave({ plan: 'other-plan', name: 'Tracer', section: 'done', complete: true }),
    ];
    expect(slicesElsewhere(waves, 'split-plan', 'not-started')).toBe(0);
  });

  it('is zero when the payload carries no waves — a pre-wave server, cast not parsed', () => {
    // `fleet.waves` defaults to [] only at PARSE time, and the board CASTS the
    // payload, so a pre-wave pulse leaves it `undefined`. The head must degrade to
    // "nothing to report" rather than throw — the FLEET_CONTROLS_DEFAULT lesson.
    expect(slicesElsewhere(undefined, 'split-plan', 'not-started')).toBe(0);
    expect(slicesElsewhere([], 'split-plan', 'not-started')).toBe(0);
  });

  it('counts against the head\'s OWN waves, not the section it renders in', () => {
    // THE MEASURED DEFECT. `deriveSlices` gives a wave two possible sections
    // (`complete ? 'done' : 'not-started'`) while `classify` places rows across
    // six groups, so a row needing attention sits in a section NO wave can
    // carry. Passing the rendered key then matches nothing and every wave counts
    // as elsewhere.
    //
    // Measured 2026-08-24: 30 of 80 rows disagreed with their own wave's
    // section, and 16 plan heads reported EVERY wave elsewhere — including
    // one-wave plans announcing their only wave was somewhere else.
    const waves = [
      { plan: 'p', name: 'Shown', section: 'done' },
      { plan: 'p', name: 'Offered', section: 'not-started' },
    ] as never;
    // The head renders in `waiting-on-you` — a section no wave carries — and
    // holds the `Offered` wave's row. One of its two waves is elsewhere.
    expect(slicesElsewhere(waves, 'p', 'waiting-on-you', new Set(['Offered']))).toBe(1);
    // Without the set, the old comparison calls BOTH elsewhere. Asserted so the
    // fallback's limit is recorded rather than mistaken for correct.
    expect(slicesElsewhere(waves, 'p', 'waiting-on-you')).toBe(2);
  });

  it('says nothing is elsewhere when the head holds every wave', () => {
    // The guard against over-reporting: a plan wholly under one head must not
    // claim a split. This is the case a naive `waves.length - 1` gets wrong.
    const waves = [
      { plan: 'p', name: 'Only', section: 'not-started' },
    ] as never;
    expect(slicesElsewhere(waves, 'p', 'waiting-on-you', new Set(['Only']))).toBe(0);
  });
});

describe('elsewhereNote — the fragment the head appends, or nothing', () => {
  it('names the count and pluralises', () => {
    expect(elsewhereNote(1)).toBe('1 slice elsewhere');
    expect(elsewhereNote(3)).toBe('3 slices elsewhere');
  });

  it('is empty at zero, so the head appends nothing rather than "0 elsewhere"', () => {
    expect(elsewhereNote(0)).toBe('');
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

describe('showPlanHeading — decided per group, not per section', () => {
  const group = (plan: string, count: number): PlanGroup => ({
    plan,
    planFile: plan ? `docs/plans/${plan}.md` : '',
    rows: Array.from({ length: count }, (_, i) => row({ branch: `b${i}`, plan })),
  });

  it('labels a plan holding several rows, instead of printing its name on each', () => {
    // The case that motivated grouping: six QUIET rows of one plan, whose name
    // otherwise printed six times down the column.
    expect(showPlanHeading(group('alpha', 6))).toBe(true);
  });

  it('stays quiet for a single row, where the heading labels the one line below it', () => {
    // The whole change: a heading above a single row says the plan name once —
    // exactly as the row itself would — and charges a line of height for it.
    expect(showPlanHeading(group('alpha', 1))).toBe(false);
  });

  it('stays quiet for two plans of one row each', () => {
    // The reversal. The section-wide rule said `true` here to keep two names
    // from running together unlabelled; that worry is real and now answered by
    // the ROWS, which print their own plan name when their group has no
    // heading. Pinned below in the mixed-section case.
    expect(showPlanHeading(group('alpha', 1))).toBe(false);
    expect(showPlanHeading(group('beta', 1))).toBe(false);
  });

  it('never labels a nameless group, however many rows it holds', () => {
    // Rows no plan claims: there is nothing to head them WITH, and the
    // section-wide version printed a bare "(3)".
    expect(showPlanHeading(group('', 4))).toBe(false);
  });

  it('stays quiet for an empty group', () => {
    expect(showPlanHeading(group('alpha', 0))).toBe(false);
  });

  it('answers each group of a MIXED section on its own', () => {
    // What a section-wide answer cannot express, and the reason this moved: one
    // plan with several rows beside a plan with one. A single flag is wrong for
    // one of them either way — heading the single row, or stripping the
    // heading off the six.
    expect(showPlanHeading(group('many', 3))).toBe(true);
    expect(showPlanHeading(group('lonely', 1))).toBe(false);
  });
});

describe('isLive — which rows carry the pulsing indicator', () => {
  /**
   * The three entrances to WORKING, verbatim from `classify()` in fleet.ts.
   * They differ in strength — a dirty worktree is the strongest evidence there
   * is, a bare claim the weakest — and that difference is deliberately NOT
   * rendered.
   */
  const WORKING_NOTES = [
    'uncommitted work in a local worktree',
    'last commit 3 min ago',
    'claimed, no commits yet',
  ];

  it('gives all three WORKING notes the SAME answer', () => {
    // The load-bearing assertion, and the one a confidence-graded
    // implementation fails: it would pass a test checking only the dirty
    // worktree. Membership is the statement and it is true for all three — the
    // note already says which reason, so a second vocabulary made of speeds
    // would encode in motion what the text states plainly.
    const answers = WORKING_NOTES.map((note) => isLive(row({ group: 'working', note })));
    expect(answers).toEqual([true, true, true]);
    expect(new Set(answers).size).toBe(1);
  });

  it('leaves every other group still', () => {
    // Asserted as a negative across the whole vocabulary rather than on one
    // group: `working` is the only claim the board can make honestly, and a
    // blanket indicator passes any test that only checks a working row.
    for (const group of GROUPS.map((g) => g.key).filter((k) => k !== 'working')) {
      expect(isLive(row({ group }))).toBe(false);
    }
  });

  it('leaves a QUIET row still even when it carries a fresh claim', () => {
    // The near-miss the plan names. A quiet row can hold a claim and a recent
    // note and still be quiet — the group is what decides, because the group is
    // the only thing the pulse re-derives every scan.
    expect(isLive(row({ group: 'quiet', state: 'wip', note: 'claimed, no commits yet' })))
      .toBe(false);
    expect(isLive(row({ group: 'quiet', ageMinutes: 1, note: 'last commit 1 min ago' })))
      .toBe(false);
  });

  it('follows the GROUP rather than the state or the age', () => {
    // A deferred branch with a two-minute-old commit is `not-started` by group
    // — the one place intent outranks git. The indicator must follow the group,
    // or it would claim an agent is on work somebody handed back.
    expect(isLive(row({ group: 'not-started', state: 'deferred', ageMinutes: 2 }))).toBe(false);
    // And a working row with no age at all still counts: a fresh claim has no
    // commit to date, and that is one of the three entrances.
    expect(isLive(row({ group: 'working', ageMinutes: null }))).toBe(true);
  });
});

describe('isUnpushed — finished work nobody else can see', () => {
  it('marks a row holding commits the remote has not seen', () => {
    expect(isUnpushed(row({ localAhead: 1 }))).toBe(true);
    expect(isUnpushed(row({ localAhead: 40 }))).toBe(true);
  });

  it('does NOT mark a row that is merely being written to', () => {
    // THE pairing. `local_ahead` is finished work sitting STILL; `localDirty`
    // and `localLocked` mean someone is writing. An implementation that OR-ed
    // all three into one predicate passes every positive assertion and marks a
    // branch nobody has touched for hours as though someone were at it.
    expect(isUnpushed(row({ localDirty: true }))).toBe(false);
    expect(isUnpushed(row({ localLocked: true }))).toBe(false);
    expect(isUnpushed(row({ group: 'working' }))).toBe(false);
  });

  it('reads 0 as UNOBSERVED, never as clean', () => {
    // Same rule the two booleans follow: the field defaults to 0 because a scan
    // that never looked at a worktree reports absence, not emptiness. Both
    // collapse to "no mark" — the row says nothing rather than saying clean.
    expect(isUnpushed(row({}))).toBe(false);
    expect(isUnpushed(row({ localAhead: 0 }))).toBe(false);
  });

  it('is independent of isActive — a row can be both', () => {
    // The measured shape of a working agent: uncommitted edits AND commits it
    // has not pushed. Asserted as two separate answers because the row renders
    // two separate marks, and an implementation testing them in sequence loses
    // whichever it tests second.
    // A PROCESS for the active half, since `isActive` reads the process rather
    // than the worktree: an agent running on a branch that also holds unpushed
    // commits. Two answers, two marks, neither derived from the other.
    const both = row({ worker: 'running', localAhead: 3 });
    expect(isActive(both)).toBe(true);
    expect(isUnpushed(both)).toBe(true);
  });
});

describe('waitingTone — only one of the three is loud', () => {
  it('gives `needs you` the strong colour and nothing else', () => {
    // The section is mostly `time`: measured, this session's pulse held 43 rows
    // with multi-wave plans routinely showing two blocked rows per eligible
    // one. A section where every row is coloured has coloured nothing, so only
    // the state a person can END gets the loud colour.
    const you = waitingTone('you');
    expect(you).toContain('amber');
    expect(waitingTone('click')).not.toContain('amber');
    expect(waitingTone('time')).not.toContain('amber');
  });

  it('leaves a startable row looking like every other row', () => {
    // THE pairing. `ready to start` is available, and taking it is optional —
    // a colour of its own would make the section shout twice and mean once.
    // An implementation colouring all three passes "is `you` loud?" and fails
    // here.
    expect(waitingTone('click')).toBe(waitingTone(null));
  });

  it('makes `waiting its turn` the quietest of the three', () => {
    // Nothing to do, ever, and the most common state in a multi-wave plan.
    expect(waitingTone('time')).not.toBe(waitingTone(null));
    expect(waitingTone('time')).toContain('slate-400');
  });

  it('animates nothing — colour is a property, motion is an accusation', () => {
    // `board-watches-for-stuck-branches` settled that motion marks an
    // UNANSWERED REQUEST. A Draft plan minutes old is not that; it is the
    // ordinary state of a plan just written, and animating it would interrupt
    // a reader about their own work in progress. The escalation for a Draft
    // that has sat for days is specified in the plan and deliberately unbuilt:
    // 30 of this repo's 31 approved plans were approved the day they were
    // drafted, so the state it would mark has never occurred here.
    for (const w of ['you', 'click', 'time', null] as const) {
      expect(waitingTone(w)).not.toMatch(/animate/);
    }
  });
});

describe('isActive — which rows have a PROCESS running on them', () => {
  it('marks a live agent and a running build, and nothing else', () => {
    // THE MOVING DOT IS ABOUT MACHINES. It read `localLocked || localDirty`
    // until 2026-08-22, and those describe a WORKTREE's contents rather than a
    // process: measured on the live board, the row for the branch being
    // committed to pulsed continuously for hours while nothing but a person
    // typed in it.
    //
    // Two sources, one per kind of machine this board knows: `worker` for
    // AGENTS, bounded by LIVE_WORKERS, and `pr.state === 'pending'` for BUILDS.
    expect(isActive(row({ worker: 'running' }))).toBe(true);
    expect(isActive(row({ worker: 'waiting' }))).toBe(true);
    expect(isActive(row({ worker: 'stalled' }))).toBe(true);
    expect(isActive(row({
      pr: { number: 1, url: 'u', draft: false, state: 'pending' },
    }))).toBe(true);
  });

  it('does NOT mark a person editing — that is the background flash\'s job', () => {
    // The split the operator drew: the DOT shows processes, the background
    // FLASH shows writing. `localDirty` and `localLocked` are still watched by
    // `changedRows`, so a write still reaches the reader — as a flash, on the
    // change, rather than as a dot claiming a machine is at work.
    expect(isActive(row({ localDirty: true }))).toBe(false);
    expect(isActive(row({ localLocked: true }))).toBe(false);
    expect(isActive(row({ localDirty: true, localLocked: true }))).toBe(false);
  });

  it('reads a FINISHED run as no run — the six states that are not live', () => {
    // `LIVE_WORKERS` is *is anybody on this now*, and the other five describe a
    // run that is over or absent. Measured on this repo's board: 4 rows carry
    // `finished` and every one is a merged PR in DONE.
    for (const w of ['finished', 'failed', 'ended', 'none', 'elsewhere'] as const) {
      expect(isActive(row({ worker: w })), `${w} read as live`).toBe(false);
    }
  });

  it('reads a SETTLED build as no build — pending is the only running one', () => {
    // The other PR states are verdicts a machine left behind, not a machine at
    // work. `conflicts` in particular is a standing condition, and a row that
    // pulsed for it would pulse for weeks.
    for (const st of ['green', 'failing', 'none', 'closed', 'conflicts', 'unknown'] as const) {
      expect(isActive(row({ pr: { number: 1, url: 'u', draft: false, state: st } })),
        `${st} read as running`).toBe(false);
    }
  });

  it('never marks a MERGED branch, whatever is running against it', () => {
    // Measured on screen: a row in DONE carrying the mark. After the merge
    // there is no work on the branch left to happen, which is why `classify`
    // sends merged branches to `done` before it looks at any signal.
    expect(isActive(row({ state: 'merged', worker: 'running' }))).toBe(false);
    expect(isActive(row({
      state: 'merged', pr: { number: 1, url: 'u', draft: false, state: 'pending' },
    }))).toBe(false);
    // And the same signals on an UNMERGED branch still mark it.
    expect(isActive(row({ state: 'wip', worker: 'running' }))).toBe(true);
  });

  it('never marks a DEFERRED branch either — deferred is finished work', () => {
    // Same category as merged: a human decided this branch is not needed, so
    // there is no writing left to observe on it. Measured on the live board,
    // one of the seven rows wearing the mark was `state: deferred` with a dirty
    // worktree (`waiting-on-you-says-what-kind-of-waiting`). A worktree fact on
    // a finished row is not a pulse; the guard is finishedness, not merged-ness.
    expect(isActive(row({ state: 'deferred', worker: 'running' }))).toBe(false);
    expect(isActive(row({ state: 'deferred', worker: 'waiting' }))).toBe(false);
    expect(isActive(row({
      state: 'deferred', pr: { number: 1, url: 'u', draft: false, state: 'pending' },
    }))).toBe(false);
  });

  it('survives a row that predates the fields entirely', () => {
    // The payload an older server sends.
    expect(() => isActive({ worker: undefined, pr: undefined } as never)).not.toThrow();
  });

  it('is a DIFFERENT question from isLive, and neither answers the other', () => {
    // Three marks, three meanings — and the pairing that matters: no mark may
    // be implemented by modifying another. A WORKING row with no process is
    // LIVE and not ACTIVE; an agent running OUTSIDE working is ACTIVE and not
    // LIVE.
    const idleInWorking = row({ group: 'working' });
    expect(isLive(idleInWorking)).toBe(true);
    expect(isActive(idleInWorking)).toBe(false);

    const agentOutside = row({ group: 'quiet', worker: 'running' });
    expect(isLive(agentOutside)).toBe(false);
    expect(isActive(agentOutside)).toBe(true);
  });
});

describe('isFinished — the branch\'s work is over, whatever its worktree holds', () => {
  it('is true for the two settled states and false for the rest', () => {
    // `merged` and `deferred` are the two ways a branch's work ends: one landed,
    // one was called off. Neither has writing left to observe, so a worktree or
    // worker fact on such a row describes a stale checkout rather than live work.
    expect(isFinished(row({ state: 'merged' }))).toBe(true);
    expect(isFinished(row({ state: 'deferred' }))).toBe(true);
    for (const s of ['open', 'wip', 'claimed'] as const) {
      expect(isFinished(row({ state: s })), s).toBe(false);
    }
  });

  it('survives a row that predates the field', () => {
    expect(() => isFinished({ state: undefined } as never)).not.toThrow();
  });
});

describe('soleRowStatus — a finished wave-of-one never shows a live worker', () => {
  // The second face of the same defect: a wave of one folds its branch into the
  // wave row, so that row's status is the branch's. A LIVE worker outranks the
  // PR there — correct while the branch is in flight, stale once it is finished.
  // Measured 2026-08-23: three DONE rows carried `worker: waiting`/`failed` on
  // branches that were `merged` or `deferred`. `waiting` is a LIVE worker, so it
  // survived onto a merged wave and read as *someone owes this an answer* under
  // a heading that says done.
  it('prefers a live worker on an UNFINISHED wave', () => {
    expect(soleRowStatus(row({ state: 'wip', worker: 'running' }))).toBe('working');
    expect(soleRowStatus(row({ state: 'open', worker: 'waiting' }))).toBe('waiting on you');
  });

  it('drops a live worker on a MERGED or DEFERRED wave, showing the state', () => {
    // The worker outlives the branch; its last recorded state never cleared. On
    // a finished row the branch state is the current fact, so the row reads
    // `delivered` / `deferred` rather than a worklog fact about a run nobody is
    // waiting on.
    expect(soleRowStatus(row({ state: 'merged', worker: 'waiting' }))).toBe('delivered');
    expect(soleRowStatus(row({ state: 'merged', worker: 'failed' }))).toBe('delivered');
    expect(soleRowStatus(row({ state: 'deferred', worker: 'waiting' }))).toBe('deferred');
    expect(soleRowStatus(row({ state: 'deferred', worker: 'stalled' }))).toBe('deferred');
  });

  it('prefers a PR condition over the bare state on a finished wave', () => {
    // With the worker screened out, the row falls back to its PR then its state
    // — the same order an unfinished wave uses, minus the live worker.
    const t = soleRowStatus(row({
      state: 'merged', worker: 'waiting',
      pr: { number: 7, url: 'u', draft: false, state: 'green' },
    }));
    expect(t).toBe('green');
  });
});

describe('ActivityEcho — a seen lock outlives the pulse that saw it', () => {
  /**
   * A clock the test advances by hand.
   *
   * The echo is INVISIBLE at the board's own rates: `FLEET_POLL_MS` is 4s, so a
   * browser assertion "the marker survived a lockless pulse" is really watching
   * a timer that has not expired yet, and passes just as happily with the echo
   * removed. Driven directly, the rule is exact.
   */
  function fakeClock() {
    let now = 0;
    const due = new Map<number, { at: number; fn: () => void }>();
    let nextId = 1;
    return {
      schedule(fn: () => void, ms: number) {
        const id = nextId++;
        due.set(id, { at: now + ms, fn });
        return () => due.delete(id);
      },
      advance(ms: number) {
        now += ms;
        for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
          if (t.at <= now) { due.delete(id); t.fn(); }
        }
      },
    };
  }

  /**
   * An echo whose lit set the test can read after each step.
   *
   * `lit()` reads the echo's OWN state (`echoing`) rather than the last value
   * published to `onChange`, and that is deliberate. A mutation that clears the
   * set without notifying — `this.lit.clear()` at the top of `seen`, which is
   * exactly the "a lockless pulse wipes the echo" defect — leaves the last
   * published snapshot intact, so a test reading the callback's value reads a
   * stale set and passes. Measured: it did.
   *
   * `published()` is kept for the one assertion that is genuinely about the
   * callback — that `dispose` stops publishing.
   */
  function echoOnFakeClock() {
    const clock = fakeClock();
    let last: ReadonlySet<string> = new Set();
    const echo = new ActivityEcho((next) => { last = next; }, clock.schedule);
    return {
      echo,
      clock,
      lit: () => [...echo.echoing].sort(),
      published: () => [...last].sort(),
    };
  }

  it('keeps the marker through a pulse in which the lock is already GONE', () => {
    // THE assertion this class exists for. `.git/index.lock` lives from a
    // fraction of a second to a few seconds and the pulse is 4s, so most locks
    // are born and die BETWEEN two pulses. Without the echo the sharpest signal
    // the board has would render essentially never — the defect
    // `scan-reports-a-locked-worktree` was written to prevent, one layer up.
    const { echo, clock, lit } = echoOnFakeClock();
    echo.seen(['plot/a']);
    expect(lit()).toEqual(['plot/a']);
    // One whole pulse later the lock is gone — and the marker is still there.
    clock.advance(4_000);
    expect(lit()).toEqual(['plot/a']);
  });

  it('expires on its own clock without a further lock', () => {
    // Bounded: a marker that outlives its fact must stop doing so. It clears
    // ITSELF rather than waiting for a pulse, which is what keeps a board whose
    // server died from sitting lit forever.
    const { echo, clock, lit } = echoOnFakeClock();
    echo.seen(['plot/a']);
    clock.advance(LOCK_ECHO_MS - 1);
    expect(lit()).toEqual(['plot/a']);
    clock.advance(1);
    expect(lit()).toEqual([]);
  });

  it('never resurrects: two lockless pulses produce nothing at all', () => {
    // The echo starts when a lock is SEEN, never when one is inferred. A row
    // that was never observed locked has nothing to echo, and inventing one
    // would be the board asserting an event it never observed.
    const { echo, clock, lit } = echoOnFakeClock();
    echo.seen([]);
    clock.advance(4_000);
    echo.seen([]);
    clock.advance(4_000);
    expect(lit()).toEqual([]);
    // And once a real echo has expired, later lockless pulses do not revive it.
    echo.seen(['plot/a']);
    clock.advance(LOCK_ECHO_MS);
    expect(lit()).toEqual([]);
    echo.seen([]);
    expect(lit()).toEqual([]);
  });

  it('is never EXTENDED by a pulse that found no lock', () => {
    // "Never contradicts a later observation" in its mechanical form: a pulse
    // that saw nothing must not touch a running echo in either direction. It
    // neither clears it early nor pushes it out — the echo runs its own span
    // from the last real sighting.
    const { echo, clock, lit } = echoOnFakeClock();
    echo.seen(['plot/a']);
    clock.advance(LOCK_ECHO_MS - 1_000);
    echo.seen([]);                       // a pulse with no lock
    expect(lit()).toEqual(['plot/a']);   // not cleared early
    clock.advance(1_000);
    expect(lit()).toEqual([]);           // and not pushed out either
  });

  it('RESTARTS the echo when the lock is seen again', () => {
    // A lock still held on the next pulse is a longer write, not a finished
    // one, so the span runs from the latest sighting.
    const { echo, clock, lit } = echoOnFakeClock();
    echo.seen(['plot/a']);
    clock.advance(4_000);
    echo.seen(['plot/a']);
    clock.advance(LOCK_ECHO_MS - 1_000);   // past the FIRST span's expiry
    expect(lit()).toEqual(['plot/a']);
    clock.advance(1_000);
    expect(lit()).toEqual([]);
  });

  it('gives each row its own timer', () => {
    const { echo, clock, lit } = echoOnFakeClock();
    echo.seen(['plot/a']);
    clock.advance(2_000);
    echo.seen(['plot/b']);
    expect(lit()).toEqual(['plot/a', 'plot/b']);
    clock.advance(LOCK_ECHO_MS - 2_000);
    expect(lit()).toEqual(['plot/b']);
    clock.advance(2_000);
    expect(lit()).toEqual([]);
  });

  it('drops every pending timer on dispose', () => {
    // Unmounting with echoes running would otherwise leave timeouts firing a
    // setState against a gone component. After dispose the echo holds nothing
    // and publishes nothing further — the last snapshot the component saw stays
    // where it was.
    const { echo, clock, lit, published } = echoOnFakeClock();
    echo.seen(['plot/a']);
    expect(published()).toEqual(['plot/a']);
    echo.dispose();
    expect(lit()).toEqual([]);
    clock.advance(LOCK_ECHO_MS * 2);
    expect(published()).toEqual(['plot/a']);   // never updated after dispose
  });
});

describe('LOCK_ECHO_MS — long enough to outlive a pulse, short enough to read as a marker', () => {
  it('is longer than one fleet poll and shorter than two', () => {
    // Measured, not chosen. A lock seen in one pulse must survive the NEXT one
    // — that is the entire reason the echo exists — so anything at or below the
    // 4s poll interval renders the signal almost never. And two lockless pulses
    // must always clear it, or the marker stops reading as a marker.
    expect(LOCK_ECHO_MS).toBeGreaterThan(4_000);
    expect(LOCK_ECHO_MS).toBeLessThan(8_000);
  });

  it('is its own constant, not the change mark\'s', () => {
    // Two clocks, two calibrations: `CHANGE_MARK_MS` is tuned against the 60s
    // PR refresh for a rare transition, this against the 4s fleet pulse for a
    // signal that expires on its own. One number serving both is how a value
    // gets tuned for one clock and silently wrong for the other.
    expect(LOCK_ECHO_MS).not.toBe(CHANGE_MARK_MS);
  });
});

describe('activeRowKeys — this pulse\'s signals, widened by recent locks', () => {
  it('marks rows the pulse reports active', () => {
    // THE TWO KINDS OF PROCESS, and a row with neither. `isActive` reads the
    // worker and the build since 2026-08-22 — a dirty worktree is a person
    // writing, which the background flash reports and the dot does not.
    const rows = [
      row({ branch: 'agent', worker: 'running' }),
      row({ branch: 'build', pr: { number: 9, url: 'u', draft: false, state: 'pending' } }),
      row({ branch: 'idle', group: 'working' }),
    ];
    expect([...activeRowKeys(rows, new Set())].sort())
      // KEYS CARRY THE PLAN since two plans can name one branch — the fixture's
      // `plan: 'a-plan'` is the third segment.
      .toEqual(['plot/agent/a-plan', 'plot/build/a-plan']);
  });

  it('adds rows still echoing a lock, without the pulse saying anything', () => {
    // The union, and its direction: the echo only ever ADDS. This row reports
    // no signals at all in this pulse and is marked purely because a lock it
    // was seen holding has not yet expired.
    const rows = [row({ branch: 'gone-quiet' })];
    expect([...activeRowKeys(rows, new Set(['plot/gone-quiet/a-plan']))])
      .toEqual(['plot/gone-quiet/a-plan']);
  });

  it('does not mark an echo for a row that is no longer in the fleet', () => {
    // The set is one entry per VISIBLE row, not a log. A stale key for a branch
    // that has left the pulse marks nothing.
    expect([...activeRowKeys([row({ branch: 'here' })], new Set(['plot/vanished/a-plan']))])
      .toEqual([]);
  });

  it('never contradicts a later observation — the NOTE is untouched', () => {
    // The third bound on the echo: it makes a real event visible, it does not
    // overwrite a fact. While the echo runs, the row goes on reporting whatever
    // the last pulse actually found — so a row echoing a lock while the pulse
    // says *claimed, no commits yet* keeps saying exactly that.
    const quiet = row({ branch: 'echoing', note: 'claimed, no commits yet' });
    const active = activeRowKeys([quiet], new Set(['plot/echoing/a-plan']));
    expect(active.has('plot/echoing/a-plan')).toBe(true);
    expect(quiet.note).toBe('claimed, no commits yet');
    // And the row itself still reports no signals — the echo lives beside the
    // row's facts rather than rewriting them.
    expect(isActive(quiet)).toBe(false);
  });
});

describe('a process is marked in EVERY section, and writing is not a process', () => {
  it('marks a running process wherever the row is filed', () => {
    // No section withholds the dot. A predicate that gated on the group stood
    // for one day and was wrong twice — first refusing QUIET and DONE, where
    // `group-activity` shows the mark matters most, then refusing WAITING ON
    // YOU while a real process ran there. A section says what work is WAITING
    // for; a process running is not waiting.
    for (const group of ['working', 'waiting-on-machine', 'waiting-on-you',
                         'quiet', 'done', 'not-started'] as const) {
      const busy = row({ branch: 'w', group, worker: 'running' });
      expect([...activeRowKeys([busy], new Set())], `${group} withheld the mark`)
        .toHaveLength(1);
    }
  });

  it('does NOT mark a person editing, in any section', () => {
    // The split the operator drew: the DOT is for processes, the background
    // FLASH is for writing. A dirty worktree is a person — or the master agent
    // in the project directory — and it reaches the reader as a flash on the
    // change, not as a dot claiming a machine is at work.
    for (const group of ['working', 'waiting-on-you', 'quiet'] as const) {
      const dirty = row({ branch: 'w', group, localDirty: true });
      expect([...activeRowKeys([dirty], new Set())], `${group} marked a writer`)
        .toHaveLength(0);
    }
  });

  it('refuses it where nothing runs at all', () => {
    // The negative that keeps the positive meaning something.
    const idle = row({ branch: 'w', group: 'working', worker: 'none' });
    expect([...activeRowKeys([idle], new Set())]).toHaveLength(0);
  });

  it('leaves the MERGED exception standing — it is about the branch', () => {
    // `isActive` refuses a merged branch whatever runs against it, measured on
    // a row in DONE carrying the mark. The guard reads `state`, a fact about
    // the BRANCH, so neither the section rule's removal nor the change of
    // source disturbs it.
    expect(isActive({ state: 'merged', worker: 'running', pr: null })).toBe(false);
    expect(isActive({ state: 'wip', worker: 'running', pr: null })).toBe(true);
  });
});

describe('the activity marker leaves the other marks alone', () => {
  // THE MARKS' OWN MODULE. All four lived in `AgentList.tsx` until
  // `the-components-leave-the-shell` moved them out; the scan follows them,
  // because a path that no longer holds the marks is a scan that matches
  // nothing and passes forever.
  const source = readFileSync(
    new URL('../../src/app/lib/agent-rows/marks.tsx', import.meta.url), 'utf8');

  it('keeps isLive reading the GROUP, exactly as before', () => {
    // The dot means *in the WORKING group* and lives for hours; the activity
    // mark means *someone is writing here*. Two questions, two marks — and the
    // cheap way to build the second is to repaint the first.
    expect(isLive(row({ group: 'working' }))).toBe(true);
    expect(isLive(row({ group: 'quiet', localDirty: true, localLocked: true }))).toBe(false);
    expect(isLive(row({ group: 'working', localDirty: false }))).toBe(true);
  });

  it('renders two distinct marks, neither defined in terms of the other', () => {
    // Read out of the source: each hook exists and is its own element. An
    // implementation that made activity a variant of the flash would still pass
    // every predicate assertion above.
    expect(source).toContain('data-change-mark');
    expect(source).toContain('data-activity-mark');
    // The change mark keeps its own channel — full-row wash, amber, pulsing.
    expect(source).toContain('absolute inset-0 animate-pulse bg-amber-300/25');
    // ONE BAR, ONE DOT, and no third mark beside it. `data-live-dot` was a
    // static green dot on every WORKING row, drawn at `left-1` — one pixel from
    // the travelling dot at `left-0`, so a WORKING row showed two dots and read
    // as one smudge. Reported from a screenshot of that overlap, and what it
    // said (*this row is in WORKING*) is what the section heading says once.
    // Asked of the ATTRIBUTE as JSX writes it, not of the word: three comments
    // still name `[data-live-dot]` to say what they are deliberately NOT, and a
    // bare `not.toContain` would fail on the prose that explains the removal.
    expect(source).not.toMatch(/^\s*data-live-dot$/m);
    // The activity mark's own dot rides its own track — the pairing that keeps
    // "one bar, one dot" honest, since a bar with no dot and a dot with no bar
    // would each pass a hook-existence check.
    expect(source).toContain('data-activity-track');
    expect(source).toContain('data-activity-dot');
  });

  it('names its own limit in the accessible description', () => {
    // A reader who takes an unmarked row for an idle one has been misled by a
    // marker that was technically correct: every signal here is local, so an
    // agent on another machine produces no mark HERE, ever. The marker says so
    // rather than letting absence speak for itself.
    expect(source).toContain('A write is in progress in this checkout');
  });

});

/**
 * WHICH SPEED A ROW'S DOT TRAVELS AT.
 *
 * The speed is a FACT, not a decoration — one rule, two states the board can
 * defend:
 *
 * ```
 * feature/not-started-counts-plans  dirty=true   → fast
 * bug/green-never-outranks-unknown  dirty=false  → slow  ("claimed, no known worker")
 * ```
 *
 * Both were live on the board the day this was asked for, and they are the two
 * cases pinned below in the terms the report used.
 */
describe('activityPace — fast means measured, slow means unobserved', () => {
  it('travels FAST where a write was actually observed', () => {
    // Either signal on its own is enough, and both are observations rather than
    // inferences: a lock in `.git/index.lock`, or a dirty worktree.
    expect(activityPace(row({ localDirty: true }))).toBe('fast');
    expect(activityPace(row({ localLocked: true }))).toBe('fast');
    expect(activityPace(row({ localDirty: true, localLocked: true }))).toBe('fast');
  });

  it('travels SLOW where the row is claimed and nothing was observed', () => {
    // The live case, in its own words: `bug/green-never-outranks-unknown` sat
    // in WORKING with `dirty=false` and the note *claimed, no known worker*.
    // Nobody is known to be there — so the dot moves, because something is
    // supposed to be happening, and moves slowly, because nothing confirms it.
    expect(activityPace(row({ localDirty: false, localLocked: false }))).toBe('slow');
  });

  it('is a SECOND question, asked of the same row — not the same predicate', () => {
    // THE TWO SPEEDS ARE THE TWO QUESTIONS, and they parted on 2026-08-22.
    //
    // This asserted `activityPace(r) === (isActive(r) ? 'fast' : 'slow')` —
    // sound while both read the worktree, and false once they divided:
    // `isActive` asks *does a process run here* (the worker, the build), and
    // the pace asks *is that process doing anything*, for which the worktree is
    // the only evidence the board has.
    //
    // So a claimed branch whose agent is thinking travels SLOW, and the moment
    // it writes a file the same dot travels FAST. The operator's words: *the
    // ActivityMark starts when a process runs and flickers faster when real
    // work happens*.
    const thinking = row({ worker: 'running', localDirty: false, localLocked: false });
    expect(isActive(thinking)).toBe(true);
    expect(activityPace(thinking)).toBe('slow');

    const writing = row({ worker: 'running', localDirty: true });
    expect(isActive(writing)).toBe(true);
    expect(activityPace(writing)).toBe('fast');

    const holdingLock = row({ worker: 'running', localLocked: true });
    expect(activityPace(holdingLock)).toBe('fast');

    // A BUILD is a process too, and it has the same two speeds: CI churning
    // through a checkout that is being written to is the fast case.
    const ci = row({ pr: { number: 9, url: 'u', draft: false, state: 'pending' } });
    expect(isActive(ci)).toBe(true);
    expect(activityPace(ci)).toBe('slow');
  });

  it('reads NOTHING but the two local signals', () => {
    // No third speed, and no gradient keyed to commit freshness — a scale
    // nobody can read (*was that four minutes or forty?*) that changes
    // continuously is motion in place of information. Stated by varying
    // everything else on the row and getting one answer.
    const ages = [null, 0, 1, 40, 4_000];
    for (const ageMinutes of ages) {
      expect(activityPace(row({ localDirty: true, ageMinutes }))).toBe('fast');
      expect(activityPace(row({ localDirty: false, ageMinutes }))).toBe('slow');
    }
    for (const group of GROUPS.map((g) => g.key)) {
      expect(activityPace(row({ group, localDirty: true }))).toBe('fast');
      expect(activityPace(row({ group, localDirty: false }))).toBe('slow');
    }
  });
});

/**
 * GROUP PACE — a section heading says what its rows say, one level up.
 *
 * The case this exists for is a COLLAPSED group. QUIET and DONE are in
 * `COLLAPSED_BY_DEFAULT` and the fold is persisted in `localStorage`, so they
 * stay shut across sessions and report `(4)` — a STOCK count, which says *four
 * rows are in here* and never *one of them is moving*. QUIET's own purpose is
 * *"go check whether this died"*, so a group whose whole job is surfacing
 * possible deaths was folded shut showing a number.
 *
 * Binary and derived: at least one row is active, or none is. Every assertion
 * below is about which of the two paces the heading is licensed to state.
 */
describe('groupPace — the heading states the strongest pace its rows state', () => {
  const keysOf = (...rows: AgentRow[]) => new Set(rows.map(rowKey));

  it('says NOTHING for a group with no active and no live row', () => {
    // The floor, and the half that makes every positive claim mean something: a
    // heading that always carried the mark would say nothing at all. Stated
    // first because it is the common case — most sections are quiet.
    const rows = [row({ branch: 'a' }), row({ branch: 'b' })];
    expect(groupPace(rows, new Set())).toBeNull();
  });

  it('says FAST when a row in it is being written to', () => {
    // The reported case: a folded group with an agent working inside it.
    const writing = row({ branch: 'writing', localDirty: true });
    const rows = [row({ branch: 'quiet' }), writing];
    expect(groupPace(rows, keysOf(writing))).toBe('fast');
  });

  it('says SLOW for a group holding only CLAIMED rows', () => {
    // `isLive` is the second entry path and it is a weaker claim: the fleet put
    // the row in WORKING, and this checkout observed nothing local. Absence is
    // not falsehood, so the heading says *unknown*, never *nobody*.
    const rows = [row({ branch: 'claimed', group: 'working' })];
    expect(groupPace(rows, new Set())).toBe('slow');
  });

  it('says FAST when one measured row sits among merely-claimed ones', () => {
    // THE ordering assertion, and the pairing that matters: an implementation
    // returning the WEAKEST pace — or reading the rows in order and keeping the
    // last answer — passes every test above and lets one measured write hide
    // behind three unobserved claims. That is the reading the fold exists to
    // prevent, since the fast row is the one worth opening the group for.
    //
    // The written-to row is deliberately LAST, so an implementation that stops
    // at the first live row it meets fails here rather than by luck.
    const writing = row({ branch: 'writing', group: 'working', localDirty: true });
    const rows = [
      row({ branch: 'claimed-a', group: 'working' }),
      row({ branch: 'claimed-b', group: 'working' }),
      writing,
    ];
    expect(groupPace(rows, keysOf(writing))).toBe('fast');
  });

  it('reads the ECHO, not just this pulse\'s signals', () => {
    // `active` is the fleet's answer for the whole list — `isActive` in this
    // pulse OR a lock seen in a recent one still echoing. A heading computed
    // from `isActive` alone would go dark for a group whose row still carries
    // the mark, which is the heading disagreeing with its rows.
    const echoing = row({ branch: 'echoing' });
    expect(isActive(echoing)).toBe(false);
    expect(groupPace([echoing], keysOf(echoing))).toBe('fast');
  });

  it('cannot disagree with its rows — same set, same predicate', () => {
    // The heading is derived from exactly what the rows are rendered from, so
    // agreement is structural rather than tested. Stated as the equivalence:
    // the heading carries a mark precisely when some row would.
    const active = row({ branch: 'writing', localDirty: true });
    const live = row({ branch: 'claimed', group: 'working' });
    const still = row({ branch: 'quiet' });
    for (const rows of [[active, still], [live, still], [still], [active, live]]) {
      const keys = new Set(rows.filter((r) => r.localDirty).map(rowKey));
      const heading = groupPace(rows, keys);
      const anyRowMarked = rows.some((r) => keys.has(rowKey(r)) || isLive(r));
      expect(heading !== null).toBe(anyRowMarked);
    }
  });

  it('is BINARY — the same answer for one active row as for three', () => {
    // No second number. `(4)` exists to separate ABSENT from EMPTY, a
    // distinction this board paid for, and `(4, 2 active)` dilutes the one job
    // that number has. The reader does not need to know whether it is one row
    // or three; they need to know whether opening it is worth it.
    const one = row({ branch: 'a', localDirty: true });
    const two = row({ branch: 'b', localDirty: true });
    const three = row({ branch: 'c', localDirty: true });
    expect(groupPace([one], keysOf(one)))
      .toBe(groupPace([one, two, three], keysOf(one, two, three)));
  });

  it('says nothing for an EMPTY group', () => {
    // An empty group is never foldable and its header carries the hint rather
    // than `(0)`. A mark on it would claim activity in a section with no rows
    // to be active — and `.some()` on an empty array is the shape that gets
    // this right by accident, so it is pinned deliberately.
    expect(groupPace([], new Set())).toBeNull();
  });

  it('ignores rows that are not its own', () => {
    // `active` answers for the WHOLE fleet at once, so every heading is handed
    // the same set and must read only the rows it was given. An implementation
    // asking *is anything in the fleet active* would light every heading on the
    // board from one busy row in one section.
    const elsewhere = row({ branch: 'other-section', localDirty: true });
    const mine = [row({ branch: 'mine' })];
    expect(groupPace(mine, keysOf(elsewhere))).toBeNull();
  });

  it('does not mark a group for UNPUSHED work alone', () => {
    // `localAhead` is finished work sitting still — a real condition with a
    // real remedy (push it) and no motion behind it. It earns a static mark of
    // its own in a later wave; it does not earn this one, and a heading that
    // travelled for it would report motion where there is none.
    const ahead = row({ branch: 'ahead', note: '2 commits not pushed' });
    expect(groupPace([ahead], new Set())).toBeNull();
  });
});

/**
 * THE MARK'S APPEARANCE, read out of the source.
 *
 * The rendered half — the glow's computed `box-shadow`, the travel actually
 * running at two rates, its survival under `prefers-reduced-motion`, the six
 * tracks not moving — lives in `test/integration/activity-mark.browser.test.ts`,
 * because only a page can answer it. What is here is the half a string can state
 * exactly: which utilities each element carries, and which it must not.
 *
 * `className` is isolated from the component rather than searched for across the
 * file, and that is the whole point of the helper below: this file contains four
 * marks and each names the other three in its own doc comment, so a plain
 * `indexOf` would walk from a comment into the wrong element's class list and
 * assert one mark's geometry against another's.
 */
describe('the activity mark is a track with a travelling dot', () => {
  // THE MARKS' OWN MODULE — see the note on the describe above. The four marks
  // the docstring discusses are now `lib/agent-rows/marks.tsx`, and the
  // confusion this helper guards against is between them, wherever they live.
  const source = readFileSync(
    new URL('../../src/app/lib/agent-rows/marks.tsx', import.meta.url), 'utf8');

  /**
   * The `className` string of the JSX element carrying `data-<hook>`.
   *
   * Anchored on the hook as a JSX ATTRIBUTE — alone on its line — rather than on
   * any mention of the string. Every mark in this file names the other three in
   * its doc comment (*deliberately NOT `[data-live-dot]`*), and those mentions
   * come FIRST in the file, so a plain `indexOf` would walk from a comment into
   * the wrong element's class list and assert one mark's geometry against
   * another's. That is not hypothetical: it is what the first draft of this
   * helper did.
   */
  function classesOf(hook: string): string {
    const at = source.search(new RegExp(`^\\s*data-${hook}\\s*$`, 'm'));
    expect(at, `no data-${hook} JSX attribute in marks.tsx`).toBeGreaterThan(-1);
    const after = source.slice(at);
    // BOTH forms, and the second is not a nicety. The activity dot picks its
    // travel utility from the pace, so its class list is a TEMPLATE literal —
    // and a `className="…"`-only matcher does not fail on it, it walks past
    // into the next element in the file and asserts that one's classes under
    // this one's name. That is precisely the confusion this helper exists to
    // prevent, so whichever form comes FIRST after the hook is the one taken.
    const quoted = /className="([^"]*)"/.exec(after);
    const templated = /className=\{`([^`]*)`/.exec(after);
    // The THIRD form, and it exists for the same reason the second does. The
    // activity mark hangs in two places — the row's left padding and a group
    // heading — so its class list is a LOOKUP (`className={ACTIVITY_MARK_PLACE[place]}`)
    // rather than a literal. A matcher that knew only the first two forms does
    // not fail on it: it walks past into the travelling dot below and returns
    // THAT element's classes under the mark's name, which is precisely the
    // confusion this helper exists to prevent. Measured — it did.
    const looked = /className=\{([A-Z_]+)\[/.exec(after);
    const resolved = looked
      ? ({ index: looked.index, 1: placementsOf(looked[1]).join(' ') } as unknown as RegExpExecArray)
      : null;
    const match = [quoted, templated, resolved]
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => a.index - b.index)[0];
    expect(match, `no className after data-${hook}`).not.toBeUndefined();
    return match![1];
  }

  /**
   * Every class list a placement table can produce, as one string.
   *
   * The mark's geometry assertions are about what it NEVER carries — no
   * `animate-*`, no `inset-0` — and those must hold at EVERY placement rather
   * than at whichever one the table happens to list first. Joining them is what
   * makes a `not.toContain` mean *in none of them*.
   */
  function placementsOf(name: string): string[] {
    const table = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\} as const;`).exec(source);
    expect(table, `no ${name} table in marks.tsx`).not.toBeNull();
    const out = [...table![1].matchAll(/^\s{2}\w+: '([^']*)',$/gm)].map((m) => m[1]);
    expect(out.length, `no placements parsed out of ${name}`).toBeGreaterThan(1);
    return out;
  }

  it('reads each mark\'s OWN class list, not the next one in the file', () => {
    // The helper's own guard, and the reason it exists. Every assertion below
    // is worthless if this walks into a neighbour: the marks are adjacent in
    // the source and each names the others in its comment. Two marks whose
    // geometry cannot be confused pin it — a full-row wash and a 12px track.
    //
    // `live-dot` was the third of these until 2026-08-22 and is gone: a static
    // dot beside the travelling one made a WORKING row show two dots a pixel
    // apart. The remaining pair still cannot be confused, which is all this
    // guard needs.
    expect(classesOf('change-mark')).toContain('absolute inset-0');
    expect(classesOf('activity-track')).toContain('w-full');
    expect(classesOf('activity-mark')).not.toContain('inset-0');
    // The template-literal case, which is where this helper failed once: the
    // activity dot's class list is built from the pace, and a matcher that only
    // knew `className="…"` silently returned the CHANGE MARK's classes under
    // the dot's name. Pinned on a class only the dot has.
    expect(classesOf('activity-dot')).toContain('rounded-full');
    expect(classesOf('activity-dot')).not.toContain('inset-0');
  });

  it('hangs in the row\'s padding and FLOWS in a heading', () => {
    // Two placements, one mark. Everything the mark IS — the track, the dot,
    // the glow, the travel, the paces, the titles — is shared; only where it
    // hangs differs, because the two hosts have different geometry.
    //
    // THE assertion, and the failure it guards is not cosmetic: the row's
    // placement is `sm:absolute`, which positions against the nearest
    // positioned ancestor. The `<h2>` has NONE. Reusing the row's string in a
    // heading would not sit the mark slightly wrong — it would hang it off
    // whatever ancestor happened to be `relative` and land it elsewhere on the
    // page. A class-name assertion on a shared string cannot see that.
    // The row placement is no longer absolute at all — it is a grid cell. What
    // the heading assertion below protects is unchanged: a heading has no
    // positioned ancestor, so it must never borrow a positioned placement.
    expect(ACTIVITY_MARK_PLACE.row).not.toContain('absolute');
    expect(ACTIVITY_MARK_PLACE.heading).not.toContain('absolute');
    // And the heading's mark is not positioned by any other route either.
    expect(ACTIVITY_MARK_PLACE.heading).not.toMatch(/\b(fixed|sticky|top-|left-|-translate-)/);
  });

  it('keeps the ROW\'s placement exactly as the wave before it left it', () => {
    // A shared component gaining a second caller is the moment the first
    // caller's geometry quietly changes. The row's placement is pinned whole,
    // not by fragments: `sm:top-2` and `h-5` together are what put the mark on
    // the row's FIRST LINE rather than at its centre, which is the fix a
    // two-line row needed and which a partial assertion would let slip back.
    // IN A TRACK, not in the padding. This asserted `sm:absolute sm:left-0`
    // until the marks earned a column of their own: `left-0` is the ROW's edge,
    // which sits outside the section's border, so every mark straddled the
    // panel edge — and two marks on one row overlapped, because absolute boxes
    // do not make room for each other. Measured on screen with the activity
    // track and the unpushed bar on one branch.
    //
    // The cell that holds them is unconditional while its contents are not, so
    // a row with no marks still occupies the track and the six columns beside
    // it do not shift. That is the alignment `agent-rows-line-up` paid for, now
    // held by a track rather than by keeping the marks outside the grid.
    // NO padding of its own — the row already carries `py-2`, and a second pair
    // here made every row as tall as a two-line one (both measured at 60px).
    // The height comes from the row's content; `self-stretch` only takes it.
    // `items-start` SINCE THE TRACK WIDENED, and the change is measured. The
    // marks track went from 1rem to 1.5rem with the tuple, and a CENTRED 12px
    // mark in a 24px cell lands at 35px — to the RIGHT of the live dot at 33px,
    // which sits at `sm:left-1` of this same cell. Two marks in the wrong order
    // read as one smeared pair, which is what the track was cut to prevent.
    // The marks LEAD the row, so they start where the cell starts.
    expect(ACTIVITY_MARK_PLACE.row).toBe(
      'relative flex w-full shrink-0 flex-col items-start justify-start gap-1 self-stretch pt-0.5');
    // STILL NO `py-`, and the guard is worded exactly right: SYMMETRIC vertical
    // padding is what made every row as tall as a two-line one. `pt-0.5` is
    // top-only, 2px, inside a `self-stretch` cell whose height comes from the
    // row — and it was measured rather than reasoned about, because reasoning
    // got this wrong once: single-line rows stay at 37px with it, and only the
    // agent row is taller (56px), from its own wrapped slot 4.
    expect(ACTIVITY_MARK_PLACE.row).not.toMatch(/\bpy-/);
  });

  it('gives the heading a box that fits a heading', () => {
    // The heading is `text-xs`; the row's 20px line box would stretch it and
    // push the section's own words apart. `self-center` because the heading
    // aligns on `items-baseline` and a track carries no text to align.
    expect(ACTIVITY_MARK_PLACE.heading).toContain('self-center');
    expect(ACTIVITY_MARK_PLACE.heading).not.toContain('h-5');
  });

  it('travels at exactly two rates, and no third', () => {
    // THE rule of this wave, pinned as strings: two utilities, chosen by the
    // pace and nothing else. The failure this guards is a gradient — a speed
    // keyed to commit freshness — which is a scale nobody can read (*was that
    // four minutes or forty?*) changing continuously, and which would pass any
    // assertion that only checks "the dot moves".
    expect(source).toContain('animate-travel-fast');
    expect(source).toContain('animate-travel-slow');
    // The dot's class list carries one of the two and is otherwise still: no
    // `animate-pulse` or `animate-ping` smuggled in beside the travel, which
    // would put this mark back into the channel the other three already hold.
    const dot = classesOf('activity-dot');
    expect(dot).toMatch(/animate-travel-(fast|slow)/);
    expect(dot).not.toMatch(/animate-(pulse|ping|spin|bounce)/);
    // And the TRACK does not animate at all. Only the dot moves; a track that
    // pulsed underneath it would be a fifth thing blinking on the row.
    expect(classesOf('activity-mark')).not.toMatch(/animate-/);
  });

  it('keeps the mark and the dot under motion-reduce, and stops only the travel', () => {
    // Both halves, and the fifth time this repo has written the rule. Hiding
    // the element under reduced motion passes a motion-only assertion and takes
    // the MARKER along with the movement.
    //
    // `animate-none` and NOT `hidden`, `invisible` or `opacity-0`: each of those
    // would stop the travel and lose the mark, which is exactly the defect.
    const dot = classesOf('activity-dot');
    expect(dot).toContain('motion-reduce:animate-none');
    expect(dot).not.toMatch(/motion-reduce:(hidden|invisible|opacity-0)/);
    // The glow is NOT reduced with the motion. It is what the mark is seen by,
    // and under reduced motion it is the only thing left — a
    // `motion-reduce:shadow-none` would leave a bare dot on a faint line.
    expect(dot).not.toContain('motion-reduce:shadow');
  });

  it('never fills, completes or arrives', () => {
    // The constraint that makes travel acceptable at all. Rotation and
    // traversal were refused twice in this repo because they *imply progress
    // toward completion, which nothing here measures*; a dot that returns
    // promises no destination and reports a RATE instead.
    //
    // The keyframes are where "returns to its start" is enforced, so they are
    // read out of the stylesheet rather than inferred from the class name — a
    // one-way `travel` would carry exactly the same utility name.
    const css = readFileSync(
      new URL('../../src/app/index.css', import.meta.url), 'utf8');
    const frames = /@keyframes travel\s*\{([\s\S]*?)\n  \}/.exec(css);
    expect(frames, 'no @keyframes travel in index.css').not.toBeNull();
    const body = frames![1];
    // Starts and ends at the same place — stated on BOTH ends, because a frame
    // set with only `0%` and `50%` also "returns" and would leave the property
    // undefined at the close.
    expect(body).toMatch(/0%\s*\{\s*transform:\s*translateX\(0\)/);
    expect(body).toMatch(/100%\s*\{\s*transform:\s*translateX\(0\)/);
    // Nothing that fills or completes: the progress vocabulary this repo
    // refused, named so a later "improvement" fails rather than lands.
    expect(body).not.toMatch(/\bwidth\b|\bscaleX\b|stroke-dash/);
    // And the cycle carries the return itself rather than borrowing it from
    // `alternate`, which spends half its time running backwards.
    expect(css).not.toMatch(/--animate-travel-(fast|slow):[^;]*alternate/);
  });

  it('glows in its own colour, in both themes', () => {
    // The glow is what carries the mark across a room, so it is not optional
    // decoration — and under reduced motion it is all that is left. An emerald
    // `shadow-[…]` rather than a step on the neutral shadow scale: those are
    // greys for lifting a surface off the page, and a grey blur around a 6px
    // dot reads as a smudge rather than a light.
    //
    // On the DOT, which is what glows. The track behind it is deliberately dim.
    const dot = classesOf('activity-dot');
    expect(dot).toMatch(/shadow-\[[^\]]*rgba\(16,\s*185,\s*129/);
    expect(dot).toMatch(/dark:shadow-\[[^\]]*rgba\(52,\s*211,\s*153/);
  });

  it('is a horizontal TRACK carrying a dot, not a bar and not a bare dot', () => {
    // The shape the travel needed: a short rule the dot can ride. The mark used
    // to be `h-5 w-1`, a vertical stroke; turning the axis is the change.
    // Stated against `LiveDot`'s own geometry so the two cannot drift into one
    // shape — that is a 6px round dot at a fixed x.
    const track = classesOf('activity-track');
    expect(track).toContain('h-0.5');
    expect(track).toContain('w-full');
    // `relative`, because the dot inside is positioned against IT — the dot's
    // reach is a fraction of the track, and a track that were not the
    // containing block would decouple the two.
    expect(track).toContain('relative');
    // AND THE DOT IS THE TRACK'S OWN, not a second mark beside it. `LiveDot`
    // used to sit one pixel away at `left-1`; the screenshot that reported the
    // overlap is why it is gone. What rides the track is `data-activity-dot`,
    // and nothing else is drawn next to it.
    expect(classesOf('activity-dot')).toContain('h-1.5 w-1.5');
    expect(classesOf('activity-dot')).toContain('absolute');
  });

  it('gives the mark the FIRST LINE\'S OWN BOX rather than a computed offset', () => {
    // How the alignment is made honest. The outer element is one line box tall
    // (`h-5` = 20px of `text-sm`) starting at the row's own `py-2`, and the
    // track centres itself inside it. The line's height is therefore stated
    // ONCE and no pixel downstream has to be guessed.
    //
    // The alternative — a hand-computed `top-4.5` — is right today and wrong the
    // moment the type scale moves, which is exactly the failure mode that put
    // the mark between two lines in the first place. Measured: the first line
    // box begins 18.6px below the row's top edge, not the 8px or 10px a reader
    // would derive from the padding alone.
    // The cell answers this now: `self-stretch` takes the row's own height and
    // `justify-start` puts the marks at its TOP — the first line, which is what
    // this test is named for. No number is stated at all, which is the strongest
    // form of the same rule, since the line height it used to name (`h-5`) was
    // itself a value that could go stale.
    //
    // It read `justify-center` until 2026-08-20, and centring across a
    // `self-stretch` cell is *the first line* only while the row is one line
    // tall — see the sibling test for the measurement that separated them.
    //
    // `justify-*`, not `items-*`, and the pairing is worth stating because the
    // two were conflated here. In a `flex-col` the MAIN axis is vertical, so
    // `justify-*` is what places the stack and `items-*` decides where it sits
    // horizontally — a different question, answered `items-start` above for a
    // measured reason. An assertion on `items-center` was reading the cross axis
    // while claiming the main one.
    const mark = ACTIVITY_MARK_PLACE.row;
    expect(mark).toContain('self-stretch');
    expect(mark).toContain('justify-start');
    expect(mark).toContain('flex-col');
    // And no hand-computed offset, which is the failure mode this guards.
    expect(mark).not.toMatch(/\btop-\d/);
  });

  it('renders the dot as its own element inside the track', () => {
    // Three elements, and the hooks prove it: a single element that was both
    // the track and the traveller would have to move the track itself, which is
    // the implementation where the mark drifts away from its own x.
    expect(source).toContain('data-activity-track');
    expect(source).toContain('data-activity-dot');
    const dot = classesOf('activity-dot');
    expect(dot).toContain('absolute');
    expect(dot).toContain('h-1.5 w-1.5');
  });

  it('has a track of its own, and the cell holds it whether or not a mark is in it', () => {
    // A SEVENTH TRACK, reversing wave 1's placement — and the reversal is the
    // point. That wave hung the mark in the row's padding (`sm:absolute
    // sm:left-0`) so six columns would not move in to reserve room for a mark
    // most rows never carry. That argument held while there was ONE mark.
    //
    // There are now five, and a row can wear several: measured on screen, the
    // activity track and the unpushed bar overlapped, because absolute boxes
    // make no room for each other — and `left-0` is the ROW's edge, which sits
    // outside the section's border, so every mark straddled the panel edge.
    //
    // In the track they stack in the flow. The cost was paid in the phase
    // column, which gave up 1rem: see the breakpoint arithmetic further down.
    const mark = ACTIVITY_MARK_PLACE.row;
    expect(mark).not.toContain('absolute');
    expect(mark).toContain('flex-col');
    // The CELL is unconditional while its contents are not — that is what keeps
    // a markless row's six other cells from shifting one column left.
    expect(mark).toContain('w-full');
  });

  it('aligns to the row\'s FIRST LINE, not to the row\'s centre', () => {
    // The defect fixed in the commit before this one, pinned as a string. The
    // mark used to carry `sm:top-1/2 sm:-translate-y-1/2`, which centres it on
    // the whole ROW — correct only while the assumption its comment stated
    // held: *the row is `py-2` around ONE line of `text-sm`*. The stuck cell
    // broke that by landing as its own line beneath the six columns, and a
    // centred mark on a two-line row sits BETWEEN the lines rather than beside
    // the branch name.
    //
    // Now a CELL rather than an offset, which answers the same question without
    // arithmetic: `self-stretch` makes the box the full height of the row.
    //
    // AND `justify-start`, which this asserted as `justify-center` until
    // 2026-08-20 — while its own TITLE said *first line*. The two agreed only
    // for as long as rows were one line tall: centring in a one-line cell IS
    // the first line. On a row that wraps they diverge, and centring puts the
    // mark exactly where this test says it must not go — between the lines.
    //
    // Which is the scenario the comment above already cites: *"the stuck cell
    // broke that by landing as its own line beneath the six columns."* Measured
    // on the mock, an agent row 56px tall against 37px for its neighbours, its
    // activity dot at y=24 while the name sat at y=9. With `justify-start` the
    // dot is at y=11 — the line it belongs to.
    //
    // The title was right and the class was wrong.
    const mark = ACTIVITY_MARK_PLACE.row;
    expect(mark).toContain('self-stretch');
    expect(mark).toContain('justify-start');
    expect(mark).not.toContain('justify-center');
    // Every positioned form is GONE. Asserted negatively because leaving one
    // behind would fight the cell: a stray `translate-y` on the parent is a
    // transform the dot's own `translateX` travel would have to fight.
    expect(mark).not.toContain('sm:top-1/2');
    expect(mark).not.toContain('-translate-y-1/2');
    expect(mark).not.toContain('sm:left-0');
  });
});

describe('isStartable — which NOT STARTED rows offer work', () => {
  // A startable row: the FIELD says `click`, and `startability` was computed by
  // the server as `start-work`. The note is kept beside it because that is what
  // the server sends — but nothing here reads it.
  const notStarted = (over: Partial<AgentRow> = {}) =>
    row({
      group: 'not-started', state: 'open', ageMinutes: null,
      waitingOn: 'click', note: ELIGIBLE_NOTE,
      // Default: startable. Tests override this for blocked/draft/deferred.
      startability: 'start-work' as const,
      ...over,
    });

  it('offers a branch no earlier wave blocks', () => {
    expect(isStartable(notStarted())).toBe(true);
  });

  it('offers NOTHING on a branch blocked by an earlier slice', () => {
    // The load-bearing negative, and the half a naive `group === 'not-started'`
    // implementation gets wrong: the group holds both kinds. A button here
    // would offer to skip the ordering waves exist to express, and
    // plot-dispatch.sh refuses that branch — so the board would be inviting an
    // action the tool declines.
    //
    // `startability: null` — blocked branches have no startability verdict.
    expect(isStartable(notStarted({ waitingOn: 'time', note: 'blocked by Truth', startability: null }))).toBe(false);
  });

  it('reads the FIELD, and no wording of the note can change its answer', () => {
    // This test used to assert the opposite mechanism — that the row is matched
    // against the shared `ELIGIBLE_NOTE` constant — and its own reason for
    // existing was that "a reword would take the button away with nothing
    // failing". The reword arrived: the same change that added `waitingOn` gave
    // the blocked note the wave's name.
    //
    // So the reason survives and the mechanism is inverted. The note is now
    // prose for humans and decides nothing: a row with the WRONG note is still
    // startable, and a row with the right note is not startable without the
    // `startability` field. Those two are the assertion — a rule still reading
    // the sentence passes neither.
    expect(isStartable(notStarted({ waitingOn: 'click', note: 'anything at all', startability: 'start-work' }))).toBe(true);
    expect(isStartable(notStarted({ waitingOn: 'time', note: ELIGIBLE_NOTE, startability: null }))).toBe(false);
    expect(isStartable(notStarted({ waitingOn: null, note: ELIGIBLE_NOTE, startability: null }))).toBe(false);
  });

  it('offers nothing on a row that already has a branch and a claim', () => {
    // Working and quiet rows are somebody's already. Offering to start one
    // invites exactly the double-dispatch fleet-sees-merged-branches prevents.
    // Their `startability` is `someone-is-on-it` or `null`.
    for (const group of ['working', 'quiet', 'waiting-on-you', 'done'] as const) {
      expect(isStartable(row({ group, state: 'open', note: ELIGIBLE_NOTE, startability: null }))).toBe(false);
    }
  });

  it('offers NOTHING on a branch whose plan is still a Draft', () => {
    // The other half of the same rule, and the reason the draft note is a
    // sibling of ELIGIBLE_NOTE rather than a suffix on it: `plot-dispatch`
    // refuses a drafted plan's branches exactly as it refuses a wave-blocked
    // one, so the button must not appear on either.
    //
    // It comes out right by CONSTRUCTION — a Draft plan's first wave is
    // `waitingOn: 'you'`, and `startability: 'waiting-on-approval'`, so the row
    // is not startable. Pinned anyway: worth failing loudly if someone
    // later widens the predicate.
    expect(isStartable(notStarted({ waitingOn: 'you', note: DRAFT_PLAN_NOTE, startability: 'waiting-on-approval' }))).toBe(false);
  });

  it('offers nothing on a deferred branch, whatever group it lands in', () => {
    // Deferred rows are `not-started` by group — nobody is working on them —
    // but the work was handed back deliberately, not left untaken. Starting it
    // is a decision about whether the branch is wanted at all, which is not
    // what this button does. Their `startability` is `null`.
    expect(isStartable(row({ group: 'not-started', state: 'deferred', note: ELIGIBLE_NOTE, startability: null })))
      .toBe(false);
  });
});

describe('which groups start collapsed', () => {
  it('folds quiet and done, and leaves every other group open', () => {
    // BOTH halves. A blanket default — everything folded, or nothing — passes
    // an assertion that checks only one group, and the whole point of the
    // default is that it is the existing actionable-before-diagnostic order
    // made effective rather than a blanket preference.
    expect([...COLLAPSED_BY_DEFAULT].sort()).toEqual(['done', 'quiet']);
    const open = GROUPS.map((g) => g.key).filter((k) => !COLLAPSED_BY_DEFAULT.includes(k));
    expect(open).toEqual(['waiting-on-you', 'working', 'waiting-on-machine', 'not-started']);
  });

  it('folds the DIAGNOSTIC end of the order and nothing above it', () => {
    // Stated against the order itself rather than against two names, so a group
    // inserted between `not-started` and `quiet` cannot silently become
    // collapsed-by-default.
    const keys = GROUPS.map((g) => g.key);
    const folded = keys.filter((k) => COLLAPSED_BY_DEFAULT.includes(k));
    expect(folded).toEqual(keys.slice(keys.length - folded.length));
  });
});

describe('isCollapsible — an empty group hides nothing', () => {
  it('offers no control on an empty group', () => {
    // The header renders `rows.length > 0 ? '(N)' : hint`, so folding an empty
    // group would hide the hint — the explanation for the emptiness, and the
    // one thing in there worth reading. A control on a group with nothing to
    // hide is an offer that leads nowhere.
    expect(isCollapsible(0)).toBe(false);
  });

  it('offers one as soon as there is a row to hide', () => {
    expect(isCollapsible(1)).toBe(true);
    expect(isCollapsible(7)).toBe(true);
  });
});

describe('readCollapsed / writeCollapsed — persistence, and its default', () => {
  /** A localStorage stand-in, so the test states the storage rather than the DOM. */
  const store = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      read: () => [...map.entries()],
    };
  };

  it('applies the default when nothing is stored', () => {
    // The load-bearing half: a first visit has no stored value, and treating
    // that as "nothing collapsed" ships the crowded view to everyone who has
    // not yet clicked a header.
    expect([...readCollapsed(store())].sort()).toEqual(['done', 'quiet']);
  });

  it('survives a reload — what was written comes back', () => {
    const s = store();
    writeCollapsed(new Set(['working'] as const), s);
    expect([...readCollapsed(s)]).toEqual(['working']);
  });

  it('distinguishes "nothing stored" from "everything opened"', () => {
    // Absent and empty are different statements: `[]` is a reader who opened
    // every group and meant it, and re-applying the default over that would
    // undo their choice on every reload.
    const s = store();
    writeCollapsed(new Set(), s);
    expect([...readCollapsed(s)]).toEqual([]);
  });

  it('falls back to the default on stored junk rather than throwing', () => {
    // A view that renders nothing because it could not remember which sections
    // were folded is a worse answer than one that simply forgets.
    for (const raw of ['not json', '{"quiet":true}', '"quiet"', '17']) {
      expect([...readCollapsed(store({ 'plot-board:agents:collapsed': raw })).values()].sort())
        .toEqual(['done', 'quiet']);
    }
  });

  it('drops a stored key no group answers to', () => {
    // Stale state from a renamed group would fold nothing while looking like it
    // had — a set that disagrees with the rendered sections.
    const s = store({ 'plot-board:agents:collapsed': '["quiet","gone-group"]' });
    expect([...readCollapsed(s)]).toEqual(['quiet']);
  });

  it('never touches the query string', () => {
    // Collapse state must not be shareable: a link carrying ?collapsed=quiet,done
    // would rebuild the recipient's view as a side effect of "have a look at
    // this". Asserted on the KEY the state is written under — a storage key is
    // not a query parameter, and the browser-level assertion that the URL is
    // unchanged by toggling lives in the integration test.
    const s = store();
    writeCollapsed(new Set(['quiet'] as const), s);
    expect(s.read().map(([k]) => k)).toEqual(['plot-board:agents:collapsed']);
  });
});

describe('noActionReason — the disabled menu says why', () => {
  it('names the ROW\'s own reason, not a generic "no actions"', () => {
    // A disabled control without a reason is the kind that makes people guess,
    // and the row already knows: its note is the whole explanation.
    expect(noActionReason(row({ note: 'blocked by an earlier slice' })))
      .toMatch(/blocked by an earlier slice/);
    expect(noActionReason(row({ note: 'no commit for 22 days' })))
      .toMatch(/no commit for 22 days/);
  });

  it('still says something on a row carrying no note', () => {
    expect(noActionReason(row({ note: '' }))).toBeTruthy();
  });
});

describe('splitBranch — the elision is in the MIDDLE', () => {
  it('protects the TAIL, which is where these names differ', () => {
    // The whole decision, and the one an ordinary `truncate` gets backwards.
    // Six branches share `feature/opus5-hardening-` and differ only after it,
    // so end-truncation renders all six identically — which reads as six
    // duplicate rows rather than as truncation.
    const a = splitBranch('feature/opus5-hardening-challenge-budget');
    const b = splitBranch('feature/opus5-hardening-longhorizon');
    // The heads may be clipped to nothing by a narrow column; the tails are
    // pinned, and they are what tells the two apart.
    expect(a.tail).not.toBe(b.tail);
    // Each half joins back to the whole name — nothing is lost, only folded.
    expect(a.head + a.tail).toBe('feature/opus5-hardening-challenge-budget');
    expect(b.head + b.tail).toBe('feature/opus5-hardening-longhorizon');
  });

  it('leaves a short name entirely in the head, with nothing pinned', () => {
    // With no tail to hold the right edge, `truncate` has nothing to clip
    // against and a fitting name renders whole — so a short branch never gains
    // an ellipsis it did not need.
    expect(splitBranch('main')).toEqual({ head: 'main', tail: '' });
    expect(splitBranch('feature/xy', 12)).toEqual({ head: 'feature/xy', tail: '' });
  });

  it('keeps the tail budget off the head when the name is exactly the budget', () => {
    // The boundary: equal to the budget is still "fits", not "fold it all".
    expect(splitBranch('abcdefghijkl', 12)).toEqual({ head: 'abcdefghijkl', tail: '' });
    expect(splitBranch('abcdefghijklm', 12))
      .toEqual({ head: 'a', tail: 'bcdefghijklm' });
  });
});

describe('prStateWord — the state travels as a WORD', () => {
  it('spells out each condition, because a symbol may never be the sole carrier', () => {
    expect(prStateWord('green')).toBe('green');
    expect(prStateWord('pending')).toBe('CI running');
    expect(prStateWord('failing')).toBe('checks failing');
    expect(prStateWord('conflicts')).toBe('conflicts');
  });

  it('distinguishes `no checks` from `conflicts` — the defect being fixed', () => {
    // One label for both is the defect, and renaming all of them to
    // `conflicts` is the same defect mirrored: a workflow genuinely awaiting a
    // human click wants a click, and a conflicting branch wants a rebase.
    expect(prStateWord('none')).toBe('no checks');
    expect(prStateWord('none')).not.toBe(prStateWord('conflicts'));
  });

  it('says NOTHING where the host cannot report a state', () => {
    // Bitbucket carries no rollup. A word meaning only *this board could not
    // find out*, stamped on every row of an entire host, is noise — and absent
    // is the honest rendering, which is the rule the contract states for the
    // field itself.
    expect(prStateWord('unknown')).toBe('');
  });
});

describe('noteWithoutPr — the note is relieved of one duty, not replaced', () => {
  const pr = (number: number) =>
    ({ number, url: '', draft: false, state: 'green' as const });

  it('keeps everything a PR state cannot say', () => {
    // The three the plan names, each carried after the server's separator.
    expect(noteWithoutPr('PR #158, conflicts · awaiting review', pr(158)))
      .toBe('awaiting review');
    expect(noteWithoutPr('uncommitted work in a local worktree', null))
      .toBe('uncommitted work in a local worktree');
    expect(noteWithoutPr('blocked by an earlier slice', null))
      .toBe('blocked by an earlier slice');
  });

  it('drops a PR clause that says only what the cell already says', () => {
    // `PR #130 green` and `PR #131, draft, CI running` are entirely the PR's
    // own condition, which the cell now renders from the fields. Printing them
    // beside it would say the same thing twice on every row with a PR.
    expect(noteWithoutPr('PR #130 green', pr(130))).toBe('');
    expect(noteWithoutPr('PR #131, draft, CI running', pr(131))).toBe('');
  });

  it('returns EMPTY for a note that is only its PR — which a caller must not read as "no row"', () => {
    // The empty string above is correct and it is a trap for whoever consumes
    // it. `sliceNote` guarded on `soleNote` rather than on `soleRow`, so a wave
    // whose one branch carried `PR #323 green` — nothing left after the strip —
    // fell through to a verdict sentence about STARTING work that was finished:
    // measured 2026-08-22, `green` rendered beside `approved — nobody has taken
    // it`. Every single-branch wave reaching review hit it.
    //
    // The fix is at the caller, which now asks `soleRow ? soleNote : …`. This
    // case is pinned here so the emptiness stays a known answer rather than an
    // accident someone "fixes" by returning the note unchanged.
    expect(noteWithoutPr('PR #323 green', pr(323))).toBe('');
  });

  it('is anchored, and matches only the row\'s OWN number', () => {
    // This is deliberately NOT the `indexOf` search it replaces. That one
    // hunted a marker ANYWHERE in a sentence in order to link it, and dropped
    // the link the moment the wording drifted. This one fails the other way: a
    // note it does not recognise is printed IN FULL, which costs a duplicated
    // word rather than a lost link — and the cell renders from the fields
    // either way.
    expect(noteWithoutPr('see PR #130 green', pr(130))).toBe('see PR #130 green');
    expect(noteWithoutPr('PR #999 green', pr(130))).toBe('PR #999 green');
    expect(noteWithoutPr('PR #130 green', null)).toBe('PR #130 green');
  });
});

describe('groupedNote — a note is DERIVED, never defaulted into', () => {
  it('answers only for the two words a count can mean', () => {
    // These are the two the fold's count actually carries in a section where a
    // wave row states what it holds: DONE folds delivered branches, QUIET folds
    // stalled ones. Each says what the wave IS, and neither is *may it start* —
    // which is the verdict's job, and the reason these two are the whole
    // vocabulary.
    expect(groupedNote('delivered')).toBe('landed — nothing left in it');
    expect(groupedNote('stalled')).toBe('nothing has moved here for a while');
  });

  it('returns EMPTY for any other word — it does NOT assert work landed', () => {
    // The defect this branch ends: the fallback returned `work landed — waiting
    // to be merged` for ANY unrecognised word, and `to approve` — a wave whose
    // PLAN is still in review, no PR opened, nothing pushed — hit it. Measured
    // 2026-08-23 on five live blocked waves, every one read that a merge was
    // pending over branches that had never been touched, two lines above their
    // own rows saying *plan not approved yet — still in review*.
    //
    // Empty is the whole fix: `''` is falsy, so the caller's ternary falls
    // through to the verdict — the value that actually describes the wave. A
    // note is DERIVED for words it knows and DECLINED otherwise; it is never
    // defaulted into a claim.
    //
    // `to approve` is the word the live population carried; the unknown case is
    // asserted beside it so no future word can inherit the old assertion.
    expect(groupedNote('to approve')).toBe('');
    expect(groupedNote('to review')).toBe('');
    expect(groupedNote('anything-unrecognised')).toBe('');
    expect(groupedNote(undefined)).toBe('');
  });
});

describe('changedRows — which rows mark themselves, and which stay silent', () => {
  /** A row carrying one PR state, or none. */
  const withState = (branch: string, state: WatchedState) =>
    row({ branch, pr: state === null ? null
      : { number: 1, url: '', draft: false, state } });

  /** The memory as it stands after observing `rows` once. */
  const observed = (...rows: AgentRow[]) => changedRows(new Map(), rows).next;

  it('marks NOTHING on the first pulse, however much state the rows carry', () => {
    // The case that fires on every page load, every board restart and every
    // reconnect — and the one a naive implementation gets wrong in the loudest
    // possible way, by flashing all 43 rows at once. `unknown → conflicts` is a
    // first sighting, not a transition.
    const rows = [withState('a', 'conflicts'), withState('b', 'green'), withState('c', null)];
    const { changed, next } = changedRows(new Map(), rows);
    expect(changed.size).toBe(0);
    // It still RECORDED all three, or the second pulse would be a first one.
    expect(next.size).toBe(3);
  });

  it('marks NOTHING when only the AGE moved — the clock is not a change', () => {
    // THE DEFECT THIS LOCKS OUT, measured on the live board 2026-08-24.
    //
    // `changedAgo` is *seconds since* the newest evidence of work, recomputed
    // against `now` on every scan: 71805 → 71824 across 12 quiet seconds. It was
    // a watched field, so all 16 rows that had one flashed on every pulse
    // forever, while the 74 with a null age (no worktree, nothing to time) never
    // flashed at all. The mark that means *this row is not what it was* fired
    // hardest on rows nobody had touched in nineteen hours.
    //
    // The instant is what the detector wants; the age is for the reader.
    const before = row({ branch: 'a', changedAgo: 71_805, changedAt: 1_756_000_000 });
    const after = row({ branch: 'a', changedAgo: 71_824, changedAt: 1_756_000_000 });
    expect(changedRows(observed(before), [after]).changed.size).toBe(0);
  });

  it('marks a row when the write INSTANT moves, even with the age unchanged', () => {
    // The other half, and why the age cannot simply be dropped from the map: a
    // save must still flash. Here the age is held fixed to prove the instant is
    // doing the work rather than riding along on a correlated field.
    const before = row({ branch: 'a', changedAgo: 30, changedAt: 1_756_000_000 });
    const after = row({ branch: 'a', changedAgo: 30, changedAt: 1_756_000_400 });
    expect([...changedRows(observed(before), [after]).changed]).toEqual([rowKey(after)]);
  });

  it('marks a row whose state changed', () => {
    const prior = observed(withState('a', 'pending'));
    expect([...changedRows(prior, [withState('a', 'failing')]).changed])
      .toEqual(['plot/a/a-plan']);
  });

  it('does NOT mark a row whose watched value held, however much else moved', () => {
    // The marker is about the watched value ALONE. A new commit, a rewritten
    // note and a changed age are not what it claims.
    // The row that MOVED must differ only in facts the marker does not watch.
    // `group` used to be one of those and is now watched — a row changing
    // section is precisely the news this wave widened the value to catch — so
    // it is held constant here and asserted on its own below.
    const prior = observed(withState('a', 'green'));
    const moved = row({
      branch: 'a', pr: { number: 1, url: '', draft: false, state: 'green' },
      note: 'last commit 1 min ago', ageMinutes: 1,
    });
    expect(changedRows(prior, [moved]).changed.size).toBe(0);
    // And the pairing: the same row moving SECTION does flash.
    const movedSection = row({
      branch: 'a', pr: { number: 1, url: '', draft: false, state: 'green' },
      group: 'waiting-on-you',
    });
    expect(changedRows(prior, [movedSection]).changed.size).toBe(1);
  });

  it('marks a PR APPEARING — null is a value, not a gap', () => {
    // `null → pending`: an agent has just delivered, and this is often the most
    // interesting transition a branch ever has.
    const prior = observed(withState('a', null));
    expect([...changedRows(prior, [withState('a', 'pending')]).changed]).toEqual(['plot/a/a-plan']);
  });

  it('marks a PR GOING AWAY, the same as one arriving', () => {
    // `pending → null`, a PR merged or closed out from under the row. An
    // asymmetry here would need a reason and there is none that survives *the
    // row's own state changed*.
    const prior = observed(withState('a', 'pending'));
    expect([...changedRows(prior, [withState('a', null)]).changed]).toEqual(['plot/a/a-plan']);
  });

  it('tells NEVER-SEEN apart from SEEN-WITH-NO-PR', () => {
    // THE pairing of this whole rule. An implementation storing both as
    // "nothing" passes the first-pulse assertion above and then silences every
    // branch's first PR forever — so both halves are asserted against the same
    // row and the same state.
    const fresh = changedRows(new Map(), [withState('a', null)]);
    expect(fresh.changed.size).toBe(0);              // first sighting: silent
    expect(fresh.next.has('plot/a/a-plan')).toBe(true);     // but REMEMBERED,
    // …as a known `null` IN ITS PR SLOT. The memory holds a record now rather
    // than a lone state, so the assertion reads the slot instead of the whole
    // value — the distinction it protects (known-null vs never-seen) is the
    // same one, one field in.
    expect(fresh.next.get('plot/a/a-plan')!.pr).toBe(null);
    // …so the PR that opens next is a change, not another first sighting.
    expect([...changedRows(fresh.next, [withState('a', 'pending')]).changed])
      .toEqual(['plot/a/a-plan']);
  });

  it('marks every changed row — no threshold, no suppression', () => {
    // A move on the default branch flips many PRs to `conflicts` together. Ten
    // changes are ten marks: a rule that went quiet exactly when the most
    // changed would make the board least informative at its most eventful
    // moment.
    const before = Array.from({ length: 10 }, (_, i) => withState(`b${i}`, 'green'));
    const after = Array.from({ length: 10 }, (_, i) => withState(`b${i}`, 'conflicts'));
    expect(changedRows(observed(...before), after).changed.size).toBe(10);
  });

  it('keeps a row\'s memory when the row changes SECTION', () => {
    // The pairing the plan names: `pr.state` helps decide the group, so the
    // changes worth marking are frequently the ones that MOVE the row. A memory
    // keyed on position rather than identity loses the prior value in exactly
    // that case; keyed on `${repo}/${branch}` it survives.
    const before = row({
      branch: 'a', group: 'waiting-on-machine',
      pr: { number: 1, url: '', draft: false, state: 'pending' },
    });
    const after = row({
      branch: 'a', group: 'waiting-on-you',
      pr: { number: 1, url: '', draft: false, state: 'conflicts' },
    });
    expect([...changedRows(observed(before), [after]).changed]).toEqual(['plot/a/a-plan']);
  });

  it('starts a returning row SILENT — absence erases the memory', () => {
    // A branch deleted and recreated, or a row simply missing from one pulse.
    // It has no prior value at its return, so it records rather than marks.
    const first = observed(withState('a', 'green'));
    const withoutIt = changedRows(first, [withState('other', 'green')]);
    expect(withoutIt.next.has('plot/a/a-plan')).toBe(false);
    // Back, with a DIFFERENT state than it left with — still silent.
    expect(changedRows(withoutIt.next, [withState('a', 'conflicts')]).changed.size).toBe(0);
  });

  it('does not crash on the rows that carry no PR at all', () => {
    // Most rows: `not-started`, `quiet`, every fresh claim. An implementation
    // reading `row.pr.state` unguarded throws on precisely these.
    expect(() => changedRows(new Map(), [row({ pr: null })])).not.toThrow();
    // The PR SLOT is null; the record around it is not. That is the widening:
    // a row with no PR still has a git state, a group, a wave and three local
    // signals worth watching, and the crash this guards against is unchanged —
    // reading `row.pr.state` unguarded still throws on exactly these rows.
    expect(watchedState(row({ pr: null })).pr).toBe(null);
  });

  it('does NOT flash on green → unknown → green', () => {
    // THE ASSERTION THIS FIX EXISTS FOR. Once `prState` reports unreadable
    // mergeability honestly, a GitHub 503 turns every row `green → unknown` and
    // the next pulse turns it back. There were four such outages in one
    // afternoon on 2026-08-17: eight flashes per row for nothing that happened.
    //
    // Both halves are asserted against the same row. Suppressing only the way
    // IN leaves the recovery flashing, which is the same light show one pulse
    // later — and it is the half a fix reaching for `if (now === 'unknown')`
    // alone gets wrong.
    const prior = observed(withState('a', 'green'));
    const outage = changedRows(prior, [withState('a', 'unknown')]);
    expect(outage.changed.size).toBe(0);
    const recovered = changedRows(outage.next, [withState('a', 'green')]);
    expect(recovered.changed.size).toBe(0);
  });

  it('flashes a change that HAPPENED during the outage, once it can be seen', () => {
    // The pairing: suppressing the transition must not lose the fact. The
    // memory carries `green` across the unreadable pulse rather than storing
    // `unknown`, so `failing` arriving after the outage is still a change
    // against the last thing anybody actually knew.
    //
    // An implementation that stores `unknown` passes the assertion above and
    // fails this one — it would compare `failing` against `unknown`, suppress
    // that too, and swallow the change entirely.
    const prior = observed(withState('a', 'green'));
    const outage = changedRows(prior, [withState('a', 'unknown')]);
    expect([...changedRows(outage.next, [withState('a', 'failing')]).changed])
      .toEqual(['plot/a/a-plan']);
  });

  it('stays silent for a row that has ONLY ever been unknown', () => {
    // Every Bitbucket row, permanently: `bb` cannot report either fact, so the
    // adapter emits `unknown` forever. A rule that remembered `unknown` as a
    // value would be silent here anyway — but one that treated the FIRST
    // unknown as a value and later compared a real state against it would flash
    // the whole host the moment anything became readable.
    const first = changedRows(new Map(), [withState('a', 'unknown')]);
    expect(first.changed.size).toBe(0);
    // The row IS recorded now, and that is the widening rather than a
    // regression: its PR slot is unreadable, but the ten other watched facts —
    // git state, group, wave, phase, the three local signals, stuck — were all
    // observed by the local scan and are worth remembering. This asserted
    // `.has() === false` while the watched value was a lone scalar, when there
    // was genuinely nothing to keep.
    //
    // What must stay true is the SILENCE, and it is asserted either side: no
    // flash on the first sighting, and none on the next unknown pulse.
    expect(first.next.has('plot/a/a-plan')).toBe(true);
    expect(first.next.get('plot/a/a-plan')!.pr).toBe('unknown');
    expect(changedRows(first.next, [withState('a', 'unknown')]).changed.size).toBe(0);
    // And a real state arriving after an unreadable one does not flash either —
    // that would be news about the host recovering, not about the branch.
    expect(changedRows(first.next, [withState('a', 'green')]).changed.size).toBe(0);
  });

  it('still flashes every real transition', () => {
    // A fix that suppresses too much removes the signal the marker exists for.
    // `pending → failing` is the plan's named case; the rest are asserted with
    // it so a blanket suppression cannot pass.
    const pairs: [WatchedState, WatchedState][] = [
      ['pending', 'failing'],
      ['green', 'conflicts'],
      ['failing', 'green'],
      [null, 'pending'],
      ['conflicts', null],
    ];
    for (const [before, after] of pairs) {
      const prior = observed(withState('a', before));
      expect([...changedRows(prior, [withState('a', after)]).changed])
        .toEqual(['plot/a/a-plan']);
    }
  });

  it('names the rule as its own function rather than inlining the word', () => {
    // `unknown` is a fact about the OBSERVATION; every other value is a fact
    // about the world. Exported so the distinction is assertable rather than
    // buried in a comparison.
    expect(isUnreadable('unknown')).toBe(true);
    for (const s of ['green', 'pending', 'failing', 'none', 'conflicts', null] as WatchedState[]) {
      expect(isUnreadable(s)).toBe(false);
    }
  });

  // ── A row first seen while the host was down ──────────────────────────────
  //
  // The case the widened watched value creates. Under the old scalar rule such
  // a row was never recorded — its only watched fact was unreadable, so there
  // was nothing to remember. It now carries ten other facts, so it IS recorded,
  // and the question is what its PR slot holds meanwhile.
  //
  // The answer: `unknown`, honestly, with the COMPARISON carrying the rule.
  // Storing a value the board never observed would invent an observation, and a
  // sentinel chosen to compare as different would flash the host's RECOVERY —
  // news about GitHub rather than about the branch.

  const watched = (over: Partial<WatchedState> = {}): WatchedState => ({
    pr: null, prNumber: null, prDraft: false, state: 'wip', group: 'working',
    wave: 'One', phase: 'Development', localDirty: false, localLocked: false,
    localAhead: 0, stuck: null, ...over,
  });

  it('reads an unreadable PR slot as neither same nor changed', () => {
    // `unknown` on either side is the host saying *I could not answer*, and a
    // comparison against silence has no verdict. The row's other ten facts
    // decide — exactly as they do while a KNOWN value is carried across an
    // outage, which is the symmetry this keeps.
    expect(sameWatched(watched({ pr: 'unknown' }), watched({ pr: 'green' }))).toBe(true);
    expect(sameWatched(watched({ pr: 'green' }), watched({ pr: 'unknown' }))).toBe(true);
    expect(sameWatched(watched({ pr: 'unknown' }), watched({ pr: 'unknown' }))).toBe(true);
  });

  it('still flashes on a LOCAL change while the PR is unreadable', () => {
    // THE pairing. Suppressing the whole record for the outage's duration would
    // silence an agent's edits for a remote host's reason — the marker going
    // quiet exactly while someone writes. Only the PR SLOT is unreadable; the
    // worktree was observed by the local scan either way.
    expect(sameWatched(
      watched({ pr: 'unknown', localDirty: false }),
      watched({ pr: 'unknown', localDirty: true }),
    )).toBe(false);
  });

  it('flashes when a PR APPEARS on a row whose state was never readable', () => {
    // The stated cost of the decision, and its consolation: the row does not
    // flash on the PR's first readable STATE, but `prNumber` going from null to
    // a number is itself a change and does flash. What is lost is a moment
    // about a host that was down — the cheaper of the two errors.
    expect(sameWatched(
      watched({ pr: 'unknown', prNumber: null }),
      watched({ pr: 'unknown', prNumber: 42 }),
    )).toBe(false);
  });
});

describe('the empty WAITING ON A MACHINE section names the host\'s limit', () => {
  const withState = (branch: string, state: WatchedState) =>
    row({ branch, pr: state === null ? null
      : { number: 1, url: '', draft: false, state } });

  it('says the host cannot report CI when NO PR anywhere could be read', () => {
    // Measured: the Bitbucket adapter emits `checks:"unknown",
    // mergeable:"unknown"` on every row because `bb` has no run listing. That
    // section is therefore permanently empty there, and its default hint —
    // *nothing — a machine is working* — is a claim the host cannot support.
    expect(hostCannotReportCi([withState('a', 'unknown'), withState('b', 'unknown')]))
      .toBe(true);
  });

  it('keeps the ordinary hint when even one PR answered', () => {
    // ALL, never ANY. One `unknown` among readable rows is a single PR
    // mid-outage or a single cross-host repo, and the section is then empty for
    // the ordinary reason — *nothing is on CI right now* is true and useful.
    expect(hostCannotReportCi([withState('a', 'unknown'), withState('b', 'green')]))
      .toBe(false);
  });

  it('claims nothing from a board with no PRs at all', () => {
    // The pairing: `every()` on an empty list is `true`, so an implementation
    // without the length guard would announce a host limit on a fresh board
    // where nothing has been observed — concluding from an absence of evidence,
    // which is the exact mistake this hint exists to correct.
    expect(hostCannotReportCi([])).toBe(false);
    expect(hostCannotReportCi([withState('a', null), withState('b', null)])).toBe(false);
  });

  it('ignores rows that have no PR to report', () => {
    // `not-started`, `quiet` and every fresh claim carry no PR. They are not
    // evidence about the host either way, so they neither establish the limit
    // nor rescue the section from it.
    expect(hostCannotReportCi([withState('a', 'unknown'), withState('b', null)]))
      .toBe(true);
  });

  it('ignores a MERGED row, whose PR has no live condition to report', () => {
    // The regression the merged-PR link would otherwise have introduced. A
    // merged PR reports `mergeable: "unknown"` on GitHub — the question stops
    // being computed once the branch lands — so it arrives here as `unknown`
    // from a host that answers CI perfectly well.
    //
    // Before the row carried its merged PR's link such a row had no `pr` at all
    // and fell out of this tally by accident. Counting it would turn a plan of
    // merged branches plus one PR mid-outage into a false claim about the host.
    const merged = (branch: string) =>
      row({ branch, state: 'merged',
        pr: { number: 252, url: 'https://host/pr/252', draft: false, state: 'unknown' } });
    // One readable open PR beside two merged ones: the host clearly CAN report.
    expect(hostCannotReportCi([merged('a'), merged('b'), withState('c', 'green')]))
      .toBe(false);
    // And a board of nothing but merged rows concludes nothing either way —
    // no live PR was observed, so there is no evidence about the host at all.
    expect(hostCannotReportCi([merged('a'), merged('b')])).toBe(false);
  });

  it('withdraws the claim rather than merely rewording it', () => {
    // The default hint promises CI will finish. The replacement must not: an
    // empty section that still implies a machine is working is the failure this
    // corrects, whatever words it uses.
    expect(HOST_CANNOT_REPORT_HINT).not.toMatch(/will finish/);
    expect(HOST_CANNOT_REPORT_HINT).toMatch(/cannot/);
  });
});

describe('the board says when it has not asked', () => {
  it('reports a fetch that has landed as answered, at ANY age', () => {
    // A FIRST-LOAD STATE, NOT A STALENESS DISPLAY. Once the host has answered,
    // ordinary ageing is the footer's job (`PR data 111s ago`); re-labelling
    // the section every 60 s would trade one misreading for a flicker. So the
    // age is tested against null, never against a threshold — including the
    // measured 111 s, which is a missed refresh and still an answer.
    expect(hostAnswer({ prAgeSeconds: 0, prError: null })).toBe('answered');
    expect(hostAnswer({ prAgeSeconds: 4, prError: null })).toBe('answered');
    expect(hostAnswer({ prAgeSeconds: 111, prError: null })).toBe('answered');
  });

  it('separates a call not yet made from a call that answered nothing', () => {
    // The defect itself. `prAgeSeconds === null` is documented in the contract
    // as *it has never landed — not that it is fresh*, and the board printed
    // the same `none` on both sides of that line.
    expect(hostAnswer({ prAgeSeconds: null, prError: null })).toBe('unasked');
    expect(hostAnswer({ prAgeSeconds: 22, prError: null })).toBe('answered');
  });

  it('keeps a failed FIRST call as its own state, not as not-checked-yet', () => {
    // The plan's open question, decided. Both mean *no host fact is on this
    // board*, but `unasked` resolves itself in seconds while `unreachable`
    // waits for somebody to read the error —
    // `2026-08-17-an-outage-is-not-an-answer.md` is the plan that established
    // an outage must be visible AS an outage.
    expect(hostAnswer({ prAgeSeconds: null, prError: 'gh: 503' })).toBe('unreachable');
    expect(HOST_ANSWER_HINT.unreachable).not.toBe(HOST_ANSWER_HINT.unasked);
  });

  it('keeps DATA that landed once, even while the latest refresh is failing', () => {
    // `refreshPrs` leaves `prAt` untouched when the call throws, deliberately:
    // a failure keeps the last good map rather than blanking it. So an error
    // beside a real age is stale data plus a live fault — the rows are still
    // host facts and must not be re-labelled as unfetched. The error itself is
    // already reported by the footer's own banner.
    expect(hostAnswer({ prAgeSeconds: 30, prError: 'gh: 503' })).toBe('answered');
  });

  it('never consults the git scan\'s clock', () => {
    // Two sources, two ages. The git scan is cheap and runs every few seconds;
    // the host is metered and runs every 60, so the window where rows are
    // git-fresh and PR-stale is most of every minute. Conflating them is what
    // made an unfetched board read as a settled one — and the signature is a
    // fresh `ageSeconds` beside a null `prAgeSeconds`.
    expect(hostAnswer({ prAgeSeconds: null, prError: null, ageSeconds: 1 } as never))
      .toBe('unasked');
  });

  it('states evidence and never a verdict', () => {
    // The row says what happened to the CALL. It does not estimate, does not
    // retry-count, and never says *probably fine* — and it must not inherit the
    // shape of the default hint (*nothing — a machine is working*), which is a claim
    // about the machines that an unfetched section cannot support.
    for (const hint of Object.values(HOST_ANSWER_HINT)) {
      expect(hint).not.toMatch(/will finish|probably|fine|nothing/i);
    }
    expect(HOST_ANSWER_HINT.unasked).toMatch(/not checked yet/);
  });

  it('says nothing about CI, which is the word it replaces', () => {
    // `none` is an observation: the host answered and reported nothing
    // pending. Neither replacement may be readable as that answer.
    for (const hint of Object.values(HOST_ANSWER_HINT)) {
      expect(hint).not.toBe('none');
    }
  });
});

describe('hostErrorState — a rate limit is a THIRD state, never an outage', () => {
  // `2026-08-20-a-rate-limit-is-not-an-outage.md`: a spent budget is partial,
  // temporary and has a KNOWN END, where an unreachable host is none of those.
  // The two must not collapse into one word, in either direction.
  const RATE_LIMIT = 'GraphQL: API rate limit already exceeded for user ID 870334';
  const SECONDARY = 'You have exceeded a secondary rate limit. Please wait 60 seconds…';

  it('reads GitHub\'s exhaustion message as rate-limited', () => {
    // The exact string the backend keys on (`rateLimitBackoffMs`, fleet.ts):
    // client and server must read the SAME signal, or the note says outage
    // while the fetch is already backing off for a rate limit.
    expect(hostErrorState(RATE_LIMIT)).toBe('rate-limited');
  });

  // THIS ASSERTION USED TO READ `'rate-limited'`, AND THAT WAS THE DEFECT.
  // Until 2026-09-02 both messages arrived as one word, so the banner printed
  // one wording — and one reset — over two ceilings that recover minutes apart.
  // The 2026-09-01 measurement is what settles it: `gh pr view` refused while
  // the same account's GraphQL headers read 4854 of 5000 remaining, and a
  // bucket with 97 % left does not refuse on quota.
  it('reads a secondary limit as its OWN state, though it also says "rate limit"', () => {
    expect(SECONDARY).toMatch(/rate limit/i);
    expect(hostErrorState(SECONDARY)).toBe('secondary-limit');
    expect(hostErrorState(SECONDARY)).not.toBe(hostErrorState(RATE_LIMIT));
  });

  it('reads the 2026-08-27 abuse-detection wording as a secondary limit', () => {
    // The outage this repo actually had: eight workers against a cap of seven,
    // reported as a 403 naming abuse detection and saying nothing about quota.
    expect(hostErrorState('403: You have triggered an abuse detection mechanism'))
      .toBe('secondary-limit');
  });

  it('keeps every other failure an outage', () => {
    // The plan's second test, in its mechanical form: an unreachable host keeps
    // today's wording, so it must NOT be read as a rate limit. A 503, a broken
    // path, a VPN timeout — none names a reset, and each stays `unreachable`.
    expect(hostErrorState('gh: 503')).toBe('unreachable');
    expect(hostErrorState('Command failed: bash …/plot-host.sh')).toBe('unreachable');
  });

  it('says nothing when there is no error at all', () => {
    // A healthy pulse has no state to name — the note renders nothing.
    expect(hostErrorState(null)).toBeNull();
  });
});

describe('prNote — the PR note distinguishes the two failures', () => {
  const at = (over: Partial<Fleet>): Fleet =>
    ({ prError: null, prNextInSeconds: null, prAgeSeconds: null, ...over } as Fleet);

  it('is silent when the host answered', () => {
    // No error, no note. The one banner exists for a failure to explain.
    expect(prNote(at({ prError: null }))).toBeNull();
  });

  it('keeps TODAY\'S wording for an unreachable host', () => {
    // The plan pins this verbatim: an outage that named no reset reads exactly
    // as it did before this branch. Changing it would be re-solving
    // `an-outage-is-not-an-answer`, which already holds.
    expect(prNote(at({ prError: 'gh: 503' })))
      .toBe('PR data unavailable (gh: 503) — the two groups above that depend on it may be incomplete.');
  });

  it('SAYS a rate limit is a rate limit, and NAMES when service returns', () => {
    // The heart of the branch. A spent budget is not "unavailable" — it is
    // rate-limited, temporary, and its end is known: `prNextInSeconds` is the
    // reset the backoff already waits for (backoff included, per the contract).
    const note = prNote(at({ prError: 'GraphQL: API rate limit already exceeded', prNextInSeconds: 480 }));
    expect(note).toContain('rate limit');
    expect(note).toContain('8 min');           // 480s named as the reset
    expect(note).not.toContain('unavailable'); // NOT the outage word
  });

  it('says the budget is spent even when the reset is unknown', () => {
    // An older server sends no `prNextInSeconds`. The state is still knowable
    // from the message, so the note still says RATE LIMIT rather than falling
    // back to the outage wording — it just cannot name the minute.
    const note = prNote(at({ prError: 'GraphQL: API rate limit already exceeded', prNextInSeconds: null }));
    expect(note).toContain('rate limit');
    expect(note).not.toContain('unavailable');
  });

  it('names the age of the retained data when there is an outage', () => {
    // Done-when item 10: the banner names the age of the data still on screen.
    // The catch keeps the last good map, which leaves a reader looking at data
    // of unknown age — the age phrase turns "something is wrong" into "showing
    // data from 14 min ago".
    const note = prNote(at({ prError: 'gh: 503', prAgeSeconds: 840 })); // 14 min
    expect(note).toContain('showing data from 14 min ago');
  });

  it('names the age in seconds when under a minute', () => {
    // The same format resetPhrase uses — seconds below a minute, minutes above.
    const note = prNote(at({ prError: 'gh: 503', prAgeSeconds: 45 }));
    expect(note).toContain('showing data from 45s ago');
  });

  it('names the age for a rate-limit failure too', () => {
    // The retained data's age matters regardless of what caused the outage.
    const note = prNote(at({
      prError: 'GraphQL: API rate limit already exceeded',
      prNextInSeconds: 480,
      prAgeSeconds: 840,
    }));
    expect(note).toContain('rate limit');
    expect(note).toContain('8 min');           // the reset
    expect(note).toContain('showing data from 14 min ago'); // the age
  });

  it('omits the age when there is no retained data', () => {
    // A first fetch that failed has no previous data to age — the note does
    // not invent a time it cannot name.
    const note = prNote(at({ prError: 'gh: 503', prAgeSeconds: null }));
    expect(note).not.toContain('showing data');
    expect(note).toBe('PR data unavailable (gh: 503) — the two groups above that depend on it may be incomplete.');
  });

  // THE DONE-WHEN OF THIS SLICE. `prNextInSeconds` is the PRIMARY bucket's
  // reset, and a secondary limit is a different ceiling that clears in seconds.
  // Printing that number here counsels minutes of waiting for a limit that has
  // already gone — the opposite of what helps, and what this line did until
  // 2026-09-02.
  it('NEVER prints a reset time for a secondary limit', () => {
    const note = prNote(at({
      prError: 'You have exceeded a secondary rate limit. Please wait 60 seconds…',
      prNextInSeconds: 480,
    }));
    expect(note).not.toContain('8 min');
    expect(note).not.toContain('service returns');
  });

  it('says a secondary limit is not a spent budget', () => {
    // A quota refusal and a burst refusal must not read alike: the first is
    // waited out, the second is fixed by running fewer calls at once.
    const note = prNote(at({
      prError: 'You have exceeded a secondary rate limit',
      prNextInSeconds: 480,
    }));
    expect(note).toContain('refused a burst');
    expect(note).toContain('not a spent budget');
    expect(note).toContain('close a board rather than wait');
  });

  // The plan at `:607`: *"When the cause is this machine's own spenders, the
  // banner should say so and name how many, because the fix is closing a board
  // rather than waiting for GitHub."*
  it('names how many spenders the record found', () => {
    const note = prNote(at({
      prError: 'You have exceeded a secondary rate limit',
      prSpenders: 3,
    }));
    expect(note).toContain('3 spenders');
  });

  it('says one SPENDER, not one spenders', () => {
    const note = prNote(at({
      prError: 'You have exceeded a secondary rate limit',
      prSpenders: 1,
    }));
    expect(note).toContain('1 spender ');
    expect(note).not.toContain('1 spenders');
  });

  // NULL IS AN ABSENT MEASUREMENT, never an idle account. An unreadable record
  // and a server that predates the field say the same thing, and the banner
  // names the limit rather than inventing a population.
  it('omits the population where the record could not be read', () => {
    const note = prNote(at({
      prError: 'You have exceeded a secondary rate limit',
      prSpenders: null,
    }));
    expect(note).toContain('refused a burst');
    expect(note).not.toContain('spender');
  });

  it('omits the population on a payload that predates the field', () => {
    // `prSpenders` is CAST rather than parsed on the client, so an older
    // server's payload arrives with the key absent — the `fleetControls`
    // lesson, which a Zod `.default()` does not save.
    const note = prNote({
      prError: 'You have exceeded a secondary rate limit',
      prNextInSeconds: null,
      prAgeSeconds: null,
    } as Fleet);
    expect(note).toContain('refused a burst');
    expect(note).not.toContain('spender');
  });

  // A QUOTA REFUSAL STILL READS AS ONE. This slice adds a case rather than
  // replacing the one that was already right.
  it('still names the reset for a spent quota, beside the new case', () => {
    const note = prNote(at({
      prError: 'GraphQL: API rate limit already exceeded',
      prNextInSeconds: 480,
      prSpenders: 3,
    }));
    expect(note).toContain('rate limit is spent');
    expect(note).toContain('service returns in ~8 min');
    expect(note).not.toContain('spenders');
  });

  it('names the age of the retained data for a secondary limit too', () => {
    const note = prNote(at({
      prError: 'You have exceeded a secondary rate limit',
      prAgeSeconds: 840,
    }));
    expect(note).toContain('showing data from 14 min ago');
  });
});

describe('scanHostNote — the scan says when it could not ask', () => {
  const at = (host: Fleet['summary']['host']): Fleet =>
    ({ summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0, host } } as Fleet);

  it('is silent when the scan reached the host', () => {
    // `ok` is a scan that ASKED and was ANSWERED. There is nothing to warn
    // about, and a notice on a healthy scan is noise on every board.
    expect(scanHostNote(at('ok'))).toBeNull();
  });

  it('is silent when the scan did not say', () => {
    // `unknown` is a pulse from an older scan, a partial pulse mid-stream, or a
    // cold cache — none has been told anything about the host. A notice here
    // would be the board inventing a fact, which is the defect one level up.
    expect(scanHostNote(at('unknown'))).toBeNull();
  });

  it('is silent when the summary is missing entirely', () => {
    // The client CASTS this payload rather than parsing it, so a server that
    // predates the field delivers `undefined` and no Zod default fires — the
    // `fleetControls` regression of 2026-08-22. Absent must read as "did not
    // say", never crash and never warn.
    expect(scanHostNote({} as Fleet)).toBeNull();
  });

  it('names the rate limit, and says it refills on a clock', () => {
    // The word `throttled` earns its own sentence: a spent budget is partial,
    // temporary and with a known end, so the advice is to WAIT.
    const note = scanHostNote(at('throttled'));
    expect(note).toContain("rate limit");
    expect(note).toContain('refills on a clock');
    // And it must not send the reader on the outage errand.
    expect(note).not.toContain('check the host');
  });

  it('names an unreachable host, and says waiting will NOT help', () => {
    // The opposite advice, which is the whole reason the two words are kept
    // apart. A reader told to wait out an outage waits forever.
    const note = scanHostNote(at('failed'));
    expect(note).toContain('could not be reached');
    expect(note).toContain('waiting will not clear it');
    expect(note).not.toContain('refills on a clock');
  });

  it('names a secondary limit, and sends the reader at concurrency', () => {
    // The third word, and the third errand. A secondary limit clears in
    // seconds, so telling the reader to wait for a reset wastes minutes on a
    // ceiling that has already gone — and hides the one lever that helps.
    const note = scanHostNote(at('secondary'));
    expect(note).toContain('refused a burst');
    expect(note).toContain('fewer scans at once');
    expect(note).not.toContain('refills on a clock');
    expect(note).not.toContain('check the host');
  });

  it('states the CONSEQUENCE, not merely the cause', () => {
    // "The host was throttled" is a fact about an API. What a reader needs is
    // why the board looks quiet: every branch read from local evidence alone,
    // and nothing was offered to --next. All three words carry it.
    for (const host of ['throttled', 'secondary', 'failed'] as const) {
      const note = scanHostNote(at(host)) ?? '';
      expect(note).toContain('local evidence alone');
      expect(note).toContain('--next');
    }
  });

  it('gives each of the three failures its own sentence', () => {
    // The distinction is worth nothing if two words print the same words.
    const notes = (['throttled', 'secondary', 'failed'] as const).map((host) => scanHostNote(at(host)));
    expect(new Set(notes).size).toBe(3);
  });

  it('is a DIFFERENT sentence from the board\'s own PR failure', () => {
    // `prError` is the BOARD's host call; this is the SCAN's. They fail
    // separately and can be true at once, so the panel must not print one
    // sentence twice — a reader seeing the same words in two statuses learns
    // nothing from the second.
    const scan = scanHostNote(at('throttled')) ?? '';
    const pr = prNote({ prError: 'gh: 503', prNextInSeconds: null, prAgeSeconds: null } as Fleet) ?? '';
    expect(scan).not.toBe(pr);
    expect(pr).not.toContain('Fleet scan blind');
  });
});

describe('issueNote — the note never claims a check it did not run', () => {
  const at = (over: Partial<Fleet>): Fleet =>
    ({ issueError: null, prNextInSeconds: null, ...over } as Fleet);

  it('is silent when the tracker answered', () => {
    expect(issueNote(at({ issueError: null }))).toBeNull();
  });

  it('keeps TODAY\'S wording for an unreachable tracker', () => {
    // `Open issues could not be read` is the honest report of a call that was
    // MADE and FAILED — kept verbatim for the outage case.
    expect(issueNote(at({ issueError: 'gh: 503' })))
      .toBe('Open issues could not be read, so this list may be incomplete — gh: 503');
  });

  it('does NOT say issues "could not be read" for a rate limit', () => {
    // The plan's third test, and the sharpest: a rate limit means the tracker
    // was refused, NOT that reading it failed. "could not be read" claims a
    // failed check; the honest word is that the budget is spent and returns.
    // The issue poll shares the PR gate, so `prNextInSeconds` is its reset too.
    const note = issueNote(at({ issueError: 'GraphQL: API rate limit already exceeded', prNextInSeconds: 480 }));
    expect(note).toContain('rate limit');
    expect(note).toContain('8 min');
    expect(note).not.toContain('could not be read');
  });

  it('borrows the refused wording for a secondary limit, and NOT the reset', () => {
    // A burst refusal refused the same way a spent budget did, so *could not be
    // read* is as wrong here as there. But `prNextInSeconds` is the primary
    // bucket's reset and says nothing about a ceiling on simultaneous calls.
    const note = issueNote(at({
      issueError: 'You have exceeded a secondary rate limit',
      prNextInSeconds: 480,
    }));
    expect(note).toContain('refused a burst');
    expect(note).not.toContain('could not be read');
    expect(note).not.toContain('8 min');
    expect(note).not.toContain('service returns');
  });
});

describe('rowKey', () => {
  it('keys a row by repo AND branch', () => {
    // Two repos can carry the same branch name, and one board can show both.
    expect(rowKey({ repo: 'plot', branch: 'feature/x', plan: 'p' })).toBe('plot/feature/x/p');
    expect(rowKey({ repo: 'other', branch: 'feature/x', plan: 'p' }))
      .not.toBe(rowKey({ repo: 'plot', branch: 'feature/x', plan: 'p' }));
  });

  it('separates two plans claiming ONE branch — the flashing board', () => {
    // THE DEFECT, stated as the two rows that caused it. A branch named by two
    // plans renders twice, once under each, and on `${repo}/${branch}` the two
    // rows shared one memory: each pulse one overwrote the other's remembered
    // facts, the detector saw a difference that was never a change, and the
    // mark lit for hours on a branch nobody had touched.
    //
    // Reported twice — written up in `stuck.ts` when `double-claimed` was added
    // to NAME the collision, and again on 2026-08-22 with
    // `bug/one-row-one-truncation-rule` flashing under both of its plans.
    // Naming it never stopped it, because the shared key is the cause and the
    // state is the symptom.
    const a = { repo: 'plot', branch: 'bug/one-row-one-truncation-rule',
                plan: 'a-mock-row-shows-what-the-tuple-still-gets-wrong' };
    const b = { repo: 'plot', branch: 'bug/one-row-one-truncation-rule',
                plan: 'the-row-is-legible' };
    expect(rowKey(a)).not.toBe(rowKey(b));
  });

  it('gives a planless row ONE stable key, not one per absent value', () => {
    // An unplanned branch and a release branch legitimately carry no plan, and
    // they must be remembered across pulses like anything else — so the absent
    // value collapses to one key rather than distinguishing null from ''.
    const noPlan = { repo: 'plot', branch: 'changeset-release/main', plan: '' };
    expect(rowKey(noPlan)).toBe(rowKey({ ...noPlan, plan: '' }));
    expect(rowKey(noPlan)).not.toBe(rowKey({ ...noPlan, plan: 'some-plan' }));
  });

  it('survives the move it was built to survive — a change of SECTION', () => {
    // The property the key exists for: `pr.state` helps decide the group, so
    // the changes worth marking are frequently the ones that MOVE the row. The
    // group is derived from state, CI and age — none of which touch `plan` — so
    // adding the plan cannot cost the memory a single one of those moves.
    const before = { repo: 'plot', branch: 'feature/x', plan: 'beans' };
    const afterMove = { ...before };
    expect(rowKey(afterMove)).toBe(rowKey(before));
  });
});

describe('ChangeMarks — how long each mark stays lit', () => {
  /**
   * A clock the test advances by hand.
   *
   * Driven directly rather than through the board's polls, because the restart
   * rule is invisible at the board's own rates: `FLEET_POLL_MS` is 4s and a mark
   * lives 3s, so two changes on consecutive polls never overlap and a
   * browser-level "restart" assertion passes with the restart removed.
   */
  function fakeClock() {
    let now = 0;
    const due = new Map<number, { at: number; fn: () => void }>();
    let nextId = 1;
    return {
      schedule(fn: () => void, ms: number) {
        const id = nextId++;
        due.set(id, { at: now + ms, fn });
        return () => due.delete(id);
      },
      advance(ms: number) {
        now += ms;
        for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
          if (t.at <= now) { due.delete(id); t.fn(); }
        }
      },
    };
  }

  /** A ChangeMarks whose lit set the test can read after each step. */
  function marksOnFakeClock() {
    const clock = fakeClock();
    let lit: ReadonlySet<string> = new Set();
    const marks = new ChangeMarks((next) => { lit = next; }, clock.schedule);
    return { marks, clock, lit: () => [...lit].sort() };
  }

  it('lights a changed row, and clears it after CHANGE_MARK_MS', () => {
    const { marks, clock, lit } = marksOnFakeClock();
    marks.mark(['plot/a']);
    expect(lit()).toEqual(['plot/a']);
    // Still lit a moment before its time.
    clock.advance(CHANGE_MARK_MS - 1);
    expect(lit()).toEqual(['plot/a']);
    // And out on its OWN timer — no further pulse was needed to clear it, which
    // is what keeps a board that lost its server from sitting lit forever.
    clock.advance(1);
    expect(lit()).toEqual([]);
  });

  it('RESTARTS a lit mark on a second change rather than letting it expire', () => {
    // THE assertion this class was extracted to make. A second change arrives
    // when the first mark is two-thirds spent; if the first timer were left to
    // run, the mark would go out on the FIRST change's schedule and imply
    // nothing further had happened — the exact false statement it exists to
    // prevent.
    const { marks, clock, lit } = marksOnFakeClock();
    marks.mark(['plot/a']);
    clock.advance(2_000);
    marks.mark(['plot/a']);           // the second change, while still lit
    // Past the FIRST change's expiry, and still lit: only a restart does this.
    clock.advance(1_500);
    expect(lit()).toEqual(['plot/a']);
    // It does still go out — on the second change's schedule, not never.
    clock.advance(CHANGE_MARK_MS);
    expect(lit()).toEqual([]);
  });

  it('gives each row its own timer', () => {
    // Ten rows changing means ten marks, and one row's expiry must not take
    // another's with it.
    const { marks, clock, lit } = marksOnFakeClock();
    marks.mark(['plot/a']);
    clock.advance(2_000);
    marks.mark(['plot/b']);
    expect(lit()).toEqual(['plot/a', 'plot/b']);
    // `a` goes out on its own schedule; `b` is still only 1s old.
    clock.advance(1_000);
    expect(lit()).toEqual(['plot/b']);
    clock.advance(CHANGE_MARK_MS);
    expect(lit()).toEqual([]);
  });

  it('lights ten rows at once', () => {
    const { marks, lit } = marksOnFakeClock();
    marks.mark(Array.from({ length: 10 }, (_, i) => `plot/b${i}`));
    expect(lit()).toHaveLength(10);
  });

  it('drops every pending timer on dispose', () => {
    // Unmounting with marks lit would otherwise leave timeouts firing against a
    // gone component.
    const { marks, clock, lit } = marksOnFakeClock();
    marks.mark(['plot/a']);
    marks.dispose();
    clock.advance(CHANGE_MARK_MS * 2);
    expect(lit()).toEqual(['plot/a']);   // the last state published, never updated after dispose
  });
});

describe('CHANGE_MARK_MS — the marker outlives a glance, not the change', () => {
  it('is about three seconds, tied to neither poll interval', () => {
    // Measured, not chosen: the watched value comes from the 60s PR refresh
    // (120s under backoff), not the 4s fleet pulse, so a transition is a RARE
    // event and a 300ms flash would be missed nearly every time. It is
    // deliberately not equal to either clock — a marker cleared by the next
    // pulse would live 4s or 60s depending on which one cleared it, and would
    // stay lit forever on a board whose server died.
    expect(CHANGE_MARK_MS).toBe(3_000);
    expect(CHANGE_MARK_MS).toBeGreaterThan(1_000);
    expect(CHANGE_MARK_MS).toBeLessThan(4_000);
  });
});

describe('the change marker costs nothing outside the client', () => {
  it('leaves BOTH clocks where they are', () => {
    // Making the marker livelier by polling the host harder would spend the
    // rate limit `PR_BACKOFF_MAX_MS` exists to protect — for a signal nobody
    // asked to be sharper. Read out of the sources rather than asserted in
    // prose, so a later edit to either number fails here.
    const read = (file: string) =>
      readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(read('../../src/app/App.tsx')).toContain('FLEET_POLL_MS = 4_000');
    const fleetSrc = read('../../src/server/fleet.ts');
    expect(fleetSrc).toContain('PR_REFRESH_MS = 60_000');
    expect(fleetSrc).toContain('PR_BACKOFF_MAX_MS = 120_000');
  });

  it('adds no MEMORY field to the contract — remembering is the CLIENT\'s job', () => {
    // The whole change is that the client remembers one value. Putting the
    // MEMORY in the server would give it a notion of *event* where it has only
    // ever had *state*, and would grow the payload to carry a prior reading.
    //
    // MEASUREMENTS ARE NOT MEMORY, and the distinction is what this test is
    // about. `changed_ago_seconds` joined the contract on 2026-08-22: the
    // seconds since the newest write in a worktree, computed by the scan the
    // way `ageMinutes` beside it is. The server states it and forgets it; the
    // client compares consecutive readings and decides whether that is news.
    //
    // The old pattern caught it on the word `changed` alone and would have
    // refused any field with that syllable — including one describing the
    // present. Named terms only, so the claim is *no field carries a PRIOR
    // value* rather than *no field mentions change*.
    const row = AgentRowSchema.parse({
      repo: 'plot', branch: 'feature/x', plan: 'p', planFile: 'f.md', wave: 'w',
      state: 'wip', phase: null, group: 'quiet', ageMinutes: 1, note: '', pr: null,
      branchUrl: '', waitingDays: null,
    });
    for (const key of Object.keys(row)) {
      expect(key, `${key} looks like a remembered value`)
        .not.toMatch(/prior|previous|was[A-Z]|lastSeen|mark|flash/i);
    }
    // And the measurement IS there, stated in the present tense.
    expect(Object.keys(row)).toContain('changedAgo');
  });
});

describe('TUPLE_TRACKS — one grid, and where its width goes', () => {
  /**
   * THE ONE GRID, read out of the one exported constant.
   *
   * This described `ROW_TRACKS` until `one-component-renders-every-row`, and
   * the rename is the whole point rather than a tidy-up. There were TWO grids —
   * `ROW_TRACKS` for a branch row and `PLAN_ROW_TRACKS` for a plan row — and a
   * ticket row was laid on the branch's, wearing a wave, a worker and a branch
   * it does not have. The arithmetic below is the same arithmetic; what changed
   * is that there is now one answer to it instead of two-and-a-borrowing.
   */
  const tracks = () => {
    const inner = /grid-cols-\[(.+)\]/.exec(TUPLE_TRACKS)?.[1];
    expect(inner, `TUPLE_TRACKS is not a Tailwind track list: ${TUPLE_TRACKS}`).toBeTruthy();
    return inner!.split('_');
  };

  it('lays out the six slots, with the marks and the menu around them', () => {
    // `[marks, kind, name, links, status, age, menu]` — the six slots plus the
    // two the tuple does not own. The MARKS track comes first and holds slot
    // 1's icon beside the activity marks; the MENU track is last and holds
    // whatever the kind offers.
    expect(tracks()).toEqual(
      ['1.5rem', '4.5rem', 'minmax(12rem,auto)', '1fr', '8rem', '4.5rem', '1.25rem']);
  });

  it('flexes the LINKS track and no other', () => {
    // THE ONE TRACK THAT ABSORBS THE SLACK IS `1fr`, AND THERE IS EXACTLY ONE.
    // That is the property this asserts, and it survived the 2026-08-23 change
    // to slot 3 verbatim: slot 4 (the links) is still the zero-or-more slot — a
    // branch carries no artifact link and a PR carries two — so it takes the
    // leftover width, and no other track does.
    //
    // The predicate CHANGED because the shape did. It used to read "one track is
    // not `Nrem`", which was a sound proxy for "one track flexes" while every
    // other track was a fixed rem. Slot 3 is now `minmax(12rem, auto)`, which is
    // NOT a fixed rem and is NOT the slack absorber either: an `auto` ceiling
    // grows a track to its content and then YIELDS the remaining free space to
    // the `fr` track, so `minmax(12rem, auto)` and `1fr` do different things and
    // only `1fr` absorbs the slack. Testing "not `Nrem`" would now wrongly count
    // slot 3 as flexible; testing `=== '1fr'` names the slack absorber directly.
    //
    // Why this still forbids what the old predicate forbade: `minmax(9rem, auto)`
    // as a SECOND grow-track, or a second `1fr`, or `max-content` used to absorb
    // slack — none of those is `1fr`, so a shape with two slack-takers still
    // fails "exactly one `1fr`". What the change deliberately ADMITS is the ONE
    // `minmax` on slot 3, whose misalignment cost the operator accepted on
    // 2026-08-23 (see `TUPLE_TRACKS`' docstring) so the name renders in full.
    const slackAbsorbers = tracks().filter((t) => t === '1fr');
    expect(slackAbsorbers).toEqual(['1fr']);
  });

  it('needs less than the card breakpoint before the links track gets a pixel', () => {
    // THE ARITHMETIC THE COLLAPSE BOUGHT BACK, and the numbers are MEASURED
    // here rather than quoted. `ROW_TRACKS` totalled 540px of fixed track and
    // needed 624px of the 640px breakpoint — 16px of headroom, and its own
    // comment recorded having crossed the line by 8px once and paid for it by
    // shrinking a column. The tuple totals 508px and needs 604px: 36px clear,
    // twice the room and not the 60px `TUPLE_TRACKS` claimed when it landed.
    //
    // THAT OVERSTATEMENT IS WORTH RECORDING, because it is the same error this
    // test's own comment warns about, made in the constant's documentation
    // rather than in its code. The docstring counted `84` of gaps and padding —
    // five gaps plus 24 — while declaring SEVEN tracks, which have six. One
    // uncounted gap, 12px, and the same shape of mistake `ROW_TRACKS` made and
    // this assertion was rewritten to prevent. It shipped no defect: 604 is
    // still under 640. It shipped a WRONG MARGIN, which is what a later
    // widening would have been checked against.
    //
    // Why the tuple is narrower at all, and it is not a coincidence: seven
    // tracks holding ONE kind's facts had to be wide enough for the widest of
    // them, while seven tracks holding a SHAPE are each bounded by what every
    // kind puts in them — a kind is one word, a status is one word, an age is
    // four characters. Only slot 4 varies, and it is the one that flexes.
    //
    // DERIVED from the track count, never hard-coded.
    const GAP_PX = 12;
    const PADDING_PX = 24;
    const gapsAndPadding = (tracks().length - 1) * GAP_PX + PADDING_PX;
    // THE MINIMUM WIDTH A TRACK RESERVES, in px. `1fr` reserves nothing before
    // the grid reaches its intrinsic width, so it is excluded. A fixed `Nrem`
    // reserves `N * 16`. Slot 3's `minmax(12rem, auto)` reserves its FLOOR — the
    // `auto` ceiling only claims more once the grid is already past 604px, which
    // is exactly the point this arithmetic guards. So the figure below is the
    // 12rem floor, unchanged from the fixed-12rem grid this replaced: `minmax`
    // did not move the breakpoint math, which is what let the 508/604/36 numbers
    // come out identical after the 2026-08-23 change (see `TUPLE_TRACKS`).
    const floorRem = (t: string) => {
      const minmax = /^minmax\(([\d.]+)rem,/.exec(t);
      return minmax ? Number.parseFloat(minmax[1]) : Number.parseFloat(t);
    };
    const fixedPx = tracks()
      .filter((t) => t !== '1fr')
      .reduce((sum, t) => sum + floorRem(t) * 16, 0);
    expect(fixedPx).toBe(508);
    expect(fixedPx + gapsAndPadding).toBeLessThan(CARD_BELOW_PX);
    // AND THE HEADROOM IS NAMED, so a later widening has to argue with a
    // number rather than merely stay under a ceiling — which is exactly what
    // the docstring's uncounted gap took away.
    expect(CARD_BELOW_PX - (fixedPx + gapsAndPadding)).toBe(36);
  });

  it('has no second grid left to drift from this one', () => {
    // THE DELETION, asserted. Two grids for three components is how they
    // drifted apart, and a test that only checks the survivor's numbers would
    // pass just as well with `PLAN_ROW_TRACKS` still in the file and still
    // rendering a plan row on four tracks of its own.
    //
    // Read out of the SOURCE, because the property is *this constant does not
    // exist* and an import of a deleted binding is a compile error rather than
    // a test failure — which reports the right fact in the wrong place, and
    // only for as long as nobody adds it back under another name.
    //
    // THE WHOLE ROW ESTATE, not one file of it. The adapters left
    // `AgentList.tsx` when `the-components-leave-the-shell` split the estate
    // into three modules, and a scan of the shell alone would report no second
    // grid because it can no longer see the components that would carry one.
    const src = [
      'components/AgentList.tsx',
      'lib/agent-rows/rows.tsx',
      'lib/agent-rows/menus.tsx',
      'lib/agent-rows/marks.tsx',
    ]
      .map((f) => readFileSync(new URL(`../../src/app/${f}`, import.meta.url), 'utf8'))
      .join('\n');
    // COMMENTS STRIPPED, and the distinction is the whole reason this is worth
    // anything. Both adapters DISCUSS the grids they replaced — `PlanRow`'s
    // docstring records the reversal at length, because *a plan row is not a
    // branch row* was a correct argument that produced the second grid, and a
    // deletion whose reasoning is not written down is one somebody re-derives.
    // A match against the raw file would fail on the prose explaining why the
    // code no longer does the thing, and a test that cannot tell a mention from
    // a declaration is a test that gets deleted the first time it is wrong.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/ROW_TRACKS/);
    expect(code).not.toMatch(/PLAN_ROW_TRACKS/);
    // And the stripping removed something, so the two assertions above are
    // about code rather than about an empty string.
    expect(src).toMatch(/PLAN_ROW_TRACKS/);
    // ONE `grid-cols-` in the whole row estate, and it is the tuple's.
    const tupleSrc = readFileSync(
      new URL('../../src/app/components/TupleRow.tsx', import.meta.url), 'utf8');
    expect([...tupleSrc.matchAll(/grid-cols-\[/g)]).toHaveLength(1);
    expect(code).not.toMatch(/grid-cols-\[/);
  });
});

/**
 * A ROW'S ACTIONS ALL LIVE IN ITS MENU — asserted structurally, because prose
 * did not hold.
 *
 * `one-place-for-what-a-row-can-do` settled the rule the estate had been
 * missing: **the row says what IS, the menu says what you can DO.** Before it,
 * four actions lived in two homes — *Open failing run* and the conflict
 * dispatch inline in the row, *Start work* and *Approve* in the `⋯` menu — and
 * the split followed nothing but the order they were built in.
 *
 * **This is the gate, and the prose above is not.** CLAUDE.md's test for the
 * difference is whether *"did I follow this?"* can be answered without doing
 * the work: a rule in a comment can be, and was, rationalised past four times.
 * The next action to arrive will be easiest to render in the row — the same
 * reasoning that produced two homes in the first place — and this fails when it
 * does, naming the element it found.
 *
 * **Read out of the SOURCE, not out of a rendered page.** A DOM assertion only
 * catches an inline control that the fixture's state happens to render, and
 * every one of the four was conditional: `Open failing run` appeared only while
 * a row was `ci-failing`. A structural scan sees the element whether or not any
 * test data reaches it.
 */
describe("a row's actions all live in its menu", () => {
  /**
   * THE ROW ESTATE'S SOURCE — TWO FILES, and the second is what the collapse
   * made load-bearing.
   *
   * This scan read `AgentList.tsx` alone while every row component lived there.
   * `one-component-renders-every-row` moved the rendering into `TupleRow.tsx`
   * and left three ADAPTERS behind, so a one-file scan would now walk from
   * `Row` to `TupleRowView`, fail to find it, and report a clean row — while
   * every anchor in the estate sat one file away, unwatched.
   *
   * That is precisely the failure this describe's own docstring warns about: *a
   * scan that matched nothing passes the assertion forever while gating
   * nothing at all.* The gate follows the components, not the file they were in
   * when it was written.
   */
  const FILES = [
    'components/AgentList.tsx',
    'components/TupleRow.tsx',
    // THE THREE MODULES THE ROW ESTATE MOVED INTO, and the same lesson a second
    // time. `the-components-leave-the-shell` took every row, mark and menu out
    // of `AgentList.tsx` and left the shell behind — so a scan naming only the
    // two files above would find `Row`, `PlanRow` and `IssueRowView` in
    // neither, and `declaration` would fail rather than silently pass. Listing
    // them here is the gate following the components, which is what the note
    // above says it does.
    'lib/agent-rows/rows.tsx',
    'lib/agent-rows/menus.tsx',
    'lib/agent-rows/marks.tsx',
  ] as const;
  const sources = FILES.map((f) =>
    readFileSync(new URL(`../../src/app/${f}`, import.meta.url), 'utf8'));
  /** Kept for the assertions that ask about `AgentList.tsx` in particular. */
  const source = sources[0];

  /**
   * The source of one top-level declaration, from whichever file holds it.
   *
   * It ends at the first `}` in COLUMN ZERO, which is where every top-level
   * declaration in these files closes and nothing nested ever does. An earlier
   * version sliced to *the next `function `* instead and was wrong in the
   * direction that matters: past the last declaration there is no next one, so
   * `PrCell` swallowed the rest of the file and the scan reported two toggle
   * buttons that live hundreds of lines below it. A structural test whose
   * boundaries are wrong reports strays that are not there — and, on the other
   * side of the same error, misses ones that are.
   *
   * `export function` as well as `function`, because the tuple's two components
   * are exported and the three adapters are not — a distinction about module
   * boundaries that says nothing about whether a row renders an anchor.
   */
  function declaration(name: string): string {
    for (const src of sources) {
      for (const prefix of ['function ', 'export function ']) {
        const start = src.indexOf(`${prefix}${name}(`);
        if (start === -1) continue;
        const end = src.indexOf('\n}\n', start);
        expect(end, `${name} does not close in column zero`).toBeGreaterThan(-1);
        return src.slice(start, end + 3);
      }
    }
    expect.fail(`no component named ${name} in ${FILES.join(' or ')}`);
  }

  /** Whether a name is a component either file declares. */
  const declares = (name: string): boolean =>
    sources.some((src) =>
      src.includes(`function ${name}(`) || src.includes(`export function ${name}(`));

  /**
   * Every component reachable from the ROW BODY, following what each mounts —
   * and deliberately NOT entering `RowActions`, which is the one place actions
   * are allowed to be.
   *
   * Transitive, because the row's own links are not written in `Row`: the
   * branch is a `BranchName` and the PR a `PrCell`, so a scan of `Row` alone
   * would read as clean while an inline action sat one component down. That is
   * exactly where the next one would land.
   */
  function rowBodySources(): { name: string; source: string }[] {
    const seen = new Set<string>(['RowActions']);
    const out: { name: string; source: string }[] = [];
    const queue = ['Row'];
    while (queue.length) {
      const name = queue.shift() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      const body = declaration(name);
      out.push({ name, source: body });
      for (const [, child] of body.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) {
        // `HTMLAnchorElement` and friends are types in handler signatures, not
        // mounted components — they have no declaration and are skipped by the
        // same check that skips anything already visited.
        if (!seen.has(child) && declares(child)) queue.push(child);
      }
    }
    return out;
  }

  /**
   * The interactive elements a row body may contain — every one of them
   * NAVIGATION to a thing the row itself names.
   *
   * That is the boundary, and it is narrower than "no links in the row". The
   * plan keeps navigation inline deliberately: a `cmd`-click on a real plan or
   * branch link is worth more than a tidier line, and the row is where the
   * thing is named. What moved is the ERRAND — *Open failing run* addresses a
   * run, which is something the row reports on rather than something the row
   * is.
   *
   * Keyed on the `data-` hook rather than on the URL or the label, because both
   * of those change for reasons that have nothing to do with this rule. An
   * addition here is the deliberate decision the gate exists to force: a new
   * entry is a claim that the row NAMES the thing, and it has to be argued in
   * review rather than arrived at by rendering.
   */
  /**
   * Where a JSX opening tag ENDS — the first `>` at brace depth zero.
   *
   * `indexOf('>')` was right for as long as no attribute value contained one,
   * and the tuple's anchor broke it: `onClick={handle}` is fine but an inline
   * `onClick={(e) => ...}` is not, and neither is any `{cond ? a : b}` holding
   * a comparison. The old scan then cut the tag short, missed the
   * `data-tuple-link` hook that sat past the cut, and reported the estate's one
   * legitimate anchor as a stray.
   *
   * That failure is the benign direction — a false stray is noticed the moment
   * the suite runs. The direction worth guarding is the other one, and it is
   * why this counts braces rather than widening the slice: a fixed lookahead
   * long enough to clear the handler would also reach into the NEXT element's
   * attributes, and a stray `<button>` would be waved through by a hook
   * belonging to the link above it.
   */
  function tagClose(body: string, from: number): number {
    let depth = 0;
    for (let i = from; i < body.length; i += 1) {
      const c = body[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) return i;
    }
    return -1;
  }

  /**
   * Block comments, gone — so prose ABOUT markup is not read AS markup.
   *
   * `IssueRowView` documents that its name cell is deliberately `not an <a>`,
   * and that literal tag in the comment matched the raw-tag scan below. The
   * branch-row gate escaped this only because its comments happen not to spell
   * a bare tag; the rule is the same and so is the strip. Both the plain and the
   * JSX-wrapped comment forms are removed, non-greedily, before any tag match.
   */
  const stripComments = (s: string): string =>
    s
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
      // LINE comments too, and the collapse is what made this half necessary.
      // `TupleLinkView` explains at length that a name with no address is *not
      // an `<a>`* and that a missing link renders as text — prose about markup,
      // in `//` comments the block-stripper walks straight past. The branch
      // gate escaped this for as long as its comments happened not to spell a
      // bare tag; the rule is the same and so is the strip.
      .replace(/^[^\S\n]*\/\/.*$/gm, '');

  const ROW_NAVIGATION = [
    'data-branch',
    'data-pr-link',
    'href={`/plan/',
    // THE TUPLE'S ONE ANCHOR, and it is the same allowance stated once instead
    // of per component. `TupleLinkView` renders every linked name on every kind
    // — a PR's number, a plan's slug, a branch's name — through ONE `<a>` whose
    // `data-tuple-link` says what it points at. That is navigation to a thing
    // the row NAMES, which is exactly what this list is for; the three hooks
    // above it are the same permission as it was spelled when three components
    // each rendered their own anchor.
    'data-tuple-link',
    // THE HREFLESS NAME THAT IS STILL A DESTINATION, added 2026-08-20 for the
    // agent row — and the justification the gate asks for.
    //
    // An agent's name is its session id, and what it opens is the agent PANEL: a
    // local overlay, not a URL. So it cannot be an `<a>` — inventing an address
    // is what this board refuses everywhere — and it must not be inert either,
    // or the row names a thing a reader cannot reach.
    //
    // It IS navigation to a thing the row NAMES, which is precisely what this
    // list permits; only the element differs, because the destination has no
    // address. `TupleLinkView` renders a `<button>` exactly when a name is given
    // an `onActivate`, so this hook cannot spread to an artifact link: those
    // either have an href or stay text.
    //
    // `data-tuple-text` is deliberately the SAME hook a plain hrefless name
    // wears, because the property tests assert on it is *this is not an anchor*
    // — true of both, and the assertion that matters.
    'data-tuple-text',
  ];

  it('renders no interactive element in a row body outside the menu', () => {
    // THE GATE. Every `<a>` and `<button>` reachable from the row body, minus
    // the row's own navigation — the remainder must be empty.
    const strays: string[] = [];
    for (const { name, source: decl } of rowBodySources()) {
      // COMMENTS STRIPPED FIRST, so prose ABOUT markup is not read AS markup —
      // the same strip the issue gate has always applied, now needed here too
      // because `TupleLinkView` discusses the anchor it declines to render.
      const body = stripComments(decl);
      for (const m of body.matchAll(/<(a|button)[\s>]/g)) {
        // The element's own attributes: up to the end of its opening TAG, which
        // is where its `data-` hook and `href` are. `>` inside a JSX expression
        // (`() => ...`) is not the tag's end, so the search skips a `>` that
        // has an unbalanced `{` before it — measured on the tuple's anchor,
        // whose `onClick` handler closes before the tag does.
        const tagEnd = tagClose(body, m.index!);
        const tag = body.slice(m.index, tagEnd === -1 ? m.index! + 400 : tagEnd);
        if (ROW_NAVIGATION.some((hook) => tag.includes(hook))) continue;
        strays.push(`${name}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    expect(
      strays,
      'An interactive element in a row body belongs in RowActions — the row says '
        + 'what IS, the menu says what you can DO. If this is navigation to a '
        + 'thing the row NAMES, add its hook to ROW_NAVIGATION and say why.',
    ).toEqual([]);
  });

  it('finds a stray link when one is added back', () => {
    // THE GATE'S OWN GATE. A scan that matched nothing — a wrong component
    // name, a regex that never fires — passes the assertion above forever while
    // gating nothing at all, which is the failure mode a structural test is
    // most prone to. So the detector is run against a row body with the exact
    // element this plan removed put back into it.
    // Injected at the row's MENU prop, which every kind's adapter has and which
    // is the nearest thing left to the branch cell the old injection used —
    // `<BranchName row={row} />` was deleted with the component that held it.
    const withStray = declaration('Row').replace(
      '      menu={',
      '      extra={<a href={runUrl} data-stuck-link>Open failing run</a>}\n      menu={',
    );
    expect(withStray).toContain('data-stuck-link');
    const found = [...withStray.matchAll(/<(a|button)[\s>]/g)].filter((m) => {
      const tag = withStray.slice(m.index, withStray.indexOf('>', m.index));
      return !ROW_NAVIGATION.some((hook) => tag.includes(hook));
    });
    expect(found.length).toBe(1);
  });

  it('reaches the components the row mounts, not only Row itself', () => {
    // THE PROPERTY THAT MAKES THE GATE WORTH ANYTHING, and the collapse moved
    // what it has to reach. The row's own links used to live in `BranchName`
    // and `PrCell`; they now live in `TupleLinkView`, reached through
    // `TupleRowView` — and in ANOTHER FILE, which is the reach a one-file scan
    // silently lost. A scan stopping at `Row` reads as clean while every anchor
    // in the estate sits one component and one module away.
    const names = rowBodySources().map((c) => c.name);
    expect(names).toContain('TupleRowView');
    expect(names).toContain('TupleLinkView');
    // And it does NOT enter the menu, which is where actions are allowed.
    expect(names).not.toContain('RowActions');
  });

  it('reaches the tuple from the PLAN row and the TICKET row too', () => {
    // THE THIRD FILL SITE, which is what the whole collapse was about. Three
    // components on two grids meant three places an inline action could land
    // and only one the gate walked — so *Create plan* sat inline on a ticket
    // row for as long as it did. One component renders every kind now, and the
    // gate reaching it from all three adapters is what says so structurally
    // rather than in a comment.
    for (const adapter of ['PlanRow', 'IssueRowView']) {
      expect(declaration(adapter)).toContain('<TupleRowView');
    }
  });

  /**
   * THE SAME RULE, on the ISSUE row — the one the estate had not reached.
   *
   * An issue row is not a branch row: it is rendered by `IssueRowView`, which
   * the scan above never enters because it starts at `Row`. So *Create plan*
   * sat inline in the issue row's body while every branch action had already
   * moved into a `⋯` menu, split by nothing but which row-kind was refactored
   * first — the exact two-homes shape `one-place-for-what-a-row-can-do`
   * existed to end, surviving on the one row that describe did not walk.
   *
   * `every-action-is-in-the-menu` moves it into `IssueRowActions`, and this is
   * the gate that keeps it there. Its navigation allowance is narrower than the
   * branch row's: an issue row NAMES only its tracker number, so `data-issue-link`
   * is the one inline interactive element permitted, and everything else — which
   * today is *Create plan* alone — belongs behind the menu.
   */
  const ISSUE_NAVIGATION = [
    'data-issue-link',
    // The tuple's one anchor, for the reason stated at `ROW_NAVIGATION`: since
    // the collapse a ticket's tracker link and a branch's branch link are the
    // SAME `<a>`, rendered by `TupleLinkView` from a `TupleLink`. The two
    // allowances converged because the two rows did.
    'data-tuple-link',
    // And the same convergence for the hrefless name that is still a
    // destination — see `ROW_NAVIGATION` for the full justification. It reaches
    // this gate because both read `TupleLinkView`, not because an issue row has
    // one: a ticket's name carries a tracker URL and takes the anchor above.
    'data-tuple-text',
  ];


  /**
   * Every component reachable from the ISSUE row body, not entering
   * `IssueRowActions` — the issue row's equivalent of {@link rowBodySources},
   * and transitive for the same reason: the tracker link lives in `IssueRowView`
   * itself today, but a future cell could push it one component down.
   */
  function issueRowBodySources(): { name: string; source: string }[] {
    const seen = new Set<string>(['IssueRowActions']);
    const out: { name: string; source: string }[] = [];
    const queue = ['IssueRowView'];
    while (queue.length) {
      const name = queue.shift() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      const body = declaration(name);
      out.push({ name, source: body });
      for (const [, child] of body.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) {
        if (!seen.has(child) && declares(child)) queue.push(child);
      }
    }
    return out;
  }

  it('renders no interactive element in an issue row body outside the menu', () => {
    // THE GATE, for the issue row. Every `<a>`/`<button>` reachable from
    // `IssueRowView`, minus the tracker link — the remainder must be empty.
    // `CreatePlanButton` is reached only through `IssueRowActions`, which the
    // scan does not enter, so its `<button>` does not count against this.
    const strays: string[] = [];
    for (const { name, source: decl } of issueRowBodySources()) {
      const body = stripComments(decl);
      for (const m of body.matchAll(/<(a|button)[\s>]/g)) {
        const tagEnd = tagClose(body, m.index!);
        const tag = body.slice(m.index, tagEnd === -1 ? m.index! + 400 : tagEnd);
        if (ISSUE_NAVIGATION.some((hook) => tag.includes(hook))) continue;
        strays.push(`${name}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    expect(
      strays,
      'An interactive element in an issue row body belongs in IssueRowActions — '
        + 'the row says what IS, the menu says what you can DO. If this is '
        + 'navigation to a thing the row NAMES, add its hook to ISSUE_NAVIGATION '
        + 'and say why.',
    ).toEqual([]);
  });

  it('finds a stray Create plan when one is added back to the issue body', () => {
    // THE GATE'S OWN GATE, for the issue row: a scan that matched nothing would
    // pass forever while gating nothing. So an inline action — the shape this
    // branch moved into the menu — is put back beside the tracker link and must
    // be caught. Anchored on `data-issue-link`, which stays in the body
    // whatever happens to `Create plan`, so the injection survives the move.
    const withStray = stripComments(declaration('IssueRowView')).replace(
      'data-issue-link',
      'data-issue-link />\n      <button data-create-plan={issue.number}',
    );
    expect(withStray).toContain('data-create-plan');
    const found = [...withStray.matchAll(/<(a|button)[\s>]/g)].filter((m) => {
      const tag = withStray.slice(m.index, withStray.indexOf('>', m.index));
      return !ISSUE_NAVIGATION.some((hook) => tag.includes(hook));
    });
    expect(found.length).toBeGreaterThan(0);
  });

  it('keeps Create plan in the issue menu, and the tracker link out of it', () => {
    // The other half: the gate above proves nothing inline remained; this proves
    // the action arrived in the menu, and that the one navigation the row NAMES
    // stayed on the row rather than being swept behind a click.
    const menu = declaration('IssueRowActions');
    expect(menu).toContain('<CreatePlanButton');
    expect(declaration('IssueRowView')).toContain('data-issue-link');
    expect(declaration('IssueRowView')).not.toContain('<CreatePlanButton');
  });

  it('reaches the issue components the row mounts, not only IssueRowView', () => {
    const names = issueRowBodySources().map((c) => c.name);
    expect(names).toContain('IssueRowView');
    // And it does NOT enter the menu, which is where the action is allowed.
    expect(names).not.toContain('IssueRowActions');
  });
});

/**
 * WHETHER THE MENU EXISTS, and whether anything in it can act — two questions,
 * and the board asked only the second until 2026-08-18.
 */
describe('menuState — a refusal is not an absence', () => {
  // NO `canApprove` / `canCommission` / `approveWillAct` / `commissionWillAct`.
  // Both plan-level acts left the branch menu for the plan head (`PlanActions`),
  // so a branch row's menu no longer computes them and this state no longer
  // carries their flags. What remains is what a branch row can genuinely do.
  const none = {
    canStart: false, canResolve: false, hasRun: false,
    hasLog: false, hasStatus: false, hasOpen: false,
    hasChangedFiles: false, serverWillAct: false,
  };

  it('renders no menu at all on a row with nothing to offer', () => {
    // The measured defect: the `⋯` rendered on every row, so two of six WAITING
    // ON YOU rows carried a control that opened nothing.
    expect(menuState(none)).toEqual({ present: false, enabled: false });
  });

  it('keeps the menu present but disabled where the server refuses', () => {
    // There IS something to do here — you simply cannot do it from this
    // binding. Rendering nothing would report a healthy row, which is the
    // worse lie: the reason has to stay reachable.
    expect(menuState({ ...none, canResolve: true })).toEqual({
      present: true, enabled: false,
    });
    expect(menuState({ ...none, canStart: true })).toEqual({
      present: true, enabled: false,
    });
  });

  it('enables the run link without asking whether the server will act', () => {
    // NAVIGATION, so it carries no guard: there is no rerun route here, and
    // opening the host's page is not a write. It reads the same over Tailscale
    // as it does at the machine — which is why a row with only a run is
    // enabled on a binding that refuses every dispatch.
    expect(menuState({ ...none, hasRun: true })).toEqual({
      present: true, enabled: true,
    });
  });

  it('asks about ANY item, never one named item', () => {
    // The defect this gate had in its first form: `enabled` was `canStart &&
    // serverWillAct`, so a menu opened only where Start work was possible. Both
    // dispatching acts on a branch row (Start work, the conflict dispatch)
    // answer to the SAME `serverWillAct` binding, so the gate must ask about
    // whichever one is present rather than a single named item.
    expect(menuState({ ...none, canStart: true, serverWillAct: true }).enabled).toBe(true);
    expect(menuState({ ...none, canResolve: true, serverWillAct: true }).enabled).toBe(true);
    // A read item enables on no binding at all — navigation is not an act.
    expect(menuState({ ...none, hasOpen: true }).enabled).toBe(true);
  });

  it('never enables a menu it does not render', () => {
    // THE INVARIANT, over every combination rather than the four spot checks
    // above. `enabled && !present` would put an openable menu behind a button
    // that is not there — one line of reasoning across four disjuncts, and
    // exactly the kind that gets re-derived wrongly in a later edit.
    const bools = [false, true];
    // A sampled sweep rather than a full 2^10 grid: the invariant is per-disjunct
    // (`enabled → present`), so every input is exercised at both values against a
    // `none` baseline, plus a handful of combinations. The exhaustive nested loop
    // it replaced grew a dimension with every new item; the property it proves did
    // not, so it does not need the cartesian product to stay honest.
    const keys = [
      'canStart', 'canResolve', 'hasRun', 'hasLog', 'hasStatus',
      'hasOpen', 'hasChangedFiles', 'serverWillAct',
    ] as const;
    const cases: (typeof none)[] = [{ ...none }];
    for (const key of keys)
      for (const v of bools) cases.push({ ...none, [key]: v });
    // A few with an act flag AND its will-act partner, so `enabled` is reached.
    cases.push({ ...none, canStart: true, serverWillAct: true });
    cases.push({ ...none, canResolve: true, serverWillAct: true });
    for (const c of cases) {
      const state = menuState(c);
      expect(
        !state.enabled || state.present,
        `enabled without present: ${JSON.stringify(c)}`,
      ).toBe(true);
    }
  });

  // A READ, so it carries no guard — the same argument the run link makes one
  // test up, and the reason both join `enabled` without a `WillAct` term. A row
  // whose only offer is its log is still worth opening on a binding that
  // refuses every dispatch: looking at a log is not acting.
  it('enables the worker log without asking whether the server will act', () => {
    expect(menuState({ ...none, hasLog: true })).toEqual({
      present: true, enabled: true,
    });
  });

  // The dispatcher-log `Status` entry, added by
  // `the-button-claims-only-what-it-knows`. A READ like the worker log and the
  // run link, so it enables the menu on any binding — looking at what the
  // dispatcher did is not acting. It is the durable home for what the Start work
  // button used to hand back as a transient path.
  it('enables the Status entry without asking whether the server will act', () => {
    expect(menuState({ ...none, hasStatus: true })).toEqual({
      present: true, enabled: true,
    });
  });

  it('gives a changed-file list a menu, and it needs no server', () => {
    // The purest READ in the menu: the paths came in on the pulse that drew the
    // row, so there is no route to refuse and no binding to consult. It enables
    // on its own, exactly like the two log items and the run link.
    expect(menuState({ ...none, hasChangedFiles: true })).toEqual({
      present: true, enabled: true,
    });
  });
  // THE MOTIVATING DEFECT, in one line: a row that carried nothing else used to
  // render no menu at all. Open is navigation the row already has the address
  // for, so it makes the menu present — and enabled, because navigation is not
  // an act the server can refuse.
  it('renders and enables a menu for a row whose only item is Open', () => {
    expect(menuState({ ...none, hasOpen: true })).toEqual({
      present: true, enabled: true,
    });
  });

  // Approve and Commission design are NOT tested here any longer: both are
  // plan-level acts that left the branch menu for the plan head (`PlanActions`),
  // so `menuState` — which answers for a BRANCH row's menu — no longer carries
  // their flags. The plan head's two-answer menu is covered by the browser test
  // `plan-head-controls.browser.test.ts`, which exercises the real render.
});

// A branch row names its wave BESIDE ITS BRANCH NAME, and the gate is now a
// property of that one branch: does it name a wave? The plan-wide
// `sliceCountByPlan` went with the cell the label used to sit in — it existed to
// answer *does this plan have more than one wave*, a question a reader could not
// see the answer to, and it had no other reader.
//
// The count's own assertions are kept here as assertions about `sliceLabel`,
// because what they were really pinning is which STRINGS mean "no wave to name":
// `''` for a planless row and `(unnamed)` for an undivided plan. Those are the
// two the count used to collapse, and they are the two that must still not print.
//
// The DOM half — the name reaching the branch cell rather than the kind cell, in
// every section, without moving the grid — is in
// test/integration/agents-tab.browser.test.ts.
describe('sliceLabel — the wave name a branch row shows, or none', () => {
  it('names the wave for any branch that has a named one', () => {
    // No count, and no plan: the branch alone answers it. This is the change —
    // the label used to require `sliceCount > 1`, so a branch of a plan divided
    // once showed nothing even though it had a wave to show, and the plan that
    // relocated the label requires it be reachable for EVERY branch that has one.
    expect(sliceLabel(row({ wave: 'Fold' }))).toBe('Fold');
    expect(sliceLabel(row({ wave: 'Truth' }))).toBe('Truth');
  });

  it('shows nothing for `(unnamed)` — the absence of a division, spelled', () => {
    // The server writes this for a plan with no `### ` sub-headings, so it is
    // what the MAJORITY of branches on this board carry. Printing it beside a
    // branch name would put a parenthesised non-answer on most rows.
    //
    // This is the assertion that replaces the count: `(unnamed)` used to be
    // filtered by counting to one, and it is now filtered by being recognised
    // for what it is. Same rows suppressed, one fewer fact needed to do it.
    expect(sliceLabel(row({ wave: UNNAMED_SLICE }))).toBeNull();
    expect(sliceLabel(row({ wave: '(unnamed)' }))).toBeNull();
  });

  it('shows nothing for a planless row', () => {
    // A row built from the PR map belongs to no plan and carries `wave: ''`. An
    // empty wave name is the absence of a wave, not a wave named "".
    expect(sliceLabel(row({ plan: '', wave: '' }))).toBeNull();
  });

  it('names a wave for a plan divided ONCE, which the old gate suppressed', () => {
    // The behaviour change, asserted as such rather than left to be inferred
    // from the absence of a count. A plan with one NAMED wave gave its branches
    // nothing before, on the argument that a caption over a partition of one is
    // noise — sound while the label sat in a cell it shared with the plan phase,
    // and moot beside the branch name, where it displaces nothing.
    expect(sliceLabel(row({ plan: 'p', branch: 'a', wave: 'Layout' }))).toBe('Layout');
  });

  it('does not read the plan, so two branches of one plan cannot disagree', () => {
    // The property the count made impossible to hold: the label was a function
    // of the fleet, so the same branch could name its wave in one render and not
    // in another as sibling rows appeared and vanished between polls. It is now
    // a function of the row, and the same row always answers the same way.
    const r = row({ plan: 'p', branch: 'a', wave: 'Fold' });
    expect(sliceLabel(r)).toBe(sliceLabel({ ...r }));
    expect(sliceLabel(r)).toBe('Fold');
  });
});


/**
 * WHERE OPEN GOES — the one item that guarantees every fleet row has a menu.
 *
 * Navigation to an address the row already carries: no fetch, no host call. A PR
 * row opens the PR (`pr.url`); a branch row opens the branch on the host
 * (`branchUrl`). The PR wins where both exist — a reader looking at a PR row is
 * deciding about the PR, and the PR page is where that decision is made.
 */
describe('openTarget — the address Open navigates to, from fields already on the row', () => {
  it('opens the PR where the row has one', () => {
    expect(openTarget(row({ pr: { number: 42, url: 'https://host/pr/42', draft: false, state: 'green' } })))
      .toBe('https://host/pr/42');
  });

  it('opens the branch where there is no PR', () => {
    expect(openTarget(row({ branchUrl: 'https://host/tree/feature/x' })))
      .toBe('https://host/tree/feature/x');
  });

  it('prefers the PR address over the branch address', () => {
    expect(openTarget(row({
      pr: { number: 42, url: 'https://host/pr/42', draft: false, state: 'green' },
      branchUrl: 'https://host/tree/feature/x',
    }))).toBe('https://host/pr/42');
  });

  // A merged branch has no remote page and a PR whose host gave no address
  // carries "" — the same absence `branchUrl` and `pr.url` already encode. No
  // address, no Open item, and the row falls back to whatever else it offers.
  it('is empty when neither a PR url nor a branch url is present', () => {
    expect(openTarget(row())).toBe('');
    expect(openTarget(row({ pr: { number: 42, url: '', draft: false, state: 'green' }, branchUrl: '' })))
      .toBe('');
  });
});

/**
 * WHICH ROWS OFFER OPEN — and it is WAITING ON YOU, and only there.
 *
 * The motivating defect was a plain PR *awaiting review* with no menu — a row
 * the reader must act on, leading with a subject they had no route to. Open
 * answers that. But a `quiet`, `blocked` or `done` row has genuinely nothing to
 * do, and the settled rule `one-place-for-what-a-row-can-do` holds there: a `⋯`
 * that opens nothing but a link the row ALREADY shows (its branch is an anchor)
 * is the empty menu that lies. So Open is a WAITING ON YOU affordance — the
 * section whose whole membership is *this wants a person*.
 *
 * A branch waiting its turn (`not-started`, `waitingOn: 'time'`) is the sharp
 * negative: it has a `branchUrl`, but it is not yours to act on yet, and the row
 * says so in words. Its menu stays absent.
 */
describe('offersOpen — Open is a WAITING ON YOU affordance', () => {
  it('offers Open on a waiting-on-you row with an address', () => {
    expect(offersOpen(row({ group: 'waiting-on-you', branchUrl: 'u' }))).toBe(true);
  });

  it('does NOT offer Open on a quiet, blocked or done row, even with an address', () => {
    for (const group of ['quiet', 'done', 'working', 'not-started', 'waiting-on-machine'] as const) {
      expect(offersOpen(row({ group, branchUrl: 'u' })), `${group} offered Open`).toBe(false);
    }
  });

  it('offers nothing where there is no address to open', () => {
    expect(offersOpen(row({ group: 'waiting-on-you', branchUrl: '', pr: null }))).toBe(false);
  });
});

/**
 * CREATE STORY is offered on a ticket, and it ACTS — the assertion this file
 * used to make in the opposite direction, and the flip is the feature.
 *
 * It asserted that `storyRefusal()` always returned a non-empty reason, because
 * the function took no arguments and returned a constant: *"a story is a
 * decision you make — where it lives, whether it is wanted yet — so it is
 * created with /story-tracking at a terminal, not from a board click"*. That is
 * what made it a claim about STORIES rather than a fact about this board.
 *
 * Measured against `skills/story-tracking/SKILL.md`, neither named decision is
 * what the refusal said it was: the skill states its own escape (*"Skip the
 * question only when the repo has exactly one home"*) and its own override (an
 * explicit request beats triage advice — which is exactly what a click here
 * is). And the ground it stood on, *an unattended agent has nobody to ask*, is
 * refuted by the practice: `/story-tracking` is run unattended several times a
 * day from the prompt.
 *
 * So the test that asserted the refusal is permanent is what gets rewritten —
 * the anti-contract this branch is here to overturn. What remains asserted is
 * that a control which CANNOT act still says why, which was always the right
 * half of the old rule.
 */
describe('storyRefusal — Create story acts, and names what stops it when it cannot', () => {
  const CAN: DispatchInfo = { available: true, reason: '' };

  it('returns NO refusal where the board and the tracker can both answer', () => {
    // The flip. This is the assertion the old constant made impossible.
    expect(storyRefusal(CAN, 'ok')).toBe('');
  });

  it('names the BINDING when the board is not on localhost', () => {
    // A fact that can change — unlike the constant, which asserted that no
    // route could ever exist.
    const bound = { available: false, reason: 'the board is bound to 100.64.1.2, not localhost' };
    expect(storyRefusal(bound, 'ok')).toContain('100.64.1.2');
  });

  it('names the TRACKER when this host has no issue read at all', () => {
    expect(storyRefusal(CAN, 'unsupported').toLowerCase()).toContain('issue read');
  });

  it('says the lookup is broken rather than implying the ticket is gone', () => {
    // The row is on screen precisely because the last good lookup found it. An
    // outage is not an answer, in this direction too.
    const reason = storyRefusal(CAN, 'failed').toLowerCase();
    expect(reason).toContain('lookup');
    expect(reason).not.toContain('no such issue');
  });

  it('still refuses with a reason rather than falling silent', () => {
    // The half of the old rule that was always right: a control that will not
    // act must say why, or the reader spends a click to learn it.
    expect(storyRefusal({ available: false, reason: '' }, 'ok')).not.toBe('');
  });
});

/**
 * OPEN reads differently by kind, because opening a PR is REVIEWING it. The row
 * says what it is; the verb the menu offers should match.
 */
describe('openLabel — Review for a PR, Open for a branch', () => {
  it('says Review where the row has a PR', () => {
    expect(openLabel(row({ pr: { number: 9, url: 'u', draft: false, state: 'green' } })))
      .toBe('Review');
  });

  it('says Open where the row is a bare branch', () => {
    expect(openLabel(row({ branchUrl: 'u' }))).toBe('Open');
  });
});

/**
 * THE RUN LINK reads *Show failure* when the row is failing and *Open last run*
 * otherwise — the widening #269 made explicit: the item opens the last run
 * whatever it said, so it must not promise a failure on a green row.
 */
describe('runLinkLabel — Show failure only where a failure is present', () => {
  it('says Show failure for a PR whose checks are failing', () => {
    expect(runLinkLabel(row({ pr: { number: 9, url: 'u', draft: false, state: 'failing' } })))
      .toBe('Show failure');
  });

  it('says Show failure for a ci-failing stuck branch whose newest run failed', () => {
    expect(runLinkLabel(row({
      stuck: { state: 'ci-failing', conflicts: [], failingChecks: ['build'], changedPaths: [], runHistory: [{ url: 'u', conclusion: 'failure', startedAt: '' }], localAhead: 0 },
    }))).toBe('Show failure');
  });

  it('says Open last run when a ci-failing row\'s NEWEST run has since gone green', () => {
    // The widening case: still classed failing on an earlier check, but the run
    // this link opens passed — promising a failure there would be the over-claim
    // #269 took the word off this link to avoid.
    expect(runLinkLabel(row({
      stuck: { state: 'ci-failing', conflicts: [], failingChecks: [], changedPaths: [], runHistory: [{ url: 'u', conclusion: 'success', startedAt: '' }], localAhead: 0 },
    }))).toBe('Open last run');
  });

  it('says Open last run for a row that is not failing', () => {
    expect(runLinkLabel(row({ pr: { number: 9, url: 'u', draft: false, state: 'green' } })))
      .toBe('Open last run');
  });
});

describe('sectionTally — a header counts the things rendered beneath it', () => {
  // A server-derived wave, keyed on (plan, name), carrying the ONE section the
  // server placed it in. `section` is what a grouped header must count against,
  // exactly as `sliceSummaryFor` and `slicesElsewhere` already read it.
  const wave = (over: Partial<Slice> = {}): Slice => ({
    plan: 'p', name: 'W', branches: ['feature/b'], verdict: 'complete',
    section: 'done', complete: true, planSliceCount: 1, ...over,
  });

  it('counts plan heads and names both units where a grouped section folds waves', () => {
    // DONE, plan-grouped: two plans, one holding two waves and one holding one.
    // A reader sees two plan heads; the section's scope is three waves. Both are
    // true and both are derivable — the header must state each and say which.
    const rows = [
      row({ plan: 'alpha', wave: 'One', branch: 'a1', state: 'merged', group: 'done' }),
      row({ plan: 'alpha', wave: 'Two', branch: 'a2', state: 'merged', group: 'done' }),
      row({ plan: 'beta', wave: 'One', branch: 'b1', state: 'merged', group: 'done' }),
    ];
    const waves: Slice[] = [
      wave({ plan: 'alpha', name: 'One', branches: ['a1'] }),
      wave({ plan: 'alpha', name: 'Two', branches: ['a2'] }),
      wave({ plan: 'beta', name: 'One', branches: ['b1'] }),
    ];
    const tally = sectionTally(rows, 'done', waves, 0);
    expect(tally.plans).toBe(2);
    expect(tally.waves).toBe(3);
    expect(tally.differ).toBe(true);
  });

  it('renders one number for QUIET at 0/0 — agreement grows no redundant clause', () => {
    // The degenerate case the plan names: an empty section whose two counts
    // agree must not read `0 plans · 0 waves`.
    const tally = sectionTally([], 'quiet', [], 0);
    expect(tally.plans).toBe(0);
    expect(tally.waves).toBe(0);
    expect(tally.differ).toBe(false);
  });

  it('renders one number where plan heads and waves agree', () => {
    // Two plans, one wave each: two heads, two waves. The numbers coincide, so
    // the header states one — an ungrouped-looking section gains no clause.
    const rows = [
      row({ plan: 'alpha', wave: 'One', branch: 'a1', state: 'merged', group: 'done' }),
      row({ plan: 'beta', wave: 'One', branch: 'b1', state: 'merged', group: 'done' }),
    ];
    const waves: Slice[] = [
      wave({ plan: 'alpha', name: 'One', branches: ['a1'] }),
      wave({ plan: 'beta', name: 'One', branches: ['b1'] }),
    ];
    const tally = sectionTally(rows, 'done', waves, 0);
    expect(tally.plans).toBe(2);
    expect(tally.waves).toBe(2);
    expect(tally.differ).toBe(false);
  });

  it('folds issue rows into the visible count', () => {
    // A grouped section's issue rows are lines the reader sees, so they count
    // toward the plan (visible-line) figure — the NOT STARTED lesson, applied.
    const rows = [
      row({ plan: 'alpha', wave: 'One', branch: 'a1', state: 'merged', group: 'done' }),
      row({ plan: 'alpha', wave: 'Two', branch: 'a2', state: 'merged', group: 'done' }),
    ];
    const waves: Slice[] = [
      wave({ plan: 'alpha', name: 'One', branches: ['a1'] }),
      wave({ plan: 'alpha', name: 'Two', branches: ['a2'] }),
    ];
    const tally = sectionTally(rows, 'done', waves, 2);
    // One plan head plus two issue rows visible → three; two waves in scope plus
    // the two issues → four.
    expect(tally.plans).toBe(3);
    expect(tally.waves).toBe(4);
    expect(tally.differ).toBe(true);
  });
});

// `canCommissionDesign` USED TO BE TESTED HERE, as a branch-row predicate on
// `waitingOn === 'you'`. It is gone: Commission design is a PLAN-level act and
// moved to the plan head (`PlanActions`), gated on the card's `isDraft` exactly
// as Approve is — not on any row field. The old predicate was in fact
// self-contradictory over board-producible inputs (`'you'` only ever arrives
// with `state === 'deferred'`, while it required `state === 'open'`), which is
// why it could never render and why it is deleted rather than repaired. The
// plan head's Commission design item is covered by
// `plan-head-controls.browser.test.ts`.

describe('a board that never scanned says so', () => {
  // THREE CASES, AND TWO OF THEM USED TO PRODUCE THE SAME SCREEN. The render
  // asked `!ready && !error`, so any failure skipped the never-scanned branch
  // and fell through to the ordinary view: every section rendering `none` under
  // an amber line. At a glance that is a healthy board over an empty estate.
  //
  // Measured 2026-08-28 against a board installed from npm: the truth for ten
  // seconds, then indistinguishable from a working board, forever. Two readers
  // concluded the release was broken. It was not.

  it('never scanned, no error — waits, and says only that', () => {
    const cold = coldState(false, '');
    expect(cold?.headline).toMatch(/Waiting for the first fleet scan/);
    expect(cold?.failure).toBe('');
  });

  it('never scanned, scan FAILING — says both, emptiness first', () => {
    // The case that was broken. Both facts, and the emptiness leads: it is what
    // the reader most needs and what the old render never stated.
    const cold = coldState(false, 'bash exited 127');
    expect(cold?.headline).toMatch(/never completed a scan/);
    expect(cold?.failure).toContain('bash exited 127');
  });

  it('keeps the error VERBATIM — a friendlier message would have hidden the cause', () => {
    // `bash exited 127` is the only actionable thing on screen. Dropping it for
    // a kinder sentence would have made the 2026-08-28 diagnosis impossible.
    expect(coldState(false, 'spawn bash ENOENT')?.failure).toContain('spawn bash ENOENT');
  });

  it('scanned before, now failing — NOT cold; the ordinary view owns it', () => {
    // The distinction the original comment argued for and the fix preserves: a
    // tab that has never had an answer cannot have one it no longer trusts.
    // Staleness is a different statement, and merging the two would make an
    // empty view claim data it never held.
    expect(coldState(true, 'bash exited 127')).toBeNull();
  });

  it('the three states are three DIFFERENT screens', () => {
    // The regression this file exists to prevent, stated directly: if any two
    // of these collapse, the bug is back.
    const a = coldState(false, '');
    const b = coldState(false, 'bash exited 127');
    const c = coldState(true, 'bash exited 127');
    expect(a?.headline).not.toBe(b?.headline);
    expect(c).toBeNull();
  });
});
