import { READING_KEYS, type ReadingKey } from '../entities/snapshot.js';

/**
 * One change a trigger reports, one kind per row of the *Triggers* table in
 * `docs/stories/nothing-changed-nothing-runs/`.
 *
 * `desk` is the desk's absolute path.
 */
export type SnapshotChange =
  | { kind: 'refs' }
  | { kind: 'desk-git'; desk: string }
  | { kind: 'desk-files'; desk: string }
  | { kind: 'worker-log'; desk: string }
  | { kind: 'worker-gone'; desk: string }
  | { kind: 'host-answer'; reading: 'prs' | 'issues' | 'defaultBranch' }
  | { kind: 'remote' }
  | { kind: 'deadline' }
  | { kind: 'plan-content' }
  | { kind: 'registry' }
  | { kind: 'config' }
  | { kind: 'safety-net' };

/** A reading a change makes stale; `desk` limits it to one desk where the reading is kept per desk. */
export interface StaleReading {
  key: ReadingKey;
  desk?: string;
}

/**
 * Maps a change to the readings it makes stale.
 *
 * @param change - what a trigger reported.
 * @returns the readings to read again. A remote change names `refs`, read
 *   through one fetch, and the readings taken from the refs. Every change the
 *   plan walk reads also names `walk`. A deadline names none: the rule that
 *   owns the deadline runs over the readings already held. The safety net
 *   names every key.
 */
export const staleReadings = (change: SnapshotChange): readonly StaleReading[] => {
  switch (change.kind) {
    case 'refs':
    case 'remote':
      return [
        { key: 'refs' },
        { key: 'walk' },
        { key: 'branchDates' },
        { key: 'ideaPlans' },
        { key: 'releaseVersions' },
        { key: 'unmerged' },
      ];
    case 'desk-git':
      return [{ key: 'desks', desk: change.desk }, { key: 'walk' }];
    case 'desk-files':
      return [
        { key: 'deskFiles', desk: change.desk },
        { key: 'workers', desk: change.desk },
        { key: 'walk' },
        { key: 'questions' },
      ];
    case 'worker-log':
    case 'worker-gone':
      return [{ key: 'workers', desk: change.desk }, { key: 'walk' }];
    case 'host-answer':
      return change.reading === 'prs' ? [{ key: 'prs' }, { key: 'walk' }] : [{ key: change.reading }];
    case 'deadline':
      return [];
    case 'plan-content':
      return [{ key: 'plans' }, { key: 'walk' }];
    case 'registry':
      return [{ key: 'registry' }];
    case 'config':
      return [{ key: 'config' }, { key: 'walk' }];
    case 'safety-net':
      return READING_KEYS.map((key) => ({ key }));
  }
};
