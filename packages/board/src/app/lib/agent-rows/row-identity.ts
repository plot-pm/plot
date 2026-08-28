import {
  type AgentRow,
  type WaitingOn,
} from '../../../contract/schema.js';
// One direction only: `tuple-row` imports nothing from this directory — it
// reads the contract alone — so naming it here cannot close a cycle.
import { tupleAgeText } from '../tuple-row.js';

/**
 * Minutes as the board says them: `45m`, `3h`, `2d`, `5mo`.
 *
 * Split out of `age` so an ISSUE row and a BRANCH row cannot render the same
 * duration two ways. `age` takes an `AgentRow`, which an issue is deliberately
 * not — and the alternative to sharing this was a second copy of four lines
 * that would drift the first time either changed.
 *
 * IT HAD ALREADY BECOME THAT COPY. This body was byte-identical to
 * `tupleAgeText` until 2026-08-28, when the age gained a months arm and became
 * the first thing to change either of them — precisely the drift the paragraph
 * above was written to warn about. It now DELEGATES rather than matching by
 * inspection: one formatter, so the two row kinds cannot disagree even in
 * principle. The re-export keeps both names, because the docstrings above and in
 * `AgentList` and `stuck.ts` cite this one for why the split exists.
 *
 * Exported for test.
 */
export const ageLabel = tupleAgeText;

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
 * Does this row offer work a person can start right now?
 *
 * READS THE FIELD, not re-derives. `startability` is computed in `classify`
 * from plan phase, branch state, wave verdict, and brief state — four facts
 * that are only all in scope there. Reading the field rather than re-deriving
 * it is what makes the row and the menu unable to disagree: both ask one value,
 * computed once, from the same reading of the same pulse.
 *
 * Before this field existed, the board read `waitingOn === 'click'`, which
 * answered *wave ordering satisfied* — one of the four facts, and the one that
 * was measured: 26 rows said `eligible` and 5 could be started. The operator
 * report named the gap: *"I see this row says 'eligible' — why won't dispatch
 * start it?"* Because `eligible` means something, and that something is not
 * *startable*.
 *
 * THE ONE VALUE THAT MEANS STARTABLE. The other three say why not:
 *
 *   `needs-brief`          run `/plot-implement` first
 *   `waiting-on-approval`  the plan is Draft; approve it or leave it
 *   `someone-is-on-it`     `wip` or `claimed` — not yours to start
 *
 * Null where the question does not apply: merged, deferred, blocked, or any row
 * outside `not-started`. No button, no grey, no explanation — the row's own
 * state is its explanation, and a predicate that returned true for them would
 * offer an action the tool declines.
 *
 * `state === 'open'` is redundant — `startability: 'start-work'` is only
 * returned for `open` branches — but kept as documentation and as a structural
 * test: if the server ever returns `start-work` for a non-open branch, the
 * button would not appear, and the mismatch would surface in test rather than
 * in production.
 *
 * Exported for test — the negative cases (blocked, missing brief, wip) are the
 * half a naive implementation gets wrong.
 */
export function isStartable(row: AgentRow): boolean {
  return row.startability === 'start-work' && row.state === 'open';
}

/**
 * Does this row still need its BRIEF written before anyone can start it?
 *
 * READS `startability`, which carries this answer. A row with `needs-brief` is
 * an otherwise-startable branch missing the specification a worker reads first.
 * The question was decided server-side in `startabilityVerdict`, so this reads
 * the decision rather than re-deriving it — the same rule `isStartable` follows
 * and for the same reason.
 *
 * Measured 2026-08-19: nine eligible rows on this board, zero briefs. Every one
 * read *eligible — nobody has taken it*, and every dispatch it invited would
 * have started an agent that reads a file which is not there.
 *
 * Exported for test.
 */
export function needsBrief(row: AgentRow): boolean {
  return row.startability === 'needs-brief';
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
 * `START WORK` GETS ITS COLOUR FROM `statusTone`, NOT FROM HERE. That is the
 * one startability verdict that signals *you may act*, and `statusTone` is
 * where actionable words get green: `green`, `delivered`, `start work`. The
 * other three startability verdicts (`needs a brief`, `waiting on approval`,
 * `someone is on it`) keep the ordinary colour because they close the question
 * rather than inviting a click.
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
/**
 * Is this row's WORK over — landed or called off — whatever its worktree holds?
 *
 * **`merged || deferred`, and nothing about a worktree or a worker.** These are
 * the two ways a branch's work ends: `merged` landed it, `deferred` is a human
 * deciding it is not needed. Both are the branch's own `state`, a fact about the
 * git ref every reader can verify — never the local checkout only one machine
 * can see.
 *
 * The whole class of DONE defect this session cleared is a LOCAL fact answering
 * a FINISHED-work question: a merged branch whose stale worktree still held an
 * edited test fixture reported *someone is writing here*, and a merged branch
 * whose worklog never cleared reported a `waiting` worker as though the run were
 * live. The domain model states the boundary — *a local fact may DESCRIBE a row
 * and may never ORDER the fleet* — and this predicate is the one question both
 * reads must ask first: is there any writing left to observe at all? On a
 * finished row there is not, so a worktree or worker signal on it is stale
 * bookkeeping, not a pulse.
 *
 * NOT keyed on the dirty file's name. Ignoring `last-pulse.json` would silence
 * today's instance and leave the rule wrong — any uncommitted file in any stale
 * worktree brings it back looking like a new bug. The defect is the CATEGORY,
 * asking a live question of finished work, and this names the category.
 *
 * Exported for test, and reused: `isActive` and the wave-of-one status read are
 * the two places that were asking the live question, and they ask this instead.
 */
export function isFinished(row: Pick<AgentRow, 'state'>): boolean {
  return row.state === 'merged' || row.state === 'deferred';
}

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
