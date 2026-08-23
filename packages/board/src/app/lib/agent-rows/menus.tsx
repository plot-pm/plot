/**
 * Menu components for row actions — the three-dot menus on branch, plan, wave,
 * and issue rows.
 *
 * Extracted from `AgentList.tsx` as wave 2 of
 * `the-derivations-leave-the-component`. The derivations (host notes, activity,
 * waves, sections, etc.) left in wave 1; the RENDERED components — the marks,
 * the row adapters, and these menus — leave here.
 *
 * Each menu serves a different subject:
 * - `BranchMenu`: a branch's actions + panels (worker log, dispatcher log, changed files)
 * - `RowActions`: the three-dot menu on a branch/PR/release row
 * - `PlanActions`: the plan row's menu (Approve, Commission design, Deliver)
 * - `WaveActions`: the wave row's menu (Start work on an eligible wave)
 * - `ResliceMenu`: the unsliced wave's menu (Slice this wave)
 * - `IssueRowActions`: the tracker issue row's menu (Create plan, Create story, Open)
 */
import { useState, useRef, useEffect } from 'react';
import type { AgentRow, Card, DispatchInfo, IssueAnswer, IssueRow } from '../../../contract/schema.js';
import { ApproveButton } from '../../components/ApproveButton.js';
import { CommissionDesignButton } from '../../components/CommissionDesignButton.js';
import { CreatePlanButton } from '../../components/CreatePlanButton.js';
import { DeliverButton } from '../../components/DeliverButton.js';
import { ResliceButton } from '../../components/ResliceButton.js';
import { StartWorkButton } from '../../components/StartWorkButton.js';
import { WorkerLogModal } from '../../components/WorkerLogModal.js';
import { DispatchLogModal } from '../../components/DispatchLogModal.js';
import { ChangedFilesModal } from '../../components/ChangedFilesModal.js';
import { isDraft } from '../../components/PlanCard.js';
import { offersChangedFiles } from './stuck.js';
import { changedFilesLabel } from './actions.js';
import { isStartable } from './row-identity.js';

// Re-export helper functions that the shell needs
export { isStartable };

/**
 * Whether this row leads with its PR page, where a reader can review, or with
 * its branch, where a reader must go to rebase.
 *
 * Exported here so the shell can import it without reaching into `AgentList.tsx`.
 */
export function rowSubjectForMenu(row: Pick<AgentRow, 'pr' | 'branch'>): 'pr' | 'branch' {
  if (!row.pr) return 'branch';
  if (row.pr.states.includes('conflicts')) return 'branch';
  return 'pr';
}

/**
 * Whether a row shows `Open` / `Review` in its menu.
 *
 * Only WAITING ON YOU rows — where there is something to do. A `quiet` or
 * `done` row has an address too, but an Open item there is the empty menu
 * `one-place-for-what-a-row-can-do` removed, one section over.
 */
export function offersOpen(row: Pick<AgentRow, 'pr' | 'branchUrl' | 'group'>): boolean {
  return row.group === 'waiting-on-you' && openTarget(row) !== '';
}

/**
 * What the Open/Review item links to — the PR page or the branch on the host.
 */
export function openTarget(row: Pick<AgentRow, 'pr' | 'branchUrl'>): string {
  return row.pr?.url || row.branchUrl || '';
}

/**
 * What the Open item says — *Review* for a PR, *Open* for a branch.
 *
 * Opening a PR IS reviewing it: the reader lands on the page where the diff, the
 * comments and the merge button live. A bare branch has no such page — *Open*
 * takes them to the branch on the host, and there is nothing to review yet. The
 * verb follows what the click actually does, the same rule that took *failing*
 * off the run link when its condition widened.
 */
export function openLabel(row: Pick<AgentRow, 'pr'>): string {
  return row.pr ? 'Review' : 'Open';
}

/**
 * Whether a row offers its worker log in the menu.
 *
 * A WORKING row — one the fleet placed in WORKING and the registry knows about.
 * The panel decides whether a log exists; the item is offered on membership.
 */
export function showsWorkerLog(row: AgentRow): boolean {
  return row.group === 'working';
}

/**
 * Why a row offers no actions at all — the tooltip on a dimmed menu.
 */
export function noActionReason(row: AgentRow): string {
  return row.note ? `No action available — ${row.note}` : 'No action available on this row';
}

