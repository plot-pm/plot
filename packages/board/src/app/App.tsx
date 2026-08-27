import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Board, Card, Fleet, StoryCard } from '../contract/schema.js';
import { AgentList } from './components/AgentList.js';
import { BoardView } from './components/Board.js';
import { Swimlanes } from './components/Swimlanes.js';
import { PlanModal } from './components/PlanModal.js';
import { StoryModal } from './components/StoryModal.js';
import { BLOCKED_REASON, UnreachableOverlay } from './components/UnreachableOverlay.js';
import { MultiSelect } from './components/ui/MultiSelect.js';
import {
  NO_SPRINT,
  NO_STORY,
  readList,
  sanitizeSelection,
  sprintFilterOptions,
  sprintMembershipLookup,
  withCounts,
  withSprintCounts,
  writeList,
} from './lib/filters.js';

// Artifacts move in days, agents in minutes — different time axes, and the
// reason these are two tabs rather than one view. The split is also what lets
// them poll at different rates: the quiet board does not pay the price of the
// live one. The fleet poll is cheap because /api/fleet reads a cache the server
// refreshes on its own timer; it never runs a scan per request.
const POLL_MS = 30_000;
const FLEET_POLL_MS = 4_000;

/**
 * How many consecutive failed polls mean *the server is gone* rather than *a
 * poll went missing*.
 *
 * COUNTED IN POLLS, NOT SECONDS, and that is the whole reason this is one
 * constant rather than two. The two tabs run at very different rates — 30 s
 * for the board against 4 s for the fleet, a factor of 7.5 — so a single
 * seconds-threshold says two different things: thirty seconds is seven and a
 * half missed polls on the Agents tab and a single one on the Board tab. The
 * same number would dim on the first hiccup in one place and only after a real
 * outage in the other. Counting failures keeps the STATEMENT identical on both
 * — the server has not answered eight times running — and it survives someone
 * changing a poll interval later, which a pair of hand-tuned second-counts
 * would not.
 *
 * MEASURED, not guessed. `pnpm board` runs under `node --watch`, so an
 * ordinary edit to a board source file restarts the server and the tab loses
 * contact several times an hour; dimming for that would be a strobe, and it
 * would teach the reader to ignore the dimming. Five real restarts were timed
 * on this machine, touching the watched artifact and polling /api/board every
 * 50 ms: the server was unanswerable for 3.1 s, 4.5 s, 5.1 s, 5.8 s and 9.1 s
 * — median 5.1 s. A COLD boot, which is what a save touching the git-scan
 * surface costs, took 21.2 s.
 *
 * At the fleet's 4 s poll those windows cost at most 3 consecutive failures,
 * and a cold boot 6. Eight clears the worst of them with room left over, so
 * the case that happens several times an hour never triggers the case that
 * means something.
 *
 * On the board's 30 s poll eight failures is about four minutes of silence
 * before the page dims — deliberately long, and the price the plan chose to
 * pay when it settled on polls over seconds. Four minutes of a banner is not
 * four minutes of a lie: the banner, the frozen footer and the stopped clocks
 * are already saying the numbers are old from the first failure. Only the
 * *posture* waits.
 */
export const DIM_AFTER_FAILURES = 8;

/**
 * How fast the board re-reads git while a Start work click is outstanding.
 *
 * The plan's bound is "about three pulses (~12 s)", which is the FLEET's rate —
 * the board's own 30 s poll would make the same three pulses a minute and a
 * half of staring. Rather than raise the resting rate (30 s is right for a view
 * of artifacts that move in days), a pending start temporarily borrows the live
 * rate and gives it back the moment nothing is starting. The board still learns
 * the outcome the same way: by re-reading git.
 */
const STARTING_POLL_MS = FLEET_POLL_MS;

type Tab = 'board' | 'agents';

