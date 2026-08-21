import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import {
  type AgentRow,
  type WaitingOn,
  type Card,
  type DispatchInfo,
  type Fleet,
  type IssueAnswer,
  type IssueRow,
  type PulseShrink,
  type Repair,
  type Stuck,
  type StuckState,
  type WaitingGroup,
  type WaveVerdict,
  type AgentEntry,
  type RowKind,
  UNNAMED_WAVE,
  isSpikeWave,
} from '../../contract/schema.js';
import { ApproveButton } from './ApproveButton.js';
import { CommissionDesignButton } from './CommissionDesignButton.js';
import { CreatePlanButton } from './CreatePlanButton.js';
import { StatusPanel, type BoardStatus } from './StatusPanel.js';
import { isDraft } from './PlanCard.js';
import { StartWorkButton } from './StartWorkButton.js';
import { WorkerLogModal } from './WorkerLogModal.js';
import { DispatchLogModal } from './DispatchLogModal.js';
import { ChangedFilesModal } from './ChangedFilesModal.js';
// THE BOARD'S ONE AGE DIALECT, borrowed rather than reimplemented. A second
// formatter would drift from this one the first time either changed — the same
// reason `ageLabel` was split out of `age` so an issue row and a branch row
// cannot render one duration two ways.
import { agoLabel } from './AgentPanelFacts.js';
// THE TUPLE — one component and one grid for all seven kinds, and the
// projection that fills its six slots.
//
// `Row`, `PlanRow` and `IssueRowView` used to live in this file, on TWO grid
// definitions between the three of them — and the third, a TICKET, rendered
// through the tracks of a BRANCH: no wave, no worker, no branch, wearing the
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
import { splitBranch, tupleFromIssue, tupleFromPlan, tupleFromRow, tupleFromWave, prStatus, stateStatus, workerStatus, tupleAgeText} from '../lib/tuple-row.js';
// RE-EXPORTED, not redefined. `splitBranch` moved to the module that owns the
// slot rules when the collapse deleted `BranchName`; the unit suite imports it
// from here, and a second definition is exactly the drift this wave removed.
export { splitBranch };
import { MARKS_CELL, TupleLinkView, TupleRowView } from './TupleRow.js';

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
  // *a machine is working* rather than *CI will finish*. The section lists
  // PROCESSES and CI is only one kind: a worker running in a local worktree is a
  // machine working too, and it is observable in this very checkout. The old
  // hint named the one source the section was filled from and would now be
  // wrong about an empty section for the other reason — no local run either.
  //
  // It also drops a FORECAST. *CI will finish* predicts an outcome nothing here
  // measures; *a machine is working* is what was observed, and the section's own
  // rule. `HOST_CANNOT_REPORT_HINT` still withdraws even this where the host
  // cannot be asked at all.
  { key: 'waiting-on-machine', icon: '⏳', label: 'Waiting on a machine', hint: 'nothing — a machine is working' },
  // *approved* rather than only *nobody has taken it*: the section is filtered
  // on the plan's phase first, so every row in it is one an agent may actually
  // take. The old hint described the branch and let three unclaimable kinds of
  // row in behind it.
  { key: 'not-started', icon: '📋', label: 'Not started', hint: 'approved — nobody has taken it' },
  { key: 'quiet', icon: '💤', label: 'Quiet', hint: 'still thinking, or dead?' },
  // `delivered` for the same reason the row's status word changed: it is Plot's
  // term for the transition (Draft → Approved → **Delivered** → Released) and
  // `/plot-deliver` performs it. `merged` names what git did to a ref.
  { key: 'done', icon: '✅', label: 'Done', hint: 'delivered' },
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
 * What the empty WAITING ON A MACHINE section says where the host cannot answer.
 *
 * The default hint — *nothing — a machine is working* — is a claim: it says no
 * machine is working on any of this right now. On a host that cannot report
 * checks or mergeability that claim is unfounded for the CI half of the section,
 * and the section is then empty for a completely different reason: nobody
 * looked, because nobody could. A local process would still be listed — that
 * half is observed here rather than asked of the host — which is why the hint
 * only ever replaces the sentence of an EMPTY section.
 *
 * Measured: the Bitbucket adapter emits a literal `checks:"unknown",
 * mergeable:"unknown"` on every row, because `bb` has no run listing. That is
 * not deferred work — it is the CLI's limit — so this section is permanently
 * empty there, and an unexplained empty section reads as *nothing is running*
 * for as long as the board is open.
 *
 * **Absent is not a clearance**, applied to a section instead of a field. The
 * hint names the host's limit so the emptiness reads as *I cannot tell you*
 * rather than as *all quiet*.
 */
export const HOST_CANNOT_REPORT_HINT = 'this host cannot report CI';

/**
 * Whether every PR on the board came back unreadable.
 *
 * The condition for `HOST_CANNOT_REPORT_HINT`, and it is deliberately ALL and
 * not ANY: one `unknown` row among readable ones is a single PR mid-outage or a
 * single cross-host repo, and the section is then empty for the ordinary reason.
 * Only when no PR anywhere answered is the section's emptiness attributable to
 * the host rather than to the fleet.
 *
 * Rows WITHOUT a PR are not counted either way — they have nothing to report and
 * are not evidence about the host. A board with no PRs at all therefore answers
 * `false`: nothing has been observed, so nothing can be concluded, and claiming
 * a host limit from an absence of evidence would be the very mistake this hint
 * exists to correct.
 *
 * **A MERGED ROW IS NOT EVIDENCE EITHER**, by that same rule and for the same
 * reason. A merged PR reports `mergeable: "unknown"` on GitHub — the question
 * stops being computed once the branch lands — so it reaches this function as
 * `state: 'unknown'` on a host that answers CI perfectly well. It is not an
 * outage and not a host limit; it is a finished PR having no live condition to
 * report, which is the *nothing to report* case one line up.
 *
 * Excluded from 2026-08-20, when the row began carrying its merged PR's link.
 * Before that a merged branch had no `pr` at all and fell out of this tally by
 * accident; keeping it in would have turned a plan of merged branches plus one
 * PR mid-outage into a false claim about the host — with the hint's own words
 * ("nobody could look") printed under a section that was simply quiet.
 *
 * Exported for test.
 */
/**
 * What a row says WHEN LISTED AS A PROCESS — the machine section's sentence,
 * never the branch's.
 *
 * THE SECTION'S SENTENCE IS ABOUT THE MACHINE, never about who holds the
 * branch. `note` is the row's own sentence and may be about an agent — *worker
 * running (pid 20145)* — which is a true statement in WORKING and no answer at
 * all to *what am I waiting on?*
 *
 * EVIDENCE, NEVER A FORECAST, and this is where that rule is visible to a
 * reader. The sentence names what was OBSERVED — *CI is running for PR #244* —
 * and never a remaining time. GitHub publishes no finish time for a queued
 * check, and a countdown nobody can honour is the shape this repo removes rather
 * than adds. Principle 3: the scan collects, the reader concludes whether to
 * wait.
 *
 * JOINS WHAT IT IS GIVEN, NEVER RANKING IT. Only host entries reach the row
 * since `machineProcesses` stopped writing a local one, so in practice this
 * joins nothing — but a row with two pending checks is a row with two machines
 * on it, and dropping either because the other came first is the displacement
 * this board keeps undoing.
 *
 * FALLS BACK TO `note` for a row that reached the section through `group` with
 * no process listed — a `pending` check from an older pulse that predates
 * `processes`. Its note already reads *PR #244, CI running*, which is exactly
 * this sentence by the other road, so the fallback changes nothing that renders
 * and keeps an older payload from going blank.
 */
export function machineNote(row: AgentRow): string {
  const procs = processesOf(row);
  if (procs.length === 0) return row.note;
  return procs.map((proc) => proc.evidence).join('; ');
}

/**
 * This row's processes, tolerating a payload that has none of the field at all.
 *
 * THE CLIENT IS SERVED BY A SERVER IT DOES NOT VERSION WITH. The board's page is
 * a built artifact that a reader may have open across a restart, and
 * `/api/fleet` answers from whichever server is running — so a row can arrive
 * without `processes` even though the schema defaults it to `[]`, because the
 * default applies where the payload is PARSED and the client renders what it was
 * handed. Reading `.length` off an absent array crashes the whole board, and a
 * blank page is a far worse answer to a missing convenience field than an empty
 * list is.
 *
 * ABSENT IS NOT FALSE, applied as the codebase applies it everywhere else: an
 * empty result here means *nothing was reported*, and the section then falls back
 * to `group` — exactly the board's behaviour before this field existed.
 */
function processesOf(row: AgentRow): AgentRow['processes'] {
  return row.processes ?? [];
}

/**
 * Whether this row belongs in WAITING ON A MACHINE — the server's grouping, and
 * nothing added to it.
 *
 * AN AGENT IS THE MACHINE, NEVER THE WAIT. The section answers *what am I
 * waiting on?* and holds a branch, a PR or a plan whose progress depends on
 * something automated. An agent is not an answer to that question — it is the
 * thing doing the work, and WORKING says so while also saying *who*.
 *
 * THIS PREDICATE USED TO ADD A SECOND CLAUSE, `|| processesOf(row).length > 0`,
 * and that clause is what put agents here. It was written for *"an agent
 * watching its own CI"* — listed twice, once as an agent and once as a process —
 * but that case is two subjects, not one subject twice: the agent goes to
 * WORKING and the PR comes here through `group`, each once. What the clause
 * actually keyed on was *a process is running*, and an agent is always a
 * process, so it fired for every live worker. Measured 2026-08-20:
 * `bug/one-component-renders-every-row` rendered in both sections with
 * **`pr: None`** — nothing automated anywhere near it.
 *
 * KEYED ON `group` ALONE, rather than on `processes` filtered to host entries,
 * and the difference is where the guarantee lives. `machineProcesses` no longer
 * writes a local entry, so both spellings render the same rows today — but a
 * predicate that reads `processes` holds *no agent reaches this section* only
 * for as long as that other file keeps its promise, which is a rule in a second
 * place. Reading `group` makes it structural: the client cannot admit a row the
 * server did not group, whatever `processes` later carries. The field stays on
 * the row and `machineNote` still reads it for the section's sentence — this
 * decides MEMBERSHIP, and membership has one source.
 */
export function inMachineSection(row: AgentRow): boolean {
  return row.group === 'waiting-on-machine';
}

export function hostCannotReportCi(rows: readonly AgentRow[]): boolean {
  const withPr = rows.filter((r) => r.pr && r.state !== 'merged');
  return withPr.length > 0 && withPr.every((r) => r.pr!.state === 'unknown');
}

/**
 * Which clock the host-derived sections were read from.
 *
 * Four answers, because the board has four situations and printed one word for
 * two of them. `none` under WAITING ON A MACHINE was shown both when the host
 * had answered and reported nothing pending, and when the host had not been
 * asked at all — opposite situations wanting opposite responses, with the
 * reassuring one as the default.
 *
 * Measured 2026-08-18 from two screenshots of one board 22 seconds apart. At
 * `PR data 22s ago` the section read `none` and no row carried a status; at
 * `PR data 4s ago` the same board reported #57 `conflicts`, #196 `checks
 * failing` since the previous day, and #203 `CI running`. Nothing changed on
 * the host between them. A branch whose CI had been red overnight presented as
 * unremarkable, and the operator read the board as having LOST its state when
 * it had simply not yet fetched it.
 *
 * This is `docs/plans/2026-08-17-an-outage-is-not-an-answer.md`'s rule — a
 * failure to observe must not be reported as an observation — at the one
 * boundary that plan did not cross. An outage at least produces an error to
 * carry; a first fetch that has not happened produces nothing at all, which is
 * how it survived a plan written to catch exactly this shape.
 *
 * FOUR STATES, NOT THREE. `unreachable` is deliberately not folded into
 * `unasked`, and that was the plan's one open question. Both mean *no host
 * fact is on this board*, so one label would be defensible — but they want
 * different responses. `unasked` resolves itself in seconds and asks the reader
 * for nothing; `unreachable` will not resolve until somebody looks at the
 * error, and `an-outage-is-not-an-answer` is the plan that established an
 * outage must be visible AS an outage. Collapsing them would re-file a standing
 * fault as a passing one.
 *
 * The distinction costs nothing to compute, because the server already draws
 * it: `refreshPrs` leaves `prAt` untouched when the call throws (`fleet.ts`),
 * so a null age beside an error is a FIRST fetch that failed, while a null age
 * with no error is a fetch not yet made. The footer has read the pair this way
 * all along — `· no PR data yet` is already gated on both.
 *
 * A FIRST-LOAD STATE, NOT A STALENESS DISPLAY. Once the host has answered,
 * every later answer is `answered` no matter how old, because ordinary ageing
 * is what the footer reports (`PR data 111s ago`) and re-labelling every
 * section every 60 s would trade one misreading for a flicker. `prAgeSeconds`
 * is therefore tested against null and never against a threshold.
 *
 * THE SCAN'S OWN AGE IS NOT CONSULTED. `fleet.ageSeconds` dates the git scan,
 * which is cheap and runs every few seconds; `prAgeSeconds` dates the host,
 * which is metered and runs every 60. Conflating them into one page age is what
 * let a git-fresh board read as host-fresh, so a PR-derived field must never
 * borrow the scan's clock.
 *
 * Exported for test.
 */
export type HostAnswer = 'answered' | 'unasked' | 'unreachable';

/**
 * Read the host's answer state off a fleet.
 *
 * Reads ONLY the two PR fields. Passing the whole fleet would let a later edit
 * reach for `ageSeconds` and silently reintroduce the conflation this exists to
 * remove, so the parameter names exactly what it is allowed to see.
 */
export function hostAnswer(
  fleet: Pick<Fleet, 'prAgeSeconds' | 'prError'>,
): HostAnswer {
  if (fleet.prAgeSeconds !== null) return 'answered';
  return fleet.prError ? 'unreachable' : 'unasked';
}

/**
 * What an empty host-fed section says when the host has not answered.
 *
 * EVIDENCE, NOT VERDICT. Each says what happened to the call and stops there:
 * no estimate, no retry count, and above all no *probably fine*. The rule the
 * scan's own outputs follow — scripts collect, humans conclude (Manifesto
 * Principle 3).
 *
 * Both must avoid the shape of the default hint (*nothing — a machine is
 * working*), which is a CLAIM about the machines. An empty section that still implies
 * something is running is the failure being corrected, whatever words it uses.
 */
export const HOST_ANSWER_HINT: Record<Exclude<HostAnswer, 'answered'>, string> = {
  unasked: 'not checked yet',
  unreachable: 'could not reach the host',
};

/**
 * The kind of a host failure — a rate limit is a THIRD state, never an outage.
 *
 * `2026-08-20-a-rate-limit-is-not-an-outage.md`: a spent budget is *partial,
 * temporary, and with a known end*; an unreachable host is none of those. The
 * note that reports the failure must not collapse the two into one word, so it
 * reads the kind here first.
 *
 * The signal is the message string, `/rate limit/i` — the SAME string the
 * backend keys on (`rateLimitBackoffMs` in fleet.ts). A shelled-out `gh` hands
 * back only its stderr, so both ends read the same words; a second, cleverer
 * detector on the client would be the place the two vocabularies drift, and the
 * note would say *outage* while the fetch was already backing off for a rate
 * limit. Anything the backend does NOT recognise as a rate limit is an outage
 * here too — the honest default, since a message that names no reset has no end
 * to promise.
 */
export type HostErrorState = 'rate-limited' | 'unreachable';

export function hostErrorState(error: string | null): HostErrorState | null {
  if (!error) return null;
  return /rate limit/i.test(error) ? 'rate-limited' : 'unreachable';
}

/**
 * When the spent budget returns, in the reader's words — or null when no reset
 * is known.
 *
 * `prNextInSeconds` is the reset the fetch already waits for: *backoff
 * included*, per the contract, which after the sibling wave is the host's real
 * `rate_limit` reset rather than the nominal cadence. Rounded to the minute
 * above a minute, because the wait is minute-scale and second-precision would
 * flicker every render; kept in seconds below that, where a minute would read
 * as *0 min*. Null (an older server, or a due-now gate at 0) yields no phrase,
 * so the note says the budget is spent without inventing a time it cannot name.
 */
function resetPhrase(prNextInSeconds: number | null): string | null {
  if (prNextInSeconds === null || prNextInSeconds <= 0) return null;
  if (prNextInSeconds < 60) return `${prNextInSeconds}s`;
  return `${Math.round(prNextInSeconds / 60)} min`;
}

/**
 * The PR footer note — one sentence, or null when the host answered.
 *
 * TWO shapes for TWO failures, which is the whole branch. An unreachable host
 * keeps the exact wording `an-outage-is-not-an-answer` settled — *PR data
 * unavailable (…) — the two groups above that depend on it may be incomplete.*
 * A rate limit is not unavailable: it says so, and names when service returns.
 *
 * Exported for test — the wording is the contract with the reader.
 */
export function prNote(fleet: Pick<Fleet, 'prError' | 'prNextInSeconds'>): string | null {
  const kind = hostErrorState(fleet.prError);
  if (kind === null) return null;
  if (kind === 'rate-limited') {
    const when = resetPhrase(fleet.prNextInSeconds);
    return (
      "PR data paused: the host's rate limit is spent" +
      (when ? `, service returns in ~${when}` : '') +
      ' — the two groups above that depend on it may be incomplete.'
    );
  }
  return `PR data unavailable (${fleet.prError}) — the two groups above that depend on it may be incomplete.`;
}

/**
 * The issue footer note — one sentence, or null when the tracker answered.
 *
 * The rate-limit case is the sharpest test the plan names: a spent budget means
 * the tracker was REFUSED, not that reading it failed. *could not be read*
 * claims a check that ran and failed, and a rate limit ran no check — so it
 * must not borrow that wording. The issue poll shares the PR gate (`prNextAt`),
 * so `prNextInSeconds` is its reset too.
 */
export function issueNote(fleet: Pick<Fleet, 'issueError' | 'prNextInSeconds'>): string | null {
  const kind = hostErrorState(fleet.issueError);
  if (kind === null) return null;
  if (kind === 'rate-limited') {
    const when = resetPhrase(fleet.prNextInSeconds);
    return (
      "Open issues paused: the tracker's rate limit is spent" +
      (when ? `, service returns in ~${when}` : '') +
      ' — this list may be incomplete.'
    );
  }
  return `Open issues could not be read, so this list may be incomplete — ${fleet.issueError}`;
}

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

/**
 * Minutes as the board says them: `45m`, `3h`, `2d`.
 *
 * Split out of `age` so an ISSUE row and a BRANCH row cannot render the same
 * duration two ways. `age` takes an `AgentRow`, which an issue is deliberately
 * not — and the alternative to sharing this was a second copy of four lines
 * that would drift the first time either changed.
 *
 * Exported for test.
 */
export function ageLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
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
 * Arithmetic, not taste: the fixed tracks total 540 px and the gaps and padding
 * add 84 px, so **the grid needs 624 px before the branch column gets a single
 * pixel** — and a 375 px phone is 249 px short. Tailwind's `sm` breakpoint is
 * 640 px, the first stop above that number.
 *
 * The PR track's growth from `9rem` to `14rem` moved that number from 544 px to
 * 624 px and left the breakpoint where it is — 640 px is still the first stop
 * above it, with 16 px to spare. A further widening of any fixed track would
 * cross it, and then this constant has to move too.
 *
 * Below it each row becomes a small block: the branch on its own line, with
 * plan, kind, PR and age wrapped beneath it. **Nothing is dropped and nothing
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
 * last: "we do not know" is not "ancient". **Plans of EQUAL age order by name**,
 * because age alone leaves most pairs tied and the tie was being settled by an
 * arrival order that changes every pulse — see the comparator.
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
  return [...groups.values()].sort((a, b) => {
    const byUrgency = urgency(b) - urgency(a);
    if (byUrgency !== 0) return byUrgency;
    // TIES ARE BROKEN BY NAME — the tiebreak #267 landed for NOT STARTED,
    // applied here where the same defect had been sitting unexamined.
    //
    // Age is a COARSE key. The rows of one pulse routinely share an age, so
    // those comparisons return 0 and the surviving order is whatever this Map's
    // insertion order happened to be. `Array.prototype.sort` is stable in every
    // engine since ES2019, so it faithfully preserves that arrival order — and
    // the arrival order is rebuilt from a fresh scan every four seconds.
    // Stability preserves an input that is not itself stable, which is why this
    // reads as a sorting bug and is not one.
    //
    // The plan NAME is the right tiebreak because it is the only field here
    // that cannot change between pulses: an age moves by the minute and a row
    // count moves as branches land, and both are derived. A name is identity.
    //
    // NOT the same line as `sortByWaiting`, and deliberately not shared with it.
    // That comparator keys on `waitingDays` — the plan's approval clock — to
    // answer *which plan has been ignored longest* for a section whose rows are
    // not branches. This one keys on the branch tip's clock to answer *which
    // plan holds the most urgent row*. Two questions, two keys; only the
    // tiebreak behind them is the same, and it is three lines.
    //
    // Found because the flicker was fixed one section over and the identical
    // line sat four hundred lines away in this file, unexamined — nobody had
    // watched THIS section reshuffle. A fix is not finished when the reported
    // instance stops.
    return a.plan.localeCompare(b.plan);
  });
}

/**
 * The sentence a GROUPED wave row carries, by what its count means.
 *
 * Each says what the wave is waiting for, and none of them is *may this be
 * started* — which is the only thing the verdict can say, and the reason these
 * rows do not use it.
 */
export function groupedNote(word: string | undefined): string {
  switch (word) {
    case 'delivered': return 'landed — nothing left in it';
    case 'stalled': return 'nothing has moved here for a while';
    default: return 'work landed — waiting to be merged';
  }
}

/**
 * Is this row's work FINISHED and waiting on a person to merge it?
 *
 * A branch with a PR open. That is the whole test, and it is the fact the
 * verdict cannot carry: a verdict answers *may this wave be started* — an
 * ORDERING question — and has no value meaning *the work in it is done*.
 *
 * Measured on the estate, that gap has a cost. `opus5-longhorizon-hardening ::
 * Implementation` holds **five `wip` branches** and reads `blocked`, because its
 * predecessor `Tracer` has not completed. All five are landed work; what stands
 * between them and `complete` is somebody merging. A verdict-only mapping files
 * that under *waiting on the machine* and the board says *nothing to do here*,
 * while five reviews sit — PR #57's plan, 25 days old.
 *
 * `merged` is excluded: that work is done AND landed, and belongs to DONE.
 */
export function isReviewable(row: AgentRow): boolean {
  return row.pr !== null && row.state !== 'merged';
}

/**
 * The waves worth grouping in a section — and there are none outside WAITING ON
 * YOU.
 *
 * A wave earns a row here when it holds **more than one reviewable branch**: a
 * lone PR is a PR, because there is no set for a wave row to name and a heading
 * over one row saves nothing. That is `showsWaveFold`'s rule, and the same one
 * that makes a single-branch wave exactly one row in NOT STARTED.
 *
 * SCOPED TO ONE SECTION on purpose. WORKING holds agents, WAITING ON A MACHINE
 * holds builds, and in neither is *a wave* the thing being decided — the grammar
 * `every-section-has-one-subject` settles that. Here the question is *what needs
 * a decision*, and three PRs from one wave are one decision about that wave.
 *
 * Unnamed waves are skipped: a group headed `(unnamed)` over rows that each name
 * their branch is a label that labels nothing, the same reason
 * `showPlanHeading` refuses a nameless plan.
 */
