import { useState, type MouseEvent } from 'react';
import {
  type AgentRow,
  type WaitingOn,
  type Card,
  type DispatchInfo,
  type Fleet,
  type IssueAnswer,
  type IssueRow,
  type WaitingGroup,
  type Slice,
  type AgentEntry,
  UNNAMED_SLICE,
  isSpikeSlice,
  isBrokenState,
  RELEASE_BRANCH,
} from '../../../contract/schema.js';
import { tupleFromIssue, tupleFromPlan, tupleFromRow, tupleFromSlice, planPrAggregate, statusTone, tupleAgeText, agentStateStatus, agentAvailability, shortSessionId, worktreeName, KIND_LABEL } from '../tuple-row.js';
import { TupleLinkView, TupleRowView } from '../../components/TupleRow.js';
import { activityPace } from './activity.js';
import { soleRowStatus, exceptionSummary } from './stuck.js';
import { type PlanGroup, elsewhereNote, planWaitingDays, sliceKeyOf, sliceSummaryFor } from './sections.js';
import { roundsBadgeText } from '../../components/PlanCard.js';
import { machineNote, noteWithoutPr } from './host-notes.js';
import { briefGapNote, needsBrief, waitingTone } from './row-identity.js';
import { type SliceGroup, groupedNote, sliceDissent } from './slices.js';
import { ActivityMark, BlockedByMark, ChangeMark, StuckCell, UnpushedMark } from './marks.js';
import { BranchMenu, BrokenAgentMenu, IssueRowActions, PlanActions, ResliceMenu, SliceActions } from './menus.js';
import { WorkerLogModal } from '../../components/WorkerLogModal.js';
import { DispatchLogModal } from '../../components/DispatchLogModal.js';
import { ChangedFilesModal } from '../../components/ChangedFilesModal.js';

/**
 * Whether a row holds commits its remote has never seen.
 *
 * A COUNT, not a boolean, and `> 0` rather than truthiness: the field defaults
 * to 0 and 0 means *not observed here*, so the two collapse to the same answer
 * — no mark — without either pretending to be the other.
 *
 * Exported for test: the pairing that matters is a row that is dirty AND ahead,
 * where an implementation checking the two in sequence loses whichever it tests
 * second.
 */
export function isUnpushed(row: AgentRow): boolean {
  return (row.localAhead ?? 0) > 0;
}

/**
 * Whether a branch is a RELEASE branch — a PR by mechanism, a release by
 * meaning.
 *
 * The one measured instance is `changeset-release/main`, the branch Changesets
 * opens and force-pushes as changesets accumulate. Nothing in `## Plot Config`
 * declares a release-branch shape, and nothing else in the board detects one,
 * so this is the first place that has to name it.
 *
 * THE PATTERN IS THE SERVER'S, imported rather than restated. `RELEASE_BRANCH`
 * in `fleet.ts` carries the argument for why the name is matched in exactly one
 * place — *"A second copy on the client would be the defect"* — and a regex
 * literal here would be that copy. This function is the client-side spelling of
 * the question, not a second answer to it.
 *
 * It landed as `return false` with a TODO, which is worse than absent: every
 * release row silently took the ordinary PR kind, and the feature read as
 * unbuilt rather than broken.
 */
export function isReleaseBranch(branch: string): boolean {
  return RELEASE_BRANCH.test(branch);
}

/**
 * What the reader is deciding about on this row — the fact that earns the
 * dominant track.
 *
 * `PlanRow` already applies this rule and says so outright: *a plan row is not a
 * branch row*, because a plan's branches are how it travels and not what is
 * being judged. This extends the same rule to the rows that share `ROW_TRACKS`,
 * where the `1fr` track held the BRANCH NAME whether or not the branch was the
 * point — measured across three WAITING ON YOU rows, all `state=wip` with an
 * open PR, all leading with the vehicle.
 *
 * **THE DISCRIMINATOR IS WHERE THE PROBLEM LIVES, not whether a PR exists.**
 * That distinction is the whole finding, and the two cases it separates render
 * identically today — a red badge beside a branch name — while sending the
 * reader to different places:
 *
 * - A FAILING BUILD IS PR WORK. The check ran for the PR, the fix is a commit
 *   that updates the PR, and the reader acts through it. The PR leads.
 * - A MERGE CONFLICT IS BRANCH WORK. A conflict is a property of the branch
 *   against its base; nothing about the PR resolves it. The reader checks out
 *   the branch, rebases, pushes. The branch leads, EVEN WITH A PR OPEN.
 *
 * **Where both are true the conflict wins**, because it blocks the merge
 * outright: a red build on an unmergeable PR is moot until the rebase happens,
 * and fixing it first can be wasted work if the rebase changes what fails. The
 * build failure is not lost — the row names it on a second line — which is the
 * whole reason `pr.states` had to become a set before this rule could be
 * written. With a single value the row never learned the build had failed.
 *
 * READ FROM `states`, NOT FROM `state`. `state` is the winner and would answer
 * `conflicts` for the both-true row, which happens to be the right subject by
 * accident — and would answer it for the plain conflict too, leaving the second
 * line unwriteable. The set is what distinguishes the two.
 *
 * Exported for test: the both-true row is the case every simpler implementation
 * gets wrong, and it is invisible in a payload that predates the set.
 */
