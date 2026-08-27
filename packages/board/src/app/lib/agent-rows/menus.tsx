import { useEffect, useRef, useState } from 'react';
import {
  type AgentRow,
  type Card,
  type DispatchInfo,
  type IssueAnswer,
  type IssueRow,
} from '../../../contract/schema.js';
import { ApproveButton } from '../../components/ApproveButton.js';
import { CommissionDesignButton } from '../../components/CommissionDesignButton.js';
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
import { changedFilesLabel } from './actions.js';
import { isStartable, needsBrief } from './row-identity.js';
import { WorkerLogModal } from '../../components/WorkerLogModal.js';
import { DispatchLogModal } from '../../components/DispatchLogModal.js';
import { ChangedFilesModal } from '../../components/ChangedFilesModal.js';

/**
 * Whether a row offers its worker's log.
 *
 * **WORKING membership, and nothing else.** WORKING lists AGENTS — that is the
 * section's definition, restated by the plan this wave comes from — and an
 * agent is the thing that writes a log. Every other section lists results or
 * processes, which have none.
 *
 * Deliberately NOT keyed on whether a log exists, because the row cannot know:
 * it carries no worktree path and no worker state, and this wave adds neither.
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
  return row.group === 'working';
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
 * Does this row OFFER Open — and it is WAITING ON YOU, and only there.
 *
 * **The scope the motivating defect actually named.** The reported defect was a
 * plain PR *awaiting review* with no `⋯` at all — a row the reader must act on,
 * leading with a subject they had no route to. Open closes that. But a `quiet`,
 * `blocked` or `done` row has nothing to do, and the rule
 * `one-place-for-what-a-row-can-do` settled holds there: a menu whose only item
 * opens a link the row ALREADY shows (its branch name is an anchor) is the empty
 * `⋯` that lies, measured lying on two of six rows. So Open lives where the
 * section's whole membership means *this wants a person*: WAITING ON YOU.
 *
 * `openTarget` stays a pure address resolver — *what* to open — and this answers
 * *whether* to offer it. Two questions: a `done` row still HAS a branch address,
 * it simply is not somewhere the reader needs sending.
 *
 * Exported for test: the negative — a branch waiting its turn keeps no menu
 * though it has an address — is the half a check on the URL alone gets wrong,
 * and the one that reopens the empty-menu defect a section over.
 */
