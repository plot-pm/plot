import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  groupByPlan,
  countdown,
  waitingLabel,
  showPlanHeading,
  isStartable,
  isLive,
  isCollapsible,
  noActionReason,
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
  ActivityEcho,
  activeRowKeys,
  LOCK_ECHO_MS,
  rowKey,
  watchedState,
  type WatchedState,
  type PlanGroup,
} from '../../src/app/components/AgentList.js';
import { GROUP_ORDER } from '../../src/server/fleet.js';
import {
  AgentRowSchema, DRAFT_PLAN_NOTE, ELIGIBLE_NOTE, type AgentRow,
} from '../../src/contract/schema.js';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'wip', phase: null, group: 'quiet', ageMinutes: 10, note: '', pr: null,
  branchUrl: '', waitingDays: null,
  // The default row is UNOBSERVED, not clean — the state of every branch the
  // scan could not look at. `ABSENT IS NOT FALSE`, so the base fixture must
  // never quietly assert *nothing is happening here*.
  localDirty: false, localLocked: false,
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

describe('isActive — which rows are actually being written to', () => {
  it('marks a row holding a lock, and a row with uncommitted work', () => {
    // The two entrances, and they are ORs rather than a sequence: someone is
    // writing this instant, or has written and not committed.
    expect(isActive(row({ localLocked: true }))).toBe(true);
    expect(isActive(row({ localDirty: true }))).toBe(true);
    expect(isActive(row({ localLocked: true, localDirty: true }))).toBe(true);
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
    // Asserted through the row's real shape: `local_ahead` is not forwarded
    // onto `AgentRow` at all, so a row carrying unpushed commits and nothing
    // else is indistinguishable here from an idle one — which is the correct
    // answer for this wave. The unpushed mark is a later wave's own signal.
    const ahead = row({ group: 'working', localDirty: false, localLocked: false });
    expect(isActive(ahead)).toBe(false);
    expect(Object.keys(ahead)).not.toContain('localAhead');
    expect(AgentRowSchema.parse({ ...ahead, local_ahead: 3 })).not.toHaveProperty('localAhead');
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
 * THE MARK'S APPEARANCE, read out of the source.
 *
 * The rendered half — the glow's computed `box-shadow`, its survival under
 * `prefers-reduced-motion`, the six tracks not moving — lives in
 * `test/integration/activity-mark.browser.test.ts`, because only a page can
 * answer it. What is here is the half a string can state exactly: that the
 * element carries NO animation at all.
 *
 * `className` is isolated from the component rather than searched for across the
 * file, and that is the whole point of the helper below: this file contains four
 * marks and three of them animate, so a naive `expect(source).not.toContain
 * ('animate-')` would fail on `[data-live-dot]` and prove nothing about this
 * mark.
 */
describe('the activity mark is a glowing bar, and it does not move', () => {
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
    const match = /className="([^"]*)"/.exec(source.slice(at));
    expect(match, `no className after data-${hook}`).not.toBeNull();
    return match![1];
  }

  it('reads each mark\'s OWN class list, not the next one in the file', () => {
    // The helper's own guard, and the reason it exists. Every assertion below
    // is worthless if this walks into a neighbour: the four marks are adjacent
    // in the source and each names the others in its comment. Two marks whose
    // geometry cannot be confused pin it.
    expect(classesOf('live-dot')).toContain('h-1.5 w-1.5');
    expect(classesOf('change-mark')).toContain('absolute inset-0');
    expect(classesOf('activity-mark')).not.toContain('inset-0');
  });

  it('carries no animation of any kind', () => {
    // THE assertion of this wave, and the pairing that matters: an
    // implementation reaching for `animate-pulse` because the board uses it
    // elsewhere passes every visibility assertion above and makes a row with
    // four other moving things noisier rather than clearer. A fact true for
    // hours has less claim on motion than one true for three seconds.
    expect(classesOf('activity-mark')).not.toMatch(/animate-/);
  });

  it('needs no motion-reduce variant, because there is no motion to reduce', () => {
    // The other three marks all carry `motion-reduce:animate-none` — keep the
    // mark, stop the movement. This one has nothing to stop, so the absence of
    // the variant is correct rather than an omission. Asserted so that a later
    // reader does not "fix" it by adding one, which would only make sense
    // beside an animation.
    expect(classesOf('activity-mark')).not.toContain('motion-reduce:');
  });

  it('glows in its own colour, in both themes', () => {
    // The glow is what supplies the prominence the requested motion was asked
    // to supply, so it is not optional decoration. An emerald `shadow-[…]`
    // rather than a step on the neutral shadow scale: those are greys for
    // lifting a surface off the page, and a grey blur around a 4px bar reads as
    // a smudge rather than a light.
    const classes = classesOf('activity-mark');
    expect(classes).toMatch(/shadow-\[[^\]]*rgba\(16,\s*185,\s*129/);
    expect(classes).toMatch(/dark:shadow-\[[^\]]*rgba\(52,\s*211,\s*153/);
  });

  it('is a bar rather than a dot, and wider than the one it sits beside', () => {
    // The reported problem is spotting it FROM A DISTANCE. A vertical stroke at
    // a fixed x reads as a mark down the side of the list; a dot must be hunted
    // among the row's words. Stated against `LiveDot`'s own geometry so the two
    // cannot drift into the same shape: that is a 6px round dot (`h-1.5 w-1.5`),
    // this is a tall, narrow stroke.
    const mark = classesOf('activity-mark');
    expect(mark).toContain('h-5');
    expect(mark).toContain('w-1');
    expect(classesOf('live-dot')).toContain('h-1.5 w-1.5');
  });

  it('stays out of the six tracks, in the row\'s left padding', () => {
    // Wave 1's home, kept: `sm:absolute` hangs the mark beside `LiveDot` in the
    // padding rather than taking a seventh track, so the six real columns do
    // not move in from the edge on every row in the fleet to reserve room for a
    // mark most rows never carry. `left-0` against the dot's `left-1` is what
    // keeps a row carrying both showing two marks rather than one thick one.
    const mark = classesOf('activity-mark');
    expect(mark).toContain('sm:absolute');
    expect(mark).toContain('sm:left-0');
    expect(classesOf('live-dot')).toContain('sm:left-1');
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

  it('offers NOTHING on a branch whose plan is still a Draft', () => {
    // The other half of the same rule, and the reason the draft note is a
    // sibling of ELIGIBLE_NOTE rather than a suffix on it: `plot-dispatch`
    // refuses a drafted plan's branches exactly as it refuses a wave-blocked
    // one, so the button must not appear on either.
    //
    // It comes out right by CONSTRUCTION — `isStartable` matches the eligible
    // sentence, so any other note loses the button without a second rule to
    // keep in step. Pinned anyway: that is a property worth failing loudly if
    // someone later loosens the match to a substring.
    expect(isStartable(notStarted({ note: DRAFT_PLAN_NOTE }))).toBe(false);
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
    const prior = observed(withState('a', 'green'));
    const moved = row({
      branch: 'a', pr: { number: 1, url: '', draft: false, state: 'green' },
      note: 'last commit 1 min ago', ageMinutes: 1, group: 'working',
    });
    expect(changedRows(prior, [moved]).changed.size).toBe(0);
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
    expect(fresh.next.get('plot/a')).toBe(null);     // as a known `null`
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
    expect(watchedState(row({ pr: null }))).toBe(null);
  });

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
    expect(tracks()).toEqual(['6rem', '10rem', '1fr', '14rem', '2.5rem', '1.25rem']);
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
    const GAPS_AND_PADDING = 84;
    const fixedPx = tracks()
      .filter((t) => t !== '1fr')
      .reduce((sum, t) => sum + Number.parseFloat(t) * 16, 0);
    expect(fixedPx).toBe(540);
    expect(fixedPx + GAPS_AND_PADDING).toBeLessThan(CARD_BELOW_PX);
  });
});
