import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPlanRefusal } from '../card-presentation.js';
import type { CardFacts } from '@plot-pm/domain/entities/card-facts';
import type { ScopeRowMenu } from '@plot-pm/domain/rules/scope-tickets';
import { ACTION_TIMEOUT_MS } from '../bounded-fetch.js';
import {
  type AgentEntry,
  type AgentRow,
  type Card,
  type DispatchInfo,
  type IssueAnswer,
  type IssueRow,
  isBrokenState,
} from '../../../contract/schema.js';
import { offersReleaseClaim } from '@plot-pm/domain/rules/quiet';
import { ReleaseClaimButton } from '../../components/ReleaseClaimButton.js';
import { ApproveButton } from '../../components/ApproveButton.js';
import { NeedsDesignButton } from '../../components/NeedsDesignButton.js';
import { CreatePlanButton } from '../../components/CreatePlanButton.js';
import {
  CreateStoryButton,
  refusalReason as storyRefusalReason,
} from '../../components/CreateStoryButton.js';
import { ResliceButton } from '../../components/ResliceButton.js';
import { DeliverButton } from '../../components/DeliverButton.js';
import { DropAgentButton } from '../../components/DropAgentButton.js';
import { ImplementButton } from '../../components/ImplementButton.js';
import { isDraft, isApproved } from '../../components/PlanCard.js';
import { StartWorkButton } from '../../components/StartWorkButton.js';
import { ACTING_CLASS, ActingSpinner } from '../../components/ui/ActingSpinner.js';
import { WriteBriefButton } from '../../components/WriteBriefButton.js';
import { offersChangedFiles } from './stuck.js';
import { isStartable, needsBrief } from './row-identity.js';
import { WorkerLogModal } from '../../components/WorkerLogModal.js';
import { rowMenuOf, type BranchMenuFacts, type FleetAgentMenuFacts, type RowMenuItem, type RowMenuView, type SliceLineMenuFacts, type SliceMenuFacts } from './delivery-view.js';
import { DispatchLogModal } from '../../components/DispatchLogModal.js';
import { ChangedFilesModal } from '../../components/ChangedFilesModal.js';

/**
 * Whether a row offers its worker's log.
 *
 * **WORKING membership, and nothing else.** WORKING lists AGENTS — that is the
 * section's definition, restated by the plan this slice comes from — and an
 * agent is the thing that writes a log. Every other section lists results or
 * processes, which have none.
 *
 * Deliberately NOT keyed on whether a log exists, because the row cannot know:
 * it carries no worktree path and no worker state, and this slice adds neither.
 * The alternative — infer from `isLive` or from `localDirty` — would hide the
 * log on exactly the rows a reader most wants it: a claimed branch whose agent
 * is quiet is the one you open a log to understand, and an activity predicate
 * would call it inactive and offer nothing.
 *
 * So the button asks a question the row CAN answer (*is this an agent*) and the
 * server answers the one it cannot (*is there a log, and is it empty*). The
 * cost is a control that sometimes opens onto "no log here"; the alternative is
 * a control that is missing whenever the guess is wrong, which is the strictly
 * worse failure — a reader cannot tell an absent button from an absent log.
 *
 * IN THE MENU, not on the row. Opening a log is an ERRAND — *the row says what
 * IS, the menu says what you can DO* — and the structural gate below
 * (`a row's actions all live in its menu`) enforces that boundary rather than
 * asking each author to remember it. The gate caught this control on the row
 * and was right to: `ROW_NAVIGATION` admits links to things the row NAMES, and
 * a row names its branch, its plan and its PR — not its worker's console.
 *
 * The neighbouring precedent is `Open last run`, which is the same shape: a
 * read, about a process the row reports on rather than one the row is, reached
 * from the menu.
 *
 * Exported for test: the pairing that matters is that a `working` row offers it
 * and a `waiting-on-you` row does not, which an assertion on markup alone would
 * not pin down.
 */
export function showsWorkerLog(row: AgentRow): boolean {
  return row.group === 'working' && row.startability !== 'no-known-worker';
}

export function noActionReason(row: AgentRow): string {
  return row.note ? `No action available — ${row.note}` : 'No action available on this row';
}

/**
 * The address Open navigates to — a fact already on the row, never a fetch.
 *
 * **This is the item that gives every fleet row a menu.** The motivating defect
 * was two of three WAITING ON YOU rows with no `⋯` at all: a plain PR awaiting
 * review offered nothing the old menu recognised, so its menu was absent and the
 * reader had no route to the one thing they came to do — look at it.
 *
 * The PR wins where both exist, because a PR row's subject is the PR: the reader
 * is deciding about `#240`, and the branch it rides on is the vehicle. A branch
 * with no PR opens `branchUrl` — the same address `BranchName` already links.
 *
 * "" where neither is addressable: a merged branch (its remote page is gone) or
 * a host that gave no PR url (Bitbucket). No address, no Open item — and the row
 * falls back to whatever else its kind offers, or to no menu where it offers
 * nothing, which is the honest answer for a row with nowhere to send you.
 *
 * Exported for test — the PR-over-branch precedence is the half a naive "return
 * branchUrl" gets wrong on exactly the rows this feature is about.
 */
export function openTarget(row: Pick<AgentRow, 'pr' | 'branchUrl'>): string {
  return row.pr?.url || row.branchUrl || '';
}

