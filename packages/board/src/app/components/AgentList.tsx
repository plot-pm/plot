import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AgentRow,
  type Fleet,
  type FleetSprint,
  type WaitingGroup,
  type Wave,
  UNNAMED_WAVE,
  isOneWavePlan,
  FLEET_CONTROLS_DEFAULT,
} from '../../contract/schema.js';

/**
 * A fleet's controls, or the declared default where the payload carries none.
 *
 * THE CLIENT CASTS THE FLEET, it does not parse it — so the schema's
 * `.default()` never runs here and `fleet.fleetControls` is genuinely
 * `undefined` on any payload written before the field existed (a stubbed
 * fixture, a board mid-upgrade, a cached response). Reading through it threw
 * and took the whole Agents tab down with it.
 *
 * `absent is not false`: an absent control block is *unknown*, and the safe
 * reading of unknown here is the same one the schema declares — a fleet that
 * dispatches nothing.
 */
function fleetControlsOf(fleet: Fleet): { autoDispatch: boolean; parallelAgents: number; working?: number } {
  return fleet.fleetControls ?? FLEET_CONTROLS_DEFAULT;
}
import { AutoDispatchSwitch, ParallelAgentsStepper } from './FleetControls.js';
import { StatusPanel, type BoardStatus } from './StatusPanel.js';
import { SprintFilter } from './SprintFilter.js';
import { slugPassesSprintFilter, sprintMembershipLookup } from '../lib/filters.js';
// THE BOARD'S ONE AGE DIALECT, borrowed rather than reimplemented. A second
// formatter would drift from this one the first time either changed — the same
// reason `ageLabel` was split out of `age` so an issue row and a branch row
// cannot render one duration two ways.
// THE TUPLE — one component and one grid for all seven kinds, and the
// projection that fills its six slots.
//
// `Row`, `PlanRow` and `IssueRowView` used to live in this file, on TWO grid
// definitions between the three of them — and the third, a TICKET, rendered
// through the tracks of a BRANCH: no slice, no worker, no branch, wearing the
// columns of something it is not. Three fill sites is how the two grids drifted
// apart, and a shared grid with three fillers would have kept that possible
// while adding a contract.
//
// What remains here are three ADAPTERS, and the distinction is the whole shape
// of the collapse. An adapter answers *what does this call site have to hand,
// and which marks and menu belong to it* — questions about the SECTION. The six
// slots are answered once, in `tuple-row.ts`, for every kind. So a new kind
// costs a projection and no rendering at all, which is what the deleted three
// could never do.
import { splitBranch } from '../lib/tuple-row.js';
// RE-EXPORTED, not redefined. `splitBranch` moved to the module that owns the
// slot rules when the collapse deleted `BranchName`; the unit suite imports it
// from here, and a second definition is exactly the drift this slice removed.
export { splitBranch };
import { isCollapsible, readCollapsed, writeCollapsed } from '../lib/agent-rows/collapse.js';
import { ActivityEcho, ChangeMarks, type WatchedState, activeRowKeys, changedRows, groupPace } from '../lib/agent-rows/activity.js';
import { GROUPS, groupByPlan, planWaitingDays, rowsBySection, sectionTally, showPlanHeading, showsWaveFold, sortByWaiting, ungroupedRows, waveGroupsFor, wavesElsewhere, waveKeyOf } from '../lib/agent-rows/sections.js';
import { shrinkNote } from '../lib/agent-rows/actions.js';
import { HOST_ANSWER_HINT, HOST_CANNOT_REPORT_HINT, hostAnswer, hostCannotReportCi, inMachineSection, issueNote, prNote, scanHostNote } from '../lib/agent-rows/host-notes.js';
import { isUnbegun, rowKey } from '../lib/agent-rows/row-identity.js';
import { WAVE_LINKING_KINDS, groupByWave, waveLabel } from '../lib/agent-rows/waves.js';
// THE ROW ESTATE, in three modules beside this one. `AgentList` is the shell:
// it reads the fleet, decides the sections, and mounts the rows — the rows,
// their marks and their menus are declared next door.
import { ActivityMark } from '../lib/agent-rows/marks.js';
import { HeaderRow, IssueRowView, PlanLink, PlanRow, Row, WaveRow, RegistryRow, type AgentListProps } from '../lib/agent-rows/rows.js';
import { workingAgentRows, brokenAgentRows } from '../lib/agent-rows/working-agents.js';
import { hasExceptions } from '../lib/agent-rows/stuck.js';
// RE-EXPORTED, not redefined — the same allowance `splitBranch` above is given.
// These moved out of this file when the row estate was split into three
// modules; the unit suite and `App.tsx` import them from here, and a second
// definition is exactly the drift the split removed.
export { menuState, noActionReason, offersOpen, openLabel, openTarget, runLinkLabel, showsWorkerLog, storyRefusal } from '../lib/agent-rows/menus.js';
export { inferredPlanName, isReleaseBranch, isUnpushed, rowSubject } from '../lib/agent-rows/rows.js';
export type { AgentListProps };


/**
 * Find the sole slice for a plan, if the plan has exactly one slice.
 *
 * Returns the slice object when `planWaveCount === 1`, null otherwise.
 * Used to decide whether a plan row should carry the slice's status —
 * which it does when the slice adds no information beyond what the plan
 * row already says.
 *
 * Looks up by the plan's DISPLAY name (the basename with date stripped),
 * matching what `deriveWaves` writes into `Wave.plan`.
 */
export function soleWaveFor(planName: string, waves: Wave[] | undefined): Wave | null {
  if (!waves) return null;
  // A plan may have multiple slices. Find ANY slice for this plan and check
  // its planWaveCount — every slice of a plan shares the same count.
  const w = waves.find((wave) => wave.plan === planName);
  return w && isOneWavePlan(w) ? w : null;
}

/**
 * What the server writes where a plan divides its work into no slices at all.
 *
 * `waveLabel` declines to print it, and this is why the string is named rather
 * than inlined: it is a value the SERVER writes (`wave.name || '(unnamed)'`),
 * so the client is matching a protocol constant and not a display choice.
 */
// The ONE definition lives in the contract — the server writes this value and
// both clients test for it. Imported for local use and re-exported, because
// modules already import it from here.
export { UNNAMED_WAVE };




/**
 * Which rows are currently wearing a change marker.
 *
 * The memory is a REF, not state: it is the board's record of what it last saw,
 * and writing it must not itself cause a render. What renders is the set of lit
 * keys beside it.
 *
 * **Per client, and one value deep.** Nothing is persisted and no contract field
 * is added — so a reload starts silent (the honest answer to *has anything
 * changed since I started looking?* is *I have only just started looking*), two
 * tabs mark independently, and a backgrounded tab accumulates nothing. The
 * marker is not a log.
 *
 * **Each key's timer is its own, and a second change RESTARTS it.** The marker
 * claims *something is happening here*, and two changes in quick succession make
 * that more true, not less: letting the first timer expire un-extended would
 * hide the second change behind the first and imply nothing further happened —
 * exactly the false statement the marker exists to prevent. So a repeat change
 * clears the pending timeout before setting a new one.
 *
 * Each marker clears ITSELF on its own timer rather than waiting for the next
 * pulse, which is what keeps a board that lost its server from sitting lit.
 */
function useChangeMarks(rows: readonly AgentRow[]): ReadonlySet<string> {
  const prior = useRef<Map<string, WatchedState> | null>(null);
  const [lit, setLit] = useState<ReadonlySet<string>>(() => new Set());
  const marks = useRef<ChangeMarks | null>(null);
  marks.current ??= new ChangeMarks(setLit);

  useEffect(() => {
    // The FIRST pulse has no prior map at all, so `changedRows` sees an empty
    // memory, marks nothing, and simply records — the fresh-mount case, which
    // fires on every page load.
    const { changed, next } = changedRows(prior.current ?? new Map(), rows);
    prior.current = next;
    if (changed.size > 0) marks.current!.mark(changed);
  }, [rows]);

  // Unmounting with markers lit would otherwise leave timeouts holding a
  // setState against a gone component.
  useEffect(() => () => marks.current?.dispose(), []);

  return lit;
}

/**
 * Which rows are currently being written to — this pulse's signals, widened by
 * the locks recently seen.
 *
 * A REF for the echo's bookkeeping and STATE for what renders, the same split
 * `useChangeMarks` uses: the record of what was seen must not itself cause a
 * render, and the set of lit keys must.
 *
 * The echo is fed from every pulse, including the first: unlike a change
 * marker, a lock seen on the very first pulse is a real observation rather than
 * a first sighting of something that might always have been true. There is no
 * "starts silent" rule here, because nothing is being compared to a previous
 * value — the field says *a write is happening*, and it says it on its own.
 */
function useActivity(rows: readonly AgentRow[]): ReadonlySet<string> {
  const [echoing, setEchoing] = useState<ReadonlySet<string>>(() => new Set());
  const echo = useRef<ActivityEcho | null>(null);
  echo.current ??= new ActivityEcho(setEchoing);

  useEffect(() => {
    // Only what was SEEN locked. Rows without a lock are not mentioned at all,
    // which is what keeps the echo from ever being extended or contradicted by
    // an observation that found nothing.
    echo.current!.seen(rows.filter((r) => r.localLocked).map(rowKey));
  }, [rows]);

  // Unmounting with echoes running would otherwise leave timeouts holding a
  // setState against a gone component.
  useEffect(() => () => echo.current?.dispose(), []);

  // THE SECTION HAS THE LAST WORD — here rather than inside `activeRowKeys`,
  // and rather than at the eight places the set is read.
  //
  // `activeRowKeys` answers *is something being written to this row*, from the
  // row's own signals and the echo. That is a question about the BRANCH, its
  // tests pin it as one, and the echo's three bounds are stated in those terms.
  // Whether the mark may be DRAWN is a second question, about the section, and
  // folding it into the first would have made a predicate about local signals
  // silently depend on grouping.
  //
  // Applied here because this hook is what every render site reads through —
  // including the plan and slice HEADS, which aggregate with `rows.some(...)`
  // and would otherwise need the guard spelled twice more.
  const active = activeRowKeys(rows, echoing);
  const keys = new Set<string>();
  for (const row of rows) {
    const key = rowKey(row);
    if (active.has(key)) keys.add(key);
  }
  return keys;
}
















/**
 * What a board that has NOT completed a scan should say — or `null` where it
 * has, and the ordinary view takes over.
 *
 * Exported and pure because the bug was a CONDITION, not a layout: the render
 * asked `!ready && !error`, so any failure skipped the never-scanned branch and
 * fell through to the ordinary view — every section rendering `none` under an
 * amber "Last scan failed" line, which at a glance is a healthy board over an
 * empty estate. Three cases, and two of them produced the same screen.
 *
 * Measured 2026-08-28 against a board installed from npm: the truth for ten
 * seconds, then indistinguishable from a working board, forever.
 */
export function coldState(
  ready: boolean,
  error: string | undefined | null,
): { headline: string; failure: string } | null {
  // A board that HAS scanned is not cold, whatever it is now doing. Staleness
  // and a failing re-scan are different statements and the ordinary view owns
  // both — merging them would make an empty view claim data it never held.
  if (ready) return null;
  if (!error) return { headline: 'Waiting for the first fleet scan…', failure: '' };
  return {
    // What the reader is looking at, THEN why. The emptiness is the fact they
    // most need and the one the old render never stated.
    headline: 'This board has never completed a scan, so it has nothing to show.',
    // Verbatim. A friendlier message that dropped `bash exited 127` would have
    // made the 2026-08-28 diagnosis impossible.
    failure: `The last attempt failed: ${error}`,
  };
}