export function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [tab, setTab] = useState<Tab>(
    () => (new URLSearchParams(location.search).get('tab') === 'agents' ? 'agents' : 'board'),
  );
  // Swimlanes are a LAYOUT of the same board, not a third tab: the question is
  // still "where does this work stand", only grouped by story as well as phase.
  // Off by default — with one story, rows cost width and add nothing.
  const [lanes, setLanes] = useState(
    () => new URLSearchParams(location.search).get('lanes') === '1',
  );
  const [error, setError] = useState<string | null>(null);
  const [sprintSel, setSprintSel] = useState<string[]>(() => readList('sprint'));
  const [storySel, setStorySel] = useState<string[]>(() => readList('story'));
  const [openPlan, setOpenPlan] = useState<Card | null>(null);
  // The story overlay. Two pieces of state rather than a discriminated union
  // because the two are opened from different places — but never BOTH: opening
  // one closes the other, so an overlay above an overlay (two Close buttons,
  // one ambiguous Escape) cannot happen.
  const [openStory, setOpenStory] = useState<StoryCard | null>(null);
  // A plan click made before the board's cards landed, held until they do.
  const [pendingPlan, setPendingPlan] = useState('');
  // The card the reader was just sent to, named in the URL so the landing is
  // shareable and survives a reload. Transient by intent: it marks *where you
  // arrived*, not a selection, so it clears on the next interaction rather than
  // persisting as a second kind of filter.
  const [highlight, setHighlight] = useState<string>(
    () => new URLSearchParams(location.search).get('plan') ?? '',
  );
  // The branch just revealed from an agent panel, and a nonce that lets the
  // SAME branch be revealed twice.
  //
  // Not URL-synced, unlike `?plan=`: a branch reveal is an in-page move on the
  // Agents tab triggered by a panel click, not something worth sending to
  // someone — the board's convention is that the query string holds only what
  // is shareable. The nonce is the arrival's identity: scrolling is idempotent,
  // so re-clicking a branch whose name has not changed would otherwise fire an
  // effect that does nothing, and the row would sit un-scrolled-to the second
  // time.
  const [highlightBranch, setHighlightBranch] = useState('');
  const [revealNonce, setRevealNonce] = useState(0);
  // Counts board refreshes, not seconds. A Start work button waits for the row
  // to move, and what moves the row is a re-read of git — so re-reads are the
  // thing worth counting.
  const [pulse, setPulse] = useState(0);
  // How many Start work clicks are outstanding. Only used to decide the poll
  // rate: a live control deserves a live view, and only while it is live.
  const [starting, setStarting] = useState(0);
  // When the fleet endpoint last answered, and whether it has failed since.
  //
  // The pair exists because a dead server is invisible from inside the payload:
  // `fleet.error` is the server REPORTING a failed scan, which requires a
  // server that answered. A server that answers nothing leaves the last payload
  // on screen looking exactly as trustworthy as it did a second before it died
  // — which is what happened on 2026-08-16 and cost a three-hypothesis
  // misdiagnosis of a page that was simply not connected to anything.
  const [fleetHeardAt, setFleetHeardAt] = useState<number | null>(null);
  const [fleetUnreachable, setFleetUnreachable] = useState(false);

  // Consecutive failed polls, per endpoint. The pair the dimming reads.
  //
  // TWO counters rather than one, because the two endpoints are polled at
  // different rates and only one tab polls the fleet at all: a shared counter
  // would let the board's four-minute silence and the fleet's thirty-second
  // one add up into a number describing neither. The tab in front decides
  // which one is asked, below.
  //
  // Counting rather than timing is what makes the STATEMENT the same on both
  // — see DIM_AFTER_FAILURES.
  const [boardFailures, setBoardFailures] = useState(0);
  const [fleetFailures, setFleetFailures] = useState(0);

  /**
   * Whether a fetch failure means the SERVER IS NOT THERE.
   *
   * The distinction this whole overlay turns on. A server returning HTTP 500 or
   * malformed JSON is alive and speaking: an overlay claiming *no contact*
   * would be plainly wrong about it, and `pnpm board` would be the wrong
   * advice — restarting fixes nothing that answers. Those keep the existing
   * `setError` path.
   *
   * Only a fetch that never reached anything counts here. `fetch` rejects for
   * exactly that class (connection refused, DNS, aborted transport) and
   * RESOLVES for every HTTP status, however bad — so the thrown-versus-returned
   * distinction is the discriminator, and it is drawn at the one place that can
   * see it.
   */
  const load = useCallback(async () => {
    let reached = true;
    try {
      let res: Response;
      try {
        res = await fetch('/api/board');
      } catch (e) {
        // The one branch that means no contact. Re-thrown so the single exit
        // below still records the message, with `reached` carrying the reason.
        reached = false;
        throw e;
      }
      // Everything from here on is a server that ANSWERED — badly, perhaps,
      // but answered. `reached` stays true and the error path takes it.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Board | { error: string };
      if ('error' in data) throw new Error(data.error);
      setBoard(data);
      setError(null);
      setBoardFailures(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // A bad answer resets the silence count: the server is there. Without
      // this a 500 would creep the page toward an overlay that would then tell
      // the reader to restart something already running.
      setBoardFailures((n) => (reached ? 0 : n + 1));
    } finally {
      // Bumped even on a failed poll: the button is counting attempts to learn
      // the outcome, and an attempt that failed still did not confirm anything.
      // Without this a dropped poll would leave the button spinning forever.
      setPulse((n) => n + 1);
    }
  }, []);

  const onStarting = useCallback((active: boolean) => {
    setStarting((n) => Math.max(0, n + (active ? 1 : -1)));
  }, []);

  const loadFleet = useCallback(async () => {
    let reached = true;
    try {
      let res: Response;
      try {
        res = await fetch('/api/fleet');
      } catch (e) {
        reached = false;
        throw e;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // A Fleet carries its own `error` field (a failed scan, last pulse kept),
      // so presence of the key is not the discriminator the board endpoint uses
      // — `rows` is. A 500 body has no rows.
      const data = (await res.json()) as Fleet | { error: string };
      if (!('rows' in data)) throw new Error(data.error);
      setFleet(data);
      // Recovery is automatic, and it has to be: with a first-failure threshold
      // a single hiccup would otherwise strand the view in permanent distrust
      // until someone reloaded. The polling never stopped, so the page can
      // observe its own recovery — asking the reader to confirm one is ceremony.
      setFleetHeardAt(Date.now());
      setFleetUnreachable(false);
      setFleetFailures(0);
    } catch {
      // The fetch did not reach the server. Keep the last good fleet on screen
      // — it is still the best information available, and blanking it would
      // destroy what the reader came for — but stop vouching for it.
      //
      // The FIRST failure is enough. The two outcomes are not symmetric: what a
      // false alarm costs is a banner that clears itself four seconds later,
      // while a dead server that looks healthy costs a misdiagnosis. It cost
      // one on 2026-08-16, when two screenshots of a frozen page were reported
      // as regressions that did not exist on the live board.
      //
      // Two pieces of state rather than one, because they answer two questions
      // and a single timestamp cannot answer both: `fleetHeardAt` is WHEN the
      // last answer arrived, and it must survive the failure — it is the number
      // the banner reports. `fleetUnreachable` is WHETHER a fetch has failed
      // since. Deriving the second from the first ("stale once the last success
      // is older than N") would reintroduce a threshold the plan rejected, and
      // would call a view stale during the ordinary gap between two polls.
      //
      // A server that ANSWERED badly is excluded, which is a correction the
      // banner needed too: a 500 left it reading "Not reaching the board
      // server" about a server that was reaching back. `fleet.error` and the
      // scan-failure banner already cover the case where the server reports
      // its own trouble, and an unparseable 500 body now leaves the last good
      // pulse and no false claim of silence.
      setFleetUnreachable(!reached);
      setFleetFailures((n) => (reached ? 0 : n + 1));
    }
  }, []);

  // Load once, then poll — no manual refresh needed. The rate goes live while a
  // start is outstanding and drops back on its own; nothing else changes.
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), starting > 0 ? STARTING_POLL_MS : POLL_MS);
    return () => clearInterval(id);
  }, [load, starting]);

  // The fleet only polls while its tab is open: a background 4 s poll would
  // cost the same as a foreground one and answer a question nobody is asking.
  useEffect(() => {
    if (tab !== 'agents') return;
    void loadFleet();
    const id = setInterval(() => void loadFleet(), FLEET_POLL_MS);
    return () => clearInterval(id);
  }, [tab, loadFleet]);

  /**
   * Failed polls for the endpoint the tab in front actually depends on.
   *
   * Per tab rather than combined, because the answer has to be about the data
   * the reader is looking at. The Agents tab is drawn from the fleet, and its
   * board poll continues in the background — a board endpoint that recovered
   * would otherwise silently clear an overlay over rows that are still frozen.
   *
   * Both endpoints are the SAME server, so in the case this is for — the
   * process is gone — the two counts fail together. They are separated for the
   * cases where they do not: a route that 500s while its neighbour is fine.
   */
  const failures = tab === 'agents' ? fleetFailures : boardFailures;

  /**
   * Dimmed: the server has not answered several times running.
   *
   * `board`/`fleet` being non-null is part of it, and load-bearing. A tab whose
   * very FIRST poll fails has never had an answer, so it has no last payload to
   * dim and no silence to measure from — it shows "Loading…", which is a
   * different and true statement. Dimming an empty page would claim data it
   * never held, the same distinction the staleness banner already draws.
   */
  const dimmed = failures >= DIM_AFTER_FAILURES && (tab === 'agents' ? fleet : board) !== null;

  /**
   * What the action controls are told while the page is dimmed.
   *
   * The scrim stops a POINTER, and that is not enough on its own: a keyboard
   * reader tabs straight through a scrim into a live-looking button, and a
   * screen reader is told nothing by a visual dim. So the state is also
   * expressed in the one channel every action control already reads —
   * `DispatchInfo`, whose `reason` those controls already render and announce.
   *
   * Overridden in ONE place rather than at each call site, because the rule is
   * about the page and not about any button: a control added later inherits it
   * without anyone having to remember, which is the difference between a gate
   * and a rule.
   *
   * Blocked actions stay VISIBLE and `aria-disabled` with the reason, never
   * removed. Buttons that vanish make the layout jump — once when contact is
   * lost and again when it returns — and a page that rearranges itself while
   * frozen is worse than one that simply admits it is.
   */
  const dispatchInfo = dimmed
    ? { available: false, reason: BLOCKED_REASON }
    : board?.dispatch;

  /**
   * The board as the card views should see it — same data, effective dispatch.
   *
   * `BoardView` and `Swimlanes` read `board.dispatch` off the document rather
   * than taking it as a prop, so substituting it here reaches every card
   * through the path they already use. That keeps this change out of both of
   * those files, which two other branches are editing today, and it means a
   * card view added later inherits the block for free.
   *
   * A function rather than a derived value because it is called where `board`
   * has already been narrowed to non-null, and a nullable variable would carry
   * that null into props that do not accept one.
   */
  const withEffectiveDispatch = (b: Board): Board =>
    dispatchInfo ? { ...b, dispatch: dispatchInfo } : b;

  /**
   * The SAME treatment for approving, and it travels to the Agents tab.
   *
   * `board.approve` has existed since `board-becomes-operable` and reached the
   * cards only: `Board.tsx` and `Swimlanes.tsx` pass it to `PlanCard`, and the
   * Agents tab was never given it. So a plan PR sitting green and ready showed
   * a dimmed three-dot menu on its row while the same plan's CARD offered the
   * button — one board, two answers about the same act.
   *
   * Dimmed by the same rule as dispatch: a frozen page must not offer to write
   * to the host on data it cannot vouch for.
   */
  const approveInfo = dimmed
    ? { available: false, reason: BLOCKED_REASON }
    : board?.approve;

  /**
   * The SAME treatment again for continuing an answered agent.
   *
   * Dimmed by the same rule as the two above, and for a reason that bites
   * harder here: this control spawns a PROCESS in a worktree. A frozen page is
   * a page whose `waiting` rows may already have been answered by someone else,
   * and a click on stale state would start a second worker in a tree that holds
   * a live one. The route refuses that anyway — no marker, no continuation —
   * but a control that is dark while the page cannot vouch for its data says so
   * before the click rather than after it.
   */
  const continueInfo = dimmed
    ? { available: false, reason: BLOCKED_REASON }
    : board?.continue;

  /**
   * The SAME treatment for turning an issue into a plan.
   *
   * Dimmed by the same rule as the three above. It bites in its own way here:
   * this control spawns an agent that writes a plan FILE, and a frozen page's
   * issue rows may already have been planned by someone else — the reference
   * that removes a row lands in git, and a page that cannot re-read git cannot
   * know it has. The route refuses a second plan for one issue anyway, but a
   * dark control says so before the click rather than after it.
   */
  const ideaInfo = dimmed
    ? { available: false, reason: BLOCKED_REASON }
    : board?.idea;

  /**
   * The SAME treatment for Commission design — the Approve twin that spawns a
   * plot agent to move a Draft plan into Design. Dimmed on a frozen page for the
   * reason `ideaInfo` is: it writes a plan file, and a page that cannot re-read
   * git cannot know the plan has already moved.
   */
  const commissionInfo = dimmed
    ? { available: false, reason: BLOCKED_REASON }
    : board?.commission;

  /**
   * The SAME treatment for Slice this wave — the sixth spawn, which sends an
   * `unsliced-wave` to `/plot-reslice`. Dimmed on a frozen page for the reason
   * the two above are: it spawns an agent that rewrites a plan's `## Branches` on
   * disk, and a page that cannot re-read git cannot know the wave has already
   * been sliced.
   *
   * `board?.reslice` may be `undefined` even off a frozen page — the board CASTS
   * its payload rather than parsing it, so the schema `.default` never runs
   * client-side, and a pulse produced before this field existed carries no
   * `reslice`. `ResliceButton` reads `reslice.available`, so the coalesce here is
   * what makes a stale payload refuse rather than throw.
   */
  const resliceInfo = dimmed
    ? { available: false, reason: BLOCKED_REASON }
    : board?.reslice ?? { available: false, reason: '' };

  /**
   * The SAME treatment for Deliver — the seventh spawn, which sends a
   * fully-merged plan to `/plot-deliver`. Dimmed on a frozen page for the reason
   * the ones above are: it spawns an agent that flips a plan's phase on disk, and
   * a page that cannot re-read git cannot know the plan has already been
   * delivered — or that a branch it read as merged has been reverted.
   *
   * `board?.deliver` may be `undefined` even off a frozen page — the board CASTS
   * its payload rather than parsing it, so the schema `.default` never runs
   * client-side, and a pulse produced before this field existed carries no
   * `deliver`. `DeliverButton` reads `deliver.available`, so the coalesce here is
   * what makes a stale payload refuse rather than throw.
   */
  const deliverInfo = dimmed
    ? { available: false, reason: BLOCKED_REASON }
    : board?.deliver ?? { available: false, reason: '' };

  /**
   * The SAME treatment for Implement — the eighth spawn, which prepares an
   * approved plan for implementation via `/plot-implement`. Dimmed on a frozen
   * page for the reason the ones above are: it spawns an agent that creates a
   * branch and a brief on disk, and a page that cannot re-read git cannot know
   * the plan has already been started, or that its ground has moved.
   *
   * `board?.implement` may be `undefined` even off a frozen page — the board
   * CASTS its payload rather than parsing it, so the schema `.default` never
   * runs client-side, and a pulse produced before this field existed carries no
   * `implement`. `ImplementButton` reads `implement.available`, so the coalesce
   * here is what makes a stale payload refuse rather than throw.
   */
  const implementInfo = dimmed
    ? { available: false, reason: BLOCKED_REASON }
    : board?.implement ?? { available: false, reason: '' };

  /**
   * The SAME treatment for Drop — the ninth write, which removes a registry
   * manifest. Unlike the eight above this does NOT spawn an agent: the endpoint
   * removes the file synchronously. Dimmed on a frozen page for the reason the
   * ones above are: it writes to this disk, and a page that cannot re-read the
   * registry cannot know the entry has already been dropped.
   *
   * `board?.drop` may be `undefined` even off a frozen page — the board CASTS
   * its payload rather than parsing it, so the schema `.default` never runs
   * client-side, and a pulse produced before this field existed carries no
   * `drop`. `DropAgentButton` reads `drop.available`, so the coalesce here is
   * what makes a stale payload refuse rather than throw.
   */
  const dropInfo = dimmed
    ? { available: false, reason: BLOCKED_REASON }
    : board?.drop ?? { available: false, reason: '' };

  /**
   * Coming back to a hidden tab RE-CHECKS instead of counting.
   *
   * Browsers throttle timers in hidden tabs, so a minimised window would
   * otherwise return holding a failure count assembled from however often it
   * was allowed to wake — which is the same defect `App.tsx` already warns
   * about for the staleness clock: "a board that has heard nothing for an hour
   * has to say an hour, not 'as many seconds as the browser felt like waking
   * me'." A count is worse than a duration here, because it cannot even be
   * recomputed from the wall clock afterwards.
   *
   * So visibility returning issues a poll. It either succeeds — and the count
   * resets, and any overlay goes — or it fails, and the overlay is honest.
   * Nobody should stare at a dim page for a server that came back two minutes
   * ago.
   *
   * Both endpoints are asked, not merely the tab's own: switching tabs after
   * returning must not be the moment the page finds out.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void load();
      if (tab === 'agents') void loadFleet();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load, loadFleet, tab]);

  // Ages the "last heard" number while the server is unreachable.
  //
  // The ONE clock that must keep running when everything else freezes, and the
  // asymmetry is the point: every other number describes a scan that is not
  // happening, so advancing them states something false. This one describes the
  // SILENCE, which is genuinely getting longer with every second — the reader
  // wants to know whether it has been four seconds or four minutes, and those
  // are very different situations.
  //
  // Runs only while unreachable and only with the tab open, so a healthy board
  // pays nothing for it.
  //
  // Each tick RECOMPUTES the age from the wall clock rather than incrementing a
  // counter, so a throttled background timer still reports true elapsed time
  // instead of the number of ticks it managed to fire. A page left on a dead
  // server for an hour has to say an hour, not "as many seconds as the browser
  // felt like waking me".
  //
  // Null is the whole vocabulary of "not stale": the component reads the
  // absence of a number as the statement that there is nothing to report, so a
  // healthy board never has to reason about a flag and a number agreeing.
  const [fleetStaleSeconds, setFleetStaleSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (tab !== 'agents' || !fleetUnreachable || fleetHeardAt === null) {
      setFleetStaleSeconds(null);
      return;
    }
    const since = () => Math.max(0, Math.round((Date.now() - fleetHeardAt) / 1_000));
    // Immediately, not on the first tick: the banner must appear with the
    // failure rather than a second after it.
    setFleetStaleSeconds(since());
    const id = setInterval(() => setFleetStaleSeconds(since()), 1_000);
    return () => clearInterval(id);
  }, [tab, fleetUnreachable, fleetHeardAt]);

  const onLanes = (next: boolean) => {
    setLanes(next);
    const url = new URL(location.href);
    if (next) url.searchParams.set('lanes', '1');
    else url.searchParams.delete('lanes');
    history.replaceState(null, '', url);
  };

  const onTab = (next: Tab) => {
    setTab(next);
    const url = new URL(location.href);
    if (next === 'agents') url.searchParams.set('tab', 'agents');
    else url.searchParams.delete('tab');
    history.replaceState(null, '', url);
    // Leaving the Agents tab is the reader moving on, so the branch arrival
    // marker goes — the same reason the plan highlight clears on the next
    // filter change. Kept while staying on the tab: switching to agents is how
    // `revealBranch` itself gets here.
    if (next !== 'agents') setHighlightBranch('');
  };

  /**
   * Scroll a story's swimlane row into view, switching to lane layout first.
   *
   * The scroll is deferred a frame because lanes are what render a story as a
   * row: without the deferral the element is not in the document yet and the
   * jump silently does nothing, which looks exactly like a broken link.
   *
   * Called only while lanes are already on. It used to be the story badge's
   * click handler; the badge now opens the story ARTEFACT, which is what its
   * name refers to — a badge that sometimes opens a document and sometimes
   * moves the page teaches a reader nothing.
   */
  const scrollToStoryLane = useCallback((story: string) => {
    setLanes(true);
    const url = new URL(location.href);
    url.searchParams.set('lanes', '1');
    history.replaceState(null, '', url);
    requestAnimationFrame(() => {
      document.getElementById(`story-${story}`)?.scrollIntoView({ block: 'start' });
    });
  }, []);

  /**
   * Reveal a branch's fleet row — the agent panel's BRANCH fact's destination.
   *
   * The Agents tab is forced on first, for the same reason `scrollToStoryLane`
   * forces lanes: the row only exists in that tab, and a scroll to an element
   * that is not in the document looks exactly like a broken link. The panel that
   * triggered this has already closed itself (the modal composes `onClose`
   * before the reveal), so the row it lands on is not sitting behind an overlay.
   *
   * The nonce bump is what makes a second click on the same branch scroll again
   * — see `highlightBranch`. The effect below does the scroll once the row is in
   * the document.
   */
  const revealBranch = useCallback((branch: string) => {
    setTab('agents');
    const url = new URL(location.href);
    url.searchParams.set('tab', 'agents');
    history.replaceState(null, '', url);
    setHighlightBranch(branch);
    setRevealNonce((n) => n + 1);
  }, []);

  /**
   * The board card for a plan FILENAME, or null.
   *
   * A fleet row is not a card: it carries `planFile`, and `PlanModal` takes a
   * `Card`, so the card has to be looked up from the board data. Null is a real
   * answer rather than a degraded one — a plan outside the walked directories
   * has a row and no card — and the caller then leaves the plain `/plan/<file>`
   * link alone instead of opening an empty modal.
   */
  const cardForPlanFile = useCallback(
    (planFile: string): Card | null => {
      if (!board || !planFile) return null;
      const basename = (p: string) => p.split(/[/\\]/).pop() ?? '';
      return board.columns
        .flatMap((c) => c.cards)
        .find((c) => basename(c.path) === basename(planFile)) ?? null;
    },
    [board],
  );

  /**
   * Open a fleet row's plan in the modal; report whether it did.
   *
   * A false answer lets the row's anchor navigate to the plain plan page, which
   * is the honest fallback when the board holds no card for that plan.
   *
   * "The board has not loaded yet" is NOT "this plan has no card", and the two
   * must not behave alike: a click in the first seconds of the tab would
   * otherwise navigate away from a live view for a plan the board is about to
   * have. So the click is REMEMBERED instead — the effect below opens the modal
   * the moment the cards land, and the reader keeps the view they came to watch.
   */
  const onOpenPlanFile = useCallback(
    (planFile: string): boolean => {
      const card = cardForPlanFile(planFile);
      if (card) {
        setOpenPlan(card);
        return true;
      }
      if (!board) {
        setPendingPlan(planFile);
        return true;
      }
      return false;
    },
    [board, cardForPlanFile],
  );

  // The deferred half of the click above. Once the board arrives, either the
  // card is there and the modal opens, or it is not and the request is dropped
  // — a click that resolves to nothing beats one that navigated away.
  useEffect(() => {
    if (!pendingPlan || !board) return;
    const card = cardForPlanFile(pendingPlan);
    setPendingPlan('');
    if (card) setOpenPlan(card);
  }, [pendingPlan, board, cardForPlanFile]);

  /**
   * Close the modal, switch to the board, filter to the plan's story, and land
   * on the card itself.
   *
   * The filter alone was the version that left you scanning a column: this repo
   * has nine plans under one story. So the plan is also named in the URL —
   * `?plan=<slug>`, the same `writeList`-style sync the story and sprint filters
   * use — which is what makes the landing shareable and survivable, and the card
   * scrolls into view highlighted.
   *
   * The scroll is deferred a frame for the same reason the story jump is: the
   * filter has to render before the element it aims at exists.
   */
  const onShowInBoard = useCallback((card: Card) => {
    setOpenPlan(null);
    setTab('board');
    const url = new URL(location.href);
    url.searchParams.delete('tab');
    // A plan with no story filters to nothing — so it does not filter at all.
    // The highlight is what finds the card either way.
    if (card.story) {
      setStorySel([card.story]);
      url.searchParams.set('story', card.story);
    }
    url.searchParams.set('plan', card.slug);
    history.replaceState(null, '', url);
    setHighlight(card.slug);
  }, []);

  /**
   * The story card for a slug, or undefined.
   *
   * A plan can name a story with no file — a typo, or one not yet written —
   * and that plan gets no `Open story` button and no badge link rather than an
   * action that 404s. The same rule the swimlane's orphan lane already follows.
   */
  const storyFor = useCallback(
    (slug: string | undefined): StoryCard | undefined =>
      slug ? board?.stories.find((s) => s.slug === slug) : undefined,
    [board],
  );

  /**
   * Open a story, REPLACING whatever overlay is open rather than stacking on it.
   *
   * An overlay above an overlay gives two Close buttons and an ambiguous
   * Escape, for the sake of keeping context the header already names.
   * Replacement is predictable, and the way back is the same click in reverse.
   */
  const onOpenStory = useCallback((story: StoryCard) => {
    setOpenPlan(null);
    setOpenStory(story);
  }, []);

  /** The mirror image: a plan opened from the story overlay replaces it. */
  const onOpenPlanFromStory = useCallback((card: Card) => {
    setOpenStory(null);
    setOpenPlan(card);
  }, []);

  /**
   * Close the overlay, switch to the board, and filter to this story — the
   * story's answer to the plan modal's *Show in board*.
   *
   * No `?plan=` highlight, because a story is not one card: the filter IS the
   * landing. Everything else matches the plan modal's version, including
   * clearing the agents tab from the URL.
   */
  const onShowStoryInBoard = useCallback(
    (story: StoryCard) => {
      setOpenStory(null);
      setTab('board');
      const url = new URL(location.href);
      url.searchParams.delete('tab');
      url.searchParams.delete('plan');
      setStorySel([story.slug]);
      url.searchParams.set('story', story.slug);
      history.replaceState(null, '', url);
      setHighlight('');
      // In lane layout the story HAS a row, so land on it. Only there: forcing
      // lanes on a reader who chose columns would answer a question they did
      // not ask, and the filter alone is already the landing.
      if (lanes) scrollToStoryLane(story.slug);
    },
    [lanes, scrollToStoryLane],
  );

  const onSprint = (values: string[]) => {
    setSprintSel(values);
    writeList('sprint', values);
    // The highlight marks where you just arrived. The next interaction is the
    // reader moving on, so it goes — otherwise it would read as a selection and
    // become a second, invisible filter.
    setHighlight('');
    writeList('plan', []);
  };
  const onStory = (values: string[]) => {
    setStorySel(values);
    writeList('story', values);
    setHighlight('');
    writeList('plan', []);
  };

  // Sprint options come from the directory AND from inline plan values, so the
  // filter appears whenever any plan carries a sprint — even with no sprint
  // directory. Stories still derive from the directory only. Each option is
  // annotated with its plan count (over the whole board).
  //
  // Counts join on sprint FILE MEMBERSHIP, not card.sprint — see the plan
  // "the-agents-tab-filters-to-the-sprint", which measured: 19 plans in the
  // sprint, only 5 carry the back-reference, 14 empty/placeholder. Joining on
  // card.sprint showed 5 of 19.
  const allCards = board ? board.columns.flatMap((c) => c.cards) : [];
  const sprintChoices = sprintFilterOptions(board);
  const membership = useMemo(
    () => sprintMembershipLookup(board?.sprints ?? []),
    [board?.sprints],
  );
  const sprintOptions = withSprintCounts(
    [{ value: NO_SPRINT, label: 'No sprint' }, ...sprintChoices],
    allCards,
    membership,
  );
  const storyOptions = withCounts(
    [
      { value: NO_STORY, label: 'No story' },
      ...(board?.stories ?? []).map((s) => ({ value: s.slug, label: s.title })),
    ],
    allCards,
    'story',
    NO_STORY,
  );

  // The plan promises URL filter values are "validated against known slugs".
  // A stale/typo slug in ?sprint=/?story= matches no option, so an unchecked
  // selection would hide every card (empty board). Drop unknown values here —
  // an all-invalid selection becomes "no filter" (show all). Pure derivation,
  // so no render/poll churn; the URL heals on the next filter change.
  const validSprintSel = sanitizeSelection(sprintSel, sprintOptions);
  const validStorySel = sanitizeSelection(storySel, storyOptions);

  const hasSprints = sprintChoices.length > 0;
  const hasStories = (board?.stories.length ?? 0) > 0;

  // A `?plan=` matching nothing is IGNORED. A stale link, or a plan since
  // delivered out of the filtered set, must render the board normally — an empty
  // filtered column reads as "this story has no plans", which is a different and
  // false statement. Validated against the cards the board actually returned,
  // exactly as the sprint and story selections are.
  const validHighlight = allCards.some((c) => c.slug === highlight) ? highlight : '';

  // Scroll to the highlighted card once it exists. Deferred a frame for the same
  // reason the story jump is: the element is not in the document until the tab
  // and filter have rendered, and a scroll to nothing looks exactly like a
  // broken link. `prefers-reduced-motion` suppresses the ANIMATION, not the
  // scroll — arriving at the card is the point; only the movement is the
  // accessibility concern.
  useEffect(() => {
    if (!validHighlight || tab !== 'board') return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const id = requestAnimationFrame(() => {
      document.getElementById(`plan-${validHighlight}`)?.scrollIntoView({
        block: 'center',
        behavior: smooth ? 'smooth' : 'auto',
      });
    });
    return () => cancelAnimationFrame(id);
  }, [validHighlight, tab, lanes, board]);

  // Scroll to a revealed branch's row once it exists — the Agents-tab twin of
  // the plan-card scroll above. Keyed on `revealNonce` so a repeated reveal of
  // the same branch fires again; `highlightBranch` is read for the target but
  // does not gate the re-run.
  //
  // Deferred a frame for the same reason: `setTab('agents')` has to render the
  // list before `#agent-row-<branch>` is in the document. The dependency on
  // `fleet` re-runs it when a not-yet-rendered branch arrives in a later pulse —
  // a reveal fired before its row was in the fleet lands the moment it is.
  useEffect(() => {
    if (!highlightBranch || tab !== 'agents') return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const id = requestAnimationFrame(() => {
      document.getElementById(`agent-row-${highlightBranch}`)?.scrollIntoView({
        block: 'center',
        behavior: smooth ? 'smooth' : 'auto',
      });
    });
    return () => cancelAnimationFrame(id);
  }, [highlightBranch, revealNonce, tab, fleet]);

  return (
    <div className="mx-auto min-h-screen max-w-[1600px] px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight">Plot</h1>
        {/* The branch chip that used to live here (lines 830–847 before this
            change) has been REMOVED, not moved or relabelled.

            The chip accurately named the SERVER's checkout — which one of this
            repo's 22+ worktrees `pnpm board` was started in. An operator on
            `bug/a-head-counts-its-own-waves` read the header, saw `main`, and
            asked why: the chip was answering *which worktree is the server in*
            while looking like it answered *where am I*. Two branch names in one
            header is worse than either alone, and the question *where is the
            reader* now has an answer on the Agents tab (fleet.masterAgentBranch)
            while the server's own checkout (`server.branch`) has ZERO render
            sites — the field stays in the payload and simply stops being drawn.
            UnreachableOverlay receives the whole ServerInfo but reads only
            `restartCommand` and `port`, so this deletion adds no new dead code.
        */}
        <nav className="mr-auto flex gap-1" aria-label="Views">
          {([
            ['board', 'Board'],
            ['agents', 'Agents'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onTab(key)}
              aria-current={tab === key ? 'page' : undefined}
              className={
                tab === key
                  ? 'rounded-md bg-slate-200 px-3 py-1 text-sm font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                  : 'rounded-md px-3 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900'
              }
            >
              {label}
            </button>
          ))}
        </nav>
        {/* Filters belong to the board; the agent list is grouped by waiting
            reason, which is not something a sprint or story narrows. */}
        {tab === 'board' && hasSprints && (
          <MultiSelect label="All sprints" options={sprintOptions} selected={validSprintSel} onChange={onSprint} />
        )}
        {tab === 'board' && hasStories && (
          <MultiSelect label="All stories" options={storyOptions} selected={validStorySel} onChange={onStory} />
        )}
        {/* Only offered where it can show something: with no stories, lanes
            would render one "(no story)" row, which is just the board with a
            wasted column. */}
        {tab === 'board' && hasStories && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={lanes}
              onChange={(e) => onLanes(e.target.checked)}
              className="h-3.5 w-3.5 accent-slate-500"
            />
            Story lanes
          </label>
        )}
      </header>
      <main>
        {tab === 'agents' ? (
          fleet ? (
            // The poll rate is the client's own, and it is passed rather than
            // re-declared so the countdown cannot drift from the interval it
            // counts toward. null when the tab is not open — and it always is
            // here, which is why the hidden case is asserted at the component.
            <AgentList
              fleet={fleet}
              pollSeconds={FLEET_POLL_MS / 1000}
              staleSeconds={fleetStaleSeconds}
              onOpenPlan={onOpenPlanFile}
              // The Start work button on an eligible row needs the same three
              // things the cards give it. `cardForPlanFile` is the lookup the
              // plan link already uses — a row is not a Card, and a plan with
              // no card gets no button rather than a broken one. `pulse` counts
              // BOARD refreshes, which is what moves a started row.
              cardForPlanFile={cardForPlanFile}
              dispatch={dispatchInfo}
              // The other half of what a row can DO. Until now the Agents tab
              // was given only dispatch, so its menu could offer only `Start
              // work` — and a Draft plan's row, whose one available act is
              // approving, got a dead menu.
              approve={approveInfo}
              // The third act a row can offer, and the only one on this wave.
              // It reaches the agent panel rather than the row menu: the
              // control needs a text box for the answer, which a menu item has
              // nowhere to put.
              continueWith={continueInfo}
              // The fourth act, and the only one belonging to a row that is not
              // a branch. It reaches the ISSUE rows in WAITING ON YOU, which
              // read it together with `fleet.issueAnswer` — this flag says the
              // board can act, that one says the tracker can be asked, and an
              // action needs both.
              idea={ideaInfo}
              // The fifth act, and the Approve twin: Commission design moves a
              // Draft plan into Design. It reaches the same PLAN rows Approve
              // does, in the row menu, and shares the idea binding today.
              commission={commissionInfo}
              // The sixth act, and the only one belonging to a WAVE rather than
              // a plan or a branch: Slice this wave sends an `unsliced-wave` to
              // `/plot-reslice`. It shares the idea binding today, and reaches
              // the wave rows in the review sections where a tangled wave lands.
              reslice={resliceInfo}
              // The seventh act, and the only one belonging to a plan on the
              // OTHER end of the lifecycle: Deliver sends a fully-merged plan to
              // `/plot-deliver`. It reaches the same PLAN rows Approve and
              // Commission do, in the row menu, gated on the card's `deliverable`
              // bit rather than on a Draft phase.
              deliver={deliverInfo}
              // The eighth act, and the complement of Dispatch on an approved
              // plan: Implement prepares one wave via `/plot-implement`. It
              // reaches the same PLAN rows Approve, Commission and Deliver do,
              // in the row menu, gated on the card having eligible work.
              implement={implementInfo}
              // The ninth act, and the only one belonging to a BROKEN agent
              // rather than a plan or branch: Drop removes a registry manifest.
              // It reaches the agent rows in WAITING ON YOU.
              drop={dropInfo}
              pulse={pulse}
              onStarting={onStarting}
              // The agent panel's BRANCH and PLAN facts are destinations.
              // `onOpenPlanFile` is already passed as `onOpenPlan`; this is the
              // branch half, and the row it reveals wears the ring below.
              onRevealBranch={revealBranch}
              highlightBranch={highlightBranch}
            />
          ) : (
            <p className="text-sm text-slate-500">Loading…</p>
          )
        ) : error && !board ? (
          // DEGRADE, DO NOT HIDE — applied where it had not reached yet.
          //
          // This branch used to fire on any error and REPLACE the cards with a
          // red string, throwing away a payload the client still held. One
          // outage then produced two different stories depending on which tab
          // was in front: the Agents tab kept its rows and said they were old,
          // the Board tab showed a red message where the board used to be, with
          // no indication whether it was stale or gone.
          //
          // Now the error only takes the whole view when there is nothing to
          // degrade TO — a first load that never succeeded. With cards in hand
          // the message moves to a banner above them (below) and the board
          // stays on screen, because it remains the best information available.
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            Failed to load board: {error}
          </p>
        ) : board ? (
          <>
            {/* The Board tab's half of the unified error model.
                Two banners, never merged, because they name two faults with two
                different remedies — the same split the Agents tab already draws
                between "not reaching the server" and "the last scan failed".
                Both can be true at once: a route that started 500ing, then a
                process that died. */}
            {boardFailures > 0 && (
              <p
                role="status"
                className="mb-4 rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
              >
                Not reaching the board server — {boardFailures}{' '}
                {boardFailures === 1 ? 'poll has' : 'polls have'} gone
                unanswered. The cards below are frozen at the last answer and
                are no longer being checked.
              </p>
            )}
            {error && boardFailures === 0 && (
              // A server that ANSWERED badly. Its cards stay: the payload in
              // hand is still the best information available, and it is the
              // half of this that used to be thrown away.
              <p className="mb-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                Last board refresh failed: {error} — showing the last successful
                one below.
              </p>
            )}
          {lanes ? (
            <Swimlanes
              board={withEffectiveDispatch(board)}
              sprintSel={validSprintSel}
              storySel={validStorySel}
              pulse={pulse}
              planAgeSeconds={fleet?.ageSeconds ?? null}
              onStarting={onStarting}
              onOpenPlan={setOpenPlan}
              onOpenStory={onOpenStory}
              highlight={validHighlight}
            />
          ) : (
            <BoardView
              board={withEffectiveDispatch(board)}
              sprintSel={validSprintSel}
              storySel={validStorySel}
              pulse={pulse}
              planAgeSeconds={fleet?.ageSeconds ?? null}
              onStarting={onStarting}
              onOpenPlan={setOpenPlan}
              onOpenStory={onOpenStory}
              highlight={validHighlight}
            />
          )}
          </>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </main>
      {/* The dimming, and it is placed BEFORE the modals deliberately.
          Its scrim is z-40 and `DocModal`'s shell is z-50, so a plan modal that
          is already open paints above it and stays fully usable — which is the
          intent: a modal is a layer above the board rather than part of it, and
          its content route may well fail on its own, which it already explains
          ("Failed to load plan"). Opening a NEW one is board interaction and
          stops with everything else, because the card behind the scrim can no
          longer be clicked. */}
      {dimmed && <UnreachableOverlay failures={failures} server={board?.server} />}
      {/* Exactly one overlay at a time — `onOpenStory` clears the plan and
          `onOpenPlanFromStory` clears the story, so these two conditions are
          never true together. */}
      {openPlan && (
        <PlanModal
          card={openPlan}
          story={storyFor(openPlan.story)}
          onClose={() => setOpenPlan(null)}
          onShowInBoard={onShowInBoard}
          onOpenStory={onOpenStory}
        />
      )}
      {openStory && (
        <StoryModal
          story={openStory}
          cards={allCards}
          onClose={() => setOpenStory(null)}
          onShowInBoard={onShowStoryInBoard}
          onOpenPlan={onOpenPlanFromStory}
        />
      )}
    </div>
  );
}
