/**
 * What an open PR's board row needs, to answer which group it belongs to.
 *
 * `mergeable` and `checks` are read verbatim as the adapter spells them —
 * `mergeable` absent or any word other than `'mergeable'` is treated the same
 * as `'unknown'`, matching `prState`/`prStates`/`prEvidence`/`draftNote`.
 */
export interface PrRowReadings {
  /** `'mergeable' | 'conflicting' | 'unknown'`, or absent — see `PrRecord.mergeable`. */
  readonly mergeable: string | undefined;
  /** `'green' | 'pending' | 'failing' | 'none' | 'unknown'` — see `PrRecord.checks`. */
  readonly checks: string;
}

export type PrRowPlacement =
  | { readonly group: 'waiting-on-you'; readonly clause: 'conflicts' }
  | { readonly group: 'waiting-on-you'; readonly clause: 'cannot say whether it merges' }
  | { readonly group: 'waiting-on-machine'; readonly clause: 'CI running' }
  | { readonly group: 'waiting-on-you'; readonly clause: 'checks failing' }
  | { readonly group: 'waiting-on-you'; readonly clause: 'no checks' }
  | { readonly group: 'waiting-on-you'; readonly clause: 'cannot read the checks' }
  | { readonly group: 'waiting-on-you'; readonly clause: 'green' };

/**
 * Which group an open PR's row belongs to, and the clause naming why.
 *
 * The conflict outranks the checks, and unknown mergeability outranks a
 * pending check: `mergeable === 'conflicting'` is read first, then
 * `mergeable !== 'mergeable'`, and only then `checks`. GitHub starts no
 * workflow for a branch that does not merge, so a conflicting PR reports an
 * empty rollup — reading `checks` first would misreport that as "no checks"
 * and, for `unknown` + `pending`, as CI running on a PR nobody can rebase yet.
 *
 * `checks: 'pending'` with `mergeable === 'mergeable'` is the one row this
 * rule moves away from `prState`'s and `classifyGroup`'s older behaviour: it
 * answers `waiting-on-machine`, not `waiting-on-you`. Every other input keeps
 * the placement those functions already gave it.
 *
 * @param readings What the row knows about the PR's mergeability and checks.
 * @returns The group the row belongs to and the clause for its note.
 */
export const prRowPlacement = (readings: PrRowReadings): PrRowPlacement => {
  if (readings.mergeable === 'conflicting') {
    return { group: 'waiting-on-you', clause: 'conflicts' };
  }
  // A PENDING CHECK ESCAPES UNKNOWN MERGEABILITY, and it is the one thing that
  // does: GitHub answers `unknown` for `mergeable` while it recomputes after
  // every push, which is exactly when CI starts, so a run already in flight is
  // evidence the row can act on regardless of what `mergeable` says. Every
  // other checks value stays behind "cannot say whether it merges" — the
  // checks may well be fine, but reporting them would be a second guess
  // layered on the first.
  if (readings.mergeable !== 'mergeable' && readings.checks === 'pending') {
    return { group: 'waiting-on-machine', clause: 'CI running' };
  }
  if (readings.mergeable !== 'mergeable') {
    return { group: 'waiting-on-you', clause: 'cannot say whether it merges' };
  }
  switch (readings.checks) {
    case 'pending':
      return { group: 'waiting-on-machine', clause: 'CI running' };
    case 'failing':
      return { group: 'waiting-on-you', clause: 'checks failing' };
    case 'none':
      return { group: 'waiting-on-you', clause: 'no checks' };
    case 'green':
      return { group: 'waiting-on-you', clause: 'green' };
    // Anything the adapter could not report, including a value this build does
    // not know — the same fallback `checkWord` gives every unrecognised word.
    // A missing field must not move the row toward the quieter `green`.
    default:
      return { group: 'waiting-on-you', clause: 'cannot read the checks' };
  }
};