/**
 * Does this row OFFER Open — and it is WAITING ON YOU, or a QUIET row that
 * still names a reason (`abandoned`, `orphaned-claim`) — and nowhere else.
 *
 * **The scope the motivating defect actually named.** The reported defect was a
 * plain PR *awaiting review* with no `⋯` at all — a row the reader must act on,
 * leading with a subject they had no route to. Open closes that. But a plain
 * `quiet`, `blocked` or `done` row has nothing to do, and the rule
 * `one-place-for-what-a-row-can-do` settled holds there: a menu whose only item
 * opens a link the row ALREADY shows (its branch name is an anchor) is the empty
 * `⋯` that lies, measured lying on two of six rows. So Open lives where the
 * row's own membership means *this wants a person*: WAITING ON YOU, and the two
 * QUIET kinds operator decision B (2026-11-03) moved there — `abandoned` still
 * asks *revive or drop*, and `orphaned-claim` still asks *reap it*.
 *
 * `openTarget` stays a pure address resolver — *what* to open — and this answers
 * *whether* to offer it. Two questions: a `done` row still HAS a branch address,
 * it simply is not somewhere the reader needs sending.
 *
 * Exported for test: the negative — a branch waiting its turn keeps no menu
 * though it has an address — is the half a check on the URL alone gets wrong,
 * and the one that reopens the empty-menu defect a section over.
 */
export function offersOpen(row: Pick<AgentRow, 'pr' | 'branchUrl' | 'group' | 'quietKind'>): boolean {
  const asksAPerson = row.group === 'waiting-on-you'
    || (row.group === 'quiet' && (row.quietKind === 'abandoned' || row.quietKind === 'orphaned-claim'));
  return asksAPerson && openTarget(row) !== '';
}

/**
 * What the Open item says — *Review* for a PR, *Open* for a branch.
 *
 * Opening a PR IS reviewing it: the reader lands on the page where the diff, the
 * comments and the merge button live. A bare branch has no such page — *Open*
 * takes them to the branch on the host, and there is nothing to review yet. The
 * verb follows what the click actually does, the same rule that took *failing*
 * off the run link when its condition widened.
 *
 * Exported for test.
 */
export function openLabel(row: Pick<AgentRow, 'pr'>): string {
  return row.pr ? 'Review' : 'Open';
}

/**
 * What the run link says — *Show failure* where the row IS failing, *Open last
 * run* otherwise.
 *
 * The item opens the last run whatever that run concluded (the widening #269
 * made explicit), so on a green row it must not promise a failure. It reads
 * *Show failure* only where a failure is actually present — a PR whose checks
 * failed, or a branch the detector called `ci-failing` — which is the PR-kind
 * *Show failure* the plan names, and elsewhere it is honestly just the last run.
 *
 * Reads the row's own state, never the run's conclusion: `runHistory` may hold a
 * green newest run on a row that is failing for a different check, and the row's
 * `pr.state` / `stuck.state` is the classifier's verdict about the whole row.
 *
 * Exported for test — the green-row case is the half a label hard-coded to *Show
 * failure* gets wrong.
 */
export function runLinkLabel(row: Pick<AgentRow, 'pr' | 'stuck'>): string {
  // `Show failure` only where there is a failure to SHOW. A PR whose rollup is
  // `failing` has one. A `ci-failing` row usually does — but not once its NEWEST
  // run has gone green: the row is still classed failing on an earlier check
  // while the run this link opens passed, and promising a failure there is the
  // very over-claim the widening (#269) took the word *failing* off this link to
  // avoid. So the ci case defers to the newest run's own conclusion.
  const newestRun = row.stuck?.runHistory[0];
  const ciShowsFailure = row.stuck?.state === 'ci-failing'
    && (!newestRun || (newestRun.conclusion ?? '') !== 'success');
  const failing = row.pr?.state === 'failing' || ciShowsFailure;
  return failing ? 'Show failure' : 'Open last run';
}

/**
 * Why *Create story* will not act, or "" when it will — and the SHAPE of this
 * function is the change it carries.
 *
 * **It took no arguments and returned a constant.** That is what made the old
 * refusal a claim about stories rather than a fact about this board:
 *
 *     'a story is a decision you make — where it lives, whether it is wanted
 *      yet — so it is created with /story-tracking at a terminal, not from a
 *      board click'
 *
 * and its own comment called that permanent — *"not an oversight to be filled
 * by a later wave … There is nothing to lift: the decision is the point."*
 *
 * Measured against `skills/story-tracking/SKILL.md` on 2026-08-20, neither named
 * decision is what the refusal says it is. The skill states its own escape —
 * *"Skip the question only when the repo has exactly one home"* — and its own
 * override — an explicit request beats triage advice, which is exactly what a
 * click on this control is. And the ground it stood on, *an unattended agent has
 * nobody to ask*, is refuted by the practice: `/story-tracking` is run
 * unattended several times a day from the prompt, through the same
 * `PLOT_UNATTENDED` contract that makes *Create plan* work.
 *
 * So the refusal became CONDITIONAL and moved into `CreateStoryButton`, where it
 * reads the same two facts *Create plan* reads: the binding, and whether the
 * tracker can be asked at all. The two repo-level facts neither can see — an
 * unset `Story command`, several declared story homes — come back from
 * `/api/story` as refusals that name the key or the question.
 *
 * **What the old refusal got right is kept, in the words rather than in a
 * block.** A plan is a commitment to do work; a story is a commitment to track
 * work — so the armed label says `track #N` where *Create plan*'s says `Draft`.
 * The distinction was always real; it just never argued for the route being
 * absent.
 *
 * Retained as a named function, delegating, because the ticket menu's contract
 * is that a refused control STATES ITS REASON: a caller asking "why can this
 * not act" should have one place to ask, whatever the answer turns on.
 *
 * Exported for test.
 */
export function storyRefusal(story: DispatchInfo, issueAnswer: IssueAnswer | null): string {
  return storyRefusalReason(story, issueAnswer);
}

/** The class an enabled item's link or button wears. */
const ITEM_LINK = 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400';

