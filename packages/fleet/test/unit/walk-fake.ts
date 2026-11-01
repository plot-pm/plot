import type { Refs } from '@plot-pm/domain/ports/refs';

import type { WalkPorts } from '../../src/shared/fleet-scan.js';

const ok = <T>(value: T) => ({ ok: true as const, value });

/**
 * Adds the reads the plan walk makes to a refs fake that answers an empty estate.
 *
 * @param refs - the fake to extend; its own answers win.
 * @returns refs that resolve every ref and read no plan, branch or blob.
 */
export const withWalkRefs = (refs: Partial<Refs> = {}): Refs =>
  ({
    resolve: async () => ok('abc1234def5678'),
    listBlobs: async () => ok([]),
    branchTips: async () => ok([]),
    readBlobs: async () => ok(new Map()),
    remoteUrl: async () => ok(''),
    defaultBranch: async () => ok('main'),
    mergeSubjects: async () => ok([]),
    commitFiles: async () => ok([]),
    changedFiles: async () => ok([]),
    commitSubjects: async () => ok([]),
    containsMany: async () => ok(new Map()),
    planAdditions: async () => ok(new Map()),
    planAuthors: async () => ok(new Map()),
    ...refs,
  }) as unknown as Refs;

/**
 * Ports over an empty repository: no plans, no branches, no worktrees.
 *
 * @param extra - ports to override.
 * @returns the walk's ports.
 */
export const emptyWalk = (extra: Partial<WalkPorts> = {}): WalkPorts => ({
  host: {
    backend: async () => ok('github'),
    prList: async () => ok([]),
    lastRefusal: () => ({ kind: 'failed', said: '' }),
  } as unknown as WalkPorts['host'],
  plans: () => ({ readPlansAt: async () => ok([]) }) as unknown as ReturnType<WalkPorts['plans']>,
  worktree: { listDir: async () => ok([]), readPlans: async () => ok([]) } as unknown as WalkPorts['worktree'],
  trees: { list: async () => ok([]), fetch: async () => ok(undefined) } as unknown as WalkPorts['trees'],
  agents: {} as unknown as WalkPorts['agents'],
  processes: {} as unknown as WalkPorts['processes'],
  ...extra,
});
