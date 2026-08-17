import { useEffect, useState, type MouseEvent } from 'react';
import {
  ELIGIBLE_NOTE,
  type AgentRow,
  type Card,
  type DispatchInfo,
  type Fleet,
  type WaitingGroup,
} from '../../contract/schema.js';
import { StartWorkButton } from './StartWorkButton.js';

/**
 * Groups in fixed order, each labelled by what it asks OF YOU rather than by
 * what the branch is. "wip" is a git fact; "nothing to do but look" is the
 * answer a person came here for.
 *
 * Every group renders even when empty. A group that vanishes is
 * indistinguishable from a group that is empty — and for `waiting-on-machine`,
 * which needs PR data this step does not have, silence would read as "nothing
 * is waiting on CI": a claim this step cannot make.
 *
 * Actionable before diagnostic: `not-started` precedes `quiet`, because work a
 * person can pick up right now outranks work they must go investigate. This
 * order must stay identical to `GROUP_ORDER` in `fleet.ts`, which sorts the
 * rows — a disagreement between the two would sort rows into a sequence the
 * sections then render in a different one.
 */
export const GROUPS: { key: WaitingGroup; icon: string; label: string; hint: string }[] = [
  { key: 'waiting-on-you', icon: '⚠', label: 'Waiting on you', hint: 'review, merge, decide' },
  { key: 'working', icon: '🤖', label: 'Working', hint: 'nothing to do — just look' },
  { key: 'waiting-on-machine', icon: '⏳', label: 'Waiting on a machine', hint: 'nothing — CI will finish' },
  { key: 'not-started', icon: '📋', label: 'Not started', hint: 'nobody has taken it' },
  { key: 'quiet', icon: '💤', label: 'Quiet', hint: 'still thinking, or dead?' },
  { key: 'done', icon: '✅', label: 'Done', hint: 'merged' },
];

/**
 * The groups that start collapsed.
 *
 * Not a preference — the existing group order made effective. `GROUPS` is
 * already sorted actionable-before-diagnostic, and these two are the diagnostic
 * end: one means *go check whether this died*, the other *this is finished*.
 * Neither needs reading on arrival, and on the live board of 2026-08-16 they
 * cost twenty rows between them and pushed the footer — which reports when the
 * last scan ran — off the screen.
 *
 * Exported for test: a blanket default passes an assertion that checks only one
 * group, so both halves are pinned.
 */
export const COLLAPSED_BY_DEFAULT: WaitingGroup[] = ['quiet', 'done'];

/**
 * Where the collapse state lives.
 *
 * `localStorage`, and that is a deliberate departure. The board's convention for
 * view state is the URL — `?tab=agents`, `?lanes=1`, `?plan=…`, written with
 * `history.replaceState` — and there is no other `localStorage` in the app, so
 * this introduces a second mechanism for what looks like the same kind of state.
 *
 * The distinction that justifies it: **a URL is shareable, and collapse state
 * should not be.** Everything in the query string today is worth sending to
 * someone — *look at this plan*, *look at the agents tab*. A link carrying
 * `?collapsed=quiet,done` would hand my personal tidying to whoever opened it,
 * rebuilding their view as a side effect of "have a look at this". Collapse is
 * convenience, not subject matter.
 *
 * Persistence itself is not optional: this board is left running and reloaded
 * several times an hour, and without it the reader re-configures the view every
 * time — which teaches them not to bother.
 */
const COLLAPSE_KEY = 'plot-board:agents:collapsed';

/**
 * Read the stored collapse set, falling back to the default where nothing is
 * stored.
 *
 * The fallback is the load-bearing half: a first visit has no stored value, and
 * treating that as "nothing collapsed" would ship the crowded view to everyone
 * who has not yet clicked a header. Absent and empty are therefore different —
 * `[]` is a reader who opened everything and meant it.
 *
 * Every failure path yields the default rather than throwing. `localStorage`
 * throws on access in a blocked-cookie context, and a view that renders nothing
 * because it could not remember which sections were folded is a worse answer
 * than one that simply forgets.
 *
 * Exported for test.
 */
export function readCollapsed(storage?: Pick<Storage, 'getItem'>): Set<WaitingGroup> {
  const fallback = new Set(COLLAPSED_BY_DEFAULT);
  let raw: string | null = null;
  try {
    raw = (storage ?? globalThis.localStorage)?.getItem(COLLAPSE_KEY) ?? null;
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    // Filtered against the known groups: a stored key from a renamed group is
    // stale state, and carrying it forward would collapse nothing while looking
    // like it had.
    const known = new Set<string>(GROUPS.map((g) => g.key));
    return new Set(parsed.filter((k): k is WaitingGroup => typeof k === 'string' && known.has(k)));
  } catch {
    return fallback;
  }
}

/** Persist the collapse set. Silent on failure — see `readCollapsed`. */
export function writeCollapsed(
  collapsed: Set<WaitingGroup>,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
  } catch {
    // A reader who cannot persist still gets a working toggle for this session.
  }
}

/**
 * Can this group be collapsed at all?
 *
 * An EMPTY group never can. It hides nothing, and its header does not read
 * `(0)` — it reads the group's hint (*still thinking, or dead?*), which is the
 * explanation for the emptiness and exactly what a reader wants when there is
 * nothing to list. A collapse control on a group with nothing to hide is an
 * offer that leads nowhere, the same class of defect as a button that declines
 * its own action — and folding it would hide the hint, which is the only thing
 * in there worth reading.
 *
 * Exported for test: a blanket toggle passes "the control exists" and quietly
 * takes the hint away.
 */
export function isCollapsible(rowCount: number): boolean {
  return rowCount > 0;
}