export function rowSubject(row: Pick<AgentRow, 'pr' | 'branch'>): 'pr' | 'branch' | 'release' {
  // A RELEASE IS ITS OWN KIND, and it is asked about FIRST — before the PR/branch
  // question, because the answer is neither. `changeset-release/main` is a PR by
  // mechanism and a release by meaning, and it is the one row nobody should merge
  // by reflex: every changeset merged since it opened changes what it would ship,
  // so the version in its title stops being the version it cuts. Leading with its
  // number would make it look MORE like an ordinary PR, which is the direction
  // that costs a reader something.
  //
  // That is a UI restatement of a rule this repo already holds outside the board:
  // a release is outward-facing and only ever cut on an explicit request.
  if (isReleaseBranch(row.branch)) return 'release';
  // NO PR AT ALL: there is nothing else the row could lead with. Stated before
  // the states are consulted rather than falling out of them, because an empty
  // set on a row with no PR and an empty set on a payload predating the field
  // are different situations and only one of them is this one.
  if (!row.pr) return 'branch';
  // A CONFLICT ANYWHERE IN THE SET, not `states[0] === 'conflicts'`. The head is
  // the winner and a conflict always wins, so today those agree — but `includes`
  // is what the rule actually means, and a future precedence change must not be
  // able to silently move a conflicting row's subject back to the PR.
  if (row.pr.states.includes('conflicts')) return 'branch';
  return 'pr';
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
  /**
   * Whether this server will act on Approve, and why not — the plan-PR half of
   * acting, and the half this tab was never given. `board.approve` reached the
   * CARDS from the day it shipped; a row whose one available act was approving
   * got a dead menu while the same plan's card offered the button.
   */
  approve?: DispatchInfo;
  /**
   * Whether this server will act on `Continue with an answer`, and why not.
   *
   * Named `continueWith` rather than `continue` because `continue` is a
   * reserved word: as a prop name it is legal and as a destructured binding it
   * is not, so the shorter name would have to be renamed at every use anyway.
   */
  continueWith?: DispatchInfo;
  /**
   * Whether this server will act on `Create plan`, and why not — the ISSUE
   * row's one action.
   *
   * Absent where the board has not said, and the button then reads as
   * unavailable rather than offering an act whose outcome is unknown — the same
   * rule the three above follow. It is only HALF of what that control needs:
   * `fleet.issueAnswer` says whether the tracker can be asked at all, and the
   * row consults both.
   */
  idea?: DispatchInfo;
  /**
   * Whether this server will act on `Create story`, and why not — the TENTH
   * capability, and the ticket row's second action. Same binding as `idea` today
   * (both spawn a plot agent that writes to this disk), kept its own prop for
   * the reason every flag above it is: one flag for two capabilities is how they
   * diverge.
   *
   * **It is new because the control it feeds used to need no data at all.**
   * *Create story* carried a constant refusal — a claim about stories rather
   * than a fact about this board — and a constant is exactly what a capability
   * is not.
   */
  story?: DispatchInfo;
  /**
   * Whether this server will act on `Commission design`, and why not — the
   * PLAN row's second decision, beside Approve. Same binding as `idea` today
   * (both spawn a plot agent), kept its own prop for the reason every capability
   * flag above it is: one flag for two capabilities is how they diverge.
   */
  commission?: DispatchInfo;
  /**
   * Whether this server will act on `Slice this plan`, and why not — the sixth
   * capability, reaching the `unsliced-wave` slice rows. Same binding as `idea`
   * and `commission` today (all spawn a plot agent that writes to this disk),
   * kept its own prop for the reason those are: one flag for two capabilities is
   * how they diverge.
   */
  reslice?: DispatchInfo;
  /**
   * Whether this server will act on `Deliver`, and why not — the seventh
   * capability, reaching the PLAN rows whose card is `deliverable`. Same binding
   * as `idea`, `commission` and `reslice` today (all spawn a plot agent that
   * writes to this disk), kept its own prop for the reason those are: one flag
   * for two capabilities is how they diverge. Read together with the card's
   * `deliverable` bit — this says the board can act, that says the plan is
   * complete enough to.
   */
  deliver?: DispatchInfo;
  /**
   * Whether this server will act on `Implement`, and why not — the eighth
   * capability, reaching the PLAN rows with eligible work. Same binding as
   * `idea`, `commission`, `reslice` and `deliver` today (all spawn a plot agent
   * that writes to this disk), kept its own prop for the reason those are: one
   * flag for two capabilities is how they diverge. Read together with the card's
   * `hasEligibleWork` — this says the board can act, that says the plan has work
   * to start.
   */
  implement?: DispatchInfo;
  /**
   * Whether this server will act on `Drop this agent`, and why not — the ninth
   * capability, reaching agent rows in WAITING ON YOU. Unlike the eight above,
   * this removes a manifest rather than spawning an agent: it is the board's
   * manual reconciliation for entries the automatic resolver cannot clear.
   *
   * Same binding as the eight above (a write to this disk), kept its own prop
   * for the reason those are: one flag for two capabilities is how they diverge.
   * The endpoint refuses a live worker regardless of this flag; this says the
   * board CAN act, the endpoint says whether it SHOULD on a given entry.
   */
  drop?: DispatchInfo;
  /** Bumps once per BOARD refresh; the Start work button counts these. */
  pulse?: number;
  /** A Start work click became outstanding (true) or settled (false). */
  onStarting?: (active: boolean) => void;
  /**
   * Scroll to and highlight a branch's row — the agent panel's BRANCH fact's
   * destination. Owned by the page above the list, because the highlight is a
   * kind of arrival marker (like the board's `?plan=`) that this list only
   * renders, and because the panel that triggers it must close first.
   */
  onRevealBranch?: (branch: string) => void;
  /**
   * The branch just revealed, or "" — the row whose `<li>` wears the ring.
   *
   * The scroll target is `#agent-row-<branch>`; the ring is this. Transient by
   * intent, like the board's `highlight`: it marks WHERE YOU ARRIVED, not a
   * selection, so the page clears it on the next interaction.
   */
  highlightBranch?: string;
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
export function PlanLink({
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
 * The column names, on the same tracks as the rows beneath them.
 *
 * This is what lets track 2's `sr-only` prefix go. The list used to be a
 * `<li>` of `<span>`s — as the old comment said, *"a visual table with no table
 * semantics"* — so column position conveyed nothing and each row was heard as a
 * run of words. `Branch` does not announce itself as a KIND any more than
 * `Development` announced itself as a phase, and every cell needed a label of
 * its own to compensate. With a header row a screen reader announces the
 * column, once, for every cell under it.
 *
 * `sr-only` on screen and real in the accessibility tree. The six columns are
 * legible to a sighted reader from their alignment — that alignment is the
 * whole point of this slice — and printing the words above every one of six
 * groups would cost six lines of chrome that never varies. The reader who
 * cannot see the alignment is exactly the reader who needs the names.
 *
 * NOT a `<table>`. The rows carry interactive controls and sit inside a
 * collapsible group structure with per-plan sub-headings; table markup would
 * fight that grouping rather than serve it. `role="grid"` on the `<ul>` keeps
 * the DOM and gains the semantics.
 *
 * Hidden below `sm`, where the row stops being a row: a card has no columns for
 * a header to name, and the kind cell takes its own label back there.
 *
 * SEVEN NAMES FOR SEVEN TRACKS, matching `TUPLE_TRACKS`. The marks track is
 * named too — it was not, while it held only decoration, and it now carries
 * slot 1's kind ICON as well, which is a fact about the row rather than an
 * ornament on it.
 */
export function HeaderRow() {
  return (
    <li role="row" className="sr-only max-sm:hidden">
      {/* THE SIX SLOTS, and the header is where each is NAMED for a reader who
          cannot see the alignment.

          It used to read `Kind / Plan / Branch / Pull request / Age / Actions`
          — six names for the seven tracks of a BRANCH, which is what a plan row
          and a ticket row were also laid on. Two of those names could not be
          true of every row beneath them: a plan has no branch and a ticket has
          no pull request, and the header said both anyway because the grid it
          described was one kind's.

          The tuple's names are true of all seven, which is the property being
          a shape buys. `Related` rather than `Plan` or `Branch`: slot 4 holds
          whatever a kind's artifacts are — a PR's plan and branch, a build's
          PR, a branch's plan — and each link states its own `what` beside
          itself, so the column heads what they have in common rather than
          naming one kind's case for all of them. */}
      <span role="columnheader">Marks</span>
      <span role="columnheader">Kind</span>
      <span role="columnheader">Name</span>
      <span role="columnheader">Related</span>
      <span role="columnheader">Status</span>
      <span role="columnheader">Age</span>
      <span role="columnheader">Actions</span>
    </li>
  );
}

/**
 * A PLAN, as a tuple — the same component and the SAME GRID a branch row uses.
 *
 * ## The reversal this records
 *
 * `PLAN_ROW_TRACKS` existed on an argument that was right about its own case
 * and wrong about the shape: *"a plan row is not a branch row, so it does not
 * borrow the branch tracks"*. Correct while there were two kinds — and the
 * reason there were two grids for what the contract now says are seven. The
 * second grid did not fix the mismatch it was built for; it moved it. A TICKET
 * still rendered through the tracks of a BRANCH, having no slice, no worker and
 * no branch, because a third mismatch would have needed a third grid.
 *
 * What the two grids were really arguing about was slot CONTENT, and the tuple
 * settles it there: a plan's slot 3 is its name, its slot 4 is the branch it
 * names one of, its slot 5 is its PHASE — the object that fact belongs to — and
 * its slot 6 is the approval clock. No borrowing, because there is nothing to
 * borrow from: one grid, filled per kind by a projection.
 *
 * The nesting that `PLAN_ROW_TRACKS` was drawn to prevent — eight sibling plans
 * reading as a hierarchy because a plan NAME and a branch NAME both began at
 * 222px — is prevented by slot 2 instead, and more directly. The two rows now
 * differ by the WORD in the kind slot (`Plan` against `Branch`) rather than by
 * an indent a reader has to measure, which is the same repair slot 2 made for
 * the four-meanings column: state the fact rather than encode it in geometry.
 *
 * **The indicator sits here** rather than on the branches, because this is what
 * is waiting. That is the section's ordinary rule applied to a different
 * subject, not a new rule.
 */
export function PlanRow({
  group,
  slices,
  onOpenPlan,
  expanded,
  onToggle,
  active,
  marked = false,
  card = null,
  approve,
  commission,
  deliver,
  implement,
  pulse = 0,
  onApproving,
  ageMinutes,
  elsewhere = 0,
  soleSlice,
  dispatch,
  onStarting,
}: {
  group: PlanGroup;
  /**
   * The fleet's server-derived slices — the list the head's count reads instead
   * of re-grouping `group.rows`. See `sliceSummaryFor`. Undefined on a pre-slice
   * server's pulse (the board casts, so the field is absent rather than `[]`),
   * and the summary then falls back to the row derivation.
   */
  slices?: Slice[];
  onOpenPlan?: AgentListProps['onOpenPlan'];
  /**
   * How many of this plan's slices belong in ANOTHER section — from
   * `slicesElsewhere`, computed at the call site where the server's `fleet.slices`
   * and this head's section are both in scope. The head states the number so a
   * plan split across sections is legible as split; zero appends nothing. See
   * `elsewhereNote`.
   */
  elsewhere?: number;
  /**
   * The plan's clock in minutes, where the APPROVAL clock is not the one running.
   *
   * `planWaitingDays` is right for NOT STARTED — the branches have no tip, so
   * `waitingDays` is all there is. Outside it the reverse holds: measured on the
   * live board, `waitingDays: null` on every WAITING ON YOU row while
   * `ageMinutes` reads real values. The caller passes the freshest of its
   * branches, which is the same clock a slice row uses.
   */
  ageMinutes?: number;
  /** Whether the branches beneath are showing — null where there is no fold. */
  expanded: boolean | null;
  onToggle?: () => void;
  /** Something is being written to one of this plan's branches. */
  active?: boolean;
  /**
   * Something BENEATH this plan changed on the last pulse — see `ChangeMark`.
   *
   * A FOLDED PLAN IS THE CASE THIS EXISTS FOR, and it is why the head carries
   * the mark at all. Reported from the live board: a write landed on a branch
   * whose plan was collapsed, so the row that flashed was not in the DOM and
   * the reader saw nothing. The heading is then the only thing on the page that
   * can say anything about it — the same argument `group-activity` makes for
   * the activity mark on a folded SECTION, one level in.
   *
   * Aggregated by the caller with `rows.some(...)`, exactly as `active` beside
   * it is: a plan speaks for its branches or it says nothing about them.
   */
  marked?: boolean;
  /** This plan's board card — what `ApproveButton` acts on. Null off-board. */
  card?: Card | null;
  /** Whether this server will act on Approve, and why not. */
  approve?: DispatchInfo;
  /** Whether this server will act on Commission design — the plan head's OTHER
      act, threaded through to `PlanActions` beside Approve. */
  commission?: DispatchInfo;
  /** Whether this server will act on Deliver — the plan head's act on the OTHER
      end of the lifecycle, threaded to `PlanActions`, gated on the card's
      `deliverable` bit rather than on a Draft phase. */
  deliver?: DispatchInfo;
  /** Whether this server will act on Implement — the plan head's complement to
      Dispatch on an approved plan, threaded to `PlanActions`, gated on the card
      having eligible work. */
  implement?: DispatchInfo;
  /** Whether this server will act on Dispatch — same binding as Start work,
      threaded to `PlanActions` for the plan-level "dispatch all" action. */
  /** A click is outstanding (true) or has settled (false). */
  onApproving?: (active: boolean) => void;
  /**
   * The plan's sole slice, where it has exactly one — the slice's status shows on
   * this row rather than on a separate slice row beneath it.
   *
   * A plan with one slice renders NO slice row: the plan row carries the slice's
   * verdict, and a second row would state the same thing twice. Measured on
   * this estate: 35 of 54 plans have exactly one slice.
   */
  soleSlice?: Slice | null;
  /**
   * Whether this server will dispatch, and why not — passed through to the
   * `SliceActions` control the plan row carries for a ONE-SLICE plan.
   *
   * `soleSlice` hides the slice row; this is how the *Start work* that row would
   * have carried rides onto the plan row instead. Dispatch is one board-level
   * binding, not a per-slice one: `plot-dispatch.sh` fans out the eligible slice,
   * which for a one-slice plan is the only slice there is — no guessing, the worry
   * that keeps dispatch off a multi-slice plan row. Absent off-board, where the
   * control cannot act anyway.
   */
  dispatch?: DispatchInfo;
  /** The pulse counter, passed through to `StartWorkButton` inside `SliceActions`. */
  pulse?: number;
  /** A Start-work click became outstanding (true) or settled (false). */
  onStarting?: (active: boolean) => void;
}) {
  const waiting = planWaitingDays(group);
  // THE SECTION'S OWN SLICES, then how many are ELSEWHERE. `sliceSummaryFor` counts
  // what this section holds — from the server's `slices` where the payload
  // carries them — and is silent about the rest; `elsewhere` names the rest so a
  // plan split across sections reads as split rather than as a whole plan two
  // slices short. Joined with a middot when both speak; either alone stands on
  // its own, and both empty renders nothing (the aside guards on it).
  const here = sliceSummaryFor(group, slices);
  const away = elsewhereNote(elsewhere);
  // THE INTERROGATION ROUNDS, where the plan has been through any.
  //
  // `roundsBadgeText` is `PlanCard`'s, reused rather than restated: the rule
  // that `0 rounds` must never render — it would read as *interrogated and
  // found nothing* — belongs to one function, and a second copy here is how the
  // two tabs come to disagree about the same plan.
  //
  // MEASURED 2026-08-25 walking the v2.9.0 endgame, Stop 5.6: 40 of 120 cards
  // carry `rounds` and the Board tab renders every one, while the Agents tab
  // rendered none. The field was never in the fleet payload's rows — it is a
  // fact about the PLAN, and the plan head is where a plan fact belongs. The
  // card was already in reach here through `cardForPlanFile`; nothing asked it.
  // IT RENDERS BESIDE THE PHASE, not among the slice counts. `2 slices · 2
  // branches · 2 rounds` read as a third tally of PARTS, and rounds is not a
  // count of anything the plan contains: it is the STATE of the discovery work.
  // `Discovery` says a plan is being thought about; the badge beside it says how
  // far that thinking got. Same reasoning as the `draft` badge below — two
  // badges answering different questions, never folded into one word.
  const rounds = card ? roundsBadgeText(card) : '';
  // THE EXCEPTIONS, if any — `claimed twice`, `conflict`, etc. A fold containing
  // an exception names it here so the reader knows without unfolding; the plan's
  // own rule is *folding may hide repetition, never exceptions*.
  const exceptions = exceptionSummary(group.rows);
  const summary = [here, away].filter(Boolean).join(' · ');
  const foldable = expanded !== null;
  // THE PHASE IS THE PLAN'S, and slot 5 is where a fact about the plan is true.
  // Read from the group's rows rather than from a plan field, because a row is
  // what carries `phase` — and they agree by construction, all being branches
  // of one plan.
  const phase = group.rows[0]?.phase ?? '';
  // THE FOLD OF ITS BRANCHES' PR STATES — one worst-case word beside the phase.
  //
  // DERIVED HERE, from the `group` this component receives, and NOT at either
  // call site. `PlanRow` has two, and they are asymmetric: the NOT STARTED path
  // folds `active`/`marked` at the call site, while the `planHeads` path over
  // SLICE groups passes neither. An aggregate computed the way `marked` is would
  // land on one kind of plan head and not the other — and a folded slice-grouped
  // plan is exactly the case this exists for. Both sites already pass `group`;
  // computing from it here reaches both by construction, which is the property
  // the split at the call site cannot give. (Adding `marked` to one site and not
  // the other already cost a fix on 2026-08-22 that rendered nothing.)
  //
  // STAYS WHEN EXPANDED, unlike the change mark beside it: a long group scrolls
  // its head off screen either way, so hiding it removes the fact exactly when
  // the reader has scrolled past the rows that would restate it. No
  // `expanded`-dependent behaviour — the rule the change mark's own docstring
  // calls the shape it should have had.
  const prFold = planPrAggregate(group.rows.map((r) => r.pr?.state));
  return (
    <TupleRowView
      tuple={(() => {
        const t = tupleFromPlan({
          plan: group.plan,
          planFile: group.planFile,
          phase,
          waitingDays: waiting,
          // HOW MANY IT HEADS. The `h3` this row replaced carried `(3)` beside
          // the plan name, and the count went missing with it — leaving a folded
          // group that does not say how much it hides.
          rowCount: group.rows.length,
        });
        // The BRANCH clock overrides the approval one where the caller has it and
        // the approval clock is absent — see `ageMinutes`. Unlabelled, because
        // *since last change* is the rule and this is a change.
        return ageMinutes !== undefined && Number.isFinite(ageMinutes) && waiting === null
          ? { ...t, age: { text: tupleAgeText(ageMinutes), label: '' } }
          : t;
      })()}
      onOpenPlan={onOpenPlan}
      rowAttr={{ 'data-plan-row': group.plan }}
      // THE PLAN'S CLOCK IS ITS APPROVAL, and the sentence says so. `waiting`
      // alone leaves *waiting for what?* unanswered; this is the answer, and it
      // is the same sentence a not-started branch row gives the clock it
      // inherits from this plan — one clock, one look, wherever it appears.
      ageTitle={waiting === null ? undefined : 'Approved this long ago, and nobody has started it'}
      // NO BORDER: the plan row heads a group that draws one line under itself
      // and its branches together. A rule here would fall between a plan and
      // its own first branch.
      bordered={false}
      extra={
        // THE CHANGE MARK, and a FOLDED plan is the case it exists for.
        //
        // Reported from the live board: a write landed on a branch whose plan
        // was collapsed, so the row that flashed was not in the DOM and the
        // reader saw nothing at all. The head is then the only thing on the
        // page that can say anything about it — the same argument
        // `group-activity` makes for a folded SECTION, one level in.
        //
        // `extra` rather than `marks`, because the mark tints the whole line
        // with `inset-0` and that needs the row itself as its positioning
        // parent. The slice row carries it in the same slot for the same reason.
        //
        // ONLY WHILE FOLDED, and that is the whole of the head's licence. With
        // the branches on screen they flash for themselves, and a head flashing
        // alongside them tints two lines for one event — the reader sees a
        // second change that never happened. Folded, the head is the only thing
        // that can report it; open, it is a duplicate.
        //
        // `expanded === false`, not `!expanded`: the prop is `boolean | null`
        // and null means *this plan has no fold* — a head with nothing to hide
        // hides nothing, so its branch is right there flashing.
        marked && expanded === false ? <ChangeMark /> : null
      }
      marks={
        // Always the FAST pace, because `active` is the only thing that reaches
        // this row: NOT STARTED is where plan rows are drawn, and its branches
        // are by definition not in WORKING, so the slow pace has no case to
        // state here. A plan row shows a mark exactly when one of its branches
        // is being written to — including one folded out of sight, which is the
        // case the mark most needs to reach.
        // THE FOLD AND THE ACTIVITY MARK SHARE THIS TRACK, and they can:
        // the fold belongs to the plan row only, the mark appears on it only
        // while a branch is being written to, and both are facts about THIS row
        // rather than about its content. The kind icon left this track on
        // 2026-08-20 precisely so it could hold what belongs to the row.
        <>
          {foldable ? (
            // THE FOLD LIVES IN THE MARKS TRACK, at the row's leading edge and
          // BEFORE the kind's icon. It sat in slot 5 until 2026-08-20 on the
          // argument that slot 3 was "a fixed 12rem … and a 24px control inside
          // it would take a fifth of the plan name's width" — true then, and the
          // premise is gone: the marks track was freed when the kind icon moved
          // out of it, so the control now has a track of its own at the one place
          // a reader looks for a disclosure.
          //
          // 24 x 24 OF HIT AREA IS KEPT VERBATIM. Measured on the running board
          // 2026-08-19 this control was 5 x 10 px at `font-size: 10px`, a fifth
          // of what WCAG 2.2 asks of a pointer target. `h-6 w-6` with the mark
          // centred is that fix and it is not being re-litigated; what changes is
          // the GLYPH, from 13px to 16px, matching the section fold — the same
          // distinction as the section heading: the target was right, seeing it
          // was not.
          <button
            type="button"
            data-slice-toggle={group.plan}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} the branches of ${group.plan}`}
            onClick={onToggle}
            // `-mt-1`, and it is a CENTRING correction rather than a nudge.
              // Measured on the mock: this control's box is 24px tall against
              // the kind label's 14px, so with both starting near the row's top
              // their centres land 3px apart — the caret low, which is what a
              // screenshot showed. `self-start` would make it worse (the glyph
              // sits mid-box), and shrinking the box is not available: 24 x 24
              // of hit area is the WCAG 2.2 minimum this control was fixed to
              // meet and is not being re-litigated.
              //
              // So the box keeps its size and moves up by half the difference.
              className="-mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            {/* ONE glyph, ROTATED — not two glyphs of similar mass. `▸` and `▾`
                differ by which way a small triangle points; a 90-degree rotation
                is the same difference stated in geometry rather than typeface,
                and it animates, so the state change is visible in motion as well
                as in the still. */}
            <span
              aria-hidden
              className={`inline-block text-2xl leading-none transition-transform ${expanded ? 'rotate-90' : ''}`}
            >
              ▸
            </span>
          </button>
          ) : null}
          {active ? <ActivityMark pace="fast" inTrack /> : null}
        </>
      }
      // THE PHASE KEEPS ITS `data-phase` HOOK, on the slot that now holds it.
      // It was in the plan row's name cell and before that in a branch row's
      // phase TRACK; the attribute names the fact, not the cell that happened
      // to print it, so every assertion that reads it keeps an owner.
      statusAttr={phase ? { 'data-phase': phase, title: `Phase: ${phase}` } : undefined}
      // THE PR FOLD, BESIDE THE PHASE — `statusExtra` adds to slot 5, never
      // replaces its word. The phase keeps slot 5 by construction: this is a
      // second element in the same cell, so `tupleFromPlan`'s phase is never at
      // risk — the defect this must not re-open from the other direction, where
      // 71 branch rows once printed their plan's phase.
      //
      // The WORD carries, colour only reinforces it — the rule `StuckCell`
      // records failing under colour alone. `conflicts`/`checks failing` take
      // the actionable rose tone from `statusTone`; `CI running` (pending) takes
      // an explicit DIMMER slate, marking the difference between *something is
      // happening* and *do something*. A count rides only where more than one
      // branch carries the state — a single branch says its own size by being
      // one row once opened.
      //
      // A ONE-SLICE PLAN shows its sole slice's VERDICT here instead of the PR
      // fold — the slice row is suppressed, so this is the only place the verdict
      // appears. The verdict outranks the prFold: `eligible`/`blocked`/`complete`
      // says what to do next, while a PR state is about a branch that may not
      // exist yet.
      statusExtra={<>
        {/* THE INTERROGATION ROUNDS, a badge in the phase's own cell.
            It sits BEFORE the verdict/PR fold and never replaces either: the
            three answer different questions — *how far did the thinking get*,
            *what can be started*, *what are its branches doing* — and a plan in
            Discovery with an eligible slice should say both. Styled as `draft`
            is, because it is the same kind of fact: a small standing property
            of the row, not a state that changes under you. */}
        {rounds && (
          <span
            data-plan-rounds
            className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            title={`Interrogated: ${rounds} of /challenge-the-plan`}
          >
            {rounds}
          </span>
        )}
        {soleSlice?.verdict ? (
        <span
          data-sole-wave-verdict={soleSlice.verdict}
          title={`This plan's sole slice: ${soleSlice.verdict}`}
          className={`min-w-0 shrink-0 truncate ${statusTone(soleSlice.verdict)}`}
        >
          {soleSlice.verdict}
        </span>
      ) : prFold ? (
        <span
          data-plan-pr-fold={prFold.state}
          data-plan-pr-count={prFold.count > 1 ? prFold.count : undefined}
          title={`${prFold.count > 1 ? `${prFold.count} branches` : 'A branch'} of this plan: ${prFold.word}`}
          className={`min-w-0 shrink-0 truncate ${
            prFold.state === 'pending'
              ? 'text-slate-400 dark:text-slate-600'
              : statusTone(prFold.word)
          }`}
        >
          {prFold.word}{prFold.count > 1 ? ` (${prFold.count})` : ''}
        </span>
        ) : null}
      </>}
      aside={
        // THE SLICE SUMMARY — *3 slices, first eligible*, then *· 1 slice
        // elsewhere*. It answers *which slice of this plan* in the plan's own
        // terms, which are the only terms this row has: the branches it would
        // otherwise name do not exist yet. In slot 4 beside the branch link for
        // the same reason a branch row's slice badge is there — it qualifies the
        // item rather than pointing anywhere. The `elsewhere` clause makes the
        // section-scoping legible: a plan split across sections says how many of
        // its slices this head does NOT speak for.
        //
        // THE EXCEPTIONS, if any, in amber — `claimed twice`, `conflict`, etc.
        // A fold containing an exception names it so a reader can decide whether
        // to unfold without unfolding: the plan's rule is *folding may hide
        // repetition, never exceptions*. A clean fold shows no exception clause.
        summary || exceptions ? (
          <span className="flex items-center gap-2 truncate">
            {summary && (
              <span
                data-slice-summary
                className="truncate text-slate-500 dark:text-slate-400"
                title="Slices of this plan in this section — and how many sit in another"
              >
                {summary}
              </span>
            )}
            {exceptions && (
              <span
                data-plan-exceptions
                className="shrink-0 font-medium text-amber-700 dark:text-amber-500"
                title="Exceptions in this plan's branches — conflicts, claims, or structural issues"
              >
                {exceptions}
              </span>
            )}
          </span>
        ) : null
      }

      // THE PLAN'S OWN ACT — approving — belongs to the PLAN. `plot-approve.sh`
      // takes a plan and no branch, the server reports `approve` per plan, and
      // the row that names the plan is the only honest place for it. That is
      // `PlanActions`, always present.
      //
      // AND, WHERE THE PLAN HAS EXACTLY ONE SLICE, that slice's *Start work* rides
      // here too — because `one-wave-renders-as-its-plan` hid the slice row this
      // control lived on, and hiding a row must not hide its control. The old
      // worry — that a plan-row dispatch "would have to guess which of the
      // plan's slices it meant" — is exactly what a ONE-slice plan does not have:
      // there is one slice, so there is nothing to guess. `plot-dispatch.sh` fans
      // out the eligible slice, and here that is the only slice there is.
      //
      // A MULTI-slice plan keeps this off: its slice rows still render and still
      // carry their own `SliceActions`, so a plan-row control would be the guess
      // the old comment warned of. The gate is `soleSlice` being present AND
      // `eligible` — the same `verdict === 'eligible'` gate a slice row applies,
      // for the same reason (`isStartable`: a control whose usual state is "you
      // cannot" teaches people to ignore controls).
      //
      // `SliceActions` is a SECOND `⋯` beside `PlanActions`, the same composition
      // a slice row uses (`SliceActions` + `ResliceMenu` + `BranchMenu`): each
      // disjoint act-family carries its own trigger. These are additional to the
      // plan acts, never in place of them — a Draft one-slice plan shows both.
      menu={
        /* ONE menu, two sections — never two menus. The sole slice's `Start
           work` is a section INSIDE `PlanActions` rather than a second `⋯`
           beside it: two adjacent three-dot buttons look identical and hold
           different acts, so the operator had to open both to learn which was
           which. */
        <PlanActions
          plan={group.plan}
          card={card}
          approve={approve}
          commission={commission}
          deliver={deliver}
          implement={implement}
          dispatch={dispatch}
          pulse={pulse}
          onApproving={onApproving}
          soleSlice={
            soleSlice?.verdict === 'eligible' && card && dispatch
              ? (soleSlice.name || UNNAMED_SLICE)
              : undefined
          }
          onStarting={onStarting}
        />
      }
    />
  );
}

/**
 * A SLICE, as a tuple — the eighth kind, and the row this section was missing.
 *
 * ## What it replaces
 *
 * Rendered on the mock 2026-08-20, a three-slice plan produced four rows all
 * labelled `PLAN`. Each of the three beneath the plan named its BRANCH in slot
 * 3, carried the slice name as a trailing badge, linked
 * `PLAN fleet-scan-asks-the-host` in slot 4 — directly beneath the plan row
 * heading them — showed `open` in slot 5 where the scan had computed
 * `eligible`, `blocked`, `blocked`, and spelled `blocked by Shaped — 1
 * outstanding` in prose one line below the `Shaped` row itself.
 *
 * Five defects, one cause: **a first-class entity rendered as an adjective on
 * something else, and its status rendered as prose because it had no column.**
 *
 * ## The fold is the exception here, unlike on a plan
 *
 * A slice holding ONE branch renders one row and no fold — the branch is its
 * artifact link and there is nothing hidden. Measured over the estate that is
 * 20 of 21 unfinished slices, so it is the common case and not an edge. A slice
 * holding several gets the disclosure, with its branches beneath.
 *
 * `showsSliceFold` on the plan row asks the same question one level up and
 * answers it from a row count; this asks it of a slice's branches. Both are
 * *does opening this reveal anything*, and neither renders a control over a
 * single row the reader can already see.
 */
export function SliceRow({
  group,
  plan,
  waitingDays,
  expanded,
  onToggle,
  active,
  marked = false,
  card = null,
  dispatch,
  implement,
  reslice,
  pulse,
  onStarting,
  groupedCount,
  groupedWord,
  soleRow,
  continueWith,
  onOpenPlan,
  onRevealBranch,
  planHeaded = false,
  slices,
  onExpandSection,
}: {
  group: SliceGroup;
  /** The plan this slice slices — for the row's test hook, not for a link. */
  plan: string;
  /**
   * The payload's slices, carried through so a BLOCKED slice row can resolve which
   * SECTION its blocker sits in — `BlockedByMark` unfolds that section before it
   * scrolls. Undefined on a cast payload from a pre-#349 server; the mark then
   * assumes an open section and queries as it always did.
   */
  slices?: Slice[];
  /** Unfold one collapsed section — passed to `BlockedByMark`. */
  onExpandSection?: (section: WaitingGroup) => void;
  /** The plan's approval clock, inherited where the slice has no tip of its own. */
  waitingDays: number | null;
  /** Whether the branches beneath are showing — null where there is no fold. */
  expanded: boolean | null;
  onToggle?: () => void;
  /** Something is being written to one of this slice's branches. */
  active?: boolean;
  /** Whether this slice changed on the last pulse — see `ChangeMark`. */
  marked?: boolean;
  /** The PLAN's card — what `StartWorkButton` acts on. Null off-board. */
  card?: Card | null;
  /** Whether this server will dispatch, and why not. */
  dispatch?: DispatchInfo;
  /** Whether this server will act on Implement — used by WriteBriefButton for
      rows that need a brief written before they can be dispatched. */
  implement?: DispatchInfo;
  /**
   * Whether this server will reslice, and why not — used ONLY on an
   * `unsliced-wave` row, where it drives the *Slice this plan* menu. Absent
   * elsewhere: no other slice offers the act.
   */
  reslice?: DispatchInfo;
  /** The pulse counter, passed through to `StartWorkButton`. */
  pulse: number;
  onStarting?: (active: boolean) => void;
  /**
   * How many of this slice's branches the section is counting, and the WORD for
   * what that count means — `3 to review`, `2 stalled`, `2 delivered`.
   *
   * Set wherever a slice is grouped from rows that are already under way, which
   * replaces the verdict in slot 5. The verdict answers *may this slice be
   * started* and every one of these describes a slice that already was: measured,
   * `opus5-longhorizon-hardening :: Implementation` reads `blocked` with five
   * landed branches, so the verdict would tell a reader to wait while five
   * reviews wait on them.
   *
   * The word travels WITH the count rather than being derived from the section
   * here, because this component does not know which section is rendering it —
   * and passing the section in only to switch on it would put the same decision
   * in two places.
   */
  groupedCount?: number;
  groupedWord?: string;
  /**
   * The one row this slice holds, where it holds exactly one — so the slice row can
   * show that branch's own status and age.
   *
   * A slice of one gets no fold (there is nothing hidden to reveal), which means
   * the slice row is the ONLY row that branch gets. Its PR condition —
   * `conflicts`, `checks failing` — is a fact the verdict cannot carry and there
   * would be no second row to read it from. Measured: all 12 slices in WAITING ON
   * YOU hold one branch, so this is the ordinary case rather than an edge.
   */
  soleRow?: AgentRow;
  continueWith?: DispatchInfo;
  onOpenPlan?: (planFile: string) => boolean | void;
  onRevealBranch?: (branch: string) => void;
  /**
   * Whether a PLAN ROW heads this slice's group — set by the caller, which is the
   * only place that knows.
   *
   * Suppresses the plan link on a slice of one: with a plan row directly above,
   * the link says twice what the nesting already states. Measured when it did —
   * `Tracer` rendered `plan opus5-longhorizon-hardening` beneath a plan row of
   * that name and wrapped to double height.
   */
  planHeaded?: boolean;
}) {
  const foldable = expanded !== null;
  // The slice's own age is the freshest of its branches — a slice has no tip, so
  // its clock is the clock of the work in it. `null` where none of them has one,
  // and then `tupleFromSlice` falls back to the plan's approval clock, labelled.
  const ages = group.rows.map((r) => r.ageMinutes).filter((a): a is number => a !== null);
  // A SLICE OF ONE INHERITS ITS BRANCH'S NOTE, since there is no branch row left
  // to carry it: `conflicting: …`, `last commit 6h ago`, `PR #303, checks
  // failing`. The verdict sentences are about starting, and this branch is
  // started.
  const soleNote = soleRow ? noteWithoutPr(soleRow.note, soleRow.pr) : '';
  // THE VERDICT IS THE WAITING-STATE, and these are the two cases NOT STARTED
  // holds: a slice a person may start, and a slice an earlier one is holding back.
  // Both are already answered by the verdict — see `aside` below for why the
  // colour has to come from the field rather than from a sentence.
  // `you` FOR AN ELIGIBLE SLICE, not `click`. Reported from a screenshot: the
  // eligible note rendered in the ordinary slate colour while the two blocked
  // ones were dimmed, so the row that WANTS something read as the quiet one.
  //
  // `waitingTone` gives `click` the ordinary colour deliberately — *"giving
  // `click` one of its own would make the section shout twice and mean once"* —
  // and that argument is about a branch row in a section whose every row is
  // waiting on a click. Here the three verdicts sit side by side and the
  // distinction IS the point: one of these can be started and two cannot.
  // `you` is the amber tone the board uses for *this needs a decision*, which is
  // exactly what an eligible slice is.
  const sliceWaitingOn: WaitingOn | null =
    // `you` — a merge is a decision, whatever the verdict says about ordering.
    soleRow ? soleRow.waitingOn
      : groupedCount !== undefined ? 'you'
      : group.verdict === 'eligible' ? 'you'
      // `you` FOR AN UNAPPROVED SLICE TOO, and for the same reason `eligible`
      // has it: the tone means *this needs a decision from a person*, and an
      // unapproved slice needs exactly one — an approval. `time` would be wrong,
      // because nothing lands on its own to unblock this.
      : group.verdict === 'unapproved' ? 'you'
      : group.verdict === 'blocked' ? 'time'
        : null;
  const sliceNote =
    // A REVIEWABLE SLICE says what it is waiting for, and it is a person. The
    // verdict's sentences are both about starting — and these branches are
    // started, so neither is true here.
    //
    // GUARDED ON `soleRow`, NOT ON `soleNote`, and the difference is a bug this
    // guard was written to prevent and did not. `soleNote` is the sole row's
    // note with its PR fact stripped, and where the note is ONLY that fact —
    // `PR #323 green`, the ordinary shape for a finished branch — stripping it
    // leaves `''`. Empty is falsy, so the chain fell through to a verdict
    // sentence about starting work that had already been done: measured
    // 2026-08-22, PR #323 rendered `green` beside `approved — nobody has taken
    // it`. Every single-branch slice that reaches review hit this, which is the
    // common case rather than an edge.
    //
    // `soleRow` says *this slice has one branch and the branch speaks for it*.
    // That is the condition the verdict sentences must yield to, whether or not
    // anything survives the strip — and it is what the sibling `sliceWaitingOn`
    // ternary above already tests.
    //
    // AND THE GROUPED NOTE FALLS THROUGH THE SAME WAY. `groupedNote` now answers
    // only for the two words a count can mean and returns `''` otherwise — so
    // `|| verdict` here, not a `groupedCount !== undefined ?` arm that
    // short-circuited before the verdict could speak. That arm was taken for
    // EVERY multi-branch slice (`groupedCount` is defined for all of them), which
    // left the two verdict clauses below dead and let the old default assert
    // `work landed` over five live `blocked` slices that had never been touched.
    // A grouped slice with an unrecognised word is exactly the slice the verdict
    // describes, so it derives the same value a single-branch slice does.
    soleRow ? soleNote
      : (groupedCount !== undefined
        ? groupedNote(groupedWord, sliceDissent(group.rows))
        : '')
        || (group.verdict === 'eligible' ? 'approved — nobody has taken it'
          : group.verdict === 'blocked' ? 'an earlier slice has to land first'
          // THE SENTENCE NAMES THE ACTION, like its two siblings, and the
          // action here is not merging — it is approving. The `eligible`
          // sentence says *approved*, which is the fact this slice lacks, and
          // the `blocked` one promises an earlier slice will land, which no
          // amount of merging will do for this row.
          : group.verdict === 'unapproved' ? 'the plan needs approving first'
            : '');
  return (
    <TupleRowView
      tuple={tupleFromSlice({
        name: group.wave,
        plan,
        verdict: group.verdict,
        groupedCount: groupedCount ?? null,
        groupedWord: groupedWord ?? '',
        // THE SOLE BRANCH'S OWN CONDITION, where the slice holds one. `prStatus`
        // is what a PR row would have shown, and this row stands in for it.
        //
        // A WORKER OUTRANKS BOTH, because it is the only one of the three that
        // says somebody is on it right now. *Worked on by X* answers *what is
        // happening to this slice*; `open` and `green` answer *what condition is
        // its branch in*, which a reader in WORKING did not ask. This is what the
        // `agent` kind was for, and the reason it never worked: an agent row named
        // its branch and showed `open` — the branch's state, which as its own
        // comment says *"says nothing about an agent"*. The slice keeps the
        // identity, the worker becomes the status, and no second kind is needed.
        // Only a LIVE worker, and that bound is measured. On this repo's board
        // 4 rows read `worker: 'finished'` and all four sit in DONE behind merged
        // PRs, where `delivered` is the honest word and `finished` would replace
        // it with a fact about a process nobody is waiting on. `running`,
        // `waiting` and `stalled` are the three that mean *somebody is on this,
        // or should be* — the rest are history, and history loses to the PR.
        //
        // And a live worker loses to the PR on a FINISHED slice too, because the
        // worker outlives its branch and its last state can survive the merge —
        // `soleRowStatus` screens it out on a merged or deferred row, the same
        // finishedness guard `isActive` applies to the activity mark.
        soleStatus: soleRow ? soleRowStatus(soleRow) : '',
        // AND ITS PR AND PLAN, for the same reason: a slice of one has no fold, so
        // this row is the ONLY row that branch gets and everything reachable from
        // a branch row has to be reachable from here.
        //
        // Measured as two separate losses when it was not:
        //   `expected 'Kind: Slice w branch feature/phone…' to contain 'lonely-plan'`
        //   — the plan link, gone from a row that had it.
        // `SliceRow` was written for NOT STARTED, where a branch has no PR and no
        // plan link to lose. Every other section's branches have both.
        solePr: soleRow?.pr ?? null,
        // NO PLAN LINK WHERE A PLAN ROW HEADS THIS SLICE, and that is the whole
        // condition: the plan is the row directly above, so a link to it here is
        // the duplication this kind was built to remove.
        //
        // Measured after `solePlan` landed: the `Tracer` row rendered `plan
        // opus5-longhorizon-hardening` under a PLAN row naming the same slug, and
        // wrapped to 75px — double every sibling.
        //
        // It IS needed where no plan row heads the group: `sliceGroupsFor` returns
        // nothing for a mixed group, and a lone slice row then carries the only
        // statement of which plan it belongs to. `planHeaded` is what the caller
        // knows and this row cannot.
        solePlan: soleRow?.plan && !planHeaded ? {
          slug: soleRow.plan, file: soleRow.planFile,
        } : null,
        // ITS BRANCHES — but only where the slice HOLDS ONE, and this is the
        // correction the estate's one multi-branch slice forced.
        //
        // `opus5-longhorizon-hardening :: Implementation` holds five. Rendered
        // with all five as artifact links, slot 4 wrapped to FIVE LINES — the row
        // became five rows tall — and the fold below then listed the same five
        // branches again as rows. Every name twice, and the plan's other slice
        // (`Tracer`) pushed five rows down so the two slices no longer read as
        // siblings. Reported from a screenshot.
        //
        // A PARENT NAMES ITS COUNT, NOT ITS MEMBERS. That is the rule the plan
        // row already follows — `3 slices`, never three slice names — and the fold
        // is what discloses them. The original design made branches the slice's
        // artifact links, written when a slice of one was the case in view: there
        // the single link IS the row's content and there is no fold at all.
        //
        // So: one branch, one link. Several, and slot 4 stays empty while the
        // count lives in slot 5 (`5 stalled`) and the names live in the fold.
        branches: group.rows.length === 1
          ? group.rows.map((r) => ({ branch: r.branch, branchUrl: r.branchUrl }))
          : [],
        blockedBy: group.blockedBy,
        // ITS OWN COUNT, derived from its own rows — no contract field, the same
        // property `sliceSummaryFor` keeps one level up. `blockedNote()` composed
        // this number into a sentence on the row that WAITED on the slice; here it
        // is on the slice it counts.
        //
        // Non-deferred and unmerged, matching `plot-fleet-scan.sh`'s own
        // arithmetic — a deferred branch is set down, not outstanding.
        outstanding: group.rows.filter(
          (r) => r.state !== 'deferred' && r.state !== 'merged',
        ).length,
        ageMinutes: ages.length ? Math.min(...ages) : null,
        waitingDays,
      })}
      rowAttr={{
        'data-slice-row': group.wave || UNNAMED_SLICE,
        // A SPIKE says so as an attribute too, so a test asserts the KIND of slice
        // rather than the colour of a glyph.
        ...(isSpikeSlice(group.wave) ? { 'data-slice-spike': '' } : {}),
      }}
      // AMBER FOR A SPIKE, slate for an implementation slice — and never colour
      // alone: the word `spike` rides beside the name in `beside` below. A tracer
      // that fails sends the reader back to the PLAN, and that is worth telling
      // apart from a slice whose failure means a rebase.
      iconTone={isSpikeSlice(group.wave)
        ? 'text-amber-600 dark:text-amber-400' : undefined}
      beside={
        // THE WORD, because a colour cannot be the only carrier — the same rule
        // slot 2 follows for the kind itself. `spike` rather than `tracer` because
        // it names what the slice IS for any of its spellings (`Tracer`, `Spike`,
        // `Tracer bullet`), and the slice's own name is right beside it.
        isSpikeSlice(group.wave) ? (
          <span
            data-slice-kind="spike"
            className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            title="A spike — its outcome may be a refined plan, not merged work"
          >
            spike
          </span>
        ) : null
      }
      aside={
        // THE WAITING-STATE COLOUR, on the row that now owns it.
        //
        // A note's tone distinguishes *waiting on you* (something to click) from
        // *waiting on time* (an earlier slice has to land) — and in NOT STARTED
        // that distinction had no carrier left: the branch rows that held
        // `data-row-note` are folded into slice rows, and `tupleFromSlice` has no
        // note. Measured: zero `data-row-note` elements in the section.
        //
        // The VERDICT is the same distinction the note was encoding, so the tone
        // is taken from it rather than from a sentence: `eligible` is
        // `waitingOn: 'click'` — a person may start it — and `blocked` is
        // `waitingOn: 'time'`, which is what `waitingOnFor` already computes on
        // the server for exactly these two cases.
        //
        // The TEXT is the plain-English form of the status, and it is the one
        // thing a slice row says twice on purpose: slot 5 holds the word a reader
        // scans down a column, and this holds the sentence that explains the
        // colour. Where the slice is complete there is nothing to wait for and
        // nothing renders.
        sliceNote ? (
          <span
            data-row-note
            data-waiting-on={sliceWaitingOn ?? undefined}
            className={`min-w-0 truncate ${waitingTone(sliceWaitingOn)}`}
            title={sliceNote}
          >
            {sliceNote}
          </span>
        ) : null
      }
      statusExtra={
        // `blocked by Relocated` — AN INFO MARK IN SLOT 5, beside the status it
        // explains, with the slice named on hover and for a screen reader.
        //
        // TWO PLACES TRIED AND MEASURED FIRST, and both failed for the same
        // reason — the reference is a SENTENCE and the row has no unbounded slot
        // spare:
        //
        //   1. Slot 4, as a link. That put a pointer UP among links pointing
        //      DOWN — `wave Relocated` ahead of two branch links, in a column
        //      headed `Related` whose every other kind reads one direction.
        //   2. Beside the name in slot 3. Measured on the mock: `Relocated`
        //      rendered as `R…` and `Moved` as `M`. The blocker text won the
        //      width fight against the NAME, so the row lost the one thing it
        //      exists to say.
        //
        // A mark is right structurally rather than merely smaller. `blocked` is
        // the fact a reader SCANS down the column; *which slice* is the follow-up
        // question a reader asks about one row. A follow-up belongs behind a
        // disclosure — the same reason `ApproveButton`'s armed label lives in a
        // popup rather than in a cell.
        //
        // NOT a link, because a slice has no page of its own — it is a heading
        // inside a plan file. `title` and `aria-label` carry the name, and the
        // name is also in the accessible label so it is not hover-only for a
        // reader who cannot hover.
        <>
          {/* THE DRAFT BADGE, where this slice stands in for one branch. A draft
              and a check state are independent — a draft has CI like anything
              else — so the status word cannot carry both, and `Row` renders the
              badge beside it for that reason. Without it a slice row read
              `CI running` for a draft PR and never said it was one. */}
          {soleRow?.pr?.draft && (
            <span
              data-pr-draft
              className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title="Draft — not yet offered for review"
            >
              draft
            </span>
          )}
          {group.blockedBy ? (
            <BlockedByMark
              plan={plan}
              wave={group.blockedBy}
              // WHICH SECTION the blocker sits in — read from the payload's own
              // slice, keyed by plan+name the same way `openSlices` keys. Null
              // where the payload named no such slice (a cast pre-#349 pulse),
              // and the mark then queries an assumed-open section as before.
              section={
                slices?.find((w) => sliceKeyOf(w.plan, w.name) === sliceKeyOf(plan, group.blockedBy!))
                  ?.section ?? null
              }
              onExpandSection={onExpandSection}
            />
          ) : null}
        </>
      }
      // The verdict is the scan's, and the title says whose judgement it is —
      // the status word alone (`blocked`) does not say blocked BY WHAT, and the
      // branches in slot 4 are what a reader opens to find out.
      // THE PR'S STATE WHERE THIS SLICE STANDS IN FOR ONE, and the slice's verdict
      // otherwise.
      //
      // `soleStatus` already prints the PR's condition as the status WORD — but
      // without `data-pr-state` beside it, nothing can tell which of the two
      // facts that slot is showing. A test asserting `conflicts` cannot say
      // whether it means the PR's mergeability or the branch's git state, which
      // is the ambiguity `Row` documents at its own `statusAttr`.
      //
      // The verdict keeps the slot wherever a slice speaks for itself: several
      // branches, or one with no PR.
      statusAttr={soleRow?.pr
        ? { 'data-pr-state': soleRow.pr.state }
        : group.verdict
          ? { 'data-verdict': group.verdict, title: `The scan's verdict for this slice: ${group.verdict}` }
          : undefined}
      // NO BORDER, the same reason the plan row takes none: a slice with a fold
      // heads its own little group, and a rule here would fall between a slice
      // and its own first branch.
      bordered={false}
      extra={
        // THE STUCK CELL, where this slice stands in for one branch — *"why this
        // branch cannot move"*, which is a fact about the BRANCH and one no
        // verdict carries.
        //
        // Measured when it was missing: `feature/collides rendered no stuck cell`.
        // A slice of one has no fold, so without this the conflicting paths, the
        // failing check and the unpushed count are unreachable — the same class
        // of loss as the deleted accessible name, and exactly what `stuck-rows`
        // exists to catch.
        // THE SOLE BRANCH'S STUCK CELL, or the SLICE'S OWN — and `unsliced-wave`
        // is the slice's, so it renders here whatever the branch count.
        //
        // A slice holding several branches is the state's entire subject, and the
        // branch rows now suppress it (see `StuckCell` in `Row`) precisely so it
        // is stated once, here, where it is true.
        <>
          {/* THE CHANGE MARK, for the reason a branch row carries one: a slice
              row IS the row a branch gets, so it changes when that branch does —
              a PR turning red, a row moving section — and said nothing about it.
              `extra` is the slot whose positioning parent is the row itself,
              which is what `inset-0` needs to tint the whole line. */}
          {marked && <ChangeMark />}
          {(soleRow ?? group.rows[0])?.stuck?.state === 'unsliced-wave'
            ? <StuckCell row={group.rows[0]} />
            : soleRow?.stuck ? <StuckCell row={soleRow} /> : null}
        </>
      }
      // START WORK, ON THE SLICE THAT CAN BE STARTED — and it went missing when
      // the branch rows did.
      //
      // The control lived in a branch row's `RowActions`, so replacing those
      // rows with slice rows took the action with them: NOT STARTED offered
      // nothing to click. Reported from a screenshot.
      //
      // The plan warned that a dispatch control on a PLAN row *"would have to
      // guess which of the plan's slices it meant"*, and one level down the same
      // worry does not apply — because `StartWorkButton` takes a **`Card`** and
      // a `dispatch` binding, NOT a branch. Dispatch is a plan-level act:
      // `plot-dispatch.sh` fans out the eligible slice, which is this row. There
      // is nothing to guess.
      //
      // ONLY where the verdict is `eligible`. A blocked slice offers no control
      // at all rather than a disabled one — `isStartable`'s own rule: *"a button
      // whose usual state is 'you cannot' teaches people to ignore buttons"*,
      // and the note beside it already says an earlier slice has to land first.
      // AND THE BRANCH'S MENU WHERE THIS ROW IS A BRANCH'S ROW.
      //
      // `SliceActions` above dispatches the SLICE and is gated on
      // `verdict === 'eligible'` for its own good reason. That gate was also,
      // accidentally, the gate on whether this row had ANY menu — so a slice of
      // one branch, which is what most plans are, lost Review, Open and the
      // worker log entirely. Measured: every slice row had zero menus of any
      // kind while every branch row had one.
      //
      // Only for a SOLE branch. Where a slice holds several, each keeps its own
      // row and its own menu, and a branch menu here would have to guess which
      // branch it meant — the same argument that keeps dispatch off the plan
      // row one level up.
      menu={
        <>
          {group.verdict === 'eligible' && card && dispatch ? (
            <SliceActions
              wave={group.wave || '(unnamed)'}
              card={card}
              dispatch={dispatch}
              pulse={pulse}
              onStarting={onStarting}
            />
          ) : null}
          {/* THE UNSLICED SLICE'S ONE ACT — the menu this row had none of before.
              A slice the scan reports `unsliced-wave` is `blocked` (several live
              branches, no single one to dispatch) and holds more than one branch
              (so no `soleRow`), which left it with neither of the two menus
              above. It gets its OWN, because the errand it offers — spawn
              `/plot-reslice` — belongs to no other slice. The state lives on the
              slice's rows, read from `rows[0]` where its `StuckCell` reads it. */}
          {group.rows[0]?.stuck?.state === 'unsliced-wave' && reslice ? (
            <ResliceMenu
              wave={group.wave || '(unnamed)'}
              slug={plan}
              reslice={reslice}
              onActing={onStarting}
            />
          ) : null}
          {soleRow ? (
            <BranchMenu
              row={soleRow}
              card={card ?? null}
              dispatch={dispatch}
              implement={implement}
              pulse={pulse}
              onStarting={onStarting}
              continueWith={continueWith}
              onOpenPlan={onOpenPlan}
              onRevealBranch={onRevealBranch}
            />
          ) : null}
        </>
      }
      marks={
        <>
          {foldable ? (
            <button
              type="button"
              data-slice-branch-toggle={group.wave || '(unnamed)'}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} the branches of slice ${group.wave || '(unnamed)'}`}
              onClick={onToggle}
              // `-mt-1`, and it is a CENTRING correction rather than a nudge.
              // Measured on the mock: this control's box is 24px tall against
              // the kind label's 14px, so with both starting near the row's top
              // their centres land 3px apart — the caret low, which is what a
              // screenshot showed. `self-start` would make it worse (the glyph
              // sits mid-box), and shrinking the box is not available: 24 x 24
              // of hit area is the WCAG 2.2 minimum this control was fixed to
              // meet and is not being re-litigated.
              //
              // So the box keeps its size and moves up by half the difference.
              className="-mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <span
                aria-hidden
                className={`inline-block text-2xl leading-none transition-transform ${expanded ? 'rotate-90' : ''}`}
              >
                ▸
              </span>
            </button>
          ) : null}
          {active ? <ActivityMark pace="fast" inTrack /> : null}
        </>
      }
    />
  );
}

/**
 * A BRANCH, A PR OR A RELEASE, as a tuple — and this is an ADAPTER, not a row.
 *
 * The row itself is `TupleRowView`, and it is the same component a plan and a
 * ticket render through. What lives here is what only this call site knows: the
 * activity marks the fleet answers for the whole list at once, the `⋯` menu the
 * kind offers, the second line a stuck branch takes, and the two badges that
 * qualify a branch name without pointing anywhere.
 *
 * ## What it replaces, and what that cost
 *
 * 555 lines of grid, laid on `ROW_TRACKS` — seven fixed tracks a PLAN row
 * borrowed four of and a TICKET row borrowed all seven of, having no slice, no
 * worker and no branch to put in them. Two grids for three components, and the
 * six slots now come from `tupleFromRow`, which the unit suite tests as data.
 *
 * The one thing that changed for a reader, and it is a consequence rather than
 * an aim: on a row whose kind is `branch` the PR NUMBER is no longer a link.
 * `tupleFromRow` gives a branch row one artifact link, its plan — the rule
 * `the-row-leads-with-its-subject` settled and the unit suite pins. A branch
 * row is a branch row precisely when the PR cannot resolve it (a merge
 * conflict), so the reader's destination is the branch, which slot 3 names and
 * links. The PR's CONDITION still reaches slot 5, which is what the plan asks
 * for — *a merge conflict is still readable on the branch it belongs to* — and
 * the number rides beside it as text.
 */
export function Row({
  row,
  onOpenPlan,
  card = null,
  dispatch,
  implement,
  continueWith,
  pulse = 0,
  onStarting,
  marked = false,
  active = false,
  inPlanGroup = false,
  inSliceGroup = false,
  agent = null,
  section,
  sliceName = null,
  onRevealBranch,
  highlighted = false,
}: {
  row: AgentRow;
  onOpenPlan?: AgentListProps['onOpenPlan'];
  /** Reveal a branch's row — forwarded to the agent panel's BRANCH fact. */
  onRevealBranch?: AgentListProps['onRevealBranch'];
  /**
   * This row is the branch just revealed from an agent panel — wear the ring.
   * The arrival marker `highlightBranch` resolves to, per row.
   */
  highlighted?: boolean;
  /**
   * The slice this branch belongs to, or null to name none.
   *
   * Rendered BESIDE THE BRANCH NAME, which is the object it names a slice of —
   * it used to sit in the phase cell two tracks away, as one of that column's
   * four meanings. In the tuple that adjacency is slot 4, the artifact slot,
   * which is where things ABOUT the item go.
   *
   * Still a PROP rather than derived here: the call sites are where the section
   * decides what a row shows, and one function called from two places is what
   * keeps the two sections' branch rows saying the same thing.
   */
  sliceName?: string | null;
  /**
   * True when this row sits inside a plan group that draws its own separator.
   *
   * A plan and its branches are ONE block on this board, so the rule belongs to
   * the group: a row drawing its own inside one puts a line between a plan and
   * its first branch, which is the pair that must NOT be divided. Everywhere
   * else the row is the unit and keeps its border.
   */
  inPlanGroup?: boolean;
  /**
   * Whether this row sits inside a SLICE's fold, whose verdict is on screen one
   * line up. Suppresses a redundant `open` — see `sliceStatesIt`.
   */
  inSliceGroup?: boolean;
  /**
   * This branch's entry in the agent registry, where one is running on it.
   *
   * **`fleet.agents` had NO consumer** until 2026-08-20 — the scan collected the
   * registry, the contract carried it, and the client's only mention of it was a
   * comment. An agent row therefore had no session id, no worktree and no
   * command, so it named its BRANCH and `tupleFromAgent` went uncalled.
   *
   * Joined on branch by the caller, which is where the fleet is in scope.
   */
  agent?: AgentEntry | null;
  /** This row's plan as a board card, or null where the board has none. */
  card?: Card | null;
  /** Whether this server will act on Start work, and why not. */
  dispatch?: DispatchInfo;
  /** Whether this server will act on Implement — used by WriteBriefButton for
      rows that need a brief written before they can be dispatched. */
  implement?: DispatchInfo;
  // No `approve`/`commission`: those are plan-level acts on the plan head
  // (`PlanActions`), not on a branch/PR/release row. This row's menu carries
  // only branch-level acts, so it needs neither binding.
  /** Whether this server will act on Continue with an answer. */
  continueWith?: DispatchInfo;
  /** The pulse counter, so a started row can watch for its own change. */
  pulse?: number;
  /** A click is outstanding (true) or has settled (false). */
  onStarting?: (active: boolean) => void;
  /** This row's PR status changed within the last `CHANGE_MARK_MS`. */
  marked?: boolean;
  /**
   * Something is being written to this row in THIS checkout — either the last
   * pulse reported it, or a lock it was seen holding is still echoing.
   *
   * Passed in rather than computed from `row`, because the echo is a fact about
   * recent PULSES and a row cannot see them. It also keeps the decision in one
   * place: `activeRowKeys` answers for the whole fleet at once, so a row and
   * the section around it can never disagree about which rows are active.
   */
  active?: boolean;
  /**
   * Which section is rendering this row — set only by WAITING ON A MACHINE.
   *
   * A ROW CAN NOW APPEAR TWICE, and the two appearances must not say the same
   * thing. Everywhere else a row belongs to exactly one section and its `note`
   * is its whole sentence; in the machine section it is being listed as a
   * PROCESS, so it says what the process is doing rather than what its agent is.
   * See `machineNote`.
   *
   * Passed in rather than derived from `row.group`, because `group` is precisely
   * what cannot answer this: a live worker's group is `working` in both places
   * it renders. The section knows which question it is asking; the row does not.
   */
  section?: WaitingGroup;
}) {
  // What the note still has to say once slot 5 carries the PR's own condition —
  // see `noteWithoutPr`. IN THE MACHINE SECTION THE SENTENCE IS THE PROCESS'S.
  const note = noteWithoutPr(
    // INSIDE A SLICE'S FOLD THE NOTE IS THE SLICE'S TO SAY, so the branch says
    // nothing. `blocked by Relocated — 1 outstanding` rendered on both children
    // of the `Moved` slice, one line below the row that now states the same three
    // facts structurally — the verdict in slot 5, the blocker beside the name,
    // the count on the slice it counts. The sentence this slice called redundant
    // was still being printed, twice.
    //
    // The whole note rather than a match on its wording: `ELIGIBLE_NOTE`'s own
    // rule is that nothing may be built on matching this prose, and every note a
    // branch carries in NOT STARTED is about its slice's state — *approved,
    // nobody has taken it*, *blocked by an earlier slice*. A branch inside a
    // fold has no sentence of its own to lose.
    //
    // Same shape as the machine section one line down, and the same reason: a
    // row appearing twice must not say the same thing twice.
    inSliceGroup ? '' :
    section === 'waiting-on-machine' ? machineNote(row) : row.note,
    row.pr,
  );

  // `actionTaken` stood here until 2026-08-22, remembering whether the reader
  // had answered this row's request so `StuckCue` could stop pinging. The cue
  // is gone and so is the flag; `onTaken` still travels to the menu, where the
  // click it reports is a fact worth having even with nothing reading it yet.
  // ROW-LOCAL, unlike the plan and story overlays App owns. Those two are
  // lifted because they are mutually exclusive and open from several places; a
  // worker log opens from one place, belongs to one branch, and coordinates
  // with nothing.
  const [logOpen, setLogOpen] = useState(false);
  // The dispatcher-log panel, ROW-LOCAL for the same reasons. Separate from
  // `logOpen` because the two show DIFFERENT logs — the agent's console and the
  // dispatcher's own record — and a reader may want either without the other.
  const [statusOpen, setStatusOpen] = useState(false);
  // The changed-file panel, ROW-LOCAL for the same reasons as the two above it.
  const [filesOpen, setFilesOpen] = useState(false);

  // IN A PLAN GROUP THE WAITING CLOCK BELONGS TO THE PLAN ROW, which states it
  // once. Every branch of a plan shares one `waitingDays` — it dates the plan's
  // own `Approved:` record — so repeating it down the column says the same
  // number three times and reads like three measurements.
  //
  // ONLY THE INHERITED CLOCK is suppressed, and the distinction is load-bearing.
  // A deferred branch in the same group carries a real `ageMinutes` of its own
  // and that survives: an earlier version of this section erased a shelved
  // branch's age and PR, and `fleet.ts` still carries the warning — *a branch
  // started and then shelved read as never begun*. A property of the PLAN is
  // repetition; a property of the BRANCH is information.
  //
  // Applied to the tuple rather than inside `tupleFromRow`, because it is not a
  // fact about the row: the same row outside a plan group SHOULD print this
  // number, and the projection cannot see which section is asking. That is the
  // adapter's question, which is what an adapter is for.
  const inheritedClock = inPlanGroup && row.ageMinutes === null;

  // THE SLICE'S VERDICT OUTRANKS THE BRANCH'S STATE, and inside a slice's fold
  // the branch does not restate it.
  //
  // Reported from the mock: two branches under the slice `Moved`, whose verdict
  // is `blocked`, each showing `open`. Both facts are true — `stateStatus` reads
  // `row.state`, and a branch nobody has taken IS open — and together they
  // contradict. `open` is the only word in the child's status column, so a
  // reader scanning it concludes *available*, while the row one line up says
  // `blocked` and `plot-dispatch.sh` would refuse the branch. That is the false
  // promise `isStartable` exists to avoid, made by a status word instead of a
  // button.
  //
  // Measured over `last-pulse.json`: branches inside BLOCKED slices are
  // `open` × 9 and `wip` × 5; inside ELIGIBLE slices, `open` × 8 and `wip` × 3.
  // Near-identical proportions — so the branch's state says nothing at all
  // about whether it can be started. The slice's verdict is the fact, and it is
  // already on screen.
  //
  // THE WHOLE STATE GOES, not just `open` — and the measurement is what settled
  // it. A first attempt suppressed `row.state === 'open'` only, reasoning that
  // `wip`, `deferred` and `merged` are events on the branch that no verdict
  // states. Counted over `last-pulse.json`, that guard NEVER FIRES: a child row
  // renders only inside a multi-branch unfinished slice, the estate holds exactly
  // ONE of those, and all five of its branches are `wip`. So the condition
  // covered a case that does not occur and left the case that does printing a
  // status its slice owns.
  //
  // A rule rather than a list of exceptions: inside a slice's fold, the SLICE
  // carries the status. What a branch alone knows still reaches the reader —
  // `deferred` has its own badge beside the state (never instead of it, by the
  // rule at that badge), a PR's condition rides in the PR cell, and a stuck
  // branch takes its own second line. None of those is slot 5.
  //
  // A deferred branch never arrives here in any case: it is not part of a
  // slice's unbegun work and keeps its own row beside the slices, which is where
  // its PR and its age stay reachable.
  //
  // In the adapter and not the projection, for the reason `inheritedClock`
  // records one line up: the same row outside a slice SHOULD print its state, and
  // the projection cannot see what is asking.
  // EXCEPT WHERE THE ROW HAS A PR, whose condition the slice cannot state.
  //
  // The rule is that a slice's verdict outranks the branch's state — sound for an
  // unbegun branch, whose `open` merely repeats *nothing has happened*. It is
  // wrong for a reviewable one: measured on the mock, PRs 304 (`green`) and 307
  // (`checks failing`) both rendered an EMPTY status under their slice, so the one
  // fact separating them — which of the two a person can actually merge — was
  // the fact suppressed.
  //
  // `pr === null` is the test rather than the section, because it names the
  // reason: a PR carries a condition of its own, reported by the host, that no
  // verdict computed from ordering can express.
  const sliceStatesIt = inSliceGroup && row.pr === null;
  const base = tupleFromRow(row, agent);
  // THE AGE GOES WITH THE STATUS, and for one reason rather than two: inside a
  // slice's fold, the SLICE is the subject and the branch is its content.
  //
  // `inheritedClock` above already blanks the age where the row has no tip of
  // its own — the plan's approval clock, repeated down a column, saying one
  // number three times. Inside a slice the same argument covers the tip too: the
  // slice row's clock is the freshest of its branches (`Math.min` over their
  // ages), so it is already the number a reader wants, and per-branch ages
  // beneath it are four measurements of one thing.
  //
  // Where a single branch's own clock IS the question, the row exists outside a
  // slice — a deferred branch keeps its own row beside the slices, precisely so
  // its age and its PR stay readable.
  const tuple = {
    ...base,
    // The age goes with the status, and returns with it: a PR that has sat for
    // three weeks is saying something its slice's freshest-branch clock hides.
    ...(inheritedClock || (inSliceGroup && row.pr === null)
      ? { age: { text: '', label: '' } } : {}),
    ...(sliceStatesIt ? { status: '' } : {}),
    // AND NO PLAN LINK, for the reason the slice row carries none: the plan is
    // TWO rows up, heading the group these rows are nested in, and a link to it
    // on every child says the same thing as many times as the slice has
    // branches. Measured on the mock: `plan fleet-scan-asks-the-host` on both
    // children of `Moved`, directly beneath a slice row that is itself directly
    // beneath the plan row.
    //
    // A branch's artifact slot is *the plan that governs it, or NOTHING where no
    // plan does* — and inside a slice's fold, nothing is what is left to say:
    // slot 3 names the branch, and the two rows above name its slice and its
    // plan. This is the same containment rule the slice row settled, applied one
    // level deeper.
    // MEASURED, and the emptying is per-kind rather than per-row. On a BRANCH
    // row the argument above holds exactly: slot 3 names the branch, so nothing
    // is left for slot 4 to say. On a PR row it does not — slot 3 names the
    // PR (`58`), and emptying the slot took the branch with the plan, leaving a
    // row that reads `PR 58 green` and never names what it is a PR OF.
    //
    // Dumped from the live DOM on the one-grid fixture: the PR row rendered
    // `<span role="gridcell" class="…"></span>` — slot 4 present and entirely
    // empty — while `tupleFromRow` had put three links in it.
    //
    // So the rule keeps its reason and loses its overreach: drop exactly the
    // links the rows above already carry — the PLAN and the SLICE — and keep
    // every other artifact, which is by construction one this row alone holds.
    //
    // Stated as containment rather than as a list of kinds, because the list was
    // where it went wrong twice: first dropping everything, then keeping only
    // the branch, which erased the PR from a CONFLICTING branch row. That row's
    // own source names the regression it repeats — *a branch started and then
    // shelved read as never begun, with its age and its PR erased* — and the
    // slice heading it cannot stand in, since a slice with two PRs names neither.
    ...(inSliceGroup
      ? { links: base.links.filter((l) => l.what !== 'plan' && l.what !== 'wave') }
      : {}),
  };

  return (
    <TupleRowView
      tuple={tuple}
      onOpenPlan={onOpenPlan}
      // AN AGENT'S NAME OPENS THE PANEL, which is what the name is FOR: the
      // session has no address — the transcript is a local file — so the name
      // renders as text and this makes it a control. The row owns the click
      // because the row owns the panel's mount (`logOpen`); the projection
      // states only that there is no href.
      onNameClick={row.kind === 'agent' ? () => setLogOpen(true) : undefined}
      // The scroll target the agent panel's BRANCH fact aims at.
      // `getElementById` needs an id, and a branch name is unique within a
      // fleet — the same shape `#plan-<slug>` uses for the board's card
      // highlight.
      id={`agent-row-${row.branch}`}
      rowAttr={{ 'data-agent-row': '' }}
      highlighted={highlighted}
      // Inside a plan group the RULE belongs to the group, which draws one line
      // under the plan and its branches together.
      bordered={!inPlanGroup}
      // THE SAME SENTENCE THE PLAN ROW GIVES ITS CLOCK, on the rows that
      // inherit it. A row with no tip is aged from its plan's approval —
      // `tupleFromRow` labels that `waiting` because it is not a change to the
      // branch — and the label names the exception while this says what
      // happened. One clock, one look, wherever it appears.
      ageTitle={
        row.ageMinutes === null && row.waitingDays !== null
          ? 'Approved this long ago, and nobody has started it'
          : undefined
      }
      marks={
        <>
          {/* THE CHANGE MARK IS NOT HERE ANY MORE — it is passed as `extra`,
              which renders as a direct child of the ROW.
              
              It hung in this track until 2026-08-20, under a comment that was
              true when it was written: *"it overlays the row from the same
              `relative` box the live dot hangs in."* That box WAS the row's,
              while the marks were absolutely positioned at the row's edge. When
              the marks earned their own grid track the cell became `relative`,
              and `inset-0` silently came to mean *the cell* — measured, a 24x20
              amber square in the leading column instead of a tint across the
              line. Reported from a screenshot as *"did we break the flashing of
              row updates?"*
              
              `ChangeMark`'s own docstring is the specification it stopped
              meeting: *"A tint across the ROW rather than a badge in a cell …
              marking the whole line is what makes the arrival legible at its new
              location."* */}
          {/* TWO ENTRY PATHS, and they are not the same claim. `active` is the
              fleet's answer for the whole list at once — `isActive` in this
              pulse, or a lock seen in a recent one still echoing — and it
              travels FAST. `isLive` adds the rows the fleet places in WORKING
              while observing no local signal: claimed, and nobody knows. Those
              travel SLOW. */}
          {/* ONE BAR, ONE DOT — and the dot is the mark's own, riding its track.
              `LiveDot` used to sit beside it at `left-1`, so every WORKING row
              drew two dots a pixel apart: a static green one saying *this row is
              in WORKING*, and a travelling one saying *a process is on it*.
              Reported from a screenshot of exactly that overlap.
              `LiveDot` is gone; the section heading already says which section a
              row is in, once, instead of once per row.

              `isLive` is gone from this condition too, for the same reason it
              stopped licensing a mark: WORKING is an ADDRESS, not a process. A
              row sits there for hours while an agent works, while an agent has
              crashed, or while it waits on a human — `isActive` is what
              distinguishes those, and `active` is that answer. */}
          {active && <ActivityMark pace={activityPace(row)} inTrack />}
          {/* FINISHED WORK NOBODY ELSE CAN SEE — a separate question, asked
              separately. Not an `else`: a row can be written to AND hold
              unpushed commits at the same moment, and either shape would lose
              whichever it tested second. */}
          {isUnpushed(row) && <UnpushedMark ahead={row.localAhead} inTrack />}
        </>
      }
      aside={
        // WHAT A STATUS WORD CANNOT SAY — *uncommitted work*, *blocked by an
        // earlier slice*, *claimed elsewhere*, *awaiting review*.
        //
        // IN SLOT 4, WHICH IS THE TRACK THAT FLEXES, and the placement is
        // arithmetic rather than preference. The note is a SENTENCE and slot 5
        // is 8rem — bounded, because it holds one status word a reader scans
        // down a column. The old layout gave the PR and the note one 14rem
        // track between them precisely BECAUSE the note is unbounded; measured
        // on screen, `⑂116 no checks` with a note beside it overflowed 8rem and
        // clipped both.
        //
        // Slot 4 is `1fr`: the zero-or-more slot, already the one sized by what
        // it happens to hold. A sentence belongs in the track that varies,
        // beside the links it qualifies, and not in the one whose whole purpose
        // is to be the same width on every row.
        //
        // The note is not replaced by slot 5 — only relieved of the one duty
        // the PR's own fields now carry; see `noteWithoutPr`.
        note ? (
          <span
            data-row-note
            // The waiting-state travels as an attribute as well as a colour: a
            // test asserting the colour alone would pass against a rule keyed
            // on the note's WORDING, which is the shape this removes.
            data-waiting-on={row.waitingOn ?? undefined}
            className={`min-w-0 truncate max-sm:whitespace-normal ${waitingTone(row.waitingOn)}`}
            title={note}
          >
            {note}
          </span>
        ) : null
      }
      beside={
        <>
          {/* THE SLICE, BESIDE THE THING IT NAMES A SLICE OF.

              IN SLOT 3, beside the NAME — which is `a-branch-row-names-its-wave`
              (#275)'s decision and this slice does not revisit it. The slice
              qualifies THIS BRANCH, and the association is positional: it is
              adjacent to the branch it divides, the way `deferred` beside it
              qualifies the branch's state. One cell over, in slot 4, it would
              be a word separated from the thing it is about.

              A MARK, not a link, which is why it is not one of slot 4's links
              in any case. A slice is a heading inside a plan file and has no
              page of its own; the plan link one slot along opens the document
              the slice is a section of.

              Every branch that names a slice shows it, and the gate is a
              property of the ROW alone — see `sliceLabel`. */}
          {sliceName && (
            <span
              data-slice={sliceName}
              className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              // The word `wave` is in the TITLE and not in the badge, because
              // the badge is read beside a branch name where the relation is
              // already visible. This is not a tooltip standing in for a label
              // — the slice NAME is rendered in text; the title only says what
              // kind of name it is.
              title={`Slice ${sliceName} — the part of the plan this branch belongs to`}
            >
              {sliceName}
            </span>
          )}
          {/* `deferred` — BESIDE the state, never instead of it, the same shape
              as the `no story` badge on a plan card: mark the thing, do not
              bend the state to encode it.

              What it distinguishes is *handed back* from *never started*:
              `deferred` means the branch isn't needed and was given up
              deliberately — `plot-deliver` skips such branches, so a plan
              delivers without them. */}
          {row.state === 'deferred' && (
            <span
              data-deferred
              className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              // THE REASON, where the plan recorded one — as the badge's own
              // title, so the sentence sits on the word it explains. Measured
              // on the board 2026-08-19: two rows read `deferred` beside `no
              // commits` and the operator asked what to do with them. The
              // honest answer is *nothing*, and the row did not say so.
              title={
                row.deferredReason
                  ? `Handed back — ${row.deferredReason}`
                  : 'Handed back — the branch was given up deliberately, and the plan can deliver without it'
              }
            >
              deferred
            </span>
          )}
        </>
      }
      // WHICH VOCABULARY SLOT 5's WORD CAME FROM. `prStatus` and `stateStatus`
      // both fill that slot and they are different questions — *what is the PR
      // waiting for* against *what is the branch's git state* — so a test
      // asserting `conflicts` names which one it means.
      statusAttr={row.pr ? { 'data-pr-state': row.pr.state } : undefined}
      statusExtra={
        <>
          {/* THE PR'S NUMBER, beside the condition slot 5 states — and it is a
              LINK wherever the host gave an address.

              Only on a row whose kind is NOT `pr`: there, slot 3 already names
              and links the PR, and a second anchor to the same page would be
              the interchangeable-words defect the association rule exists to
              prevent. Everywhere else — a conflicting branch, a deferred one —
              the row leads with the branch because that is where the reader
              must go, and the PR is a second destination worth reaching rather
              than a fact to read.
              
              An earlier draft of this collapse rendered it as TEXT on those
              rows, reasoning that the branch was the only destination. A test
              measured what that costs: `feature/set-down` is a branch someone
              started, shelved, and left a green PR #57 on — and `fleet.ts`
              already carries the warning about erasing exactly that, *a branch
              started and then shelved read as never begun, with its age and its
              PR erased*. Leading with the branch is about which fact is the
              SUBJECT; it was never an argument for making the other one inert.

              An empty `url` still renders as plain text, by the rule this board
              applies everywhere: a fabricated address is indistinguishable from
              a real one until it 404s. */}
          {/* THE PR'S NUMBER IS NOT HERE ANY MORE — it is an artifact link in
              SLOT 4, on every kind that has one.

              It rendered here as a badge beside the status until 2026-08-20,
              with a comment arguing correctly that *"the PR is a second
              destination worth reaching rather than a fact to read"* — which is
              the definition of an artifact link, and slot 4 is where those go.
              Measured on the mock, the cost of having it here was `no checks
              240` and `CI running 283`: a number wedged into the one slot whose
              whole purpose is to hold a single word a reader scans down a
              column.

              `data-pr-link` moved with it; `TupleLinkView` stamps it from the
              link's own `what`, so every assertion reading it keeps an owner. */}
          {/* `draft` and the state are TWO badges, not one. They answer
              different questions — *is this offered for review* and *what is it
              waiting for* — and they are independent: a draft has CI like
              anything else. Folding draft into the state would rebuild the
              short-circuit that kept WAITING ON A MACHINE empty for three
              releases. */}
          {row.pr?.draft && (
            <span
              data-pr-draft
              className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title="Draft — not yet offered for review"
            >
              draft
            </span>
          )}
        </>
      }
      menu={
        <BranchMenu
          row={row}
          card={card}
          dispatch={dispatch}
          implement={implement}
          pulse={pulse}
          onStarting={onStarting}
          continueWith={continueWith}
          onOpenPlan={onOpenPlan}
          onRevealBranch={onRevealBranch}
        />
      }
      extra={
        <>
          {/* THE CHANGE MARK, and it is HERE because `extra` renders as a direct
              child of the ROW — the one slot whose positioning parent is the row
              itself, which is what `inset-0` needs in order to mean the whole
              line. It hung in the marks track until 2026-08-20 and tinted a
              24x20 cell instead; see the note there. Absolutely positioned, so
              its place among these siblings costs no layout. */}
          {marked && <ChangeMark />}
          {/* Why this branch cannot MOVE — a different question from where it
              is waiting, and the one nothing in the six slots could answer. It
              renders BENEATH them rather than inside one: the evidence is three
              lines on a `ci-failing` row, and a track sized for that would push
              every real column in from the edge across the whole fleet. */}
          {/* NOT A SLICE-LEVEL STUCK STATE, which is a fact about the SLICE and
              would print once per branch.
              
              Measured 2026-08-21: `slice not cut` and its five-branch list
              rendered on all FIVE branches of `opus5 :: Implementation` — the
              same sentence five times, naming the same five branches each time.
              Exactly the defect `blockedNote` had, one level down.
              
              `unsliced-wave` belongs on the slice's own row, or on a branch row
              that has no slice row above it. The two other slice-scoped states
              (`double-claimed` is per-branch, the rest are per-branch) are
              unaffected: only this one describes the container. */}
          {row.stuck?.state === 'unsliced-wave' && inSliceGroup
            ? null : <StuckCell row={row} />}
          {/* THE DEFERRAL'S REASON, on the row's OWN SECOND LINE.

              Two homes were tried and both were wrong, and the reason is the
              same one twice: this is a SENTENCE and every slot on line one is
              bounded. Beside the branch name it crushed
              `bug/the-no-ref-arm-reads-the-join` down to `b… ads-the-join` —
              the row's primary key, spent on prose. In the status slot,
              `truncate` gave the sentence zero width and it rendered as nothing
              at all.

              Rendered rather than hidden in a `title`, because a title is
              unreachable by touch and by keyboard, and this sentence is the
              whole answer to the question an operator asked when two rows read
              `deferred` beside `no commits`: what do I do with this? Nothing —
              and here is why. */}
          {row.state === 'deferred' && row.deferredReason && (
            <span
              role="gridcell"
              data-deferred-reason
              className="flex w-full items-baseline gap-x-2 text-xs text-slate-500 sm:col-start-3 sm:col-end-[-1] dark:text-slate-400"
              title={row.deferredReason}
            >
              <span className="shrink-0 font-medium text-slate-600 dark:text-slate-300">deferred</span>
              <span className="min-w-0 max-sm:whitespace-normal">{row.deferredReason}</span>
            </span>
          )}
          {/* WHAT STANDS BETWEEN THIS ROW AND A WORKER — the brief, named where
              it is absent. THE SAME LINE-BENEATH SHAPE AS THE DEFERRAL, and for
              the same measured reason: this is a SENTENCE, and every slot on
              line one is bounded.

              THIS ROW'S NOTE STILL SAYS *eligible*, and that is correct rather
              than a leftover. The slice arithmetic IS satisfied: the branch is
              genuinely next. What was wrong was the row stopping there — so the
              fact is added beside the verdict rather than replacing it. */}
          {needsBrief(row) && (
            <span
              role="gridcell"
              data-brief-gap
              className="flex w-full items-baseline gap-x-2 text-xs text-amber-700 sm:col-start-3 sm:col-end-[-1] dark:text-amber-400"
              title={briefGapNote(row.branch)}
            >
              {/* AMBER, the `waitingOn: 'you'` colour — because that is what
                  this is. A missing brief is a person's errand and nothing in
                  git will clear it. */}
              <span className="shrink-0 font-medium">needs a brief</span>
              <span className="min-w-0 max-sm:whitespace-normal">{briefGapNote(row.branch)}</span>
            </span>
          )}
          {/* Mounted only while open — which is what makes the log on-demand in
              fact and not merely in intent. The panel owns its own polling, so
              an unmounted one fetches nothing at all. */}
          {logOpen && (
            <WorkerLogModal
              branch={row.branch}
              onClose={() => setLogOpen(false)}
              // The panel decides whether to OFFER the control (only for a
              // `waiting` worker, read from the scan); this says whether the
              // server would ACT on it.
              canContinue={continueWith}
              // BRANCH and PLAN in the panel become destinations. `onOpenPlan`
              // returns whether it opened a card; the panel discards that.
              onOpenPlan={onOpenPlan ? (planFile) => void onOpenPlan(planFile) : undefined}
              onRevealBranch={onRevealBranch}
            />
          )}
          {/* The dispatcher-log panel, mounted here for the same reason the
              worker log is: the menu that opens it unmounts on the click, so
              the state and the mount both have to live on the Row that survives
              it. */}
          {statusOpen && card && (
            <DispatchLogModal slug={card.slug} onClose={() => setStatusOpen(false)} />
          )}
          {/* WHAT THE BRANCH CHANGES, mounted here for the reason the two log
              panels are. Guarded on `row.stuck` rather than on the flag alone
              so the paths are a `readonly string[]` at the call site. */}
          {filesOpen && row.stuck && (
            <ChangedFilesModal
              branch={row.branch}
              paths={row.stuck.changedPaths}
              onClose={() => setFilesOpen(false)}
            />
          )}
        </>
      }
    />
  );
}

/**
 * A registry entry rendered as a WORKING row, joined to a branch row where one
 * exists.
 *
 * THE WORKING SECTION RENDERS FROM THE REGISTRY —
 * `the-working-section-shows-every-worker`, slice 1 (Shown). Every agent in
 * `fleet.agents` gets a row whether or not a branch row exists for it, because a
 * worker in a worktree is a fact about the FLEET while its branch's state is a
 * fact about the WORK, and the section used to derive the first from the second.
 *
 * ## Two shapes, one status word
 *
 * **Where a branch row exists** the tuple is `tupleFromRow(row, agent)` — the
 * SAME projection the branch's own row uses, so the worker row carries what that
 * row knows (plan, slice, PR) by the join used everywhere else. A merged branch's
 * row still sits in DONE; this one joins to it and renders in WORKING, and both
 * are true at once.
 *
 * **Where none exists** — `main`, a `…-recut` scratch branch, a branch no plan
 * lists — the tuple states only what the REGISTRY knows: the worktree and the
 * branch. *Absent is not false*: it says nothing about a plan it cannot name
 * rather than inventing an empty field.
 *
 * In BOTH shapes the status comes from `agent.state`, not from the row's
 * `worker` field. `tupleFromRow` reads `worker` (the scan's view of the BRANCH);
 * the registry's five-way state is the view of the WORKTREE, and it is the one
 * that tells a genuinely running worker (`running`) from an idle, stalled,
 * finished or unknown one. A row whose usual state is a lie teaches its reader
 * to ignore it, so each of those says its own condition — Done when #5.
 *
 * The slice name a running worker's row will carry is a SEPARATE slice (`Named`);
 * here the slice arrives only as whatever a joined branch row already carries.
 */
export function RegistryRow({
  agent,
  row = null,
  slices,
  onOpenPlan,
  card = null,
  dispatch,
  implement,
  continueWith,
  drop,
  pulse = 0,
  onStarting,
  marked = false,
  active = false,
  onRevealBranch,
  highlighted = false,
}: {
  /** The agent registry entry — the source of truth for a WORKING row. */
  agent: AgentEntry;
  /**
   * The branch row this agent holds, if one exists in `fleet.rows`. Joined by
   * the caller on `agent.branch === row.branch`; null where the pulse names no
   * row for the branch — the case a branch-join fix silently misses.
   */
  row?: AgentRow | null;
  /**
   * The fleet's slices — passed so a running worker can name its slice even when
   * no branch row exists. `the-working-section-shows-every-worker`, slice Named.
   */
  slices?: Slice[];
  onOpenPlan?: AgentListProps['onOpenPlan'];
  /** This row's plan as a board card, or null where the board has none. */
  card?: Card | null;
  /** Whether this server will act on dispatch. */
  dispatch?: DispatchInfo;
  /** Whether this server will act on Implement — used by WriteBriefButton. */
  implement?: DispatchInfo;
  /** Whether this server will act on Continue with an answer. */
  continueWith?: DispatchInfo;
  /**
   * Whether this server will act on Drop, and why not — the BROKEN agent's one
   * action, removing its manifest so the row disappears. Passed only to broken
   * agents (those in WAITING ON YOU), never to live ones (those in WORKING).
   */
  drop?: DispatchInfo;
  /** The pulse counter. */
  pulse?: number;
  /** A click is outstanding (true) or has settled (false). */
  onStarting?: (active: boolean) => void;
  /** This row's status changed within the last `CHANGE_MARK_MS`. */
  marked?: boolean;
  /** Something is being written to this row. */
  active?: boolean;
  /** Reveal a branch's row — forwarded to the agent panel. */
  onRevealBranch?: AgentListProps['onRevealBranch'];
  /** This row is the branch just revealed from an agent panel. */
  highlighted?: boolean;
}) {
  const [logOpen, setLogOpen] = useState(false);

  // THE STATUS IS THE REGISTRY'S, always. `agent.state` is the worktree's
  // liveness — the fact that tells a `running` worker from a stalled one —
  // where the row's `worker` field is the scan's view of the branch. This is
  // the whole point of rendering from the registry, so it overrides whatever a
  // joined row's projection would otherwise say.
  const status = agentStateStatus(agent.state);

  // AVAILABILITY IS THE SECOND QUESTION, and the status word cannot answer it.
  // `running` is not busy — an agent between slices is running with no branch
  // and is available — so this row can truthfully say `running` and `free` at
  // once. `finished` is not free: its worker exited.
  //
  // `sliceHasMerged` COMES FROM THE JOINED ROW, which is where the pulse
  // already published what the scan measured. Asking the host per agent would
  // spend a request per pulse per agent to re-learn a fact in hand, and an
  // agent with no joined row contributes `false` — silence is never landed.
  const availability = agentAvailability(agent, row?.state === 'merged');

  // AN AGENT ACTS, IT DOES NOT CHANGE — so the age is not *since last change*
  // but two labelled clocks: how long this run has been going, and how long it
  // has been silent. `startedAt` is a launch fact; `lastActivity` is read from
  // the transcript and optional. Both measured against now, the same clock the
  // agent panel's `agoLabel` uses.
  const sessionSeconds = agent.startedAt
    ? Math.floor((Date.now() - new Date(agent.startedAt).getTime()) / 1000)
    : null;
  const sessionText = sessionSeconds !== null ? tupleAgeText(Math.floor(sessionSeconds / 60)) : '';
  const idleSeconds = agent.lastActivity
    ? Math.floor((Date.now() - new Date(agent.lastActivity).getTime()) / 1000)
    : null;
  const idleText = idleSeconds !== null ? tupleAgeText(Math.floor(idleSeconds / 60)) : '';
  // THE SESSION CLOCKS WHERE THE REGISTRY HAS THEM, else the row's own age. An
  // agent acts rather than changes, so its clocks are *how long has it run* and
  // *how long silent* — but both are optional (a manifest with no `startedAt`,
  // a transcript this board cannot read), and a blank age slot says less than
  // the branch's commit age a joined row already carries. So the registry
  // clocks REPLACE the row's age only when there is one to show; absent, the
  // base tuple's age stands.
  const sessionAge = sessionText
    ? {
        text: [sessionText, idleText && `idle ${idleText}`].filter(Boolean).join(' · '),
        label: 'session',
      }
    : null;

  // THE NAME IS THE SESSION ID, shortened, with no href — the transcript is a
  // local file the ROW opens, not an address. Where the entry has no session
  // (a synthesized worktree with no manifest) the branch names the row instead,
  // and where it has neither the worktree does.
  const name = agent.session
    ? { what: 'ticket' as const, label: shortSessionId(agent.session), href: '' }
    : agent.branch
      ? { what: 'branch' as const, label: agent.branch, href: row?.branchUrl ?? '' }
      : { what: 'worktree' as const, label: worktreeName(agent.worktree), href: '' };

  // A RUNNING WORKER NAMES ITS SLICE — looked up from `fleet.slices` by branch.
  // `the-working-section-shows-every-worker`, slice Named.
  //
  // The joined row already carries `row.wave`, but the UNJOINED case (no branch
  // row exists — a scratch branch, `main`, an unlisted branch) had nothing. Now
  // it looks up the slice from the fleet, the same derivation that populated
  // `row.wave` in the first place.
  //
  // Silent where the branch belongs to no slice: a `main` worker or a scratch
  // branch has no slice to name, and `(unnamed)` is filtered out below as
  // noise — the same rule `sliceLabel` applies to a branch's slice badge.
  const lookedUpSlice = agent.branch
    ? slices?.find((w) => w.branches.includes(agent.branch))
    : undefined;
  const sliceName = lookedUpSlice && lookedUpSlice.name !== UNNAMED_SLICE
    ? lookedUpSlice.name
    : null;

  // THE JOINED SHAPE reuses the branch row's own projection, but as an AGENT:
  // the WORKING row's subject is the worker, not the branch. `tupleFromRow`
  // routes on `row.kind`, and a worker's branch row is `kind: 'branch'` (the
  // server tags no row `agent` — this row is the first producer), so forcing
  // the kind is what selects the agent arm: the session id as the name, and
  // worktree → branch → slice → plan as the artifact links. Everything the branch
  // knows still comes through the same projection; only the subject changes. The
  // UNJOINED shape states only the registry's facts — worktree then branch, and
  // now the SLICE where one was found.
  const base = row
    ? tupleFromRow({ ...row, kind: 'agent' }, agent)
    : {
        kind: 'agent' as const,
        kindLabel: KIND_LABEL.agent,
        name,
        links: [
          ...(agent.worktree
            ? [{ what: 'worktree' as const, label: worktreeName(agent.worktree), href: '' }]
            : []),
          ...(agent.branch
            ? [{ what: 'branch' as const, label: agent.branch, href: '' }]
            : []),
          // THE SLICE, where one was found by looking up `fleet.slices`.
          ...(sliceName
            ? [{ what: 'wave' as const, label: sliceName, href: '' }]
            : []),
        ],
        status: '',
        age: { text: '', label: '' },
      };
  // ABSENT IS NOT FALSE, applied to the slice. `tupleFromRow`'s agent arm carries
  // `row.wave` straight through, so an UNNAMED slice — the absence of a division,
  // which the server spells `(unnamed)` for a plan with no `### ` headings —
  // would render a `(unnamed)` link beside the branch. A parenthesised non-answer
  // is worse than nothing, the same rule `sliceLabel` applies to a branch's slice
  // badge, so it is dropped here rather than shown.
  const links = base.links.filter((l) => !(l.what === 'wave' && l.label === UNNAMED_SLICE));
  const tuple = { ...base, links, status, ...(sessionAge ? { age: sessionAge } : {}) };

  // THE BRANCH'S NOTE, where a branch row carries one — *last commit 3 min ago*,
  // *claimed, no known worker*. It is a sentence the status word cannot hold, and
  // it is the channel that survives reduced motion and a screen reader; a worker
  // with no branch row has none. The PR's own condition is dropped from it, the
  // same `noteWithoutPr` the branch row applies.
  const note = row ? noteWithoutPr(row.note, row.pr) : '';

  return (
    <>
      <TupleRowView
        tuple={tuple}
        onOpenPlan={onOpenPlan}
        // THE NAME OPENS THE PANEL — the session has no address, so the name is
        // text and this makes it the control, the same as a branch agent row.
        // Only where there is a branch to look a worktree up by: the panel keys
        // its log on the branch, and a between-branches agent has none.
        onNameClick={agent.session && agent.branch ? () => setLogOpen(true) : undefined}
        // The scroll target the agent panel's BRANCH fact aims at, keyed on the
        // branch like the branch agent row's — so a reveal lands on whichever of
        // the two rows the branch has.
        id={agent.branch ? `agent-row-${agent.branch}` : undefined}
        rowAttr={{
          'data-agent-row': '',
          // THE SLICE HOOK, so a blocker being WORKED ON stays reachable.
          //
          // `BlockedByMark` scrolls to `[data-slice-list="<plan>"]
          // [data-slice-row="<slice>"]`. A blocker that has not completed sits in
          // WORKING with a live worker — exactly the case a reader needs, since
          // that is where attention has to go. WORKING used to render slice rows
          // and carried this attribute; the registry keying replaced them with
          // agent rows and took it away, so the query matched nothing and the
          // mark went dead. Measured 2026-08-25: `agents-tab` › *reveals a
          // blocker that is being WORKED on right now*, 0 matches.
          //
          // The row is an AGENT and still says so. Carrying the slice hook too
          // does not make it a slice row — it makes the slice it is working on
          // addressable. A row with no branch, or whose branch belongs to no
          // slice, carries neither: absent is not empty.
          ...(row?.wave ? { 'data-slice-row': row.wave } : {}),
          // FREE IS RENDERED AS AN ATTRIBUTE, NOT AS THE STATUS WORD. The two
          // are different questions — *what is it doing?* and *can it take
          // work?* — and a `running` agent between slices answers `running` and
          // `free` at the same time, so overwriting one with the other would
          // lose a fact. The attribute is present only when the agent IS free:
          // absent is not `false`, the same rule the slice hook follows above.
          ...(availability ? { 'data-agent-availability': availability } : {}),
        }}
        iconTone={
          agent.state === 'stalled' ? 'error'
            : agent.state === 'waiting' ? 'warn'
              : agent.state === 'finished' ? 'success'
                : undefined
        }
        // THE SAME MARKS THE BRANCH AGENT ROW DRAWS, and by the same rules — a
        // travelling dot whose PACE reads the worktree (`activityPace`: fast
        // while a lock is held or files are dirty, slow while a claimed worker
        // only thinks), and the unpushed mark beside it where the branch holds
        // commits its remote has not seen. Both read the JOINED row's local
        // signals, so a worker with no branch row (nothing to observe locally)
        // shows neither.
        marks={
          <>
            {active && row && <ActivityMark pace={activityPace(row)} inTrack />}
            {row && isUnpushed(row) && <UnpushedMark ahead={row.localAhead} inTrack />}
          </>
        }
        extra={marked ? <ChangeMark /> : null}
        // THE BRANCH'S NOTE IN SLOT 4, the sentence a status word cannot say —
        // the same placement and tone the branch row gives it. A worker with no
        // branch row has no note, and the slot stays empty.
        aside={
          note ? (
            <span
              data-row-note
              data-waiting-on={row?.waitingOn ?? undefined}
              className={`min-w-0 truncate max-sm:whitespace-normal ${waitingTone(row?.waitingOn ?? null)}`}
              title={note}
            >
              {note}
            </span>
          ) : null
        }
        // THE MENU DEPENDS ON WHAT THE AGENT IS. A broken agent (`stalled`,
        // `unknown`) gets `BrokenAgentMenu` with a Drop action — the board's
        // manual reconciliation for entries the automatic resolver cannot clear.
        // A live agent (`running`, `waiting`) gets `BranchMenu` where a branch
        // row exists. A worker with no row and no `drop` capability has no menu.
        menu={
          isBrokenState(agent.state) ? (
            <BrokenAgentMenu
              agent={agent}
              drop={drop}
              onActing={onStarting}
            />
          ) : row ? (
            <BranchMenu
              row={row}
              card={card ?? null}
              dispatch={dispatch}
              implement={implement}
              pulse={pulse}
              onStarting={onStarting}
              continueWith={continueWith}
              onOpenPlan={onOpenPlan}
              onRevealBranch={onRevealBranch}
            />
          ) : null
        }
        highlighted={highlighted}
      />
      {logOpen && (
        <WorkerLogModal
          branch={agent.branch}
          onClose={() => setLogOpen(false)}
          canContinue={continueWith}
          onOpenPlan={onOpenPlan ? (planFile) => void onOpenPlan(planFile) : undefined}
          onRevealBranch={onRevealBranch}
        />
      )}
    </>
  );
}

// `PrGlyph` lived here until 2026-08-20, drawing the pull-request mark beside a
// PR number in SLOT 5. Both are gone: the number moved to slot 4 as an artifact
// link, and `TupleLinkView` draws its icon from `KIND_ICON_PATH.pr` — the same
// path, from the one table that answers *what glyph does this kind wear*. Two
// copies of one shape is how the icons came to disagree in the first place.

/**
 * A plan name proposed from an issue title — a SLUG, computed here rather than
 * inferred by a model.
 *
 * The plan's open point weighed the two: a slug of the first words is cheap and
 * often wrong, while a model reading the issue writes the name a human would.
 * Cheap wins here for a reason that is specific to this row — **the name is not
 * a link and nothing is behind it.** It exists so the row scans like its
 * neighbours, and `/plot-idea` chooses the real name later with the whole
 * problem statement in hand. Paying a model call per issue per refresh to
 * propose a string nobody clicks would buy accuracy that nothing consumes.
 *
 * The full title stays available in the cell's `title` attribute, so the
 * truncation costs a hover rather than the fact.
 *
 * Exported for test.
 */
export function inferredPlanName(title: string): string {
  const slug = title
    .toLowerCase()
    // Strip a leading `area:` prefix — trackers are full of them and the area
    // is the one part of a title that says nothing about the work.
    .replace(/^[a-z0-9 ]{1,20}:\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return '';
  const words = slug.split('-').filter(Boolean);
  // Six words is where this repo's own plan slugs sit, and long enough to carry
  // a subject and a verb. Truncated with no ellipsis: the name is a proposal,
  // and a trailing "…" would suggest a longer name exists somewhere.
  return words.slice(0, 6).join('-');
}

/**
 * An open tracker issue nobody has planned, on the SAME seven tracks as every
 * other row in the fleet.
 *
 * The subject changes and the geometry does not — the rule `PlanRow` already
 * states. Here the cells are filled like this:
 *
 * ```
 * mark    kind     name              related          status   age    menu
 * (blank) Ticket   228: <title>       inferred name    open     2h     ⋯
 * ```
 *
 * **The name is TEXT, never a link.** It is inferred from the issue's title so
 * the row reads like its neighbours, but nothing is behind it: a link to a plan
 * that does not exist is the fabrication this board keeps removing. A name that
 * links nowhere is honest about being a proposal.
 *
 * **The branch track is EMPTY**, and empty is the content. A derived branch name
 * would put a plausible identifier where nothing exists, and the next reader
 * could not tell it from a branch nobody has claimed — a row this board already
 * renders, meaning something else entirely.
 *
 * **The number links to the tracker, or does not.** `url` is "" when the host
 * reported no address, and the number then renders as plain text rather than as
 * an invented link — `PrCell`'s own rule, applied to the same problem.
 *
 * **Its one action lives in the `⋯` menu**, like every other row's. *Create
 * plan* writes only a plan file that REFERENCES the issue — nothing reaches the
 * tracker — so the menu holds it the way `RowActions` holds a branch's actions.
 * See {@link IssueRowActions}; the row itself carries only what it NAMES, which
 * here is the tracker number and nothing else.
 */
/**
 * A TRACKER ISSUE, as a tuple — and the row that proves the collapse was about
 * a shape rather than about two kinds disagreeing.
 *
 * This component was **two lines**: a wrapper that laid a ticket on
 * `ROW_TRACKS`, the tracks of a BRANCH. A ticket has no slice, no worker and no
 * branch; it wore those columns because there was no third grid to give it, and
 * nobody noticed because two of the seven were empty and the rest were filled
 * with something else's vocabulary — the kind cell read `Discovery`, a PLAN
 * PHASE on a row that is not a plan and has never entered the lifecycle the
 * word comes from.
 *
 * `tupleFromIssue` answers all six slots from the issue's own facts. Slot 3 is
 * the TITLE — what a reader decides about — and the number rides in slot 4
 * pointing at the tracker, which is where a reader goes to read it: item and
 * artifact, the same split every other kind makes.
 *
 * What the old cell was claiming that IS worth keeping — *this is a proposal,
 * not a plan* — survives in what the row does and does not render: the branch
 * slot is empty because an issue has no branch, and slot 2 says `Story` rather
 * than borrowing a word from another object's vocabulary.
 */
export function IssueRowView(
  { issue, idea, story, issueAnswer }:
  { issue: IssueRow; idea: DispatchInfo; story: DispatchInfo; issueAnswer: IssueAnswer },
) {
  return (
    <TupleRowView
      tuple={tupleFromIssue(issue)}
      rowAttr={{ 'data-issue-row': `${issue.number}` }}
      // THE TRACKER'S TWO HOOKS, and which one fires says whether the tracker
      // gave an address. They were on the anchor and the span inside this
      // component and they move with the NAME rather than with the component —
      // the same rule `data-branch` follows. Stamped here rather than in
      // `valueAttr` because `what: 'ticket'` is also worn by an agent's session
      // id, and only this call site knows the row is an issue.
      nameAttr={{
        link: { 'data-issue-link': '' },
        text: { 'data-issue-number': '' },
      }}
      aside={
        // THE INFERRED PLAN NAME — what this issue would be called if someone
        // made a plan of it. TEXT and never an anchor, because there is nothing
        // to open: the plan does not exist, and that is the whole point of the
        // row. `data-issue-name` is what a test asserts is not an `<a>`.
        //
        // IN SLOT 4, and it was in slot 5 until 2026-08-20 — where it crushed
        // the status to `o…` and read as though `fleet-scan-asks…` were this
        // row's condition. Measured from a screenshot.
        //
        // This component's own docstring sketch has always put it in the PLAN
        // column, not the status one; the collapse moved it and the sketch was
        // never followed. Slot 4 is the artifact slot — zero-or-more and `1fr` —
        // and a plan this issue WOULD become is a related thing, which is what
        // that slot holds. Slot 5 is one word a reader scans down a column.
        // THROUGH `TupleLinkView`, so it wears the PLAN glyph like every other
        // named thing in slot 4 — reported from a screenshot, where this was the
        // one name in the column with no icon before it.
        //
        // `what: 'plan'` because that is what the name IS: the plan this issue
        // would become, which is why the function is called
        // `inferredPlanName`. `href: ''` keeps it TEXT, by the rule the
        // component's own docstring states — the plan does not exist, and a link
        // to one that does not is the fabrication this board keeps removing.
        <TupleLinkView
          link={{ what: 'plan', label: inferredPlanName(issue.title), href: '' }}
          showWhat
          extraAttr={{ text: { 'data-issue-name': '' } }}
        />
      }
      // THE ROW'S ACTIONS, behind the same `⋯` menu every other row wears.
      // `Create plan` used to sit bare in this cell — the one row whose actions
      // were not in the menu — and `the-menu-fits-the-kind` gave the ticket its
      // full set: Create plan, Create story, Open on host. Both creating actions
      // WORK now; *Create story* was offered-and-always-refused until 2026-08-27,
      // on a ground the skill it named contradicts.
      menu={<IssueRowActions issue={issue} idea={idea} story={story} issueAnswer={issueAnswer} />}
    />
  );
}