/**
 * Renders one row's `⋯` and its popup from a {@link RowMenuView} of kind `items`.
 *
 * The cell renders at a fixed width whether or not it holds a trigger, so the `⋯` sits at the same x on every row.
 * The trigger renders only where `view.trigger` is `'enabled'`, and it is never disabled. Each item renders as a
 * `menuitem` carrying `data-menu-item`: an enabled item renders `render(item)`, and a disabled item renders its label
 * with `aria-disabled` and its reason as `data-menu-reason` and as visible text.
 *
 * @param view - The menu `rowMenuOf` returned. Any other kind renders the empty cell.
 * @param trigger - The data attribute the trigger carries (its value is the attribute's value) and its accessible label.
 * @param render - The control for an enabled item, or `null` for a label alone.
 */
export const ItemMenu = ({
  view,
  trigger,
  render,
}: {
  view: RowMenuView;
  trigger: { label: string } & Record<`data-${string}`, string>;
  render: (item: RowMenuItem) => ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  // Close on Escape and on a click outside the popup. The click listener runs on CAPTURE, so a panel an item
  // opens has to be mounted by the row: this menu unmounts before a bubbled click from inside it fires.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (menu.current && e.target instanceof Node && menu.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDown, true);
    };
  }, [open]);
  const items = view.kind === 'items' && view.trigger === 'enabled' ? view.items : [];
  const { label, ...attrs } = trigger;
  return (
    <div data-row-menu className="relative w-5 shrink-0 text-right" onClick={(e) => e.stopPropagation()}>
      {items.length > 0 && (
        <button
          type="button"
          {...attrs}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          title={label}
          onClick={() => setOpen((v) => !v)}
          className="-my-1 -mr-0.5 inline-flex h-6 w-6 items-center justify-center rounded text-xs leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          ⋯
        </button>
      )}
      {open && items.length > 0 && (
        <div
          role="menu"
          ref={menu}
          className="absolute right-0 z-10 mt-1 min-w-max max-w-[18rem] rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {items.map((item) => {
            const control = item.enabled ? render(item) : null;
            return item.enabled && control !== null ? (
              <div key={item.action} role="menuitem" data-menu-item={item.action} className="px-2 py-1 text-left">
                {control}
              </div>
            ) : (
              <div
                key={item.action}
                role="menuitem"
                aria-disabled="true"
                data-menu-item={item.action}
                data-menu-reason={item.reason ?? ''}
                className="px-2 py-1 text-left text-xs text-slate-400 dark:text-slate-500"
              >
                <span className="font-medium">{item.label}</span>
                {item.reason && <span className="block whitespace-normal text-[11px]">{item.reason}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Where a stuck row's actions used to live — and the note explaining why the
 * space is empty.
 *
 * **`StuckAction` was deleted on 2026-08-18.** It rendered two of this board's
 * four actions inline in the row — *Open failing run* as a link, and the
 * conflict dispatch as a `StartWorkButton` — while the other two rendered in
 * the three-dot menu. Nothing distinguished the two homes except which action
 * was built first, and `one-place-for-what-a-row-can-do` settled the rule that
 * had been missing: **the row says what IS, the menu says what you can DO.**
 * Both moved into {@link RowActions}, each as an item with its own condition.
 *
 * **The CUE did not move, and that distinction is the whole design.** It is
 * state rather than an action: it points at something being wrong, and the plan
 * that added it was explicit that motion is never the sole carrier. A signal
 * behind a click is not a signal. So {@link StuckCell} renders it directly now,
 * beside the stuck WORD and its evidence — which is what it points at, and
 * which reads better than pointing at a control one line to its right.
 *
 * This comment is left where the component was because the arrangement it
 * replaced is the kind that regrows: the next action is easiest to render in
 * the row, and *easiest* is exactly the reasoning that produced two homes. The
 * gate against that is a test, not this note — see the structural assertion in
 * `test/unit/agent-list.test.ts`.
 */

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
 * argument was answered by a later slice — the cell has a fixed `1.25rem` track
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
/**
 * A branch's MENU and the panels it opens, as one unit.
 *
 * Extracted so a SLICE ROW can carry it. A slice row is not decoration beside a
 * branch row — where a plan divides into one slice of one branch, the slice row
 * IS that branch's row, and it already renders the branch's status, note, PR
 * and plan through `soleRow`. Its menu was the one thing left behind.
 *
 * Measured on the mock before this existed: every slice row had zero menus of
 * any kind (`data-row-actions`, `data-slice-actions` and `data-op` all absent),
 * while every branch row had one. So for a one-branch plan — which is most of
 * them — Review, Open and the worker log were unreachable, and the reader's
 * only route to the PR was the artifact link.
 *
 * `SliceActions` beside it is NOT the same control and does not substitute for
 * it: that one dispatches the SLICE, and its own call site is gated on
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
  implement,
  pulse,
  onStarting,
  onTaken,
  continueWith,
  restartWith,
  onOpenPlan,
  onRevealBranch,
  slice,
}: {
  row: AgentRow;
  card: Card | null;
  dispatch?: DispatchInfo;
  /** Whether the server will act on Implement — same binding as `dispatch`, used
      by WriteBriefButton for rows that need a brief. */
  implement?: DispatchInfo;
  // No `approve`: the plan-level act left the branch menu for the plan head
  // (`PlanActions`), so this wrapper no longer forwards it.
  pulse: number;
  onStarting?: (active: boolean) => void;
  /** The row's cue is extinguished by acting, and the flag lives on the ROW —
      one cell away from this menu — so it is passed in rather than held here. */
  onTaken?: () => void;
  continueWith?: DispatchInfo;
  restartWith?: DispatchInfo;
  onOpenPlan?: (planFile: string) => boolean;
  onRevealBranch?: (branch: string) => void;
  /** The slice this branch stands for on a slice row with one branch; see `RowActions`. */
  slice?: SliceMenuOwn;
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
        implement={implement}
        pulse={pulse}
        onStarting={onStarting}
        onTaken={onTaken}
        onOpenLog={() => setLogOpen(true)}
        onOpenStatus={() => setStatusOpen(true)}
        onOpenChangedFiles={() => setFilesOpen(true)}
        slice={slice}
      />
      {logOpen && (
        <WorkerLogModal
          branch={row.branch}
          onClose={() => setLogOpen(false)}
          canContinue={continueWith}
          canRestart={restartWith}
          onOpenPlan={onOpenPlan}
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

export function RowActions({
  row,
  card,
  dispatch,
  implement,
  pulse,
  onStarting,
  onTaken,
  onOpenLog,
  onOpenStatus,
  onOpenChangedFiles,
  slice,
}: {
  row: AgentRow;
  card: Card | null;
  dispatch?: DispatchInfo;
  /** Whether the server will act on Implement — used by WriteBriefButton for
      rows that need a brief written before they can be dispatched. */
  implement?: DispatchInfo;
  // NO `approve` HERE. It was the branch row's twin of a plan-level act, and it
  // moved to the plan head (`PlanActions`). A branch row's menu now carries only
  // branch-level acts, so it neither takes the plan binding nor names its
  // refusal.
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
  /** The slice this row stands for, where the row is a slice row with one branch: its acts join the menu. */
  slice?: SliceMenuOwn;
}) {
  // THE RUN THIS ROW LAST HAD, and the one condition this move deliberately
  // WIDENED. It used to be reachable only while `stuck.state === 'ci-failing'`,
  // so the route to a run existed exactly as long as the row was red and was
  // invisible the rest of the time — a reader wanting the last run of a green
  // branch had no control at all. The condition is now *a run URL exists*.
  //
  // `[]` is *no run listing available* (Bitbucket has none), never *this branch
  // has never failed* — so an absent URL yields no item rather than an invented
  // address, the rule the branch and PR cells already follow. The words *no run
  // link available* that used to stand in the row for this case are gone with
  // it: an item that is not there says the same thing more quietly, which is
  // the empty-menu rule applied one level in.
  //
  // **HOW FAR THE WIDENING ACTUALLY REACHES, and it is less far than the words
  // *a run URL exists* suggest.** `runHistory` is a field of `stuck`, not of
  // the row, so it is only ever populated on a row the detector called stuck.
  // A branch that is green in every sense carries `stuck: null` and no run
  // history to read, and this offers it nothing.
  //
  // What the widening does reach is every row the detector marked — including
  // states that are NOT `ci-failing` and the `ci-failing` row whose newest run
  // has since gone green. That was the reported case and it is fixed. Carrying
  // the run on the row itself, so a wholly healthy branch could offer its last
  // one too, is a change to what the server SENDS rather than to what this
  // renders, and it belongs to whichever plan wants it.
  const runUrl = row.stuck?.runHistory.find((r) => r.url)?.url ?? '';
  // OPEN — navigation to the address the row carries (`openTarget`: the PR page, or the branch on the host).
  // Listed on every branch row; a row with no address lists it disabled.
  const openUrl = openTarget(row);
  // RELEASE CLAIM — the domain's answer on the row's quiet kind, so no kind word
  // is read here. The act is `POST /api/release-claim`.
  const hasReleaseClaim = row.group === 'quiet' && offersReleaseClaim(row.quietKind);
  // COMMISSION DESIGN IS NOT HERE EITHER — it is a plan decision, the OTHER
  // answer to a Draft plan beside Approve, and it left the branch row for the
  // same reason Approve did. It now lives on the plan head (`PlanActions`), so
  // the branch row neither computes it nor renders it.
  // ANY item, not one named item. The menu opens if something inside it could
  // act; which something it is, is the menu's own business.
  //
  // The run link is NAVIGATION and carries no guard — it reads the same over
  // Tailscale as it does at the machine, because there is no rerun route here
  // and opening the host's page is not a write. So it joins this gate without a
  // `WillAct` term, which is not an oversight: the two dispatching items ask
  // whether the server will act because they ask the server to act.
  // Whether the menu EXISTS, and whether anything in it can act — two questions,
  // and the old code asked only the second. See {@link menuState}.
  // A READ, offered on membership and answered by the server. The row carries
  // no worktree and no worker state — deliberately, since this slice adds no
  // field to the contract — so nothing here can know whether a log exists. It
  // does not guess: the item asks *is this an agent*, and the panel reports
  // which of no-worktree / no-log / empty / here-it-is turned out to be true.
  // An item conditioned on the log existing would be missing in exactly the
  // cases the endpoint was built to tell apart, and a reader cannot tell an
  // absent item from an absent log.
  const hasLog = showsWorkerLog(row);
  // THE DISPATCHER LOG, offered whenever one exists — read from the CARD, not
  // the row. The dispatcher log belongs to a plan (`plot-dispatch-<slug>.log`),
  // and the card is where the plan's slug and its `hasDispatchLog` presence bit
  // live. A row whose plan has no card cannot offer it, which is right: without
  // a card there is no slug to name and the fetch would have nothing to ask for.
  const hasStatus = Boolean(card?.hasDispatchLog);
  // WHAT THE BRANCH CHANGES, read straight off the row. It needs no card, no
  // dispatch verdict and no fetch — the paths came in on the pulse that drew
  // this row, which is why the item is offered on the row's own evidence rather
  // than on anything the server has to be asked. `offersChangedFiles` is where
  // the two conditions live (the state, and a non-empty list); this only reads
  // the answer.
  const hasChangedFiles = offersChangedFiles(row.stuck);
  const facts: BranchMenuFacts = {
    kind: 'branch', branch: row.branch, card, openUrl, openLabel: openLabel(row), releaseClaim: hasReleaseClaim,
    startable: isStartable(row), conflict: row.stuck?.state === 'conflict', needsBrief: needsBrief(row), runUrl,
    runLabel: runLinkLabel(row), hasLog, hasStatus, changedFiles: hasChangedFiles && row.stuck ? row.stuck.changedPaths.length : null,
    dispatch, implement,
  };
  const { kind: _kind, card: _card, dispatch: _dispatch, startable: _startable, ...branchFacts } = facts;
  const view = slice === undefined
    ? rowMenuOf(facts)
    : rowMenuOf({ ...slice, kind: 'slice', card, dispatch, branch: branchFacts });
  const trigger: { label: string } & Record<`data-${string}`, string> = slice === undefined
    ? { 'data-row-actions': '', label: `Actions for ${row.branch}` }
    : { ...sliceTrigger(slice.wave), 'data-row-actions': '' };

  const render = (item: RowMenuItem): ReactNode => {
    switch (item.action) {
      case 'open':
        return (
          <a href={openUrl} target="_blank" rel="noreferrer" data-open-link aria-label={`${item.label} ${row.branch} on the git host`} className={ITEM_LINK}>
            {item.label}
          </a>
        );
      case 'release-claim':
        return <ReleaseClaimButton branch={row.branch} confirmText={item.confirm ?? undefined} />;
      case 'start-work':
        return card && dispatch ? <StartWorkButton card={card} dispatch={dispatch} pulse={pulse} onStarting={onStarting} /> : null;
      case 'resolve-conflict':
        // Wrapped so the click marks the request answered whatever the dispatch then does.
        return card && dispatch ? (
          <span onClick={onTaken}>
            <StartWorkButton card={card} dispatch={dispatch} pulse={pulse} onStarting={onStarting} />
          </span>
        ) : null;
      case 'write-brief':
        return card && implement ? <WriteBriefButton slug={card.slug} branch={row.branch} implement={implement} onActing={onStarting} /> : null;
      case 'reslice':
        return slice?.reslice ? <ResliceButton slug={slice.slug} reslice={slice.reslice} onActing={onStarting} /> : null;
      case 'open-run':
        return (
          <a href={runUrl} target="_blank" rel="noreferrer" data-stuck-link onClick={onTaken} aria-label={`${item.label} for ${row.branch}`} className={ITEM_LINK}>
            {item.label}
          </a>
        );
      // The three panels only SET state the ROW owns: this menu unmounts on the capture-phase click, so a panel
      // mounted here would be torn down by the click that opened it.
      case 'worker-log':
        return <button type="button" data-worker-log-open onClick={onOpenLog} aria-label={`Show the agent working on ${row.branch}`} className={ITEM_LINK}>{item.label}</button>;
      case 'status':
        return <button type="button" data-dispatch-log-open onClick={onOpenStatus} aria-label={`Show what the dispatcher did for ${row.branch}`} className={ITEM_LINK}>{item.label}</button>;
      case 'changed-files':
        return <button type="button" data-changed-files-open onClick={onOpenChangedFiles} aria-label={`Show the files changed on ${row.branch}`} className={ITEM_LINK}>{item.label}</button>;
      default:
        return null;
    }
  };

  return <ItemMenu view={view} trigger={trigger} render={render} />;
}

/** A slice row's own facts, which `SliceActions` and a slice row's `BranchMenu` pass to `rowMenuOf`. */
export type SliceMenuOwn = Pick<SliceMenuFacts, 'wave' | 'slug' | 'eligible' | 'unsliced' | 'reslice'>;

/**
 * The trigger of a slice row's `⋯`: `data-slice-actions` names the slice, and the button carries the slice label.
 */
/**
 * Renders the `⋯` of an opened plan line on the Release tab: Start work for the line's one branch, or no item on a
 * merged line, whose cell stays empty at the same width.
 *
 * @param facts - the line's state, branch, card and dispatch binding; see {@link SliceLineMenuFacts}.
 * @param slice - the line's slice name, which the trigger carries as `data-slice-line-actions`.
 * @param pulse - the pulse counter `StartWorkButton` watches to confirm the claim.
 * @param onStarting - called while the start runs.
 */
export const SliceLineActions = ({ facts, slice, pulse, onStarting }: {
  facts: Omit<SliceLineMenuFacts, 'kind'>;
  slice: string;
  pulse: number;
  onStarting?: ((active: boolean) => void) | undefined;
}) => {
  const view = rowMenuOf({ kind: 'slice-line', ...facts });
  const render = (item: RowMenuItem): ReactNode =>
    item.action === 'start-work' && facts.card !== null && facts.dispatch !== undefined && facts.branch !== null
      ? <StartWorkButton card={facts.card} dispatch={facts.dispatch} pulse={pulse} onStarting={onStarting} branch={facts.branch} />
      : null;
  return <ItemMenu view={view} trigger={{ 'data-slice-line-actions': slice, label: `Actions for slice ${slice}` }} render={render} />;
};

const sliceTrigger = (wave: string): { label: string } & Record<`data-${string}`, string> => ({
  'data-slice-actions': wave,
  label: `Actions for slice ${wave}`,
});

/**
 * Renders the `⋯` of a slice row that holds several branches or none: Start work and Slice this plan.
 *
 * A slice row with one branch renders `BranchMenu` with a `slice` instead, so the row has one menu that also lists
 * the branch items.
 */
export const SliceActions = ({
  slice,
  card,
  dispatch,
  pulse,
  onStarting,
}: {
  slice: SliceMenuOwn;
  card: Card | null;
  dispatch?: DispatchInfo;
  /** The pulse COUNTER, not a callback — `StartWorkButton` watches it advance. */
  pulse: number;
  onStarting?: (active: boolean) => void;
}) => {
  const view = rowMenuOf({ ...slice, kind: 'slice', card, dispatch, branch: null });
  const render = (item: RowMenuItem): ReactNode => {
    if (item.action === 'start-work' && card && dispatch) {
      return <StartWorkButton card={card} dispatch={dispatch} pulse={pulse} onStarting={onStarting} />;
    }
    if (item.action === 'reslice' && slice.reslice) {
      return <ResliceButton slug={slice.slug} reslice={slice.reslice} onActing={onStarting} />;
    }
    return null;
  };
  return <ItemMenu view={view} trigger={sliceTrigger(slice.wave)} render={render} />;
};

/**
 * Whether the card has work that could be started now.
 *
 * The gate for Implement and Dispatch: an approved plan (`phase === 'Development'`)
 * with at least one eligible branch. A plan with nothing eligible — every slice
 * is blocked, claimed, merged or deferred — offers neither act.
 *
 * Returns false for any card without a pulse yet (`eligible` is undefined), which
 * is the same answer `startRefusal` gives: waiting for the first fleet scan.
 */
export function hasEligibleWork(card: Card | null): boolean {
  return Boolean(card && isApproved(card) && (card.sliceSummary?.eligible ?? 0) > 0);
}

/**
 * Dispatch all: fans out all eligible branches of this plan in one click.
 *
 * The difference from `StartWorkButton` is the CAP: Start work posts with
 * `--max 1` because it is on a slice row and means *this slice, now*; Dispatch
 * posts with no cap because it is on a plan row and means *all of it*.
 * `plot-dispatch.sh --max 0` is its own default, so omitting the cap is how the
 * call expresses *no limit*.
 */
export function DispatchAllButton({
  card,
  dispatch,
  pulse,
  onDispatching,
}: {
  card: Card;
  dispatch: DispatchInfo;
  pulse: number;
  onDispatching?: (active: boolean) => void;
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'dispatching'; since: number }
    | { kind: 'dispatched' }
    | { kind: 'failed'; message: string }
  >({ kind: 'idle' });
  const dispatching = state.kind === 'dispatching';
  const inFlight = useRef(false);

  useEffect(() => {
    if (!dispatching) inFlight.current = false;
  }, [dispatching]);

  useEffect(() => {
    if (!dispatching || !onDispatching) return;
    onDispatching(true);
    return () => onDispatching(false);
  }, [dispatching, onDispatching]);

  // Watch claimed count, same as StartWorkButton — but give up after fewer
  // pulses because a plan-level dispatch may claim several branches and the
  // first claim landing is the confirmation.
  const claimedRef = useRef(card.sliceSummary?.claimed);
  const claimed = card.sliceSummary?.claimed;
  const PULSES_BEFORE_GIVING_UP = 3;

  useEffect(() => {
    if (state.kind !== 'dispatching') {
      claimedRef.current = claimed;
      return;
    }
    const claimedAtClick = claimedRef.current;
    const pulsesElapsed = pulse - state.since;
    if (claimedAtClick !== undefined && claimed !== undefined && claimed > claimedAtClick) {
      setState({ kind: 'idle' });
    } else if (pulsesElapsed >= PULSES_BEFORE_GIVING_UP) {
      setState({ kind: 'dispatched' });
    }
  }, [pulse, claimed, state]);

  const refusal = !dispatch.available ? dispatch.reason : undefined;
  const blocked = dispatching || refusal !== undefined;

  const doDispatch = async () => {
    setState({ kind: 'dispatching', since: pulse });
    try {
      // NO `--max` — the difference from StartWorkButton. `plot-dispatch.sh`
      // treats no cap as "all eligible branches".
      const res = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: card.slug }),
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
      });
      const body = (await res.json()) as {
        slug?: string; error?: string; detail?: string; reason?: string;
      };
      if (!res.ok) {
        // `detail` FIRST, because it is the field this endpoint actually sends.
        // `/api/dispatch` answers a refusal with `{ok, slug, reason, detail}` —
        // never `error` — so reading `error` alone threw the sentence away and
        // rendered a bare `HTTP 409` in the menu. `StartWorkButton.tsx:271` fixed
        // exactly this on 2026-09-02 and this second caller did not get the fix;
        // both entrances refuse through the same body and must read it the same
        // way. `error` stays as the second choice: `readJsonBody` and the
        // cross-origin guard use it, and both can still refuse this POST.
        setState({
          kind: 'failed',
          message: body.detail ?? body.error ?? `HTTP ${res.status}`,
        });
      }
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (inFlight.current || blocked) return;
          inFlight.current = true;
          void doDispatch();
        }}
        aria-disabled={blocked || undefined}
        aria-busy={dispatching}
        title={refusal ?? `Dispatch all eligible branches of ${card.slug}`}
        className={
          blocked
            ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${dispatching ? ` ${ACTING_CLASS}` : ''}`
            : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {dispatching ? 'dispatching…' : 'Dispatch'}
        {dispatching && <ActingSpinner />}
        {!dispatching && refusal && (
          <span className="sr-only"> — unavailable: {refusal}</span>
        )}
      </button>
      {state.kind === 'dispatched' && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Agent work will show up shortly
        </span>
      )}
      {state.kind === 'failed' && (
        <span className="text-xs text-red-700 dark:text-red-400">{state.message}</span>
      )}
    </>
  );
}

/**
 * The plan row's `⋯` menu — the plan's own acts, and the reason it is a menu.
 *
 * **One answer to one question, plan-level.** A Draft plan awaits a person's
 * decision: Approve hands it to development. It belongs to the PLAN, and the
 * plan row — the row that NAMES the plan — is the only honest place for it.
 * It was never right on a branch row: a branch BLOCKED by an earlier slice
 * reads `waiting-on-you` when its plan is Draft, so a branch-row gate put a
 * plan act on a row whose own available act is not its own. That is why the
 * row-level twin is deleted, not merely re-gated, and why it lives here.
 *
 * **An approved plan with eligible work offers Implement and Dispatch.** Both
 * are plan-level: Implement prepares one slice, Dispatch fans out all eligible
 * branches. Neither appears on a branch row; neither appears on a plan with
 * nothing eligible (blocked or finished). Implement is present-but-refused
 * until its route exists (Slice 2); Dispatch posts to `/api/dispatch` with no
 * cap.
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
 * **Each act states its own refusal.** Approve names its own reason where
 * declined, because a refusal is not an absence. Where the plan is simply not
 * Draft there is no button at all.
 */
export function PlanActions({
  plan,
  card,
  approve,
  deliver,
  implement,
  dispatch,
  pulse = 0,
  onApproving,
  soleSlice,
  onStarting,
}: {
  plan: string;
  card: Card | null;
  /**
   * The name of the plan's ONE eligible slice, where it has exactly one and that
   * slice's row is folded into this one.
   *
   * Present, it adds a *Slice* section to this menu holding the `Start work` that
   * the slice's own row would have carried. Absent — the ordinary case — nothing
   * changes.
   *
   * **This exists so a row wears ONE `⋯`.** A sole-slice plan row used to render
   * `SliceActions` as a SIBLING of this component, so the row grew two adjacent
   * three-dot buttons with no way to tell which held which act: the operator had
   * to open both to find out. Two controls that look identical and do different
   * things is worse than either alone — the same defect the header's unlabelled
   * branch chip had, one grammar over.
   *
   * The acts do not merge into one list, because they answer different subjects:
   * everything else here acts on the PLAN, and this acts on a SLICE. They are
   * separated by a labelled rule rather than flattened.
   */
  soleSlice?: string;
  /** Threaded to the slice section's `StartWorkButton`; see {@link SliceActions}. */
  onStarting?: (active: boolean) => void;
  approve?: DispatchInfo;
  /**
   * Whether the server will act on Deliver, and why not — a SECOND act, and the
   * one that answers a plan on the OTHER end of the lifecycle. Approve gates on
   * a Draft plan; Deliver gates on a `deliverable` card (every non-deferred
   * branch merged, not yet delivered). The two gates are disjoint, so a plan
   * offers at most one class of act — but the menu that carries them is one,
   * because a plan head has one `⋯`.
   */
  deliver?: DispatchInfo;
  /**
   * Whether the server will act on Implement, and why not — the THIRD act, and
   * the complement of Dispatch on an approved plan. Approve gates on a Draft
   * plan and Deliver on a `deliverable` card; Implement (with Dispatch) gates on
   * eligible work. Passed under its own name so the item states its own refusal
   * and a later split of the spawn authorities changes one prop.
   */
  implement?: DispatchInfo;
  /**
   * Whether the server will act on Dispatch, and why not — the same binding
   * Start work uses to fan out one branch at a time. Used by `DispatchAllButton`
   * for the plan-level "dispatch all eligible branches" action.
   */
  dispatch?: DispatchInfo;
  /**
   * The pulse counter, passed through to `DispatchAllButton` for confirmation
   * watching. `StartWorkButton` watches it to confirm a claim landed; the
   * plan-level dispatch does the same for all eligible branches at once.
   */
  pulse?: number;
  onApproving?: (active: boolean) => void;
}) {
  const view = rowMenuOf({
    kind: 'plan', plan, card, isDraft: Boolean(card && isDraft(card)), needsDesign: Boolean(card?.controls.needsDesign),
    deliverable: Boolean(card?.deliverable), hasEligible: hasEligibleWork(card), soleSlice: soleSlice ?? null,
    approve, deliver, implement, dispatch,
  });
  const render = (item: RowMenuItem): ReactNode => {
    if (!card) return null;
    switch (item.action) {
      case 'approve':
        return approve ? <ApproveButton card={card} approve={approve} onApproving={onApproving} /> : null;
      case 'needs-design':
        return approve ? <NeedsDesignButton card={card} availability={approve} onActing={onApproving} /> : null;
      case 'deliver':
        return deliver ? <DeliverButton slug={card.slug} deliver={deliver} onActing={onApproving} /> : null;
      case 'implement':
        return implement ? <ImplementButton slug={card.slug} implement={implement} onActing={onApproving} /> : null;
      case 'dispatch':
        return dispatch ? <DispatchAllButton card={card} dispatch={dispatch} pulse={pulse} onDispatching={onApproving} /> : null;
      case 'start-work':
        // The item acts on the one slice folded into this row, which `data-slice-section` names.
        return dispatch ? (
          <span data-slice-section={soleSlice} className="block">
            <StartWorkButton card={card} dispatch={dispatch} pulse={pulse} onStarting={onStarting} />
          </span>
        ) : null;
      default:
        return null;
    }
  };
  return <ItemMenu view={view} trigger={{ 'data-plan-actions': plan, label: `Actions for ${plan}` }} render={render} />;
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
 *   - **Create story** — the working twin of *Create plan*, `CreateStoryButton`
 *     verbatim, with its own refusals (the binding, a host that cannot be asked)
 *     and the route's own for what only the repo knows: an unset `Story command`,
 *     or several declared story homes. It was offered-and-always-refused until
 *     2026-08-27, on a ground the skill it named contradicts.
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
  { issue, idea, story, issueAnswer, facts }:
  { issue: IssueRow; idea: DispatchInfo; story: DispatchInfo; issueAnswer: IssueAnswer | null; facts?: CardFacts },
) {
  const view = rowMenuOf({ kind: 'ticket', issue, idea, story, issueAnswer, facts });
  const render = (item: RowMenuItem): ReactNode => {
    switch (item.action) {
      case 'create-plan':
        return <CreatePlanButton issue={issue} idea={idea} issueAnswer={issueAnswer} factsRefusal={createPlanRefusal(facts)} />;
      case 'create-story':
        return <CreateStoryButton issue={issue} story={story} issueAnswer={issueAnswer} />;
      case 'open-issue':
        return (
          <a href={issue.url} target="_blank" rel="noreferrer" data-issue-open aria-label={`Open issue #${issue.number} on the host`} className={ITEM_LINK}>
            {item.label}
          </a>
        );
      default:
        return null;
    }
  };
  return (
    <ItemMenu
      view={view}
      trigger={{ 'data-issue-actions': String(issue.number), label: `Actions for issue #${issue.number}` }}
      render={render}
    />
  );
}

/**
 * The `⋯` menu of a Delivered by the sprint or Found during the sprint row.
 *
 * `rowMenuOf` decides each item from the `menu` arms `scopeTickets` answered; a
 * `tickets` arm renders the Tickets row's own button.
 */
export const ScopeTicketActions = (
  { ticketKey, issue, menu, idea, story, issueAnswer, facts }:
  { ticketKey: string; issue: IssueRow | null; menu: ScopeRowMenu; idea: DispatchInfo; story: DispatchInfo; issueAnswer: IssueAnswer | null; facts?: CardFacts },
) => {
  const view = rowMenuOf({ kind: 'scope-ticket', issue, menu, idea, story, issueAnswer, facts });
  const render = (item: RowMenuItem): ReactNode => {
    switch (item.action) {
      case 'create-plan':
        return issue === null ? null : <CreatePlanButton issue={issue} idea={idea} issueAnswer={issueAnswer} factsRefusal={createPlanRefusal(facts)} />;
      case 'create-story':
        return issue === null ? null : <CreateStoryButton issue={issue} story={story} issueAnswer={issueAnswer} />;
      case 'open-issue':
        return (
          <a href={menu.openOnHost.href} target="_blank" rel="noreferrer" data-issue-open aria-label={`Open issue #${ticketKey} on the host`} className={ITEM_LINK}>
            {item.label}
          </a>
        );
      default:
        return null;
    }
  };
  return <ItemMenu view={view} trigger={{ 'data-scope-ticket-actions': ticketKey, label: `Actions for issue #${ticketKey}` }} render={render} />;
};

/**
 * The facts of a Fleet agent row's `⋯`, from its registry entry and its branch row.
 *
 * @param entry - the registry entry; `null` for a role run.
 * @param row - the row of the branch the agent acts on; `null` where the payload holds none.
 * @param state - the agent's state word (`PlacedAgentView.state`).
 * @param bindings - the board's Continue, Restart and Drop answers, and whether the view opens plans and reveals branches.
 * @returns the `fleet-agent` facts `rowMenuOf` reads.
 */
export const fleetAgentMenuFacts = (
  entry: AgentEntry | null,
  row: AgentRow | null,
  state: string,
  bindings: { continueWith?: DispatchInfo; restartWith?: DispatchInfo; drop?: DispatchInfo; canOpenPlan: boolean; canReveal: boolean },
): FleetAgentMenuFacts => ({
  kind: 'fleet-agent',
  state,
  broken: entry !== null && isBrokenState(entry.state),
  branch: entry?.branch || row?.branch || '',
  session: entry?.session ?? '',
  openUrl: row === null ? '' : openTarget(row),
  openLabel: row === null ? 'Open' : openLabel(row),
  planFile: row?.planFile ?? '',
  ...bindings,
});

/**
 * Renders the `⋯` of a Fleet agent row from `rowMenuOf`'s `fleet-agent` item set, and mounts the agent panel its
 * items open. Show the agent, Continue and Restart open the agent panel, where Continue and Restart run; Drop agent
 * arms and confirms through `DropAgentButton`. The renderer decides nothing: every item's `enabled`, `reason` and
 * `confirm` comes from the view.
 *
 * @param facts - the agent's facts; see {@link FleetAgentMenuFacts}.
 * @param agent - the registry entry Drop agent posts; `null` for a role run.
 * @param onActing - called while a drop runs.
 * @param onOpenPlan - opens a plan's card by its file.
 * @param onRevealBranch - reveals a branch's row.
 */
export const FleetAgentMenu = ({ facts, agent, onActing, onOpenPlan, onRevealBranch }: {
  facts: FleetAgentMenuFacts;
  agent: AgentEntry | null;
  onActing?: ((active: boolean) => void) | undefined;
  onOpenPlan?: ((planFile: string) => boolean) | undefined;
  onRevealBranch?: ((branch: string) => void) | undefined;
}) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const view = rowMenuOf(facts);
  const render = (item: RowMenuItem): ReactNode => {
    switch (item.action) {
      case 'worker-log':
        return <button type="button" data-worker-log-open onClick={() => setPanelOpen(true)} aria-label={`Show the agent working on ${facts.branch}`} className={ITEM_LINK}>{item.label}</button>;
      case 'continue':
      case 'restart':
        return <button type="button" {...{ [`data-agent-${item.action}`]: '' }} onClick={() => setPanelOpen(true)} className={ITEM_LINK}>{item.label}</button>;
      case 'open':
        return (
          <a href={facts.openUrl} target="_blank" rel="noreferrer" data-open-link aria-label={`${item.label} ${facts.branch} on the git host`} className={ITEM_LINK}>
            {item.label}
          </a>
        );
      case 'open-plan':
        return <button type="button" data-agent-open-plan onClick={() => onOpenPlan?.(facts.planFile)} className={ITEM_LINK}>{item.label}</button>;
      case 'reveal-branch':
        return <button type="button" data-agent-reveal-branch onClick={() => onRevealBranch?.(facts.branch)} className={ITEM_LINK}>{item.label}</button>;
      case 'drop-agent':
        return agent !== null && facts.drop !== undefined ? <DropAgentButton agent={agent} drop={facts.drop} onActing={onActing} /> : null;
      default:
        return null;
    }
  };
  return (
    <>
      <ItemMenu view={view} trigger={{ 'data-row-actions': '', 'data-agent-actions': facts.branch, label: `Actions for agent ${facts.branch || facts.session}` }} render={render} />
      {panelOpen && facts.branch !== '' && (
        <WorkerLogModal
          branch={facts.branch}
          onClose={() => setPanelOpen(false)}
          canContinue={facts.continueWith}
          canRestart={facts.restartWith}
          onOpenPlan={onOpenPlan}
          onRevealBranch={onRevealBranch}
        />
      )}
    </>
  );
};