/**
 * What the run link says — *Show failure* where the row IS failing, *Open last
 * run* elsewhere.
 *
 * `Show failure` only where there is a failure to SHOW. A PR whose rollup is
 * `failing` has one. A `ci-failing` row usually does — but not once its NEWEST
 * run has gone green: the row is still classed failing on an earlier check
 * while the run this link opens passed, and promising a failure there is the
 * very over-claim the widening (#269) took the word *failing* off this link to
 * avoid. So the ci case defers to the newest run's own conclusion.
 */
export function runLinkLabel(row: Pick<AgentRow, 'pr' | 'stuck'>): string {
  const newestRun = row.stuck?.runHistory[0];
  const ciShowsFailure = row.stuck?.state === 'ci-failing'
    && (!newestRun || (newestRun.conclusion ?? '') !== 'success');
  const failing = row.pr?.state === 'failing' || ciShowsFailure;
  return failing ? 'Show failure' : 'Open last run';
}

/**
 * Why *Create story* is offered but cannot act from the board — the reason it
 * carries on its own control, the settled refusal rule.
 *
 * **It is offered, and it always refuses, and both halves are the design.** The
 * ticket menu names *Create story* beside *Create plan* because a reader looking
 * at an unplanned issue is deciding between exactly those two — and a menu that
 * silently dropped one would hide half the decision. But creating a story is not
 * a board write: `story-tracking` is built around questions a person answers —
 * WHERE to home the story, whether it is even wanted yet — and an unattended
 * agent has nobody to ask. So there is no `/api/story`, and this is not an
 * oversight to be filled by a later wave the way `Commission design` was: it is
 * a statement that the act belongs to a person at a terminal, not to a click.
 *
 * The reason is about the ACT, not the binding — deliberately not *the board is
 * bound to <host>*, which would read as a limit that a story endpoint could one
 * day lift. There is nothing to lift: the decision is the point.
 */
export function storyRefusal(): string {
  return 'a story is a decision you make — where it lives, whether it is wanted yet — '
    + 'so it is created with /story-tracking at a terminal, not from a board click';
}

/**
 * Whether a menu EXISTS (present) and whether it can ACT (enabled).
 *
 * The two questions are distinct: a row may have items that the server refuses
 * (present but not enabled), or no items at all (not present).
 */
export function menuState({
  canStart, canResolve, hasRun, hasLog, hasStatus, hasOpen, hasChangedFiles, serverWillAct,
}: {
  canStart: boolean;
  canResolve: boolean;
  hasRun: boolean;
  hasLog: boolean;
  hasStatus: boolean;
  hasOpen: boolean;
  hasChangedFiles: boolean;
  serverWillAct: boolean;
}): { present: boolean; enabled: boolean } {
  // The menu EXISTS if there is ANY item. The run link, log, status, open, and
  // changed files are reads that need no server; the dispatching items ask the
  // server.
  const hasItems = canStart || canResolve || hasRun || hasLog || hasStatus || hasOpen || hasChangedFiles;
  // The menu is ENABLED if the reads exist, or if a dispatching item exists AND
  // the server will act on it.
  const enabled =
    hasRun || hasLog || hasStatus || hasOpen || hasChangedFiles ||
    ((canStart || canResolve) && serverWillAct);
  return { present: hasItems, enabled };
}

/**
 * A branch's MENU and the panels it opens, as one unit.
 *
 * Extracted so a WAVE ROW can carry it. A wave row is not decoration beside a
 * branch row — where a plan divides into one wave of one branch, the wave row
 * IS that branch's row, and it already renders the branch's status, note, PR
 * and plan through `soleRow`. Its menu was the one thing left behind.
 *
 * Measured on the mock before this existed: every wave row had zero menus of
 * any kind (`data-row-actions`, `data-wave-actions` and `data-op` all absent),
 * while every branch row had one. So for a one-branch plan — which is most of
 * them — Review, Open and the worker log were unreachable, and the reader's
 * only route to the PR was the artifact link.
 *
 * `WaveActions` beside it is NOT the same control and does not substitute for
 * it: that one dispatches the WAVE, and its own call site is gated on
 * `verdict === 'eligible'` for a good reason. This one acts on the BRANCH.
 * Two subjects, two menus, and a row that is both wears both.
 *
 * The three panels are mounted HERE rather than by the caller because the menu
 * that opens them unmounts on the click — the state and the mount have to live
 * on something that survives it, which is the note the branch row already
 * carried and the reason this could not be a bare `<RowActions>`.
 */