export function offersOpen(row: Pick<AgentRow, 'pr' | 'branchUrl' | 'group'>): boolean {
  return row.group === 'waiting-on-you' && openTarget(row) !== '';
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
export function storyRefusal(story: DispatchInfo, issueAnswer: IssueAnswer): string {
  return storyRefusalReason(story, issueAnswer);
}

/**
 * What a row's menu holds, and therefore whether it exists at all.
 *
 * **Two questions, and the old code asked only one.** `enabled` is *can
 * something in here act right now*; `present` is *is there anything in here at
 * all*. They came apart the moment the menu learned to refuse: a row whose one
 * act the server declines has an item, a reason, and nothing it can do — and
 * collapsing that into a single flag forces a choice between a control that
 * lies and a reason nobody can reach.
 *
 * **A REFUSAL IS NOT AN ABSENCE.** A declined act still renders the button,
 * `aria-disabled`, with the reason on it. Only a row with no item at all
 * renders none — the empty `⋯` that was measured lying on two of six WAITING ON
 * YOU rows.
 *
 * The run link joins `enabled` without a `willAct` term because it is
 * NAVIGATION: there is no rerun route on this server, so opening the host's
 * page is not a write and reads the same over Tailscale as it does at the
 * machine. The two dispatching items ask whether the server will act because
 * they ask the server to act.
 *
 * Exported for test, and the invariant is the reason: `enabled` must never be
 * true while `present` is false, or the board renders an openable menu with no
 * button to open it. That is one line of reasoning about four disjuncts, which
 * is exactly the kind that survives a refactor by being re-derived wrongly.
 */
export function menuState(items: {
  canStart: boolean;
  canResolve: boolean;
  /**
   * This row needs its brief written before it can be dispatched — see
   * {@link needsBrief}.
   *
   * Joins `enabled` with `implementWillAct`, for the same reason `canStart`
   * joins with `serverWillAct`: it asks the server to spawn `/plot-implement`,
   * which is a write.
   */
  canWriteBrief: boolean;
  hasRun: boolean;
  /**
   * This row is an agent, so it has a log to offer — see {@link showsWorkerLog}.
   *
   * Joins `enabled` without a `WillAct` term, for the reason the run link does:
   * it is a READ, and reads are not refused. The two dispatching items ask
   * whether the server will act because they ask the server to act; opening a
   * log asks it only to look.
   */
  hasLog: boolean;
  /**
   * A dispatcher log exists for this row's plan, so a `Status` entry can read
   * it — the durable home for what the Start work button's transient message
   * used to point at and then destroy.
   *
   * Joins `enabled` without a `WillAct` term, for the reason `hasLog` and the
   * run link do: it is a READ. Opening the dispatcher's own words asks the
   * server only to look, never to act.
   */
  hasStatus: boolean;
  /**
   * This row's failing check has a changed-file list to show — see
   * {@link offersChangedFiles}.
   *
   * Joins `enabled` without a `WillAct` term, and it is the purest READ in this
   * menu: the paths are already on the row, so opening them asks the server
   * nothing at all — not even to look, which is what separates it from the two
   * log items. A refusal is impossible here because there is nobody to refuse.
   */
  hasChangedFiles: boolean;
  /**
   * This row has an address to OPEN — its PR page or its branch on the host.
   *
   * **The item that makes the menu fit EVERY kind.** The measured defect was
   * two rows of three with no `⋯` at all — a plain PR awaiting review offered
   * nothing, so its menu was absent and the reader had no route to it. Open is
   * navigation to a fact the row already carries (`openTarget`), so it joins
   * `enabled` without a `WillAct` term for the reason the run link and the log
   * do: opening a page the row already names is not an act the server refuses.
   */
  hasOpen: boolean;
  // APPROVE AND COMMISSION DESIGN ARE NOT HERE, and their absence is the point.
  // Both are PLAN-level acts — approving a plan, or sending it to design — and a
  // branch row is never the honest place for either: a branch BLOCKED by an
  // earlier wave is in `waiting-on-you` when its plan is Draft, so any gate that
  // put them on a row would put them on a row whose own available act is not its
  // own. They live on the plan head (`PlanActions`), gated on the card's
  // `isDraft` alone. So this menu — the BRANCH row's menu — no longer carries
  // their flags: a disjunct that can never be true is a second rule asserting
  // the row offers a plan act, which is exactly the drift this file removes
  // rather than leaves unreachable.
  serverWillAct: boolean;
  /** Whether `/api/implement` will act — the gate for `canWriteBrief`. */
  implementWillAct: boolean;
}): { present: boolean; enabled: boolean } {
  const {
    canStart, canResolve, canWriteBrief, hasRun, hasLog, hasStatus, hasOpen,
    hasChangedFiles, serverWillAct, implementWillAct,
  } = items;
  return {
    present:
      canStart || canResolve || canWriteBrief || hasRun || hasLog || hasStatus || hasOpen ||
      hasChangedFiles,
    enabled:
      (canStart && serverWillAct) ||
      (canResolve && serverWillAct) ||
      (canWriteBrief && implementWillAct) ||
      hasRun ||
      hasLog ||
      hasStatus ||
      hasOpen ||
      hasChangedFiles,
  };
}

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
  implement,
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
  /** Whether the server will act on Implement — same binding as `dispatch`, used
      by WriteBriefButton for rows that need a brief. */
  implement?: DispatchInfo;
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
        implement={implement}
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
}: {
  row: AgentRow;
  card: Card | null;
  dispatch?: DispatchInfo;
  /** Whether the server will act on Implement — used by WriteBriefButton for
      rows that need a brief written before they can be dispatched. */
  implement?: DispatchInfo;
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
  // WRITE BRIEF — the act a row offers where it needs its brief written.
  //
  // `needsBrief(row)` is the predicate: this branch is otherwise startable but
  // lacks the specification a worker reads first. The button calls
  // `/api/implement`, which runs `/plot-implement`, which writes the brief.
  // Same route as the plan head's Implement button, different label because the
  // reader's question is different: "I need this branch's brief" rather than
  // "prepare the whole wave".
  //
  // Needs a card (for the slug) and an implement binding (for availability).
  const canWriteBrief = Boolean(card && implement && needsBrief(row));
  // Whether `/api/implement` will act — the same question Implement asks, read
  // from the same binding.
  const implementWillAct = implement?.available ?? false;
  // THE OTHER ACT A ROW CAN OFFER, and the reason this menu had to stop asking
  // only about starting.
  //
  // APPROVE IS NOT HERE ANY LONGER — it belongs to the PLAN, and a branch row is
  // never the honest place for it. Every gate tried on this row failed the same
  // way: `isDraft(card)` alone put Approve on a branch BLOCKED by an earlier
  // wave (its plan is genuinely Draft, so the card said yes) and adding
  // `waitingOn === 'you'` did not fix it — a blocked branch of a Draft plan
  // reads `waiting-on-you` too, so the button came back on a row whose own
  // available act is not its own. No narrowing makes a plan-level act correct on
  // a branch row, so the act moved to the plan head (`PlanActions`, gated on the
  // card's `isDraft` alone) and the row-level twin is deleted rather than
  // repaired. The plan's head is *one board, two answers*: the plan row offers
  // Approve, the branch row beneath it does not.
  //
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
  // THE CONFLICT, through the route that already exists — the same
  // `/api/dispatch` a Start work click uses, with the same script deciding
  // which branch and whether the wave is open. Moving it here added no route
  // and granted the board no new authority.
  //
  // Unlike the run link this asks for a card and a dispatch verdict, because a
  // dispatch needs a plan to name and an answer about whether the server acts.
  // `actionReachable` asks the same question for the cue, and the two must keep
  // agreeing: a cue pointing at a menu without this item is the defect that
  // function was written to remove, in its second form.
  const canResolve = Boolean(
    row.stuck?.state === 'conflict' && card && dispatch,
  );
  // OPEN — the item that makes the menu fit every WAITING ON YOU row. It is
  // navigation to a fact the row already carries (`openTarget`: the PR page, or
  // the branch on the host), so it needs no card, no dispatch verdict and no
  // fetch — the same shape as the run link. A PR row's Open reads *Review*,
  // because opening a PR is what reviewing it is; a branch row's reads *Open*.
  //
  // `offersOpen` scopes it to WAITING ON YOU, and that scope is load-bearing: a
  // `quiet` or `done` row has an address too, but nothing to do — and an Open
  // item there is the empty menu `one-place-for-what-a-row-can-do` removed, one
  // section over. Where there is no address (a merged branch, a host with no PR
  // url) there is no item either, and the row falls back to whatever else it
  // offers.
  const openUrl = offersOpen(row) ? openTarget(row) : '';
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
  // no worktree and no worker state — deliberately, since this wave adds no
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
  const { present: hasItems, enabled } = menuState({
    canStart, canResolve, canWriteBrief, hasRun: Boolean(runUrl), hasLog, hasStatus,
    hasOpen: Boolean(openUrl), hasChangedFiles, serverWillAct, implementWillAct,
  });
  const reason =
    canStart && !serverWillAct && dispatch?.reason
      ? dispatch.reason
      : canResolve && !serverWillAct && dispatch?.reason
        ? dispatch.reason
        : noActionReason(row);

  // Close on Escape and on any click outside. A menu that survives a click
  // elsewhere on a view that repaints every five seconds is a menu that ends up
  // hovering over a row it no longer belongs to.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // A CLICK INSIDE THE MENU IS NOT A CLICK OUTSIDE IT, and this has to be
    // decided by hit-testing the target rather than by the container stopping
    // propagation.
    //
    // The comment here used to claim the container did stop it. It does not,
    // and could not: the container's `onClick` is a React handler, which runs
    // when the event BUBBLES, while this listener runs on CAPTURE — so the
    // close always won the race. React 19 delegates to the root container, so
    // by the time the event bubbled back up the menu had already unmounted and
    // every handler inside it went with it.
    //
    // Measured on the run link the day it moved in: the click reached the `<a>`
    // — the browser followed the href — and React's `onClick` never fired, so
    // the cue that the click was supposed to answer went on animating. The
    // existing items were reachable only because neither of them needed a
    // handler of its OWN to survive the close: `StartWorkButton` fires a fetch
    // from a handler that is itself inside the menu, and it worked because the
    // fetch was already in flight before the unmount.
    const onDown = (e: globalThis.MouseEvent) => {
      if (menu.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    // Capture phase, so the menu closes before a click lands anywhere else.
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
    // NO `role="gridcell"` — `TupleRowView` renders the cell this sits in, and
    // renders it whether or not a kind offers a menu, so the track holds its
    // width either way. This keeps `relative`, which is what the popup below
    // floats out of.
    <div
      className="relative w-5 shrink-0 text-right"
      onClick={(e) => e.stopPropagation()}
    >
      {/* THE CELL IS UNCONDITIONAL, the button inside it is not — and that
          split is what lets a row render no menu without the column moving.
          The track is a fixed `1.25rem`, so the right edge holds still whether
          or not anything is in it, which is the property the old dimmed
          placeholder was reaching for before the track existed. */}
      {hasItems && (
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
          // 24 x 24 OF HIT AREA. Measured on the running board 2026-08-19 this
          // button was **12 x 12 px** — half of what WCAG 2.2 asks a pointer
          // target, and the same size as the status glyphs beside it, which are
          // not targets at all. Two marks of equal size where one is pressable
          // and one is not is its own confusion.
          //
          // `h-6 w-6` grows the TARGET; the glyph keeps `text-xs`, so the row
          // density is untouched. `-my-1` and `-mr-0.5` absorb the growth into
          // the row rather than letting it push the line box taller or the
          // right edge wider: the cell is a fixed `1.25rem` track and the
          // stillness of that edge is the property it exists for.
          className={
            enabled
              ? '-my-1 -mr-0.5 inline-flex h-6 w-6 items-center justify-center rounded text-xs leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
              : // Very dim, and this branch now means something narrower than
                // it used to: not *a row with nothing to do* — such a row
                // renders no button at all — but a row whose act the server
                // has REFUSED. The reason is on the control; the dimness says
                // not from here.
                '-my-1 -mr-0.5 inline-flex h-6 w-6 cursor-default items-center justify-center text-xs leading-none text-slate-300 dark:text-slate-700'
          }
        >
          ⋯
        </button>
      )}
      {/* NO `card` GATE. It read `open && enabled && card`, and requiring a card
          for the whole BODY is the same defect one level up that requiring
          `dispatch` was one level down: *Open failing run* needs no card at all
          — a row outside the walked plan directories has a run and no card, and
          gating the body on one would render an empty menu on exactly the row
          whose item does not need it.

          Each ITEM asks for what it needs, and an item whose precondition is
          missing simply is not there. That is now the body's only rule. */}
      {open && enabled && (
        <div
          role="menu"
          ref={menu}
          className="absolute right-0 z-10 mt-1 min-w-max rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {/* OPEN — the item that makes the menu fit every kind, and the reason
              a plain PR row is no longer menuless. Navigation to a fact already
              on the row (`openTarget`), so a real `<a>` with a real `href`: a
              `cmd`-click opens it in a tab, and it needs no card, no dispatch
              verdict and no fetch. It reads *Review* on a PR row and *Open* on a
              bare branch (`openLabel`), because opening a PR is reviewing it. */}
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
          {/* APPROVE AND COMMISSION DESIGN ARE NOT RENDERED HERE — both are
              PLAN decisions and live on the plan head (`PlanActions`), not on a
              branch row. A branch BLOCKED by an earlier wave reads
              `waiting-on-you` when its plan is Draft, so any gate that kept
              either here would put a plan-level act on a row whose own available
              act is not its own — the very defect the row-level gates chased and
              never caught. The plan head is *one board, two answers*: the plan
              row offers Approve and Commission design; the branch rows beneath
              keep Start work, Open/Review, the conflict dispatch and the reads. */}
          {/* THE CONFLICT DISPATCH, moved here on 2026-08-18 from the stuck
              cell. Same route, same button, same guard — only its home changed.

              Wrapped so the click marks the request answered whatever the
              dispatch then does: the cue tracks the ASKING, and
              `StartWorkButton` reports on the doing in its own words. The wrap
              is why `onTaken` had to travel into this menu at all. */}
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
          {/* WRITE BRIEF — the act that writes this branch's brief.

              Shown where `needsBrief(row)` is true: the branch is otherwise
              startable but lacks the specification a worker reads first. Calls
              `/api/implement`, which runs `/plot-implement`, which writes the
              brief. Same route as the plan head's Implement button — the slug
              is the plan's, so `/plot-implement` prepares the whole wave — but
              the label says what the click does for THIS row.

              THE MENU ITEM REPLACES THE TEXT in the "needs a brief" line. The
              row still says "needs a brief" and names the path; the menu offers
              the action that clears it. Different roles, same fact. */}
          {canWriteBrief && card && implement && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <WriteBriefButton
                slug={card.slug}
                branch={row.branch}
                implement={implement}
                onActing={onStarting}
              />
            </div>
          )}
          {/* THE RUN, moved here from an inline link in the stuck cell — and
              widened on the way: its condition is *a run URL exists*, not *this
              row is failing*, so the last run of a GREEN branch is reachable
              too. That widening is the plan's, proposed and flagged rather than
              smuggled.

              **The WORD *failing* went with the condition.** The plan's table
              still names this item *Open failing run*, and that name was true
              only under the condition the same table widened — on a green row
              it would promise a failure that is not there. The label follows
              what the item now does: it opens the last run, whatever that run
              said. The row's own stuck cell is where *failing* is stated, in
              words, and it states it only when true.

              **The accessible name keeps the branch.** The menu is already
              scoped to one row, so the branch reads as redundant from inside
              it — but a menu item's name is announced without its opener, and
              nothing else in the item says which of a dozen rows this run
              belongs to. The plan left this open; redundant context costs a
              few words and missing context costs the click. The STATE left the
              name for the same reason the word did: it was `— CI failed`, no
              longer true of every row that offers this.

              Navigation, so it stays an `<a>` with a real `href` — a
              `cmd`-click opens the run in a tab, and a button pretending to be
              a link would take that away. It is in the MENU because it is an
              errand rather than a name the row carries; see the note above. */}
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
          {/* THE WORKER'S LOG — a read, in the menu for the reason `Open last
              run` above it is: an errand about a process the row reports on,
              rather than a name the row carries.

              **It only SETS state the ROW owns**, and that is load-bearing
              rather than incidental. The close-on-outside-click effect above
              runs on CAPTURE, so this menu unmounts before React's bubbled
              `onClick` would fire from inside it — the exact defect that comment
              records the run link hitting. A `setState` on the parent survives
              that: the Row still exists, and it is the Row that mounts the
              panel. A panel mounted HERE would be unmounted by the same click
              that opened it. */}
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
          {/* THE DISPATCHER'S OWN WORDS — the durable home for what the Start
              work button used to hand back as a transient *no change — see log*
              string. Present whenever a dispatcher log exists for the plan
              (`card.hasDispatchLog`); a plan nobody has dispatched has none, and
              the item is simply not there.

              Like `Show the agent` it only SETS state the ROW owns — the
              close-on-outside-click effect runs on CAPTURE, so this menu unmounts
              before a bubbled `onClick` from inside it would fire, and a panel
              mounted HERE would be torn down by the same click that opened it.
              The Row mounts the panel; this asks it to. */}
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
          {/* WHAT THE BRANCH CHANGES — the third evidence line of a failing
              check, moved off the row on 2026-08-20. It was six wrapped paths
              of prose in the row, which every reader scrolled past so the
              occasional one who wanted them did not have to click.

              The label COUNTS rather than lists (`changedFilesLabel`), because
              an item that named the paths would put the dump back one click
              away instead of removing it — and the count is itself the fact a
              reader uses to decide whether to open it.

              **The only item here that asks the server nothing at all.** The
              two log items are reads the server answers; this one's content
              arrived on the pulse that drew the row, so there is no route
              behind it and none is wanted — the plan is explicit that the menu
              shows only what the pulse already carries.

              It only SETS state the ROW owns, for the reason the two items
              above it do: the close-on-outside-click effect runs on capture, so
              a panel mounted here would be unmounted by the click that opened
              it. */}
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
    // Capture phase, so the menu closes before a click lands anywhere else —
    // and the hazard `RowActions` records applies: a bubbled handler inside a
    // menu that unmounts on capture never fires. `StartWorkButton` manages its
    // own arm/run state internally, so it survives that.
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
    // NO `role="gridcell"` — `TupleRowView` renders the cell this sits in, and
    // renders it whether or not a kind offers a menu, so the track holds its
    // width either way.
    <div className="relative w-5 shrink-0 text-right" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-wave-actions={wave}
        aria-haspopup="menu"
        aria-expanded={open}
        // Never the native attribute — a natively disabled control leaves the
        // tab order and takes the explanation with it.
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
    // Capture phase, so the menu closes before a click lands anywhere else — the
    // same hazard `RowActions`/`PlanActions` record. `ResliceButton` manages its
    // own arm/run state internally, so it survives the unmount on capture.
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
    // NO `role="gridcell"` — `TupleRowView` renders the cell this sits in, and
    // renders it whether or not a kind offers a menu, so the track holds its
    // width either way. `relative` is what the popup below floats out of.
    <div className="relative w-5 shrink-0 text-right" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-reslice-actions={wave}
        aria-haspopup="menu"
        aria-expanded={open}
        // ALWAYS enabled, unlike `WaveActions`: the item inside always applies to
        // an unsliced wave, and where the server refuses, the item — not this
        // trigger — carries the reason.
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
 * Whether the card has work that could be started now.
 *
 * The gate for Implement and Dispatch: an approved plan (`phase === 'Development'`)
 * with at least one eligible branch. A plan with nothing eligible — every wave
 * is blocked, claimed, merged or deferred — offers neither act.
 *
 * Returns false for any card without a pulse yet (`eligible` is undefined), which
 * is the same answer `startRefusal` gives: waiting for the first fleet scan.
 */
export function hasEligibleWork(card: Card | null): boolean {
  return Boolean(card && isApproved(card) && (card.waveSummary?.eligible ?? 0) > 0);
}

/**
 * Dispatch all: fans out all eligible branches of this plan in one click.
 *
 * The difference from `StartWorkButton` is the CAP: Start work posts with
 * `--max 1` because it is on a wave row and means *this wave, now*; Dispatch
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
  const claimedRef = useRef(card.waveSummary?.claimed);
  const claimed = card.waveSummary?.claimed;
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
      });
      const body = (await res.json()) as { slug?: string; error?: string };
      if (!res.ok) {
        setState({ kind: 'failed', message: body.error ?? `HTTP ${res.status}` });
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
 * **An approved plan with eligible work offers Implement and Dispatch.** Both
 * are plan-level: Implement prepares one wave, Dispatch fans out all eligible
 * branches. Neither appears on a branch row; neither appears on a plan with
 * nothing eligible (blocked or finished). Implement is present-but-refused
 * until its route exists (Wave 2); Dispatch posts to `/api/dispatch` with no
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
  implement,
  dispatch,
  pulse = 0,
  onApproving,
  soleWave,
  onStarting,
}: {
  plan: string;
  card: Card | null;
  /**
   * The name of the plan's ONE eligible wave, where it has exactly one and that
   * wave's row is folded into this one.
   *
   * Present, it adds a *Wave* section to this menu holding the `Start work` that
   * the wave's own row would have carried. Absent — the ordinary case — nothing
   * changes.
   *
   * **This exists so a row wears ONE `⋯`.** A sole-wave plan row used to render
   * `WaveActions` as a SIBLING of this component, so the row grew two adjacent
   * three-dot buttons with no way to tell which held which act: the operator had
   * to open both to find out. Two controls that look identical and do different
   * things is worse than either alone — the same defect the header's unlabelled
   * branch chip had, one grammar over.
   *
   * The acts do not merge into one list, because they answer different subjects:
   * everything else here acts on the PLAN, and this acts on a WAVE. They are
   * separated by a labelled rule rather than flattened.
   */
  soleWave?: string;
  /** Threaded to the wave section's `StartWorkButton`; see {@link WaveActions}. */
  onStarting?: (active: boolean) => void;
  approve?: DispatchInfo;
  /**
   * Whether the server will act on Commission design, and why not — the OTHER
   * answer to a Draft plan, gated here exactly as Approve is. The same binding
   * as `idea` (spawning a plot agent to write a plan is one authority), passed
   * under its own name so the item states its own refusal and a later split of
   * the two authorities changes one prop.
   */
  commission?: DispatchInfo;
  /**
   * Whether the server will act on Deliver, and why not — a THIRD act, and the
   * one that answers a plan on the OTHER end of the lifecycle. Approve and
   * Commission gate on a Draft plan; Deliver gates on a `deliverable` card (every
   * non-deferred branch merged, not yet delivered). The two gates are disjoint,
   * so a plan offers at most one class of act — but the menu that carries them is
   * one, because a plan head has one `⋯`.
   */
  deliver?: DispatchInfo;
  /**
   * Whether the server will act on Implement, and why not — the FOURTH act, and
   * the complement of Dispatch on an approved plan. Approve and Commission gate
   * on a Draft plan and Deliver on a `deliverable` card; Implement (with
   * Dispatch) gates on eligible work. Passed under its own name so the item
   * states its own refusal and a later split of the spawn authorities changes
   * one prop.
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
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  // `isDraft(card)` rather than the group's phase word: `plot-approve.sh`
  // accepts phase `draft` and refuses every other one, and the card's own gate
  // is the single spelling of that rule. Two spellings drift — which is how the
  // branch menu and the card came to disagree in the first place.
  //
  // BOTH draft acts share this one gate. A Draft plan is what a person decides
  // about, and Approve and Commission design are the two answers; each then asks
  // its OWN binding whether the server will act, below.
  const isDraftPlan = Boolean(card && isDraft(card));
  const canApprove = Boolean(isDraftPlan && approve);
  const canCommission = Boolean(isDraftPlan && commission);
  // Deliver's OWN gate, disjoint from the draft one: the card's `deliverable`
  // bit, which the server sets only where it auto-bumped a fully-merged plan
  // into Testing — never on a plan already delivered. So this is true on exactly
  // the plans that are complete-but-not-delivered, which is where the decision
  // to deliver lives.
  const canDeliver = Boolean(card?.deliverable && deliver);
  // The APPROVED acts: Implement and Dispatch. Both gate on an approved plan
  // with eligible work. The two together are the complement of Start work, which
  // sits on a wave row and dispatches one branch — this menu sits on the plan
  // row and offers either *prepare one wave* (Implement) or *fan out all of it*
  // (Dispatch).
  const hasEligible = hasEligibleWork(card);
  const approveWillAct = approve?.available ?? false;
  const commissionWillAct = commission?.available ?? false;
  // The DRAFT acts open the `⋯` only when one WILL act — a Draft plan with both
  // bindings refused has nothing to show but a tooltip, which is the behaviour
  // #160 settled and this must not disturb.
  const draftWillAct =
    (canApprove && approveWillAct) || (canCommission && commissionWillAct);
  // The APPROVED acts follow `DeliverButton`'s shape: the menu opens on an
  // eligible approved plan EVEN WHEN the server refuses or the route is missing.
  // Implement states its own refusal (no route yet); Dispatch states the server's.
  // Both render whenever `hasEligible`, so an approved plan with work always
  // sees its two starts.
  const approvedWillShow = hasEligible;
  // DELIVER is `ResliceMenu`'s shape, not the draft one: the menu opens on a
  // deliverable plan EVEN WHEN the server refuses, because `DeliverButton` states
  // its own refusal inside — a refusal is not an absence. So the `⋯` opens when a
  // draft act will act OR the plan is deliverable OR it has eligible work, and
  // the buttons below render whenever their own gate passes.
  const canOpen = draftWillAct || canDeliver || approvedWillShow || Boolean(soleWave);
  // The dim button's tooltip names a refusal only when there IS one to name —
  // an act present and declined. The reason of whichever act this plan offers
  // leads, so the sentence points at a real binding rather than a generic one.
  const refusalReason =
    (canApprove ? approve?.reason : undefined) ||
    (canCommission ? commission?.reason : undefined) ||
    (canDeliver ? deliver?.reason : undefined) ||
    (hasEligible ? dispatch?.reason : undefined) ||
    `Cannot act on ${plan} from here`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Capture phase, so the menu closes before a click lands anywhere else —
    // and the same hazard `RowActions` records applies: a bubbled handler
    // inside a menu that unmounts on capture never fires. `ApproveButton`
    // manages its own arm/run state internally, so it survives that.
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
    // NO `role="gridcell"` — `TupleRowView` renders the cell this sits in, and
    // renders it whether or not a kind offers a menu, so the track holds its
    // width either way. This keeps `relative`, which is what the popup below
    // floats out of.
    <div
      className="relative w-5 shrink-0 text-right"
      onClick={(e) => e.stopPropagation()}
    >
      {/* `soleWave` joins the render gate, and must: it is the row's ONLY act
          in the ordinary sole-wave case. `hasEligible` reads
          `card.waveSummary.eligible`, which a payload can leave at 0 while the
          fleet still reports one eligible wave — and before this the row's
          trigger came from the SIBLING `WaveActions`, which had no such gate.
          Folding the act inward without widening the gate would delete the
          control on exactly the rows this fix is about. */}
      {(isDraftPlan || canDeliver || hasEligible || soleWave) && (
        <button
          type="button"
          data-plan-actions={plan}
          aria-haspopup="menu"
          aria-expanded={open}
          // Never the native attribute — a natively disabled control leaves the
          // tab order and takes the explanation with it.
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
          {/* Each act renders only where its OWN binding will act — one refused
              binding leaves the other's item alone. The menu opens only when at
              least one can act (`willAct`), so it is never empty. */}
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
          {/* Rendered whenever the plan is deliverable, EVEN WHEN the server
              refuses — `DeliverButton` states its own refusal inside, the way
              every `ResliceButton` does. This is the one item that departs from
              the draft acts above, which render only where their binding will
              act; the departure is deliberate, so a refused delivery is a named
              control rather than a vanished one. */}
          {canDeliver && deliver && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <DeliverButton slug={card.slug} deliver={deliver} onActing={onApproving} />
            </div>
          )}
          {/* The approved acts: Implement and Dispatch. Rendered whenever the
              plan has eligible work, EVEN WHEN the server refuses — each states
              its own refusal inside. The menu opens when hasEligible, so these
              are never alone in an empty menu. Implement posts to /api/implement
              and reads its outcome back; Dispatch posts to /api/dispatch with no
              cap. */}
          {hasEligible && implement && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <ImplementButton slug={card.slug} implement={implement} onActing={onApproving} />
            </div>
          )}
          {hasEligible && dispatch && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <DispatchAllButton
                card={card}
                dispatch={dispatch}
                pulse={pulse}
                onDispatching={onApproving}
              />
            </div>
          )}
          {/* THE WAVE SECTION — the acts of the one wave folded into this row.
              Everything above acts on the PLAN; this acts on a WAVE, so it sits
              under a labelled rule rather than joining the list. A reader
              scanning the menu can see which subject each item takes without
              opening it, which is exactly what two identical `⋯` buttons could
              not tell them. */}
          {soleWave && dispatch && (
            <>
              <div
                role="separator"
                data-wave-section={soleWave}
                className="mt-1 border-t border-slate-200 px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500"
              >
                Wave {soleWave}
              </div>
              <div role="menuitem" className="px-2 py-1 text-left">
                <StartWorkButton
                  card={card}
                  dispatch={dispatch}
                  pulse={pulse}
                  onStarting={onStarting}
                />
              </div>
            </>
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
  { issue, idea, story, issueAnswer }:
  { issue: IssueRow; idea: DispatchInfo; story: DispatchInfo; issueAnswer: IssueAnswer },
) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // Close on Escape and on any click outside — the same effect `RowActions`
  // runs, on CAPTURE for the same reason: a menu that survives a click on a view
  // repainting every few seconds ends up over a row it no longer belongs to.
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
    // NO `role="gridcell"` — `TupleRowView` renders the cell this sits in, and
    // renders it whether or not a kind offers a menu, so the track holds its
    // width either way. This keeps `relative`, which is what the popup below
    // floats out of.
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
          {/* CREATE PLAN — the working action, unchanged. Its own arm/confirm and
              its own refusals live inside the button; the menu only gives it a
              home beside the other two. */}
          <div role="menuitem" className="px-2 py-1 text-left">
            <CreatePlanButton issue={issue} idea={idea} issueAnswer={issueAnswer} />
          </div>
          {/* CREATE STORY — the twin of Create plan, and no longer a control
              that exists only to decline. Its refusals are CONDITIONAL now: the
              binding and the tracker here, and from the route the two facts only
              the repo knows — an unset `Story command`, or several declared story
              homes, each named rather than guessed around.

              A plan is a commitment to do work, a story a commitment to track
              work — the one thing the old refusal got right, kept in the armed
              label (`track #N` beside Create plan's `Draft`) rather than in a
              block. */}
          <div role="menuitem" className="px-2 py-1 text-left">
            <CreateStoryButton issue={issue} story={story} issueAnswer={issueAnswer} />
          </div>
          {/* OPEN ON HOST — navigation to a fact the row already carries, or
              nothing where the host gave no address (the same "" the number cell
              already handles). No guard, no fetch. */}
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

/**
 * The menu for a BROKEN agent row — one in `stalled` or `unknown` state,
 * rendered in WAITING ON YOU as a problem report.
 *
 * THE ONE ACTION IT OFFERS IS DROP. A broken agent has no PR to open, no work
 * to start, no story to create — the worker stopped and the entry remains. The
 * drop action removes the manifest so the row disappears, the board's manual
 * reconciliation for entries the automatic resolver cannot clear.
 *
 * The endpoint refuses a live worker regardless of what this menu says, so the
 * control renders even for `unknown` — asking gives a clear answer, and a
 * refusal names the reason.
 *
 * RENDERS NOTHING WHERE THE ENTRY HAS NO SESSION. A manifest without a session
 * id has no file to remove; the row is a synthesized worktree with no dispatch,
 * and it drains when the worktree does.
 */
export function BrokenAgentMenu({
  agent,
  drop,
  onActing,
  onDropped,
}: {
  /** The broken agent entry. */
  agent: import('../../../contract/schema.js').AgentEntry;
  /** Whether this server will act on Drop, and why not. */
  drop?: import('../../../contract/schema.js').DispatchInfo;
  /** Reports that a click is outstanding (true) or has settled (false). */
  onActing?: (active: boolean) => void;
  /** Called when the drop succeeds — the row can remove itself from the list. */
  onDropped?: () => void;
}) {
  const [open, setOpen] = useState(false);

  // No session = no manifest = nothing to drop. The row should not get a menu
  // at all; this gate is the second line, and it is the one that fires where
  // the caller forgot the first.
  if (!agent.session) return null;

  // No drop availability means the server never told us — hide the menu rather
  // than show one whose only item is unavailable.
  if (!drop) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Agent actions"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        // THE SAME TRIGGER AS EVERY OTHER ROW'S MENU. This drew its own SVG of
        // three circles until 2026-08-27 while the other four menus in this
        // file used the `⋯` glyph — so a broken agent's row carried a control
        // that looked like a different KIND of control, in the one place a
        // reader is already unsure what is wrong. An operator reported it as
        // *"why do we use a new type of menu for these broken workers"*.
        //
        // A menu is a menu: the row it sits on says what is exceptional, and
        // the trigger says only *there are acts here*.
        className="inline-flex h-6 w-5 items-center justify-center leading-none text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
      >
        <span aria-hidden className="text-xs">⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Agent actions"
          // THE SAME PANEL AS EVERY OTHER MENU, byte for byte. This diverged on
          // five properties — `min-w-[160px]` vs `min-w-max`, `rounded` vs
          // `rounded-md`, `py-1` vs `p-1`, and `dark:bg-slate-800` vs
          // `dark:bg-slate-900` — so it sat at a different width, corner radius
          // and shade than the four menus beside it. Each difference is small
          // and together they read as a different component.
          className="absolute right-0 z-10 mt-1 min-w-max rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
          }}
        >
          <div role="menuitem" className="px-2 py-1 text-left">
            <DropAgentButton
              agent={agent}
              drop={drop}
              onActing={onActing}
              onDropped={() => {
                setOpen(false);
                onDropped?.();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
