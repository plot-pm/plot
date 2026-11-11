import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AgentRow,
  type Fleet,
  type FleetSprint,
  type Slice,
  UNNAMED_SLICE,
  isOneSlicePlan,
  FLEET_CONTROLS_DEFAULT,
  isLiveState,
} from '../../contract/schema.js';

/**
 * A fleet's controls, or the declared default where the payload carries none.
 *
 * THE CLIENT CASTS THE FLEET, it does not parse it — so the schema's
 * `.default()` never runs here and `fleet.fleetControls` is genuinely
 * `undefined` on any payload written before the field existed (a stubbed
 * fixture, a board mid-upgrade, a cached response). Reading through it threw
 * and took the whole Delivery tab down with it.
 *
 * `absent is not false`: an absent control block is *unknown*, and the safe
 * reading of unknown here is the same one the schema declares — a fleet that
 * dispatches nothing.
 */
function fleetControlsOf(fleet: Fleet): { autoDispatch: boolean; parallelAgents: number; working?: number } {
  return fleet.fleetControls ?? FLEET_CONTROLS_DEFAULT;
}
import { AutoDispatchSwitch, ParallelAgentsStepper, WorkingCounts, FleetAlert } from './FleetControls.js';
import { StatusPanel, type BoardStatus } from './StatusPanel.js';
import { defaultBranchStatus } from '@plot-pm/domain/rules/default-branch';
import { checkoutHealthStatus } from '@plot-pm/domain/rules/checkout-health';
import {
  bundleDriftDetected,
  bundleDriftEntry,
  spawnerStatus,
  spawnerStatusEntry,
} from '@plot-pm/domain/rules/spawn-contract';
import { agentRowKey } from '@plot-pm/domain/rules/desk-manifest';
import { DeliveryFilters } from './DeliveryFilters.js';
import { activeSprintButton, readList, sprintMembershipLookup, writeList } from '../lib/filters.js';
import {
  rowInSprintSelection,
  rowIsSprintExempt,
  sanitizeSelection,
  showsSprintSlug,
  slugPassesSprintFilter,
} from '@plot-pm/domain/rules/sprint-selection';
import { chipReadings } from '../lib/agent-rows/chip-readings.js';
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
import {
  readMineOnly,
  readMineStrict,
  agentsForReader,
  readerFrom,
  rowsForReader,
  draftsForReader,
  ticketsForReader,
  writeMineOnly,
  writeMineStrict,
} from '../lib/agent-rows/mine-filter.js';
import { mineMode, planIndexOf } from '@plot-pm/domain';
import { ActivityEcho, ChangeMarks, type WatchedState, activeRowKeys, changedRows, groupPace } from '../lib/agent-rows/activity.js';
import { ActivityMark } from '../lib/agent-rows/marks.js';
import { planWaitingDays, sliceKeyOf } from '../lib/agent-rows/sections.js';
import { deliveryMapping, sprintReleases } from '../lib/agent-rows/delivery-readings.js';
import {
  machineLine,
  placeMapping,
  planBlockShown,
  planBlockToggleKey,
  reasonWords,
  type BlockView,
  type PlacedAgentView,
  type PlacedItemView,
  type PlanBlockView,
  type SliceBlockView,
} from '../lib/agent-rows/delivery-view.js';
import { shrinkNote } from '../lib/agent-rows/actions.js';
import { hostAnswer, issueNote, prStatusEntry, scanHostNote } from '../lib/agent-rows/host-notes.js';
import { rowKey } from '../lib/agent-rows/row-identity.js';
// THE ROW ESTATE, in three modules beside this one. `AgentList` is the shell:
// it reads the fleet, decides the sections, and mounts the rows — the rows,
// their marks and their menus are declared next door.
import { waitingView } from '../lib/agent-rows/waiting-view.js';
import { HeaderRow, IssueRowView, PlanRow, Row, RegistryRow, SliceRow, type AgentListProps } from '../lib/agent-rows/rows.js';
import { workingAgentRows, draftPlanRows } from '../lib/agent-rows/working-agents.js';
import { DraftPlanRowView } from '../lib/agent-rows/draft-plan-row.js';
import { PlanLevelRowView, planFileFromFleet, verificationRows } from '../lib/agent-rows/plan-level-row.js';
import { specRows } from '../lib/agent-rows/spec-row.js';
// RE-EXPORTED, not redefined — the same allowance `splitBranch` above is given.
// These moved out of this file when the row estate was split into three
// modules; the unit suite and `App.tsx` import them from here, and a second
// definition is exactly the drift the split removed.
export { menuState, noActionReason, offersOpen, openLabel, openTarget, runLinkLabel, showsWorkerLog, storyRefusal } from '../lib/agent-rows/menus.js';
export { inferredPlanName, isReleaseBranch, isUnpushed, rowSubject, startableNote } from '../lib/agent-rows/rows.js';
export type { AgentListProps };

/**
 * The pid `spawnerStatus` is called with from this component, for both its
 * `identity.pid` and `runningPid` arguments. The wire payload's
 * `spawnContract` is this board's own live reading of itself, not a record
 * read off disk, so there is no stale-process case to distinguish here — the
 * match is certain by construction. This constant exists only to satisfy
 * `spawnerStatus`'s shared signature from a call site that has no real pid to
 * compare.
 */
const WIRE_IDENTITY_PID = 1;


/**
 * Find the sole slice for a plan, if the plan has exactly one slice.
 *
 * Returns the slice object when `planSliceCount === 1`, null otherwise.
 * Used to decide whether a plan row should carry the slice's status —
 * which it does when the slice adds no information beyond what the plan
 * row already says.
 *
 * Looks up by the plan's DISPLAY name (the basename with date stripped),
 * matching what `deriveSlices` writes into `Slice.plan`.
 */
export function soleSliceFor(planName: string, slices: Slice[] | undefined): Slice | null {
  if (!slices) return null;
  // A plan may have multiple slices. Find ANY slice for this plan and check
  // its planSliceCount — every slice of a plan shares the same count.
  const w = slices.find((wave) => wave.plan === planName);
  return w && isOneSlicePlan(w) ? w : null;
}

