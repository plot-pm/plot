import type { StartabilityVerdict } from './verdict.js';

/**
 * What a branch's board row knows about a claimed or `wip` branch, to place it
 * when no worker is known.
 */
export interface UnworkedPlacementReadings {
  /** The branch's state from the pulse, verbatim. */
  readonly state: string;
  /** The scan reads a `running` or `waiting` worker on the branch. */
  readonly workerLive: boolean;
  /** `ageMinutes !== null && ageMinutes <= quietMinutes`. */
  readonly fresh: boolean;
  /** `localDirty || localLocked || localAhead > 0`. */
  readonly local: boolean;
}

/** The section and startability a claimed or `wip` branch with no known worker takes. */
export type UnworkedPlacement = {
  readonly group: 'working';
  readonly startability: 'no-known-worker';
} | null;

/**
 * Where a claimed or `wip` branch with no known worker belongs, or `null` when
 * the branch keeps the caller's own arm.
 *
 * Answers WORKING with startability `no-known-worker` for a `claimed` or `wip`
 * branch that has no live worker and is `fresh` or `local`. It is the only
 * source of `no-known-worker`: the section and the label come from this one
 * answer. A stale branch with no local activity answers `null`.
 *
 * @param readings What the board row knows about the branch.
 * @returns The placement, or `null` to leave the caller's arm to decide.
 */
export const unworkedPlacement = (readings: UnworkedPlacementReadings): UnworkedPlacement => {
  if (readings.state !== 'claimed' && readings.state !== 'wip') return null;
  if (readings.workerLive) return null;
  return readings.fresh || readings.local
    ? { group: 'working', startability: 'no-known-worker' }
    : null;
};

/**
 * What a row needs, to decide whether its note shows.
 */
export interface NoteShownReadings {
  readonly startability: StartabilityVerdict | null;
  readonly group: string | null;
  /** The row's quiet kind, or `null` where it has none. */
  readonly quietKind: string | null;
}

/**
 * Whether a row prints its note.
 *
 * A row in QUIET with a `quietKind` shows its note. A row whose startability is
 * `someone-is-on-it` shows none. Every other row shows its note.
 *
 * @param readings The row's startability, group and quiet kind.
 * @returns `true` where the note shows.
 */
export const noteShown = (readings: NoteShownReadings): boolean => {
  if (readings.group === 'quiet' && readings.quietKind !== null) return true;
  return readings.startability !== 'someone-is-on-it';
};