function age(row: AgentRow): string {
  if (row.ageMinutes === null) return '—';
  if (row.ageMinutes < 60) return `${row.ageMinutes}m`;
  const h = Math.floor(row.ageMinutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The waiting age in the unit that reads: days for the first weeks, months once
 * days stop being countable.
 *
 * "waiting 180d" is arithmetic the reader has to do — the same defect
 * `humanAge` was written to fix for commit ages, and the reason this scales at
 * all. Today rather than 0d: a plan approved this morning has not been waiting
 * for a measurable stretch, and "0d" reads like a stopped clock.
 *
 * Exported for test — the boundaries are where a unit change reads wrong.
 */
export function waitingLabel(days: number): string {
  if (days < 1) return 'today';
  if (days < 60) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

/**
 * The row's column tracks, as one Tailwind class shared by the header and by
 * every row.
 *
 * ```
 * 6rem   10rem   1fr     9rem   2.5rem   1.25rem
 * phase  plan    branch  pr     age      menu
 * ```
 *
 * The branch takes `1fr` because it is the longest and most variable value on
 * the line and the one worth reading in full; the others are bounded by their
 * own content — `Development` is the longest phase, `⑂1234 conflicts` the
 * longest PR cell. Every other track is FIXED, which is the whole point: an
 * empty cell now leaves a gap rather than shifting its neighbours, so a row
 * with no phase aligns with one that has a phase, and a row whose plan name
 * sits in the group heading aligns with one whose does not.
 *
 * ONE constant, read by the header row and by `Row`. Two copies of a track list
 * is how a header stops lining up with the rows beneath it — and this grid has
 * no `<table>` to keep them honest, because the rows carry interactive controls
 * and a collapsible group structure that table markup would fight.
 *
 * Exported for test: the tracks are the claim, and a test that reads the class
 * off one row cannot tell a shared constant from a lucky duplicate.
 */
export const ROW_TRACKS = 'grid-cols-[6rem_10rem_1fr_9rem_2.5rem_1.25rem]';

/**
 * The PR a row carries, derived from the row rather than imported.
 *
 * `AgentRowSchema` names the shape inline, so there is no exported alias to
 * import — and adding one is a change to the contract, which this wave is
 * deliberately not making. Derived, so it cannot drift from the field it
 * describes: a seventh state or a new flag arrives here without an edit.
 */
type AgentPr = NonNullable<AgentRow['pr']>;

/**
 * Where the row stops being a row.
 *
 * Arithmetic, not taste: the fixed tracks total 460 px and the gaps and padding
 * add 84 px, so **the grid needs 544 px before the branch column gets a single
 * pixel** — and a 375 px phone is 169 px short. Tailwind's `sm` breakpoint is
 * 640 px, the first stop above that number.
 *
 * Below it each row becomes a small block: the branch on its own line, with
 * plan, phase, PR and age wrapped beneath it. **Nothing is dropped and nothing
 * is elided** — the same facts stack instead of ranging. Dropping the plan name
 * was the cheaper answer and is wrong: `showPlanHeading` just made naming the
 * plan the row's own responsibility whenever its group has no heading, and
 * removing it on a phone would re-open at one width the defect closed at every
 * width.
 *
 * The phone is a real reader — the server detects a Tailscale address, so the
 * board is reachable over a private network — and it is a READING surface
 * there: `/api/dispatch` is gated to localhost, so the row's action menu is
 * unavailable by construction rather than by layout.
 */
export const CARD_BELOW_PX = 640;

/**
 * How many characters of a branch name are kept at the TAIL when the cell is
 * too narrow to hold all of it.
 *
 * Twelve, measured against the names this fleet actually carries:
 * `agent-rows-line-up` and `acting-buttons-pin-the-double-click` share the
 * prefix `feature/` and diverge immediately, but the six branches of
 * `feature/opus5-hardening-*` share twenty-four characters and differ only
 * after them — `challenge-budget`, `longhorizon`, and so on. Twelve is enough
 * to separate every pair of those six and short enough that it never eats the
 * head on a cell wide enough to matter.
 */
const BRANCH_TAIL_CHARS = 12;

/**
 * Split a branch name into the part that may be clipped and the part that must
 * not be.
 *
 * The elision is in the MIDDLE, and that is the whole decision rather than a
 * detail of it. Branch names here share long prefixes and differ at the tail —
 * `feature/opus5-hardening-…` covers six branches — so end-truncation renders
 * all six identically, which reads as SIX DUPLICATE ROWS rather than as
 * truncation. That is worse than no truncation at all, because the reader
 * cannot tell that anything was hidden.
 *
 * Returned as two strings rather than one elided string, because the cell's
 * width is `1fr` — it changes with the window, and a character budget computed
 * in JavaScript would need a `ResizeObserver` on a view that already repaints
 * every four seconds, and would be wrong for one frame on every load. The cell
 * renders the head with `truncate` (which clips at whatever width the browser
 * gives it, adding its own ellipsis) and the tail with `shrink-0`, so the
 * BROWSER decides where the fold falls and the last twelve characters are
 * always among the survivors.
 *
 * A name short enough to fit whole yields an empty tail, so a short branch
 * never gains an ellipsis it did not need — with nothing pinned to the right,
 * `truncate` leaves a fitting string untouched.
 *
 * Exported for test: end-truncation passes any assertion that only checks "the
 * string got shorter", so what is pinned is that two names sharing a long
 * prefix stay DISTINGUISHABLE.
 */
export function splitBranch(
  branch: string,
  tailChars: number = BRANCH_TAIL_CHARS,
): { head: string; tail: string } {
  // Nothing to protect: the whole name is shorter than the tail budget, so it
  // is all head and `truncate` has nothing to do.
  if (branch.length <= tailChars) return { head: branch, tail: '' };
  return {
    head: branch.slice(0, branch.length - tailChars),
    tail: branch.slice(branch.length - tailChars),
  };
}

/**
 * The PR's condition as a WORD, for the cell to print beside the number.
 *
 * The repo's rule is *symbol AND word* — colour or shape must never be the sole
 * carrier — so the state is spelled out however the cell decorates it. Six
 * values, six phrasings, and each says what the reader would have to do:
 * `conflicts` wants a rebase, `no checks` wants a click, `failing` wants
 * reading.
 *
 * `unknown` renders NOTHING rather than the word "unknown". A host that cannot
 * report a rollup (Bitbucket) would otherwise stamp every row with a word that
 * says only *this board could not find out* — noise on every line of an
 * entire host's fleet. Absent is the honest rendering of "no answer", the same
 * rule the contract states for the field itself.
 *
 * Exported for test.
 */
export function prStateWord(state: AgentPr['state']): string {
  switch (state) {
    case 'green': return 'green';
    case 'pending': return 'CI running';
    case 'failing': return 'checks failing';
    case 'none': return 'no checks';
    case 'conflicts': return 'conflicts';
    default: return '';
  }
}

/**
 * The note, with the PR clause the CELL now renders taken off the front.
 *
 * The server still composes `PR #158, draft · awaiting review` — that sentence
 * is `fleet.ts`'s, and this wave does not touch it. But the PR's number, its
 * draft flag and its state now travel as fields and are rendered by their own
 * cell, so printing the whole sentence beside that cell would say the same
 * thing twice on every row that has a PR.
 *
 * **This is deliberately NOT the `indexOf` search it replaces.** That one
 * hunted a marker ANYWHERE in a sentence in order to LINK it — a parser for a
 * format nobody declared, which silently rendered an unlinked note the moment
 * the wording drifted. This one is anchored at position 0, matches only the
 * row's OWN number, and its failure mode is the opposite: a note whose wording
 * drifts is printed in full, which is a duplicated word rather than a lost
 * link. Nothing depends on it — the PR cell renders from the fields either way.
 *
 * **Everything after the separator survives**, because that is what a PR state
 * cannot say: *uncommitted work*, *blocked by an earlier wave*, *claimed
 * elsewhere*, *awaiting review*. The note is not being replaced, only relieved
 * of one duty.
 *
 * Exported for test — an implementation that drops the whole note passes every
 * "the row no longer says PR #130 twice" assertion.
 */
export function noteWithoutPr(note: string, pr: AgentRow['pr']): string {
  if (!pr) return note;
  const marker = `PR #${pr.number}`;
  if (!note.startsWith(marker)) return note;
  const rest = note.slice(marker.length);
  // The separator the server writes between the PR clause and everything else.
  // Anything before it is the PR's own condition, which the cell now carries.
  const at = rest.indexOf(' · ');
  return at === -1 ? '' : rest.slice(at + 3);
}

/** One plan's rows within a waiting-group, in the order they arrived. */
export interface PlanGroup {
  plan: string;
  planFile: string;
  rows: AgentRow[];
}

/**
 * Split one waiting-group's rows by plan.
 *
 * By PLAN, not by story: the waiting-groups answer *what needs me next*, and
 * within that the useful unit is the plan — the thing whose waves are being
 * worked. A story spans weeks and several plans; it is the board's axis, not
 * this view's. (It is also not on a fleet row at all.)
 *
 * Rows arrive age-sorted, so a plan's rows keep that order by construction and
 * the PLANS are ordered by their most urgent row — otherwise a plan holding one
 * stale branch would outrank one whose branch just moved. An unknown age sorts
 * last: "we do not know" is not "ancient".
 *
 * Exported for test, and because the count is what decides whether a
 * sub-heading earns its place — a group with one plan gets none.
 */
export function groupByPlan(rows: AgentRow[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const row of rows) {
    const existing = groups.get(row.plan);
    if (existing) existing.rows.push(row);
    else groups.set(row.plan, { plan: row.plan, planFile: row.planFile, rows: [row] });
  }
  const urgency = (g: PlanGroup) => Math.max(...g.rows.map((r) => r.ageMinutes ?? -1));
  return [...groups.values()].sort((a, b) => urgency(b) - urgency(a));
}

/**
 * Seconds until the next refresh, given how many have passed and how many the
 * interval is — or null when the age is unknown.
 *
 * Clamped at zero: a poll can be late (a hidden tab, a slow response), and
 * "next in -2s" is not something a reader can act on.
 */
export function countdown(ageSeconds: number | null, intervalSeconds: number): number | null {
  if (ageSeconds === null) return null;
  return Math.max(0, intervalSeconds - ageSeconds);
}

/**
 * Does a plan sub-heading earn its place ON THIS GROUP?
 *
 * A heading pays for itself by SAVING REPETITION: with two or more rows under
 * one plan, the name prints once above them instead of once on each. With a
 * single row it saves nothing — the name appears exactly once either way, and
 * the heading costs an extra line of height to say it. A section of one-row
 * plans became a stack of alternating headings and rows, each heading labelling
 * the single line beneath it.
 *
 * A nameless group can never have one: there is nothing to head it WITH, and
 * rendering the heading anyway printed a bare "(3)".
 *
 * This replaces a section-wide `showPlanHeadings(rowCount, planCount)` that
 * asked *should this section have headings at all* — `planCount > 1 ||
 * rowCount > planCount`. Both of its clauses are subsumed here: the second IS
 * this rule, counted per group instead of summed across the section, and the
 * first (two plans, one row each) turns out to be a case where headings are
 * *not* wanted. What that clause was really protecting is that unlabelled rows
 * must still name their plan — which is now the row's job whenever its group
 * has no heading, rather than something a section-wide flag guarantees.
 *
 * Exported so the mixed section — one plan with several rows beside a plan with
 * one — can be pinned without a browser. That case is what a section-wide
 * answer cannot express, and it is where the row-side half must hold.
 */
export function showPlanHeading(group: PlanGroup): boolean {
  return Boolean(group.plan) && group.rows.length > 1;
}

/**
 * Does this row offer work a person can start right now?
 *
 * `not-started` holds two different things and only one of them is startable:
 * a branch nobody has taken, and a branch **blocked by an earlier wave**. A
 * button on the second would offer to skip the ordering waves exist to express
 * — and `plot-dispatch.sh` refuses that branch for exactly that reason, so the
 * board would be inviting an action the tool declines. No greyed-out control
 * either: a button whose usual state is *you cannot* teaches people to ignore
 * buttons, and the note already says *blocked by an earlier wave*, which is the
 * whole explanation.
 *
 * The row carries no `verdict` field, so the split survives onto it only as the
 * note the server composed — matched against the shared `ELIGIBLE_NOTE`
 * constant rather than against a copy of the sentence, so a reword moves both
 * sides at once. `state === 'open'` is the branch that exists as a plan line
 * and nothing more, which is what there is to start.
 *
 * Never on `working` or `quiet` rows, which already have a branch and a claim:
 * offering to start one invites the double-dispatch `fleet-sees-merged-branches`
 * was written to prevent. The group check is what excludes them.
 *
 * Exported for test — the negative (a blocked row gets nothing) is the half a
 * naive implementation gets wrong.
 */
export function isStartable(row: AgentRow): boolean {
  return row.group === 'not-started' && row.state === 'open' && row.note === ELIGIBLE_NOTE;
}

/**
 * Does this row get the live indicator?
 *
 * Group membership and nothing else. `working` has three entrances of differing
 * strength — an uncommitted worktree, a commit inside the quiet window, a bare
 * claim with no commits yet — and it is tempting to grade the animation by which
 * one applied. Rejected: **membership IS the statement**, and it is true for all
 * three. Each is a reason the fleet considers the branch live, the note beside
 * the row already says WHICH reason, and a second vocabulary made of speeds
 * would encode in motion what the text states plainly — while being unreadable
 * in isolation and invisible in a screenshot, which this board takes seriously
 * enough to have written into its rule for colour.
 *
 * The claim is therefore narrow and true by construction: this row is in
 * WORKING, re-derived every scan. Unlike the countdown that kept ticking after
 * its server died, it asserts no future event — it stops the moment the row
 * leaves the group, which is exactly when the work stopped or moved on.
 *
 * Exported for test: a confidence-graded implementation passes a test that
 * checks only one of the three notes, so all three are pinned here.
 */
export function isLive(row: AgentRow): boolean {
  return row.group === 'working';
}

/**
 * The live indicator: a small dot breathing between two opacities.
 *
 * Tailwind's own `animate-pulse` with `motion-reduce:animate-none`. This is the
 * board's FIRST animation, so the smallest possible introduction is the right
 * one — no new CSS file, no keyframe of our own, and the reduced-motion variant
 * arrives with the utility rather than needing its own media query.
 *
 * A pulse rather than a spinner, on a plain count: WORKING regularly holds
 * several rows — four agents ran in parallel on 2026-08-16 — and four rotating
 * spinners in a column is flicker, not information. Rotation also implies
 * *progress toward completion*, which nothing here measures; a pulse implies
 * *aliveness*, which is the claim being made.
 *
 * BEFORE the row rather than inside the note, because the note is where the row
 * states its facts and motion there competes with reading them. A leading dot
 * needs no column of its own and scales from one row to eight.
 *
 * `aria-hidden`, because it is decoration on top of information and never the
 * carrier of it. A screen reader already gets the group heading and the row's
 * own text; the same rule the contract sets for colour — *carried as a symbol
 * AND a word, never as colour alone* — and this passes it by design rather than
 * by luck. Under reduced motion the dot STAYS and only the animation stops:
 * removing the element would lose the marker along with the movement.
 */
function LiveDot() {
  return (
    <span
      aria-hidden
      data-live-dot
      // `sm:absolute` keeps it out of the track list: the grid has six columns
      // and this is a seventh thing, so it hangs in the row's left padding
      // rather than pushing every real column in from the edge to reserve a
      // place most rows never use. Below `sm` it flows inline with the rest.
      className="h-1.5 w-1.5 shrink-0 self-center animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none sm:absolute sm:left-1 sm:top-1/2 sm:-translate-y-1/2 dark:bg-emerald-400"
    />
  );
}

/**
 * Why this row offers no action — in the row's own words.
 *
 * A disabled control without a reason is the kind that makes people guess, and
 * this row already knows: the note beside it says *blocked by an earlier wave*
 * or *no commit for 22 days*. So the `title` says that, turning a dead
 * affordance into an explanation rather than a generic "no actions".
 *
 * The note is preferred wherever there is one; the fallback covers the rows that
 * carry none (a group whose classifier left the note empty), where naming the
 * group is still more than nothing.
 *
 * Exported for test — a generic string passes any assertion that only checks a
 * title exists.
 */
export function noActionReason(row: AgentRow): string {
  return row.note ? `No action available — ${row.note}` : 'No action available on this row';
}

/**
 * The row's actions, behind a three-dot menu at the right edge.
 *
 * `Start work` used to sit at the far right AFTER the age, so the line read
 * *what · state · age · act* — the action behind the quietest number on it. And
 * it is about to stop being alone: `board-becomes-operable` adds `Approve`, and
 * every further action would widen a row that already carries phase, plan,
 * branch, note, PR and age and wraps on long branch names.
 *
 * The menu holds only things that CHANGE something. Navigation stays in the row,
 * where the thing is named — a `cmd`-click on a real plan or branch link is
 * worth more than a tidier line. The menu acts; the row shows.
 *
 * **With no action it renders anyway, disabled.** A deliberate exception to the
 * rule this estate applies elsewhere (*a button whose usual state is "you
 * cannot" teaches people to ignore buttons*), and the distinction is what a
 * control CLAIMS. A dead `Start work` lies: it names an action that does not
 * exist here. A dimmed three-dot menu claims only *this is where actions would
 * be*, which is true on every row.
 *
 * The layout argument decides it. Most rows have no action, so rendering nothing
 * would leave the right edge ragged — and MOVING, since the pulse re-scans every
 * five seconds and a row gaining or losing its action would shift the column
 * under someone's eyes. That is the same objection this view raises against
 * groups that fold themselves.
 *
 * `aria-disabled`, never the native `disabled`: a natively disabled element
 * leaves the tab order and takes the explanation with it, putting it out of
 * reach of anyone who is not hovering with a mouse.
 */
function RowActions({
  row,
  card,
  dispatch,
  pulse,
  onStarting,
}: {
  row: AgentRow;
  card: Card | null;
  dispatch?: DispatchInfo;
  pulse: number;
  onStarting?: (active: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const canStart = Boolean(card && dispatch && isStartable(row));
  // The menu opens only if something inside it could ACT.
  //
  // `canStart` answers "is this row startable"; it does not answer "will the
  // server act", and the two came apart the moment the board learned to dim.
  // Without this the three-dot menu still opened on a frozen page and still
  // offered `Start work` on data minutes old — the exact invitation this wave
  // exists to withdraw, and one that a scrim alone does not reach, because a
  // keyboard reader never touches the scrim.
  //
  // The reason travels to the control, so the dimmed menu explains itself
  // rather than reading as a bug. Same pattern the row already uses for a row
  // with nothing to do.
  const serverWillAct = dispatch?.available ?? false;
  const enabled = canStart && serverWillAct;
  const reason =
    canStart && !serverWillAct && dispatch?.reason ? dispatch.reason : noActionReason(row);

  // Close on Escape and on any click outside. A menu that survives a click
  // elsewhere on a view that repaints every five seconds is a menu that ends up
  // hovering over a row it no longer belongs to.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    // Capture phase, so the menu closes before a click lands anywhere else —
    // and the menu's own container stops propagation rather than relying on
    // hit-testing the target against a ref.
    document.addEventListener('click', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDown, true);
    };
  }, [open]);

  return (
    // Fixed width whether or not anything is in it: the difference between
    // available and not is CONTRAST, not presence, so the right edge holds
    // still while rows gain and lose their actions. In the grid it also has a
    // track of its own (`1.25rem`), so that stillness now holds across rows as
    // well as across refreshes.
    <div
      role="gridcell"
      className="relative w-5 shrink-0 text-right"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        data-row-actions
        aria-haspopup="menu"
        aria-expanded={open}
        // Never the native attribute. `aria-disabled` keeps the control
        // focusable, so the title explaining WHY is reachable by keyboard.
        aria-disabled={!enabled || undefined}
        aria-label={enabled ? `Actions for ${row.branch}` : reason}
        title={enabled ? `Actions for ${row.branch}` : reason}
        onClick={() => { if (enabled) setOpen((v) => !v); }}
        className={
          enabled
            ? 'text-xs leading-none text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
            : // Very dim: a row with nothing to do stays quiet, and the menu
              // reads as scenery rather than as an offer.
              'cursor-default text-xs leading-none text-slate-300 dark:text-slate-700'
        }
      >
        ⋯
      </button>
      {open && enabled && card && dispatch && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 min-w-max rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div role="menuitem" className="px-2 py-1 text-left">
            <StartWorkButton
              card={card}
              dispatch={dispatch}
              pulse={pulse}
              onStarting={onStarting}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export interface AgentListProps {
  fleet: Fleet;
  /**
   * Seconds between fleet polls, or null when the tab is not open and nothing
   * is polling. Null suppresses the git countdown: a counter ticking toward a
   * refresh that is not coming is the same false statement this view exists to
   * remove.
   */
  pollSeconds: number | null;
  /**
   * Seconds since the last fetch that reached the server, or null while it is
   * still being reached.
   *
   * A DIFFERENT failure from `fleet.error`, and the reason this is a prop
   * rather than a field. `fleet.error` is the server reporting that its own
   * scan failed — a payload arrived, saying so. This is no payload at all: the
   * server is not answering, and nothing inside a document the client never
   * received can say that. It cost a misdiagnosis on 2026-08-16, when a page
   * whose server had died kept drawing its last pulse with a countdown clamped
   * at "next in 0s" and ages that went on advancing.
   *
   * Non-null on the FIRST failed fetch. The two outcomes are not symmetric: a
   * hiccup that briefly reads "last heard 4s ago" costs nothing and clears
   * itself on the next poll, while a dead server that looks healthy for two
   * poll intervals costs a diagnosis.
   */
  staleSeconds?: number | null;
  /**
   * Open a plan in the board's own modal. Absent — or returning false — where
   * the board has no card for that plan, and the plan name then stays a plain
   * link to `/plan/<file>` rather than opening an empty modal.
   */
  onOpenPlan?: (planFile: string) => boolean;
  /**
   * This row's plan as a board card, or null where the board holds none.
   *
   * `StartWorkButton` takes a `Card` and a fleet row is not one, so the lookup
   * is the caller's — the same one the plan link already uses. Null is a real
   * answer rather than a degraded one (a plan outside the walked directories
   * has a row and no card), and the row then renders no button rather than a
   * broken one. Absent entirely before the board's first payload lands, which
   * is also no button: an unknown card is not a missing one, but neither can be
   * dispatched.
   */
  cardForPlanFile?: (planFile: string) => Card | null;
  /**
   * Whether this server will act on Start work, and why not. Absent where the
   * board has not said — no button renders at all, rather than one whose
   * outcome is unknown. Same rule `PlanCard` follows.
   */
  dispatch?: DispatchInfo;
  /** Bumps once per BOARD refresh; the Start work button counts these. */
  pulse?: number;
  /** A Start work click became outstanding (true) or settled (false). */
  onStarting?: (active: boolean) => void;
}

/**
 * The plan's name as a link into the board's own modal.
 *
 * Shared by the row and by the group heading, because grouping moves the name
 * from one to the other and the CLICK has to move with it — the first cut left
 * the heading as plain text and quietly dropped the only way to open the plan.
 *
 * A real anchor, so cmd/ctrl/shift/middle-click open natively and only a plain
 * primary click is intercepted. `onOpenPlan` returns false where the board has
 * no matching card, and the navigation then proceeds — the honest fallback.
 */
function PlanLink({
  plan,
  planFile,
  onOpenPlan,
}: {
  plan: string;
  planFile: string;
  onOpenPlan?: AgentListProps['onOpenPlan'];
}) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenPlan) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!onOpenPlan(planFile)) return;
    e.preventDefault();
  };
  if (!planFile) return <>{plan}</>;
  return (
    <a
      href={`/plan/${encodeURIComponent(planFile)}`}
      onClick={handle}
      target={onOpenPlan ? undefined : '_blank'}
      rel="noreferrer"
      className="text-blue-600 hover:underline dark:text-blue-400"
    >
      {plan}
    </a>
  );
}

/**
 * The branch name, folded in the MIDDLE when the cell cannot hold it.
 *
 * Two spans rather than one: the head clips (`truncate`, so the browser adds
 * its own ellipsis at exactly the width it has) and the tail does not
 * (`shrink-0`), which is middle-elision performed by the layout rather than by
 * arithmetic. See `splitBranch` for why the tail is the half that must survive.
 *
 * The FULL name is always in `title` and in the row's accessible text, so
 * nothing is lost — only folded. `min-w-0` on the wrapper is what allows the
 * head to shrink at all: a flex item defaults to `min-width: auto` and would
 * otherwise refuse to go below its content, pushing the PR and age cells the
 * grid exists to hold still.
 *
 * Below `sm` there is no folding to do — the branch has a line of its own
 * (`whitespace-normal break-all`), because the card form drops nothing and
 * elides nothing.
 */
function BranchName({ row }: { row: AgentRow }) {
  const { head, tail } = splitBranch(row.branch);
  const inner = (
    <>
      <span className="truncate sm:max-w-full">{head}</span>
      {tail && <span className="shrink-0">{tail}</span>}
    </>
  );
  const className =
    'flex min-w-0 font-mono text-[13px] max-sm:flex-wrap max-sm:break-all';
  return row.branchUrl ? (
    <a
      href={row.branchUrl}
      target="_blank"
      rel="noreferrer"
      data-branch={row.branch}
      className={`${className} text-blue-600 hover:underline dark:text-blue-400`}
      title={`Branch ${row.branch} on the git host`}
    >
      {inner}
    </a>
  ) : (
    <span
      data-branch={row.branch}
      className={`${className} text-slate-800 dark:text-slate-200`}
      title={row.branch}
    >
      {inner}
    </span>
  );
}

/**
 * The column names, on the same tracks as the rows beneath them.
 *
 * This is what lets the phase's `sr-only` prefix go. The list used to be a
 * `<li>` of `<span>`s — as the old comment said, *"a visual table with no table
 * semantics"* — so column position conveyed nothing and each row was heard as a
 * run of words. `Development` does not announce itself as a phase, and every
 * cell needed a label of its own to compensate. With a header row a screen
 * reader announces the column, once, for every cell under it.
 *
 * `sr-only` on screen and real in the accessibility tree. The six columns are
 * legible to a sighted reader from their alignment — that alignment is the
 * whole point of this wave — and printing the words above every one of six
 * groups would cost six lines of chrome that never varies. The reader who
 * cannot see the alignment is exactly the reader who needs the names.
 *
 * NOT a `<table>`. The rows carry interactive controls and sit inside a
 * collapsible group structure with per-plan sub-headings; table markup would
 * fight that grouping rather than serve it. `role="grid"` on the `<ul>` keeps
 * the DOM and gains the semantics.
 *
 * Hidden below `sm`, where the row stops being a row: a card has no columns for
 * a header to name, and the phase cell takes its own label back there.
 */
function HeaderRow() {
  return (
    <li role="row" className="sr-only max-sm:hidden">
      <span role="columnheader">Phase</span>
      <span role="columnheader">Plan</span>
      <span role="columnheader">Branch</span>
      <span role="columnheader">Pull request</span>
      <span role="columnheader">Age</span>
      <span role="columnheader">Actions</span>
    </li>
  );
}

function Row({
  row,
  onOpenPlan,
  planInHeading = false,
  card = null,
  dispatch,
  pulse = 0,
  onStarting,
}: {
  row: AgentRow;
  onOpenPlan?: AgentListProps['onOpenPlan'];
  /**
   * True when a sub-heading above these rows already names the plan. The row
   * then omits it rather than printing the same name on every line — the
   * heading exists to save that repetition, so repeating it anyway would leave
   * the group wordier than it was before grouping.
   */
  planInHeading?: boolean;
  /** This row's plan as a board card, or null where the board has none. */
  card?: Card | null;
  /** Whether this server will act on Start work, and why not. */
  dispatch?: DispatchInfo;
  /** Bumps once per board refresh; the Start work button counts these. */
  pulse?: number;
  /** A Start work click became outstanding (true) or settled (false). */
  onStarting?: (active: boolean) => void;
}) {
  // Same convention as the card's Open control: a real anchor, so
  // cmd/ctrl/shift/middle-click open natively, and only a plain primary click is
  // intercepted. `onOpenPlan` returns false when the board holds no matching
  // card — the navigation then proceeds, which is the honest fallback.
  const handlePlan = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenPlan) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!onOpenPlan(row.planFile)) return;
    e.preventDefault();
  };

  // What the note still has to say once the PR cell carries the PR's own
  // condition — see `noteWithoutPr`. Computed once: it is read three times
  // below (the guard, the title and the text), and three calls is how they
  // drift.
  const note = noteWithoutPr(row.note, row.pr);

  return (
    // Below `sm` a card, at `sm` and above a grid — and the two are one element
    // rather than two renders. A JS breakpoint would need a resize listener on
    // a view that already repaints every four seconds, and it would render the
    // wrong shape for one frame on every load; the media query is evaluated
    // before first paint and costs nothing.
    //
    // The card form wraps: branch on its own line (`w-full`), then plan, phase,
    // PR and age beneath it as one wrapped line. Nothing is dropped and nothing
    // is elided — the same facts stack instead of ranging.
    <li
      role="row"
      data-agent-row
      className={`relative flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-200/60 px-3 py-2 text-sm last:border-0 sm:grid ${ROW_TRACKS} sm:items-baseline sm:gap-x-3 dark:border-slate-800`}
    >
      {/* The live indicator, on `working` rows only. `self-center` because the
          row aligns on the text baseline and a dot carries no text to align —
          on the baseline it would sit low against the words beside it.

          Absolutely positioned in the grid rather than taking a track: it is
          decoration, and a seventh track for it would push the six real columns
          in from the edge on every row in the fleet to make room for a mark
          most rows do not carry. In the card form it flows inline, where the
          wrap makes position mean nothing anyway. */}
      {isLive(row) && <LiveDot />}
      {/* The phase takes the REPO's place rather than adding a seventh cell to
          a row that already wraps on `feature/opus5-hardening-challenge-budget`.
          The repo is the right thing to give up: constant in a one-repo board,
          rendered nowhere else in the app, and a column showing the same word on
          every row is chrome that never varies. The board's cards keep repo
          context if a second repo ever appears.

          `w-24` rather than the repo's `w-16`, which fits 8–9 characters at
          `text-xs`: "Development" is 11 and would render "Developm…", worse
          than nothing.

          SPELLED OUT, not abbreviated and not an icon. Discovery, Design and
          Development all begin with D (and `DE` covers two of them), and
          `PHASE_LEADERSHIP` maps 👤 to Discovery, Design AND Endgame because it
          encodes who LEADS rather than which phase — an icon column would
          collapse exactly the three this one exists to separate. The contract's
          "symbol AND word" rule is not violated by the word travelling alone:
          that rule exists to stop COLOUR being the sole carrier, and a word is
          already the non-colour channel.

          The `sr-only` prefix that used to sit here is GONE. It existed, as
          this comment used to say, because the list was "a visual table with no
          table semantics" — column position conveyed nothing and each row was
          heard as a run of words. The row is now a `role="row"` of
          `role="gridcell"`s under a header carrying `role="columnheader"`, so a
          screen reader announces the column name itself. Keeping the prefix as
          well would have the column announced twice.

          It survives BELOW `sm` and only there (`sm:hidden`), because that is
          where the header goes with the columns: a card has no columns to be
          announced by, so the word `Development` would once again arrive with
          nothing saying what it is. The prefix is gone from the grid — where
          the header replaced it — rather than gone from the app.

          Empty where the row has no honest phase — a plan that is rejected,
          superseded or simply unknown — rather than guessing a column. And
          empty now leaves a GAP rather than shifting its neighbours, which is
          the entire point of the tracks. */}
      <span
        role="gridcell"
        className="min-w-0 shrink-0 truncate text-xs text-slate-500 dark:text-slate-400"
        title={row.phase ? `Phase: ${row.phase}` : undefined}
      >
        {row.phase && (
          <>
            <span className="sr-only sm:hidden">Phase: </span>
            <span data-phase={row.phase}>{row.phase}</span>
          </>
        )}
      </span>
      {/* Plan BEFORE branch: what this belongs to, then which slice of it — the
          order in which the tab is read. It also lets rows of one plan form a
          visible column, reinforcing the grouping rather than repeating it;
          with the branch first, branch names of differing length left the plan
          column frayed across six rows of the same plan.

          Opens the plan viewer in the board's own modal — the Agents tab is a
          live view that polls every 4 s, and navigating away in place would cost
          the reader the thing they came to watch. The href stays real so a
          modified click still opens the page, and so a plan with no board card
          simply navigates.

          The CELL is always rendered, even when the heading carries the name —
          an empty track holds its width, so a headed group's rows align on
          branch with an unheaded group's rows. That alignment is exactly what
          `showPlanHeading` broke when it made the plan cell conditional. */}
      <span role="gridcell" className="min-w-0 truncate">
        {planInHeading ? null : row.planFile ? (
          <a
            href={`/plan/${encodeURIComponent(row.planFile)}`}
            onClick={handlePlan}
            target={onOpenPlan ? undefined : '_blank'}
            rel="noreferrer"
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
            title={row.plan}
          >
            {row.plan}
          </a>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400" title={row.plan}>
            {row.plan}
          </span>
        )}
      </span>
      {/* Every link goes where its text says. The branch name opens the BRANCH —
          it used to open the PR, which is surprising in both directions. An
          empty `branchUrl` is a merged branch (its remote page is gone) or an
          origin the server does not recognise; both render as plain text rather
          than as an invented address.

          The branch takes `1fr` and is the ONLY cell that flexes, because it is
          the longest and most variable value here and the one worth reading in
          full.

          On its own line below `sm` (`w-full sm:w-auto`): it is the row's
          primary key, so the card leads with it and wraps everything else
          beneath.

          `deferred` rides INSIDE this cell rather than taking a track of its
          own — it qualifies the branch's state, and a seventh column carrying
          nothing on all but a handful of rows is the chrome the phase cell
          replaced the repo to avoid. */}
      <span
        role="gridcell"
        className="flex w-full min-w-0 items-baseline gap-2 sm:w-auto"
      >
        <BranchName row={row} />
        {/* Carried BESIDE the state, never instead of it — the same shape as the
            `no story` badge on a plan card: mark the thing, do not bend the
            state to encode it.

            Both halves are needed and neither alone is the answer. The phase has
            already fallen back a step (a deferred branch under an approved plan
            reads Design), because `deferred` means the branch *isn't needed* and
            was given up deliberately — `plot-deliver` skips such branches, so a
            plan delivers without them. But a bare Design row is indistinguishable
            from one nobody ever started, and that is the fact the badge carries:
            this did not fall back because nobody began it, but because someone
            handed it back. */}
        {row.state === 'deferred' && (
          <span
            className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            title="Handed back — the branch was given up deliberately, and the plan can deliver without it"
          >
            deferred
          </span>
        )}
      </span>
      {/* The PR, rendered from the row's fields — and the note beside it,
          relieved of the one duty the fields now carry.

          ONE track for both, because they answer one question between them:
          *what is this waiting for*. The PR cell says what a PR state can say;
          the note says what it cannot — *uncommitted work*, *blocked by an
          earlier wave*, *claimed elsewhere*. This is the cell the old layout
          pushed right with `ml-auto`, which is what collected the row's whole
          slack between the branch and here and left no two rows agreeing on
          where anything sat.

          The note truncates where the PR cell has left it no room, with the
          full text in `title` — the same bargain the branch makes, and the
          reason the track is fixed at all. The PR is the half kept whole: it is
          bounded (`⑂1234 conflicts` is the longest it gets) while the note is
          not.

          A row with no PR shows only the note, and a row with no note only the
          PR; both hold the same width either way, which is the gap-not-shift
          rule applied inside the cell as well as between cells. */}
      <span role="gridcell" className="flex min-w-0 items-baseline gap-2">
        <PrCell pr={row.pr} />
        {note && (
          <span
            data-row-note
            className="min-w-0 truncate text-xs text-slate-500 max-sm:whitespace-normal dark:text-slate-400"
            title={note}
          >
            {note}
          </span>
        )}
      </span>
      {/* ONE age column, answering "how old is this" once.
          
          A row with no branch has no tip to date, so the column read "—" while
          a second badge mid-row carried the answer: two places for one
          question, one of them empty. The waiting age takes the column when
          there is no commit age, and the distinction that matters — a plan
          approved 6mo ago is not a branch untouched for 6mo — is carried by
          colour and title rather than by a second position.
          
          Still nothing where no approval date is recorded: absent, not zero. */}
      {row.ageMinutes === null && row.waitingDays !== null ? (
        <span
          role="gridcell"
          className="shrink-0 text-right text-xs tabular-nums text-amber-700 dark:text-amber-500"
          title="Approved this long ago, and nobody has started it"
        >
          {waitingLabel(row.waitingDays)}
        </span>
      ) : (
        <span
          role="gridcell"
          className="shrink-0 text-right text-xs tabular-nums text-slate-400 dark:text-slate-500"
        >
          {age(row)}
        </span>
      )}
      {/* The row's actions, behind one menu at the right edge — and the menu
          renders on EVERY row, dimmed where there is nothing to do.

          `Start work` used to sit here bare, after the age, which put the
          action behind the quietest number on the line. It is also about to
          stop being alone (`board-becomes-operable` adds `Approve`), and a row
          that already carries phase, plan, branch, note, PR and age has no
          width left to spend on a second control.

          On the ROW, not on the group: a `not-started` group can hold branches
          from several plans, and dispatch is per plan and wave — a group-level
          control would have to guess which. Per row, the row has already
          decided.

          The card is looked up by `planFile` from the board payload, because
          `StartWorkButton` takes a `Card` and a fleet row is not one. A row
          whose plan has no card gets a DISABLED menu rather than a broken
          button — the same honest fallback the plan link makes, now with a
          reason attached. */}
      <RowActions
        row={row}
        card={card}
        dispatch={dispatch}
        pulse={pulse}
        onStarting={onStarting}
      />
    </li>
  );
}