export function waveGroupsFor(rows: AgentRow[], section: WaitingGroup): WaveGroup[] {
  // WHICH ROWS a wave may claim, per section — and the predicate differs because
  // the sections ask different questions.
  //
  //   WAITING ON YOU  a branch with an open PR: the work is landed and somebody
  //                   has to merge it. Three PRs of one wave are ONE decision.
  //   QUIET           a branch that stopped moving. Two stale branches of one
  //                   wave are one wave that stalled, which is the readable
  //                   fact; two unrelated stale rows are not.
  //   DONE            a branch that landed. The wave is what was delivered.
  //
  // WORKING and WAITING ON A MACHINE are absent on purpose: an agent works and a
  // build runs, and neither is a wave — the grammar
  // `every-section-has-one-subject` settles it, and a wave row in either would
  // claim a subject that section does not have.
  const claims =
    // WAITING ON YOU HOLDS TWO KINDS OF WAIT, and the predicate was only
    // recognising one.
    //
    // `isReviewable` — a branch with an open PR — is *the work is done, merge
    // it*. But a branch whose PLAN is still in review is also waiting on a
    // person: to approve the plan. Measured on the live board, that is **12 of
    // the 14** wave-bearing rows in this section, all reading `open` with the
    // note *plan not approved yet — still in review* — and none of them grouped,
    // so the section showed 12 near-identical branch rows where it should show a
    // plan and its waves.
    //
    // So a wave claims any branch that belongs to it. What differs per section is
    // what must be EXCLUDED: a merged branch is done, and `done` wants only
    // those.
    section === 'waiting-on-you' ? ((r: AgentRow) => r.state !== 'merged')
      : section === 'quiet' ? ((r: AgentRow) => r.state !== 'merged')
        : section === 'done' ? ((r: AgentRow) => r.state === 'merged')
          : null;
  if (!claims) return [];
  // NO `length > 1` THRESHOLD, and its removal is the correction that matters.
  //
  // It was there on `showsWaveFold`'s reasoning — *a heading over one row saves
  // no repetition* — and that argument answers a different question. A fold is
  // about SAVING REPETITION; a kind is about **what the row is ABOUT**. A branch
  // cut for the wave `Surfaced` is that wave's work whether the wave holds one
  // branch or five, and the count is a fact about how the plan was written.
  //
  // Measured on the live board, the threshold also never fired: all **12** waves
  // in WAITING ON YOU hold exactly one branch, so the grouping was reachable
  // only through the mock's hand-made two-branch wave. A rule that fires only in
  // a fixture is a rule nothing tests.
  //
  // A wave holding several still folds — `expanded` is what the WaveRow does with
  // a set. What changed is that a wave of one is a wave, not a PR.
  // AN UNNAMED WAVE IS STILL A WAVE, and it still groups. This filtered
  // `(unnamed)` out until 2026-08-21, which left its rows ungrouped — so the plan
  // holding them got no `PlanRow` head and the branch led the row on its own,
  // beside 51 plan-headed siblings. Reported from a screenshot of DONE.
  //
  // Same correction as `carriesWave` on the server: the wave's NAME is not the
  // test for a wave. `MANIFESTO.md` — *"a plan with no subheadings is one wave"*
  // — so a plan nobody cut has one wave, unnamed, and its branches are that
  // wave's work. What it lacks is a label, and `waveLabel` still withholds that:
  // printing `(unnamed)` beside a branch names nothing.
  return groupByWave(rows.filter(claims)).filter((wg) => wg.wave);
}

/**
 * The rows a section renders on their own — everything no wave group claimed.
 *
 * The complement of `waveGroupsFor` over the same input, so every row appears
 * exactly once: a row inside a grouped wave renders in that wave's fold, and
 * everything else renders as itself. Computed as a SET of the claimed rows
 * rather than by re-deriving the predicate, because two spellings of *which rows
 * are grouped* is how a row ends up rendered twice or not at all.
 */
export function ungroupedRows(rows: AgentRow[], section: WaitingGroup): AgentRow[] {
  const claimed = new Set(waveGroupsFor(rows, section).flatMap((wg) => wg.rows));
  return rows.filter((r) => !claimed.has(r));
}

/** One wave's rows within a plan group, in the order they arrived. */
export interface WaveGroup {
  /** The wave's name as the plan file gave it, or "" where it named none. */
  wave: string;
  /** The scan's verdict for this wave, or null where no row carried one. */
  verdict: WaveVerdict | null;
  /**
   * The wave holding this one back, by name — from `row.blockedBy`, which the
   * server has populated all along while the board rendered the same fact as
   * the sentence `blocked by Relocated — 1 outstanding`.
   */
  blockedBy: string | null;
  rows: AgentRow[];
}

/**
 * Split one plan group's rows by wave.
 *
 * **A wave has branches, so the branches of one wave are one row's worth of
 * thing.** Measured on `last-pulse.json` 2026-08-20 — 35 plans, 71 waves — the
 * distribution is 57 waves of one branch, 8 of two, 3 of three, 1 of four and 2
 * of five. So the multi-branch wave is real and this cannot assume one-to-one.
 *
 * The sharper number is the intersection with the verdict: of the 14
 * multi-branch waves, **13 are `complete` and 1 is `blocked`**, and all 11
 * `eligible` waves hold exactly one branch. Across the 21 UNFINISHED waves the
 * split is 20 × one branch and 1 × five. That is not luck — a wave becomes
 * eligible when its predecessor completes and dispatch claims its branches at
 * once, so a wave is found with many branches either before anything reached it
 * or after everything finished. **One row is the common case; the fold is the
 * exception.**
 *
 * **INSERTION ORDER IS THE ORDER, and that is load-bearing.** `groupByPlan`
 * spends twenty lines on why it must not leave ties to arrival order: the rows
 * of one pulse share an age, `sort` is stable, and it faithfully preserves an
 * input rebuilt from a fresh scan every four seconds. This function does not
 * sort at all — a `Map` keyed on the wave name yields groups in first-appearance
 * order, which IS the age order the rows arrived in. Sorting here would
 * reintroduce that flicker one level down, and the wave sequence
 * (*Shaped* before *Relocated*) is the plan file's order, not something to
 * recompute.
 *
 * The verdict is taken from the FIRST row that carries one. Every branch of a
 * wave receives the same `wave.verdict` from the server (`fleet.ts`), so any of
 * them answers; taking the first non-null rather than the first row means a
 * five-branch wave still reports its verdict when one row's is absent.
 *
 * Exported for test — the multi-branch wave is the case an implementation
 * assuming one-to-one gets wrong while passing every single-branch assertion.
 */
export function groupByWave(rows: AgentRow[]): WaveGroup[] {
  const groups = new Map<string, WaveGroup>();
  for (const row of rows) {
    const existing = groups.get(row.wave);
    if (existing) {
      existing.rows.push(row);
      existing.verdict ??= row.verdict;
      existing.blockedBy ??= row.blockedBy;
    } else {
      groups.set(row.wave, {
        wave: row.wave, verdict: row.verdict, blockedBy: row.blockedBy, rows: [row],
      });
    }
  }
  return [...groups.values()];
}

/**
 * The wave name to print BESIDE A BRANCH NAME, or null to print none.
 *
 * ## It reads the branch alone, and that is the whole change
 *
 * This took a plan-wide wave COUNT until the wave moved out of the phase cell,
 * and the count is what the reader could not see. The gate was
 * `waveCount > 1`, justified — correctly, for where the label then sat — as
 * *a caption over a partition of one is noise*: the wave shared a column with
 * the plan phase, so an uninformative wave name displaced a different fact, and
 * the cell's meaning therefore depended on how many waves the plan had.
 *
 * That is the defect `a-row-is-a-tuple` measured as *one column, four
 * meanings*, and it cannot be fixed by choosing which meaning wins. Beside the
 * branch name the label displaces NOTHING, so the count has nothing left to
 * arbitrate — and the plan that relocated it requires the wave be reachable for
 * **every branch that has one**, not only for branches of plans divided more
 * than once.
 *
 * So the question becomes a property of the branch: *does this branch name a
 * wave?* One row, one fact, no plan-wide arithmetic — which is what makes the
 * label honest rather than merely shorter.
 *
 * ## `(unnamed)` is not a name
 *
 * The server writes `(unnamed)` for a branch of a plan with no `### `
 * sub-headings — the absence of a division, spelled. It was a legitimate value
 * while a count did the gating (a divided plan always names its parts, so the
 * string could only arrive by a scan bug), and it is not one now: with the
 * count gone, `(unnamed)` is what a single-wave plan's every branch carries,
 * and printing it beside a branch name would put a parenthesised non-answer on
 * the majority of rows on this board.
 *
 * Null for that, and null for a planless row (`wave: ''`) — a row built from
 * the PR map belongs to no plan and has no wave to name.
 *
 * The `waveCount` parameter is GONE rather than ignored. A parameter no arm
 * reads is a standing invitation to start reading it, which is how this gate
 * came to depend on a fact about the plan in the first place.
 *
 * `waveCountByPlan` went with it. It existed to feed this gate and had no other
 * reader — the plan row's own summary counts the waves in its OWN group
 * (`waveSummaryFor`), which is a statement about a plan and the place a count
 * belongs. An exported pure function with only a test to call it is dead code
 * wearing a contract.
 */
/**
 * The kinds whose ROW already links its wave in slot 4 — so the badge would
 * repeat it.
 *
 * Stated as a set beside `waveLabel` rather than inline at the call site,
 * because it has to agree with `tupleFromRow`'s arms: an `agent` links wave,
 * branch, worktree and plan; a `pr` and a `build` each link the wave between
 * their other artifacts. If an arm gains or loses the wave link, this is the one
 * place that has to follow — `build` was added one commit after `pr` and
 * `agent`, and the duplicate badge on `CI 283` is what said so.
 *
 * A `branch` row is deliberately NOT here — its artifact slot holds the plan and
 * the PR, so the badge is the only place its wave appears.
 */
/**
 * The worker states that outrank a PR in a wave row's status slot.
 *
 * Three of the eight, and the split is *is anybody on this now* rather than
 * *did a process run*. `finished`, `failed`, `ended`, `none` and `elsewhere` all
 * describe a run that is over or absent; a reader scanning for what needs them
 * is served by the PR's condition instead. Measured on this repo's board:
 * 4 rows carry `finished` and every one is a merged PR in DONE, where `delivered`
 * is the word that belongs.
 */
export const LIVE_WORKERS: ReadonlySet<AgentRow['worker']> =
  new Set(['running', 'waiting', 'stalled']);

export const WAVE_LINKING_KINDS: ReadonlySet<RowKind> = new Set(['agent', 'pr', 'build']);

export function waveLabel(row: AgentRow): string | null {
  if (row.wave === '' || row.wave === UNNAMED_WAVE) return null;
  return row.wave;
}

/**
 * What the server writes where a plan divides its work into no waves at all.
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
 * Seconds until the next refresh, given how many have passed and how many the
 * interval is — or null when the age is unknown.
 *
 * Clamped at zero: a poll can be late (a hidden tab, a slow response), and
 * "next in -2s" is not something a reader can act on.
 */
/**
 * What to tell an operator whose board just got smaller on a successful scan.
 *
 * NAMES WHAT VANISHED, and that is the whole reason the server sends identities
 * rather than counts. "3 plans became 2" makes the reader open a terminal to
 * find out which; the name lets them recognise the plan they delivered ninety
 * seconds ago — expected, ignorable — or fail to recognise it, which is the
 * defect and is worth their attention.
 *
 * BRANCHES ARE NAMED BEFORE PLANS when both are lost, because a lost branch is
 * the sharper signal: losing a plan file has an innocent explanation an operator
 * performs by hand, while a WORKING branch that disappears while its agent runs
 * has none.
 *
 * The list is capped and the remainder counted rather than truncated silently —
 * a banner that grows without bound stops being a banner, and "+4 more" is still
 * a number the reader can act on.
 */
export function shrinkNote(shrink: PulseShrink, ageSeconds: number): string {
  const parts: string[] = [];
  if (shrink.branches.length > 0) parts.push(nameList(shrink.branches, 'branch', 'branches'));
  if (shrink.plans.length > 0) parts.push(nameList(shrink.plans, 'plan', 'plans'));
  // Both empty cannot happen — the server returns null rather than an empty
  // shrink — but a banner rendering the word "undefined" over a healthy board
  // would be worse than the bug, so the honest fallback is spelled out.
  const lost = parts.length > 0 ? parts.join(' and ') : 'something it had a moment ago';
  return `This scan succeeded but describes less than the last one: ${lost} `
    + `disappeared in the last ${ageSeconds}s. The rows below are the NEW answer, `
    + `not a frozen one — they may be right, or the scan may have read a moving `
    + `working tree.`;
}

/** `a, b and 2 more branches` — at most three names, then a count. */
function nameList(names: string[], one: string, many: string): string {
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  const noun = names.length === 1 ? one : many;
  const tail = rest > 0 ? ` and ${rest} more` : '';
  return `${noun} ${shown.join(', ')}${tail}`;
}

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
 * Is this row a branch that never began — a name the plan wrote down, and
 * nothing else?
 *
 * The distinction NOT STARTED is built on, and the only one that decides
 * whether a row keeps its own line there. Measured on the live board: every
 * `state === 'open'` row in that section carried `pr=—` and `age=—`, because the
 * branch name came out of the plan's `## Branches` section and no branch was
 * ever created for it. Three such rows for one waiting plan said the same thing
 * three times.
 *
 * `state === 'deferred'` is the row this must NOT catch, and that exclusion is
 * the load-bearing half. A deferred branch WAS started — it may hold commits and
 * a PR — and it landed here because someone shelved it. `fleet.ts` records what
 * flattening it costs: an earlier version wrote `deferred` as the note, and *"a
 * branch started and then shelved read as never begun, with its age and its PR
 * erased."*
 *
 * Keyed on `state` rather than on `pr === null && ageMinutes === null`. Those
 * are SYMPTOMS of a branch that does not exist, and they are also true of a
 * branch that exists with no commits — a claim pushed as a bare ref. The state
 * is the server's own answer to the question, so this asks it rather than
 * inferring it from two empty cells.
 *
 * Exported for test: the deferred case is what a naive "group by plan" gets
 * wrong while passing every assertion about the unstarted ones.
 */
export function isUnbegun(row: Pick<AgentRow, 'group' | 'state'>): boolean {
  return row.group === 'not-started' && row.state === 'open';
}

/**
 * How long this PLAN has been waiting, in days — the clock that ticks in NOT
 * STARTED, read off the group's own rows.
 *
 * `waitingDays` dates the plan's `Approved:` record, so every row of one plan
 * carries the same number and any of them answers for the group. `Math.max`
 * rather than "the first one" only because a group can hold a deferred branch
 * beside unstarted ones and nothing forces the field onto both — taking the
 * largest keeps a recorded date from being lost behind a null.
 *
 * Null where NO row carries a date. Absent, not zero: `waitingLabel(0)` renders
 * `today`, which would claim a plan was approved this morning on the strength of
 * a field nobody filled in.
 *
 * Exported for test — the null case is the one an implementation reaching for
 * `?? 0` gets wrong while looking right on every dated plan.
 */
export function planWaitingDays(group: PlanGroup): number | null {
  const dated = group.rows.map((r) => r.waitingDays).filter((d): d is number => d !== null);
  return dated.length === 0 ? null : Math.max(...dated);
}

/**
 * Order NOT STARTED's plan groups: **oldest first, by the plan's own clock.**
 *
 * What it replaces, measured at `groupByPlan`: `Math.max(...rows.map((r) =>
 * r.ageMinutes ?? -1))`. In this section `ageMinutes` is `null` on every row —
 * the branches have no tip to date — so every group scored `-1`, the comparator
 * returned 0 for every pair, and the sort did nothing at all.
 * `plot-sprint-support`, approved 187 days ago, sat wherever the map's insertion
 * order happened to put it, beside a plan from that afternoon.
 *
 * **Oldest first, and the direction is the decision.** Sorting startable-first
 * reads as more actionable and buys less: the startable plans are already marked
 * by their own note, and burying a six-month-old plan under a fresh one hides
 * exactly the drift this section exists to surface.
 *
 * This is the GROUP order, and it is deliberately not the same question as
 * `compareWithinGroup` in `fleet.ts`, which orders the ROWS inside a group
 * newest-first on the reasoning that six months of availability is evidence
 * nobody wants a *branch*. That answers *which branch do I pick up*; this
 * answers *which plan has been ignored longest*, which is the question a reader
 * scanning section headings is asking. Two levels, two questions — and the
 * server's row order survives untouched inside each fold.
 *
 * An undated plan sorts LAST. It has no recorded approval, so it has no claim on
 * a position that means *this has been waiting*; `-1` would put it above a plan
 * approved today and assert a wait nobody measured.
 *
 * Exported for test: the old comparator scores every group here `-1`, so an
 * assertion that merely checks the groups came back in some order passes against
 * a sort that does nothing.
 */
export function sortByWaiting(groups: PlanGroup[]): PlanGroup[] {
  return [...groups].sort((a, b) => {
    const byWaiting = (planWaitingDays(b) ?? -1) - (planWaitingDays(a) ?? -1);
    if (byWaiting !== 0) return byWaiting;
    // TIES ARE BROKEN BY NAME, and that is what makes the list readable.
    //
    // Waiting days is a COARSE key: most plans in this section were approved on
    // the same day, so most comparisons return 0 and the surviving order is
    // whatever `groups` happened to arrive in. `Array.prototype.sort` is stable
    // in every engine since ES2019, so it faithfully preserves that arrival
    // order — and the arrival order is rebuilt from a fresh scan every four
    // seconds, from a Map whose insertion order follows the pulse. Stability
    // preserves an input that is not itself stable.
    //
    // Observed on the live board 2026-08-20: the NOT STARTED section reordered
    // on almost every pulse, which makes a list of a dozen plans unreadable —
    // the eye re-finds its place from scratch each time, and a row clicked at
    // the moment of a pulse can be a different row than the one aimed at.
    //
    // The plan NAME is the right tiebreak because it is the only field here
    // that cannot change between pulses: `planWaitingDays` moves at midnight,
    // row counts move as branches land, and both are derived. A name is the
    // plan's identity.
    return a.plan.localeCompare(b.plan);
  });
}

/**
 * What the plan row says about its waves, derived from the group's OWN rows.
 *
 * **No contract field carries this, and that is the point.** `waveSummary` on
 * the schema lives on the CARD; a fleet row knows only its own wave. But
 * `groupByPlan` already holds every row of this plan in this section, so
 * counting them and reading their notes answers *how many, and is the first one
 * startable* without adding a fact to the wire.
 *
 * Counted over the UNBEGUN rows only. A deferred branch keeps a row of its own
 * beneath the plan, with its own PR and age, so counting it into "3 waves" would
 * describe it twice and in the wrong terms — it is not a wave nobody has
 * reached, it is a branch somebody set down.
 *
 * **The limit is recorded rather than hidden: this counts what is in THIS
 * SECTION.** A plan whose first wave already merged has that wave in DONE, so it
 * reports the remainder — two where the plan file lists three. That is the
 * honest number for the question the section asks (*what is not started*), and a
 * reader wanting the full arc has the plan link on the row.
 *
 * `first eligible` comes from `isStartable`, which is the same predicate the row
 * menu uses to decide whether `Start work` is offered — so the summary cannot
 * promise an action the menu then refuses.
 *
 * Empty string where there is nothing to summarise, so the caller renders
 * nothing rather than a bare count of zero.
 *
 * Exported for test — the section-scoped count is the half that reads like a bug
 * until it is stated.
 */
export function waveSummaryFor(group: PlanGroup): string {
  const unbegun = group.rows.filter(isUnbegun);
  if (unbegun.length === 0) return '';
  // COUNTED IN WAVES, and it used to count ROWS while calling them waves. A
  // one-wave plan holding five branches reported `5 waves`; the plan file lists
  // one. The name of the unit was right and the number was of something else —
  // exactly the confusion this wave exists to end, and it was in the summary
  // whose job is to state the count.
  const count = groupByWave(unbegun).length;
  const waves = `${count} wave${count === 1 ? '' : 's'}`;
  return unbegun.some(isStartable) ? `${waves}, first eligible` : waves;
}

/**
 * Does this plan row earn an expander?
 *
 * Only where opening it REVEALS something. A plan with one branch beneath it
 * already shows that branch's name in its own summary line, so a control that
 * unfolds a single row the reader can already read is noise — the same rule
 * `showPlanHeading` applies one level up, where a heading over one row saves no
 * repetition.
 *
 * Counted over ALL the group's rows, not just the unbegun ones: a plan with one
 * unstarted wave and one deferred branch has two rows to show, and the deferred
 * one carries a PR and an age that appear nowhere else.
 *
 * Exported for test: the one-wave case is the one an implementation that always
 * renders the expander gets wrong while passing every assertion about folding.
 */
