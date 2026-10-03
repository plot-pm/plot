/**
 * What a branch's board row needs, to answer a Draft plan's placement for it.
 *
 * `state` and `planPhase` are both plain `string`, read verbatim as the scan
 * and the plan parser spell them — an unrecognised word still gets an answer,
 * and `planPhase: ''` (a pre-#140 scan) answers `null`, same as every phase
 * check in `classifyGroup`.
 */
export interface DraftPlacementReadings {
  /** `PlanSchema.phase`, verbatim; `''` when the scan did not say. */
  readonly planPhase: string;
  /** The branch's state from the pulse, verbatim. */
  readonly state: string;
  /** The written reason on a `deferred` branch, `''` when none. */
  readonly deferredReason: string;
  /** `ageMinutes !== null && ageMinutes <= quietMinutes`. */
  readonly fresh: boolean;
  /** `localDirty || localLocked || held || localAhead > 0`. */
  readonly local: boolean;
}

export type DraftPlacement =
  | { readonly group: 'waiting-on-you'; readonly note: 'draft' }
  | { readonly group: 'quiet'; readonly note: string }
  | null;

/**
 * Where a Draft plan's branch belongs, or `null` when the phase does not
 * decide.
 *
 * Answers only where a Draft plan's branch would otherwise read NOT STARTED,
 * so after this rule the invariant holds for every state: no row pairs
 * `verdict: unapproved` with `group: not-started`.
 *
 * A stale `claimed`/`wip` branch (neither `fresh` nor `local`) answers `null`:
 * the arm's own stale path already answers WAITING ON YOU with an
 * abandonment note, which says more than the draft note. A `merged` branch
 * answers `null`: the merged arm answers DONE.
 *
 * @param readings What the board row knows about the branch and its plan.
 * @returns The placement a Draft plan's branch takes, or `null` to leave the
 * caller's own arm to decide.
 */
export const draftPlacement = (readings: DraftPlacementReadings): DraftPlacement => {
  if (readings.planPhase !== 'draft') return null;
  if (readings.state === 'merged') return null;
  if (readings.state === 'deferred') {
    return readings.deferredReason !== ''
      ? { group: 'quiet', note: readings.deferredReason }
      : { group: 'waiting-on-you', note: 'draft' };
  }
  if (readings.state === 'claimed' || readings.state === 'wip') {
    return readings.fresh || readings.local ? { group: 'waiting-on-you', note: 'draft' } : null;
  }
  return { group: 'waiting-on-you', note: 'draft' };
};