/**
 * The git host's own pull-request glyph.
 *
 * It replaces the word `PR`, **never the state**. `PR #157, draft` is fifteen
 * characters in a cell that must hold a fixed width; `⑂157 draft` is roughly
 * nine, and the difference decides whether the cell truncates. The repo's rule
 * is *symbol AND word* — a symbol may never be the sole carrier — and this does
 * not breach it: the number stays, the state stays as a word, and only the
 * label `PR` becomes a mark that means *pull request* in every git host's own
 * UI.
 *
 * Rendered as an inline SVG rather than an image or an icon font, so the
 * artifact stays self-contained the way the rest of the board is — the board
 * ships as ONE file, and a remote asset would be a hole in it.
 *
 * `aria-label` rather than `aria-hidden`, because a bare `157` announces
 * nothing: unlike the live dot, whose meaning the group heading already states,
 * this glyph carries the only word saying what the number IS.
 */
function PrGlyph() {
  return (
    <svg
      role="img"
      aria-label="Pull request"
      viewBox="0 0 16 16"
      className="inline-block h-3 w-3 shrink-0 align-[-0.1em]"
      fill="currentColor"
    >
      {/* Two verticals joined by a curve, with a dot on each end: the shape a
          pull request wears in GitHub, GitLab and Bitbucket alike. */}
      <path d="M4.5 3.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM2 4.5a2.5 2.5 0 1 1 3.13 2.42v2.16a2.5 2.5 0 1 1-1.25 0V6.92A2.5 2.5 0 0 1 2 4.5Zm2.5 6.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm7-8a2.5 2.5 0 0 1 .63 4.92v2.16a2.5 2.5 0 1 1-1.25 0V6.92A2.5 2.5 0 0 1 11.5 3.25Zm0 1.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm0 6.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z" />
    </svg>
  );
}