export function BranchMenu({
  row,
  card,
  dispatch,
  pulse,
  onStarting,
  onTaken,
  continueWith,
  onOpenPlan,
  onRevealBranch,
}: {
  row: AgentRow;
  card: Card | null;
  dispatch?: DispatchInfo;
  // No `approve`/`commission`: the two plan-level acts left the branch menu for
  // the plan head (`PlanActions`), so this wrapper no longer forwards them.
  pulse: number;
  onStarting?: (active: boolean) => void;
  /** The row's cue is extinguished by acting, and the flag lives on the ROW —
      one cell away from this menu — so it is passed in rather than held here. */
  onTaken?: () => void;
  continueWith?: DispatchInfo;
  onOpenPlan?: (planFile: string) => boolean | void;
  onRevealBranch?: (branch: string) => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  return (
    <>
      <RowActions
        row={row}
        card={card}
        dispatch={dispatch}
        pulse={pulse}
        onStarting={onStarting}
        onTaken={onTaken}
        onOpenLog={() => setLogOpen(true)}
        onOpenStatus={() => setStatusOpen(true)}
        onOpenChangedFiles={() => setFilesOpen(true)}
      />
      {logOpen && (
        <WorkerLogModal
          branch={row.branch}
          onClose={() => setLogOpen(false)}
          canContinue={continueWith}
          onOpenPlan={onOpenPlan ? (planFile) => void onOpenPlan(planFile) : undefined}
          onRevealBranch={onRevealBranch}
        />
      )}
      {statusOpen && card && (
        <DispatchLogModal slug={card.slug} onClose={() => setStatusOpen(false)} />
      )}
      {filesOpen && row.stuck && (
        <ChangedFilesModal
          branch={row.branch}
          paths={row.stuck.changedPaths}
          onClose={() => setFilesOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The row's actions, behind a three-dot menu at the right edge. **All of them.**
 *
 * `Start work` used to sit at the far right AFTER the age, so the line read
 * *what · state · age · act* — the action behind the quietest number on it. And
 * it stopped being alone: `board-becomes-operable` added `Approve`, and every
 * further action would widen a row that already carries phase, plan, branch,
 * note, PR and age and wraps on long branch names.
 *
 * **A ROW'S ACTIONS ALL LIVE HERE, and until 2026-08-18 two of them did not.**
 * *Open failing run* and the conflict dispatch rendered inline in the stuck
 * cell, and the split followed no stated rule — it followed the order the four
 * were built in. The rule now: **the row says what IS, the menu says what you
 * can DO.** One place to look, one place to add to.
 *
 * The old comment here said *the menu holds only things that CHANGE something;
 * navigation stays in the row*, which is still true and is not the boundary
 * that failed. Navigation to the thing the row NAMES — its plan, its branch,
 * its PR — stays inline, because a `cmd`-click on a real link is worth more
 * than a tidier line. *Open failing run* names none of those: it addresses a
 * run, which is a thing the row reports on rather than a thing the row is. It
 * is an errand, and errands live here.
 *
 * **Each ITEM asks for what it needs.** An item whose precondition is missing
 * simply is not there — that rule already governed this body and now governs
 * twice as much of it. The four conditions are independent by construction, and
 * none is written as another's `else`: see the note on `canApprove` below.
 *
 * **With no item it renders NOTHING — not a dimmed button.** This reverses the
 * deliberate exception recorded here, and the reversal was earned rather than
 * assumed. The old argument was layout: rendering nothing would leave the right
 * edge ragged and MOVING, since the pulse re-scans every five seconds. That
 * argument was answered by a later wave — the cell has a fixed `1.25rem` track
 * of its own, so the column holds still whether or not a button is inside it,
 * and the gridcell below still renders unconditionally. What remains is the
 * cost: a `⋯` that opens nothing is a control that lies, and it was measured
 * lying on two of six WAITING ON YOU rows. The row already says what it is; an
 * absent control claims nothing.
 *
 * `aria-disabled`, never the native `disabled`, on the button that DOES render:
 * a natively disabled element leaves the tab order and takes the explanation
 * with it, putting it out of reach of anyone who is not hovering with a mouse.
 * That path is still reached — a row whose only act is refused by the server
 * keeps its button and names the refusal, because a refusal is not an absence.
 */
export function RowActions({
  row,
  card,
  dispatch,
  pulse,
  onStarting,
  onTaken,
  onOpenLog,
  onOpenStatus,
  onOpenChangedFiles,
}: {
  row: AgentRow;
  card: Card | null;
  dispatch?: DispatchInfo;
  // NO `approve` OR `commission` HERE. Both were the branch row's twins of
  // plan-level acts, and both moved to the plan head (`PlanActions`). A branch
  // row's menu now carries only branch-level acts, so it neither takes the two
  // plan bindings nor names their refusals.
  pulse: number;
  onStarting?: (active: boolean) => void;
  /**
   * A stuck row's request has been answered — fired on the click that opens the
   * run or dispatches the conflict, never on whatever happens next.
   *
   * The menu holds the actions; the CUE that says the request is unanswered
   * stays in the row, one cell away. So the click has to travel back out to the
   * cell that owns that state, and this is the wire. Absent on rows that carry
   * no cue, where there is nothing to answer.
   */
  onTaken?: () => void;
  /**
   * Open this row's worker log. The PANEL is mounted by the Row, not here —
   * see the item below for why a menu that unmounts on click cannot own it.
   */
  onOpenLog?: () => void;
  /**
   * Open this row's DISPATCHER log — what the dispatcher itself did, keyed by
   * the plan's slug. Mounted by the Row for the same reason `onOpenLog` is:
   * this menu unmounts on the very click that opens the panel.
   */
  onOpenStatus?: () => void;
  /**
   * Show what the branch changes — mounted by the Row, for the reason
   * `onOpenLog` and `onOpenStatus` are: the close-on-outside-click effect runs
   * on CAPTURE, so this menu unmounts before a bubbled `onClick` from inside it
   * would fire, and a panel mounted HERE would be torn down by the very click
   * that opened it.
   */
  onOpenChangedFiles?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // The menu's own box, so a click inside it can be told from a click outside.
  // See the close-on-outside-click effect below for why propagation cannot do
  // this job.
  const menu = useRef<HTMLDivElement>(null);
  const canStart = Boolean(card && dispatch && isStartable(row));
  // THE OTHER ACT A ROW CAN OFFER, and the reason this menu had to stop asking
  // only about starting.
  //
  // APPROVE IS NOT HERE ANY LONGER — it belongs to the PLAN, and a branch row is
  // never the honest place for it.
  const serverWillAct = dispatch?.available ?? false;
  // THE RUN THIS ROW LAST HAD, widened from `ci-failing` to *a run URL exists*.
  const runUrl = row.stuck?.runHistory.find((r) => r.url)?.url ?? '';
  // THE CONFLICT, through the route that already exists.
  const canResolve = Boolean(
    row.stuck?.state === 'conflict' && card && dispatch,
  );
  // OPEN — the item that makes the menu fit every WAITING ON YOU row.
  const openUrl = offersOpen(row) ? openTarget(row) : '';
  // A READ, offered on membership and answered by the server.
  const hasLog = showsWorkerLog(row);
  // THE DISPATCHER LOG, offered whenever one exists.
  const hasStatus = Boolean(card?.hasDispatchLog);
  // WHAT THE BRANCH CHANGES, read straight off the row.
  const hasChangedFiles = offersChangedFiles(row.stuck);
  const { present: hasItems, enabled } = menuState({
    canStart, canResolve, hasRun: Boolean(runUrl), hasLog, hasStatus,
    hasOpen: Boolean(openUrl), hasChangedFiles, serverWillAct,
  });
  const reason =
    canStart && !serverWillAct && dispatch?.reason
      ? dispatch.reason
      : canResolve && !serverWillAct && dispatch?.reason
        ? dispatch.reason
        : noActionReason(row);

  // Close on Escape and on any click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: globalThis.MouseEvent) => {
      if (menu.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDown, true);
    };
  }, [open]);

  return (
    <div
      className="relative w-5 shrink-0 text-right"
      onClick={(e) => e.stopPropagation()}
    >
      {hasItems && (
        <button
          type="button"
          data-row-actions
          aria-haspopup="menu"
          aria-expanded={open}
          aria-disabled={!enabled || undefined}
          aria-label={enabled ? `Actions for ${row.branch}` : reason}
          title={enabled ? `Actions for ${row.branch}` : reason}
          onClick={() => { if (enabled) setOpen((v) => !v); }}
          className={
            enabled
              ? '-my-1 -mr-0.5 inline-flex h-6 w-6 items-center justify-center rounded text-xs leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
              : '-my-1 -mr-0.5 inline-flex h-6 w-6 cursor-default items-center justify-center text-xs leading-none text-slate-300 dark:text-slate-700'
          }
        >
          ⋯
        </button>
      )}
      {open && enabled && (
        <div
          role="menu"
          ref={menu}
          className="absolute right-0 z-10 mt-1 min-w-max rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {openUrl && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <a
                href={openUrl}
                target="_blank"
                rel="noreferrer"
                data-open-link
                aria-label={`${openLabel(row)} ${row.branch} on the git host`}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {openLabel(row)}
              </a>
            </div>
          )}
          {canStart && dispatch && card && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <StartWorkButton
                card={card}
                dispatch={dispatch}
                pulse={pulse}
                onStarting={onStarting}
              />
            </div>
          )}
          {canResolve && card && dispatch && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <span onClick={onTaken}>
                <StartWorkButton
                  card={card}
                  dispatch={dispatch}
                  pulse={pulse}
                  onStarting={onStarting}
                />
              </span>
            </div>
          )}
          {runUrl && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <a
                href={runUrl}
                target="_blank"
                rel="noreferrer"
                data-stuck-link
                onClick={onTaken}
                aria-label={`${runLinkLabel(row)} for ${row.branch}`}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {runLinkLabel(row)}
              </a>
            </div>
          )}
          {hasLog && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <button
                type="button"
                data-worker-log-open
                onClick={onOpenLog}
                aria-label={`Show the agent working on ${row.branch}`}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Show the agent
              </button>
            </div>
          )}
          {hasStatus && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <button
                type="button"
                data-dispatch-log-open
                onClick={onOpenStatus}
                aria-label={`Show what the dispatcher did for ${row.branch}`}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Status
              </button>
            </div>
          )}
          {hasChangedFiles && row.stuck && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <button
                type="button"
                data-changed-files-open
                onClick={onOpenChangedFiles}
                aria-label={`Show the files changed on ${row.branch}`}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {changedFilesLabel(row.stuck.changedPaths.length)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The wave row's `⋯` menu — one act, `Start work`.
 *
 * BORROWED FROM `PlanActions` rather than from `RowActions`, and the reason is
 * the same one recorded there: `RowActions` is typed on `AgentRow` and asks four
 * questions about a branch (startable? resolvable? a run? a log?), none of which
 * a wave row can answer. A wave is not a branch, so it takes the pattern —
 * same glyph, same `aria-haspopup`, same close-on-outside-click, same
 * fixed-width cell — and not the component.
 *
 * `StartWorkButton` arms itself on the first click and its armed label names the
 * consequence, which is why this is a popup and not an inline control: the label
 * does not fit a cell.
 *
 * Only ever rendered for an ELIGIBLE wave — see the `menu` prop — so there is no
 * *can I* question left to ask here. What remains is whether the SERVER will
 * act, and where it refuses, `StartWorkButton` says so on itself.
 */
export function WaveActions({
  wave,
  card,
  dispatch,
  pulse,
  onStarting,
}: {
  wave: string;
  card: Card;
  dispatch: DispatchInfo;
  /** The pulse COUNTER, not a callback — `StartWorkButton` watches it advance. */
  pulse: number;
  onStarting?: (active: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const willAct = dispatch.available;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: globalThis.MouseEvent) => {
      if (menu.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDown, true);
    };
  }, [open]);

  return (
    <div className="relative w-5 shrink-0 text-right" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-wave-actions={wave}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={!willAct || undefined}
        aria-label={willAct ? `Actions for wave ${wave}` : (dispatch.reason ?? `Cannot start ${wave} from here`)}
        title={willAct ? `Actions for wave ${wave}` : (dispatch.reason ?? `Cannot start ${wave} from here`)}
        onClick={() => { if (willAct) setOpen((v) => !v); }}
        className={`inline-flex h-6 w-5 items-center justify-center leading-none ${
          willAct
            ? 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
            : 'cursor-default text-slate-300 dark:text-slate-700'
        }`}
      >
        <span aria-hidden className="text-xs">⋯</span>
      </button>
      {open && willAct && (
        <div
          role="menu"
          ref={menu}
          className="absolute right-0 z-10 mt-1 min-w-max rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div role="menuitem" className="px-2 py-1 text-left">
            <StartWorkButton card={card} dispatch={dispatch} pulse={pulse} onStarting={onStarting} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The `⋯` menu on a wave the board reports `unsliced-wave` — the ONE act such a
 * wave offers: *Slice this wave*.
 *
 * A `⋯` of its own rather than a slot in `WaveActions`, because the two answer
 * disjoint waves. `WaveActions` is gated on `verdict === 'eligible'` — a wave
 * ready to dispatch — and an unsliced wave is precisely the wave that CANNOT be
 * dispatched (several live branches, no single one to hand a worker). They never
 * co-occur, so one row never wears both, and folding reslice into the dispatch
 * menu would put an item on `eligible` waves that can never apply to them.
 *
 * The shell is `PlanActions`', with ONE difference that is the whole point: this
 * menu opens even when `reslice` is refused. `PlanActions` gates its open on
 * `willAct` because a Draft plan has other reasons to exist and a dead `⋯`
 * there would be noise. An unsliced wave has exactly one errand — this one — so
 * a refused binding must still open to NAME the refusal, or the operator meets a
 * dead control with its explanation one hover away and unreachable by keyboard.
 * `ResliceButton` states its own refusal inside, the way every `DispatchInfo`
 * control does: a refusal is not an absence.
 */
export function ResliceMenu({
  wave,
  slug,
  reslice,
  onActing,
}: {
  wave: string;
  /** The plan slug the reslice acts on — `ResliceButton`'s POST body. */
  slug: string;
  reslice: DispatchInfo;
  onActing?: (active: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: globalThis.MouseEvent) => {
      if (menu.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDown, true);
    };
  }, [open]);

  return (
    <div className="relative w-5 shrink-0 text-right" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-reslice-actions={wave}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for wave ${wave}`}
        title={`Actions for wave ${wave}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-6 w-5 items-center justify-center leading-none text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
      >
        <span aria-hidden className="text-xs">⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          ref={menu}
          className="absolute right-0 z-10 mt-1 min-w-max rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div role="menuitem" className="px-2 py-1 text-left">
            <ResliceButton slug={slug} reslice={reslice} onActing={onActing} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The plan row's `⋯` menu — the plan's own acts, and the reason it is a menu.
 *
 * **Two answers to one question, both plan-level.** A Draft plan awaits a
 * person's decision, and there are exactly two: Approve hands it to development,
 * Commission design says it needs a spec, a spike or a tracer bullet first and
 * creates a Design-phase plan to hold that work. Both belong to the PLAN, and
 * the plan row — the row that NAMES the plan — is the only honest place for
 * either. Neither was ever right on a branch row: a branch BLOCKED by an earlier
 * wave reads `waiting-on-you` when its plan is Draft, so any branch-row gate put
 * a plan act on a row whose own available act is not its own. That is why the
 * two row-level twins are deleted, not merely re-gated, and why they live here.
 *
 * `ApproveButton` arms itself on the first click and its armed label names the
 * consequence (`Approve — merges PR #146?`), which is 25 characters in a cell
 * `1.25rem` wide, so both acts live in a popup rather than inline: same glyph,
 * same `aria-haspopup`, same close-on-outside-click, same fixed-width cell.
 *
 * NOT `RowActions` itself. That component is typed on `AgentRow` and asks four
 * questions about a branch (startable? resolvable? a run? a log?), none of
 * which a plan row can answer — `row.branch` is what its labels are built
 * from. Sharing it would mean making every one of those optional to serve one
 * caller that wants none of them.
 *
 * **Each act states its own refusal, and the button opens if EITHER can act.**
 * Approve and Commission design carry separate bindings (`approve`,
 * `commission`), so one may act while the other is refused — the menu shows both
 * and each names its own reason where declined, because a refusal is not an
 * absence. Where the plan is simply not Draft there is no button at all.
 */
export function PlanActions({
  plan,
  card,
  approve,
  commission,
  deliver,
  onApproving,
}: {
  plan: string;
  card: Card | null;
  approve?: DispatchInfo;
  commission?: DispatchInfo;
  deliver?: DispatchInfo;
  onApproving?: (active: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const isDraftPlan = Boolean(card && isDraft(card));
  const canApprove = Boolean(isDraftPlan && approve);
  const canCommission = Boolean(isDraftPlan && commission);
  const canDeliver = Boolean(card?.deliverable && deliver);
  const approveWillAct = approve?.available ?? false;
  const commissionWillAct = commission?.available ?? false;
  const draftWillAct =
    (canApprove && approveWillAct) || (canCommission && commissionWillAct);
  const canOpen = draftWillAct || canDeliver;
  const refusalReason =
    (canApprove ? approve?.reason : undefined) ||
    (canCommission ? commission?.reason : undefined) ||
    (canDeliver ? deliver?.reason : undefined) ||
    `Cannot act on ${plan} from here`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: globalThis.MouseEvent) => {
      if (menu.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDown, true);
    };
  }, [open]);

  return (
    <div
      className="relative w-5 shrink-0 text-right"
      onClick={(e) => e.stopPropagation()}
    >
      {(isDraftPlan || canDeliver) && (
        <button
          type="button"
          data-plan-actions={plan}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-disabled={!canOpen || undefined}
          aria-label={canOpen ? `Actions for ${plan}` : refusalReason}
          title={canOpen ? `Actions for ${plan}` : refusalReason}
          onClick={() => { if (canOpen) setOpen((v) => !v); }}
          className={`inline-flex h-6 w-5 items-center justify-center leading-none ${
            canOpen
              ? 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
              : 'cursor-default text-slate-300 dark:text-slate-700'
          }`}
        >
          <span aria-hidden className="text-xs">⋯</span>
        </button>
      )}
      {open && canOpen && card && (
        <div
          role="menu"
          ref={menu}
          className="absolute right-0 z-10 mt-1 min-w-max rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {canApprove && approveWillAct && approve && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <ApproveButton card={card} approve={approve} onApproving={onApproving} />
            </div>
          )}
          {canCommission && commissionWillAct && commission && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <CommissionDesignButton card={card} commission={commission} onActing={onApproving} />
            </div>
          )}
          {canDeliver && deliver && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <DeliverButton slug={card.slug} deliver={deliver} onActing={onApproving} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A ticket's actions, behind the SAME three-dot menu every other row wears.
 *
 * **The ticket kind, brought under the one grammar.** Until now the issue row
 * rendered `Create plan` inline while every branch and plan row put its actions
 * in `⋯` — the split `one-place-for-what-a-row-can-do` closed for the fleet
 * rows, reaching the one row it had not. The reader learns one place to look,
 * whatever the row is.
 *
 * Three items, the kind's own:
 *   - **Create plan** — the working action, `CreatePlanButton` verbatim, with
 *     its own refusals (a host that cannot be asked, a lookup that broke).
 *   - **Create story** — offered and refused, `storyRefusal` on the control:
 *     a story is a person's decision, not a board write, so there is no route.
 *   - **Open on host** — navigation to `issue.url`, no guard and no fetch, the
 *     same shape the fleet row's Open takes.
 *
 * The menu is ALWAYS present on a ticket: `Create story` and `Open` are there
 * whatever the binding, so a ticket row is never menuless — the motivating
 * defect, closed for this kind too.
 *
 * **It also frees the age column.** *Create plan* sat in the `1.25rem` menu
 * track — a slot sized for a glyph — so its text overflowed left across the
 * `2.5rem` age cell, and the issue rows read `1d`/`Create plan` overlapping. A
 * `⋯` fits the track it was given, and the menu floats absolutely over the grid
 * rather than in it, so the age beside it renders alone.
 */
export function IssueRowActions(
  { issue, idea, issueAnswer }:
  { issue: IssueRow; idea: DispatchInfo; issueAnswer: IssueAnswer },
) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: globalThis.MouseEvent) => {
      if (menu.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDown, true);
    };
  }, [open]);

  return (
    <div
      className="relative w-5 shrink-0 text-right"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        data-issue-actions={issue.number}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for issue #${issue.number}`}
        title={`Actions for issue #${issue.number}`}
        onClick={() => setOpen((v) => !v)}
        className="text-xs leading-none text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          ref={menu}
          className="absolute right-0 z-10 mt-1 min-w-max rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div role="menuitem" className="px-2 py-1 text-left">
            <CreatePlanButton issue={issue} idea={idea} issueAnswer={issueAnswer} />
          </div>
          <div role="menuitem" className="px-2 py-1 text-left">
            <button
              type="button"
              data-create-story={issue.number}
              aria-disabled
              title={storyRefusal()}
              className="cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600"
            >
              Create story
              <span className="sr-only"> — unavailable: {storyRefusal()}</span>
            </button>
          </div>
          {issue.url && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer"
                data-issue-open
                aria-label={`Open issue #${issue.number} on the host`}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Open on host
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