export function AgentList({
  fleet,
  pollSeconds,
  staleSeconds = null,
  onOpenPlan,
  cardForPlanFile,
  dispatch,
  approve,
  commission,
  reslice,
  deliver,
  implement,
  drop,
  continueWith,
  idea,
  story,
  pulse = 0,
  onStarting,
  onRevealBranch,
  highlightBranch = '',
}: AgentListProps) {
  // Whether the server is answering at all. Not the same question as
  // `fleet.error`, which is a server that answered to say its scan failed.
  const stale = staleSeconds !== null;

  // Which rows changed their PR status in the last few seconds. Fed the WHOLE
  // fleet rather than one group's rows: a change frequently moves a row between
  // sections, and a memory scoped to a section would lose the prior value in
  // exactly that case — the case it most exists for.
  const marked = useChangeMarks(fleet.rows);

  // Which rows something is being written to. Fed the WHOLE fleet for the same
  // reason the change marks are: a row's signals do not decide its group, but
  // the group can change under it for other reasons, and a memory scoped to one
  // section would lose a running echo the moment its row moved.
  const active = useActivity(fleet.rows);

  // Which groups are folded. Seeded from `localStorage` on the first render
  // rather than in an effect: an effect would paint the crowded view once and
  // then fold it, which is a jump on every reload of a board that gets reloaded
  // several times an hour.
  //
  // Never derived from the ROWS. Collapsing is manual, always — an earlier idea
  // was to fold groups holding nothing actionable, dynamically, and the pulse
  // re-scans every five seconds, so rows would appear and vanish under the
  // cursor while the page jumped. A view meant to sit beside your work must not
  // move its own furniture. The same rule is why a row falling into a folded
  // group changes the count and nothing else: whoever folded `quiet` was asking
  // not to be interrupted by it.
  const [collapsed, setCollapsed] = useState<Set<WaitingGroup>>(() => readCollapsed());
  const toggle = (key: WaitingGroup) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeCollapsed(next);
      return next;
    });
  };

  // UNFOLD ONE SECTION — never fold. `BlockedByMark` reveals a blocker that has
  // completed into a section a reader keeps closed (DONE, folded by default),
  // and a folded section is REMOVED from the tree, so its row is unreachable by
  // any selector until this runs. One direction only: the reader asked which
  // slice, and the mark may open a section to answer, never close one out from
  // under them. Persisted through `writeCollapsed`, the same as `toggle` — the
  // reveal changes the reader's layout because silence was the defect being
  // removed, not a cost to design away. A no-op where the section is already
  // open, so a reader who has DONE unfolded pays nothing.
  const expandSection = (key: WaitingGroup) => {
    setCollapsed((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      writeCollapsed(next);
      return next;
    });
  };

  // Which plans in NOT STARTED have their branches showing. Keyed by plan name,
  // which is what the group is keyed by.
  //
  // Collapsed by default and NOT persisted, unlike the section-level fold. The
  // two are different in kind: folding QUIET is a standing preference about a
  // section a reader has decided not to watch, while opening one plan's slices is
  // a momentary question — *what were the three branches again* — asked and
  // answered. Persisting it would restore an opened plan on a board reloaded
  // several times an hour, which rebuilds the crowding the fold removes.
  //
  // Never derived from the rows, for the same reason the section fold is not: a
  // view that repaints every four seconds must not move its own furniture.
  const [openPlans, setOpenPlans] = useState<Set<string>>(() => new Set());
  const togglePlan = (plan: string) => {
    setOpenPlans((prev) => {
      const next = new Set(prev);
      if (next.has(plan)) next.delete(plan);
      else next.add(plan);
      return next;
    });
  };

  // THE SAME FOLD, ONE LEVEL DOWN — a slice's branches, where it holds more than
  // one. Every argument above applies unchanged: collapsed by default, not
  // persisted, never derived from the rows.
  //
  // A SEPARATE SET rather than a shared one, keyed `plan\0wave`. Slice names
  // repeat across plans — `Shaped` and `Sized` each appear in several of this
  // estate's plans, and `Says` in three — so one namespace would fold every
  // `Shaped` in the section on one click. The NUL separator cannot occur in
  // either name, so the key is unambiguous where `plan/wave` would not be
  // (branch-shaped slice names exist).
  /**
   * The agent registry, by branch — the join `fleet.agents` never had.
   *
   * The scan collects it, the contract carries it, and until 2026-08-20 the
   * client's only mention of it was a comment: measured, zero readers. So an
   * agent row had no session id, no worktree and no command, and named its
   * BRANCH instead — which is why `tupleFromAgent` sat uncalled beside it.
   *
   * A Map rather than a `find` per row: WORKING holds one row per agent today,
   * but the lookup runs on every row of every section on every pulse.
   */
  const agentByBranch = new Map((fleet?.agents ?? []).map((a) => [a.branch, a]));

  // THE WORKING SECTION IS THE REGISTRY, joined BACK to branch rows —
  // `the-working-section-shows-every-worker`, slice 1. `agentByBranch` above maps
  // the registry onto branch rows and is read by every OTHER section to name the
  // agent that holds a branch; this is the inverse the WORKING section needs — a
  // branch→row map, so an entry can find the row it joins to. A worker renders
  // whether or not that lookup answers: `main`, a `…-recut` scratch branch and a
  // merged branch in DONE are exactly the entries the old branch-join missed.
  //
  // `fleet.rows` unfiltered, not `filteredRows`: the sprint filter hides branch
  // ROWS a reader is not focused on, but a WORKER is a fact about the fleet, and
  // hiding it because its plan is off-focus is the empty-section defect wearing a
  // filter. The join to a hidden row still carries that row's facts.
  const rowByBranch = new Map((fleet?.rows ?? []).map((r) => [r.branch, r]));
  const workingRows = workingAgentRows(fleet?.agents ?? [], rowByBranch);
  // THE BROKEN AGENTS — `stalled` and `unknown` — for WAITING ON YOU.
  // A problem report: the worker stopped and needs a person to look. Joined to
  // branch rows by the same rule as `workingRows`, so the row's plan and PR
  // travel with it where one exists.
  const brokenRows = brokenAgentRows(fleet?.agents ?? [], rowByBranch);

  const [openWaves, setOpenWaves] = useState<Set<string>>(() => new Set());
  const waveKey = waveKeyOf;
  const toggleWave = (plan: string, wave: string) => {
    setOpenWaves((prev) => {
      const next = new Set(prev);
      const k = waveKey(plan, wave);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  // Seconds since this payload arrived. The ages the server sent are true at the
  // moment of the poll and stale a second later, so a countdown built from them
  // alone would jump by the poll interval rather than tick. This is the only
  // clock the client adds, and it runs ONLY while something is polling: a
  // counter ticking toward a refresh that is not coming is exactly the false
  // statement the countdowns exist to remove.
  //
  // A dead server is that same false statement one layer up, and this is where
  // it was missing: the rule was written for a CLOSED TAB (`pollSeconds ===
  // null`) and a tab left open on a dead server keeps polling, so the clock
  // kept running against a scan that had stopped happening. `stale` is the
  // second reason to stop — the poll is still going out, but nothing is coming
  // back, so every number this clock advances is one the server has not
  // confirmed. It resumes on its own when the fetches land again: `stale` flips
  // back, the effect re-runs and resets the count, so a recovered view ticks
  // from the payload that just arrived rather than from where the frozen one
  // left off.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    if (pollSeconds === null || stale) return;
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, [pollSeconds, stale, fleet.generatedAt]);

  // SPRINT FILTER — which active sprints to show. A set of slugs; empty means
  // no filter (show all). Plan-less rows (`row.sprint === ''`) always pass.
  //
  // NOT PERSISTED: this is a momentary focus (what am I working on right now)
  // rather than a standing preference. Persisting it would restore a filter
  // that no longer matched the reader's task, which is worse than the work of
  // clicking it again.
  //
  // NOT SYNCED TO URL: sprint filters are typically a quick toggle for the
  // current session, and URL state would require sanitization against stale
  // slugs. The Board tab's sprint filter is URL-synced because multiple sprints
  // can appear in the dropdown; this tab typically has one or two Active sprints
  // and the toggle is immediate.
  const [sprintFilter, setSprintFilter] = useState<Set<string>>(() => new Set());
  const toggleSprintFilter = (slug: string) => {
    setSprintFilter((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  // The fleet's active sprints, guarded for payloads predating the field.
  // Zod's `.default([])` only fires at PARSE time; the client CASTS, so
  // `fleet.sprints` is `undefined` on an older server's payload.
  const activeSprints: FleetSprint[] = fleet.sprints ?? [];

  // SPRINT MEMBERSHIP — a lookup from sprint slug to its member plan slugs.
  //
  // Built from `fleet.sprints`, the same array `board.sprints` carries. The
  // plan "the-sprint-filter-says-what-it-filters" measured: the old filter on
  // `r.sprint` admitted 53 plan rows with empty sprint fields beside the 2
  // genuine plan-less rows (release, unplanned PR). This lookup joins on the
  // sprint FILE's membership list, matching what Board.tsx and Swimlanes.tsx
  // already do.
  const membership = useMemo(
    () => sprintMembershipLookup(activeSprints),
    [activeSprints],
  );

  // THE FILTERED ROWS. A sprint filter hides rows whose plan is not a member
  // of any selected sprint — joining on the sprint file's `- [ ] [slug]` list,
  // not on the plan's `Sprint:` back-reference field.
  //
  // PLAN-LESS ROWS ALWAYS PASS. The exemption is by KIND, not by empty sprint:
  //   - `kind: 'release'` — the release row (changeset-release/main)
  //   - `kind: 'pr'` AND `row.plan === ''` — an unplanned PR
  // The old filter `r.sprint === ''` admitted 53 plan rows (slices/branches
  // whose sprint field was empty) alongside the 2 genuine plan-less rows.
  //
  // Applied BEFORE `rowsBySection`: the filter is about WHICH plans a reader
  // wants to see, and the sections are about WHERE those rows belong. Filtering
  // after sectioning would have the same effect but re-filter per section.
  const selectedSprints = useMemo(() => [...sprintFilter], [sprintFilter]);
  const filteredRows = sprintFilter.size === 0
    ? fleet.rows
    : fleet.rows.filter((r) => {
      // EXEMPT: rows with no plan
      if (r.kind === 'release') return true;
      if (r.kind === 'pr' && r.plan === '') return true;
      // FILTER: rows with a plan, by membership
      return slugPassesSprintFilter(r.plan, selectedSprints, membership);
    });

  // THE FILTERED ISSUES. Like rows, issues stay visible when no filter applies.
  // Issue rows have no sprint field, so they always pass.
  const filteredIssues = fleet.issues;

  // HOW MANY WORKERS THE FILTER HIDES — `the-filter-does-not-hide-a-worker`,
  // slice Named. The WORKING section deliberately shows ALL live workers (a
  // worker is a fact about the fleet, not about a reader's focus), but the
  // control should name when a filter WOULD hide workers if applied. This
  // count is passed to `ParallelAgentsStepper` to show "(N hidden by filter)".
  //
  // A worker's plan comes from the joined row — `row?.plan`. A worker with no
  // joined row (e.g. on `main`, on a scratch branch, or between branches) has
  // no plan to filter by and is never hidden. Only workers whose plan exists
  // and would NOT pass the sprint filter are counted.
  const workersHiddenByFilter = useMemo(() => {
    if (sprintFilter.size === 0) return 0;
    return workingRows.filter(({ row }) => {
      // No plan → not hidden (would pass any filter)
      if (!row?.plan) return false;
      // Check if this plan FAILS the sprint filter
      return !slugPassesSprintFilter(row.plan, selectedSprints, membership);
    }).length;
  }, [workingRows, sprintFilter, selectedSprints, membership]);

  // Degrade, do not hide: before the first scan lands this says so rather than
  // showing an empty list, which would read as "no agents are working".
  //
  // Deliberately BEFORE the staleness check and deliberately unchanged by it: a
  // tab that has never had an answer cannot have one it no longer trusts. The
  // two are different statements, and merging them would make an empty view
  // claim data it never held.
  const cold = coldState(fleet.ready, fleet.error);
  if (cold) {
    // THE `&& !fleet.error` USED TO BE HERE, AND IT WAS THE DEFECT. Any error
    // skipped this branch, so a board whose FIRST scan fails fell through to
    // the ordinary view: every section rendering `none`, under an amber
    // "Last scan failed" line. At a glance that is a healthy board over an
    // empty estate — and the amber line hedges the wrong way for this case,
    // appending "showing the last successful pulse below" only when `ready`,
    // so a board that never scanned said nothing about the emptiness beneath.
    //
    // Measured 2026-08-28 against a board installed from npm: the truth for ten
    // seconds ("Waiting for the first fleet scan…"), then indistinguishable
    // from a working board, forever. Two readers concluded the release was
    // broken; it was not.
    //
    // The sections are SUPPRESSED rather than filled. Rendering `none` per
    // section is a claim about the repository, and a board that never completed
    // a scan has no basis for one.
    return (
      <div className="text-sm text-slate-500">
        <p>{cold.headline}</p>
        {/* The failure text is the only actionable thing on screen. A friendlier
            message that dropped `bash exited 127` would have made the 2026-08-28
            diagnosis impossible, so it is kept verbatim and second — what the
            reader is looking at, then why. */}
        {cold.failure && (
          <p data-never-scanned className="mt-1 text-amber-600 dark:text-amber-500">
            {cold.failure}
          </p>
        )}
      </div>
    );
  }

  // Both countdowns come from the SERVER, because both are the server's own
  // gates. An earlier version computed this one from the client's poll interval
  // and it read "next in 0s" permanently: `ageSeconds` dates the server's scan
  // (5 s timer) while the client polls every 4 s, so `interval − age` was
  // reliably negative and the clamp did the rest. Subtracting one clock's age
  // from another clock's interval produces a number that is never right.
  //
  // `== null` rather than `=== null`: a server that predates the field sends
  // nothing, and whether that arrives as null or undefined depends on whether
  // the response was parsed through the schema. Both mean "not reported", and
  // treating undefined as a number renders "next in NaNs".
  //
  // `stale` removes the countdown rather than freezing it, because a frozen
  // number is still a prediction. "next in 3s" held at 3 says a refresh is
  // three seconds away, and no refresh is coming; the clamp the code already
  // had said the same thing louder, sitting at "next in 0s" — which reads as
  // *about to happen* — for as long as the server stayed down. There is no
  // honest number here, so there is no number.
  const gitNext =
    pollSeconds === null || stale || fleet.scanNextInSeconds == null
      ? null
      : Math.max(0, fleet.scanNextInSeconds - tick);
  // The PR countdown comes from the SERVER, because only the server knows its
  // own backoff. Absent (an older server) means no countdown at all — a client
  // assuming 60 s would count to zero and sit there through a 120 s wait.
  const prNext =
    pollSeconds === null || stale || fleet.prNextInSeconds == null
      ? null
      : Math.max(0, fleet.prNextInSeconds - tick);

  // Every status the board has to report, gathered into ONE panel rather than
  // stacked as a banner apiece — the corrected shape of
  // bug/a-degraded-view-says-so-at-the-top. Each was its own top-of-list `<p>`;
  // a third would have pushed the rows down the page, and two independent ones
  // read as unrelated notes. The panel ranks them (see `orderStatuses`), so the
  // order these are pushed in does not decide what the reader sees first —
  // severity does. Severities are spaced so a later status can slot between two.
  //
  // The distinctions the four separate banners drew are PRESERVED, now as
  // severity rather than as vertical position:
  //   · a dead SERVER (nothing came back) outranks everything — the whole view
  //     is gone, not merely degraded, so it is the one rose status;
  //   · a failed SCAN (the server answered to say its scan broke) is a distinct
  //     failure from the dead server, and both can be true at once — the panel
  //     holds both and pages between them rather than letting one erase the
  //     other;
  //   · a SHRINK (a scan that exited 0 and lost rows) is the smaller fact a
  //     dead server or a broken scan can both explain, so it ranks below them;
  //   · an unreachable HOST (PR data) is the least severe — another API
  //     answered and the rows are real.
  const statuses: BoardStatus[] = [];
  if (stale) {
    statuses.push({
      key: 'stale',
      severity: 40,
      tone: 'rose',
      text: `Not reaching the board server — last heard ${staleSeconds}s ago. `
        + 'The numbers below are frozen at that moment and are no longer being checked.',
    });
  }
  if (fleet.error) {
    statuses.push({
      key: 'scan-failed',
      severity: 30,
      tone: 'amber',
      text: `Last scan failed: ${fleet.error}`
        + (fleet.ready ? ' — showing the last successful pulse below.' : ''),
    });
  }
  if (fleet.shrink) {
    statuses.push({
      key: 'shrink',
      severity: 20,
      tone: 'amber',
      text: shrinkNote(fleet.shrink, fleet.ageSeconds + tick),
    });
  }
  // `prNote` owns the WORDING — an unreachable host keeps the plain sentence, a
  // spent rate limit says so and names when service returns (the sibling slice
  // `bug/the-note-names-the-rate-limit`). The panel owns the FRAME and the
  // placement. `prNote` is non-null exactly when `prError` is set, so the guard
  // and the text agree.
  const prMessage = prNote(fleet);
  if (prMessage) {
    statuses.push({
      key: 'pr-error',
      severity: 10,
      tone: 'amber',
      text: prMessage,
    });
  }
  // THE SCAN'S OWN HOST, beside the board's — the same category of fact one
  // level up, so it takes the same treatment rather than a second visual
  // language for *we do not know*. `scanHostNote` owns the wording (a spent
  // budget says so and says to wait; an unreachable host says to look); the
  // panel owns the frame and the placement, exactly as with `prNote`.
  //
  // BETWEEN a shrink and a spent PR budget, in the gap the severities were
  // spaced to leave. It outranks `pr-error` because the degradation is wider —
  // there the rows are real and one API is missing, here EVERY branch below was
  // derived without a PR answer and none was offered to `--next`. It ranks
  // below a shrink because a shrink is rows that vanished, which a reader must
  // meet first.
  const scanHostMessage = scanHostNote(fleet);
  if (scanHostMessage) {
    statuses.push({
      key: 'scan-host',
      severity: 15,
      tone: 'amber',
      text: scanHostMessage,
    });
  }

  return (
    <div className="space-y-4">
      {/* The board-status panel — one box carrying every status above, the
          view-status line stays at the foot. See `StatusPanel`. */}
      <StatusPanel statuses={statuses} />

      {/* THE SPRINT FILTER — one row per active sprint, each with a toggle,
          release target, and status counts. Disabled but visible when no
          sprint is Active, showing estate totals so the control teaches
          readers it exists. Placed before the sections so it is above the
          list.

          Estate totals are shown when the filter is OFF; sprint numbers when
          ON. This is the "Compared" slice of the-sprint-filter-says-what-it-
          filters plan: a reader sees the effect of turning the filter on
          before touching it. */}
      <SprintFilter
        sprints={activeSprints}
        selected={sprintFilter}
        onToggle={toggleSprintFilter}
        estateTotals={fleet.estateTotals}
      />

      {/* THE MASTER AGENT ROW — the branch the main checkout is on.

          Placed above the sections because it answers "where am I", which is
          context for the rows that follow rather than one of them. It is NOT a
          row in any section — it has no PR, no worker, no slice — and placing
          it inside one would make it look like it belongs there.

          ONLY when non-empty. An empty `masterAgentBranch` means detached HEAD,
          not a git repo, or unresolvable main checkout — all three produce no
          element rather than a placeholder or a fabricated SHA. The label and
          the line go together: a label beside nothing is worse than nothing.

          The link uses `branchUrlBase + masterAgentBranch`, the same composition
          the server applies to each row's `branchUrl`. Empty base renders as
          plain text — the rule every row follows for an unrecognised host.
      */}
      {fleet.masterAgentBranch && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm" data-master-agent>
          <span className="text-slate-500 dark:text-slate-400">Master Agent:</span>
          <span className="flex items-center gap-1.5">
            {/* The branch icon — same ⎇ glyph the tuple rows use for branches,
                in the same muted style. A branch name alone reads as a label
                rather than a kind of thing; the icon is what makes it clear. */}
            <span
              className="text-slate-400 dark:text-slate-500"
              title="Branch"
              aria-label="Branch"
            >
              ⎇
            </span>
            {fleet.branchUrlBase ? (
              <a
                href={`${fleet.branchUrlBase}${encodeURIComponent(fleet.masterAgentBranch)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                {fleet.masterAgentBranch}
              </a>
            ) : (
              <span className="font-mono text-sm text-slate-700 dark:text-slate-300">
                {fleet.masterAgentBranch}
              </span>
            )}
          </span>
        </div>
      )}

      {/* THE SECTIONS, spaced apart from each other and from nothing else.

          Their own container so the gap between two sections is a number this
          list owns. The page container above is `space-y-4` and holds the
          banners as well; a section break has to read as a bigger break than a
          row break (35–36 px rows, `py-2`), and 16 px was not it. */}
      <div data-sections className="space-y-8">
      {(() => { const sectionedRows = rowsBySection(filteredRows);
        // THE UNFILTERED ROWS, for computing how many each section hides. A
        // section that says `(3)` while hiding 5 looks complete when it is
        // not — the spec says a filtered section must say what it withheld.
        // ONLY COMPUTED WHEN A FILTER IS ACTIVE: when no filter applies, every
        // row is shown and no section hides anything to report.
        const unfilteredSectionedRows = sprintFilter.size > 0
          ? rowsBySection(fleet.rows)
          : sectionedRows;
        // THE SERVER-DERIVED SLICES, bound once beside the rows so every
        // `waveGroupsFor`/`ungroupedRows` call below asks the same list rather
        // than re-reading `fleet.waves` seven times. `undefined` on a cast
        // payload from a pre-#349 server — the field the client CASTS rather
        // than parses, so its schema `.default([])` never fired — and
        // `waveGroupsFor` falls back to the row's own state for exactly that
        // case. See `the-sections-ask-the-wave`.
        const waves = fleet.waves; return GROUPS.map(({ key, icon, label, hint }) => {
        // EVERY SECTION IS ITS `group`, WAITING ON A MACHINE INCLUDED. It
        // asked a second question until 2026-08-20 — admitting any row that
        // carried a process — and that is what listed live agents as machines
        // to wait on. See `inMachineSection` for why the answer is `group`
        // alone; it is called by name here because the section's membership is
        // the thing that plan settled, and a reader who follows the rule back
        // should land on the argument rather than on a bare comparison.
        //
        // FILTERED OVER `sectionedRows`, NOT `fleet.rows`. A slice whose branches
        // disagree on `state` carries two `group`s on its rows and would split
        // across two sections; `rowsBySection` rewrites every row of such a slice
        // to the ONE section the slice belongs in (a slice is where its unfinished
        // work is), so `Inverted`'s merged and open branches land together. A
        // uniform slice is untouched — its rows already share a group.
        const rows = key === 'waiting-on-machine'
          ? sectionedRows.filter(inMachineSection)
          : sectionedRows.filter((r) => r.group === key);
        // HOW MANY ROWS THE FILTER WITHHELD from this section. The spec says
        // `none` is never the whole answer when rows exist, and a section
        // showing 13 of 46 looks complete — both cases need the hidden count.
        // ONLY COMPUTED WHEN A FILTER IS ACTIVE: `unfilteredSectionedRows ===
        // sectionedRows` otherwise, so `hiddenCount` is zero by construction.
        const unfilteredRows = key === 'waiting-on-machine'
          ? unfilteredSectionedRows.filter(inMachineSection)
          : unfilteredSectionedRows.filter((r) => r.group === key);
        const hiddenCount = unfilteredRows.length - rows.length;
        // WORKING RENDERS FROM THE REGISTRY, so its body, its count and its fold
        // are the AGENTS, not the branch rows `rows` holds for it. Every other
        // section is untouched: `workingSection` gates only WORKING, and the
        // branch `rows` above still flows to the shared header machinery for the
        // five sections that render branches. The one number that must be the
        // agents is the tally — Done when #1, N entries → N rows — so `countOf`
        // answers the agents here and the rows everywhere else.
        const workingSection = key === 'working';
        const waitingOnYouSection = key === 'waiting-on-you';
        // THE COUNT IS OF WHAT THE SECTION HOLDS — branches, issues and broken
        // agents where applicable. WORKING counts its registry entries, WAITING ON
        // YOU adds issues and broken agents to its branch rows.
        const countOf = workingSection
          ? workingRows.length
          : waitingOnYouSection
            ? rows.length + brokenRows.length
            : rows.length;
        // The plan scope the blocked-by jump needs ABOVE the row. WORKING orders
        // by agent, so there is no per-plan `<ul>` to tag the way the grouped
        // sections have; the section's own grid carries it instead. First match
        // wins — a jump names ONE slice, and where several plans have live slices
        // the mark still names its target in its label, which is the same
        // degradation the query already has for a row on another tab.
        const workingWaveListPlan = workingSection
          ? workingRows.find(({ row: r }) => r?.wave && r?.plan)?.row?.plan
          : undefined;
        // WAITING ON YOU is the section for what needs a human DECISION, and an
        // unplanned issue is exactly that — the decision being *is this worth a
        // plan?* rather than *fix it*. No other section can hold it: the row has
        // no branch to be working, quiet or done, and nothing about it is
        // waiting on a machine.
        //
        // Rendered only where the tracker actually ANSWERED. `unsupported` (a
        // host with no issue listing) and `failed` (a lookup that did not come
        // back) both yield no rows here, and the second says so below rather
        // than passing for an empty inbox.
        const issues = key === 'waiting-on-you' && fleet.issueAnswer === 'answered'
          ? filteredIssues
          : [];
        // THE BROKEN AGENTS — `stalled` and `unknown` — for WAITING ON YOU only.
        // A problem report, not a branch: the worker stopped and needs a person to
        // look. Rendered AFTER the branch rows and the issues, because actionable
        // work outranks problem reports — a PR a person can merge is more urgent
        // than a worker a person can go check.
        const broken = key === 'waiting-on-you' ? brokenRows : [];
        // Every waiting-group is grouped the same way, `done` included: it is
        // the group that grows fastest over a working day, so it is the first to
        // become a list one scrolls past. A rule with an exception for the group
        // nobody reads is a rule someone has to remember.
        const grouped = groupByPlan(rows);
        // NOT STARTED counts PLANS. Its rows are not branches — measured live,
        // every one of them carried `pr=—` and `age=—`, because the name comes
        // from the plan's `## Branches` section and no branch was ever created
        // for it. Six rows for four plans, one plan saying the same thing three
        // times. So the plan becomes the row here and its branches fold beneath
        // it, and the section sorts by the only clock that ticks in it.
        //
        // Confined to this one key on purpose. Every other section holds
        // branches that exist, with real PRs and real tips, and the branch is
        // rightly their subject — this is not a new row shape spreading, it is
        // the one section whose rows were never branches saying so.
        const countsPlans = key === 'not-started';
        const plans = countsPlans ? sortByWaiting(grouped) : grouped;
        // Headings are decided PER GROUP, not per section — see
        // `showPlanHeading`. A section-wide answer gave a heading to every
        // group once any group earned one, so a plan with a single row got a
        // heading that labelled the one line beneath it.
        //
        // THE HALF THIS USED TO CARRY IS NOW STRUCTURAL. A group without a
        // heading had nowhere else to name its plan, so its row had to print
        // the name itself — and a headed group's rows had to suppress it, which
        // is the `planInHeading` flag the collapse removed. In the tuple the
        // plan is one of slot 4's LINKS, beside the branch it governs, so every
        // row names its plan whether or not a heading above it does. The
        // heading and the link are no longer two spellings of one fact: the
        // heading groups, the link opens.
        // An empty group is never foldable — it hides nothing, and its header
        // carries the HINT rather than `(0)`, which is the one thing in there
        // worth reading when there is nothing to list.
        // Issue rows and broken agent rows count toward the fold and the tally:
        // they are rows a reader sees, and a section reading `(2)` above four
        // lines is the mismatch NOT STARTED already had to fix once. Broken
        // agents are already in countOf for WAITING ON YOU, so only issues add.
        const collapsible = isCollapsible(countOf + issues.length);
        const isFolded = collapsible && collapsed.has(key);
        // The count and the hint occupy the same slot, and the count SURVIVES
        // folding: `QUIET (7)` states plainly that seven rows are hidden, while
        // a folded header with no number reads as *nothing here* — worse than
        // the crowding this fixes.
        // WAITING ON A MACHINE is the one group whose default hint makes a
        // CLAIM (*CI will finish*), so it is the one that must withdraw the
        // claim where the host cannot support it — see `hostCannotReportCi`.
        //
        // TWO WAYS TO LOSE THE CLAIM, AND NOT-YET-ASKED OUTRANKS CANNOT-REPORT.
        // `hostCannotReportCi` concludes from the rows that this HOST will
        // never answer; before the first fetch there are no PR rows to conclude
        // from, so it answers `false` on its own guard and the section would
        // fall back to the claiming hint. Asking `hostAnswer` first is what
        // keeps the earlier, weaker fact from being narrated by the later,
        // stronger one — and the order matters only because the two are true at
        // once on a fresh board pointed at Bitbucket.
        //
        // THE HINT ONLY, NOT THE LABEL. The section keeps its name so a reader
        // scanning headers finds it in the same place; what changes is the one
        // slot that was making the false promise.
        const answer = hostAnswer(fleet);
        const emptyHint =
          key !== 'waiting-on-machine'
            ? hint
            : answer !== 'answered'
              ? HOST_ANSWER_HINT[answer]
              : hostCannotReportCi(fleet.rows)
                ? HOST_CANNOT_REPORT_HINT
                : hint;
        // THE TALLY COUNTS WHAT THE SECTION SHOWS — and where a grouped section
        // renders plan heads over more slices than heads, it names both units and
        // says which is which.
        //
        // A count beside a section must be derivable from that section's rows,
        // or say what else it counts. Everywhere the section renders one line
        // per row, the number is that count and matches what a reader sees. But
        // a grouped section renders plan HEADS, each folded with its own slice
        // count — so `DONE (19)` sat above ten heads, the header counting slices
        // while the reader counted plans. `sectionTally` derives both figures
        // the way the component renders, group by group, so the header equals
        // the section by construction: `plans` is the visible-line count,
        // `waves` the scope a reader reaches by expanding every head.
        //
        // WORKING is the exception the plan preserves (Done when #4): it renders
        // the REGISTRY, one row per agent, and its number is `agents.length` —
        // `the-working-section-shows-every-worker`, slice Counted (#403). It has
        // no plan grouping to fold, so it keeps the single figure.
        const tallyOf = workingSection
          ? { plans: countOf, waves: countOf, differ: false }
          : sectionTally(rows, key, waves, issues.length);
        // WHERE THE TWO AGREE, ONE NUMBER — an ungrouped or empty section gains
        // no redundant clause, so QUIET at 0/0 stays `(0)` and never
        // `(0 plans · 0 slices)` (Done when #3). Where they differ, both, named.
        const shownLabel = tallyOf.differ
          ? `(${tallyOf.plans} plan${tallyOf.plans === 1 ? '' : 's'} · ${tallyOf.waves} slice${tallyOf.waves === 1 ? '' : 's'})`
          : `(${tallyOf.plans})`;
        // THE HIDDEN SUFFIX. A filtered section says what it withheld, so
        // `none` is never the whole answer when rows exist and the reader has
        // forgotten the toggle is on. ONLY PRINTED WHERE HIDING HAPPENED:
        // printing `0 hidden` on an unfiltered section fails (Done when #5).
        const hiddenSuffix = hiddenCount > 0
          ? ` — ${hiddenCount} hidden by Sprint only`
          : '';
        const tally = (
          <span className="font-normal normal-case tracking-normal text-slate-400 dark:text-slate-600">
            {countOf + issues.length > 0 ? shownLabel : emptyHint}{hiddenSuffix}
          </span>
        );
        // Whether anything in this section is moving — and at which pace. The
        // heading carries the same mark its rows do, because a folded group
        // reports its STOCK (`(4)`) and never its motion, and QUIET and DONE
        // start folded and stay that way across sessions.
        //
        // Derived here, from the same `active` set the rows below are rendered
        // from, so the heading and its rows cannot disagree. See `groupPace`.
        const pace = groupPace(rows, active);
        // The mark rides INSIDE the toggle button on a collapsible section and
        // beside the label otherwise — one element either way, so a section that
        // gains or loses its fold does not gain or lose a mark. Placed after the
        // tally rather than before the caret: the caret and icon are the
        // heading's controls, the mark is a fact about what is behind them.
        const groupMark = pace && <ActivityMark pace={pace} place="heading" />;
        return (
          // A SECTION BREAK MUST READ AS A BIGGER BREAK THAN A ROW BREAK.
          //
          // Measured on the live board 2026-08-19: 16 px between one section's
          // block and the next section's heading, against 4 px between that
          // heading and the block it introduces. A heading four pixels from its
          // own rows and sixteen from the group above belongs almost equally to
          // both — and 16 px is barely more than the gap between two rows, so
          // the strongest structural break on the page was drawn with the
          // page's weakest signal.
          //
          // The gap is set on the sections' OWN container (`space-y-8`, see
          // `data-sections` below) rather than on the page container that also
          // holds the stale and dead-server banners: those are notices about
          // the page, not sections of it, and widening the page's `space-y`
          // would push them apart too. It cannot be an `mt-*` on the section
          // either — `space-y-*` writes its margin through
          // `& > :not([hidden]) ~ :not([hidden])`, which outranks a plain
          // utility class and would silently win.
          //
          // The rows themselves stay at `py-2`, which is the density an
          // operator watching a fleet wants.
          //
          // A SECTION IS NOT A ROW, AND WAS DRAWN SMALLER THAN ONE.
          //
          // The gap above fixed the spacing and left the SIZE, and measured on
          // 2026-08-20 the size was not merely equal to a row's — it was under
          // it. `text-xs` is 12px; the row's `<li>` is `text-sm` and its branch
          // name renders 13px. So the strongest structural break on the page
          // was set two-thirds of a step BELOW the weakest thing inside it,
          // which is the same finding as the gap, one property along.
          //
          // This branch proposed `text-sm` — 14px, one step above the 13px
          // branch name, on the argument that a dense fleet view cannot afford
          // a heading that shouts. While it waited, main answered the same
          // defect at `text-base` and darkened the colour with it, and that is
          // what stands here: a heading two steps clear of its rows rather
          // than one. Two hands reading the same rendered board reached for
          // the same property and only disagreed on how far, which is a
          // stronger signal about the defect than either fix alone.
          //
          // `mb-2` because the heading grew — 4px under a 16px line reads
          // tighter than 4px under 12px did, not the same. The space below a
          // heading belongs to the heading; `space-y-8` separates one section
          // from the next and says nothing about the distance from a heading
          // to its own rows.
          <section key={key}>
            <h2 className="mb-2 flex items-baseline gap-2 px-3 text-base font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
              {collapsible ? (
                // A real button, so the header is reachable and operable by
                // keyboard. `aria-expanded` is what tells a screen reader the
                // section is folded — the caret alone is a visual fact.
                <button
                  type="button"
                  data-group-toggle={key}
                  aria-expanded={!isFolded}
                  onClick={() => toggle(key)}
                  // The heading's own fold, given the same treatment as the
                  // plan row's for the same reason: it was a 10px caret, the
                  // outlier size on a board that uses 12px 82 times. `py-1
                  // -my-1` makes the whole heading line a 24px-tall target
                  // without moving it — the label is part of the button
                  // already, so the target was never as small as the caret,
                  // but the caret is what a reader aims at.
                  //
                  // THAT REASONING IS ABOUT THE TARGET AND IT HOLDS: `py-1
                  // -my-1` stays, and the button still measures 24px tall. The
                  // operator's later complaint — *"expand / collapse icons
                  // still too small"* — is about SEEING the glyph, which is a
                  // different property of the same control. Easy to hit and
                  // hard to read are not the same failure, so the glyph grows
                  // and the target does not move. The test asserts both, or a
                  // later hand shrinking the padding would pass it.
                  className="-my-1 flex items-center gap-2 py-1 uppercase tracking-wide hover:text-slate-900 dark:hover:text-slate-100"
                >
                  {/* One glyph rotated, matching the plan row's fold — see
                      there for why a rotation beats a second glyph.

                      The glyph tracks the heading's own size, because a
                      caret is a shape rather than a letter: a triangle set at
                      the text's size reads smaller than the text beside it,
                      having no x-height or stem to fill the em. `w-4` because
                      the box has to widen with the glyph — `w-3` was cut for a
                      13px mark and would clip this one, or shift it off centre
                      when it rotates. */}
                  <span
                    aria-hidden
                    className={`inline-block w-4 text-center text-base leading-none transition-transform ${isFolded ? '' : 'rotate-90'}`}
                  >
                    ▸
                  </span>
                  <span aria-hidden>{icon}</span>
                  {label}
                  {tally}
                  {/* The mark stays whether the section is FOLDED OR OPEN.
                      Hiding it on expand was considered — the rows show it
                      themselves, so the heading repeats them — and rejected
                      because the mark would then vanish at the moment of
                      opening, which reads as *it stopped*. A marker that
                      disappears when you look closer is worse than one that
                      repeats itself. */}
                  {groupMark}
                </button>
              ) : (
                <>
                  <span aria-hidden>{icon}</span>
                  {label}
                  {tally}
                  {groupMark}
                </>
              )}
              {/* THE TWO FLEET CONTROLS, each on the section it is ABOUT and
                  OUTSIDE the collapse button above — a control nested in the
                  fold's `<button>` would be a button inside a button, invalid
                  markup that swallows its own clicks. Placed here they sit in the
                  same header flex row whether or not the section folds, and the
                  spinbutton keeps its own keyboard handling clear of the fold's.

                  The switch belongs to NOT STARTED (*is the queue served?*) and
                  the stepper to WORKING (*how many at once?*). Both read the
                  SHARED state off `fleet.fleetControls` and write it back through
                  /api/fleet-controls; neither dispatches anything in this slice. */}
              {key === 'not-started' && (
                <AutoDispatchSwitch value={fleetControlsOf(fleet).autoDispatch} />
              )}
              {key === 'working' && (
                <ParallelAgentsStepper value={fleetControlsOf(fleet).parallelAgents} working={fleetControlsOf(fleet).working} hiddenByFilter={workersHiddenByFilter} registry={fleet?.registry} />
              )}
            </h2>
            {/* The body goes, the header stays — including its count. Removed
                from the tree rather than hidden with CSS: a folded group should
                cost no vertical space at all, which is the entire complaint
                this answers. */}
            {!isFolded && (
            // `role="grid"` rather than a `<table>`: the rows carry interactive
            // controls and this list nests a collapsible group structure with
            // per-plan sub-headings inside it, which table markup would fight
            // rather than serve. The role gains the semantics and keeps the DOM.
            //
            // `aria-label` rather than the group's `<h2>`: the heading is
            // outside the grid and reads "⚠ Waiting on you (4)", which is the
            // section's name and not this grid's.
            <ul
              role="grid"
              aria-label={`${label} — agent branches`}
              {...(workingWaveListPlan ? { 'data-wave-list': workingWaveListPlan } : {})}
              className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40"
            >
              <HeaderRow />
              {workingSection ? (
                // WORKING IS THE REGISTRY. One row per entry, joined to a branch
                // row where one exists and standing alone where none does —
                // `the-working-section-shows-every-worker`, slice 1. This section
                // does NOT group by plan or fold into slices the way the branch
                // sections do: an agent is a WHO, not a slice of a plan, and its
                // row names what it is working on rather than being nested under
                // it. The five registry states each render their own word, and a
                // merged branch's worker sits here while that branch keeps its
                // DONE row — both true, neither moved.
                workingRows.length > 0 ? (
                  workingRows.map(({ agent, row }) => (
                    <RegistryRow
                      // Keyed by the SESSION where there is one — the identity
                      // that outlives the branch — and by the branch otherwise,
                      // so two entries on the same (empty) branch do not collide.
                      key={agent.session || `branch:${agent.branch}` || `wt:${agent.worktree}`}
                      agent={agent}
                      row={row}
                      waves={waves}
                      onOpenPlan={onOpenPlan}
                      card={row ? cardForPlanFile?.(row.planFile) ?? null : null}
                      dispatch={dispatch}
                      implement={implement}
                      continueWith={continueWith}
                      pulse={pulse}
                      onStarting={onStarting}
                      marked={row ? marked.has(rowKey(row)) : false}
                      active={row ? active.has(rowKey(row)) : false}
                      onRevealBranch={onRevealBranch}
                      highlighted={agent.branch !== '' && agent.branch === highlightBranch}
                    />
                  ))
                ) : (
                  <li role="row" className="px-3 py-2 text-sm text-slate-400 dark:text-slate-600">
                    <span role="gridcell">none</span>
                  </li>
                )
              ) : rows.length > 0 ? (
                plans.map((group) => {
                  // ONE answer per group, read by both the heading and its
                  // rows. Computing it twice is how they drift: a heading that
                  // renders while its rows also print the plan name says it
                  // twice, and the reverse loses the name entirely.
                  //
                  // In NOT STARTED the PLAN ROW carries the name instead, so no
                  // sub-heading is drawn: the heading exists to save the rows
                  // repeating the plan, and here the plan row already does that
                  // job with a clock and a slice summary the heading has no room
                  // for. Two labels for one plan would be the repetition this
                  // section is removing, one level up.
                  // NOT IN WAITING ON YOU, and this is the operator's call
                  // rather than a rule derived from the shape.
                  //
                  // `showPlanHeading` is right about what it measures: two rows
                  // under one plan, so the name prints once above them instead of
                  // twice. What made it wrong HERE is that the section's rows are
                  // a mixed bag — a PR, a plan under review, a release, a ticket
                  // — and grouping two of them by a shared plan says *these two
                  // belong together* about rows whose only relation is a name
                  // they each already print in slot 4. The heading saved no
                  // repetition, because every row still carries its own plan
                  // link.
                  //
                  // Measured on the mock: the group rendered box, tint and
                  // heading around a PR and a plan row, with its rows at the same
                  // x as the four ungrouped ones — a heading over rows
                  // indistinguishable from their neighbours. Indenting them was
                  // tried first and is not what was wanted: the grouping itself
                  // is what does not belong in a section that asks *what needs
                  // me next*, one question per row.
                  //
                  // The other sections keep it. WORKING and QUIET hold branches
                  // of one plan doing one thing, which is the case the heading
                  // was built for.
                  const headed = !countsPlans && key !== 'waiting-on-you'
                    && showPlanHeading(group);
                  // A PLAN ROW HEADS ITS SLICES, where every row in the group is
                  // one. That is the shape NOT STARTED already draws, and the one
                  // a text heading cannot: a plan has a phase, an approval clock
                  // and a menu, none of which an `h3` can carry.
                  //
                  // `group.plan` must be named — a group of rows no plan claims
                  // has no plan row to draw — and the slice groups must account
                  // for every row, or a plan row would head a set it does not
                  // describe.
                  // A PLAN GROUP IS HOMOGENEOUS BY CONSTRUCTION, which is why
                  // this predicate can require that EVERY row be slice-grouped
                  // rather than handling a mixture.
                  //
                  // The operator's observation, 2026-08-20: *"a plan group will
                  // barely have mixed SLICES. Once a plan is approved the slices
                  // land in NOT STARTED."* A plan's branches move through the
                  // lifecycle together — in review here, then dispatchable in NOT
                  // STARTED, then working, then done — so a group holding some
                  // slices and some loose rows is a transient, not a shape to
                  // design for.
                  //
                  // So the `=== 0` is a GATE rather than a limitation: where a
                  // mixture does occur, the group falls back to the text heading
                  // and every row renders as itself. Nothing is hidden, and the
                  // plan row appears only where it describes the whole set.
                  const planHeads = !countsPlans && Boolean(group.plan)
                    && ungroupedRows(group.rows, key, waves).length === 0
                    && waveGroupsFor(group.rows, key, waves).length > 0;
                  if (countsPlans) {
                    const foldable = showsWaveFold(group);
                    // A FOLD WITH EXCEPTIONS STAYS OPEN — the reader must see
                    // the conflict, claim, or structural issue the fold holds.
                    // The toggle still works (hasExceptions is a DEFAULT, not a
                    // lock), so a reader who has dealt with the exception can
                    // collapse the fold; but a fresh board renders it open
                    // rather than hiding the problem.
                    const groupHasExceptions = hasExceptions(group.rows);
                    const expanded = foldable
                      ? openPlans.has(group.plan) || groupHasExceptions
                      : null;
                    return (
                      // THE RULE BELONGS TO THE GROUP, NOT TO ITS ROWS.
                      //
                      // A plan and its branches are one thing on this board, and
                      // the border used to be drawn by every row including the
                      // plan's own — so the line fell BETWEEN a plan and its
                      // first branch, and no line fell between one plan and the
                      // next. Each visual block therefore held one plan's
                      // branches and the following plan's heading: the separator
                      // was dividing exactly the wrong pair.
                      //
                      // `last:border-0` could not save it, because the plan row
                      // is never the last child of its own group.
                      //
                      // Drawn here, once per plan, and the rows inside drop
                      // theirs (see `PlanRow` / `Row`, keyed on `inPlanGroup`).
                      //
                      // AND THE EDGE IS THE GROUP'S OWN, not a row divider
                      // reused.
                      //
                      // Measured on the board 2026-08-19: two issue rows (#227,
                      // #228) rendered beneath the heading
                      // `the-row-says-what-it-knows (5)` and belonged to no plan
                      // at all. They are not misfiled — they arrive in the
                      // separate `issues` field and render after the plan's
                      // branches — but the group suppressed the dividers between
                      // its own rows and then drew its closing line in exactly
                      // the weight a row divider uses. The one arrangement that
                      // makes a group look like it continues past its last
                      // member.
                      //
                      // So: a full `border` at the group's own weight, and
                      // `last:border-0` is GONE. The last group needs its
                      // bottom edge most of all — that is the edge the issue
                      // rows sat below — and the grid's own rounded border sits
                      // further out, so the two do not collide. A plan with five
                      // branches and two unrelated rows after it now reads as a
                      // plan with five, which is what the `(5)` beside its name
                      // has been saying all along.
                      <li
                        role="rowgroup"
                        data-plan-group={group.plan}
                        // An OUTLINE and no margin, for the reason spelled out
                        // on the headed group below: a border plus a margin
                        // insets the rows inside it, and a plan row's cells have
                        // to land at the same x as every other row's in the
                        // fleet. An outline is drawn outside the layout box and
                        // costs nothing.
                        className="block rounded-sm bg-slate-50/60 outline outline-slate-300 -outline-offset-1 dark:bg-slate-900/30 dark:outline-slate-700"
                      >
                        <PlanRow
                          group={group}
                          waves={fleet.waves}
                          onOpenPlan={onOpenPlan}
                          expanded={expanded}
                          onToggle={foldable ? () => togglePlan(group.plan) : undefined}
                          // The plan is active if ANY of its branches is —
                          // including one folded out of sight, which is the case
                          // the mark most needs to reach.
                          active={group.rows.some((r) => active.has(rowKey(r)))}
                          marked={group.rows.some((r) => marked.has(rowKey(r)))}
                          // The PLAN's card, looked up by the group's own plan
                          // file rather than by any branch's — the approval is
                          // the plan's act and the card is the plan's record.
                          card={cardForPlanFile?.(group.planFile) ?? null}
                          approve={approve}
                          commission={commission}
                          deliver={deliver}
                          implement={implement}
                          dispatch={dispatch}
                          pulse={pulse}
                          onApproving={onStarting}
                          // HOW MANY OF THIS PLAN'S SLICES ARE NOT UNDER THIS HEAD.
                          // Counted against the slices this head's own ROWS belong
                          // to, not against the section it renders in: a slice
                          // carries one of two sections while a row carries one of
                          // six, so the section comparison called a head's own
                          // slice elsewhere whenever the row needed attention.
                          elsewhere={wavesElsewhere(fleet.waves, group.plan, key,
                            new Set(group.rows.map((r) => r.wave).filter(Boolean)))}
                          // A ONE-SLICE plan shows its slice's verdict on this row
                          // instead of nesting a slice row beneath it.
                          soleWave={soleWaveFor(group.plan, waves)}
                          // …and the hidden slice row's *Start work* rides here
                          // too, dispatching that one slice.
                          onStarting={onStarting}
                        />
                        {/* The branches, folded. Removed from the tree rather
                            than hidden with CSS, the same as the section fold:
                            a folded group should cost no vertical space, which
                            is the whole complaint this answers.

                            A plan with ONE branch renders it unconditionally —
                            `expanded` is null there, meaning *there was never a
                            fold*, and hiding the row behind a control the reader
                            was not given would lose it entirely. */}
                        {(expanded === null || expanded) && (
                          // INDENTED, because grouping is a visual fact and a
                          // heading above a row is not one. Measured 2026-08-20:
                          // `TupleRow` carried **zero** `pl-*` or `ml-*`, so rows
                          // of one plan were distinguished only by the heading
                          // over them — siblings looked like neighbours, and a
                          // reader scanning past the heading lost the set.
                          //
                          // `pl-6` matches the fold caret's own 24px box, so the
                          // indent lines the children up with the space the
                          // disclosure occupies on the parent — the shape a file
                          // tree uses, and the one a reader already reads.
                          //
                          // The left border draws the set as one run rather than
                          // three rows that happen to be shifted. Without it the
                          // indent alone is ambiguous at the boundary: the last
                          // child and the next plan's row differ only by 24px of
                          // whitespace.
                          <ul
                            role="presentation"
                            data-wave-list={group.plan}
                            className="ml-6 border-l border-slate-200 dark:border-slate-800"
                          >
                            {/* SLICES, NOT BRANCHES — the eighth kind, and the
                                one this section had been rendering as its own
                                branches all along.

                                `groupByWave` partitions the plan's rows; each
                                partition is ONE row naming the slice, carrying
                                the scan's verdict as its status and its branches
                                as its artifact links. A slice holding one branch
                                (20 of 21 unfinished slices) is therefore one row
                                and no fold; one holding several gets the
                                disclosure and its branches beneath. */}
                            {/* A DEFERRED BRANCH IS NOT PART OF A SLICE'S WORK,
                                and it keeps its own row.

                                `isUnbegun` already draws this line and
                                `waveSummaryFor` already refuses to count a
                                deferred branch as a slice: *"not a slice nobody
                                reached, a branch somebody set down"*. The slice
                                grouping has to honour it, because a slice row
                                shows the SLICE's verdict and clock — and a
                                deferred branch carries a PR and an age of its
                                own that appear nowhere else. Folded into a
                                single-branch slice they would be unreachable,
                                which is exactly the loss `fleet.ts` warns of:
                                *"a branch started and then shelved read as never
                                begun, with its age and its PR erased."* */}
                            {/* SLICE ROWS NAME THEIR SLICES, however many slices
                                the plan has. A one-slice plan's branches belong to
                                that slice, and its name is part of their identity —
                                the verdict migrated to the plan row, the name did
                                not. */}
                            {(() => {
                              const oneWave = soleWaveFor(group.plan, waves);
                              const waveGroups = groupByWave(group.rows.filter(isUnbegun));
                              return waveGroups.map((wg) => {
                              const many = wg.rows.length > 1;
                              const waveOpen = many
                                ? openWaves.has(waveKey(group.plan, wg.wave))
                                : null;
                              return (
                                <li key={wg.wave} className="block">
                                  <WaveRow
                                    group={wg}
                                    plan={group.plan}
                                    waitingDays={planWaitingDays(group)}
                                    expanded={waveOpen}
                                    onToggle={many ? () => toggleWave(group.plan, wg.wave) : undefined}
                                    active={wg.rows.some((r) => active.has(rowKey(r)))}
                                    marked={wg.rows.some((r) => marked.has(rowKey(r)))}
                                    // THE PLAN'S CARD, looked up by the group's
                                    // own plan file — dispatch is a plan-level
                                    // act, so the card is the plan's, exactly as
                                    // it is on the plan row above.
                                    //
                                    // NO DISPATCH for a one-slice plan: the plan
                                    // row carries its slice's Start-work, so the
                                    // slice row withholds it. The slice row exists
                                    // for its NAME — a branch row cannot carry a
                                    // slice name — not for its controls.
                                    card={oneWave ? null : (cardForPlanFile?.(group.planFile) ?? null)}
                                    dispatch={oneWave ? undefined : dispatch}
                                    reslice={reslice}
                                    pulse={pulse}
                                    onStarting={onStarting}
                                    waves={waves}
                                    onExpandSection={expandSection}
                                  />
                                  {/* The branches of a MULTI-branch slice, folded
                                      and indented again — the same `ml-6` and the
                                      same rule the plan's own list draws, one
                                      level deeper. A single-branch slice renders
                                      none: its branch is already the artifact
                                      link on the row above, and a fold over one
                                      row the reader can see is the control this
                                      estate has removed twice. */}
                                  {many && waveOpen && (
                                    <ul
                                      role="presentation"
                                      data-wave-branch-list={wg.wave || '(unnamed)'}
                                      className="ml-6 border-l border-slate-200 dark:border-slate-800"
                                    >
                                      {wg.rows.map((r) => (
                                        <Row
                                          key={rowKey(r)}
                                          row={r}
                                          onOpenPlan={onOpenPlan}
                                          inPlanGroup
                                          // Inside a SLICE's fold: the verdict is
                                          // one line up, so a bare `open` here
                                          // contradicts it rather than adding to
                                          // it.
                                          inWaveGroup
                                          card={cardForPlanFile?.(r.planFile) ?? null}
                                          dispatch={dispatch}
                                          implement={implement}
                                          continueWith={continueWith}
                                          pulse={pulse}
                                          onStarting={onStarting}
                                          marked={marked.has(rowKey(r))}
                                          active={active.has(rowKey(r))}
                                          section={key}
                                          agent={agentByBranch.get(r.branch) ?? null}
                                          // NO SLICE BADGE. The row is nested
                                          // under the slice that names it, so the
                                          // badge would repeat one line up —
                                          // which is the duplication this whole
                                          // slice removes.
                                          onRevealBranch={onRevealBranch}
                                          highlighted={r.branch === highlightBranch}
                                        />
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              );
                            });
                            })()}
                            {/* The rows that are not a slice's unbegun work —
                                a deferred branch, with its own PR and its own
                                age. Rendered as BRANCH rows, because that is
                                what they are: something somebody started. */}
                            {group.rows.filter((r) => !isUnbegun(r)).map((r) => (
                              <Row
                                key={rowKey(r)}
                                row={r}
                                onOpenPlan={onOpenPlan}
                                inPlanGroup
                                card={cardForPlanFile?.(r.planFile) ?? null}
                                dispatch={dispatch}
                                implement={implement}
                                continueWith={continueWith}
                                pulse={pulse}
                                onStarting={onStarting}
                                marked={marked.has(rowKey(r))}
                                active={active.has(rowKey(r))}
                                section={key}
                                agent={agentByBranch.get(r.branch) ?? null}
                                onRevealBranch={onRevealBranch}
                                highlighted={r.branch === highlightBranch}
                              />
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  }
                  return (
                  // `rowgroup`, so the grid's children are rows and groups of
                  // rows rather than an unnamed `<li>` the tree cannot place.
                  // The per-plan sub-heading and its rows are exactly what a
                  // rowgroup is for.
                  // THE HEADED GROUP GETS THE SAME EDGE AS THE PLAN GROUP.
                  //
                  // This is the arrangement the plan measured: two issue rows
                  // (#227, #228) under a heading reading
                  // `the-row-says-what-it-knows (5)`, belonging to no plan at
                  // all. They arrive in the separate `issues` field and render
                  // after the plan's branches — nothing claims they belong to
                  // the plan; the layout simply offered no place where the
                  // plan's group ended.
                  //
                  // A plan heading with five branches under it and two
                  // unrelated rows after it reads as a plan with seven, and the
                  // count beside the name says `(5)`: the reader has to
                  // arbitrate between the number and the layout.
                  //
                  // Only where a HEADING was drawn. A nameless group heads
                  // nothing and claims nothing, so there is no boundary to
                  // assert and a box around it would invent one.
                  <li
                    role="rowgroup"
                    key={group.plan}
                    data-plan-group={headed || planHeads ? group.plan : undefined}
                    // AN OUTLINE, NOT A BORDER — and no margin.
                    //
                    // A border plus `m-1` drew exactly the edge this needs and
                    // moved its rows 5 px right, so a HEADED group's branch cell
                    // stopped landing at the same x as an unheaded group's:
                    // measured 321 against 326, and
                    // `agents-tab.browser.test.ts` catches it. That alignment is
                    // the property the tracks exist for and this must not spend
                    // it.
                    //
                    // `outline` is drawn outside the box and takes no layout, so
                    // the rows inside are where they were. `outline-offset` lifts
                    // it clear of the grid's own rounded border, and the tinted
                    // background does the rest of the work of reading as one
                    // block.
                    className={
                      headed || planHeads
                        ? 'block rounded-sm bg-slate-50/70 outline outline-slate-300 -outline-offset-1 dark:bg-slate-900/30 dark:outline-slate-700'
                        : undefined
                    }
                  >
                    {/* A nameless group holds rows no plan claims, so there is
                        nothing to head them WITH: rendering the heading anyway
                        printed a bare "(3)", a label that labels nothing.
                        `showPlanHeading` already refuses those. */}
                    {/* THE PLAN, as a ROW rather than as a text heading — where
                        its rows are slices.
                        
                        *"We need to group branches for plans. Which should be
                        Plan group with SLICES"* and *"PLANS are missing with their
                        age"*. NOT STARTED has drawn exactly this since the slice
                        kind landed: a plan row carrying the plan's phase and its
                        approval clock, with its slices indented beneath. A text
                        heading carries neither — it is a label, and a plan has a
                        phase, an age and a menu.
                        
                        Only where every row under it is a slice. A group holding a
                        release and a ticket has no plan to head it with, and the
                        `h3` below still serves the mixed case. */}
                    {planHeads && (
                      <PlanRow
                        group={group}
                        waves={fleet.waves}
                        onOpenPlan={onOpenPlan}
                        // THE FRESHEST BRANCH CLOCK, because `waitingDays` is
                        // null here.
                        //
                        // `planWaitingDays` reads the approval clock, and its own
                        // docstring says why that is right in NOT STARTED: *"the
                        // branches have no tip to date"*. In THIS section the
                        // reverse holds — measured, `waitingDays: null` on every
                        // row while `ageMinutes` reads 178, 127, 120 — so the
                        // plan row showed no age at all.
                        //
                        // The freshest of its branches, which is what a slice row
                        // already uses: the plan's clock is the clock of the work
                        // in it.
                        ageMinutes={Math.min(
                          ...group.rows.map((r) => r.ageMinutes)
                            .filter((a): a is number => a !== null),
                        )}
                        // FOLDABLE, and OPEN by default — the reverse of NOT
                        // STARTED, where a plan is collapsed because its list is
                        // there to browse. Here the slices are what the section is
                        // showing, so hiding them would hide the rows a reader
                        // came for; but eight plans of four slices is 40 lines,
                        // and a reader who has dealt with one plan wants it out
                        // of the way.
                        //
                        // `openPlans` holds what is COLLAPSED in this section
                        // rather than what is expanded — one Set, two defaults,
                        // and the same click either way.
                        // COLLAPSED BY DEFAULT WHERE IT HOLDS MORE THAN ONE
                        // SLICE, open where it holds one.
                        //
                        // A plan of one slice collapsed shows a reader nothing
                        // they did not already have — the plan row states its
                        // phase and its clock, and the one slice beneath is the
                        // only content. A plan of four is 5 lines, and eight such
                        // plans are 40: that is the crowding the fold answers.
                        //
                        // The default is a QUESTION ABOUT THE GROUP, so the Set
                        // holds the reader's overrides rather than the state
                        // itself — one click flips whichever default applies.
                        //
                        // A FOLD WITH EXCEPTIONS STAYS OPEN — the same rule as
                        // NOT STARTED, for the same reason: *folding may hide
                        // repetition, never exceptions*. A reader must see the
                        // conflict, claim, or structural issue the fold holds.
                        expanded={
                          hasExceptions(group.rows)
                            ? true
                            : (waveGroupsFor(group.rows, key, waves).length > 1
                              ? openPlans.has(`open:${group.plan}`)
                              : !openPlans.has(`shut:${group.plan}`))
                        }
                        onToggle={() => togglePlan(
                          waveGroupsFor(group.rows, key, waves).length > 1
                            ? `open:${group.plan}` : `shut:${group.plan}`,
                        )}
                        active={group.rows.some((r) => active.has(rowKey(r)))}
                        marked={group.rows.some((r) => marked.has(rowKey(r)))}
                        card={cardForPlanFile?.(group.planFile) ?? null}
                        approve={approve}
                        commission={commission}
                        deliver={deliver}
                        implement={implement}
                        dispatch={dispatch}
                        pulse={pulse}
                        onApproving={onStarting}
                        // HOW MANY OF THIS PLAN'S SLICES ARE ELSEWHERE — the same
                        // count the NOT STARTED head carries, keyed on THIS
                        // section (`key`). A DONE head whose plan also has an
                        // unstarted slice says so here rather than reading as a
                        // plan wholly done.
                        elsewhere={wavesElsewhere(fleet.waves, group.plan, key,
                          new Set(group.rows.map((r) => r.wave).filter(Boolean)))}
                        // A ONE-SLICE plan shows its slice's verdict on this row
                        // instead of nesting a slice row beneath it.
                        soleWave={soleWaveFor(group.plan, waves)}
                        // …and the hidden slice row's *Start work* rides here
                        // too, dispatching that one slice.
                        onStarting={onStarting}
                      />
                    )}
                    {headed && !planHeads && (
                      // AND WHERE THE `h3` SURVIVES, IT KEEPS THE SIZE #302 GAVE IT.
                      // The plan row above answers the grouped case; this
                      // heading answers the MIXED one, where a group holds a
                      // release or a ticket beside its slices and no single plan
                      // heads it. That case still had the original defect: at
                      // `text-[11px]` this label sat under the 13px branch names
                      // it labels, the section's defect one level down.
                      //
                      // `py-0.5` with it, because the type grew and the padding
                      // did not have to — 2px around a 13px label in a tinted
                      // band holds the proportion `py-1` held around an 11px
                      // one. Taking either side of this conflict whole would
                      // have lost one of the two: #304's structure drops the
                      // sizing, #302's sizing drops the structure. Both are
                      // wanted, and they are about different rows.
                      <h3 className="border-b border-slate-200/60 bg-slate-50 px-3 py-0.5 text-[13px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                        {/* The heading CARRIES the link, because the rows below
                            no longer print the plan name. Grouping moved the
                            name up here; the way to reach the plan has to move
                            with it, or the tab keeps the tidier layout and
                            loses the click. Once per group rather than once per
                            row, which is the point of grouping. */}
                        <PlanLink
                          plan={group.plan}
                          planFile={group.planFile}
                          onOpenPlan={onOpenPlan}
                        />
                        <span className="ml-1.5 font-normal text-slate-400 dark:text-slate-600">
                          ({group.rows.length})
                        </span>
                      </h3>
                    )}
                    {/* INDENTED WHERE THERE IS A HEADING, and only there —
                        *grouping means indented*, the same `ml-6` and left rule
                        the slice list carries one section over.

                        Measured before it: a headed group rendered box, tint and
                        heading with its rows at **x=17, the same x as the
                        ungrouped rows beside them**, so a reader scanning past
                        the heading lost the set. With it, x=42.

                        On the WRAPPER rather than on the group box, which keeps
                        the alignment argument above intact: that comment rejects
                        a margin on the OUTLINE because it moved the rows 5px and
                        broke the cross-section column. Here the box does not
                        move; its children do, and only where a heading is there
                        to explain why. An unheaded group gets no class at all, so
                        its rows sit where every other row in the fleet does. */}
                    {/* FOLDED AWAY where the plan row's caret says so — removed
                        from the tree rather than hidden with CSS, the same as
                        every other fold on this board: a collapsed group should
                        cost no vertical space, which is the whole complaint it
                        answers.

                        A FOLD WITH EXCEPTIONS STAYS OPEN — same logic as the
                        `expanded` prop above, and the two MUST agree or the
                        caret says one thing while the content says another. */}
                    {(!planHeads || hasExceptions(group.rows) || (waveGroupsFor(group.rows, key, waves).length > 1
                      ? openPlans.has(`open:${group.plan}`)
                      : !openPlans.has(`shut:${group.plan}`))) && (
                    <ul
                      role="presentation"
                      // THE SAME SLICE-LIST WRAPPER NOT STARTED ALREADY CARRIES.
                      // `BlockedByMark`'s jump is `[data-wave-list="…"]
                      // [data-wave-row="…"]` — a slice row is only reachable when
                      // it sits UNDER its plan's slice-list. NOT STARTED tagged
                      // its `<ul>` with this; the other sections did not, so a
                      // blocker completing into DONE rendered a `data-wave-row`
                      // with no `data-wave-list` above it and the query — correct,
                      // document-wide, unchanged — found nothing to scroll to.
                      // Tagging every section's wrapper is the DOM half of the
                      // fix the folded-section unfold is the other half of.
                      data-wave-list={group.plan}
                      className={headed || planHeads
                        ? 'ml-6 border-l border-slate-200 dark:border-slate-800'
                        : undefined}
                    >
                      {/* SLICES OVER THEIR REVIEWABLE BRANCHES, in this section
                          only — and only where a slice holds MORE THAN ONE.
                          
                          *"Technically the PR with branch and the slice is a
                          SLICE"*, and the qualifier is the section: WAITING ON YOU
                          asks *what needs a decision*, and where three PRs are
                          three slices of one slice the thing being decided is the
                          slice. `opus5-longhorizon-hardening :: Implementation`
                          holds five landed branches and reads `blocked` — five
                          reviews the board was filing as *nothing to do*.
                          
                          The earlier objection to calling a PR a slice was that a
                          five-branch slice would render five rows all named
                          `Implementation`. Grouping is what answers it: one slice
                          row, its PRs beneath. A LONE reviewable branch stays a
                          PR row, because there is no set to name — the same rule
                          `showsWaveFold` applies, and the same one that makes a
                          single-branch slice one row in NOT STARTED.
                          
                          The slice can appear in BOTH sections, deliberately: the
                          branches with PRs group here, the ones nobody started
                          group under the plan in NOT STARTED. Each section shows
                          only the branches its own question is about. */}
                      {(() => {
                        /* SLICE ROWS NAME THEIR SLICES, however many slices
                           the plan has. A one-slice plan's branches belong to
                           that slice, and its name is part of their identity —
                           the verdict migrated to the plan row, the name did
                           not. See NOT STARTED for the longer form. */
                        const waveGroups = waveGroupsFor(group.rows, key, waves);
                        return waveGroups.map((wg) => {
                        // A SLICE OF ONE NEEDS NO FOLD — its single branch is
                        // already named in slot 4, so a control revealing a row
                        // the reader can see is the noise this estate removed
                        // twice. Measured: all 12 slices here hold one branch.
                        const many = wg.rows.length > 1;
                        const waveOpen = many
                          ? openWaves.has(waveKey(group.plan, wg.wave))
                          : null;
                        return (
                          <li key={`wave:${wg.wave}`} className="block">
                            <WaveRow
                              group={wg}
                              plan={group.plan}
                              waitingDays={planWaitingDays(group)}
                              expanded={waveOpen}
                              onToggle={many ? () => toggleWave(group.plan, wg.wave) : undefined}
                              active={wg.rows.some((r) => active.has(rowKey(r)))}
                              marked={wg.rows.some((r) => marked.has(rowKey(r)))}
                              // NO `Start work` HERE: these branches are already
                              // started. The card and dispatch binding are what
                              // that control needs, and withholding them is how
                              // this row says the act it wants is a merge.
                              //
                              // RESLICE IS STILL PASSED, and it is not `dispatch`
                              // in disguise: `Slice this wave` takes only the
                              // plan slug, so it needs no card and no merge —
                              // it is the act an `unsliced-wave` here (five
                              // landed branches, `blocked`) actually wants.
                              reslice={reslice}
                              pulse={pulse}
                              onStarting={onStarting}
                              // THE COUNT ONLY WHERE THERE IS MORE THAN ONE.
                              // `1 to review` beside a single branch link states
                              // what that link already shows, and it would hide
                              // what a reader wants on a slice of one: that
                              // branch's own condition, which no verdict carries
                              // and no fold exists to reach.
                              groupedCount={wg.rows.length > 1 ? wg.rows.length : undefined}
                              // THE WORD IS THE SLICE'S VERDICT. A slice row states
                              // what the scan says about it — `complete`, `eligible`,
                              // `blocked` — not a section-chosen word that differs
                              // from its siblings' verdicts. `delivered` stays a
                              // branch row's word; a slice speaks for itself.
                              groupedWord={wg.verdict ?? undefined}
                              soleRow={wg.rows.length > 1 ? undefined : wg.rows[0]}
                              implement={implement}
                              continueWith={continueWith}
                              onOpenPlan={onOpenPlan}
                              onRevealBranch={onRevealBranch}
                              planHeaded={planHeads}
                              waves={waves}
                              onExpandSection={expandSection}
                            />
                            {many && waveOpen && (
                              <ul
                                role="presentation"
                                data-wave-branch-list={wg.wave || '(unnamed)'}
                                className="ml-6 border-l border-slate-200 dark:border-slate-800"
                              >
                                {wg.rows.map((r) => (
                                  <Row
                                    key={rowKey(r)}
                                    row={r}
                                    onOpenPlan={onOpenPlan}
                                    inPlanGroup
                                    inWaveGroup
                                    card={cardForPlanFile?.(r.planFile) ?? null}
                                    dispatch={dispatch}
                                    implement={implement}
                                    continueWith={continueWith}
                                    pulse={pulse}
                                    onStarting={onStarting}
                                    marked={marked.has(rowKey(r))}
                                    active={active.has(rowKey(r))}
                                    section={key}
                                    agent={agentByBranch.get(r.branch) ?? null}
                                    onRevealBranch={onRevealBranch}
                                    highlighted={r.branch === highlightBranch}
                                  />
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      });
                      })()}
                      {ungroupedRows(group.rows, key, waves).map((r) =>
                        // THE SECTION DECIDED GROUPING; THE ROW DECIDES ITS KIND.
                        //
                        // `waveGroupsFor` returns nothing for WORKING and WAITING
                        // ON A MACHINE on purpose — those sections order by agent
                        // and by build, and must not bury unrelated slices under
                        // plan heads. That grouping decision is right and stays.
                        //
                        // But a row whose `kind` is `wave` is a slice WHEREVER it
                        // renders. Routing every ungrouped row through `<Row>` — a
                        // BRANCH row — was the defect: in WORKING the branch took
                        // slot 3 and the slice's name was demoted to a badge, so the
                        // same slice read as a slice in NOT STARTED and as a branch
                        // here. `groupByWave([r])` builds the one-row `WaveGroup`
                        // `WaveRow` already renders in NOT STARTED, and `soleRow`
                        // is what carries the branch, its PR, and the worker facts
                        // (`worker running (pid …)`, the live-worker status) onto
                        // the slice row. `planHeaded={planHeads}` is `false` here,
                        // so slot 4 keeps the plan link a WORKING slice would lose.
                        r.kind === 'wave' ? (
                          <WaveRow
                            key={rowKey(r)}
                            group={groupByWave([r])[0]}
                            plan={r.plan}
                            waitingDays={r.waitingDays}
                            // No fold — a slice of one has nothing hidden to reveal.
                            expanded={null}
                            active={active.has(rowKey(r))}
                            marked={marked.has(rowKey(r))}
                            card={cardForPlanFile?.(r.planFile) ?? null}
                            dispatch={dispatch}
                            implement={implement}
                            pulse={pulse}
                            onStarting={onStarting}
                            // The one branch this slice holds — its status, age, PR,
                            // and note (the worker's condition) render on the slice
                            // row, exactly as a NOT STARTED slice of one does.
                            soleRow={r}
                            continueWith={continueWith}
                            onOpenPlan={onOpenPlan}
                            onRevealBranch={onRevealBranch}
                            // WORKING draws no plan head, so the plan link belongs
                            // on the slice row's slot 4.
                            planHeaded={planHeads}
                            waves={waves}
                            onExpandSection={expandSection}
                          />
                        ) : (
                        <Row
                          // The same helper the change memory keys by — two
                          // spellings of one identity is how a mark ends up on
                          // the wrong row.
                          key={rowKey(r)}
                          row={r}
                          onOpenPlan={onOpenPlan}
                          // Looked up per row rather than per group: a row's
                          // plan is what dispatch takes, and only the rows that
                          // are startable ever use it.
                          card={cardForPlanFile?.(r.planFile) ?? null}
                          dispatch={dispatch}
                          implement={implement}
                          continueWith={continueWith}
                          pulse={pulse}
                          onStarting={onStarting}
                          // By the row's own identity, so a row that changed
                          // section carries its mark to where it now sits.
                          marked={marked.has(rowKey(r))}
                          // Same identity, same reason — and answered for the
                          // whole fleet at once, so no two places can disagree
                          // about which rows are being written to.
                          active={active.has(rowKey(r))}
                          // See the `section` prop: the machine section lists
                          // this row as a PROCESS and says so, and no other
                          // section's rendering changes.
                          section={key}
                          // THE REGISTRY ENTRY for whatever agent holds this
                          // branch — which is what makes an agent row name the
                          // agent rather than the branch. WORKING is where those
                          // rows are, so this is the site that matters most.
                          agent={agentByBranch.get(r.branch) ?? null}
                          // The same slice label as inside a plan group, and
                          // the same rule: a fact about the branch, beside the
                          // branch. This row used to differ from one in a plan
                          // group — it printed the plan's PHASE where the other
                          // printed nothing — which is the inconsistency the
                          // relocation removes.
                          // ONLY WHERE THE ROW DOES NOT ALREADY LINK ITS SLICE.
                          //
                          // An `agent` and a `pr` row both carry the slice as an
                          // artifact link now, so the badge is a second copy —
                          // measured on the mock as `Inverted` twice on the agent
                          // row and `Modelled` twice on PR 304.
                          //
                          // The badge STAYS on a BRANCH row, and the distinction
                          // is not a compromise. Its docstring argues that *"the
                          // slice qualifies THIS BRANCH, and the association is
                          // positional… A MARK, not a link"* — sound while a slice
                          // had no row to point at. A branch row's artifact slot
                          // holds its plan and its PR, not its slice, so there the
                          // badge is still the slice's only statement.
                          //
                          // Keyed on the KIND rather than on *does slot 4 contain
                          // a slice*, because the projection is what decides that
                          // and this adapter must not form a second opinion about
                          // it — the rule `tupleFromRow` states about `row.kind`.
                          waveName={WAVE_LINKING_KINDS.has(r.kind) ? null : waveLabel(r)}
                          onRevealBranch={onRevealBranch}
                          highlighted={r.branch === highlightBranch}
                        />
                        )
                      )}
                    </ul>
                    )}
                  </li>
                  );
                })
              ) : (
                // A row of one cell: the grid holds no branches, and saying so
                // is still a row of the grid rather than something beside it.
                //
                // `none` IS AN OBSERVATION, so it is only printed where one was
                // made. In WAITING ON A MACHINE before the host has answered
                // the grid is empty because nobody asked, and the word for that
                // is not the word for an empty answer — the whole defect, in the
                // one cell a reader lands on after opening the section.
                //
                // Said HERE as well as in the header, not instead of it. The
                // header's hint is the copy a reader sees while scanning, and
                // the two sections that start folded prove headers can be the
                // only thing on screen; this cell is what a reader sees once
                // they open the section and look for the rows. A single site
                // would leave whichever of those two readings unlabelled.
                // `none` is only printed where there is nothing AT ALL. A
                // section holding issue rows or broken agent rows and no branches
                // is not empty, and the word would sit above the rows contradicting
                // them.
                issues.length === 0 && broken.length === 0 && (
                <li role="row" className="px-3 py-2 text-sm text-slate-400 dark:text-slate-600">
                  <span role="gridcell">
                    {key === 'waiting-on-machine' && answer !== 'answered'
                      ? HOST_ANSWER_HINT[answer]
                      : 'none'}
                  </span>
                </li>
                )
              )}
              {/* The unplanned issues, AFTER the branches. Work already under
                  way outranks work nobody has committed to — the same
                  actionable-first ordering `GROUPS` applies one level up. */}
              {issues.map((issue) => (
                <IssueRowView
                  key={`issue-${issue.number}`}
                  issue={issue}
                  idea={idea ?? { available: false, reason: 'this board has not said whether it can create plans' }}
                  story={story ?? { available: false, reason: 'this board has not said whether it can create stories' }}
                  issueAnswer={fleet.issueAnswer}
                />
              ))}
              {/* THE BROKEN AGENTS — `stalled` and `unknown` — as problem reports.
                  Rendered AFTER branches and issues: actionable work outranks
                  problem reports, and the ordering says so. Each row is keyed by
                  session where there is one and by branch otherwise, the same
                  identity WORKING uses for its registry rows. */}
              {broken.map(({ agent, row }) => (
                <RegistryRow
                  key={agent.session || `branch:${agent.branch}` || `wt:${agent.worktree}`}
                  agent={agent}
                  row={row}
                  waves={waves}
                  onOpenPlan={onOpenPlan}
                  card={row ? cardForPlanFile?.(row.planFile) ?? null : null}
                  dispatch={dispatch}
                  implement={implement}
                  continueWith={continueWith}
                  drop={drop}
                  pulse={pulse}
                  onStarting={onStarting}
                  marked={row ? marked.has(rowKey(row)) : false}
                  active={row ? active.has(rowKey(row)) : false}
                  onRevealBranch={onRevealBranch}
                  highlighted={agent.branch !== '' && agent.branch === highlightBranch}
                />
              ))}
              {/* AN OUTAGE IS NOT AN ANSWER. A failed issue lookup says so, in
                  the section the rows would have appeared in. Silence here is
                  precisely the defect: it is indistinguishable from an inbox
                  with nothing in it, and a reader would conclude they had
                  nothing to decide.

                  A rate limit is a THIRD state — the tracker was refused, not
                  unreachable — so `issueNote` chooses the wording: *could not be
                  read* for an outage, *rate limit is spent, returns in ~N* for a
                  spent budget, which does not claim a check that never ran. */}
              {key === 'waiting-on-you' && fleet.issueAnswer === 'failed' && issueNote(fleet) && (
                <li
                  role="row"
                  data-issue-error
                  className="border-t border-slate-100 px-3 py-2 text-sm text-amber-700 dark:border-slate-800 dark:text-amber-500"
                >
                  <span role="gridcell">
                    {issueNote(fleet)}
                  </span>
                </li>
              )}
            </ul>
            )}
          </section>
        );
      }); })()}
      </div>

      {/* The ages are the honesty: a stale source says so rather than looking
          live. They are reported separately because they fail separately —
          "git 3s ago, PR data 4 min ago" is a different situation from both
          being fresh, and the reader is the one who has to know which.

          Each age now carries a countdown beside it, because the two readings
          answer different questions and the pair is the point: how old is this,
          and when does it change. */}
      <p className="px-3 text-xs text-slate-400 dark:text-slate-600">
        {/* Counted from the ROWS, not from `summary`: the pulse summarises the
            branches plans name, and the list also shows open PRs no plan
            claims. Reading the summary here said "8 branches across 3 plans"
            under twelve visible rows. */}
        {fleet.rows.length} branches across{' '}
        {new Set(fleet.rows.map((r) => r.plan).filter(Boolean)).size} plans
        {/* THE COUNT IS OF WHAT ARRIVED, and while the scan is still running
            that is not the same as the count of what there is. The scan takes
            18 s on 84 branches against a 5 s cadence, so this window is most of
            the time — and "8 branches across 3 plans" stated flatly during it
            is a measurement of the scan's progress wearing the shape of a
            measurement of the fleet.

            The rows themselves are NOT qualified: each one is fully derived
            from its plan and its refs, and is exactly as true now as it will be
            when the scan ends. Only the TOTAL is provisional, so only the total
            says so. */}
        {!fleet.complete && ' so far'} · scanned{' '}
        {/* `tick` stops while stale, so this age freezes rather than ageing
            against a scan that is not happening — the defect itself, since an
            age that keeps climbing is the most confident-looking part of a dead
            page. The word says so too: a number that has stopped moving is
            indistinguishable from a slow one until it is labelled. */}
        {fleet.ageSeconds + tick}s ago{stale && ' (frozen)'}
        {gitNext !== null && ` · next in ${gitNext}s`}
        {fleet.prAgeSeconds !== null && ` · PR data ${fleet.prAgeSeconds + tick}s ago`}
        {fleet.prAgeSeconds !== null && prNext !== null && ` · next in ${prNext}s`}
        {fleet.prAgeSeconds === null && !fleet.prError && ' · no PR data yet'}
      </p>
      {/* This IS the view-status line, and it stays here: it answers *how fresh
          is what I see?* and it is always true, so it belongs at the foot where
          the eye lands after the rows rather than in the StatusPanel, whose
          contract is to VANISH when there is nothing to say. The PR-failure note
          that once trailed it moved UP into that panel — a reader was meeting
          the incomplete rows before the sentence saying they were incomplete,
          and `prNote` still chooses its wording (a spent rate limit says so,
          an outage keeps the plain sentence). */}
    </div>
  );
}
