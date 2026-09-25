/**
 * The status words a repository configured, one per finishing phase.
 *
 * `''` means that phase writes nothing. It is not a status to write.
 */
export interface IssueStatusWords {
  /** The word a `Delivered` plan writes; `''` where the phase writes nothing. */
  readonly delivered: string;
  /** The word a `Released` plan writes; `''` where the phase writes nothing. */
  readonly released: string;
}

/** What a finished plan is read as, for the status it owes. */
export interface IssueStatusReading {
  /** The plan's phase, lowercased as `plot-plan-meta.sh` reports it. */
  readonly phase: string;
  /** The issues the plan answers, in the order the plan names them. */
  readonly issues: readonly string[];
  /** The configured status words. */
  readonly words: IssueStatusWords;
}

/** One status a tracker is owed: the issue and the word to write to it. */
export interface IssueStatusWrite {
  /** The issue's identifier, verbatim — a number on one tracker, a key on another. */
  readonly issue: string;
  /** The status word, verbatim from configuration. */
  readonly status: string;
}

/**
 * Decides which status writes a plan owes its tracker.
 *
 * Only `delivered` and `released` owe a write, each through its own word. A
 * phase whose word is empty owes nothing: one key never stands in for the
 * other.
 *
 * @param reading - the plan's phase, its issues and the configured words.
 * @returns one write per issue; empty where the phase owes none, the plan names
 *   no issue, or that phase's word is empty.
 */
export const issueStatusWrites = (reading: IssueStatusReading): readonly IssueStatusWrite[] => {
  const status =
    reading.phase === 'delivered'
      ? reading.words.delivered
      : reading.phase === 'released'
        ? reading.words.released
        : '';
  if (status === '') return [];
  return reading.issues.filter((issue) => issue !== '').map((issue) => ({ issue, status }));
};
