import type { MouseEvent } from 'react';
import type { CardFacts } from '@plot-pm/domain/entities/card-facts';
import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import { planIndexOf, planReference, planRefOfIssue, type PlanIndex } from '@plot-pm/domain';
import {
  type AgentRow,
  type Card,
  type DispatchInfo,
  type Fleet,
  type IssueAnswer,
  type IssueRow,
  RELEASE_BRANCH,
} from '../../../contract/schema.js';
import { tupleFromIssue } from '../tuple-row.js';
import { TICKET_TRACKS, TupleLinkView, TupleRowView } from '../../components/TupleRow.js';

/** An index with no entries — a plan reference still links from its own file. */
const EMPTY_PLAN_INDEX: PlanIndex = planIndexOf({});
// THE DOMAIN'S OWN DISCRIMINATOR, not a re-read of the field. `identity ===
// 'manifest'` is a rule with a test beside it in
// `packages/domain/test/agent.test.ts`; comparing the string here would be a
// second copy of it in a component.
import { noteShown } from '@plot-pm/domain';
import { IssueRowActions } from './menus.js';

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
 * the plan row already applies this rule and says so outright: *a plan row is not a
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
  /** The board's ticket card facts by issue number; the issue rows' *Create plan* follows them. */
  ticketFacts?: ReadonlyMap<string, CardFacts>;
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
   * The plan file of the board card whose `slug` is `slug`, or `''` where the
   * board holds none. A plan-level row names only its plan's slug, so its plan
   * link reads the file from here. Absent before the board's first payload.
   */
  planFileForSlug?: (slug: string) => string;
  /**
   * The board's own Planning cards — the source `AgentList` builds its
   * `planIndex` from, alongside the fleet's draft plans. Absent before the
   * board's first payload.
   */
  cards?: readonly Card[];
  /**
   * The board's plan index — every card and draft plan, keyed by file basename
   * and by slug — built once by the caller and threaded to every row builder
   * that names a plan. Absent before the board's first payload, which resolves
   * nothing: a reference still links from its own file (`planReference`).
   */
  planIndex?: PlanIndex;
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
  restartWith?: DispatchInfo;
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
   * Whether this server will act on `Create story`, and why not — the NINTH
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
   * Whether this server will act on `Slice this plan`, and why not — the fifth
   * capability, reaching the `unsliced-wave` slice rows. Same binding as `idea`
   * today (both spawn a plot agent that writes to this disk), kept its own prop
   * for the reason those are: one flag for two capabilities is how they diverge.
   */
  reslice?: DispatchInfo;
  /**
   * Whether this server will act on `Deliver`, and why not — the sixth
   * capability, reaching the PLAN rows whose card is `deliverable`. Same binding
   * as `idea` and `reslice` today (all spawn a plot agent that writes to this
   * disk), kept its own prop for the reason those are: one flag for two
   * capabilities is how they diverge. Read together with the card's
   * `deliverable` bit — this says the board can act, that says the plan is
   * complete enough to.
   */
  deliver?: DispatchInfo;
  /**
   * Whether this server will act on `Implement`, and why not — the seventh
   * capability, reaching the PLAN rows with eligible work. Same binding as
   * `idea`, `reslice` and `deliver` today (all spawn a plot agent that writes to
   * this disk), kept its own prop for the reason those are: one flag for two
   * capabilities is how they diverge. Read together with the card's
   * `hasEligibleWork` — this says the board can act, that says the plan has work
   * to start.
   */
  implement?: DispatchInfo;
  /**
   * Whether this server will act on `Drop this agent`, and why not — the eighth
   * capability, reaching agent rows in WAITING ON YOU. Unlike the seven above,
   * this removes a manifest rather than spawning an agent: it is the board's
   * manual reconciliation for entries the automatic resolver cannot clear.
   *
   * Same binding as the seven above (a write to this disk), kept its own prop
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
  /**
   * Who is reading — the two identity fields `/api/board`'s `server` carries,
   * and its `People` directory, for the "only my work" filter to compare each
   * row against.
   *
   * A PROP rather than a field on `Fleet`, because the identity travels on the
   * BOARD payload and the two are fetched separately. Absent where the board
   * has not answered yet, and absent from an older server that never sent the
   * fields — both of which the ownership rule reads as an unknown reader, which
   * hides nothing. A filter that emptied the board because it did not yet know
   * who was looking would be the worse failure by far.
   */
  server?: { hostUser?: string; gitEmail?: string; people?: Record<string, string> };
  /**
   * The default branch's CI reading — `/api/board`'s `defaultBranch`, carried
   * the same way `server` above is: a prop rather than a `Fleet` field, because
   * it travels on the board payload and the two are fetched separately.
   *
   * Absent where the board has not answered yet, and absent from an older
   * server that never sent the field — both read as "no reading", which
   * `defaultBranchStatus` already treats as "not red" rather than "green".
   */
  defaultBranch?: DefaultBranchReading;
  /**
   * Whether the board's OWN checkout is clean — `/api/board`'s
   * `checkoutClean`, carried the same way `defaultBranch` above is. Absent or
   * null reads as "no reading", which `checkoutHealthStatus` treats as "say
   * nothing" rather than "clean".
   */
  checkoutClean?: boolean | null;
  /**
   * The board's own spawn contract against the gate's — `/api/board`'s
   * `spawnContract`, carried the same way `checkoutClean` above is. Absent
   * where the board has not answered yet, or from an older server that never
   * sent the field; `spawnerStatus` reads a missing reading as `unknown`.
   */
  spawnContract?: {
    spawnContract: number;
    bundlePath: string;
    bundleHash: string | null;
    runningBundleHash: string | null;
    gateNumber: number | null;
    gatePath: string;
  } | null;
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
 *
 * The href comes from `planReference`, the same resolution every other plan
 * site in this module uses — a reference carrying its own `planFile` links
 * from it at once, with no wait on `planIndex`.
 */
