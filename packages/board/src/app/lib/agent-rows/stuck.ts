import {
  type AgentRow,
  type Stuck,
  type StuckState,
} from '../../../contract/schema.js';
import { prStatus, stateStatus, workerStatus } from '../tuple-row.js';
import { agoLabel } from '../../components/AgentPanelFacts.js';
import { LIVE_WORKERS } from './waves.js';
import { isFinished } from './row-identity.js';

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

export function isActive(
  row: Pick<AgentRow, 'worker' | 'pr' | 'state'>,
): boolean {
  // A FINISHED BRANCH IS NOT ACTIVE, whatever is still running against it.
  //
  // Measured on screen: a row in DONE carrying the activity mark. Both halves
  // were individually true — `state: merged` (or `deferred`) and a local
  // signal — and the row said two things that cannot both be acted on. The mark
  // says *work is happening on this branch*, and after the branch is finished
  // there is no work on it left to happen; `classify` sends such branches to
  // `done` before it looks at any signal, and this predicate agrees with that
  // rather than contradicting it one layer up.
  //
  // `deferred` and not only `merged`, because both are finished: one of the
  // seven rows wearing the mark on the live board was `deferred` with a dirty
  // worktree. The guard is finishedness (`isFinished`), never merged-ness — the
  // same reason it is not keyed on the dirty file's name.
  if (isFinished(row)) return false;
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
 * Slot 5 for a SLICE OF ONE — the branch's own status, folded onto the slice row.
 *
 * A slice of one gets no fold, so this row is the only one that branch gets and
 * carries the status a branch row would have shown. Three sources, in order:
 *
 *   1. a LIVE worker (`workerStatus`) — *somebody is on this right now*, which
 *      outranks the others because it is the only one about activity;
 *   2. the PR condition (`prStatus`) — `green`, `checks failing`;
 *   3. the bare branch state (`stateStatus`) — `delivered`, `deferred`.
 *
 * **But a live worker is screened out on a FINISHED row**, and that is the fix.
 * The worker outlives its branch (`AgentEntry`: *"a branch is what an agent is
 * working on, never what it is"*), so its last recorded state can survive the
 * merge. Measured 2026-08-23, three DONE rows carried `worker: waiting`/`failed`
 * on branches that were `merged` or `deferred`; `waiting` is a LIVE worker, so
 * it reached this slot and read as *someone owes this an answer* under a heading
 * that says done. On a finished row there is no run to be waiting on, so the
 * worker is skipped and the row falls back to its PR then its state — the same
 * category error as the activity mark, and it asks the same `isFinished` first.
 *
 * Exported for test — the negative (a `waiting` worker on a merged slice) is the
 * half a `LIVE_WORKERS`-only gate gets wrong, since `waiting` is in that set.
 */
export function soleRowStatus(
  row: Pick<AgentRow, 'worker' | 'worker_activity' | 'pr' | 'state'>,
): string {
  if (!isFinished(row) && LIVE_WORKERS.has(row.worker)) {
    // The activity cue rides through here too: a slice-of-one whose worker is
    // running still says which kind of running, exactly as the branch row does.
    return workerStatus(row.worker, row.worker_activity);
  }
  return row.pr ? prStatus(row.pr) : stateStatus(row as AgentRow);
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
    // the defect. A slice is meant to be carried out in one branch and one
    // worktree, and this plan was never sliced after its spike.
    case 'unsliced-wave': return 'slice not cut';
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
      // NAMES THE BRANCHES, because repairing this means cutting the slice into
      // one per branch and the reader has to see which are entangled. The
      // sentence says what a slice IS rather than merely that the count is
      // wrong, since the count is the symptom: `plan → * slice → 1 branch`.
      return stuck.waveSiblings.length > 0
        ? [`one slice, ${stuck.waveSiblings.length} branches: ${stuck.waveSiblings.join(', ')}`
           + ' — a slice is carried out in one branch, so this plan needs slicing']
        : ['this slice holds several branches — a slice is carried out in one branch'];
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
 * The set of EXCEPTION states that force a fold open.
 *
 * **NAME THE EXCEPTION, DO NOT COUNT IT.** The plan's own rule: `claimed twice`
 * is a fact a reader acts on; `1 exception` is not. These are the states whose
 * presence in a plan's rows demands that the fold render open.
 *
 * **DOES NOT INCLUDE `ci-failing` or `unpushed`.** Those are facts the row
 * shows for its own reader, but they do not represent structural conflicts
 * that a reader must see immediately. `claimed twice` means two plans disagree
 * on who owns a branch; `conflict` means a PR cannot merge; `unsliced-wave`
 * means the plan was never sliced after its spike. Each is a defect of the
 * estate itself, not a transient state of a build or a local tree.
 *
 * `artifact-conflict` IS included: while the board can auto-resolve it, the
 * reader needs to know it is happening, and hiding it would defeat the
 * exception rule.
 */
export const EXCEPTION_STATES: ReadonlySet<StuckState> = new Set([
  'double-claimed',
  'conflict',
  'artifact-conflict',
  'unsliced-wave',
]);

/**
 * Does a plan group hold any exception that should force its fold open?
 *
 * A fold containing an exception renders UNFOLDED so the reader sees the
 * conflict immediately — the plan's own rule: *folding may hide repetition,
 * never exceptions.*
 *
 * Exported for test: the boundary between `ci-failing` (not an exception) and
 * `conflict` (an exception) is the case a blanket "row is stuck" check gets
 * wrong — and a row with NO `stuck` at all is the case a `!== null` check gets
 * wrong, in a louder way (see below).
 */
export function hasExceptions(rows: Pick<AgentRow, 'stuck'>[]): boolean {
  // TRUTHINESS, NOT `!== null` — the field arrives ABSENT, not null. The client
  // CASTS the fleet payload rather than parsing it, so a Zod default never runs
  // on this side and `stuck` is `undefined` on every row whose producer omitted
  // it. `undefined !== null` is true, so a null-check falls through to
  // `.state` and throws — which unmounts PlanRow, and with it the whole
  // section. Measured 2026-08-27: 16 browser tests timed out waiting for
  // `Waiting on you`, because the section never rendered at all.
  return rows.some((r) => r.stuck && EXCEPTION_STATES.has(r.stuck.state));
}

/**
 * The exception summary for a folded plan head — the names, not the count.
 *
 * **NAME THE EXCEPTION, DO NOT COUNT IT**, using `nameList`'s grammar: at most
 * three names, then `and N more`. A reader must be able to decide whether to
 * unfold without unfolding, and `claimed twice` is a decision while
 * `1 exception` is not.
 *
 * **A CLEAN FOLD SHOWS NO EXCEPTION CLAUSE.** An empty return means no
 * exceptions — the caller renders nothing rather than `0 problems`, which would
 * teach a reader to stop reading the line.
 *
 * The words are `stuckWord`'s, so the summary names each state the same way the
 * branch row names it.
 *
 * Exported for test: the negative case (a plan holding only `ci-failing` rows)
 * is what an implementation that names every stuck state gets wrong while
 * looking correct on a plan with conflicts.
 */
export function exceptionSummary(rows: Pick<AgentRow, 'stuck'>[]): string {
  // Collect the unique exception state WORDS from the rows.
  const seen = new Set<string>();
  for (const r of rows) {
    // Truthiness, for the same reason as `hasExceptions` above: `stuck` is
    // absent rather than null on a row whose producer omitted it.
    if (r.stuck && EXCEPTION_STATES.has(r.stuck.state)) {
      seen.add(stuckWord(r.stuck.state));
    }
  }
  if (seen.size === 0) return '';
  // `nameList` expects a noun, and these are state names that stand alone:
  // `claimed twice`, `conflict`, not `exception claimed twice`. Use an empty
  // noun so the result reads `claimed twice, conflict` without a prefix.
  const words = [...seen];
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]}, ${words[1]}`;
  if (words.length === 3) return `${words[0]}, ${words[1]}, ${words[2]}`;
  // More than 3 unique exception types — unlikely but handle it.
  const shown = words.slice(0, 3);
  const rest = words.length - shown.length;
  return `${shown.join(', ')} and ${rest} more`;
}