export function showsWaveFold(group: PlanGroup): boolean {
  // COUNTED IN WAVES, not in rows — since NOT STARTED renders one row per WAVE
  // rather than one per branch. A plan whose single wave holds five branches has
  // five rows and ONE child row, so the row count promised a fold that revealed
  // one line; and the wave's own fold is what discloses those five.
  //
  // Measured on the estate: `opus5-longhorizon-hardening :: Implementation`
  // holds five branches, and it is the plan this got wrong.
  return groupByWave(group.rows).length > 1;
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
 * READS THE FIELD, not the sentence. Until `waitingOn` existed this compared
 * `note === ELIGIBLE_NOTE` — the "parser for a format nobody declared" shape
 * #175 removed from the PR cell, and the one that fails SILENTLY: a reworded
 * note does not break the button, it makes it quietly stop appearing. The same
 * change that added the field also sharpened a neighbouring note (*blocked by
 * an earlier wave* gained the wave's name), which is exactly the drift this was
 * always one edit away from.
 *
 * `state === 'open'` is kept beside it: `waitingOn: 'click'` already implies it
 * server-side, and asserting it here costs nothing and documents that a row
 * with a ref is not a row to start.
 *
 * Never on `working` or `quiet` rows, which already have a branch and a claim:
 * offering to start one invites the double-dispatch `fleet-sees-merged-branches`
 * was written to prevent. `waitingOn` is null everywhere outside `not-started`,
 * so those rows are excluded by construction rather than by a group check that
 * could drift from the server's own answer.
 *
 * Exported for test — the negative (a blocked row gets nothing) is the half a
 * naive implementation gets wrong.
 */
export function isStartable(row: AgentRow): boolean {
  return row.waitingOn === 'click' && row.state === 'open';
}

/**
 * Does this row still need its BRIEF written before anyone can start it?
 *
 * `isStartable` above answers whether the wave ordering is satisfied. This
 * answers the other half a dispatch needs, and until the row carried `brief`
 * there was no way to ask it: the `Worker command` opens by telling the agent to
 * read `.plot/briefs/<slug>.md`, and `plot-dispatch.sh` reports `brief=missing`
 * unconditionally because it cannot write one — that is interpretation, and
 * `/plot-implement` owns it.
 *
 * Measured 2026-08-19: nine eligible rows on this board, zero briefs. Every one
 * read *eligible — nobody has taken it*, and every dispatch it invited would
 * have started an agent that reads a file which is not there.
 *
 * SCOPED TO THE STARTABLE ROW, and the scope is the point rather than an
 * economy. The brief is a precondition of STARTING, so the fact is worth a
 * reader's attention exactly where starting is the row's available move. A
 * blocked row has a wave to wait for first and a working row is past the
 * question — saying it there would be true and would spend the reader's
 * attention on something they cannot act on, which is what the tone rules in
 * `waitingTone` are protecting.
 *
 * `missing` ONLY — never `unknown`. A row whose brief could not be checked has
 * nothing to tell the reader, and *the board could not tell whether this has a
 * brief* on every row of a server that never looked would be noise standing in
 * for an answer. See `BriefStateSchema` for why the third value exists at all.
 *
 * READS THE FIELD, not the note — the standing rule this file states at
 * `isStartable` and a file scan enforces (`verdict-not-prose.test.ts`).
 */
export function needsBrief(row: AgentRow): boolean {
  return isStartable(row) && row.brief === 'missing';
}

/**
 * What a row with no brief SAYS — and what it deliberately does not say.
 *
 * *"eligible — nobody has taken it"* was reported by an operator for naming a
 * state and implying an action that does not work. The sharper half of the
 * complaint is the phrasing: *nobody has taken it* supplies the reason nobody
 * has taken it as if it were an accident of attention. It reads as an
 * invitation with a missing actor, when what is missing is a FILE.
 *
 * So this names the file and the thing that writes it. THE MISSING PIECE IS A
 * DOCUMENT, NOT A PERSON — and the distinction is not pedantry, it is the whole
 * difference between two jobs done by two different things: a worker takes a
 * branch, `/plot-implement` writes a brief. An operator told *nobody has taken
 * it* runs `/plot-dispatch`; an operator told this runs the thing that helps.
 *
 * IT NAMES THE COMMAND RATHER THAN OFFERING IT. Whether the board should offer
 * the brief-writing action is an Open Point the plan recorded and declined to
 * settle — running `/plot-implement` is a real write, and the board's line is
 * drawn at the acting endpoints it already has. Naming what to run is read-only
 * and answers the reader's question; a button would be a second decision, and
 * this row is not the place to take it unasked.
 *
 * The PATH is spelled out because it is the thing a reader can check and the
 * place `/plot-implement` will write. It is derived the same way the server
 * derives it — the branch name after its last `/` — and the two agree by
 * construction, both following the convention Plot itself writes.
 */
export function briefGapNote(branch: string): string {
  const slug = branch.split('/').pop() ?? branch;
  return `no brief at .plot/briefs/${slug}.md — /plot-implement writes it`;
}

/**
 * The note's colour, by what the row is waiting for.
 *
 * ONLY ONE OF THE THREE IS LOUD, and that is the whole design. `needs you` is
 * the state a person can end; the other two are stated, not shouted:
 *
 *   `you`    amber — a person must act, and nothing in git will change it
 *   `click`  the ordinary note colour — available, and taking it is optional
 *   `time`   dimmer still — nothing to do, ever, and the most common state in
 *            a multi-wave plan
 *
 * A section where every row is coloured has coloured nothing. Measured for
 * scale: this session's pulse held 43 rows, with multi-wave plans routinely
 * showing two blocked rows for every eligible one — so `time` is the state the
 * section is mostly made of, and making it quiet is what lets `you` read.
 *
 * COLOUR IS ADDED BESIDE THE WORDS, NEVER INSTEAD OF THEM. The notes already
 * say the right things and are simply invisible until read; this makes them
 * visible at distance. A reader with no colour perception loses nothing — the
 * sentence is the same one that is there today. The contract states the rule
 * for `pr.state` already: *carried as a symbol AND a word, never as colour
 * alone.*
 *
 * NOTHING ANIMATES HERE. `board-watches-for-stuck-branches` established that
 * motion marks an unanswered request — something waiting on you that will keep
 * waiting. A Draft plan minutes old is not that; it is the ordinary state of a
 * plan just written, and animating it would interrupt a reader about their own
 * work in progress. The escalation for a Draft that has sat for DAYS is
 * specified in the plan and deliberately not built: measured before approval,
 * 30 of this repo's 31 approved plans were approved the same day they were
 * drafted and one took a single day, so the state it would mark has never
 * occurred here. Choosing a threshold would mean inventing the first case it is
 * meant to measure, and a wrong one trains the reader to ignore the cue.
 *
 * Exported for test: the pairing that matters is that a `click` row and a row
 * outside the section are NOT distinguishable by colour — only `you` is.
 */
export function waitingTone(waitingOn: WaitingOn | null): string {
  switch (waitingOn) {
    case 'you':
      return 'text-amber-700 dark:text-amber-400';
    case 'time':
      return 'text-slate-400 dark:text-slate-600';
    default:
      // `click`, and every row outside NOT STARTED, keep the note's ordinary
      // colour. Giving `click` one of its own would make the section shout
      // twice and mean once.
      return 'text-slate-500 dark:text-slate-400';
  }
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
 * Is something actually being WRITTEN on this row, right now?
 *
 * **`local_locked || local_dirty`, and deliberately not `group === 'working'`.**
 * That is what `isLive` above answers, and the two questions are different
 * enough to need two marks: WORKING is an ADDRESS — a row sits there for hours
 * while an agent works, while an agent has crashed, or while it waits on a
 * human, and nothing measures the end. Six rows carried that claim during the
 * session that reported this. This is a PULSE: someone is writing, or has
 * written and not committed.
 *
 * `isLive` is untouched on purpose. The dot keeps meaning *in the WORKING
 * group*, this means *someone is writing here*, and no mark here is implemented
 * by modifying another — the standard `[data-change-mark]` set when it shipped
 * beside the dot rather than over it.
 *
 * **`localAhead` is NOT part of this, and its absence is the load-bearing
 * half.** Unpushed commits are finished work sitting STILL: a real condition
 * with a real remedy (push it) and no motion behind it. An implementation
 * OR-ing all three passes every positive assertion this wave makes and marks a
 * branch nobody has touched for hours as though someone were typing into it.
 * It earns a static mark of its own in a later wave; it does not earn this one.
 * (The field is not even forwarded onto the row, so the mistake cannot be made
 * absent-mindedly here.)
 *
 * **ABSENT IS NOT FALSE.** Both fields are `.default(false)` in the contract,
 * and a scan that could not observe a worktree reports absence rather than
 * cleanliness. So `false` here yields NO MARK — never a mark saying *idle*. The
 * strongest statement this predicate is licensed to make is *unknown, never
 * nobody*, which is why it only ever adds a marker and never renders one for
 * the negative case.
 *
 * Exported for test: the negative — a WORKING row with neither signal — is the
 * half an implementation that kept reading the group gets wrong.
 */
/**
 * LOCAL WRITE ACTIVITY OUTRANKS THE SECTION — which is why there is no
 * `showsActivity` predicate here any more.
 *
 * This file carried one from 2026-08-21 to 2026-08-22. It began as *WAITING ON
 * YOU never carries an activity mark*, reported from the live board: a plan
 * head and the wave beneath it pulsing while, it seemed, nothing was running.
 * It was then narrowed once, because 28 tests across two suites showed QUIET
 * and DONE need the mark most — *"QUIET's own purpose is 'go check whether this
 * died'"*.
 *
 * The premise was wrong, and measuring it is what showed that. On the pulse
 * that prompted the report, exactly one row in the whole fleet had a local
 * signal: `feature/a-wave-is-a-kind`, `localDirty: true` — the branch being
 * committed to at that moment — and the plan head that pulsed was ITS head. The
 * mark was telling the truth; the reader took a true statement for a false one
 * because the section it appeared in reads as *nothing is happening here*.
 *
 * The rule the operator stated, and the one that holds: *whichever worktree or
 * main dir is being written to, and whatever section the row is in, local write
 * activity always shows*. A signal that something is being WRITTEN is never
 * contradicted by where the row is filed — the section describes what the work
 * is waiting for, and writing is not waiting.
 *
 * So the question is asked of `isActive` alone, which reads the three local
 * fields and nothing else. `useActivity` no longer filters by group.
 */
export function isActive(
  row: Pick<AgentRow, 'worker' | 'pr' | 'state'>,
): boolean {
  // A MERGED BRANCH IS NOT ACTIVE, whatever is still running against it.
  //
  // Measured on screen: a row in DONE carrying the activity mark. Both halves
  // were individually true — `state: merged` and a local signal — and the row
  // said two things that cannot both be acted on. The mark says *work is
  // happening on this branch*, and after the merge there is no work on it left
  // to happen; `classify` sends merged branches to `done` before it looks at
  // any signal, and this predicate agrees with that rather than contradicting
  // it one layer up.
  if (row.state === 'merged') return false;
  // A PROCESS, AND ONLY A PROCESS — an agent working or a build running.
  //
  // This read `localLocked || localDirty` until 2026-08-22, and those are not
  // processes: they are a WORKTREE's contents. The distinction is what the
  // moving dot is for. A pulsing mark says *a machine is on this right now*,
  // and a person editing files is not a machine — measured on the live board,
  // the row for the branch being committed to pulsed continuously for hours
  // while nothing but a person typed in it.
  //
  // Two sources, matching the two kinds of machine this board knows:
  //
  //   - `worker` for AGENTS, bounded by `LIVE_WORKERS` — `running`, `waiting`,
  //     `stalled`. The other five (`finished`, `failed`, `ended`, `none`,
  //     `elsewhere`) describe a run that is over or absent, which is the split
  //     that set already states: *is anybody on this now*.
  //   - `pr.state === 'pending'` for BUILDS. That is CI running, the one PR
  //     state that describes a machine at work rather than a verdict it left
  //     behind.
  //
  // Uncommitted work is still visible and still worth seeing: it reaches the
  // reader as the row's NOTE and through `isUnpushed`'s own mark. What it no
  // longer does is claim a process is running.
  if (LIVE_WORKERS.has(row.worker)) return true;
  return row.pr?.state === 'pending';
}

/**
 * The four stuck states as WORDS, one apiece.
 *
 * FOUR LABELS, NOT ONE. *Stuck* as a single word is the one-label-many-states
 * defect the contract names, and here the four differ in the only way that
 * matters — what happens next. `artifact-conflict` and `conflict` in particular
 * are not degrees of one thing: the first has a resolution a rebuild and a CI
 * no-diff gate can prove without anyone reading a diff, and the second does not.
 * A reader who cannot tell them apart cannot tell which of the two errands is
 * theirs.
 *
 * A WORD, never a colour and never a mark. The repo's rule is *symbol AND
 * word*, and this is the word half: it is what a screen reader hears and what
 * survives a screenshot.
 *
 * Exported for test — a single shared label passes any assertion that only
 * checks "the row says something".
 */
export function stuckWord(state: StuckState): string {
  switch (state) {
    case 'artifact-conflict': return 'artifact conflict';
    case 'conflict': return 'conflict';
    case 'ci-failing': return 'CI failed';
    case 'unpushed': return 'unpushed work';
    // TWO PLANS, not two branches — and the word says which kind of collision it
    // is, because `conflict` above is already taken by the other one.
    case 'double-claimed': return 'claimed twice';
    // NOT "too many branches": the count is the symptom, the missing SLICE is
    // the defect. A wave is meant to be carried out in one branch and one
    // worktree, and this plan was never sliced after its spike.
    case 'unsliced-wave': return 'wave not sliced';
  }
}

/**
 * The EVIDENCE that produced the state, as the lines the row prints beside it.
 *
 * The contract states the rule this exists to honour, and it is easy to violate
 * while looking correct: *EVIDENCE TRAVELS WITH THE STATE, always. A row that
 * says* stuck *and makes the reader go find out why has moved the ten minutes of
 * log-reading rather than removed it.* A row that only names its state passes
 * every "is the state visible" assertion and pays off none of the cost this
 * detection exists to remove.
 *
 * **`ci-failing` gets TWO LINES, and it got three until 2026-08-20.** The third
 * was the branch's changed-path list, and it is not deleted — it moved into the
 * menu ({@link offersChangedFiles}). What is left is what the reader ACTS on:
 * which step failed, and how the branch has fared lately. Nothing here compares
 * them and nothing concludes from them — a heuristic mapping failing steps to
 * changed paths was explicitly rejected as a table nobody maintains, which goes
 * silently wrong the first time a workflow is restructured. The reader combines
 * them; this only sets them down.
 *
 * **Why the third line left, when the comment above used to defend it.** It was
 * right that the fact belongs on a failing row and wrong about *how much of the
 * row* it may take. Measured on `#266`: six paths, wrapped, as prose — so every
 * reader scrolled past a paragraph so that the one reader who wanted it did not
 * have to click. The three facts are not equal in cost. A step name is four
 * words and often ends the investigation; a path list is unbounded and is
 * consulted rarely. EVIDENCE TRAVELS WITH THE STATE is honoured by the evidence
 * being *reachable from the row*, not by all of it being *printed in* the row —
 * and the menu is one click, on the same pulse, with no fetch.
 *
 * **The run time is an AGE, never the instant.** The host reports ISO 8601 and
 * the contract keeps it verbatim, which is right for a contract and wrong for a
 * row: `2026-08-20T03:55:23Z` makes a reader do date arithmetic to answer *is
 * this fresh*, which is the only question they asked. `agoLabel` is the board's
 * one age dialect and this uses it rather than growing a second — the same
 * reason `ageLabel` was split out of `age`. `now` is a parameter, not a clock
 * read, so a test can assert the wording without racing it.
 *
 * **An empty evidence field says so rather than vanishing.** `failingChecks: []`
 * means *no names available* — an older adapter, or a host carrying no rollup —
 * never *nothing failed*, and `runHistory: []` means Bitbucket has no run
 * listing, never *this branch has never failed before*. Silence there would be
 * the row asserting a fact it was never given. The changed-path line carries no
 * such placeholder, and that is not an inconsistency: its absence from the row
 * is now the DESIGN rather than a missing fact, so *changed paths unavailable*
 * would be prose of the same width making a weaker — and, where the menu holds
 * them, false — statement.
 *
 * Exported for test: the pairing that matters is a row that names its state
 * WITHOUT its evidence, which every state-only implementation renders correctly.
 */
export function stuckEvidence(stuck: Stuck, now: number = Date.now()): string[] {
  switch (stuck.state) {
    case 'artifact-conflict':
    case 'conflict':
      // The set travels with the answer so a reader can COUNT it rather than
      // trust the classification — *exactly the artifact* is a claim about a
      // set, and this is the set. An empty one is the host's own verdict with
      // no set behind it (see `stuckState`), which is a real and different
      // thing to say.
      return stuck.conflicts.length > 0
        ? [`conflicting: ${stuck.conflicts.join(', ')}`]
        : ['the host reports this branch does not merge — no file list available'];
    case 'unsliced-wave':
      // NAMES THE BRANCHES, because repairing this means slicing the wave into
      // one per branch and the reader has to see which are entangled. The
      // sentence says what a wave IS rather than merely that the count is wrong,
      // since the count is the symptom: `plan → * wave → 1 branch`.
      return stuck.waveSiblings.length > 0
        ? [`one wave, ${stuck.waveSiblings.length} branches: ${stuck.waveSiblings.join(', ')}`
           + ' — a wave is carried out in one branch, so this plan needs slicing']
        : ['this wave holds several branches — a wave is carried out in one'];
    case 'double-claimed':
      // NAMES THE PLANS, because resolving this means editing one of them — the
      // same reason `shrinkNote` names what vanished rather than counting it.
      // Nothing here is a verdict about which plan is right: that is the
      // judgement a person makes, and the row's job is to put both names in
      // front of them.
      // The NAMES where they are known, and the bare fact otherwise — the same
      // shape the conflict arm above uses for an empty set: an unnamed collision
      // is still a collision, and printing `claimed by 0 plans` would be the row
      // stating a count it does not have.
      return stuck.claimedBy.length > 0
        ? [`claimed by ${stuck.claimedBy.length} plans: ${stuck.claimedBy.join(', ')}`]
        : ['more than one plan claims this branch — the plans do not agree'];
    case 'ci-failing':
      return [
        stuck.failingChecks.length > 0
          ? `step: ${stuck.failingChecks.join(', ')}`
          : 'failing step unavailable',
        // The changed-path line USED TO BE HERE and is now in the menu. See the
        // doc comment: the fact stayed, its home changed, and no placeholder
        // took its place in the row.
        stuck.runHistory.length > 0
          ? `recent runs: ${stuck.runHistory
              .map((r) => {
                // The age, or nothing — never the instant, and never
                // `Invalid Date`. `agoLabel` returns null on a timestamp it
                // cannot parse, and an unreadable time omits exactly like every
                // other unrecognised field while the CONCLUSION, which the host
                // did give, still reports.
                const ago = r.startedAt ? agoLabel(r.startedAt, now) : null;
                return `${r.conclusion || 'unknown'}${ago ? ` ${ago}` : ''}`;
              })
              .join(', ')}`
          : 'run history unavailable',
      ];
    case 'unpushed':
      // The count IS the evidence, and it is the whole of it: `local_ahead` is
      // true only on the machine doing the looking, so there is nothing else
      // anyone else could check.
      return [
        `${stuck.localAhead} commit${stuck.localAhead === 1 ? '' : 's'} only this machine can see`,
      ];
  }
}

/**
 * Does this row's failure have a changed-file list to SHOW — the third evidence
 * line, in its new home.
 *
 * **The list did not disappear, it stopped being printed.** {@link stuckEvidence}
 * carried it in the row until 2026-08-20, where `#266` measured it as six paths
 * wrapped across the width as prose: a paragraph every reader scrolled past so
 * that the occasional reader who wanted it did not have to click. Behind the
 * menu it costs one click and no column.
 *
 * **`ci-failing` ONLY, and the state test is not redundant.** `changedPaths` is
 * populated on that state alone — the other three get `[]` from `noCiEvidence`
 * by construction — so a predicate reading the array alone is correct today and
 * wrong the first time a conflict row gains one. The list is evidence *about a
 * failing check*; on a conflict row the file set that matters is `conflicts`,
 * which the row already prints.
 *
 * **`[]` yields NO item.** An empty list means *no paths available* — an older
 * adapter, or a host carrying none — never *this branch changes nothing*. An
 * item opening onto an empty list is the empty menu this board keeps removing,
 * and unlike the row's evidence lines a menu item cannot say *unavailable*
 * usefully: a reader would spend the click to learn there was nothing to learn.
 *
 * **No fetch, ever.** The paths are already on the row, on the pulse that drew
 * it. The plan is explicit that a per-click fetch would put a second cost on a
 * data path whose scan went from 279 s to 20 s for one reader's convenience.
 *
 * Exported for test: the negatives — an empty list, and a non-CI state carrying
 * paths — are what a predicate keyed on the array alone gets wrong, and both
 * pass every positive assertion.
 */
export function offersChangedFiles(stuck: Stuck | null | undefined): boolean {
  return stuck?.state === 'ci-failing' && stuck.changedPaths.length > 0;
}

/**
 * What the changed-files menu item SAYS — a count, never the list.
 *
 * The item is one line in a menu, so it says how MANY and the panel it opens
 * says which. A label that listed the paths would put the dump back one click
 * away rather than removing it, which is the whole of what this branch does.
 *
 * The count is also the fact a reader uses to decide whether to click at all:
 * *1 file* and *34 files* are different situations, and the second is worth
 * knowing before opening it.
 *
 * Exported for test — the singular is where a template string goes wrong, and
 * "1 files" is invisible in a screenshot of a row that has six.
 */
export function changedFilesLabel(count: number): string {
  return `Changed ${count} file${count === 1 ? '' : 's'}`;
}

/**
 * Does this stuck state OFFER an action on the row?
 *
 * Two of the four do, and the two that do not are the load-bearing half — a cue
 * on every row makes the stuck ones invisible.
 *
 * **`unpushed` offers nothing, ever.** The fix is a push, and pushing someone
 * else's uncommitted judgement is not a mechanical act. It is reported in words
 * and that is the entire treatment.
 *
 * **`artifact-conflict` offers nothing IN THIS WAVE.** Wave 3 resolves it — the
 * only automatic write this plan ever grants — and until that exists the state
 * is reported like any other, with no action. Offering one here would be this
 * wave building the thing it is fenced away from.
 *
 * Exported for test: the two negatives are what a blanket "stuck rows get a
 * button" implementation gets wrong, and both pass every positive assertion.
 */
export function offersAction(state: StuckState): boolean {
  return state === 'conflict' || state === 'ci-failing';
}

/**
 * Is an action ACTUALLY reachable on this row — not merely usual for its state?
 *
 * **`offersAction` answers about the state; this answers about the row.** The
 * distinction is not pedantic, and a screenshot found it: `conflict` is a state
 * that offers an action, but the row has nothing to offer when it has no card
 * or the board has not said whether it will act. The cue rendered anyway, so an
 * animated dot sat pointing at a sentence saying nothing could be asked.
 *
 * Since the actions moved into the menu (`one-place-for-what-a-row-can-do`) the
 * same question decides whether the MENU holds a stuck row's item, so this is
 * now asked in two places and must keep giving one answer. A cue pointing at a
 * menu without the item is the same defect in its second form.
 *
 * That breaks the rule the cue exists under: **motion marks an unanswered
 * request, and where nothing can be asked there is no request.** It is the same
 * reasoning that keeps `unpushed` and `artifact-conflict` still — this is simply
 * a third way an action can be absent, and unlike those two it depends on the
 * row rather than on the state, which is why the state alone could not see it.
 *
 * A refusal is NOT an absence, and the difference decides the two arms below. A
 * `conflict` row over a non-localhost binding has a card and a dispatch verdict
 * — `StartWorkButton` renders, disabled, and NAMES the reason — so the request
 * is real, still unanswered, and still yours to answer from another machine.
 * Hiding the cue there would let a phone report a healthy fleet while branches
 * sit stuck. Absent means there is nothing to click at all.
 *
 * Exported for test: an implementation keyed on the state alone passes every
 * assertion about a normal stuck row and animates at a dead end.
 */
export function actionReachable(
  stuck: Pick<Stuck, 'state' | 'runHistory'>,
  card: Card | null,
  dispatch?: DispatchInfo,
): boolean {
  if (!offersAction(stuck.state)) return false;
  // `ci-failing` offers a LINK, and an absent URL is a real answer (Bitbucket
  // has no run listing) that the row states in words. No address, no
  // navigation, nothing to ask.
  if (stuck.state === 'ci-failing') return stuck.runHistory.some((r) => r.url);
  // `conflict` dispatches through the guarded route, which needs a card to name
  // the plan and a dispatch verdict to say whether the server will act. Without
  // either the row says so instead of rendering a control.
  return Boolean(card && dispatch);
}

/**
 * Does this row wear the animated cue?
 *
 * **Only where an action is OFFERED, and only until it is TAKEN.** Both bounds
 * are the plan's, and each removes a way the cue becomes wallpaper.
 *
 * The first: motion here marks an UNANSWERED REQUEST, not a state. A branch with
 * nothing to offer has made no request, so it gets no motion — which is why
 * `unpushed` is reported in words and `artifact-conflict` (this wave) is too.
 *
 * The second: **it stops when the action is taken, not when the branch
 * unsticks.** The request has been answered; whether the answer worked is what
 * the row's other marks report. A cue tied to the branch's own recovery would
 * keep moving through the whole repair — the reader having already done the one
 * thing it was asking for.
 *
 * This is also the one place on this board where motion is right, and the reason
 * is recorded because a neighbouring wave settled the opposite: *a thing true
 * for hours has less claim on motion than a thing true for three seconds*, which
 * is why the activity mark is static. A stuck branch is neither — it is true
 * UNTIL SOMEONE ACTS, and the acting is the point.
 *
 * **The first bound is about the ROW, not the state**, and a screenshot is what
 * settled it. This used to read `offersAction(state)`, which is the state's
 * usual behaviour rather than this row's actual one — so a `conflict` row whose
 * action had fallen back to *no dispatch available for this plan* wore an
 * animated dot pointing at a sentence saying nothing could be asked. See
 * {@link actionReachable}: where nothing can be asked, no request was made.
 *
 * Exported for test: a cue that survives the click passes every "the cue
 * animates" assertion, and one keyed on the state alone passes every assertion
 * about a row whose action is present.
 */
export function showsCue(reachable: boolean, actionTaken: boolean): boolean {
  return reachable && !actionTaken;
}

/**
 * What the row says about the one repair this system performs by itself.
 *
 * **EVERY REPAIR IS REPORTED — running, pushed, or abandoned.** A silent
 * automatic write is indistinguishable from a defect, which is the failure mode
 * the whole stuck-branch plan exists to remove, and it is the one that would
 * arrive here: the branch stays `artifact-conflict` for the entire repair
 * (nothing about the refs changes until the push lands), so a row that only
 * showed `stuck` would sit unchanged for five minutes while a machine wrote to
 * the branch. Indistinguishable, from the outside, from the pulse ignoring it.
 *
 * **The failures are reported as loudly as the success.** `abandoned` is the
 * repair's own gate stopping it — a failed rebuild, a red `test:board`, a
 * rejected push — and it means nothing was pushed and this conflict is now a
 * human's. A word that only appeared on success would be quietest exactly when a
 * reader most needs it.
 *
 * "" for a branch nothing was attempted on, which renders as nothing at all.
 *
 * Exported for test: an implementation that reports only `pushed` passes every
 * assertion that a successful repair is visible.
 */
export function repairWord(repair: Repair | null | undefined): string {
  if (!repair) return '';
  if (repair.state === 'running') return 'repairing — merge, rebuild, test:board';
  switch (repair.outcome) {
    case 'pushed':
      return 'repaired automatically — rebuilt and pushed after test:board passed';
    case 'abandoned':
      // The reason is the script's own word, and it is carried rather than
      // translated: `tests-failed` and `build-failed` end in the same place for
      // the reader (nothing was pushed) and in different places for whoever
      // opens the log.
      return `repair abandoned${repair.reason ? ` — ${repair.reason}` : ''}; nothing was pushed`;
    case 'refused':
      return `repair refused${repair.reason ? ` — ${repair.reason}` : ''}`;
    default:
      return 'repair finished';
  }
}

/**
 * How long a SEEN lock keeps the activity marker after the pulse that reported
 * it.
 *
 * **Six seconds, and the measurement decides it.** `.git/index.lock` exists for
 * a fraction of a second to a few seconds — one commit, one rebase step — while
 * `FLEET_POLL_MS` is 4 s. So most locks are born and die BETWEEN two pulses and
 * are never seen at all: the sharpest signal this board has is the one it most
 * often misses, and rendering it only for the instant it is observed would
 * render it almost never.
 *
 * Longer than one poll interval, so a lock seen in one pulse survives the next
 * one — which is the entire point, and the assertion a 3 s value would fail
 * against a 4 s clock. Short enough that it plainly reads as a marker rather
 * than as a state: two lockless pulses (8 s) always clear it.
 *
 * Not the same constant as `CHANGE_MARK_MS`, and not merged with it. That one
 * is calibrated against the 60 s PR refresh for a rare transition; this one is
 * calibrated against the 4 s fleet pulse for a signal that expires on its own.
 * One number serving two clocks is how a value gets tuned for one and silently
 * wrong for the other.
 */
export const LOCK_ECHO_MS = 6_000;

/**
 * The rows whose lock was seen recently enough to still be worth showing.
 *
 * **This is the one place this board lets a marker outlive its fact, and it is
 * bounded by three rules the plan settled — none of them optional:**
 *
 * *It never contradicts a later observation.* The echo only ever ADDS a row to
 * the marked set. A pulse reporting `localDirty` marks for its own reason and
 * needs no echo; a pulse reporting neither lets the echo expire on its own
 * clock and does not extend it. The row's NOTE is untouched throughout and goes
 * on reporting whatever the last pulse actually found — the echo makes a real
 * event visible, it never makes a claim the note would contradict.
 *
 * *A lock never resurrects.* The echo starts only where a lock was SEEN
 * (`localLocked` true in some pulse), never where one is inferred from dirt, an
 * age, or a group. Two lockless pulses therefore produce nothing at all: there
 * is no lock to echo, and inventing one would be the board asserting an event
 * it never observed.
 *
 * *It is a marker, not a state.* Each key clears itself on its own timer rather
 * than waiting for a pulse to clear it — the rule `ChangeMarks` already
 * follows, and what keeps a board whose server has died from sitting lit
 * forever. A frozen page shows its echoes expire and then shows nothing, which
 * is the honest end.
 *
 * Split out and driven by an injected clock for the same reason `ChangeMarks`
 * is: at the board's own rates the echo is invisible to a browser test —
 * `FLEET_POLL_MS` is 4 s, so an assertion "the marker survived a lockless
 * pulse" is really watching a timer that has not expired yet and passes just as
 * happily with the echo removed. Driven by hand, the rule is exact.
 */
export class ActivityEcho {
  private readonly timers = new Map<string, () => void>();
  private readonly lit = new Set<string>();

  constructor(
    private readonly onChange: (lit: ReadonlySet<string>) => void,
    private readonly schedule: (fn: () => void, ms: number) => () => void =
      (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
  ) {}

  /**
   * Record this pulse: every row seen holding a lock starts (or restarts) its
   * echo.
   *
   * **Restarted, not extended and not ignored** — the same rule `ChangeMarks`
   * documents. A lock still held on the next pulse is a longer write, not a
   * finished one, so the echo runs a full span from the latest sighting.
   *
   * Rows NOT holding a lock are left entirely alone: their echo, if any, keeps
   * running down its own clock. That is the "never extends, never contradicts"
   * half — this method is only ever told what was seen, never what was absent.
   */
  seen(locked: Iterable<string>): void {
    let touched = false;
    for (const key of locked) {
      touched = true;
      // Cancel first: the pending timeout belongs to the PREVIOUS sighting and
      // would otherwise take this one's echo with it when it fires.
      this.timers.get(key)?.();
      this.lit.add(key);
      this.timers.set(key, this.schedule(() => {
        this.timers.delete(key);
        this.lit.delete(key);
        this.onChange(new Set(this.lit));
      }, LOCK_ECHO_MS));
    }
    if (touched) this.onChange(new Set(this.lit));
  }

  /** Which rows are currently echoing a lock. */
  get echoing(): ReadonlySet<string> {
    return this.lit;
  }

  /** Drop every pending timer — the component is going away. */
  dispose(): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
    this.lit.clear();
  }
}

/**
 * Which rows wear the activity marker: those active in THIS pulse, plus those
 * still echoing a lock seen in a recent one.
 *
 * A union, and the direction matters: the echo only ever adds. A row reporting
 * `localDirty` right now is marked for its own reason whether or not it ever
 * held a lock, and a row reporting nothing at all is marked only for as long as
 * a lock it was actually seen holding is still echoing.
 *
 * Exported for test — it is the whole rendering rule, and vitest runs with
 * `environment: 'node'`.
 */
export function activeRowKeys(
  rows: readonly AgentRow[],
  echoing: ReadonlySet<string>,
): Set<string> {
  const active = new Set<string>();
  for (const row of rows) {
    const key = rowKey(row);
    if (isActive(row) || echoing.has(key)) active.add(key);
  }
  return active;
}

/**
 * How long a changed row wears its marker.
 *
 * **Three seconds, and the measurement decides it — not taste.** The value this
 * watches comes from the host's PR refresh (`PR_REFRESH_MS`, 60 s), not from the
 * 4 s fleet pulse, and `PR_BACKOFF_MAX_MS` pushes it to 120 s under a rate
 * limit. So a transition can surface at most once a minute and often less: it is
 * a RARE event, and a 300 ms flash — calibrated for something frequent enough
 * that missing one hardly matters — would be missed nearly every time.
 *
 * Three seconds is long enough to catch a reader glancing back and short enough
 * that it plainly reads as a marker rather than as a state. Deliberately NOT
 * "until the next pulse": that would tie the marker's life to whichever clock
 * cleared it (4 s or 60 s), and would leave it lit forever on a board whose
 * server died — which is exactly when nothing is changing.
 */
export const CHANGE_MARK_MS = 3_000;

/**
 * The identity a row is remembered by, across pulses AND across sections.
 *
 * `${repo}/${branch}/${plan}`. Keyed on IDENTITY rather than on position on
 * purpose: `pr.state` helps decide the group (`conflicts` sends a row to
 * WAITING ON YOU, CI running to WAITING ON A MACHINE), so the changes worth
 * marking are frequently the ones that MOVE the row — and a position-keyed
 * memory loses the prior value in exactly that case.
 *
 * **THE PLAN IS PART OF THE IDENTITY, and leaving it out made the board
 * flash.** Two plans can name one branch — a real state, which the estate
 * reaches whenever work is handed from one plan to another and the giving plan
 * has not yet dropped the name. The board then renders TWO ROWS for that
 * branch, one under each plan, and on `${repo}/${branch}` they shared a memory:
 * each pulse one row overwrote the other's remembered facts, the detector saw a
 * difference that was never a change, and the mark lit — for hours, on a branch
 * nobody had touched.
 *
 * That failure is written up in `stuck.ts`, where `double-claimed` was added to
 * NAME the collision. Naming it did not stop the flashing, because the shared
 * key is what causes it and the state is only its symptom: reported again on
 * 2026-08-22 with `bug/one-row-one-truncation-rule` flashing under both
 * `a-mock-row-shows-what-the-tuple-still-gets-wrong` and `the-row-is-legible`.
 *
 * Adding the plan is safe for the property the first paragraph protects. A row
 * moving between sections keeps its plan — the group is derived from state, CI
 * and age, none of which touch `plan` — so the memory still survives exactly
 * the moves it was built to survive. What it no longer survives is a branch
 * changing plans, which is not a move: it is a different row.
 *
 * `?? ''` because a row can legitimately have no plan (an unplanned branch, a
 * release branch), and those must keep ONE stable key rather than one per
 * absent value.
 */
export function rowKey(row: Pick<AgentRow, 'repo' | 'branch' | 'plan'>): string {
  return `${row.repo}/${row.branch}/${row.plan ?? ''}`;
}

/** The six PR states plus *no PR*, as one value — the row's PR slot. */
export type WatchedPrState = NonNullable<AgentRow['pr']>['state'] | null;

/**
 * Every OBSERVED fact on a row, and no DERIVED TIME.
 *
 * **The boundary is the feature, not a caveat.** The request was *highlight the
 * whole line on every written update*, and a literal reading of "everything
 * visible" flashes a completely idle row once a minute: the note on a WORKING
 * row reads *"last commit 1 min ago"* and `ageMinutes` ticks beneath it, so
 * `1 min ago → 2 min ago` would be an "update". After an hour at the board every
 * row would have flashed sixty times and the marker would mean nothing.
 *
 * So the line is drawn where the contract already draws it:
 *
 * | Watched | Not watched | Because |
 * |---|---|---|
 * | `pr` (state, number, draft) | `ageMinutes` | derived from a timestamp and a clock |
 * | `localDirty`, `localLocked` | `waitingDays` | a SECOND clock, per its own doc |
 * | `localAhead` | `note` | it EMBEDS a clock — see below |
 * | `state`, `group`, `wave`, `phase` | | |
 * | `stuck` | | |
 *
 * **A fact changes because the world changed; a clock changes because time
 * passed**, and only the first is news.
 *
 * **`note` is excluded despite being server-observed**, and it is the trap this
 * whole rule exists to avoid. It is a sentence assembled around the ages —
 * *"last commit 18 min ago"* — so an implementation watching the row's rendered
 * note passes every positive assertion (a new commit really does rewrite it) and
 * flashes every row once a minute. Provenance is not sufficient here; what the
 * value is MADE OF decides.
 *
 * A new commit still flashes, which is the reported gap: the tip moving changes
 * `state`/`group`/`localAhead` — facts — even though the sentence beside them
 * changed for a clock's reason.
 */
export interface WatchedState {
  /** null where the row carries no PR at all — a value, not a gap. */
  pr: WatchedPrState;
  prNumber: number | null;
  prDraft: boolean | null;
  state: AgentRow['state'];
  group: AgentRow['group'];
  wave: string;
  phase: AgentRow['phase'];
  localDirty: boolean;
  localLocked: boolean;
  localAhead: number;
  /** Serialised, because `stuck` is an object and this map is compared by value. */
  stuck: string | null;
}

/**
 * The value each row is watched by.
 *
 * `pr` is `.nullable().default(null)` and MOST rows carry none — `not-started`,
 * `quiet`, and every fresh claim — so this reads through an optional chain
 * rather than `row.pr.state`, which crashes on precisely those rows.
 *
 * *No PR* is a value, not a gap: `null → pending` is a PR opening, often the
 * most interesting transition a branch has, and `pending → null` is one merged
 * or closed out from under the row. Both are the watched value changing, which
 * keeps the rule single instead of adding an exception about which changes
 * count.
 *
 * `stuck` is serialised rather than held as an object because the comparison
 * downstream is by value: two structurally equal `stuck` objects arrive as
 * different references on every pulse, and a reference test would flash every
 * stuck row four times a second.
 */
export function watchedState(row: AgentRow): WatchedState {
  // EVERY OBSERVED FACT, AND WRITING AMONG THEM.
  //
  // The three local fields are what make a WRITE an event here: the master
  // agent editing in the project directory, or a worker in its own worktree,
  // moves `localDirty`/`localLocked` and the row flashes. They sit beside the
  // host's facts rather than replacing them — a PR turning red, a row moving
  // section and a phase advancing are all changes worth a glance, and the flash
  // is the one mark that says *this row is not what it was*.
  //
  // The moving DOT is the mark that narrowed instead: it answers *is a process
  // running*, and its pace answers *is that process doing anything*. Two marks,
  // two questions — the flash reports history, the dot reports machines.
  return {
    pr: row.pr?.state ?? null,
    prNumber: row.pr?.number ?? null,
    prDraft: row.pr?.draft ?? null,
    state: row.state,
    group: row.group,
    wave: row.wave,
    phase: row.phase,
    localDirty: row.localDirty,
    localLocked: row.localLocked,
    localAhead: row.localAhead,
    stuck: row.stuck === null ? null : JSON.stringify(row.stuck),
  };
}


/**
 * Which rows changed since the last pulse, and what to remember for the next.
 *
 * Pure, and exported for test, because this is the whole rule: vitest runs with
 * `environment: 'node'`, so the decision lives here as a function over (prior,
 * current) and the browser tests are left to assert only what genuinely needs a
 * page.
 *
 * **`prior` distinguishes a MISSING key from a stored `null`, and the two mean
 * opposite things:**
 *
 * | `prior` holds | Means | This pulse |
 * |---|---|---|
 * | *(no entry)* | never observed this row | record silently |
 * | `null` | observed, and it had no PR | a move away from `null` marks |
 * | a state | observed, with that state | a different state marks |
 *
 * Collapsing the first two is the tempting simplification and it is wrong in a
 * way that hides itself: it passes the first-pulse assertion (nothing marks on
 * a fresh mount) and silences every branch's FIRST PR forever, because *never
 * seen* and *seen with no PR* would be indistinguishable. Hence a `Map` read
 * with `.has()` rather than a truthiness test.
 *
 * The first pulse after a load, a restart or a reconnect therefore marks
 * nothing: *unknown → conflicts* is a first sighting, not a transition, and
 * treating it as one would flash every row on every reload — the loudest
 * possible way to be wrong. A row that vanishes and returns starts silent for
 * the same reason.
 *
 * Every changed row is returned, with no threshold and no suppression: if ten
 * rows really did change, ten marks are the honest report, and a rule that goes
 * quiet exactly when the most changed would make the board least informative at
 * its most eventful moment.
 *
 * Rows ABSENT from this pulse are dropped from the returned memory rather than
 * carried: the map is one value deep per visible row, not a log.
 *
 * **`unknown` is not a transition, in either direction, and it is not
 * remembered.** See `isUnreadable`: it is a fact about the OBSERVATION, and
 * this function reports changes in the WORLD.
 */
export function changedRows(
  prior: ReadonlyMap<string, WatchedState>,
  rows: readonly AgentRow[],
): { changed: Set<string>; next: Map<string, WatchedState> } {
  const changed = new Set<string>();
  const next = new Map<string, WatchedState>();
  for (const row of rows) {
    const key = rowKey(row);
    const was = prior.get(key) ?? null;
    // An unreadable PR slot carries the LAST KNOWN value forward rather than
    // storing `unknown`, and that is what makes the suppression symmetric with
    // a single rule instead of two. Storing `unknown` would silence the
    // outage's first pulse and then flash on the recovery — or, worse, lose a
    // real change that happened during the outage: `green → unknown → failing`
    // must still flash, and it only can if the memory still holds `green` when
    // `failing` arrives. What is skipped is the moment, never the fact.
    //
    // **Per SLOT, not per row**, and that is what widening the watched value
    // forces: a GitHub 503 makes the PR unreadable and says nothing whatever
    // about whether a worktree is dirty. Freezing the whole record for the
    // outage's duration would suppress a real local change for a remote host's
    // reason — the marker going quiet exactly while an agent writes.
    const now = carryUnreadable(watchedState(row), was);
    // `.has()`, never a truthiness test — a stored value with a `null` PR is
    // KNOWN and an absent key is not, and the two are indistinguishable to one.
    if (prior.has(key) && !sameWatched(was!, now)) changed.add(key);
    next.set(key, now);
  }
  return { changed, next };
}

/**
 * The watched value with any UNREADABLE slot replaced by the last known one.
 *
 * Only `pr` can be unreadable: it is the sole watched fact with an `unknown`
 * value, because it is the sole one that comes from a remote host that can fail
 * to answer. Every other watched fact is observed by the local scan, which
 * either ran or did not — there is no third answer to carry across.
 *
 * **With NO prior value there is nothing to carry, and this is the case the
 * widening makes newly interesting.** Under the old scalar rule such a row was
 * not recorded at all: its only watched value was unreadable, so there was
 * nothing to remember. Now it carries nine other facts worth remembering, so it
 * IS recorded — and the question is what its PR slot should hold meanwhile.
 *
 * **DECIDED: it holds `unknown`, and `sameWatched` treats `unknown` as not
 * comparable rather than as a value.**
 *
 * The three answers to *what should the slot hold* are the same three this
 * repo keeps distinguishing, one field along: `null` means OBSERVED AND THERE
 * IS NO PR, a state means observed with that state, and `unknown` means I
 * COULD NOT ASK. Storing anything else here would invent an observation the
 * board never made — and a sentinel chosen to compare as *different* would
 * flash the host's recovery, which is news about GitHub rather than about the
 * branch.
 *
 * So the memory is honest and the COMPARISON carries the rule: an `unknown` on
 * either side answers neither *same* nor *changed*, because it is the absence
 * of an answer. That is exactly what the paragraph above already promises for
 * the carried case — *what is skipped is the moment, never the fact* — applied
 * to the one case that has no fact to carry yet.
 *
 * The stated cost: a row whose PR was never once readable does not flash on the
 * first state it is finally seen in. `prNumber` covers most of it — `null` to a
 * number IS a change and does flash — and the residue (a PR readable only from
 * its second state onward) is a moment lost about a host that was down, which
 * is the cheaper of the two errors.
 */
function carryUnreadable(now: WatchedState, was: WatchedState | null): WatchedState {
  if (!isUnreadable(now.pr) || was === null) return now;
  return { ...now, pr: was.pr, prNumber: was.prNumber, prDraft: was.prDraft };
}

/**
 * Whether two watched values describe the same world.
 *
 * By VALUE, field by field. The record is rebuilt from the row on every pulse,
 * so a reference test would call every row changed four times a second — and
 * `stuck` arrives as a fresh object each time, which is why `watchedState`
 * serialises it rather than leaving an object to be compared here.
 *
 * Exported for test: it is half the rule, and the half that decides whether a
 * ticking clock is news.
 */
export function sameWatched(a: WatchedState, b: WatchedState): boolean {
  // `unknown` on EITHER side is not a value, so it cannot differ from one. It
  // is the host saying *I could not answer*, and a comparison against silence
  // has no verdict — the row's other ten facts decide, exactly as they do while
  // a known value is being carried forward across an outage.
  //
  // Written as its own clause rather than folded into the equality so that the
  // asymmetry is visible: every other field below compares by value because
  // every other field HAS one.
  const prComparable = !isUnreadable(a.pr) && !isUnreadable(b.pr);
  return (!prComparable || a.pr === b.pr)
    && a.prNumber === b.prNumber
    && a.prDraft === b.prDraft
    && a.state === b.state
    && a.group === b.group
    && a.wave === b.wave
    && a.phase === b.phase
    && a.localDirty === b.localDirty
    && a.localLocked === b.localLocked
    && a.localAhead === b.localAhead
    && a.stuck === b.stuck;
}

/**
 * Whether a watched value describes the OBSERVATION rather than the world.
 *
 * `unknown` is the board saying *I cannot tell you right now*, and the marker
 * reports what CHANGED — so a move into or out of it is not a change and must
 * not flash.
 *
 * The cost of getting this wrong is measured, not hypothetical. GitHub's API
 * returned `503` at least four times in one afternoon on 2026-08-17, and once
 * `prState` reports unreadable mergeability honestly, each outage turns every
 * row `green → unknown` and the next pulse turns it back — **two flashes per
 * row per outage, for nothing that happened.** A marker that treats every
 * visible difference as a change turns each outage into a light show, and a
 * marker that cries wolf is worse than none: it is read once and then ignored,
 * including on the pulse where something real happened.
 *
 * This is the marker's OWN rule applied one level up. It already refuses to
 * flash on a first sighting — *unknown → conflicts* on a fresh mount is the
 * observation starting, not the branch changing — and this is the same
 * distinction arriving mid-session instead of at the beginning.
 *
 * What it costs: a real transition hidden behind an outage is not marked. Small,
 * and bounded — the state is re-read every 60 s, so the next readable pulse
 * shows the new value, and `changedRows` carries the last known value across the
 * gap so the change still flashes when it becomes visible. The marker misses the
 * moment, not the fact.
 *
 * Not folded into `watchedState`: that function answers *what is this row's
 * value*, and mapping `unknown` to `null` there would make it indistinguishable
 * from *no PR* — a row whose PR merged during an outage would then be
 * permanently confused with one whose mergeability could not be read.
 *
 * **It takes the PR SLOT, not the whole watched record**, because `pr.state` is
 * the only watched fact that can be unreadable — the only one whose source is a
 * remote host rather than the local scan. The principle is universal (*I cannot
 * say right now* is never a change in the world) and it happens to bind on
 * exactly one field, which is why the suppression is applied per slot in
 * `carryUnreadable` rather than to the row as a whole.
 *
 * NAMED FOR WHAT IT ANSWERS. It was `isUnreadable`, which reads as its own
 * opposite at every call site: it returns TRUE for `unknown`, the one value
 * that is not an observation. A predicate whose name inverts its answer is a
 * defect waiting for a reader in a hurry.
 *
 * Exported for test.
 */
export function isUnreadable(state: WatchedPrState): boolean {
  return state === 'unknown';
}

/**
 * The bookkeeping behind the markers: which keys are lit, and when each goes out.
 *
 * Split out of the hook and exported for test because the restart rule is not
 * observable through the board's own clocks. `FLEET_POLL_MS` is 4 s and a mark
 * lives 3 s, so two changes arriving on consecutive polls can never overlap —
 * a browser test "asserting" a restart is really watching a second mark replace
 * an expired first, and passes just as happily with the restart removed. (It
 * did: the sabotage was run.) Driven directly with a fake clock, the rule is
 * exact.
 *
 * `schedule` is the injection point for that clock — `setTimeout` in the app,
 * a controllable stub in the test.
 */
export class ChangeMarks {
  private readonly timers = new Map<string, () => void>();

  constructor(
    private readonly onChange: (lit: ReadonlySet<string>) => void,
    private readonly schedule: (fn: () => void, ms: number) => () => void =
      (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
  ) {}

  private readonly lit = new Set<string>();

  /**
   * Light every key in `changed`, each for a full `CHANGE_MARK_MS` from NOW.
   *
   * **A key already lit has its timer RESTARTED, not extended and not ignored.**
   * The marker claims *something is happening here*, and two changes in quick
   * succession make that more true, not less: an ignored second change would
   * let the first timer expire on its own schedule and imply nothing further
   * happened — the exact false statement the marker exists to prevent.
   */
  mark(changed: Iterable<string>): void {
    let touched = false;
    for (const key of changed) {
      touched = true;
      // Cancel first: the pending timeout belongs to the PREVIOUS change and
      // would otherwise take this one's marker with it when it fires.
      this.timers.get(key)?.();
      this.lit.add(key);
      this.timers.set(key, this.schedule(() => {
        this.timers.delete(key);
        this.lit.delete(key);
        this.onChange(new Set(this.lit));
      }, CHANGE_MARK_MS));
    }
    if (touched) this.onChange(new Set(this.lit));
  }

  /** Drop every pending timer — the component is going away. */
  dispose(): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
    this.lit.clear();
  }
}

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
  // including the plan and wave HEADS, which aggregate with `rows.some(...)`
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
 * How fast the activity mark's dot travels — and the fact each speed states.
 *
 * TWO, and no third. Both are things the board can defend from what it
 * observed; a gradient keyed to commit freshness would be a scale nobody can
 * read (*was that four minutes or forty?*) changing continuously, which is
 * motion in place of information.
 */
export type ActivityPace = 'fast' | 'slow';

/**
 * Which pace a row's mark travels at.
 *
 * **The speed is a FACT, not a decoration**, and this is the whole rule:
 *
 * | Row | Pace | Because |
 * |---|---|---|
 * | `local_dirty` or `local_locked` | fast | someone is writing, measured |
 * | in WORKING, neither signal | slow | claimed; nobody knows |
 *
 * `isActive` is the fast half and is UNTOUCHED — it is the same predicate
 * `activity-shows-itself` settled, still meaning *someone is writing here*.
 * What this adds is a second, weaker reading beside it: a row the fleet places
 * in WORKING while observing no local signal at all. That row is claimed and
 * unobserved, and *slow* is the honest rendering of it — moving, because
 * something is supposed to be happening; slowly, because nothing confirms it.
 *
 * **The negative that keeps this honest:** absence is not falsehood. Both local
 * fields are `.default(false)` in the contract, and a scan that could not
 * observe a worktree reports absence rather than cleanliness — so a slow dot
 * says *unknown*, never *nobody*. That is exactly why the slow case is bounded
 * by WORKING membership rather than applied to every row: outside WORKING there
 * is no claim to be unobserved about.
 *
 * Exported for test: an implementation that graded speed by commit age, or that
 * gave every WORKING row the fast pace, passes any assertion that only checks
 * "the dot moves".
 */
export function activityPace(
  // `state` travels because `isActive` reads it: a merged branch is not active,
  // so it has no pace either. The narrow Pick is what surfaced that — a wider
  // signature would have compiled and quietly graded a finished branch.
  row: Pick<AgentRow, 'worker' | 'pr' | 'state' | 'localDirty' | 'localLocked'>,
): ActivityPace {
  // THE TWO SPEEDS ARE THE TWO QUESTIONS, and this is where they separate.
  //
  // `isActive` decides whether a dot appears AT ALL, and it asks about the
  // PROCESS: an agent in a live state, or CI running. The pace then asks a
  // second question of the same row — *is that process actually doing
  // something* — and the worktree is the only evidence of it the board has: a
  // held lock is a write in progress this instant, uncommitted work is a write
  // that has happened.
  //
  // So a claimed branch whose agent is thinking travels SLOW, and the moment it
  // writes a file the same dot travels FAST. Two facts, one mark, no second
  // symbol to learn — which is the shape the operator asked for: *ActivityMark
  // starts when a process runs and flickers faster when real work happens*.
  //
  // A row with no process has no pace, because it has no dot; callers gate on
  // `isActive` first and this returns `slow` for it either way.
  return row.localLocked || row.localDirty ? 'fast' : 'slow';
}

/**
 * The pace a GROUP HEADING travels at, or `null` where it carries no mark.
 *
 * **A group's heading says what its rows say, one level up** — and a collapsed
 * group is the case this exists for. QUIET and DONE are in
 * `COLLAPSED_BY_DEFAULT` and the choice is persisted in `localStorage`, so they
 * stay folded across sessions; a folded heading reports `(4)`, which is a STOCK
 * count. It says *four rows are in here*, never *one of them is moving*. QUIET's
 * own comment names its purpose as *"go check whether this died"* — a group
 * whose whole job is to surface possible deaths, folded shut, showing a number.
 *
 * **Binary, and derived at render.** At least one row is active, or none is. No
 * second figure beside the tally: `(4)` exists to separate ABSENT from EMPTY, a
 * distinction this board paid for, and `(4, 2 active)` dilutes the one job that
 * number has. The reader opening a group does not need to know whether it is one
 * row or three — they need to know whether opening it is worth it.
 *
 * **The strongest pace any row states, and never stronger.** A group holding one
 * written-to row among three merely-claimed ones is a group where something is
 * demonstrably happening, so the heading travels FAST. A group holding only
 * claimed rows travels SLOW — the same *unknown, never nobody* ordering the row
 * marks keep, because a heading that reported the WEAKEST pace would let one
 * measured write hide behind three unobserved claims.
 *
 * The two inputs are the two entry paths a row has, and they are not one claim:
 * `active` is the fleet's answer for the whole list at once (`isActive` in this
 * pulse, or a lock still echoing from a recent one) and travels fast; `isLive`
 * adds the rows the fleet places in WORKING while observing nothing local, and
 * those travel slow. Reading only the first would leave every WORKING group
 * unmarked while its rows carried marks — a heading disagreeing with the rows
 * beneath it, which is the one thing this must not do.
 *
 * **It CANNOT disagree with its rows**, and that is structural rather than
 * tested: it takes the same `active` set and the same `isLive` the rows are
 * rendered from, at the same render. A stored count or a separately-maintained
 * flag is what drifts; this has nothing to drift from.
 *
 * Exported for test: an implementation returning the weakest pace, or reading
 * only `active`, passes every assertion that merely checks *the heading has a
 * mark*.
 */
export function groupPace(
  rows: AgentRow[],
  active: ReadonlySet<string>,
): ActivityPace | null {
  let slow = false;
  for (const row of rows) {
    if (active.has(rowKey(row))) return 'fast';
    if (isLive(row)) slow = true;
  }
  return slow ? 'slow' : null;
}

/**
 * The mark a row wears while something is being written to it — a short track
 * with a glowing dot travelling out and back.
 *
 * **The dot must never ARRIVE, and that is the only reason travel is acceptable
 * here.** Rotation and traversal were refused twice in this repo, both times for
 * one reason: they *"imply progress toward completion, which nothing here
 * measures"*. An agent in WORKING may finish in five minutes or five hours. A
 * dot that goes out and comes back promises no destination — it reports a RATE,
 * not a distance. Anything that fills, completes or arrives reintroduces exactly
 * what was refused, so the keyframes end where they began and the track has no
 * far marker to reach.
 *
 * **Two speeds, both earned.** Fast where `local_dirty` or `local_locked` — an
 * agent demonstrably writing. Slow where the row is merely in WORKING — claimed,
 * and the board does not know whether anyone is there. The reader learns one
 * rule and both states are ones the board can defend. See `activityPace`.
 *
 * **This reverses the wave before it, and the reversal is the point.** That wave
 * gave the mark the smallest honest rendering — a static glowing bar — so the
 * marker could be proven to read the right thing before it got loud, and argued
 * that a fifth moving element at a fifth scale would compete with the four
 * already on the row. What changed is not the ordering principle but the mark's
 * SHAPE: the other four move in place (`animate-pulse` twice, `animate-ping`
 * once, plus the change-mark's wash), and travel along a track is a channel none
 * of them uses. Motion is still scarce; this spends it on an axis nothing else
 * holds, rather than adding a fifth thing blinking.
 *
 * **A TRACK, so the travel has somewhere to happen.** The bar became a horizontal
 * rule where the vertical stroke was, and the dot rides it. The track is faint on
 * its own and the dot carries the glow, so what reads from a distance is a bright
 * point moving against a dim line — the distance problem the bar was widened for,
 * answered by movement instead of by mass.
 *
 * **`motion-reduce` keeps the track AND the dot and stops only the travel.** Both
 * halves, and this is the fifth time this repo has written the rule: hiding the
 * element under reduced motion passes a motion-only assertion and takes the
 * MARKER along with the movement. The dot rests at one end, still glowing, still
 * in place. Under reduced motion the two speeds collapse into one appearance and
 * that is correct — *speed* is the thing being removed, so it cannot be the only
 * carrier of the distinction. The row's note already says which state it is in,
 * in words.
 *
 * **`aria-hidden`, like every other mark on this row.** The row's note carries
 * the fact in words, and a screen reader must not hear it twice — and must never
 * hear a speed. The mark is decoration on top of information and never the
 * carrier of it.
 *
 * **The `title` names the marker's own limit, and that is a requirement rather
 * than a nicety.** Every signal behind the fast pace is local: `fleet.ts` is
 * explicit that `local_dirty` is *"true only on the machine doing the looking,
 * and false is what every branch elsewhere reports"*, and `local_locked` reads
 * `.git/index.lock` in a local worktree. An agent on another machine therefore
 * produces no fast mark HERE, ever. A reader who took an unmarked row for an idle
 * one would have been misled by a marker that was technically correct, so each
 * pace says what it actually knows rather than letting the motion speak alone.
 *
 * Deliberately NOT `[data-live-dot]`, NOT `[data-change-mark]` and NOT
 * `[data-stuck-cue]`: four marks, four meanings, and no mark implemented by
 * modifying another. A row can carry several at once, and then it carries
 * several.
 *
 * **`place` is WHERE the mark hangs, and it is a prop because the two callers
 * have genuinely different geometry — not because the mark has two designs.**
 * Everything the mark IS — the track, the dot, the glow, the travel, the two
 * paces, the titles, `aria-hidden` — is identical either way, and that is the
 * point: a group heading says what its rows say, so it must say it in the same
 * marks.
 *
 * | `place` | Where | Why |
 * |---|---|---|
 * | `row` | the first grid track, in the flow | the marks have a column of their own; nothing straddles the border |
 * | `heading` | inline, in the heading's flex | the heading has no `relative` box and no grid to stay out of |
 *
 * The row placement USED to read `sm:absolute sm:left-0 sm:top-2`, hanging in
 * the row's left padding to keep six columns from moving for a mark most rows
 * never carry. That argument was sound while there was one mark and it stayed
 * measurable — 2 of 56 rows carry one. What broke it is the other side of the
 * trade: `left-0` is the row's edge and the section's border sits inside it, so
 * a mark wide enough to be seen was clipped in half, and two marks on one row
 * overlapped because absolute boxes do not make room for each other. A clipped
 * mark is not a cheaper mark.
 *
 * The heading placement is still NOT the row's string, and for its own reason:
 * `sm:absolute` positions against the nearest positioned ancestor, and the
 * `<h2>` has none — so a bolted-on override would not sit the mark slightly
 * wrong, it would escape to whatever ancestor happened to be `relative` and
 * land somewhere else on the page entirely. That is a failure a class-name
 * assertion cannot see and a screenshot finds late.
 */
export const ACTIVITY_MARK_PLACE = {
  // IN THE FIRST TRACK, not hanging in the row's padding. `sm:absolute
  // sm:left-0` put the mark at the row's edge — which is OUTSIDE the section's
  // border, so every mark straddled the panel edge, and two marks on one row
  // overlapped because absolute boxes do not make room for each other.
  //
  // In the flow they stack: `flex-col` with a small gap, centred in a 1.5rem
  // column. `h-full` rather than `h-5` so a two-line row (one carrying a stuck
  // status) centres its marks against the whole cell.
  // NO padding of its own. The ROW already carries `py-2`, and adding a second
  // pair here made every row as tall as a two-line one — measured, a plain row
  // and a row with a status line both came out at 60px, which would have made
  // every alignment assertion below hold on the defect too.
  //
  // `self-stretch` still takes the row's full height so the marks centre
  // against whatever the row grew to; the height comes from the row's content,
  // never from this cell.
  // THE TUPLE'S OWN CELL, borrowed rather than restated — see `MARKS_CELL`.
  // The row is what renders this track, so the row is what owns the string; a
  // second copy here is how a heading's marks and a row's marks come to sit
  // differently, which is the drift this whole wave exists to remove.
  row: MARKS_CELL,
  // In a HEADING the mark simply FLOWS. The `<h2>` is a flex row and the mark
  // takes its place after the tally like any other child — there is no grid
  // here to stay out of, and no `relative` box to hang in.
  //
  // `self-center` because the heading aligns on `items-baseline` and a track
  // carries no text to align — on the baseline it would sit low against the
  // words, the same reason `LiveDot` documents for itself. `h-3` rather than
  // the row's `h-5`: the heading is `text-xs` and a 20px box would stretch it.
  //
  // NO `sm:absolute`, and that is the load-bearing difference. The row's
  // placement positions against the row's own `relative` box; the heading has
  // no positioned ancestor, so reusing the row's string would not sit the mark
  // slightly wrong — it would hang it off whatever ancestor happened to be
  // positioned and land it somewhere else on the page entirely.
  heading: 'relative flex h-3 w-3 shrink-0 items-center self-center',
} as const;

function ActivityMark({ pace, place = 'row', inTrack = false }: { pace: ActivityPace; place?: 'row' | 'heading'; inTrack?: boolean }) {
  const fast = pace === 'fast';
  return (
    <span
      aria-hidden
      data-activity-mark
      data-activity-pace={pace}
      // Each pace says what it actually knows. The fast one names its local-only
      // limit; the slow one names the gap it is reporting — *claimed, and nobody
      // observed* is a different statement from *someone is writing*, and a
      // single shared title would flatten the two speeds back into one fact.
      title={fast
        ? 'A write is in progress in this checkout'
        : 'Claimed, and no write observed in this checkout'}
      // Beside the live dot in the row's left padding rather than in a track of
      // its own — the same reasoning `LiveDot` documents, and the reason the
      // six columns do not move to make room for a mark most rows never carry.
      //
      // At the row's very edge (`left-0`), where `LiveDot` sits at `left-1`
      // with a 6px dot. The track is 12px wide and 2px tall, so it passes UNDER
      // the dot rather than colliding with it: two marks, two meanings, and a
      // row carrying both still shows both.
      //
      // ALIGNED TO THE ROW'S FIRST LINE, not to the row's centre — and the
      // mechanism is chosen so that no pixel has to be guessed. The mark used to
      // carry `sm:top-1/2 sm:-translate-y-1/2`, which centres it on the whole
      // ROW. That rested on an assumption which has since broken: *the row is
      // `py-2` around ONE line of `text-sm`*, so centring on the row and
      // centring on the line were the same pixel. The stuck cell then landed as
      // its own line beneath the columns (`sm:col-start-3 sm:col-end-[-1]`),
      // and a row carrying a status line is roughly twice as tall — so `top-1/2`
      // put the mark BETWEEN the two lines instead of beside the branch name.
      //
      // The mark belongs to the BRANCH, and the branch is on line one whatever
      // else the row grows beneath it. So the mark is given the FIRST LINE'S
      // OWN BOX to sit in: `sm:top-2` is the row's `py-2` padding — where the
      // first line begins — and `sm:h-5` is one line box of `text-sm`. The track
      // then centres itself inside that box with `items-center`, which is what
      // keeps this honest: the line's height is stated once, and nothing
      // downstream has to know a magic offset.
      //
      // Measured rather than assumed: the row's first line box runs 18.6px from
      // the row's own top edge on a real page, so a hand-computed `top-4.5`
      // would be right today and wrong the moment the type scale moves. A box
      // that IS the line does not have that failure mode.
      //
      // The pairing that matters: `top-1/2` looks correct on every single-line
      // row and is wrong on exactly the rows carrying the most information.
      // Anything measuring itself against the ROW's height is suspect; this
      // measured itself against the row and meant the line.
      // In the marks TRACK the parent cell already positions and sizes; the
      // mark is then just a 12px box in the flow. Outside it (the heading) the
      // placement map still applies.
      className={inTrack ? 'relative flex h-2 w-3 shrink-0 items-center' : ACTIVITY_MARK_PLACE[place]}
    >
      {/* The TRACK the dot rides: a faint 2px rule, centred on the line box by
          the flex above. Dim on purpose — what reads from a distance is a
          bright point moving against a dim line, so the track marks the extent
          of the travel without competing with the thing that travels.

          It is `relative` because the dot is positioned against IT rather than
          against the line box: the dot's reach is a fraction of the track, and
          measuring it against anything else would decouple the two. */}
      <span
        data-activity-track
        className="relative h-0.5 w-full rounded-full bg-emerald-500/25 dark:bg-emerald-400/25"
      >
        <span
          data-activity-dot
          // `--tw-travel` is the reach, read by the shared `travel` keyframes:
          // the track is 12px and the dot is 6px, so 6px of travel takes the dot
          // from flush-left to flush-right and back without ever leaving the
          // track. Set here rather than baked into the keyframes so the two stay
          // tied to each other — a wider track changes one number, not two.
          style={{ '--tw-travel': '0.375rem' } as CSSProperties}
          // The glow is an explicit `shadow-[...]` in the mark's own emerald
          // rather than a `shadow-*` scale step, because the scale's shadows are
          // neutral greys for lifting a surface off the page — a drop shadow,
          // not a light. Two rings: a tight one that thickens the dot's edge and
          // a wide, faint one that spreads. It is what carries the mark across a
          // room, and it does NOT depend on the travel — see `motion-reduce`
          // below, which stops the movement and leaves everything else standing.
          //
          // `-top-0.5` centres the 6px dot on the 2px track it rides.
          className={`absolute -top-0.5 left-0 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_1px_rgba(16,185,129,0.9),0_0_10px_3px_rgba(16,185,129,0.5)] motion-reduce:animate-none dark:bg-emerald-400 dark:shadow-[0_0_4px_1px_rgba(52,211,153,0.9),0_0_12px_4px_rgba(52,211,153,0.55)] ${
            fast ? 'animate-travel-fast' : 'animate-travel-slow'
          }`}
        />
      </span>
    </span>
  );
}

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
 * The mark a row wears while it holds commits nobody else can see.
 *
 * **STILLNESS IS THE MESSAGE.** The activity mark says *someone is writing
 * here* and carries a travelling dot and a glow to say it; this says the
 * opposite — someone wrote, stopped, and the result never left the machine. So
 * it is separated from the activity mark by FORM and by the ABSENCE OF THE
 * GLOW, never by motion: adding movement here would say the one thing that is
 * measurably untrue.
 *
 * That makes it the only one of the four marks with nothing animated at all,
 * which is why `motion-reduce` needs no clause: there is nothing to reduce. The
 * glow's absence is doing the work, and a reduced-motion rule that dimmed it
 * would take the distinction with it.
 *
 * **A BAR, WHERE THE ACTIVITY MARK IS A DOT ON A TRACK.** Same 12px left-edge
 * slot, same emerald family, and the two are still told apart at a glance:
 * one is a bright point with a halo, the other a flat rule with none. A row
 * carrying both shows both — they occupy the same slot at different heights,
 * the way the track already passes under `LiveDot`.
 *
 * **It is NOT `[data-live-dot]`, NOT `[data-change-mark]`, NOT
 * `[data-activity-mark]` and NOT `[data-stuck-cue]`.** Five marks, five
 * meanings, and no mark implemented by modifying another — the precedent #180
 * set and every wave since has kept.
 *
 * The title carries the same local-only limit its field does: this is what THIS
 * checkout can see, and a branch worked on elsewhere reports nothing here.
 */
function UnpushedMark({ ahead, inTrack = false }: { ahead: number; inTrack?: boolean }) {
  return (
    <span
      aria-hidden
      data-unpushed-mark
      // The COUNT is in the title rather than on screen. `2 ahead` and `40
      // ahead` are different situations and the number is free, but printing it
      // in the left padding would put a second figure beside a row that already
      // carries phase, plan, branch, note, PR and age — and the mark's job is
      // to say *there is something here*, which the reader then opens.
      title={`${ahead} commit${ahead === 1 ? '' : 's'} in this checkout that the remote has not seen`}
      // The same left-edge slot and the same first-line alignment as the
      // activity mark — reusing its placement map rather than restating the
      // string, so a change to the row's padding moves both marks together
      // instead of moving one and stranding the other.
      className={inTrack ? 'relative flex h-1 w-3 shrink-0 items-center' : ACTIVITY_MARK_PLACE.row}
    >
      {/* A flat rule at FULL opacity where the activity track sits at 25%, and
          with no dot riding it. Against the activity mark the difference reads
          without a legend: a solid bar means work that has stopped, a dim track
          with a bright point on it means work in progress. No shadow — the glow
          is the activity mark's alone and is what "someone is here" means. */}
      <span className="h-0.5 w-full rounded-full bg-emerald-600/70 dark:bg-emerald-400/60" />
    </span>
  );
}

/**
 * The mark a row wears for ~3 s after its PR status changed.
 *
 * **Deliberately NOT `LiveDot`, and the distinction is a requirement.** That dot
 * means *something is alive here, end unknown* and lives for hours; this means
 * *this just changed* and lives for seconds. One vocabulary carrying both would
 * make the reader ask which of two questions a mark is answering.
 *
 * A tint across the row rather than a badge in a cell: the change is a fact
 * about the ROW — and frequently about the row having just ARRIVED in this
 * section, since `pr.state` helps decide the group — so marking the whole line
 * is what makes the arrival legible at its new location.
 *
 * **`aria-hidden`, with no live region.** The cell's own text already changed,
 * and a screen reader reaches the new value by reading the row. An `aria-live`
 * announcement on every CI transition across every row would be an interruption
 * rather than an aid.
 *
 * **Under `motion-reduce` the mark STAYS and only the animation stops** — a
 * static tint, the same rule `LiveDot` follows. Hiding the element under reduced
 * motion would pass a motion-only assertion and lose the information along with
 * the movement, which is the defect that rule exists to prevent.
 */
function ChangeMark() {
  return (
    <span
      aria-hidden
      data-change-mark
      className="pointer-events-none absolute inset-0 animate-pulse bg-amber-300/25 motion-reduce:animate-none dark:bg-amber-400/20"
    />
  );
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
 * The cue: a marker that MOVES, on a row whose request is unanswered.
 *
 * **This is the one animation on this board that is not a state.** `LiveDot`
 * says *something is alive here*; `ChangeMark` says *this just changed*; both
 * describe the branch. This says *something is waiting FOR YOU, and it will keep
 * waiting until you do something* — which is why it is bounded by the action
 * rather than by the branch, and why it stops on the click rather than on the
 * repair.
 *
 * **`motion-reduce` keeps the cue and stops the animation, and both halves are
 * required.** Hiding the element under reduced motion passes a motion-only
 * assertion and takes the MARKER along with the movement — the defect that rule
 * exists to prevent, and the third time this repo has written it down. Under
 * `motion-reduce:animate-none` the dot stays exactly where it is, in colour and
 * in place; only the pulsing stops.
 *
 * **`aria-hidden`, and that is not a shortcut.** The action beside it carries a
 * word and the reason reaches the accessible name, so a screen reader gets the
 * fact through text. An animation announced as well would be the same statement
 * twice, and motion is never this board's carrier of information — never motion
 * alone, and never colour alone.
 *
 * Deliberately NOT `[data-live-dot]`, NOT `[data-change-mark]` and NOT
 * `[data-activity-mark]`: four marks, four meanings, and no mark implemented by
 * modifying another. A row can carry several, and then it carries several.
 */
function StuckCue() {
  return (
    <span
      aria-hidden
      data-stuck-cue
      // Amber rather than the emerald the live marks use: those say *this is
      // moving*, and this says the opposite. Larger than the live dot and
      // smaller than a badge — it sits beside the word it belongs to rather
      // than competing with the row's other marks in the left padding, because
      // the thing it points at is the ACTION, not the row.
      className="inline-block h-2 w-2 shrink-0 animate-ping rounded-full bg-amber-500 motion-reduce:animate-none dark:bg-amber-400"
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
 * Does this row offer Commission design — the Approve twin for a Draft plan that
 * needs design work first?
 *
 * **The same row Approve is offered on**, and deliberately the same predicate:
 * `isDraft(card) && waitingOn === 'you'` is the plan-level decision, and this is
 * the OTHER answer to it. Approve says *this is ready to hand to development*;
 * Commission design says *this needs a spec, a spike or a tracer bullet first*,
 * and creates a plan in phase `Design` to hold that work.
 *
 * Reads the ROW, not the card, because the card gate lives in `RowActions`
 * beside Approve's — this answers the row half (a Draft plan's first wave, or a
 * shelved branch, says `waitingOn: 'you'`; a blocked wave says `time` and is
 * excluded here exactly as it is for Approve). The card's `isDraft` is applied
 * at the call site, so the two items agree on which rows are plan decisions.
 *
 * Exported for test: the negative — a blocked or started branch offers nothing —
 * is the half a predicate keyed on the group alone gets wrong.
 */
export function canCommissionDesign(row: Pick<AgentRow, 'waitingOn' | 'state'>): boolean {
  return row.waitingOn === 'you' && row.state === 'open';
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
 *
 * A constant rather than a `DispatchInfo` from the server, because the server
 * has no capability to report here — the absence is total and permanent, and a
 * flag would imply a route that could flip it.
 *
 * Exported for test.
 */
export function storyRefusal(): string {
  return 'a story is a decision you make — where it lives, whether it is wanted yet — '
    + 'so it is created with /story-tracking at a terminal, not from a board click';
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
  canApprove: boolean;
  canResolve: boolean;
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
  /**
   * A Draft plan a person must decide about — the Commission design twin of
   * Approve. It WRITES (spawns a plot agent to create a Design-phase plan), so
   * it asks whether the server will act, exactly as Approve and the dispatches
   * do.
   */
  canCommission: boolean;
  serverWillAct: boolean;
  approveWillAct: boolean;
  /** Whether the server will act on Commission design — its own binding. */
  commissionWillAct: boolean;
}): { present: boolean; enabled: boolean } {
  const {
    canStart, canApprove, canResolve, hasRun, hasLog, hasStatus, hasOpen, canCommission,
    hasChangedFiles, serverWillAct, approveWillAct, commissionWillAct,
  } = items;
  return {
    present:
      canStart || canApprove || canResolve || hasRun || hasLog || hasStatus || hasOpen ||
      canCommission || hasChangedFiles,
    enabled:
      (canStart && serverWillAct) ||
      (canApprove && approveWillAct) ||
      (canResolve && serverWillAct) ||
      (canCommission && commissionWillAct) ||
      hasRun ||
      hasLog ||
      hasStatus ||
      hasOpen ||
      hasChangedFiles,
  };
}

/**
 * What a stuck branch says in its row: which of the four, the evidence, and —
 * for the two the pulse cannot fix — the action, ON THE ROW.
 *
 * **On the row, not in the three-dot menu, and that is measured rather than
 * preferred.** `RowActions` hides its action behind the menu, and the menu opens
 * only if something inside could act — so a row with a waiting action looks
 * identical to a row with none until you click it. A cue nobody finds is not a
 * cue, and this is the whole reason the rule exists.
 *
 * **A stuck branch keeps its group.** The contract says so: *a stuck branch
 * keeps the group it belongs to and gains this beside it*. Nothing here moves a
 * row or adds a section — whether a branch is stuck and where it is waiting are
 * independent questions, and folding one into the other would put a conflicting
 * PR and an unpushed rebase in the same place while separating two conflicts.
 *
 * **`null` is the common case and costs nothing.** Most rows are not stuck, and
 * this renders exactly nothing for them — the caller does not even mount it. A
 * healthy row is byte-for-byte the row it was before this wave.
 */
function StuckCell({
  row,
  cue,
}: {
  row: AgentRow;
  /**
   * Whether this row's request is still unanswered — see `showsCue`.
   *
   * A PROP rather than state of its own, and the reason is that the action left
   * this cell. The click that answers the request now happens in the row's
   * menu, one cell away, so the `actionTaken` flag has to live somewhere both
   * can reach: the row itself. This cell renders the mark; it no longer owns
   * the question.
   */
  cue: boolean;
}) {
  const stuck = row.stuck;
  const repairLine = repairWord(row.repair);
  // NOT `if (!stuck)` alone, and the difference is the whole point of reporting
  // repairs at all. A SUCCESSFUL repair ends by pushing, which unsticks the
  // branch — so on the very next pulse `stuck` is null while the repair is the
  // freshest thing that happened to it. Returning early there would hide the
  // report at exactly the moment it explains what a reader is looking at, and
  // an automatic write nobody can see is the defect this plan exists to remove.
  if (!stuck && !repairLine) return null;

  const word = stuck ? stuckWord(stuck.state) : '';
  const evidence = stuck ? stuckEvidence(stuck) : [];

  return (
    <span
      role="gridcell"
      data-stuck={stuck?.state ?? ''}
      // ITS OWN LINE beneath the row's six columns rather than a seventh track:
      // the evidence is three lines wide on a `ci-failing` row and most rows
      // carry none at all, so a track sized for it would push every real column
      // in from the edge across the whole fleet to reserve room for something
      // rare and tall.
      //
      // **From column 2, not column 1**, and a screenshot settled the
      // difference. `col-span-full` starts at track 2, which is `5rem` wide and
      // was frequently EMPTY when it held a phase — so on a row with no phase
      // the evidence hung flush left under nothing while the branch it describes
      // started `5rem` in, reading as a foreign element rather than as a
      // continuation of the row. `2 / -1` starts it where the row's own content
      // starts, and because that track is FIXED it lands identically whichever
      // row it is on — the property the fixed tracks exist for.
      // COLUMN 3, not 2: the marks earned a track at the front, so the cell
      // that used to begin past track 2 now begins past the MARKS and runs
      // under it — the exact defect this span was written to fix, reintroduced
      // by a column inserted before it. Measured: the evidence line started at
      // x=57 where that cell ends at 130.
      //
      // Track 2 now holds the KIND and is never empty, which removes the
      // *frequently empty* half of the original argument. The geometry does not
      // change with it: the span still starts past the marks, because it is the
      // row's own content it must line up with, and a full cell above an
      // indented line is exactly as misaligned as an empty one.
      className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs sm:col-start-3 sm:col-end-[-1]"
    >
      {/* The state as a WORD, in amber, and the word is the carrier — the
          colour only reinforces it. `title` names the state's own terms so a
          pointer gets the one sentence that explains the errand. */}
      {word && (
        <span className="shrink-0 font-medium text-amber-700 dark:text-amber-500">
          {word}
        </span>
      )}
      {/* EVIDENCE TRAVELS WITH THE STATE. Each line is its own element rather
          than one joined sentence, so a reader (and a test) can find the
          `ci-failing` row's three lines separately — they are three different
          facts and only the reader combines them. */}
      {evidence.map((line) => (
        <span
          key={line}
          data-stuck-evidence
          className="min-w-0 text-slate-500 max-sm:whitespace-normal dark:text-slate-400"
        >
          {line}
        </span>
      ))}
      {/* WHAT THE MACHINE DID, on the same line as why it was stuck. A repair
          is an event on this branch, and separating it from the state that
          caused it would make a reader join two places to learn that the
          conflict they are looking at is already being handled — or was, and
          the handling gave up. */}
      {repairLine && (
        <span
          data-repair={row.repair?.state ?? ''}
          data-repair-outcome={row.repair?.outcome ?? ''}
          className="min-w-0 text-slate-500 max-sm:whitespace-normal dark:text-slate-400"
        >
          {repairLine}
        </span>
      )}
      {/* THE CUE STAYS IN THE ROW while the action it used to sit beside now
          lives in the three-dot menu. It is state, not an action — it says
          *this one is waiting on you*, and a signal reachable only by opening a
          menu is not a signal. `one-place-for-what-a-row-can-do` moved the
          actions and was explicit that this must not follow them.

          It points at the WORD and the evidence to its left rather than at a
          control to its right, which is what it always described: the row's own
          statement of what is wrong. The action is one `⋯` away, and the menu's
          accessible name carries the branch.

          Rendered LAST so it trails the evidence — the mark that says *unanswered*
          reads as a qualifier on the whole statement rather than as a bullet in
          front of it. */}
      {cue && <StuckCue />}
    </span>
  );
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
function BranchMenu({
  row,
  card,
  dispatch,
  approve,
  commission,
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
  approve?: DispatchInfo;
  commission?: DispatchInfo;
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
        approve={approve}
        commission={commission}
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

function RowActions({
  row,
  card,
  dispatch,
  approve,
  commission,
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
  /** Whether this server will act on Approve, and why not — the plan-PR half. */
  approve?: DispatchInfo;
  /**
   * Whether this server will act on Commission design, and why not.
   *
   * The SAME binding as `idea` — spawning a plot agent to write a plan is one
   * authority, whether the plan comes from an issue (Create plan) or from a
   * Draft plan that needs design work (Commission design). Passed under its own
   * name so the item states its own refusal, and so a later split of the two
   * authorities changes one prop rather than every call site.
   */
  commission?: DispatchInfo;
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
  // Measured: `enabled` was `canStart && serverWillAct`, so the menu opened
  // only where `Start work` was possible — and a Draft plan's row is never
  // startable, by construction. Its one available act is approving, and the
  // menu was therefore dead on exactly the rows that had something to do. The
  // same plan's CARD offered the button all along: one board, two answers.
  //
  // `isDraft(card)` is the card's own gate, reused rather than re-derived from
  // the row's phase — `plot-approve.sh` accepts phase `draft` and refuses every
  // other one, and two spellings of that rule would drift.
  // THE ROW MUST AGREE WITH THE CARD, and this is where forgetting that shows.
  //
  // `isDraft(card)` alone put an Approve button on a branch BLOCKED by an
  // earlier wave: its plan is genuinely Draft, so the card said yes — while the
  // row itself is waiting on time and has nothing a person can act on. That is
  // the plan-level answer applied to a branch-level row, which is the confusion
  // this section spent the evening separating.
  //
  // `waitingOn === 'you'` is the row's own word for *a person must act*: a
  // Draft plan's FIRST wave, or a shelved branch. A blocked row says `time` and
  // is excluded by construction rather than by a second rule that could drift.
  const canApprove = Boolean(card && approve && isDraft(card) && row.waitingOn === 'you');
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
  const approveWillAct = approve?.available ?? false;
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
  // COMMISSION DESIGN — the Approve twin for a Draft plan that needs design work
  // first. Same card gate as Approve (`isDraft`), same row gate
  // (`canCommissionDesign` reads `waitingOn === 'you'`), so the two items appear
  // together on exactly the plan-decision rows and never on a blocked wave. It
  // WRITES — it spawns a plot agent to create a Design-phase plan — so it asks
  // its own binding whether the server will act, exactly as Approve does.
  const canCommission = Boolean(
    card && commission && isDraft(card) && canCommissionDesign(row),
  );
  const commissionWillAct = commission?.available ?? false;
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
    canStart, canApprove, canResolve, hasRun: Boolean(runUrl), hasLog, hasStatus,
    hasOpen: Boolean(openUrl), canCommission, hasChangedFiles,
    serverWillAct, approveWillAct, commissionWillAct,
  });
  const reason =
    canStart && !serverWillAct && dispatch?.reason
      ? dispatch.reason
      : canResolve && !serverWillAct && dispatch?.reason
        ? dispatch.reason
        : // Commission design carries its own binding's words when it is the row's
          // one refused act — the same shape Approve's refusal takes on its card.
          canCommission && !commissionWillAct && commission?.reason
          ? commission.reason
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
          {/* Approving a plan and starting a branch are MUTUALLY EXCLUSIVE by
              construction — `isStartable` needs `waitingOn: 'click'`, which a
              Draft plan's row never has, and `isDraft` needs phase Discovery,
              which a startable row never has. They are written as two
              independent items rather than as an if/else so that neither
              becomes the other's fallback: if that ever changes, the menu shows
              both instead of silently picking one. */}
          {canApprove && approve && card && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <ApproveButton card={card} approve={approve} onApproving={onStarting} />
            </div>
          )}
          {/* COMMISSION DESIGN — the OTHER answer to a Draft plan, beside
              Approve. Approve hands the plan to development; this says it needs a
              spec, a spike or a tracer bullet first, and creates a plan in phase
              `Design` to hold that work. It ships minimally rather than as a
              refusal: the `Design` phase landed in #259 and nothing filled it,
              and a menu entry that only explained why it could not act would
              leave the phase unreachable for longer.

              Its own binding (`commission`) and its own armed-confirm button, so
              the click that spawns an agent is as deliberate as Approve's — and
              where the server refuses, it names the reason on the control. */}
          {canCommission && commission && card && (
            <div role="menuitem" className="px-2 py-1 text-left">
              <CommissionDesignButton card={card} commission={commission} onActing={onStarting} />
            </div>
          )}
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
   * Whether this server will act on `Commission design`, and why not — the
   * PLAN row's second decision, beside Approve. Same binding as `idea` today
   * (both spawn a plot agent), kept its own prop for the reason every capability
   * flag above it is: one flag for two capabilities is how they diverge.
   */
  commission?: DispatchInfo;
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
 * a header to name, and the kind cell takes its own label back there.
 *
 * SEVEN NAMES FOR SEVEN TRACKS, matching `TUPLE_TRACKS`. The marks track is
 * named too — it was not, while it held only decoration, and it now carries
 * slot 1's kind ICON as well, which is a fact about the row rather than an
 * ornament on it.
 */
function HeaderRow() {
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
 * still rendered through the tracks of a BRANCH, having no wave, no worker and
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
function PlanRow({
  group,
  onOpenPlan,
  expanded,
  onToggle,
  active,
  card = null,
  approve,
  onApproving,
  ageMinutes,
}: {
  group: PlanGroup;
  onOpenPlan?: AgentListProps['onOpenPlan'];
  /**
   * The plan's clock in minutes, where the APPROVAL clock is not the one running.
   *
   * `planWaitingDays` is right for NOT STARTED — the branches have no tip, so
   * `waitingDays` is all there is. Outside it the reverse holds: measured on the
   * live board, `waitingDays: null` on every WAITING ON YOU row while
   * `ageMinutes` reads real values. The caller passes the freshest of its
   * branches, which is the same clock a wave row uses.
   */
  ageMinutes?: number;
  /** Whether the branches beneath are showing — null where there is no fold. */
  expanded: boolean | null;
  onToggle?: () => void;
  /** Something is being written to one of this plan's branches. */
  active?: boolean;
  /** This plan's board card — what `ApproveButton` acts on. Null off-board. */
  card?: Card | null;
  /** Whether this server will act on Approve, and why not. */
  approve?: DispatchInfo;
  /** A click is outstanding (true) or has settled (false). */
  onApproving?: (active: boolean) => void;
}) {
  const waiting = planWaitingDays(group);
  const summary = waveSummaryFor(group);
  const foldable = expanded !== null;
  // THE PHASE IS THE PLAN'S, and slot 5 is where a fact about the plan is true.
  // Read from the group's rows rather than from a plan field, because a row is
  // what carries `phase` — and they agree by construction, all being branches
  // of one plan.
  const phase = group.rows[0]?.phase ?? '';
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
            data-wave-toggle={group.plan}
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
      aside={
        // THE WAVE SUMMARY — *3 waves, first eligible*. It answers *which slice
        // of this plan* in the plan's own terms, which are the only terms this
        // row has: the branches it would otherwise name do not exist yet. In
        // slot 4 beside the branch link for the same reason a branch row's wave
        // badge is there — it qualifies the item rather than pointing anywhere.
        summary ? (
          <span
            data-wave-summary
            className="truncate text-slate-500 dark:text-slate-400"
            title="Waves of this plan that nothing has started — counted in this section"
          >
            {summary}
          </span>
        ) : null
      }

      // THE MENU HOLDS EXACTLY ONE ACT, for exactly one reason: approving
      // belongs to the PLAN. `plot-approve.sh` takes a plan and no branch, the
      // server reports `approve` per plan, and the row that names the plan is
      // the only honest place for it.
      //
      // Dispatch does NOT belong here, and that half of the old argument
      // stands: a `plot-dispatch` control would have to guess which of the
      // plan's waves it meant, so the branch rows in the fold keep their own
      // menus, where the row has already decided.
      menu={<PlanActions plan={group.plan} card={card} approve={approve} onApproving={onApproving} />}
    />
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
function WaveActions({
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
 * The info mark on a blocked wave, and the overlay that names what blocks it.
 *
 * ## Why an overlay rather than a `title`
 *
 * This was a native `title` for one commit, and it could not do the job asked
 * of it: *show the LINK on hover*. A `title` renders plain text, waits about a
 * second before appearing, cannot be styled, and — the part that decides it —
 * **cannot hold a control**. The blocking wave is a row on screen; a reference
 * to it should be able to take the reader there.
 *
 * ## Why the target is always reachable
 *
 * The blocking wave is a SIBLING in the same list — a plan's waves all render
 * together, so `Shaped` is one or two rows above `Moved` whenever `Moved` says
 * it is blocked. That is why this needs none of App's reveal machinery
 * (`revealBranch`, `highlightBranch`, the nonce): those exist to cross tabs and
 * sections to find a row that may not be rendered. Here the row is a query away.
 *
 * Scoped by PLAN as well as by wave name, because wave names repeat across
 * plans — `Shaped` appears in several of this estate's plans, `Says` in three.
 * The same reason `openWaves` keys on `plan\0wave`.
 *
 * ## Hover AND focus
 *
 * A hover-only disclosure is unreachable by keyboard, and this one holds a
 * control, so it would be a control nobody could tab to. It opens on
 * `mouseenter` and on `focus` within, and closes on `mouseleave`, on blur out,
 * and on Escape.
 */
function BlockedByMark({ plan, wave }: { plan: string; wave: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // The sibling row, found by the two attributes that identify it. `scrollIntoView`
  // with a flash rather than a persistent highlight: the reader asked *which
  // wave*, and the answer is a glance, not a new state to dismiss.
  const goToWave = () => {
    const target = document.querySelector<HTMLElement>(
      `[data-wave-list="${CSS.escape(plan)}"] [data-wave-row="${CSS.escape(wave)}"]`,
    );
    if (!target) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    // A brief ring, removed on its own. Not a class toggle held in state: the
    // flash belongs to the TARGET row, which this component does not own.
    target.classList.add('ring-2', 'ring-amber-400');
    window.setTimeout(() => target.classList.remove('ring-2', 'ring-amber-400'), 1200);
    setOpen(false);
  };

  return (
    <span
      ref={box}
      className="relative ml-1 inline-flex shrink-0 items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        data-wave-blocked-by={wave}
        aria-haspopup="dialog"
        aria-expanded={open}
        // THE NAME IS IN THE LABEL, not only in the overlay. A reader on a
        // screen reader gets the answer without opening anything, which is the
        // same rule slot 2 follows: recognition must not depend on a disclosure.
        aria-label={`Blocked by wave ${wave} — show it`}
        onClick={goToWave}
        className="inline-flex items-center text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="currentColor"
          className="inline-block align-text-bottom"
        >
          {/* Octicons `info` — the same vocabulary the kind glyphs use. */}
          <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
      </button>
      {open && (
        // RIGHT-ANCHORED and above the row, because slot 5 sits near the right
        // edge and a left-anchored panel would leave the viewport. `z-20` clears
        // the row menus' `z-10`.
        <span
          role="dialog"
          data-wave-blocked-panel={wave}
          className="absolute bottom-full right-0 z-20 mb-1 w-max whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <span className="text-slate-500 dark:text-slate-400">blocked by </span>
          <button
            type="button"
            data-wave-goto={wave}
            onClick={goToWave}
            className="font-medium text-sky-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-sky-300"
          >
            {wave}
          </button>
        </span>
      )}
    </span>
  );
}

/**
 * A WAVE, as a tuple — the eighth kind, and the row this section was missing.
 *
 * ## What it replaces
 *
 * Rendered on the mock 2026-08-20, a three-wave plan produced four rows all
 * labelled `PLAN`. Each of the three beneath the plan named its BRANCH in slot
 * 3, carried the wave name as a trailing badge, linked
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
 * A wave holding ONE branch renders one row and no fold — the branch is its
 * artifact link and there is nothing hidden. Measured over the estate that is
 * 20 of 21 unfinished waves, so it is the common case and not an edge. A wave
 * holding several gets the disclosure, with its branches beneath.
 *
 * `showsWaveFold` on the plan row asks the same question one level up and
 * answers it from a row count; this asks it of a wave's branches. Both are
 * *does opening this reveal anything*, and neither renders a control over a
 * single row the reader can already see.
 */
function WaveRow({
  group,
  plan,
  waitingDays,
  expanded,
  onToggle,
  active,
  marked = false,
  card = null,
  dispatch,
  pulse,
  onStarting,
  groupedCount,
  groupedWord,
  soleRow,
  // The branch-level bindings a SOLE-BRANCH wave row needs for its menu. Absent
  // on a wave of several branches, where each branch keeps its own row and its
  // own menu, and the wave row's only act is dispatch.
  approve,
  commission,
  continueWith,
  onOpenPlan,
  onRevealBranch,
  planHeaded = false,
}: {
  group: WaveGroup;
  /** The plan this wave slices — for the row's test hook, not for a link. */
  plan: string;
  /** The plan's approval clock, inherited where the wave has no tip of its own. */
  waitingDays: number | null;
  /** Whether the branches beneath are showing — null where there is no fold. */
  expanded: boolean | null;
  onToggle?: () => void;
  /** Something is being written to one of this wave's branches. */
  active?: boolean;
  /** Whether this wave changed on the last pulse — see `ChangeMark`. */
  marked?: boolean;
  /** The PLAN's card — what `StartWorkButton` acts on. Null off-board. */
  card?: Card | null;
  /** Whether this server will dispatch, and why not. */
  dispatch?: DispatchInfo;
  /** The pulse counter, passed through to `StartWorkButton`. */
  pulse: number;
  onStarting?: (active: boolean) => void;
  /**
   * How many of this wave's branches the section is counting, and the WORD for
   * what that count means — `3 to review`, `2 stalled`, `2 delivered`.
   *
   * Set wherever a wave is grouped from rows that are already under way, which
   * replaces the verdict in slot 5. The verdict answers *may this wave be
   * started* and every one of these describes a wave that already was: measured,
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
   * The one row this wave holds, where it holds exactly one — so the wave row can
   * show that branch's own status and age.
   *
   * A wave of one gets no fold (there is nothing hidden to reveal), which means
   * the wave row is the ONLY row that branch gets. Its PR condition —
   * `conflicts`, `checks failing` — is a fact the verdict cannot carry and there
   * would be no second row to read it from. Measured: all 12 waves in WAITING ON
   * YOU hold one branch, so this is the ordinary case rather than an edge.
   */
  soleRow?: AgentRow;
  approve?: DispatchInfo;
  commission?: DispatchInfo;
  continueWith?: DispatchInfo;
  onOpenPlan?: (planFile: string) => boolean | void;
  onRevealBranch?: (branch: string) => void;
  /**
   * Whether a PLAN ROW heads this wave's group — set by the caller, which is the
   * only place that knows.
   *
   * Suppresses the plan link on a wave of one: with a plan row directly above,
   * the link says twice what the nesting already states. Measured when it did —
   * `Tracer` rendered `plan opus5-longhorizon-hardening` beneath a plan row of
   * that name and wrapped to double height.
   */
  planHeaded?: boolean;
}) {
  const foldable = expanded !== null;
  // The wave's own age is the freshest of its branches — a wave has no tip, so
  // its clock is the clock of the work in it. `null` where none of them has one,
  // and then `tupleFromWave` falls back to the plan's approval clock, labelled.
  const ages = group.rows.map((r) => r.ageMinutes).filter((a): a is number => a !== null);
  // A WAVE OF ONE INHERITS ITS BRANCH'S NOTE, since there is no branch row left
  // to carry it: `conflicting: …`, `last commit 6h ago`, `PR #303, checks
  // failing`. The verdict sentences are about starting, and this branch is
  // started.
  const soleNote = soleRow ? noteWithoutPr(soleRow.note, soleRow.pr) : '';
  // THE VERDICT IS THE WAITING-STATE, and these are the two cases NOT STARTED
  // holds: a wave a person may start, and a wave an earlier one is holding back.
  // Both are already answered by the verdict — see `aside` below for why the
  // colour has to come from the field rather than from a sentence.
  // `you` FOR AN ELIGIBLE WAVE, not `click`. Reported from a screenshot: the
  // eligible note rendered in the ordinary slate colour while the two blocked
  // ones were dimmed, so the row that WANTS something read as the quiet one.
  //
  // `waitingTone` gives `click` the ordinary colour deliberately — *"giving
  // `click` one of its own would make the section shout twice and mean once"* —
  // and that argument is about a branch row in a section whose every row is
  // waiting on a click. Here the three verdicts sit side by side and the
  // distinction IS the point: one of these can be started and two cannot.
  // `you` is the amber tone the board uses for *this needs a decision*, which is
  // exactly what an eligible wave is.
  const waveWaitingOn: WaitingOn | null =
    // `you` — a merge is a decision, whatever the verdict says about ordering.
    soleRow ? soleRow.waitingOn
      : groupedCount !== undefined ? 'you'
      : group.verdict === 'eligible' ? 'you'
      : group.verdict === 'blocked' ? 'time'
        : null;
  const waveNote =
    // A REVIEWABLE WAVE says what it is waiting for, and it is a person. The
    // verdict's sentences are both about starting — and these branches are
    // started, so neither is true here.
    soleNote ? soleNote
      : groupedCount !== undefined ? groupedNote(groupedWord)
      : group.verdict === 'eligible' ? 'approved — nobody has taken it'
        : group.verdict === 'blocked' ? 'an earlier wave has to land first'
          : '';
  return (
    <TupleRowView
      tuple={tupleFromWave({
        name: group.wave,
        plan,
        verdict: group.verdict,
        groupedCount: groupedCount ?? null,
        groupedWord: groupedWord ?? '',
        // THE SOLE BRANCH'S OWN CONDITION, where the wave holds one. `prStatus`
        // is what a PR row would have shown, and this row stands in for it.
        //
        // A WORKER OUTRANKS BOTH, because it is the only one of the three that
        // says somebody is on it right now. *Worked on by X* answers *what is
        // happening to this wave*; `open` and `green` answer *what condition is
        // its branch in*, which a reader in WORKING did not ask. This is what the
        // `agent` kind was for, and the reason it never worked: an agent row named
        // its branch and showed `open` — the branch's state, which as its own
        // comment says *"says nothing about an agent"*. The wave keeps the
        // identity, the worker becomes the status, and no second kind is needed.
        // Only a LIVE worker, and that bound is measured. On this repo's board
        // 4 rows read `worker: 'finished'` and all four sit in DONE behind merged
        // PRs, where `delivered` is the honest word and `finished` would replace
        // it with a fact about a process nobody is waiting on. `running`,
        // `waiting` and `stalled` are the three that mean *somebody is on this,
        // or should be* — the rest are history, and history loses to the PR.
        soleStatus: soleRow && LIVE_WORKERS.has(soleRow.worker)
          ? workerStatus(soleRow.worker)
          : soleRow?.pr ? prStatus(soleRow.pr) : (soleRow ? stateStatus(soleRow) : ''),
        // AND ITS PR AND PLAN, for the same reason: a wave of one has no fold, so
        // this row is the ONLY row that branch gets and everything reachable from
        // a branch row has to be reachable from here.
        //
        // Measured as two separate losses when it was not:
        //   `expected 'Kind: Wave w branch feature/phone…' to contain 'lonely-plan'`
        //   — the plan link, gone from a row that had it.
        // `WaveRow` was written for NOT STARTED, where a branch has no PR and no
        // plan link to lose. Every other section's branches have both.
        solePr: soleRow?.pr ?? null,
        // NO PLAN LINK WHERE A PLAN ROW HEADS THIS WAVE, and that is the whole
        // condition: the plan is the row directly above, so a link to it here is
        // the duplication this kind was built to remove.
        //
        // Measured after `solePlan` landed: the `Tracer` row rendered `plan
        // opus5-longhorizon-hardening` under a PLAN row naming the same slug, and
        // wrapped to 75px — double every sibling.
        //
        // It IS needed where no plan row heads the group: `waveGroupsFor` returns
        // nothing for a mixed group, and a lone wave row then carries the only
        // statement of which plan it belongs to. `planHeaded` is what the caller
        // knows and this row cannot.
        solePlan: soleRow?.plan && !planHeaded ? {
          slug: soleRow.plan, file: soleRow.planFile,
        } : null,
        // ITS BRANCHES — but only where the wave HOLDS ONE, and this is the
        // correction the estate's one multi-branch wave forced.
        //
        // `opus5-longhorizon-hardening :: Implementation` holds five. Rendered
        // with all five as artifact links, slot 4 wrapped to FIVE LINES — the row
        // became five rows tall — and the fold below then listed the same five
        // branches again as rows. Every name twice, and the plan's other wave
        // (`Tracer`) pushed five rows down so the two waves no longer read as
        // siblings. Reported from a screenshot.
        //
        // A PARENT NAMES ITS COUNT, NOT ITS MEMBERS. That is the rule the plan
        // row already follows — `3 waves`, never three wave names — and the fold
        // is what discloses them. The original design made branches the wave's
        // artifact links, written when a wave of one was the case in view: there
        // the single link IS the row's content and there is no fold at all.
        //
        // So: one branch, one link. Several, and slot 4 stays empty while the
        // count lives in slot 5 (`5 stalled`) and the names live in the fold.
        branches: group.rows.length === 1
          ? group.rows.map((r) => ({ branch: r.branch, branchUrl: r.branchUrl }))
          : [],
        blockedBy: group.blockedBy,
        // ITS OWN COUNT, derived from its own rows — no contract field, the same
        // property `waveSummaryFor` keeps one level up. `blockedNote()` composed
        // this number into a sentence on the row that WAITED on the wave; here it
        // is on the wave it counts.
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
        'data-wave-row': group.wave || UNNAMED_WAVE,
        // A SPIKE says so as an attribute too, so a test asserts the KIND of wave
        // rather than the colour of a glyph.
        ...(isSpikeWave(group.wave) ? { 'data-wave-spike': '' } : {}),
      }}
      // AMBER FOR A SPIKE, slate for an implementation wave — and never colour
      // alone: the word `spike` rides beside the name in `beside` below. A tracer
      // that fails sends the reader back to the PLAN, and that is worth telling
      // apart from a wave whose failure means a rebase.
      iconTone={isSpikeWave(group.wave)
        ? 'text-amber-600 dark:text-amber-400' : undefined}
      beside={
        // THE WORD, because a colour cannot be the only carrier — the same rule
        // slot 2 follows for the kind itself. `spike` rather than `tracer` because
        // it names what the wave IS for any of its spellings (`Tracer`, `Spike`,
        // `Tracer bullet`), and the wave's own name is right beside it.
        isSpikeWave(group.wave) ? (
          <span
            data-wave-kind="spike"
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
        // *waiting on time* (an earlier wave has to land) — and in NOT STARTED
        // that distinction had no carrier left: the branch rows that held
        // `data-row-note` are folded into wave rows, and `tupleFromWave` has no
        // note. Measured: zero `data-row-note` elements in the section.
        //
        // The VERDICT is the same distinction the note was encoding, so the tone
        // is taken from it rather than from a sentence: `eligible` is
        // `waitingOn: 'click'` — a person may start it — and `blocked` is
        // `waitingOn: 'time'`, which is what `waitingOnFor` already computes on
        // the server for exactly these two cases.
        //
        // The TEXT is the plain-English form of the status, and it is the one
        // thing a wave row says twice on purpose: slot 5 holds the word a reader
        // scans down a column, and this holds the sentence that explains the
        // colour. Where the wave is complete there is nothing to wait for and
        // nothing renders.
        waveNote ? (
          <span
            data-row-note
            data-waiting-on={waveWaitingOn ?? undefined}
            className={`min-w-0 truncate ${waitingTone(waveWaitingOn)}`}
            title={waveNote}
          >
            {waveNote}
          </span>
        ) : null
      }
      statusExtra={
        // `blocked by Relocated` — AN INFO MARK IN SLOT 5, beside the status it
        // explains, with the wave named on hover and for a screen reader.
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
        // the fact a reader SCANS down the column; *which wave* is the follow-up
        // question a reader asks about one row. A follow-up belongs behind a
        // disclosure — the same reason `ApproveButton`'s armed label lives in a
        // popup rather than in a cell.
        //
        // NOT a link, because a wave has no page of its own — it is a heading
        // inside a plan file. `title` and `aria-label` carry the name, and the
        // name is also in the accessible label so it is not hover-only for a
        // reader who cannot hover.
        <>
          {/* THE DRAFT BADGE, where this wave stands in for one branch. A draft
              and a check state are independent — a draft has CI like anything
              else — so the status word cannot carry both, and `Row` renders the
              badge beside it for that reason. Without it a wave row read
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
            <BlockedByMark plan={plan} wave={group.blockedBy} />
          ) : null}
        </>
      }
      // The verdict is the scan's, and the title says whose judgement it is —
      // the status word alone (`blocked`) does not say blocked BY WHAT, and the
      // branches in slot 4 are what a reader opens to find out.
      // THE PR'S STATE WHERE THIS WAVE STANDS IN FOR ONE, and the wave's verdict
      // otherwise.
      //
      // `soleStatus` already prints the PR's condition as the status WORD — but
      // without `data-pr-state` beside it, nothing can tell which of the two
      // facts that slot is showing. A test asserting `conflicts` cannot say
      // whether it means the PR's mergeability or the branch's git state, which
      // is the ambiguity `Row` documents at its own `statusAttr`.
      //
      // The verdict keeps the slot wherever a wave speaks for itself: several
      // branches, or one with no PR.
      statusAttr={soleRow?.pr
        ? { 'data-pr-state': soleRow.pr.state }
        : group.verdict
          ? { 'data-verdict': group.verdict, title: `The scan's verdict for this wave: ${group.verdict}` }
          : undefined}
      // NO BORDER, the same reason the plan row takes none: a wave with a fold
      // heads its own little group, and a rule here would fall between a wave
      // and its own first branch.
      bordered={false}
      extra={
        // THE STUCK CELL, where this wave stands in for one branch — *"why this
        // branch cannot move"*, which is a fact about the BRANCH and one no
        // verdict carries.
        //
        // Measured when it was missing: `feature/collides rendered no stuck cell`.
        // A wave of one has no fold, so without this the conflicting paths, the
        // failing check and the unpushed count are unreachable — the same class
        // of loss as the deleted accessible name, and exactly what `stuck-rows`
        // exists to catch.
        // THE SOLE BRANCH'S STUCK CELL, or the WAVE'S OWN — and `unsliced-wave`
        // is the wave's, so it renders here whatever the branch count.
        //
        // A wave holding several branches is the state's entire subject, and the
        // branch rows now suppress it (see `StuckCell` in `Row`) precisely so it
        // is stated once, here, where it is true.
        <>
          {/* THE CHANGE MARK, for the reason a branch row carries one: a wave
              row IS the row a branch gets, so it changes when that branch does —
              a PR turning red, a row moving section — and said nothing about it.
              `extra` is the slot whose positioning parent is the row itself,
              which is what `inset-0` needs to tint the whole line. */}
          {marked && <ChangeMark />}
          {(soleRow ?? group.rows[0])?.stuck?.state === 'unsliced-wave'
            ? <StuckCell row={group.rows[0]} cue={false} />
            : soleRow?.stuck ? <StuckCell row={soleRow} cue={false} /> : null}
        </>
      }
      // START WORK, ON THE WAVE THAT CAN BE STARTED — and it went missing when
      // the branch rows did.
      //
      // The control lived in a branch row's `RowActions`, so replacing those
      // rows with wave rows took the action with them: NOT STARTED offered
      // nothing to click. Reported from a screenshot.
      //
      // The plan warned that a dispatch control on a PLAN row *"would have to
      // guess which of the plan's waves it meant"*, and one level down the same
      // worry does not apply — because `StartWorkButton` takes a **`Card`** and
      // a `dispatch` binding, NOT a branch. Dispatch is a plan-level act:
      // `plot-dispatch.sh` fans out the eligible wave, which is this row. There
      // is nothing to guess.
      //
      // ONLY where the verdict is `eligible`. A blocked wave offers no control
      // at all rather than a disabled one — `isStartable`'s own rule: *"a button
      // whose usual state is 'you cannot' teaches people to ignore buttons"*,
      // and the note beside it already says an earlier wave has to land first.
      // AND THE BRANCH'S MENU WHERE THIS ROW IS A BRANCH'S ROW.
      //
      // `WaveActions` above dispatches the WAVE and is gated on
      // `verdict === 'eligible'` for its own good reason. That gate was also,
      // accidentally, the gate on whether this row had ANY menu — so a wave of
      // one branch, which is what most plans are, lost Review, Open and the
      // worker log entirely. Measured: every wave row had zero menus of any
      // kind while every branch row had one.
      //
      // Only for a SOLE branch. Where a wave holds several, each keeps its own
      // row and its own menu, and a branch menu here would have to guess which
      // branch it meant — the same argument that keeps dispatch off the plan
      // row one level up.
      menu={
        <>
          {group.verdict === 'eligible' && card && dispatch ? (
            <WaveActions
              wave={group.wave || '(unnamed)'}
              card={card}
              dispatch={dispatch}
              pulse={pulse}
              onStarting={onStarting}
            />
          ) : null}
          {soleRow ? (
            <BranchMenu
              row={soleRow}
              card={card ?? null}
              dispatch={dispatch}
              approve={approve}
              commission={commission}
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
              data-wave-branch-toggle={group.wave || '(unnamed)'}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} the branches of wave ${group.wave || '(unnamed)'}`}
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
 * The plan row's `⋯` menu — one item, and the reason it is a menu at all.
 *
 * `ApproveButton` arms itself on the first click and its armed label names the
 * consequence (`Approve — merges PR #146?`), which is 25 characters in a cell
 * `1.25rem` wide. On a branch row the same button lives inside `RowActions`'s
 * popup for exactly that reason. So the plan row borrows the pattern rather
 * than inventing a second one: same glyph, same `aria-haspopup`, same
 * close-on-outside-click, same fixed-width cell.
 *
 * NOT `RowActions` itself. That component is typed on `AgentRow` and asks four
 * questions about a branch (startable? resolvable? a run? a log?), none of
 * which a plan row can answer — `row.branch` is what its labels are built
 * from. Sharing it would mean making every one of those optional to serve one
 * caller that wants none of them.
 *
 * **The absence states its reason.** Where the server has refused
 * (`approve.available === false`) the button renders dim with the refusal on
 * it, because a refusal is not an absence — the same rule `RowActions` follows.
 * Where the plan is simply not Draft there is nothing to refuse and no button
 * at all.
 */
function PlanActions({
  plan,
  card,
  approve,
  onApproving,
}: {
  plan: string;
  card: Card | null;
  approve?: DispatchInfo;
  onApproving?: (active: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  // `isDraft(card)` rather than the group's phase word: `plot-approve.sh`
  // accepts phase `draft` and refuses every other one, and the card's own gate
  // is the single spelling of that rule. Two spellings drift — which is how the
  // branch menu and the card came to disagree in the first place.
  const canApprove = Boolean(card && approve && isDraft(card));
  const willAct = approve?.available ?? false;

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
      {canApprove && (
        <button
          type="button"
          data-plan-actions={plan}
          aria-haspopup="menu"
          aria-expanded={open}
          // Never the native attribute — a natively disabled control leaves the
          // tab order and takes the explanation with it.
          aria-disabled={!willAct || undefined}
          aria-label={willAct ? `Actions for ${plan}` : (approve?.reason ?? `Cannot approve ${plan} from here`)}
          title={willAct ? `Actions for ${plan}` : (approve?.reason ?? `Cannot approve ${plan} from here`)}
          onClick={() => { if (willAct) setOpen((v) => !v); }}
          className={`inline-flex h-6 w-5 items-center justify-center leading-none ${
            willAct
              ? 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
              : 'cursor-default text-slate-300 dark:text-slate-700'
          }`}
        >
          <span aria-hidden className="text-xs">⋯</span>
        </button>
      )}
      {open && willAct && card && approve && (
        <div
          role="menu"
          ref={menu}
          className="absolute right-0 z-10 mt-1 min-w-max rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div role="menuitem" className="px-2 py-1 text-left">
            <ApproveButton card={card} approve={approve} onApproving={onApproving} />
          </div>
        </div>
      )}
    </div>
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
 * borrowed four of and a TICKET row borrowed all seven of, having no wave, no
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
function Row({
  row,
  onOpenPlan,
  card = null,
  dispatch,
  approve,
  commission,
  continueWith,
  pulse = 0,
  onStarting,
  marked = false,
  active = false,
  inPlanGroup = false,
  inWaveGroup = false,
  agent = null,
  section,
  waveName = null,
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
   * The wave this branch belongs to, or null to name none.
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
  waveName?: string | null;
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
   * Whether this row sits inside a WAVE's fold, whose verdict is on screen one
   * line up. Suppresses a redundant `open` — see `waveStatesIt`.
   */
  inWaveGroup?: boolean;
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
  /** Whether this server will act on Approve, and why not. */
  approve?: DispatchInfo;
  /** Whether this server will act on Commission design, and why not. */
  commission?: DispatchInfo;
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
    // INSIDE A WAVE'S FOLD THE NOTE IS THE WAVE'S TO SAY, so the branch says
    // nothing. `blocked by Relocated — 1 outstanding` rendered on both children
    // of the `Moved` wave, one line below the row that now states the same three
    // facts structurally — the verdict in slot 5, the blocker beside the name,
    // the count on the wave it counts. The sentence this wave called redundant
    // was still being printed, twice.
    //
    // The whole note rather than a match on its wording: `ELIGIBLE_NOTE`'s own
    // rule is that nothing may be built on matching this prose, and every note a
    // branch carries in NOT STARTED is about its wave's state — *approved,
    // nobody has taken it*, *blocked by an earlier wave*. A branch inside a
    // fold has no sentence of its own to lose.
    //
    // Same shape as the machine section one line down, and the same reason: a
    // row appearing twice must not say the same thing twice.
    inWaveGroup ? '' :
    section === 'waiting-on-machine' ? machineNote(row) : row.note,
    row.pr,
  );

  // **Taken, not resolved.** The cue answers a REQUEST, and the request is
  // answered by the click — whether the click worked is what the row's other
  // marks report on the next pulse. Local to the row and not persisted: a
  // reload starts the cue again, which is the honest answer to *is this still
  // waiting on me* when the board has only just started looking.
  const [actionTaken, setActionTaken] = useState(false);
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
  // The cue follows what this ROW can actually ask, not what its state usually
  // offers — an animated dot pointing at a menu with nothing in it marks a
  // request nobody can make.
  const cue = row.stuck
    ? showsCue(actionReachable(row.stuck, card, dispatch), actionTaken)
    : false;

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

  // THE WAVE'S VERDICT OUTRANKS THE BRANCH'S STATE, and inside a wave's fold
  // the branch does not restate it.
  //
  // Reported from the mock: two branches under the wave `Moved`, whose verdict
  // is `blocked`, each showing `open`. Both facts are true — `stateStatus` reads
  // `row.state`, and a branch nobody has taken IS open — and together they
  // contradict. `open` is the only word in the child's status column, so a
  // reader scanning it concludes *available*, while the row one line up says
  // `blocked` and `plot-dispatch.sh` would refuse the branch. That is the false
  // promise `isStartable` exists to avoid, made by a status word instead of a
  // button.
  //
  // Measured over `last-pulse.json`: branches inside BLOCKED waves are
  // `open` × 9 and `wip` × 5; inside ELIGIBLE waves, `open` × 8 and `wip` × 3.
  // Near-identical proportions — so the branch's state says nothing at all
  // about whether it can be started. The wave's verdict is the fact, and it is
  // already on screen.
  //
  // THE WHOLE STATE GOES, not just `open` — and the measurement is what settled
  // it. A first attempt suppressed `row.state === 'open'` only, reasoning that
  // `wip`, `deferred` and `merged` are events on the branch that no verdict
  // states. Counted over `last-pulse.json`, that guard NEVER FIRES: a child row
  // renders only inside a multi-branch unfinished wave, the estate holds exactly
  // ONE of those, and all five of its branches are `wip`. So the condition
  // covered a case that does not occur and left the case that does printing a
  // status its wave owns.
  //
  // A rule rather than a list of exceptions: inside a wave's fold, the WAVE
  // carries the status. What a branch alone knows still reaches the reader —
  // `deferred` has its own badge beside the state (never instead of it, by the
  // rule at that badge), a PR's condition rides in the PR cell, and a stuck
  // branch takes its own second line. None of those is slot 5.
  //
  // A deferred branch never arrives here in any case: it is not part of a
  // wave's unbegun work and keeps its own row beside the waves, which is where
  // its PR and its age stay reachable.
  //
  // In the adapter and not the projection, for the reason `inheritedClock`
  // records one line up: the same row outside a wave SHOULD print its state, and
  // the projection cannot see what is asking.
  // EXCEPT WHERE THE ROW HAS A PR, whose condition the wave cannot state.
  //
  // The rule is that a wave's verdict outranks the branch's state — sound for an
  // unbegun branch, whose `open` merely repeats *nothing has happened*. It is
  // wrong for a reviewable one: measured on the mock, PRs 304 (`green`) and 307
  // (`checks failing`) both rendered an EMPTY status under their wave, so the one
  // fact separating them — which of the two a person can actually merge — was
  // the fact suppressed.
  //
  // `pr === null` is the test rather than the section, because it names the
  // reason: a PR carries a condition of its own, reported by the host, that no
  // verdict computed from ordering can express.
  const waveStatesIt = inWaveGroup && row.pr === null;
  const base = tupleFromRow(row, agent);
  // THE AGE GOES WITH THE STATUS, and for one reason rather than two: inside a
  // wave's fold, the WAVE is the subject and the branch is its content.
  //
  // `inheritedClock` above already blanks the age where the row has no tip of
  // its own — the plan's approval clock, repeated down a column, saying one
  // number three times. Inside a wave the same argument covers the tip too: the
  // wave row's clock is the freshest of its branches (`Math.min` over their
  // ages), so it is already the number a reader wants, and per-branch ages
  // beneath it are four measurements of one thing.
  //
  // Where a single branch's own clock IS the question, the row exists outside a
  // wave — a deferred branch keeps its own row beside the waves, precisely so
  // its age and its PR stay readable.
  const tuple = {
    ...base,
    // The age goes with the status, and returns with it: a PR that has sat for
    // three weeks is saying something its wave's freshest-branch clock hides.
    ...(inheritedClock || (inWaveGroup && row.pr === null)
      ? { age: { text: '', label: '' } } : {}),
    ...(waveStatesIt ? { status: '' } : {}),
    // AND NO PLAN LINK, for the reason the wave row carries none: the plan is
    // TWO rows up, heading the group these rows are nested in, and a link to it
    // on every child says the same thing as many times as the wave has
    // branches. Measured on the mock: `plan fleet-scan-asks-the-host` on both
    // children of `Moved`, directly beneath a wave row that is itself directly
    // beneath the plan row.
    //
    // A branch's artifact slot is *the plan that governs it, or NOTHING where no
    // plan does* — and inside a wave's fold, nothing is what is left to say:
    // slot 3 names the branch, and the two rows above name its wave and its
    // plan. This is the same containment rule the wave row settled, applied one
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
    // links the rows above already carry — the PLAN and the WAVE — and keep
    // every other artifact, which is by construction one this row alone holds.
    //
    // Stated as containment rather than as a list of kinds, because the list was
    // where it went wrong twice: first dropping everything, then keeping only
    // the branch, which erased the PR from a CONFLICTING branch row. That row's
    // own source names the regression it repeats — *a branch started and then
    // shelved read as never begun, with its age and its PR erased* — and the
    // wave heading it cannot stand in, since a wave with two PRs names neither.
    ...(inWaveGroup
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
          {(active || isLive(row)) && (
            <ActivityMark pace={active ? 'fast' : activityPace(row)} inTrack />
          )}
          {/* FINISHED WORK NOBODY ELSE CAN SEE — a separate question, asked
              separately. Not an `else`: a row can be written to AND hold
              unpushed commits at the same moment, and either shape would lose
              whichever it tested second. */}
          {isUnpushed(row) && <UnpushedMark ahead={row.localAhead} inTrack />}
          {isLive(row) && <LiveDot />}
        </>
      }
      aside={
        // WHAT A STATUS WORD CANNOT SAY — *uncommitted work*, *blocked by an
        // earlier wave*, *claimed elsewhere*, *awaiting review*.
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
          {/* THE WAVE, BESIDE THE THING IT NAMES A SLICE OF.

              IN SLOT 3, beside the NAME — which is `a-branch-row-names-its-wave`
              (#275)'s decision and this wave does not revisit it. The wave
              qualifies THIS BRANCH, and the association is positional: it is
              adjacent to the branch it divides, the way `deferred` beside it
              qualifies the branch's state. One cell over, in slot 4, it would
              be a word separated from the thing it is about.

              A MARK, not a link, which is why it is not one of slot 4's links
              in any case. A wave is a heading inside a plan file and has no
              page of its own; the plan link one slot along opens the document
              the wave is a section of.

              Every branch that names a wave shows it, and the gate is a
              property of the ROW alone — see `waveLabel`. */}
          {waveName && (
            <span
              data-wave={waveName}
              className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              // The word `wave` is in the TITLE and not in the badge, because
              // the badge is read beside a branch name where the relation is
              // already visible. This is not a tooltip standing in for a label
              // — the wave NAME is rendered in text; the title only says what
              // kind of name it is.
              title={`Wave ${waveName} — the slice of the plan this branch belongs to`}
            >
              {waveName}
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
          approve={approve}
          commission={commission}
          pulse={pulse}
          onStarting={onStarting}
          onTaken={() => setActionTaken(true)}
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
          {/* NOT A WAVE-LEVEL STUCK STATE, which is a fact about the WAVE and
              would print once per branch.
              
              Measured 2026-08-21: `wave not sliced` and its five-branch list
              rendered on all FIVE branches of `opus5 :: Implementation` — the
              same sentence five times, naming the same five branches each time.
              Exactly the defect `blockedNote` had, one level down.
              
              `unsliced-wave` belongs on the wave's own row, or on a branch row
              that has no wave row above it. The two other wave-scoped states
              (`double-claimed` is per-branch, the rest are per-branch) are
              unaffected: only this one describes the container. */}
          {row.stuck?.state === 'unsliced-wave' && inWaveGroup
            ? null : <StuckCell row={row} cue={cue} />}
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
              than a leftover. The wave arithmetic IS satisfied: the branch is
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
function IssueRowActions(
  { issue, idea, issueAnswer }:
  { issue: IssueRow; idea: DispatchInfo; issueAnswer: IssueAnswer },
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
          {/* CREATE STORY — offered, and refused with its reason. A real
              `<button>`, `aria-disabled`, never native `disabled`: the reason
              must stay reachable by keyboard, the same rule the acting buttons
              follow. There is no route to call, so it never acts — the click is
              a no-op and the words are the whole of it. */}
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
 * `ROW_TRACKS`, the tracks of a BRANCH. A ticket has no wave, no worker and no
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
function IssueRowView(
  { issue, idea, issueAnswer }:
  { issue: IssueRow; idea: DispatchInfo; issueAnswer: IssueAnswer },
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
      // full set: Create plan (works), Create story (offered, refused with its
      // reason), Open on host.
      menu={<IssueRowActions issue={issue} idea={idea} issueAnswer={issueAnswer} />}
    />
  );
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
  continueWith,
  idea,
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

  // Which plans in NOT STARTED have their branches showing. Keyed by plan name,
  // which is what the group is keyed by.
  //
  // Collapsed by default and NOT persisted, unlike the section-level fold. The
  // two are different in kind: folding QUIET is a standing preference about a
  // section a reader has decided not to watch, while opening one plan's waves is
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

  // THE SAME FOLD, ONE LEVEL DOWN — a wave's branches, where it holds more than
  // one. Every argument above applies unchanged: collapsed by default, not
  // persisted, never derived from the rows.
  //
  // A SEPARATE SET rather than a shared one, keyed `plan\0wave`. Wave names
  // repeat across plans — `Shaped` and `Sized` each appear in several of this
  // estate's plans, and `Says` in three — so one namespace would fold every
  // `Shaped` in the section on one click. The NUL separator cannot occur in
  // either name, so the key is unambiguous where `plan/wave` would not be
  // (branch-shaped wave names exist).
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

  const [openWaves, setOpenWaves] = useState<Set<string>>(() => new Set());
  const waveKey = (plan: string, wave: string) => `${plan}\0${wave}`;
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
  // spent rate limit says so and names when service returns (the sibling wave
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

  return (
    <div className="space-y-4">
      {/* The board-status panel — one box carrying every status above, the
          view-status line stays at the foot. See `StatusPanel`. */}
      <StatusPanel statuses={statuses} />

      {/* THE SECTIONS, spaced apart from each other and from nothing else.

          Their own container so the gap between two sections is a number this
          list owns. The page container above is `space-y-4` and holds the
          banners as well; a section break has to read as a bigger break than a
          row break (35–36 px rows, `py-2`), and 16 px was not it. */}
      <div data-sections className="space-y-8">
      {GROUPS.map(({ key, icon, label, hint }) => {
        // EVERY SECTION IS ITS `group`, WAITING ON A MACHINE INCLUDED. It
        // asked a second question until 2026-08-20 — admitting any row that
        // carried a process — and that is what listed live agents as machines
        // to wait on. See `inMachineSection` for why the answer is `group`
        // alone; it is called by name here because the section's membership is
        // the thing that plan settled, and a reader who follows the rule back
        // should land on the argument rather than on a bare comparison.
        const rows = key === 'waiting-on-machine'
          ? fleet.rows.filter(inMachineSection)
          : fleet.rows.filter((r) => r.group === key);
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
          ? fleet.issues
          : [];
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
        // Issue rows count toward the fold and the tally: they are rows a
        // reader sees, and a section reading `(2)` above four lines is the
        // mismatch NOT STARTED already had to fix once.
        const collapsible = isCollapsible(rows.length + issues.length);
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
        // THE TALLY COUNTS WHAT THE SECTION SHOWS.
        //
        // Everywhere else that is rows, and the number matches what a reader
        // sees. In NOT STARTED it stopped matching when the section learned to
        // render one row per PLAN: a five-wave plan is one visible line and
        // five rows, so the heading read `(6)` above three lines. Measured on
        // screen with `working-shows-the-agent` folded.
        //
        // Counting the same thing the section renders is also what makes the
        // number safe to fold: the branches behind an expander are described by
        // their plan's own summary (`3 waves, first eligible`), so nothing is
        // hidden by the smaller figure — it moves up a level with the rows.
        const shown = (countsPlans ? grouped.length : rows.length) + issues.length;
        const tally = (
          <span className="font-normal normal-case tracking-normal text-slate-400 dark:text-slate-600">
            {rows.length + issues.length > 0 ? `(${shown})` : emptyHint}
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
                  //
                  // In NOT STARTED the PLAN ROW carries the name instead, so no
                  // sub-heading is drawn: the heading exists to save the rows
                  // repeating the plan, and here the plan row already does that
                  // job with a clock and a wave summary the heading has no room
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
                  // A PLAN ROW HEADS ITS WAVES, where every row in the group is
                  // one. That is the shape NOT STARTED already draws, and the one
                  // a text heading cannot: a plan has a phase, an approval clock
                  // and a menu, none of which an `h3` can carry.
                  //
                  // `group.plan` must be named — a group of rows no plan claims
                  // has no plan row to draw — and the wave groups must account
                  // for every row, or a plan row would head a set it does not
                  // describe.
                  // A PLAN GROUP IS HOMOGENEOUS BY CONSTRUCTION, which is why
                  // this predicate can require that EVERY row be wave-grouped
                  // rather than handling a mixture.
                  //
                  // The operator's observation, 2026-08-20: *"a plan group will
                  // barely have mixed WAVES. Once a plan is approved the waves
                  // land in NOT STARTED."* A plan's branches move through the
                  // lifecycle together — in review here, then dispatchable in NOT
                  // STARTED, then working, then done — so a group holding some
                  // waves and some loose rows is a transient, not a shape to
                  // design for.
                  //
                  // So the `=== 0` is a GATE rather than a limitation: where a
                  // mixture does occur, the group falls back to the text heading
                  // and every row renders as itself. Nothing is hidden, and the
                  // plan row appears only where it describes the whole set.
                  const planHeads = !countsPlans && Boolean(group.plan)
                    && ungroupedRows(group.rows, key).length === 0
                    && waveGroupsFor(group.rows, key).length > 0;
                  if (countsPlans) {
                    const foldable = showsWaveFold(group);
                    const expanded = foldable ? openPlans.has(group.plan) : null;
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
                          onOpenPlan={onOpenPlan}
                          expanded={expanded}
                          onToggle={foldable ? () => togglePlan(group.plan) : undefined}
                          // The plan is active if ANY of its branches is —
                          // including one folded out of sight, which is the case
                          // the mark most needs to reach.
                          active={group.rows.some((r) => active.has(rowKey(r)))}
                          // The PLAN's card, looked up by the group's own plan
                          // file rather than by any branch's — the approval is
                          // the plan's act and the card is the plan's record.
                          card={cardForPlanFile?.(group.planFile) ?? null}
                          approve={approve}
                          onApproving={onStarting}
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
                            {/* WAVES, NOT BRANCHES — the eighth kind, and the
                                one this section had been rendering as its own
                                branches all along.

                                `groupByWave` partitions the plan's rows; each
                                partition is ONE row naming the wave, carrying
                                the scan's verdict as its status and its branches
                                as its artifact links. A wave holding one branch
                                (20 of 21 unfinished waves) is therefore one row
                                and no fold; one holding several gets the
                                disclosure and its branches beneath. */}
                            {/* A DEFERRED BRANCH IS NOT PART OF A WAVE'S WORK,
                                and it keeps its own row.

                                `isUnbegun` already draws this line and
                                `waveSummaryFor` already refuses to count a
                                deferred branch as a wave: *"not a wave nobody
                                reached, a branch somebody set down"*. The wave
                                grouping has to honour it, because a wave row
                                shows the WAVE's verdict and clock — and a
                                deferred branch carries a PR and an age of its
                                own that appear nowhere else. Folded into a
                                single-branch wave they would be unreachable,
                                which is exactly the loss `fleet.ts` warns of:
                                *"a branch started and then shelved read as never
                                begun, with its age and its PR erased."* */}
                            {groupByWave(group.rows.filter(isUnbegun)).map((wg) => {
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
                                    card={cardForPlanFile?.(group.planFile) ?? null}
                                    dispatch={dispatch}
                                    pulse={pulse}
                                    onStarting={onStarting}
                                  />
                                  {/* The branches of a MULTI-branch wave, folded
                                      and indented again — the same `ml-6` and the
                                      same rule the plan's own list draws, one
                                      level deeper. A single-branch wave renders
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
                                          // Inside a WAVE's fold: the verdict is
                                          // one line up, so a bare `open` here
                                          // contradicts it rather than adding to
                                          // it.
                                          inWaveGroup
                                          card={cardForPlanFile?.(r.planFile) ?? null}
                                          dispatch={dispatch}
                                          approve={approve}
                                          commission={commission}
                                          continueWith={continueWith}
                                          pulse={pulse}
                                          onStarting={onStarting}
                                          marked={marked.has(rowKey(r))}
                                          active={active.has(rowKey(r))}
                                          section={key}
                                          agent={agentByBranch.get(r.branch) ?? null}
                                          // NO WAVE BADGE. The row is nested
                                          // under the wave that names it, so the
                                          // badge would repeat one line up —
                                          // which is the duplication this whole
                                          // wave removes.
                                          onRevealBranch={onRevealBranch}
                                          highlighted={r.branch === highlightBranch}
                                        />
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                            {/* The rows that are not a wave's unbegun work —
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
                                approve={approve}
                                commission={commission}
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
                        its rows are waves.
                        
                        *"We need to group branches for plans. Which should be
                        Plan group with WAVES"* and *"PLANS are missing with their
                        age"*. NOT STARTED has drawn exactly this since the wave
                        kind landed: a plan row carrying the plan's phase and its
                        approval clock, with its waves indented beneath. A text
                        heading carries neither — it is a label, and a plan has a
                        phase, an age and a menu.
                        
                        Only where every row under it is a wave. A group holding a
                        release and a ticket has no plan to head it with, and the
                        `h3` below still serves the mixed case. */}
                    {planHeads && (
                      <PlanRow
                        group={group}
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
                        // The freshest of its branches, which is what a wave row
                        // already uses: the plan's clock is the clock of the work
                        // in it.
                        ageMinutes={Math.min(
                          ...group.rows.map((r) => r.ageMinutes)
                            .filter((a): a is number => a !== null),
                        )}
                        // FOLDABLE, and OPEN by default — the reverse of NOT
                        // STARTED, where a plan is collapsed because its list is
                        // there to browse. Here the waves are what the section is
                        // showing, so hiding them would hide the rows a reader
                        // came for; but eight plans of four waves is 40 lines,
                        // and a reader who has dealt with one plan wants it out
                        // of the way.
                        //
                        // `openPlans` holds what is COLLAPSED in this section
                        // rather than what is expanded — one Set, two defaults,
                        // and the same click either way.
                        // COLLAPSED BY DEFAULT WHERE IT HOLDS MORE THAN ONE
                        // WAVE, open where it holds one.
                        //
                        // A plan of one wave collapsed shows a reader nothing
                        // they did not already have — the plan row states its
                        // phase and its clock, and the one wave beneath is the
                        // only content. A plan of four is 5 lines, and eight such
                        // plans are 40: that is the crowding the fold answers.
                        //
                        // The default is a QUESTION ABOUT THE GROUP, so the Set
                        // holds the reader's overrides rather than the state
                        // itself — one click flips whichever default applies.
                        expanded={
                          waveGroupsFor(group.rows, key).length > 1
                            ? openPlans.has(`open:${group.plan}`)
                            : !openPlans.has(`shut:${group.plan}`)
                        }
                        onToggle={() => togglePlan(
                          waveGroupsFor(group.rows, key).length > 1
                            ? `open:${group.plan}` : `shut:${group.plan}`,
                        )}
                        active={group.rows.some((r) => active.has(rowKey(r)))}
                        card={cardForPlanFile?.(group.planFile) ?? null}
                        approve={approve}
                        onApproving={onStarting}
                      />
                    )}
                    {headed && !planHeads && (
                      // AND WHERE THE `h3` SURVIVES, IT KEEPS THE SIZE #302 GAVE IT.
                      // The plan row above answers the grouped case; this
                      // heading answers the MIXED one, where a group holds a
                      // release or a ticket beside its waves and no single plan
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
                        the wave list carries one section over.

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
                        answers. */}
                    {(!planHeads || (waveGroupsFor(group.rows, key).length > 1
                      ? openPlans.has(`open:${group.plan}`)
                      : !openPlans.has(`shut:${group.plan}`))) && (
                    <ul
                      role="presentation"
                      className={headed || planHeads
                        ? 'ml-6 border-l border-slate-200 dark:border-slate-800'
                        : undefined}
                    >
                      {/* WAVES OVER THEIR REVIEWABLE BRANCHES, in this section
                          only — and only where a wave holds MORE THAN ONE.
                          
                          *"Technically the PR with branch and the wave is a
                          WAVE"*, and the qualifier is the section: WAITING ON YOU
                          asks *what needs a decision*, and where three PRs are
                          three slices of one wave the thing being decided is the
                          wave. `opus5-longhorizon-hardening :: Implementation`
                          holds five landed branches and reads `blocked` — five
                          reviews the board was filing as *nothing to do*.
                          
                          The earlier objection to calling a PR a wave was that a
                          five-branch wave would render five rows all named
                          `Implementation`. Grouping is what answers it: one wave
                          row, its PRs beneath. A LONE reviewable branch stays a
                          PR row, because there is no set to name — the same rule
                          `showsWaveFold` applies, and the same one that makes a
                          single-branch wave one row in NOT STARTED.
                          
                          The wave can appear in BOTH sections, deliberately: the
                          branches with PRs group here, the ones nobody started
                          group under the plan in NOT STARTED. Each section shows
                          only the branches its own question is about. */}
                      {waveGroupsFor(group.rows, key).map((wg) => {
                        // A WAVE OF ONE NEEDS NO FOLD — its single branch is
                        // already named in slot 4, so a control revealing a row
                        // the reader can see is the noise this estate removed
                        // twice. Measured: all 12 waves here hold one branch.
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
                              pulse={pulse}
                              onStarting={onStarting}
                              // WHAT THE COUNT MEANS, per section — the verdict
                              // cannot say any of these, because it answers
                              // *may this be started* and all three describe
                              // waves that already were.
                              // THE COUNT ONLY WHERE THERE IS MORE THAN ONE.
                              // `1 to review` beside a single branch link states
                              // what that link already shows, and it would hide
                              // what a reader wants on a wave of one: that
                              // branch's own condition, which no verdict carries
                              // and no fold exists to reach.
                              groupedCount={wg.rows.length > 1 ? wg.rows.length : undefined}
                              // THE WORD FOLLOWS THE BRANCHES, not the section:
                              // WAITING ON YOU now holds waves waiting on a
                              // MERGE (their branches have PRs) and waves waiting
                              // on an APPROVAL (their plan is still in review),
                              // and `to review` is false of the second.
                              groupedWord={key === 'done' ? 'delivered'
                                : key === 'quiet' ? 'stalled'
                                  : wg.rows.some(isReviewable) ? 'to review'
                                    : 'to approve'}
                              soleRow={wg.rows.length > 1 ? undefined : wg.rows[0]}
                              // THE BRANCH BINDINGS, for the menu a sole-branch
                              // wave row carries. They go unused where the wave
                              // holds several — `soleRow` is undefined there and
                              // each branch keeps its own row and its own menu.
                              approve={approve}
                              commission={commission}
                              continueWith={continueWith}
                              onOpenPlan={onOpenPlan}
                              onRevealBranch={onRevealBranch}
                              planHeaded={planHeads}
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
                                    approve={approve}
                                    commission={commission}
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
                      })}
                      {ungroupedRows(group.rows, key).map((r) => (
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
                          approve={approve}
                          commission={commission}
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
                          // The same wave label as inside a plan group, and
                          // the same rule: a fact about the branch, beside the
                          // branch. This row used to differ from one in a plan
                          // group — it printed the plan's PHASE where the other
                          // printed nothing — which is the inconsistency the
                          // relocation removes.
                          // ONLY WHERE THE ROW DOES NOT ALREADY LINK ITS WAVE.
                          //
                          // An `agent` and a `pr` row both carry the wave as an
                          // artifact link now, so the badge is a second copy —
                          // measured on the mock as `Inverted` twice on the agent
                          // row and `Modelled` twice on PR 304.
                          //
                          // The badge STAYS on a BRANCH row, and the distinction
                          // is not a compromise. Its docstring argues that *"the
                          // wave qualifies THIS BRANCH, and the association is
                          // positional… A MARK, not a link"* — sound while a wave
                          // had no row to point at. A branch row's artifact slot
                          // holds its plan and its PR, not its wave, so there the
                          // badge is still the wave's only statement.
                          //
                          // Keyed on the KIND rather than on *does slot 4 contain
                          // a wave*, because the projection is what decides that
                          // and this adapter must not form a second opinion about
                          // it — the rule `tupleFromRow` states about `row.kind`.
                          waveName={WAVE_LINKING_KINDS.has(r.kind) ? null : waveLabel(r)}
                          onRevealBranch={onRevealBranch}
                          highlighted={r.branch === highlightBranch}
                        />
                      ))}
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
                // section holding issue rows and no branches is not empty, and
                // the word would sit above the rows contradicting them.
                issues.length === 0 && (
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
                  issueAnswer={fleet.issueAnswer}
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
      })}
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