/**
 * The PR cell, rendered from the row's FIELDS.
 *
 * What it replaces: a string search for `PR #<n>` inside the note, applied so
 * the substring could be linked. That was a parser for a format nobody
 * declared — it silently rendered an unlinked note whenever the server's
 * wording drifted, and it could not produce a badge without taking the sentence
 * back apart. The number, the draft flag and the state now arrive as data, so
 * the cell composes them directly.
 *
 * **`draft` and `state` are two badges, not one.** They answer different
 * questions — *is this offered for review* and *what is it waiting for* — and
 * they are independent: a draft has CI like anything else. Folding draft into
 * the state would rebuild the short-circuit that kept WAITING ON A MACHINE
 * empty for three releases.
 *
 * Empty where the row has no PR, and that emptiness is now a GAP rather than a
 * shift: the track holds its width, so the age and menu beside it stay put.
 */
function PrCell({ pr }: { pr: AgentRow['pr'] }) {
  if (!pr) return null;
  const word = prStateWord(pr.state);
  const number = (
    <span className="tabular-nums">
      <PrGlyph />
      {pr.number}
    </span>
  );
  return (
    <span className="flex min-w-0 items-baseline gap-1 text-xs text-slate-500 dark:text-slate-400">
      {/* An empty `url` is a host that reported no address — the number then
          renders as plain text rather than as an invented link, the same rule
          the branch cell follows for a merged branch. */}
      {pr.url ? (
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          data-pr-link
          className="shrink-0 text-blue-600 hover:underline dark:text-blue-400"
        >
          {number}
        </a>
      ) : (
        <span data-pr-number className="shrink-0">{number}</span>
      )}
      {pr.draft && (
        <span
          data-pr-draft
          className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          title="Draft — not yet offered for review"
        >
          draft
        </span>
      )}
      {word && (
        // The state as a WORD, never as colour alone. Colour reinforces it for
        // the two values a reader acts on; `unknown` renders nothing at all,
        // because a word saying only *this board could not find out* is noise
        // on every row of a host that carries no rollup.
        <span
          data-pr-state={pr.state}
          className={
            pr.state === 'conflicts' || pr.state === 'failing'
              ? 'truncate text-rose-700 dark:text-rose-400'
              : pr.state === 'green'
                ? 'truncate text-emerald-700 dark:text-emerald-500'
                : 'truncate'
          }
        >
          {word}
        </span>
      )}
    </span>
  );
}

