/**
 * What kind of quiet a branch nobody is on is in.
 *
 * QUIET IS A FALLTHROUGH, and that is the defect this rule answers.
 * `classifyGroup` ends by describing whatever nothing else matched by commit
 * age, and **age is not a state**: *"no commit for 126 days"* is equally true
 * of work somebody rejected, work somebody abandoned, and work nobody started.
 * Measured 2026-09-03 on this estate, 26 rows said QUIET — 17 closed PRs, 2
 * claim-only branches, 6 abandoned — and the last eight said *in progress*
 * while zero workers ran.
 *
 * - `closed-pr` — the host closed a PR for this branch without merging it.
 *   **A decision, not silence.** Somebody looked and said no.
 * - `orphaned-claim` — the branch carries only the empty `plot: claim` commit.
 *   Nobody started the work.
 * - `abandoned` — real commits, no PR ever opened, nobody on it. The one kind
 *   that needs a person: revive it, or drop it.
 * - `quiet` — a branch nobody is on that none of the above describes.
 *
 * `orphaned-claim` IS THE SWEEP'S WORD, deliberately. `sweepable.ts` names the
 * kind `'claim-ref'` and `plot-reap.sh --dry-run` already reports orphaned
 * claims, so a reader who meets one on the board finds the same thing in the
 * sweep's output rather than a second name for one thing.
 *
 * `quiet` KEEPS ITS OWN NAME rather than becoming *unclassified*. It is a real
 * answer here — the branch has work, has an open or absent PR, and nothing is
 * happening on it — not a residue. Should a population still land here that
 * deserves its own word, that word is what the next reading adds.
 */
export type QuietKind = 'merged' | 'closed-pr' | 'orphaned-claim' | 'abandoned' | 'quiet';

/**
 * What was measured of one branch nobody is on.
 *
 * **EVERY FIELD IS A READING.** The rule performs no I/O and consults no
 * ancestry. Whether the host merged a PR is `plot-pr-merged.sh`'s answer passed
 * in — never `git merge-base`, because a squash-merge leaves a branch
 * permanently ahead of the default branch, so ancestry answers *not merged*
 * about work that landed weeks ago.
 */
export interface QuietBranchReadings {
  /**
   * The branch's name.
   *
   * Carried for the caller's report and read by no arm. A reading a rule does
   * not test still travels with the ones it does — otherwise the caller re-joins
   * each answer to its branch by position, and a filter anywhere between the
   * two silently shifts every row's label by one.
   */
  branch: string;
  /**
   * The host's state for the branch's PR, or `'none'` where it opened none.
   *
   * `'closed'` MEANS CLOSED WITHOUT MERGING. A merged PR reports `CLOSED`
   * through some hosts, which is why `hasMergedPr` is a separate reading and
   * outranks this one below — reading the word alone would file every merged
   * branch as a rejection.
   */
  prState: 'none' | 'open' | 'closed';
  /**
   * Whether the host merged ANY PR for this branch.
   *
   * Read from the merge timestamp, the same source `sweepable.ts` names. An
   * unreachable host answers `false`, so silence is never a merge.
   */
  hasMergedPr: boolean;
  /**
   * Whether the branch carries ONLY empty claim commits.
   *
   * The definition is `ClaimRefReadings.isEmptyClaim`'s and is taken from the
   * same place: a claim marker is titled `plot: claim ...` **and** empty. The
   * subject alone is not evidence — a human commit titled *"plot: claim
   * handling refactor"* carrying real files would otherwise read as an empty
   * claim, and the board would tell a person nobody had started work that
   * exists.
   */
  isEmptyClaim: boolean;
}

/**
 * What kind of quiet this branch is in.
 *
 * The order is the evidence order, and each arm outranks the ones below it
 * because it rests on a stronger fact:
 *
 * 1. **A merge outranks the PR word.** A merged PR reports `CLOSED` through
 *    some hosts, so testing `prState` first would file every merged branch as a
 *    rejection — 85 of this estate's 98 local branches are merged.
 *
 *    It answers `merged`, and that IS the fifth kind this rule refused to
 *    invent until 2026-09-04. The refusal rested on a premise — *which section
 *    says so is `classifyGroup`'s to decide, above this rule* — and the premise
 *    only held for a branch the scan itself calls `merged`. One that
 *    squash-merged with its head ref deleted arrives `wip`, reaches the
 *    fallthrough, and got the note for the kind it fell back to: six landed
 *    branches on this estate read *"nobody is on it"*, which is a sentence
 *    about an idle branch and not about shipped work.
 * 2. **A closed PR is a decision**, and a decision outranks every fact about
 *    the branch's contents: it does not matter how much work is on a branch
 *    somebody rejected.
 * 3. **An empty claim is nobody's work**, which outranks the absence of a PR —
 *    a branch with no commits has nothing to open a PR about.
 * 4. **Real commits and no PR is abandonment.** An OPEN PR is not abandoned:
 *    the work is up for review and the wait is somebody else's.
 *
 * @param readings - what was measured of the branch.
 * @returns the kind of quiet, or `'quiet'` when none of the three describes it.
 */
export const quietKind = (readings: QuietBranchReadings): QuietKind => {
  if (readings.hasMergedPr) return 'merged';
  if (readings.prState === 'closed') return 'closed-pr';
  if (readings.isEmptyClaim) return 'orphaned-claim';
  if (readings.prState === 'none') return 'abandoned';
  return 'quiet';
};

/**
 * What this branch is, in a sentence a row can print.
 *
 * **IT ASKS {@link quietKind} FIRST** rather than re-deriving the four cases,
 * so the word and its explanation cannot describe different branches — the
 * shape `whyNotFree` established. Restating the conditions is how a row comes
 * to be labelled `abandoned` and captioned *closed without merging*.
 *
 * The sentence names the STATE, never the age. Age is what the fallthrough said
 * when it had nothing else, and it is the fact this rule exists to stop
 * standing in for a state. A caller that wants to append *"and it has been 126
 * days"* holds the age already and can say so beside this.
 *
 * @param readings - what was measured of the branch.
 * @returns the sentence for the kind.
 */
export const quietNote = (readings: QuietBranchReadings): string => {
  switch (quietKind(readings)) {
    case 'merged':
      return 'merged';
    case 'closed-pr':
      return 'PR closed without merging';
    case 'orphaned-claim':
      return 'claimed, no work committed';
    case 'abandoned':
      return 'commits, no PR ever opened';
    case 'quiet':
      return 'nobody is on it';
  }
};

/**
 * Whether this quiet branch still needs somebody to look at it.
 *
 * NAMED FOR ITS SUBJECT. `attention.ts` owns the estate-wide attention
 * question over findings; this one answers only about a branch nobody is on,
 * and a bare `needsAttention` here would read as the other.
 *
 * `closed-pr` DOES NOT: somebody already decided, and a decision is not a thing
 * to look at. It is the answer that empties 17 of this estate's 26 quiet rows,
 * and the reason the other kinds are readable at all.
 *
 * Every other kind does, for its own reason — an orphaned claim is a branch
 * nobody started, abandoned work is a revive-or-drop call, and a plain quiet
 * branch is the one the classifier could not name.
 *
 * @param readings - what was measured of the branch.
 * @returns true when the branch is still a person's to answer.
 */
export const quietNeedsPerson = (readings: QuietBranchReadings): boolean => {
  const kind = quietKind(readings);
  return kind !== 'closed-pr' && kind !== 'merged';
};
