import { describe, expect, it } from 'vitest';

import { READING_KEYS } from '../src/entities/snapshot.js';
import { staleReadings, type SnapshotChange } from '../src/rules/snapshot-stale.js';

const desk = '/repo/.worktrees/x';

// One row per row of the story's *Triggers* table, in its order.
const rows: ReadonlyArray<readonly [string, SnapshotChange, ReturnType<typeof staleReadings>]> = [
  ['a ref or packed-refs changes', { kind: 'refs' }, [{ key: 'refs' }, { key: 'plans' }, { key: 'walk' }, { key: 'branchDates' }, { key: 'ideaPlans' }, { key: 'releaseVersions' }, { key: 'unmerged' }, { key: 'branchPlans' }, { key: 'sprints' }, { key: 'stories' }]],
  ["a desk's git state changes", { kind: 'desk-git', desk }, [{ key: 'desks', desk }, { key: 'walk' }]],
  [
    "a desk's own files change",
    { kind: 'desk-files', desk },
    [
      { key: 'deskFiles', desk },
      { key: 'workers', desk },
      { key: 'walk' },
      { key: 'questions' },
    ],
  ],
  ["a worker's log grows", { kind: 'worker-log', desk }, [{ key: 'workers', desk }, { key: 'walk' }]],
  ['a worker ends without a record', { kind: 'worker-gone', desk }, [{ key: 'workers', desk }, { key: 'walk' }]],
  ['the host answers new PR rows', { kind: 'host-answer', reading: 'prs' }, [{ key: 'prs' }, { key: 'walk' }]],
  ['the host answers new issue rows', { kind: 'host-answer', reading: 'issues' }, [{ key: 'issues' }]],
  ['the host answers a new default-branch reading', { kind: 'host-answer', reading: 'defaultBranch' }, [{ key: 'defaultBranch' }]],
  ['a remote change', { kind: 'remote' }, [{ key: 'refs' }, { key: 'plans' }, { key: 'walk' }, { key: 'branchDates' }, { key: 'ideaPlans' }, { key: 'releaseVersions' }, { key: 'unmerged' }, { key: 'branchPlans' }, { key: 'sprints' }, { key: 'stories' }]],
  ['a deadline passes', { kind: 'deadline' }, []],
  ['plan, sprint or story content changes', { kind: 'plan-content' }, [{ key: 'plans' }, { key: 'walk' }]],
  ['the agent registry changes', { kind: 'registry' }, [{ key: 'registry' }]],
  ['the config file changes', { kind: 'config' }, [{ key: 'config' }, { key: 'walk' }]],
];

describe('staleReadings', () => {
  it.each(rows)('maps %s to its readings', (_trigger, change, expected) => {
    expect(staleReadings(change)).toEqual(expected);
  });

  it('maps the safety net to every key', () => {
    expect(staleReadings({ kind: 'safety-net' })).toEqual(READING_KEYS.map((key) => ({ key })));
  });
});