export function PlanLink({
  plan,
  planFile,
  onOpenPlan,
  planIndex = EMPTY_PLAN_INDEX,
}: {
  plan: string;
  planFile: string;
  onOpenPlan?: AgentListProps['onOpenPlan'];
  planIndex?: PlanIndex;
}) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenPlan) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!onOpenPlan(planFile)) return;
    e.preventDefault();
  };
  const answer = planReference({ file: planFile || undefined, slug: plan || undefined }, planIndex);
  if (!answer.href) return <>{plan}</>;
  return (
    <a
      href={answer.href}
      onClick={handle}
      rel="noreferrer"
      className="text-blue-600 hover:underline dark:text-blue-400"
    >
      {plan}
    </a>
  );
}

/**
 * The row's note, with a verdict sentence withdrawn where the row's own
 * `startability` contradicts it.
 *
 * A SLICE SOMEBODY IS ON MUST NOT OFFER ITSELF. Reported by the operator from
 * their own board, 2026-09-13: the branch of
 * `a-harness-this-machine-cannot-run-refuses` rendered
 * *"eligible — nobody has taken it"* beside slot 5's *someone is on it*, on ONE
 * line, while the agent was visibly working. The payload said both:
 *
 *     row  kind=wave  verdict=eligible  startability=someone-is-on-it
 *     AGENT branch=bug/a-harness-…  state=running
 *
 * THE TWO FIELDS DISAGREE BY CONSTRUCTION, and the verdict is not the thing
 * that is wrong. `startabilityVerdict` answers both in one function, in a fixed
 * order: a `wip` or `claimed` branch returns `someone-is-on-it` and never
 * reaches the slice-verdict gate below it. `eligible` means *every prior slice
 * has landed*, which stays true after a claim — a claim does not un-satisfy a
 * prerequisite. So the row was reading the right field for slot 5 and the wrong
 * one for its sentence.
 *
 * THE NOTE IS THE SERVER'S, WHICH IS WHY THE FIX IS HERE. `ELIGIBLE_NOTE` is
 * composed in `fleet.ts` from the slice verdict and travels on the row; with no
 * PR, `noteWithoutPr` passes it through untouched, so the sentence reaches the
 * reader verbatim. The client's own copy of it — the `sliceNote` chain — was
 * never reached by this population: NOT STARTED's slice rows are filtered to
 * `isUnbegun` (the server's `unbegun` field), so a claimed branch renders
 * through `Row`.
 *
 * WITHDRAWN RATHER THAN REPLACED, and that is the narrow claim. Slot 5 already
 * says *someone is on it* — `stateStatus` has read the field since
 * `the-row-says-whether-you-can-start-it` — so the fact is on the line already
 * and a second spelling of it beside the first is the duplication this whole
 * plan is about. What the row loses is a sentence that was false; what it keeps
 * is every sentence that was not.
 *
 * THE GATE IS THE ONE VERDICT, not truthiness and not the other three. Only
 * `someone-is-on-it` contradicts *nobody has taken it*; `needs-brief` and
 * `waiting-on-approval` describe rows whose notes say something else entirely,
 * and a null from an older server or a merged branch has no startability
 * question to answer. Each of those falls through and renders as before —
 * `stateStatus`'s shape, and its reason: *"a null from an older server, or a
 * merged branch with no startability question, falls through and renders its
 * git state as before."*
 *
 * READS THE FIELD, NEVER THE SENTENCE. `verdict-not-prose.test.ts` is a
 * structural gate over this source and would fail any `note.includes(…)`
 * spelling of the same intent; the standing rule at `ELIGIBLE_NOTE` is that
 * nothing new may be built on matching prose. `startability` is the field that
 * carries this answer, so this asks it.
 *
 * A QUIET ROW WITH A KIND IS THE ONE EXCEPTION, and it is the opposite
 * population from the one above: `abandoned` and `orphaned-claim` read
 * `someone-is-on-it` is false for them — nobody is on a QUIET row — but
 * `stateStatus` already prints their kind word in slot 5, and their note
 * (*commits, no PR ever opened*, *claimed, no work committed*) is not a
 * duplicate of it. So this keeps the note wherever `group === 'quiet'` and
 * `quietKind` is set, before asking `startability` at all.
 *
 * @param row - the row about to render its note.
 * @returns the note, or "" where the row's startability contradicts it.
 */