export function AgentList({
  fleet,
  pollSeconds,
  staleSeconds = null,
  onOpenPlan,
  cardForPlanFile,
  dispatch,
  pulse = 0,
  onStarting,
}: AgentListProps) {
  // Whether the server is answering at all. Not the same question as
  // `fleet.error`, which is a server that answered to say its scan failed.
  const stale = staleSeconds !== null;

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

  // Degrade, do not hide: before the first scan lands this says so rather than
  // showing an empty list, which would read as "no agents are working".
  //
  // Deliberately BEFORE the staleness check and deliberately unchanged by it: a
  // tab that has never had an answer cannot have one it no longer trusts. The
  // two are different statements, and merging them would make an empty view
  // claim data it never held.
  if (!fleet.ready && !fleet.error) {
    return <p className="text-sm text-slate-500">Waiting for the first fleet scan…</p>;
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

  return (
    <div className="space-y-4">
      {/* The dead-server banner, ABOVE the scan-failure one and separate from
          it. Two different failures: the server saying its scan broke, and the
          server saying nothing at all. Both can be true — a scan that failed,
          then a process that died — and the reader needs to know which they are
          looking at, so neither replaces the other.

          It names the number that was missing on 2026-08-16: how long ago the
          last answer arrived. The frozen page gave no way to tell it apart from
          a live one, and three hypotheses were spent before anyone checked what
          was actually running. */}
      {stale && (
        <p
          role="status"
          className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
        >
          Not reaching the board server — last heard {staleSeconds}s ago. The
          numbers below are frozen at that moment and are no longer being
          checked.
        </p>
      )}

      {fleet.error && (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Last scan failed: {fleet.error}
          {fleet.ready && ' — showing the last successful pulse below.'}
        </p>
      )}

      {GROUPS.map(({ key, icon, label, hint }) => {
        const rows = fleet.rows.filter((r) => r.group === key);
        // Every waiting-group is grouped the same way, `done` included: it is
        // the group that grows fastest over a working day, so it is the first to
        // become a list one scrolls past. A rule with an exception for the group
        // nobody reads is a rule someone has to remember.
        const plans = groupByPlan(rows);
        // Headings are decided PER GROUP, not per section — see
        // `showPlanHeading`. A section-wide answer gave a heading to every
        // group once any group earned one, so a plan with a single row got a
        // heading that labelled the one line beneath it.
        //
        // The half that is easy to lose: a group WITHOUT a heading has nowhere
        // else to name its plan, so its row must print the name itself. That is
        // why `planInHeading` is computed from this group's own answer below
        // rather than from a section-wide flag — in a mixed section (one plan
        // with several rows beside a plan with one) a single flag is wrong for
        // one of them either way.
        // An empty group is never foldable — it hides nothing, and its header
        // carries the HINT rather than `(0)`, which is the one thing in there
        // worth reading when there is nothing to list.
        const collapsible = isCollapsible(rows.length);
        const isFolded = collapsible && collapsed.has(key);
        // The count and the hint occupy the same slot, and the count SURVIVES
        // folding: `QUIET (7)` states plainly that seven rows are hidden, while
        // a folded header with no number reads as *nothing here* — worse than
        // the crowding this fixes.
        const tally = (
          <span className="font-normal normal-case tracking-normal text-slate-400 dark:text-slate-600">
            {rows.length > 0 ? `(${rows.length})` : hint}
          </span>
        );
        return (
          <section key={key}>
            <h2 className="mb-1 flex items-baseline gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              {collapsible ? (
                // A real button, so the header is reachable and operable by
                // keyboard. `aria-expanded` is what tells a screen reader the
                // section is folded — the caret alone is a visual fact.
                <button
                  type="button"
                  data-group-toggle={key}
                  aria-expanded={!isFolded}
                  onClick={() => toggle(key)}
                  className="flex items-baseline gap-2 uppercase tracking-wide hover:text-slate-900 dark:hover:text-slate-100"
                >
                  <span aria-hidden className="text-[10px]">{isFolded ? '▸' : '▾'}</span>
                  <span aria-hidden>{icon}</span>
                  {label}
                  {tally}
                </button>
              ) : (
                <>
                  <span aria-hidden>{icon}</span>
                  {label}
                  {tally}
                </>
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
              className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40"
            >
              <HeaderRow />
              {rows.length > 0 ? (
                plans.map((group) => {
                  // ONE answer per group, read by both the heading and its
                  // rows. Computing it twice is how they drift: a heading that
                  // renders while its rows also print the plan name says it
                  // twice, and the reverse loses the name entirely.
                  const headed = showPlanHeading(group);
                  return (
                  // `rowgroup`, so the grid's children are rows and groups of
                  // rows rather than an unnamed `<li>` the tree cannot place.
                  // The per-plan sub-heading and its rows are exactly what a
                  // rowgroup is for.
                  <li role="rowgroup" key={group.plan}>
                    {/* A nameless group holds rows no plan claims, so there is
                        nothing to head them WITH: rendering the heading anyway
                        printed a bare "(3)", a label that labels nothing.
                        `showPlanHeading` already refuses those. */}
                    {headed && (
                      <h3 className="border-b border-slate-200/60 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
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
                    <ul role="presentation">
                      {group.rows.map((r) => (
                        <Row
                          key={`${r.repo}/${r.branch}`}
                          row={r}
                          onOpenPlan={onOpenPlan}
                          planInHeading={headed}
                          // Looked up per row rather than per group: a row's
                          // plan is what dispatch takes, and only the rows that
                          // are startable ever use it.
                          card={cardForPlanFile?.(r.planFile) ?? null}
                          dispatch={dispatch}
                          pulse={pulse}
                          onStarting={onStarting}
                        />
                      ))}
                    </ul>
                  </li>
                  );
                })
              ) : (
                // A row of one cell: the grid holds no branches, and saying so
                // is still a row of the grid rather than something beside it.
                <li role="row" className="px-3 py-2 text-sm text-slate-400 dark:text-slate-600">
                  <span role="gridcell">none</span>
                </li>
              )}
            </ul>
            )}
          </section>
        );
      })}

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
        {new Set(fleet.rows.map((r) => r.plan).filter(Boolean)).size} plans · scanned{' '}
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
      {fleet.prError && (
        <p className="px-3 text-xs text-amber-700 dark:text-amber-400">
          PR data unavailable ({fleet.prError.slice(0, 80)}) — the two groups above that
          depend on it may be incomplete.
        </p>
      )}
    </div>
  );
}