/**
 * Are a `planHeads` plan group's slice rows on the page?
 *
 * ONE EXPRESSION, THREE READERS, and they MUST agree or the board contradicts
 * itself: the plan row's caret says one thing, the content another, and the plan
 * row's verdict duplicates a row it believes is hidden. Two readers were already
 * required to agree by a comment; the verdict made a third, and three copies of
 * a four-term boolean is where drift starts.
 *
 * A FOLD WITH EXCEPTIONS STAYS OPEN — *folding may hide repetition, never
 * exceptions* — so `hasExceptions` wins over the reader's override. The override
 * itself is keyed two ways because the DEFAULT differs: a plan of several slices
 * is folded until opened (`open:`), a plan of one is open until shut (`shut:`),
 * so one Set holds overrides rather than states.
 *
 * @param planHeads Whether this section draws plan heads at all. Where it does
 *   not, the rows are never folded and this is trivially true.
 */

/**
 * What the server writes where a plan divides its work into no slices at all.
 *
 * `sliceLabel` declines to print it, and this is why the string is named rather
 * than inlined: it is a value the SERVER writes (`wave.name || '(unnamed)'`),
 * so the client is matching a protocol constant and not a display choice.
 */
// The ONE definition lives in the contract — the server writes this value and
// both clients test for it. Imported for local use and re-exported, because
// modules already import it from here.
export { UNNAMED_SLICE };




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
  planFileForSlug,
  cards,
  dispatch,
  approve,
  reslice,
  deliver,
  implement,
  drop,
  continueWith,
  restartWith,
  idea,
  story,
  ticketFacts,
  pulse = 0,
  onStarting,
  onRevealBranch,
  highlightBranch = '',
  server,
  defaultBranch,
  checkoutClean,
  spawnContract,
}: AgentListProps) {
  // THE BOARD'S PLAN INDEX — every card and draft plan, keyed by file
  // basename and by slug, built once here and threaded to every row builder
  // that names a plan. `cards` is the board's own Planning cards; drafts and
  // the fleet plan index come from the fleet payload `AgentList` already
  // reads — `fleetPlans` is what lets the index resolve while `/api/board` is
  // slow or `null`, so the Delivery tab's prefix does not wait on it.
  const planIndex = useMemo(
    () => planIndexOf({ cards: cards ?? [], drafts: fleet?.draftPlans ?? [], fleetPlans: fleet?.plans ?? {} }),
    [cards, fleet?.draftPlans, fleet?.plans],
  );
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
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed());
  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeCollapsed(next);
      return next;
    });
  };
  // A blocker mark opens the fold its blocker sits behind: a delivered slice
  // shows under Release delivery, folded by default.
  const expandSection = (section: string) => {
    if (section !== 'done') return;
    setCollapsed((prev) => {
      if (!prev.has('release-delivery')) return prev;
      const next = new Set(prev);
      next.delete('release-delivery');
      writeCollapsed(next);
      return next;
    });
  };

  // Whether the reader asked to see only their own work.
  //
  // Seeded from `localStorage` in the initializer rather than in an effect, for
  // the reason the fold above is: an effect paints the unfiltered view and then
  // removes rows from under the cursor, on a board reloaded several times an
  // hour.
  //
  // OFF unless the reader turned it on — see `MINE_ONLY_BY_DEFAULT`. The
  // identity it filters against is the BOARD's, which arrives on a separate
  // fetch, so an unknown reader hides nothing rather than emptying the view.
  const [mineOnly, setMineOnly] = useState<boolean>(() => readMineOnly());
  // THE STRICTER "HIDE UNKNOWN TOO" CONTROL, parallel to `mineOnly` above and
  // read/written the same way.
  const [mineStrict, setMineStrict] = useState<boolean>(() => readMineStrict());
  // THE *SHOW EVERY TICKET* CONTROL — client state only, off on every load.
  const [showEveryTicket, setShowEveryTicket] = useState<boolean>(false);
  const toggleMineOnly = () => {
    setMineOnly((prev) => {
      const next = !prev;
      writeMineOnly(next);
      return next;
    });
  };
  const toggleMineStrict = () => {
    setMineStrict((prev) => {
      const next = !prev;
      writeMineStrict(next);
      return next;
    });
  };


  // A PLAN HEAD'S FOLD OVERRIDES, keyed `open:<block>` and `shut:<block>` —
  // see `planBlockShown`. Not persisted: opening one plan's slices is a
  // momentary question, and a board reloaded several times an hour must not
  // restore it.
  const [openPlans, setOpenPlans] = useState<Set<string>>(() => new Set());
  const togglePlan = (key: string) => {
    setOpenPlans((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // A MULTI-BRANCH SLICE'S FOLD, keyed `plan\0slice` (`sliceKeyOf`). Folded by
  // default and not persisted, for the reason the plan fold is not.
  const [openSlices, setOpenSlices] = useState<Set<string>>(() => new Set());
  const toggleSlice = (plan: string, wave: string) => {
    setOpenSlices((prev) => {
      const key = sliceKeyOf(plan, wave);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
  // WHO IS READING, for the "only my work" filter. Derived from the board's
  // identity fields and its `People` directory, and nothing else — the row's
  // branch name is never consulted.
  const reader = useMemo(() => readerFrom(server), [server]);
  // THE EFFECTIVE «MINE» MODE — the single value every filter below reads,
  // never the raw `mineOnly`/`mineStrict` flags. Gated on `comparableLogin`
  // inside `mineMode` itself, so a disabled chip and an emptied board can never
  // disagree.
  const mode = mineMode(reader, { mineOnly: mineOnly ? '1' : '0', strict: mineStrict ? '1' : '0' });
  // THE AGENTS THIS READER ASKED FOR, through the agent arm of the ownership
  // rule. That arm answers `mine` or `unknown` (or, under the strict mode,
  // keeps only `mine`) — a worker stays a fact about the fleet otherwise. The
  // call is what lets the rule, rather than this component, decide that.
  const ownAgents = agentsForReader(fleet?.agents ?? [], reader, mode);
  const workingRows = workingAgentRows(ownAgents, rowByBranch);
  // THE FLEET'S OWN VERIFY RUNS — a run ON A PLAN, not on a branch. `halted`,
  // `running` and `rows` come from `.plot/state/auto-verify-in-flight.json` as
  // the daemon last wrote it; `null` (the file unreadable) answers no rows and
  // no banner at all, by `verificationRows`'s own rule.
  const { working: verifyWorkingRows, waiting: verifyWaitingRows, haltedLine } =
    verificationRows(fleet?.verification ?? null);
  // THE FLEET'S OWN SPEC RUNS — the same shape as the verify runs above, read
  // from `.plot/state/auto-design-in-flight.json` via `fleet.design`. A verify
  // halt and a design halt are two independent facts, so `specHaltedLine`
  // stays its own nullable string rather than folding into `haltedLine`.
  const { working: specWorkingRows, waiting: specWaitingRows, haltedLine: specHaltedLine } =
    specRows(fleet?.design ?? null);
  // BOTH FLEETS' PLAN-LEVEL ROWS, COMBINED — `sectionCount`'s `planLevel`
  // bucket is one number pair for every plan-level row regardless of kind, so
  // the production step is concatenation, not a second bucket or a second
  // render path. `PlanLevelRowView` already switches on `row.kind`.
  const workingPlanRows = [...verifyWorkingRows, ...specWorkingRows];
  const verificationWaitingRows = [...verifyWaitingRows, ...specWaitingRows];
  // THE PLAN FILE of a plan-level row: the payload names only the slug, so the
  // file is read from the fleet's own rows (`planFileFromFleet`), which exist
  // before the board loads, and then from the board card with that slug
  // (`planFileForSlug`). "" where neither holds it, which `PlanLevelRowView`
  // renders as the slug with no link.
  const planFileOf = (slug: string): string =>
    planFileFromFleet(slug, fleet?.rows ?? [], fleet?.draftPlans ?? []) || (planFileForSlug?.(slug) ?? '');


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
  // NOT PERSISTED IN localStorage: this is a momentary focus (what am I
  // working on right now) rather than a standing preference.
  //
  // SYNCED TO THE URL, under its OWN parameter — `deliverySprint`, not the
  // Planning tab's `sprint` (`App.tsx:284`/`:1040`). The two tabs read
  // different membership (this one joins on `fleet.sprints`, the Planning tab
  // on `board.sprints`) and a reader narrowing one tab's view has given no
  // sign they want the other tab's view to move with it — sharing the
  // parameter would make that coupling accidental rather than argued. Read
  // once at mount (`readList`); every change writes back through `writeList`,
  // the same pair the Planning tab already uses (`lib/filters.ts`).
  const DELIVERY_SPRINT_PARAM = 'deliverySprint';
  const [sprintFilter, setSprintFilter] = useState<Set<string>>(
    () => new Set(readList(DELIVERY_SPRINT_PARAM)),
  );
  // THE ONE SETTER EVERY CHIP CLICK GOES THROUGH — the per-sprint chips and
  // the «This sprint» chip alike — so the stored `Set` and the URL can never
  // drift apart by one of two code paths forgetting to write one of them.
  const setSelection = (slugs: string[]) => {
    const next = new Set(slugs);
    setSprintFilter(next);
    writeList(DELIVERY_SPRINT_PARAM, [...next]);
  };
  // SELECT EVERY ACTIVE SPRINT, or none — the «This sprint» chip's meaning
  // while it acts alone (one Active sprint) or as an all-or-nothing toggle
  // (several Active sprints, Decision "Sprint line as control or chip row").
  const selectAllSprints = (slugs: string[]) => setSelection(slugs);
  // TOGGLE ONE SPRINT IN THE SELECTION — a per-sprint chip's whole vocabulary.
  // Goes through `setSelection` like every other setter here, so a per-sprint
  // click and the «This sprint» click cannot leave the URL and the `Set`
  // disagreeing about which sprints are selected.
  const toggleSprintSlug = (slug: string) => {
    const next = new Set(sprintFilter);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setSelection([...next]);
  };

  // The fleet's active sprints, guarded for payloads predating the field.
  // Zod's `.default([])` only fires at PARSE time; the client CASTS, so
  // `fleet.sprints` is `undefined` on an older server's payload.
  const activeSprints: FleetSprint[] = fleet.sprints ?? [];
  const sprintSelectAll = useMemo(() => activeSprintButton(activeSprints), [activeSprints]);

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
  // TWO KINDS OF ROW PASS WITHOUT A MEMBERSHIP TEST — `rowIsSprintExempt`:
  //   - `kind: 'release'` — the release row (changeset-release/main)
  //   - `kind: 'pr'` AND `row.plan === ''` — an open PR no plan names
  // This is NOT "every row with no plan": a plan-less row of any other kind (a
  // loose `branch` with no open PR) reaches `slugPassesSprintFilter('')` and is
  // hidden. An `idea/*` row is kind `plan` and carries its draft's slug, so it
  // is asked about membership like any plan.
  // The old filter `r.sprint === ''` admitted 53 plan rows (slices/branches
  // whose sprint field was empty) alongside the 2 genuine plan-less rows.
  //
  // Applied BEFORE `rowsBySection`: the filter is about WHICH plans a reader
  // wants to see, and the sections are about WHERE those rows belong. Filtering
  // after sectioning would have the same effect but re-filter per section.
  // THE SELECTION THAT STILL FILTERS — #1145. The stored `Set` holds whatever
  // the reader has ever checked; `activeSprints` holds the sprints that exist
  // now. A sprint that closes leaves the second and stays in the first, and the
  // filter then asks `membership` about a slug it has no entry for, which fails
  // EVERY plan row — the closed sprint's own members included, because the
  // membership map is built from active sprints only.
  //
  // So the filter reads a DERIVATION rather than the stored `Set`, with the rule
  // the Planning tab already applies to its URL selection (`App.tsx:937`): keep the
  // selected values that are still options, and let an all-stale selection
  // collapse to no filter. No new rule, and the control and the filter can no
  // longer answer from two different sprint sets.
  //
  // DERIVED, NOT ONLY PRUNED. The effect below runs after the render that read
  // the new `activeSprints`, so a frame would filter on a dropped slug if the
  // derivation were not here too.
  const selectedSprints = useMemo(
    () => sanitizeSelection([...sprintFilter], activeSprints.map((s) => ({ value: s.slug, label: s.title }))),
    [sprintFilter, activeSprints],
  );
  // Is any sprint selected? Asked of the DERIVED list at every site below: a
  // `sprintFilter.size` read would turn the filter on for a slug that no longer
  // filters anything, which is the defect wearing a different number.
  const sprintFilterOn = selectedSprints.length > 0;
  // Should a row name its own sprint? Only while more than one is Active and
  // the selection does not already single one out — see `showsSprintSlug`.
  const showSprintSlug = showsSprintSlug(activeSprints.length, selectedSprints);

  // THE «This sprint» CHIP'S OWN CLICK keeps its pre-subset meaning — off
  // means every Active sprint, on means none — while a per-sprint chip
  // (`toggleSprintSlug`) sets a true subset. Both go through `setSelection`,
  // so the stored `Set` and the URL cannot drift between the two paths.
  const toggleThisSprintChip = () => selectAllSprints(sprintFilterOn ? [] : sprintSelectAll.selection);

  // PRUNE THE STORED SELECTION, so a dropped sprint cannot come back. A branch
  // switch to a tree where the closed sprint is still Active returns it to
  // `fleet.sprints` (`workingTreeSprints` reads the checked-out tree), and a
  // slug kept in the `Set` would filter again with its box checked — a selection
  // this reader never made in this view.
  //
  // ONLY WHEN THE LIST IS NON-EMPTY. `workingTreeSprints` answers `[]` when the
  // sprint directory is missing or unreadable, which a checkout or a
  // fast-forward can cause for one poll. Pruning on that answer would delete a
  // live selection the next poll cannot restore. While the list is empty the
  // derived selection is empty anyway, so the filter is off for that poll and
  // comes back unchanged on the next one.
  useEffect(() => {
    if (activeSprints.length === 0) return;
    // THROUGH `setSelection`, not the raw `setSprintFilter` — a prune that
    // skipped it would update the in-memory `Set` and leave a stale slug on
    // screen in the URL, the exact drift `setSelection` exists to prevent.
    if (selectedSprints.length < sprintFilter.size) setSelection(selectedSprints);
  }, [activeSprints, selectedSprints]);
  const filteredRows = !sprintFilterOn
    ? fleet.rows
    : fleet.rows.filter((r) => rowInSprintSelection(r, selectedSprints, membership));

  // THE CHIP ROW'S READINGS — `chipRow()` (`@plot-pm/domain`) decides every
  // chip's label, on/off, hidden count and disabled reason from these;
  // `chipReadings` only gathers them. Every sprint chip, «This sprint» and
  // each per-sprint chip, reads `fleet.rows` before the sprint filter against
  // the CURRENT selection, so a chip that is on reports the rows the screen
  // hides. The `Mine` chip reads `filteredRows`: after the sprint filter,
  // before its own effect.
  const chipRowReadings = chipReadings({
    rows: fleet.rows,
    sprintFilteredRows: filteredRows,
    agents: fleet?.agents ?? [],
    activeSprints,
    selectedSprints,
    membership,
    reader,
    mode,
  });

  // THE FILTERED ISSUES. Like rows, issues stay visible when no filter applies.
  // Issue rows have no sprint field, so they always pass the sprint filter.
  //
  // `fleet.waiting.tickets` IS *WAITING ON YOU*'S OWN ROW SET — the domain's
  // `waitingTickets` already applied its stricter default (hide and count an
  // unassigned ticket) server-side. `ticketsForReader` is the separate, looser
  // *Only my work* toggle on top of that: it hides a ticket only where it is
  // someone else's, same as `rowsForReader` does for branch rows, and keeps an
  // unassigned ticket or one whose source is unresolved. `fleet.waiting.source`
  // is the wire form of the domain's `TicketSource`, resolved once server-side
  // so this call needs no second host read. `fleet.issues` stays the fallback
  // for an older server with no `waiting` field.
  const waitingBlock = waitingView(fleet.waiting, fleet.issues, showEveryTicket, (tickets) =>
    ticketsForReader(tickets, reader, fleet.waiting?.source ?? null, mode),
  );
  const filteredIssues = waitingBlock.tickets;

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
    if (!sprintFilterOn) return 0;
    return workingRows.filter(({ row }) => {
      // No plan → not hidden (would pass any filter)
      if (!row?.plan) return false;
      // Check if this plan FAILS the sprint filter
      return !slugPassesSprintFilter(row.plan, selectedSprints, membership);
    }).length;
  }, [workingRows, sprintFilterOn, selectedSprints, membership]);

  // HOW MANY AGENTS THE REGISTRY HOLDS THAT ARE NOT WORKING — the figure the
  // section's own tally cannot give, and the only one of the two worth a word.
  //
  // WHY NOT `N running`. The section renders `workingRows`, which
  // `workingAgentRows` has ALREADY filtered to `isLiveState`, so the tally IS
  // the live count: printing `WORKING (3) · 3 running` states one number twice,
  // which is the `3 manifests, 3 agents` failure this slice exists to remove,
  // one figure along. The number that disagrees with the tally is the
  // REGISTRY's, which holds every entry regardless of state — the finished
  // desks, the stalled ones, the ones whose worker exited.
  //
  // So the header says how many entries the section is NOT showing. Measured
  // 2026-09-07 and quoted at `fleet.ts:2674`: six spent workers ran 23-25 hours
  // against an 8-hour bound. Those six render in WAITING ON YOU as problem
  // reports; what WORKING's header adds is that the fleet is holding them at
  // all, which is the fact an operator reading the cap needs.
  //
  // `isLiveState` rather than a literal pair, so the enum and this filter cannot
  // drift — it is the denylist reading, which means an unrecognised tenth state
  // counts as live. That is the safe direction: a state this board does not know
  // is a worker it cannot rule out, so it is never reported as idle.
  const agentsNotWorking = useMemo(
    () => (fleet?.agents ?? []).filter((agent) => !isLiveState(agent.state)).length,
    [fleet?.agents],
  );

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
  // `prStatusEntry` owns the WORDING and the LEVEL — the domain's `prStatus`
  // classifies (bug/the-pr-status-has-a-level-and-a-cause), and this reads the
  // decision rather than re-deriving it. Null exactly when the level is
  // `info`, the absent-when-healthy contract this panel states for every
  // entry.
  const prEntry = prStatusEntry(fleet);
  if (prEntry) statuses.push(prEntry);
  // THE SCAN'S OWN HOST, beside the board's — the same category of fact one
  // level up, so it takes the same treatment rather than a second visual
  // language for *we do not know*. `scanHostNote` owns the wording (a spent
  // budget says so and says to wait; an unreachable host says to look); the
  // panel owns the frame and the placement, exactly as with `prStatusEntry`.
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
  // THE REPOSITORY'S OWN HEALTH, not the board's — a fact fleetd already wrote
  // to `.plot/state/default-branch.json`. `defaultBranchStatus` returns null
  // for everything but a settled red, so an absent or healthy reading pushes
  // nothing here.
  const defaultBranchEntry = defaultBranchStatus(defaultBranch ?? null);
  if (defaultBranchEntry) statuses.push(defaultBranchEntry);
  // THE BOARD'S OWN CHECKOUT, not the repository's CI — #2311 (docs/plans/
  // 2026-10-21-fleet-work-leaves-the-main-checkout.md). `checkoutHealthStatus`
  // returns null for a clean or unreadable checkout; a behind checkout is
  // shown by `PlanSourceLine`, not here.
  const checkoutEntry = checkoutHealthStatus(checkoutClean ?? null);
  if (checkoutEntry) statuses.push(checkoutEntry);
  // THE BOARD'S OWN SPAWN CONTRACT against the gate's — #2728
  // (docs/plans/2026-10-26-a-board-or-fleetd-older-than.md). `spawnerStatus`'s
  // pid argument exists to catch a record describing a process that already
  // exited; the wire payload instead carries THIS board's own live reading of
  // itself, so there is no stale record to distrust and the identity match is
  // certain by construction. `WIRE_IDENTITY_PID` is a fixed, matching pair
  // used only to satisfy that shared signature from this call site. Two
  // independent entries, never folded into one: `spawnerStatusEntry` is the
  // stale/current/unknown verdict, `bundleDriftEntry` is evidence a rebuild
  // happened and says nothing about staleness by itself.
  const spawnVerdict = spawnerStatus(
    spawnContract ? { pid: WIRE_IDENTITY_PID, spawnContract: spawnContract.spawnContract } : null,
    WIRE_IDENTITY_PID,
    spawnContract?.gateNumber ?? null,
  );
  const spawnEntry = spawnerStatusEntry(spawnVerdict);
  if (spawnEntry) statuses.push(spawnEntry);
  const driftEntry = spawnContract
    ? bundleDriftEntry(
        bundleDriftDetected(spawnContract.bundleHash, spawnContract.runningBundleHash),
        spawnContract.bundlePath,
      )
    : null;
  if (driftEntry) statuses.push(driftEntry);

  return (
    <div className="space-y-4">
      {/* The board-status panel — one box carrying every status above, the
          view-status line stays at the foot. See `StatusPanel`. */}
      <StatusPanel statuses={statuses} />

      {/* THE DELIVERY FILTERS — one row of toggle chips (`This sprint`,
          `Mine (<identity>)`, `Waiting on me`), each sprint's own line, and the
          estate totals at the row's right end. Replaces the sprint card and
          the `Only my work` checkbox — two cards and three control styles,
          per issue #2080 — with one row every chip shares. Placed before the
          sections so it is above the list.

          Every chip's label/on/hiddenCount/disabledReason is `chipRow()`'s
          answer (`@plot-pm/domain`); `chipRowReadings` above builds what it
          reads and this only renders what it returns. */}
      <DeliveryFilters
        readings={chipRowReadings}
        onToggleSprint={toggleThisSprintChip}
        onToggleMine={toggleMineOnly}
        onToggleStrict={toggleMineStrict}
        sprints={activeSprints}
        selectedSprints={selectedSprints}
        onToggleSprintSlug={toggleSprintSlug}
        mineBoardAnswered={server !== undefined}
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
      {(() => {
        // THE RULE DECIDES; THIS BLOCK RENDERS. `placeDelivery` placed every
        // work item and every agent once; `deliveryView` orders that answer by
        // `DELIVERY_LAYOUT`. Nothing below computes a section, a group, a link
        // target or a reason.
        const mapping = deliveryMapping({
          rows: rowsForReader(filteredRows, reader, mode),
          slices: fleet.slices ?? [],
          agents: ownAgents,
          drafts: draftsForReader(draftPlanRows(fleet.draftPlans ?? [], fleet.rows ?? []), reader, mode),
          reader,
          mode,
          config: { autoReview: fleet.autoReview, correctionBudget: fleet.correctionBudget },
          tickets: fleet.issueAnswer === 'answered' ? fleet.waiting?.tickets : null,
          ticketSource: fleet.waiting?.source ?? null,
          releases: sprintReleases(activeSprints, selectedSprints),
          sprints: (fleet.sprints ?? []).map((s) => ({ release: s.release, started: s.start ?? '' })),
          releaseTickets: fleet.releaseTickets,
        });
        const view = placeMapping(mapping, fleet.slices);
        const slices = fleet.slices;
        const issues = fleet.issueAnswer === 'answered' ? filteredIssues : [];
        // A ticket a section holds is listed there only; the block and its count lines stay while the read has any.
        const unplacedIssues = issues.filter((i) => !view.placedTickets.has(String(i.number)));
        const scrollTo = (anchor: string) => (e: { preventDefault: () => void }) => {
          e.preventDefault();
          document.getElementById(anchor)?.scrollIntoView({ block: 'center' });
        };
        const linkLine = (key: string, links: { label: string; anchor: string }[], arrow: string) =>
          links.length === 0 ? null : (
            <li key={key} role="row" data-delivery-link className="px-3 pb-1 text-xs text-slate-500 dark:text-slate-400">
              <span role="gridcell">
                {arrow}{' '}
                {links.map((l, i) => (
                  <span key={l.anchor}>
                    {i > 0 && ', '}
                    <a href={`#${l.anchor}`} onClick={scrollTo(l.anchor)} className="font-mono text-blue-600 hover:underline dark:text-blue-400">
                      {l.label}
                    </a>
                  </span>
                ))}
              </span>
            </li>
          );
        const rowProps = (r: AgentRow) => ({
          row: r,
          onOpenPlan,
          sprintExempt: sprintFilterOn && rowIsSprintExempt(r),
          card: cardForPlanFile?.(r.planFile) ?? null,
          dispatch,
          implement,
          continueWith,
          restartWith,
          pulse,
          onStarting,
          marked: marked.has(rowKey(r)),
          active: active.has(rowKey(r)),
          agent: agentByBranch.get(r.branch) ?? null,
          // A branch row names no wave: the slice row above it does.
          sliceName: null,
          onRevealBranch,
          highlighted: r.branch === highlightBranch,
          showSprintSlug,
          planIndex,
          onExpandSection: expandSection,
        });
        const anchorOf = (item: PlacedItemView) => (
          <li key={`anchor-${item.anchor}`} role="presentation" id={item.anchor} className="h-0" />
        );
        // The reason a You item sits there, and its links to the agents acting on it.
        const itemTail = (item: PlacedItemView) => [
          item.placement?.section === 'you' ? (
            <li key={`reason-${item.anchor}`} role="row" data-placement-reason={item.placement.reason} className="px-3 pb-1 text-xs text-amber-700 dark:text-amber-500">
              <span role="gridcell">{reasonWords(item.placement.reason)}</span>
            </li>
          ) : null,
          linkLine(`links-${item.anchor}`, item.links, '← agents:'),
        ];
        const itemBody = (item: PlacedItemView, inPlan = false) => [
          anchorOf(item),
          ...item.rows.map((r) => <Row key={rowKey(r)} {...rowProps(r)} inPlanGroup={inPlan} />),
          ...(item.ticket !== null
            ? [(
                <IssueRowView
                  key={`ticket-${item.ticket.number}`}
                  issue={item.ticket}
                  idea={idea ?? { available: false, reason: 'this board has not said whether it can create plans' }}
                  story={story ?? { available: false, reason: 'this board has not said whether it can create stories' }}
                  issueAnswer={fleet.issueAnswer}
                  facts={ticketFacts?.get(String(item.ticket.number))}
                  showKindLabel={false}
                  onOpenPlan={onOpenPlan}
                  planIndex={planIndex}
                />
              )]
            : []),
          ...(item.draft !== null
            ? [<DraftPlanRowView key={`draft-${item.draft.plan}`} draft={item.draft} onOpenPlan={onOpenPlan} planIndex={planIndex} />]
            : []),
          ...itemTail(item),
        ];
        const sliceBody = (block: PlanBlockView, s: SliceBlockView) => {
          const wg = s.slice;
          const start = block.mode === 'start';
          const oneSlice = start && soleSliceFor(block.plan, slices) !== null;
          const many = wg !== null && wg.rows.length > 1;
          const sliceOpen = many ? openSlices.has(sliceKeyOf(block.plan, wg.wave)) : null;
          return [
            anchorOf(s.item),
            wg === null ? null : (
              <li key={`slice-${s.item.anchor}`} className="block">
                <SliceRow
                  group={wg}
                  plan={block.plan}
                  waitingDays={planWaitingDays(block)}
                  expanded={sliceOpen}
                  onToggle={many ? () => toggleSlice(block.plan, wg.wave) : undefined}
                  active={wg.rows.some((r) => active.has(rowKey(r)))}
                  marked={wg.rows.some((r) => marked.has(rowKey(r)))}
                  card={start && !oneSlice ? (cardForPlanFile?.(block.planFile) ?? null) : null}
                  dispatch={start && !oneSlice ? dispatch : undefined}
                  reslice={reslice}
                  pulse={pulse}
                  onStarting={onStarting}
                  groupedCount={!start && many ? wg.rows.length : undefined}
                  groupedWord={!start ? wg.verdict ?? undefined : undefined}
                  soleRow={!start && !many ? wg.rows[0] : undefined}
                  implement={start ? undefined : implement}
                  continueWith={start ? undefined : continueWith}
                  restartWith={start ? undefined : restartWith}
                  onOpenPlan={start ? undefined : onOpenPlan}
                  onRevealBranch={start ? undefined : onRevealBranch}
                  planHeaded={block.headed}
                  menuCard={start ? undefined : (cardForPlanFile?.(block.planFile) ?? null)}
                  menuDispatch={start ? undefined : dispatch}
                  slices={slices}
                  onExpandSection={expandSection}
                  planIndex={planIndex}
                />
                {many && sliceOpen && (
                  <ul
                    role="presentation"
                    data-slice-branch-list={wg.wave || '(unnamed)'}
                    className="ml-6 border-l border-slate-200 dark:border-slate-800"
                  >
                    {wg.rows.map((r) => <Row key={rowKey(r)} {...rowProps(r)} inPlanGroup={block.headed} inSliceGroup />)}
                  </ul>
                )}
              </li>
            ),
            ...s.loose.map((r) => <Row key={rowKey(r)} {...rowProps(r)} inPlanGroup={block.headed} />),
            ...itemTail(s.item),
          ];
        };
        // A PLAN HEAD OVER ITS SLICES — `PlanRow`, then its slice rows nested
        // beneath. `nestItems` decided which items it holds; `planBlockShown`
        // decides whether they are on the page.
        const planBody = (block: PlanBlockView) => {
          const shown = planBlockShown(block, openPlans);
          const group = { plan: block.plan, planFile: block.planFile, rows: block.rows };
          return (
            <li
              role="rowgroup"
              key={block.key}
              data-plan-group={block.plan}
              className="block rounded-sm bg-slate-50/60 outline outline-slate-300 -outline-offset-1 dark:bg-slate-900/30 dark:outline-slate-700"
            >
              {block.head !== null && <span id={block.head.anchor} className="block h-0" />}
              {shown === false && block.slices.map((s) => <span key={s.item.anchor} id={s.item.anchor} className="block h-0" />)}
              {shown === false && block.loose.map((item) => <span key={item.anchor} id={item.anchor} className="block h-0" />)}
              <PlanRow
                group={group}
                slices={fleet.slices}
                onOpenPlan={onOpenPlan}
                ageMinutes={block.mode === 'progress' ? block.ageMinutes : undefined}
                expanded={shown}
                onToggle={shown === null ? undefined : () => togglePlan(planBlockToggleKey(block))}
                active={block.rows.some((r) => active.has(rowKey(r)))}
                marked={block.rows.some((r) => marked.has(rowKey(r)))}
                card={cardForPlanFile?.(block.planFile) ?? null}
                approve={approve}
                deliver={deliver}
                implement={implement}
                dispatch={dispatch}
                pulse={pulse}
                onApproving={onStarting}
                elsewhere={block.elsewhere}
                soleSlice={soleSliceFor(block.plan, slices)}
                onStarting={onStarting}
                planIndex={planIndex}
              />
              {block.head !== null && (
                <ul role="presentation">{itemTail(block.head)}</ul>
              )}
              {shown !== false && (
                <ul
                  role="presentation"
                  data-slice-list={block.plan}
                  className="ml-6 border-l border-slate-200 dark:border-slate-800"
                >
                  {block.slices.flatMap((s) => sliceBody(block, s))}
                  {block.loose.flatMap((item) => itemBody(item, true))}
                </ul>
              )}
            </li>
          );
        };
        const blockBody = (block: BlockView) => {
          if (block.kind !== 'plan') return itemBody(block.item);
          if (block.headed) return [planBody(block)];
          return [
            <li role="presentation" key={block.key} data-slice-list={block.plan} className="block">
              <ul role="presentation">{block.slices.flatMap((s) => sliceBody(block, s))}</ul>
            </li>,
            ...block.loose.flatMap((item) => itemBody(item)),
          ];
        };
        const agentBody = (agent: PlacedAgentView) => [
          <li key={`anchor-${agent.anchor}`} role="presentation" id={agent.anchor} className="h-0" />,
          agent.entry !== null ? (
            <RegistryRow
              key={agentRowKey(agent.entry)}
              agent={agent.entry}
              row={agent.row}
              slices={slices}
              onOpenPlan={onOpenPlan}
              card={agent.row ? cardForPlanFile?.(agent.row.planFile) ?? null : null}
              dispatch={dispatch}
              implement={implement}
              continueWith={continueWith}
              restartWith={restartWith}
              drop={drop}
              pulse={pulse}
              onStarting={onStarting}
              marked={agent.row ? marked.has(rowKey(agent.row)) : false}
              active={agent.row ? active.has(rowKey(agent.row)) : false}
              onRevealBranch={onRevealBranch}
              highlighted={agent.entry.branch !== '' && agent.entry.branch === highlightBranch}
              planIndex={planIndex}
            />
          ) : null,
          linkLine(`links-${agent.anchor}`, agent.links, '→ acts on:'),
        ];
        const fold = (key: string, count: number, heading: React.ReactNode) => {
          const foldable = isCollapsible(count);
          const folded = foldable && collapsed.has(key);
          return { folded, header: (
            <div className="flex items-center gap-2">
              {foldable && (
                <button
                  type="button"
                  data-group-toggle={key}
                  aria-expanded={!folded}
                  aria-label={`${folded ? 'Expand' : 'Collapse'} ${key}`}
                  onClick={() => toggle(key)}
                  className="-my-1 flex min-w-[24px] items-center justify-center py-1 text-slate-500"
                >
                  <span
                    aria-hidden
                    className={`inline-block w-4 text-center text-base leading-none transition-transform ${folded ? '' : 'rotate-90'}`}
                  >
                    ▸
                  </span>
                </button>
              )}
              {heading}
            </div>
          ) };
        };
        return (
          <>
            {view.sections.map((section) => {
              // THE HEADING CARRIES THE PACE OF THE ROWS BEHIND IT, folded or
              // open, read from the same `active` set the rows render from.
              const release = section.key === 'release-delivery';
              const sectionPace = groupPace(release ? view.deliveredRows : section.rows, active);
              const { folded, header } = fold(section.key, release ? view.deliveredBlocks.length : section.count, (
                <h2 data-delivery-section={section.key} className="flex items-baseline gap-1 text-base font-semibold text-slate-800 dark:text-slate-100">
                  <span aria-hidden="true">{section.icon}</span> {section.label}
                  {section.groups.length > 0 && <span className="ml-1 font-normal text-slate-500">({section.count})</span>}
                  {release && <span className="ml-1 font-normal text-slate-500">({view.deliveredBlocks.length})</span>}
                  {sectionPace && <ActivityMark pace={sectionPace} place="heading" />}
                </h2>
              ));
              return (
                <section key={section.key} data-section={section.key} className="space-y-2">
                  {header}
                  {section.key === 'release-delivery' && view.releaseLines.map((line) => (
                    <p key={line} data-release-line className="px-3 text-sm text-slate-600 dark:text-slate-300">{line}</p>
                  ))}
                  {release && !folded && view.deliveredBlocks.length > 0 && (
                    <ul
                      role="grid"
                      aria-label="Release delivery — agent branches"
                      data-delivered
                      className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40"
                    >
                      <HeaderRow />
                      {view.deliveredBlocks.flatMap(blockBody)}
                    </ul>
                  )}
                  {section.key === 'fleet' && (
                    <div className="flex flex-wrap items-center gap-2 px-3">
                      <WorkingCounts
                        notWorking={agentsNotWorking}
                        hiddenByFilter={workersHiddenByFilter}
                        registry={fleet?.registry}
                      />
                      <span data-fleet-control-column className="ml-auto flex items-center gap-3">
                        <AutoDispatchSwitch value={fleetControlsOf(fleet).autoDispatch} />
                        <ParallelAgentsStepper value={fleetControlsOf(fleet).parallelAgents} />
                      </span>
                      <FleetAlert supervisor={fleet?.supervisor} />
                    </div>
                  )}
                  {section.key === 'machine' && (
                    <p data-machine-line className="px-3 text-sm text-slate-600 dark:text-slate-300">{machineLine(fleet.rows, hostAnswer(fleet))}</p>
                  )}
                  {!folded && section.groups.map((group) => {
                    const groupMark = groupPace(group.rows, active);
                    const g = fold(group.key, group.count, (
                      <h3 data-delivery-group={group.key} className="flex items-baseline gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                        {group.label}
                        <span className="ml-1 font-normal text-slate-500">
                          ({group.count > 0 ? group.tally : group.hint})
                        </span>
                        {groupMark && <ActivityMark pace={groupMark} place="heading" />}
                      </h3>
                    ));
                    return (
                      <div key={group.key} data-group={group.key} className="space-y-1">
                        {g.header}
                        {!g.folded && group.count > 0 && (
                          <ul
                            role="grid"
                            aria-label={`${group.label} — agent branches`}
                            className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40"
                          >
                            <HeaderRow />
                            {group.blocks.flatMap(blockBody)}
                            {group.agents.flatMap(agentBody)}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
            {view.notPlaced.length > 0 && (
              <section data-unplaced className="px-3 pt-2">
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {view.notPlaced.length} {view.notPlaced.length === 1 ? 'subject' : 'subjects'} not placed —
                  shown here, in no section, because the reading the rule needs is missing.
                </p>
                <ul className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {view.notPlaced.map((u) => (
                    <li key={u.id} data-unplaced-row data-unplaced-reason={u.reason}>
                      {u.label} — {u.note}
                    </li>
                  ))}
                </ul>
                {view.notPlaced.some((u) => u.rows.length > 0) && (
                  <ul
                    role="grid"
                    aria-label="Not placed — agent branches"
                    className="mt-1 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40"
                  >
                    <HeaderRow />
                    {view.notPlaced.flatMap((u) => u.rows.map((r) => <Row key={rowKey(r)} {...rowProps(r)} />))}
                  </ul>
                )}
              </section>
            )}
            {/* OUTSIDE THE PLACEMENT RULE, LABELLED AS SUCH. The rule places work
                items and agents; tickets and the fleet's own plan-level runs are
                neither, and plan 3 owns tickets. They render here, after the
                five sections, so none disappears while that plan is open. */}
            {(issues.length > 0 || fleet.issueAnswer === 'failed' || fleet.issueAnswer === 'unsupported'
              || workingPlanRows.length > 0 || verificationWaitingRows.length > 0 || haltedLine || specHaltedLine) && (
              <section data-outside-rule className="space-y-1">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Tickets and plan runs</h2>
                <p className="px-3 text-xs text-slate-500 dark:text-slate-400">
                  Outside the placement rule: the rule places work items and agents only.
                </p>
                {[haltedLine, specHaltedLine].filter((l): l is string => Boolean(l)).map((line) => (
                  <p key={line} data-fleet-halted className="px-3 text-xs text-amber-700 dark:text-amber-500">{line}</p>
                ))}
                <ul role="grid" aria-label="Tickets and plan runs" className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
                  {fleet.issueAnswer === 'answered' && issues.length > 0 && (
                    <li role="row" data-waiting-heading className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                      <span role="gridcell">{waitingBlock.heading}</span>
                    </li>
                  )}
                  {fleet.issueAnswer === 'answered' && waitingBlock.notice !== null && (
                    <li role="row" data-waiting-notice className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <span role="gridcell">{waitingBlock.notice}</span>
                    </li>
                  )}
                  {fleet.issueAnswer === 'answered' && waitingBlock.control !== null && (
                    <li role="row" data-waiting-hidden className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <span role="gridcell" className="flex flex-wrap items-center gap-2">
                        {waitingBlock.hidden !== null && <span data-waiting-hidden-text>{waitingBlock.hidden}</span>}
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            data-show-every-ticket
                            checked={showEveryTicket}
                            onChange={() => setShowEveryTicket((on) => !on)}
                            className="h-3.5 w-3.5 accent-green-600"
                          />
                          <span className="font-medium text-slate-700 dark:text-slate-200">{waitingBlock.control}</span>
                        </label>
                        {waitingBlock.showing !== null && <span data-waiting-showing-text>{waitingBlock.showing}</span>}
                      </span>
                    </li>
                  )}
                  {unplacedIssues.map((issue) => (
                    <IssueRowView
                      key={`issue-${issue.number}`}
                      issue={issue}
                      idea={idea ?? { available: false, reason: 'this board has not said whether it can create plans' }}
                      story={story ?? { available: false, reason: 'this board has not said whether it can create stories' }}
                      issueAnswer={fleet.issueAnswer}
                      facts={ticketFacts?.get(String(issue.number))}
                      showKindLabel={false}
                      onOpenPlan={onOpenPlan}
                      planIndex={planIndex}
                    />
                  ))}
                  {[...workingPlanRows, ...verificationWaitingRows].map((row) => (
                    <PlanLevelRowView
                      key={`plan-level-${row.kind}-${row.plan}`}
                      row={row}
                      planFile={planFileOf(row.plan)}
                      onOpenPlan={onOpenPlan}
                      planIndex={planIndex}
                    />
                  ))}
                  {fleet.issueAnswer === 'failed' && issueNote(fleet) && (
                    <li role="row" data-issue-error className="border-t border-slate-100 px-3 py-2 text-sm text-amber-700 dark:border-slate-800 dark:text-amber-500">
                      <span role="gridcell">{issueNote(fleet)}</span>
                    </li>
                  )}
                  {fleet.issueAnswer === 'unsupported' && fleet.issueAbsence && (
                    <li role="row" data-issue-absence className="border-t border-slate-100 px-3 py-2 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <span role="gridcell">{fleet.issueAbsence}</span>
                    </li>
                  )}
                </ul>
              </section>
            )}
          </>
        );
      })()}
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
        {!fleet.complete && ' so far'}
        {/* `fleet.readRefAge`, not `fleet.ageSeconds`: this dates the last
            SUCCESSFUL fetch of the ref, so it keeps counting up while fetches
            fail rather than resetting on every finished scan. Null — no fetch
            has ever succeeded — omits the age entirely rather than printing
            `0s ago` for a scan that never refreshed the ref.

            `tick` stops while stale, so this age freezes rather than ageing
            against a scan that is not happening — the defect itself, since an
            age that keeps climbing is the most confident-looking part of a dead
            page. The word says so too: a number that has stopped moving is
            indistinguishable from a slow one until it is labelled. */}
        {fleet.readRefAge !== null && (
          <> · scanned {fleet.readRefAge + tick}s ago{stale && ' (frozen)'}</>
        )}
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
          and `prStatusEntry` still chooses its wording (a spent rate limit
          says so, an outage with data on screen reads *stale* and names the
          unreachable host). */}
    </div>
  );
}