export function startableNote(row: AgentRow): string {
  return noteShown({ startability: row.startability, group: row.group, quietKind: row.quietKind ?? null })
    ? row.note
    : '';
}

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
 * The subject changes and the geometry does not — the rule the plan row already
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
  { issue, idea, story, issueAnswer, facts, showKindLabel = true, onOpenPlan, planIndex = EMPTY_PLAN_INDEX }:
  {
    issue: IssueRow;
    /** The ticket's card facts, where the board carries them; *Create plan* follows them. */
    facts?: CardFacts;
    idea: DispatchInfo;
    story: DispatchInfo;
    issueAnswer: IssueAnswer | null;
    showKindLabel?: boolean;
    onOpenPlan?: AgentListProps['onOpenPlan'];
    planIndex?: PlanIndex;
  },
) {
  const { ref, resolved } = planRefOfIssue(issue.number, inferredPlanName(issue.title), planIndex);
  const answer = planReference(ref, resolved ? planIndex : EMPTY_PLAN_INDEX);
  return (
    <TupleRowView
      tuple={tupleFromIssue(issue, { showKindLabel })}
      tracks={TICKET_TRACKS}
      rowAttr={{ 'data-issue-row': `${issue.number}` }}
      // THE TICKET'S TYPE AND OWNER, beside its name — a fact about the
      // ticket, the same slot a branch row's slice badge uses for a fact
      // about the branch. Both are optional and render nothing where the
      // tracker answered neither, matching the Discovery card's own rule for
      // `view.type`/`view.owner` (`StoriesTab.tsx`'s `TicketRowView`).
      beside={
        issue.type || issue.owner ? (
          <span className="flex items-center gap-1.5">
            {issue.type ? (
              <span
                data-issue-type
                className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300"
              >
                {issue.type}
              </span>
            ) : null}
            {issue.owner ? (
              <span data-issue-owner className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                {issue.owner}
              </span>
            ) : null}
          </span>
        ) : null
      }
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
        // `what: 'plan'` because that is what the name IS. Where an indexed plan
        // names this issue, `planRefOfIssue` resolves it and the name links to
        // that plan. Otherwise it is the plan this issue would become
        // (`inferredPlanName`), and `href: ''` keeps it TEXT: that arm fires
        // only when the lookup resolves nothing, and a link to a plan that
        // does not exist is the fabrication this board keeps removing.
        <TupleLinkView
          link={{
            what: 'plan',
            label: answer.label,
            href: answer.href ?? '',
            internal: true,
            file: answer.href !== null ? decodeURIComponent(answer.href.replace(/^\/plan\//, '')) : undefined,
          }}
          showWhat
          onOpenPlan={onOpenPlan}
          extraAttr={{ text: { 'data-issue-name': '' } }}
        />
      }
      // THE ROW'S ACTIONS, behind the same `⋯` menu every other row wears.
      // `Create plan` used to sit bare in this cell — the one row whose actions
      // were not in the menu — and `the-menu-fits-the-kind` gave the ticket its
      // full set: Create plan, Create story, Open on host. Both creating actions
      // WORK now; *Create story* was offered-and-always-refused until 2026-08-27,
      // on a ground the skill it named contradicts.
      menu={<IssueRowActions issue={issue} idea={idea} story={story} issueAnswer={issueAnswer} facts={facts} />}
    />
  );
}
