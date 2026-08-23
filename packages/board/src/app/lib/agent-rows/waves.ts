import {
  type AgentRow,
  type WaveVerdict,
  type RowKind,
  UNNAMED_WAVE,
} from '../../../contract/schema.js';

/**
 * How many of a wave's branches have MERGED, where its branches disagree on
 * state — or null where they agree and the single count already tells the story.
 *
 * A collapsed wave row speaks for several branches now, so it must not read
 * plain `merged` for a wave that is half open — *"the same lie in fewer rows"*.
 *
 * `deferred` is NOT a disagreement: a deferred branch is exempt from the merge
 * gate by design, so a wave of {merged, deferred} agrees that everything wanted
 * has landed. The split that matters is merged vs. genuinely-unfinished
 * (open · wip · claimed).
 */
export function waveDissent(rows: AgentRow[]): number | null {
  const merged = rows.filter((r) => r.state === 'merged').length;
  const unfinished = rows.filter(
    (r) => r.state === 'open' || r.state === 'wip' || r.state === 'claimed',
  ).length;
  return merged > 0 && unfinished > 0 ? merged : null;
}

/**
 * The sentence a GROUPED wave row carries, by what its count means — for the two
 * words a count actually names, a disagreement where one exists, and NOTHING for
 * any other word.
 *
 * Each answer says what the wave IS, and none of them is *may this be started* —
 * which is the only thing the verdict can say, and the reason these rows do not
 * use it. `delivered` and `stalled` are the whole vocabulary: DONE folds
 * delivered branches, QUIET folds stalled ones, and those are the only sections
 * where the count carries a meaning a sentence can state.
 *
 * WHERE THE WAVE'S BRANCHES DISAGREE, the note says so and outranks the word:
 * `mergedCount` branches have landed while the rest have not, and a row reading
 * a single settled word over a half-open wave would be the collapse buying
 * density with accuracy. Null `mergedCount` is a wave whose branches agree, and
 * it keeps the ordinary sentence.
 *
 * A NOTE IS DERIVED, NEVER DEFAULTED INTO. The default used to assert `work
 * landed — waiting to be merged` for ANY unrecognised word, and `to approve` — a
 * wave whose plan is still in review, no PR opened, nothing pushed — hit it:
 * measured 2026-08-23 on five live blocked waves, every one claimed a merge was
 * pending over branches never touched, two lines above their own rows reading
 * *plan not approved yet — still in review*. Absent is not false, and here the
 * default made absent WORSE than false — a positive claim about work that does
 * not exist.
 *
 * So an unknown word returns `''`. Empty is falsy, and the caller's `waveNote`
 * ternary falls through it to the VERDICT — the value that actually describes an
 * ungrouped-meaning wave, and the arm that was dead for every multi-branch wave
 * while this function answered for words it did not understand.
 *
 * THE DISSENT ARM IS CHECKED FIRST AND STILL CANNOT RESURRECT THE DEFAULT: it
 * fires only on a measured disagreement, so it never speaks for a wave with no
 * merged branch at all — which is the population the default was lying about.
 */
export function groupedNote(word: string | undefined, mergedCount?: number | null): string {
  if (mergedCount != null) return `${mergedCount} merged, the rest not yet`;
  switch (word) {
    case 'delivered': return 'landed — nothing left in it';
    case 'stalled': return 'nothing has moved here for a while';
    default: return '';
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
