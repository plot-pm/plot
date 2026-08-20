import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  groupByPlan,
  waveCountByPlan,
  waveLabel,
  countdown,
  waitingLabel,
  showPlanHeading,
  isStartable,
  isLive,
  isCollapsible,
  noActionReason,
  menuState,
  openTarget,
  openLabel,
  runLinkLabel,
  storyRefusal,
  canCommissionDesign,
  splitBranch,
  prStateWord,
  noteWithoutPr,
  readCollapsed,
  writeCollapsed,
  COLLAPSED_BY_DEFAULT,
  CARD_BELOW_PX,
  GROUPS,
  ROW_TRACKS,
  CHANGE_MARK_MS,
  ChangeMarks,
  changedRows,
  isActive,
  isUnpushed,
  waitingTone,
  activityPace,
  groupPace,
  ACTIVITY_MARK_PLACE,
  ActivityEcho,
  activeRowKeys,
  LOCK_ECHO_MS,
  rowKey,
  watchedState,
  isUnreadable,
  sameWatched,
  hostCannotReportCi,
  HOST_CANNOT_REPORT_HINT,
  hostAnswer,
  HOST_ANSWER_HINT,
  hostErrorState,
  prNote,
  issueNote,
  type WatchedState,
  type PlanGroup,
} from '../../src/app/components/AgentList.js';
import { GROUP_ORDER } from '../../src/server/fleet.js';
import {
  AgentRowSchema, DRAFT_PLAN_NOTE, ELIGIBLE_NOTE, type AgentRow, type Fleet,
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
    const both = row({ localDirty: true, localAhead: 3 });
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

describe('isActive — which rows are actually being written to', () => {
  it('marks a row holding a lock, and a row with uncommitted work', () => {
    // The two entrances, and they are ORs rather than a sequence: someone is
    // writing this instant, or has written and not committed.
    expect(isActive(row({ localLocked: true }))).toBe(true);
    expect(isActive(row({ localDirty: true }))).toBe(true);
    expect(isActive(row({ localLocked: true, localDirty: true }))).toBe(true);
  });

  it('never marks a MERGED branch, whatever its worktree holds', () => {
    // Measured on screen: a row sitting in DONE with the activity mark. Both
    // halves were true — merged, and a dirty checkout — and the row said two
    // things that cannot both be acted on. The dirt was one leftover
    // `.plot-worker.exit` nobody had cleaned up.
    //
    // Editing a merged branch's checkout is real and simply not what this mark
    // means. `classify` already sends merged branches to `done` before looking
    // at any local signal; this predicate now agrees with it rather than
    // contradicting it one layer up.
    expect(isActive(row({ state: 'merged', localDirty: true }))).toBe(false);
    expect(isActive(row({ state: 'merged', localLocked: true }))).toBe(false);
  });

  it('still marks an UNMERGED branch with the same signals', () => {
    // The pairing. A fix that suppressed the mark whenever a row sits in DONE —
    // or worse, whenever a PR exists — would pass the assertion above and take
    // the mark off every agent that is actually writing.
    expect(isActive(row({ state: 'wip', localDirty: true }))).toBe(true);
    expect(isActive(row({ state: 'claimed', localLocked: true }))).toBe(true);
    expect(isActive(row({ state: 'open', localDirty: true }))).toBe(true);
  });

  it('does NOT mark a WORKING row that carries neither signal', () => {
    // THE assertion, and the whole point of the wave. An implementation that
    // kept reading `group === 'working'` passes every positive case above and
    // fails here — a row sits in WORKING for HOURS while an agent works, while
    // an agent has crashed, or while it waits on a human, and nothing measures
    // the end. Six rows carried that claim in one session.
    expect(isActive(row({ group: 'working' }))).toBe(false);
    // Not even with the strongest note WORKING can carry: the note is a
    // sentence the server composed, not an observation of a write.
    expect(isActive(row({ group: 'working', note: 'claimed, no commits yet' }))).toBe(false);
    expect(isActive(row({ group: 'working', ageMinutes: 1, note: 'last commit 1 min ago' })))
      .toBe(false);
  });

  it('marks a row OUTSIDE working when the signals say so', () => {
    // The other half of the same reversal: the group no longer decides. A quiet
    // row whose worktree is dirty is being written to, whatever the classifier
    // made of its commit age.
    for (const group of GROUPS.map((g) => g.key)) {
      expect(isActive(row({ group, localDirty: true }))).toBe(true);
    }
  });

  it('does NOT treat unpushed commits as activity', () => {
    // The pairing the plan names explicitly: an implementation OR-ing all three
    // signals passes every positive assertion above and marks finished work
    // sitting still as motion. A branch nobody has touched for hours that holds
    // one unpushed commit must read as UNMARKED.
    //
    // Asserted against the field itself, now that `localAhead` reaches the row:
    // the wave that added the unpushed mark forwarded it, exactly as this test's
    // earlier form anticipated ("a later wave's own signal"). What that form
    // asserted — that `local_ahead` is ABSENT from the row — was a statement
    // about the plumbing of the day and stopped being true; what it MEANT is
    // asserted here and does not expire: however many unpushed commits a row
    // holds, `isActive` is false.
    //
    // Kept as its own test rather than folded into `isUnpushed`'s block: this
    // one guards the predicate that must NOT see the field, and a fix that ORs
    // the three signals together fails here and nowhere else.
    const ahead = row({ group: 'working', localDirty: false, localLocked: false, localAhead: 3 });
    expect(isActive(ahead)).toBe(false);
    expect(isUnpushed(ahead)).toBe(true);
  });

  it('leaves an UNOBSERVED row unmarked, and never crashes on one', () => {
    // ABSENT IS NOT FALSE. A scan that could not look at a worktree reports
    // absence rather than cleanliness, so both fields default to false — and
    // false here must yield NO MARK rather than a mark saying *idle*. The
    // strongest licensed statement is *unknown, never nobody*.
    const unobserved = AgentRowSchema.parse({
      repo: 'plot', branch: 'feature/elsewhere', plan: 'p', wave: 'w', state: 'wip',
      group: 'working', ageMinutes: 5, note: 'claimed, no commits yet',
    });
    expect(unobserved.localDirty).toBe(false);
    expect(unobserved.localLocked).toBe(false);
    expect(isActive(unobserved)).toBe(false);
    // And the predicate survives a row that predates the fields entirely — the
    // payload an older server sends.
    expect(() => isActive({ localDirty: undefined, localLocked: undefined } as never))
      .not.toThrow();
  });

  it('is a DIFFERENT question from isLive, and neither answers the other', () => {
    // Three marks, three meanings — and the pairing that matters: no mark may
    // be implemented by modifying another. A WORKING row with no signals is
    // LIVE and not ACTIVE; a dirty QUIET row is ACTIVE and not LIVE.
    const idleInWorking = row({ group: 'working' });
    expect(isLive(idleInWorking)).toBe(true);
    expect(isActive(idleInWorking)).toBe(false);

    const dirtyOutside = row({ group: 'quiet', localDirty: true });
    expect(isLive(dirtyOutside)).toBe(false);
    expect(isActive(dirtyOutside)).toBe(true);
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
    const rows = [
      row({ branch: 'dirty', localDirty: true }),
      row({ branch: 'locked', localLocked: true }),
      row({ branch: 'idle', group: 'working' }),
    ];
    expect([...activeRowKeys(rows, new Set())].sort())
      .toEqual(['plot/dirty', 'plot/locked']);
  });

  it('adds rows still echoing a lock, without the pulse saying anything', () => {
    // The union, and its direction: the echo only ever ADDS. This row reports
    // no signals at all in this pulse and is marked purely because a lock it
    // was seen holding has not yet expired.
    const rows = [row({ branch: 'gone-quiet' })];
    expect([...activeRowKeys(rows, new Set(['plot/gone-quiet']))])
      .toEqual(['plot/gone-quiet']);
  });

  it('does not mark an echo for a row that is no longer in the fleet', () => {
    // The set is one entry per VISIBLE row, not a log. A stale key for a branch
    // that has left the pulse marks nothing.
    expect([...activeRowKeys([row({ branch: 'here' })], new Set(['plot/vanished']))])
      .toEqual([]);
  });

  it('never contradicts a later observation — the NOTE is untouched', () => {
    // The third bound on the echo: it makes a real event visible, it does not
    // overwrite a fact. While the echo runs, the row goes on reporting whatever
    // the last pulse actually found — so a row echoing a lock while the pulse
    // says *claimed, no commits yet* keeps saying exactly that.
    const quiet = row({ branch: 'echoing', note: 'claimed, no commits yet' });
    const active = activeRowKeys([quiet], new Set(['plot/echoing']));
    expect(active.has('plot/echoing')).toBe(true);
    expect(quiet.note).toBe('claimed, no commits yet');
    // And the row itself still reports no signals — the echo lives beside the
    // row's facts rather than rewriting them.
    expect(isActive(quiet)).toBe(false);
  });
});

describe('the activity marker leaves the other marks alone', () => {
  const source = readFileSync(
    new URL('../../src/app/components/AgentList.tsx', import.meta.url), 'utf8');

  it('keeps isLive reading the GROUP, exactly as before', () => {
    // The dot means *in the WORKING group* and lives for hours; the activity
    // mark means *someone is writing here*. Two questions, two marks — and the
    // cheap way to build the second is to repaint the first.
    expect(isLive(row({ group: 'working' }))).toBe(true);
    expect(isLive(row({ group: 'quiet', localDirty: true, localLocked: true }))).toBe(false);
    expect(isLive(row({ group: 'working', localDirty: false }))).toBe(true);
  });

  it('renders three distinct marks, none defined in terms of another', () => {
    // Read out of the source: each hook exists and is its own element. An
    // implementation that made activity a variant of the live dot would still
    // pass every predicate assertion above.
    expect(source).toContain('data-live-dot');
    expect(source).toContain('data-change-mark');
    expect(source).toContain('data-activity-mark');
    // The change mark keeps its own channel — full-row wash, amber, pulsing —
    // untouched by this wave.
    expect(source).toContain('absolute inset-0 animate-pulse bg-amber-300/25');
    // And the live dot keeps its own: a 6px emerald dot that pulses.
    expect(source).toContain('h-1.5 w-1.5 shrink-0 self-center animate-pulse rounded-full');
  });

  it('names its own limit in the accessible description', () => {
    // A reader who takes an unmarked row for an idle one has been misled by a
    // marker that was technically correct: every signal here is local, so an
    // agent on another machine produces no mark HERE, ever. The marker says so
    // rather than letting absence speak for itself.
    expect(source).toContain('A write is in progress in this checkout');
  });

  it('keeps the stuck cue on its own channel too', () => {
    // The fourth mark, and the one that arrived after the plan was written.
    // Amber and MOVING (`animate-ping`), against this mark's static emerald —
    // asserted here so a later wave reaching for the cue's element to make
    // activity louder fails rather than passes.
    expect(source).toContain('data-stuck-cue');
    expect(source).toContain('animate-ping rounded-full bg-amber-500');
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

  it('is the SAME predicate isActive already draws, and not a second one', () => {
    // The load-bearing relationship: `activity-shows-itself` settled what
    // *someone is writing here* means, and this wave reads that answer rather
    // than inventing a rival. An implementation that graded the pace on the
    // group, the note or the age would disagree with `isActive` on some row and
    // put a fast dot on a branch nobody has touched.
    for (const over of [
      { localDirty: true, localLocked: false },
      { localDirty: false, localLocked: true },
      { localDirty: false, localLocked: false },
      { localDirty: true, localLocked: true },
    ]) {
      const r = row(over);
      expect(activityPace(r)).toBe(isActive(r) ? 'fast' : 'slow');
    }
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
  const source = readFileSync(
    new URL('../../src/app/components/AgentList.tsx', import.meta.url), 'utf8');

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
    expect(at, `no data-${hook} JSX attribute in AgentList.tsx`).toBeGreaterThan(-1);
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
    expect(table, `no ${name} table in AgentList.tsx`).not.toBeNull();
    const out = [...table![1].matchAll(/^\s{2}\w+: '([^']*)',$/gm)].map((m) => m[1]);
    expect(out.length, `no placements parsed out of ${name}`).toBeGreaterThan(1);
    return out;
  }

  it('reads each mark\'s OWN class list, not the next one in the file', () => {
    // The helper's own guard, and the reason it exists. Every assertion below
    // is worthless if this walks into a neighbour: the four marks are adjacent
    // in the source and each names the others in its comment. Two marks whose
    // geometry cannot be confused pin it.
    expect(classesOf('live-dot')).toContain('h-1.5 w-1.5');
    expect(classesOf('change-mark')).toContain('absolute inset-0');
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
    expect(ACTIVITY_MARK_PLACE.row).toBe(
      'relative flex w-full shrink-0 flex-col items-center justify-center gap-1 self-stretch');
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
    expect(classesOf('live-dot')).toContain('h-1.5 w-1.5');
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
    // `items-center` centres the marks across it. No number is stated at all —
    // which is the strongest form of the same rule, since the line height it
    // used to name (`h-5`) was itself a value that could go stale.
    const mark = ACTIVITY_MARK_PLACE.row;
    expect(mark).toContain('self-stretch');
    expect(mark).toContain('items-center');
    expect(mark).toContain('flex');
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
    // arithmetic: `self-stretch` makes the box the full height of the row and
    // `justify-center` centres the marks in it, so a row that grows a second
    // line keeps its marks centred against the whole cell rather than against
    // an assumption about the first line's height.
    const mark = ACTIVITY_MARK_PLACE.row;
    expect(mark).toContain('self-stretch');
    expect(mark).toContain('justify-center');
    // Every positioned form is GONE. Asserted negatively because leaving one
    // behind would fight the cell: a stray `translate-y` on the parent is a
    // transform the dot's own `translateX` travel would have to fight.
    expect(mark).not.toContain('sm:top-1/2');
    expect(mark).not.toContain('-translate-y-1/2');
    expect(mark).not.toContain('sm:left-0');
  });
});

describe('isStartable — which NOT STARTED rows offer work', () => {
  // A startable row: the FIELD says `click`, and the note is kept beside it
  // because that is what the server sends — but nothing here reads it.
  const notStarted = (over: Partial<AgentRow> = {}) =>
    row({
      group: 'not-started', state: 'open', ageMinutes: null,
      waitingOn: 'click', note: ELIGIBLE_NOTE, ...over,
    });

  it('offers a branch no earlier wave blocks', () => {
    expect(isStartable(notStarted())).toBe(true);
  });

  it('offers NOTHING on a branch blocked by an earlier wave', () => {
    // The load-bearing negative, and the half a naive `group === 'not-started'`
    // implementation gets wrong: the group holds both kinds. A button here
    // would offer to skip the ordering waves exist to express, and
    // plot-dispatch.sh refuses that branch — so the board would be inviting an
    // action the tool declines.
    expect(isStartable(notStarted({ waitingOn: 'time', note: 'blocked by Truth' }))).toBe(false);
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
    // field. Those two are the assertion — a rule still reading the sentence
    // passes neither.
    expect(isStartable(notStarted({ waitingOn: 'click', note: 'anything at all' }))).toBe(true);
    expect(isStartable(notStarted({ waitingOn: 'time', note: ELIGIBLE_NOTE }))).toBe(false);
    expect(isStartable(notStarted({ waitingOn: null, note: ELIGIBLE_NOTE }))).toBe(false);
  });

  it('offers nothing on a row that already has a branch and a claim', () => {
    // Working and quiet rows are somebody's already. Offering to start one
    // invites exactly the double-dispatch fleet-sees-merged-branches prevents.
    for (const group of ['working', 'quiet', 'waiting-on-you', 'done'] as const) {
      expect(isStartable(row({ group, state: 'open', note: ELIGIBLE_NOTE }))).toBe(false);
    }
  });

  it('offers NOTHING on a branch whose plan is still a Draft', () => {
    // The other half of the same rule, and the reason the draft note is a
    // sibling of ELIGIBLE_NOTE rather than a suffix on it: `plot-dispatch`
    // refuses a drafted plan's branches exactly as it refuses a wave-blocked
    // one, so the button must not appear on either.
    //
    // It comes out right by CONSTRUCTION — a Draft plan's first wave is
    // `waitingOn: 'you'`, and only `click` is startable, so there is no second
    // rule to keep in step. Pinned anyway: worth failing loudly if someone
    // later widens the predicate to "anything in not-started".
    expect(isStartable(notStarted({ waitingOn: 'you', note: DRAFT_PLAN_NOTE }))).toBe(false);
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
    expect(noActionReason(row({ note: 'blocked by an earlier wave' })))
      .toMatch(/blocked by an earlier wave/);
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
    expect(noteWithoutPr('blocked by an earlier wave', null))
      .toBe('blocked by an earlier wave');
  });

  it('drops a PR clause that says only what the cell already says', () => {
    // `PR #130 green` and `PR #131, draft, CI running` are entirely the PR's
    // own condition, which the cell now renders from the fields. Printing them
    // beside it would say the same thing twice on every row with a PR.
    expect(noteWithoutPr('PR #130 green', pr(130))).toBe('');
    expect(noteWithoutPr('PR #131, draft, CI running', pr(131))).toBe('');
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

  it('marks a row whose state changed', () => {
    const prior = observed(withState('a', 'pending'));
    expect([...changedRows(prior, [withState('a', 'failing')]).changed])
      .toEqual(['plot/a']);
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
    expect([...changedRows(prior, [withState('a', 'pending')]).changed]).toEqual(['plot/a']);
  });

  it('marks a PR GOING AWAY, the same as one arriving', () => {
    // `pending → null`, a PR merged or closed out from under the row. An
    // asymmetry here would need a reason and there is none that survives *the
    // row's own state changed*.
    const prior = observed(withState('a', 'pending'));
    expect([...changedRows(prior, [withState('a', null)]).changed]).toEqual(['plot/a']);
  });

  it('tells NEVER-SEEN apart from SEEN-WITH-NO-PR', () => {
    // THE pairing of this whole rule. An implementation storing both as
    // "nothing" passes the first-pulse assertion above and then silences every
    // branch's first PR forever — so both halves are asserted against the same
    // row and the same state.
    const fresh = changedRows(new Map(), [withState('a', null)]);
    expect(fresh.changed.size).toBe(0);              // first sighting: silent
    expect(fresh.next.has('plot/a')).toBe(true);     // but REMEMBERED,
    // …as a known `null` IN ITS PR SLOT. The memory holds a record now rather
    // than a lone state, so the assertion reads the slot instead of the whole
    // value — the distinction it protects (known-null vs never-seen) is the
    // same one, one field in.
    expect(fresh.next.get('plot/a')!.pr).toBe(null);
    // …so the PR that opens next is a change, not another first sighting.
    expect([...changedRows(fresh.next, [withState('a', 'pending')]).changed])
      .toEqual(['plot/a']);
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
    expect([...changedRows(observed(before), [after]).changed]).toEqual(['plot/a']);
  });

  it('starts a returning row SILENT — absence erases the memory', () => {
    // A branch deleted and recreated, or a row simply missing from one pulse.
    // It has no prior value at its return, so it records rather than marks.
    const first = observed(withState('a', 'green'));
    const withoutIt = changedRows(first, [withState('other', 'green')]);
    expect(withoutIt.next.has('plot/a')).toBe(false);
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
      .toEqual(['plot/a']);
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
    expect(first.next.has('plot/a')).toBe(true);
    expect(first.next.get('plot/a')!.pr).toBe('unknown');
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
        .toEqual(['plot/a']);
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

  it('reads GitHub\'s exhaustion messages as rate-limited', () => {
    // The exact strings the backend keys on (`rateLimitBackoffMs`, fleet.ts):
    // client and server must read the SAME signal, or the note says outage
    // while the fetch is already backing off for a rate limit.
    expect(hostErrorState(RATE_LIMIT)).toBe('rate-limited');
    expect(hostErrorState(SECONDARY)).toBe('rate-limited');
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
    ({ prError: null, prNextInSeconds: null, ...over } as Fleet);

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
});

describe('rowKey', () => {
  it('keys a row by repo AND branch', () => {
    // Two repos can carry the same branch name, and one board can show both.
    expect(rowKey({ repo: 'plot', branch: 'feature/x' })).toBe('plot/feature/x');
    expect(rowKey({ repo: 'other', branch: 'feature/x' }))
      .not.toBe(rowKey({ repo: 'plot', branch: 'feature/x' }));
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

  it('adds no contract field — the memory is the CLIENT\'s', () => {
    // The whole change is that the client remembers one value. Putting it in
    // the server would give it a notion of *event* where it has only ever had
    // *state*, and would grow the payload to carry it.
    const row = AgentRowSchema.parse({
      repo: 'plot', branch: 'feature/x', plan: 'p', planFile: 'f.md', wave: 'w',
      state: 'wip', phase: null, group: 'quiet', ageMinutes: 1, note: '', pr: null,
      branchUrl: '', waitingDays: null,
    });
    for (const key of Object.keys(row)) {
      expect(key).not.toMatch(/prior|previous|changed|mark|flash/i);
    }
  });
});

describe('ROW_TRACKS — where the row\'s width goes', () => {
  /** The six tracks, in order, read out of the one exported constant. */
  const tracks = () => {
    const inner = /grid-cols-\[(.+)\]/.exec(ROW_TRACKS)?.[1];
    expect(inner, `ROW_TRACKS is not a Tailwind track list: ${ROW_TRACKS}`).toBeTruthy();
    return inner!.split('_');
  };

  it('gives the PR column 14rem, taken from the branch and not from the window', () => {
    // The reported defect: at 9rem the PR cell held `⑂116 no checks` and
    // nothing wider, while the window's whole slack collected in the branch's
    // `1fr` as a gap that draws nothing.
    // Seven tracks since the marks earned one: `1rem` for them, and the phase
    // down to `5rem` to pay for it — see the breakpoint arithmetic below.
    expect(tracks()).toEqual(['1rem', '5rem', '10rem', '1fr', '14rem', '2.5rem', '1.25rem']);
  });

  it('keeps every track but the branch FIXED', () => {
    // The pairing that matters, and the reason this asserts the shape rather
    // than only the number. `minmax(9rem, auto)` on the PR cell and
    // `max-content` on the branch both make the column WIDER and both let an
    // edge move between rows — passing "the status got more space" while
    // undoing what fixed tracks are for. Exactly one track may be flexible.
    const flexible = tracks().filter((t) => !/^[\d.]+rem$/.test(t));
    expect(flexible).toEqual(['1fr']);
  });

  it('still needs less than the card breakpoint before the branch gets a pixel', () => {
    // The arithmetic `CARD_BELOW_PX` rests on, and the thing this change spent:
    // the fixed tracks went from 460px to 540px, so the grid now needs 624px of
    // the 640px breakpoint. Widening any fixed track again crosses it, and then
    // `CARD_BELOW_PX` has to move too — this fails when that day comes.
    // DERIVED from the track count, not hard-coded — and that is the fix this
    // test needed as much as the code did. `84` was five gaps plus padding,
    // correct for six tracks and silently wrong the moment a seventh arrived:
    // it under-counted by one gap and would have passed a layout that overflows.
    // A constant that only holds for the shape it was written against fails in
    // the reassuring direction.
    const GAP_PX = 12;
    const PADDING_PX = 24;
    const gapsAndPadding = (tracks().length - 1) * GAP_PX + PADDING_PX;
    const fixedPx = tracks()
      .filter((t) => t !== '1fr')
      .reduce((sum, t) => sum + Number.parseFloat(t) * 16, 0);
    expect(fixedPx).toBe(540);
    expect(fixedPx + gapsAndPadding).toBeLessThan(CARD_BELOW_PX);
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
  const source = readFileSync(
    new URL('../../src/app/components/AgentList.tsx', import.meta.url), 'utf8');

  /**
   * The source of one top-level `function Name(` declaration.
   *
   * It ends at the first `}` in COLUMN ZERO, which is where every top-level
   * declaration in this file closes and nothing nested ever does. An earlier
   * version sliced to *the next `function `* instead and was wrong in the
   * direction that matters: past the last declaration there is no next one, so
   * `PrCell` swallowed the rest of the file and the scan reported two toggle
   * buttons that live hundreds of lines below it. A structural test whose
   * boundaries are wrong reports strays that are not there — and, on the other
   * side of the same error, misses ones that are.
   */
  function declaration(name: string): string {
    const start = source.indexOf(`function ${name}(`);
    expect(start, `no component named ${name}`).toBeGreaterThan(-1);
    const end = source.indexOf('\n}\n', start);
    expect(end, `${name} does not close in column zero`).toBeGreaterThan(-1);
    return source.slice(start, end + 3);
  }

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
        if (!seen.has(child) && source.includes(`function ${child}(`)) queue.push(child);
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
  const ROW_NAVIGATION = ['data-branch', 'data-pr-link', 'href={`/plan/'];

  it('renders no interactive element in a row body outside the menu', () => {
    // THE GATE. Every `<a>` and `<button>` reachable from the row body, minus
    // the row's own navigation — the remainder must be empty.
    const strays: string[] = [];
    for (const { name, source: body } of rowBodySources()) {
      for (const m of body.matchAll(/<(a|button)[\s>]/g)) {
        // The element's own attributes: up to the end of its opening tag, which
        // is where its `data-` hook and `href` are.
        const tagEnd = body.indexOf('>', m.index);
        const tag = body.slice(m.index, tagEnd === -1 ? m.index + 400 : tagEnd);
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
    const withStray = declaration('Row').replace(
      '<BranchName row={row} />',
      '<BranchName row={row} /><a href={runUrl} data-stuck-link>Open failing run</a>',
    );
    expect(withStray).toContain('data-stuck-link');
    const found = [...withStray.matchAll(/<(a|button)[\s>]/g)].filter((m) => {
      const tag = withStray.slice(m.index, withStray.indexOf('>', m.index));
      return !ROW_NAVIGATION.some((hook) => tag.includes(hook));
    });
    expect(found.length).toBe(1);
  });

  it('reaches the components the row mounts, not only Row itself', () => {
    // The scan is transitive, and this is the property that makes it worth
    // anything: the row's own links live in `BranchName` and `PrCell`, so a
    // scan stopping at `Row` would read as clean while an inline action sat one
    // component down — exactly where the next one would land.
    const names = rowBodySources().map((c) => c.name);
    expect(names).toContain('BranchName');
    expect(names).toContain('PrCell');
    // And it does NOT enter the menu, which is where actions are allowed.
    expect(names).not.toContain('RowActions');
  });

  it('keeps the four actions in the menu, and the cue out of it', () => {
    // The other half of the rule. The gate above proves nothing LEFT the menu
    // for the row; this proves the four arrived — and that the one thing that
    // must NOT move did not.
    const menu = declaration('RowActions');
    expect(menu).toContain('<StartWorkButton');
    expect(menu).toContain('<ApproveButton');
    expect(menu).toContain('data-stuck-link');
    // The CUE is state, not an action: it points at something being wrong, and
    // a signal reachable only by opening a menu is not a signal.
    expect(menu).not.toContain('<StuckCue');
    expect(declaration('StuckCell')).toContain('<StuckCue');
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
  const ISSUE_NAVIGATION = ['data-issue-link'];

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
    s.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '');

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
        if (!seen.has(child) && source.includes(`function ${child}(`)) queue.push(child);
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
        const tagEnd = body.indexOf('>', m.index);
        const tag = body.slice(m.index, tagEnd === -1 ? m.index + 400 : tagEnd);
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
  const none = {
    canStart: false, canApprove: false, canResolve: false, hasRun: false,
    hasLog: false, hasStatus: false, hasOpen: false, canCommission: false,
    serverWillAct: false, approveWillAct: false, commissionWillAct: false,
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
    expect(menuState({ ...none, canApprove: true })).toEqual({
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
    // serverWillAct`, so a Draft plan's row — never startable by construction —
    // had a dead menu on exactly the rows with something to do.
    expect(menuState({ ...none, canApprove: true, approveWillAct: true }).enabled).toBe(true);
    expect(menuState({ ...none, canResolve: true, serverWillAct: true }).enabled).toBe(true);
    // And `Approve` answers to its OWN verdict, not to the dispatch one.
    expect(menuState({ ...none, canApprove: true, serverWillAct: true }).enabled).toBe(false);
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
      'canStart', 'canApprove', 'canResolve', 'hasRun', 'hasLog', 'hasStatus',
      'hasOpen', 'canCommission', 'serverWillAct', 'approveWillAct',
      'commissionWillAct',
    ] as const;
    const cases: (typeof none)[] = [{ ...none }];
    for (const key of keys)
      for (const v of bools) cases.push({ ...none, [key]: v });
    // A few with an act flag AND its will-act partner, so `enabled` is reached.
    cases.push({ ...none, canStart: true, serverWillAct: true });
    cases.push({ ...none, canApprove: true, approveWillAct: true });
    cases.push({ ...none, canResolve: true, serverWillAct: true });
    cases.push({ ...none, canCommission: true, commissionWillAct: true });
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
  // THE MOTIVATING DEFECT, in one line: a row that carried nothing else used to
  // render no menu at all. Open is navigation the row already has the address
  // for, so it makes the menu present — and enabled, because navigation is not
  // an act the server can refuse.
  it('renders and enables a menu for a row whose only item is Open', () => {
    expect(menuState({ ...none, hasOpen: true })).toEqual({
      present: true, enabled: true,
    });
  });

  // Commission design writes — so it asks whether the server will act, exactly
  // as Approve does, and is present-but-refused where the binding declines.
  it('keeps Commission design present but disabled where the server refuses', () => {
    expect(menuState({ ...none, canCommission: true })).toEqual({
      present: true, enabled: false,
    });
  });

  it('enables Commission design only on its own verdict', () => {
    expect(menuState({ ...none, canCommission: true, commissionWillAct: true }).enabled)
      .toBe(true);
    // Not on the dispatch verdict — a different binding, a different question.
    expect(menuState({ ...none, canCommission: true, serverWillAct: true }).enabled)
      .toBe(false);
  });
});

// A branch row names its wave, but only where the answer to *which slice of this
// plan?* is not "all of it" — a plan with more than one wave. The count is what
// decides that, and these pin it and the label it drives. The DOM half (the name
// reaching the phase cell, in every section, without moving the grid) is in
// test/integration/agents-tab.browser.test.ts.
describe('waveCountByPlan — how many waves a plan divides its work into', () => {
  it('counts distinct wave names per plan across the whole fleet', () => {
    const counts = waveCountByPlan([
      row({ plan: 'p', branch: 'a', wave: 'Truth' }),
      row({ plan: 'p', branch: 'b', wave: 'Fold' }),
      row({ plan: 'p', branch: 'c', wave: 'Fold' }),
      row({ plan: 'q', branch: 'd', wave: 'Line' }),
    ]);
    // `p` has two distinct waves though it has three branches — a wave with two
    // branches is still one wave.
    expect(counts.get('p')).toBe(2);
    expect(counts.get('q')).toBe(1);
  });

  it('counts a plan whose branches all sit in one unnamed wave as ONE', () => {
    // The server gives every branch of a plan with no `### ` sub-headings the
    // one string `(unnamed)`, so three such branches are three rows of one
    // wave. An unnamed wave is not the absence of a grouping — it is one group
    // holding everything.
    const counts = waveCountByPlan([
      row({ plan: 'p', branch: 'a', wave: '(unnamed)' }),
      row({ plan: 'p', branch: 'b', wave: '(unnamed)' }),
      row({ plan: 'p', branch: 'c', wave: '(unnamed)' }),
    ]);
    expect(counts.get('p')).toBe(1);
  });

  it('skips a planless row carrying no wave', () => {
    // A row built from the PR map belongs to no plan and carries `wave: ''`.
    // Counting it would invent a wave named "" that no plan file states.
    const counts = waveCountByPlan([
      row({ plan: '', branch: 'loose', wave: '' }),
      row({ plan: 'p', branch: 'a', wave: 'Truth' }),
    ]);
    expect(counts.has('')).toBe(false);
    expect(counts.get('p')).toBe(1);
  });
});

describe('waveLabel — the wave name a branch row shows, or none', () => {
  it('names the wave where the plan has more than one', () => {
    expect(waveLabel(row({ wave: 'Fold' }), 3)).toBe('Fold');
  });

  it('shows nothing for a single-wave plan, named OR unnamed', () => {
    // The case a presence check gets wrong: a named single-wave plan HAS a name
    // and still must show none, because a caption over a partition of one is
    // noise. Both halves, since the named one is the one that would leak.
    expect(waveLabel(row({ wave: 'Layout' }), 1)).toBeNull();
    expect(waveLabel(row({ wave: '(unnamed)' }), 1)).toBeNull();
  });

  it('shows nothing for a planless row or an uncounted plan', () => {
    expect(waveLabel(row({ wave: '' }), undefined)).toBeNull();
    expect(waveLabel(row({ wave: 'Fold' }), undefined)).toBeNull();
  });

  it('keeps `(unnamed)` honest where a multi-wave count somehow carries it', () => {
    // The count gates, not an invariant baked into the label: hand it a count
    // above one and it returns whatever string the row holds, `(unnamed)`
    // included, rather than second-guessing the scan.
    expect(waveLabel(row({ wave: '(unnamed)' }), 2)).toBe('(unnamed)');
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
 * CREATE STORY is offered on a ticket, and it always REFUSES — with its reason
 * on the control, the settled rule. Creating a story is an interactive decision
 * (`story-tracking` asks where to home it, and pushes back on premature ones),
 * not a one-click board write, so the board has no route for it. Offering it and
 * naming why is the honest answer; hiding it would leave the reader wondering
 * whether the board even knows stories exist.
 */
describe('storyRefusal — Create story is offered, and says why it cannot act from here', () => {
  it('always returns a non-empty reason', () => {
    expect(storyRefusal()).not.toBe('');
  });

  it('names the interactive nature rather than pretending it is a binding limit', () => {
    // Not *the board is not localhost* — that would be a lie the moment someone
    // added a story endpoint. The reason is about the ACT: a story is a decision
    // a person makes, with a home to choose, not a button to press.
    expect(storyRefusal().toLowerCase()).toMatch(/story|interactive|decide|home/);
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

  it('says Show failure for a ci-failing stuck branch', () => {
    expect(runLinkLabel(row({
      stuck: { state: 'ci-failing', conflicts: [], failingChecks: ['build'], changedPaths: [], runHistory: [{ url: 'u', conclusion: 'failure', startedAt: '' }], localAhead: 0 },
    }))).toBe('Show failure');
  });

  it('says Open last run for a row that is not failing', () => {
    expect(runLinkLabel(row({ pr: { number: 9, url: 'u', draft: false, state: 'green' } })))
      .toBe('Open last run');
  });
});

/**
 * COMMISSION DESIGN is offered on a PLAN kind row — a Draft plan a person must
 * decide about — beside Approve. It is the twin of Approve for the other answer:
 * this plan needs a spec, a spike or a tracer before it can be handed to
 * development.
 */
describe('canCommissionDesign — offered on a Draft plan row, beside Approve', () => {
  const draftPlanRow = row({
    group: 'not-started', state: 'open', phase: 'Discovery', waitingOn: 'you',
    note: DRAFT_PLAN_NOTE,
  });

  it('is offered on the same row Approve is — a Draft plan awaiting a decision', () => {
    expect(canCommissionDesign(draftPlanRow)).toBe(true);
  });

  it('is NOT offered on a branch waiting its turn', () => {
    // `waitingOn: 'time'` is a blocked wave, not a plan awaiting a person — the
    // same exclusion Approve makes, and for the same reason.
    expect(canCommissionDesign(row({ group: 'not-started', state: 'open', waitingOn: 'time' })))
      .toBe(false);
  });

  it('is NOT offered on a started branch', () => {
    expect(canCommissionDesign(row({ group: 'working', state: 'wip', waitingOn: null })))
      .toBe(false);
  });
});
