import { describe, expect, it } from 'vitest';
import { answered } from '@plot-pm/domain';
import type { Processes, Trees, Worktree } from '@plot-pm/domain';
import { runDirtyKind, type Context } from '../../src/server/entry/reap.js';

/**
 * `runDirtyKind` MUST READ `dirtyPathsWithStatus`, NOT `dirtyPaths`.
 *
 * The two filters exclude different things (`trees.ts:99` vs `:117`):
 * `dirtyPaths` excuses Plot's own worker-record and editor-leftover paths for
 * a monitor comparing two passes; `dirtyPathsWithStatus` excuses the
 * `.plot/state` pulse fixture and named cleanup files for a reaper's
 * human-facing refusal text. A desk whose only dirt is `.plot/state` is
 * excused by `dirtyPathsWithStatus` and NOT by `dirtyPaths`, so reading the
 * wrong filter reports a leftover that is not one.
 */

const worktree = (overrides: Partial<Worktree> = {}): Worktree => ({
  path: '/worktrees/desk-a',
  branch: 'feature/desk-a',
  detached: false,
  isMain: false,
  clean: false,
  agentSession: null,
  prunable: false,
  ...overrides,
});

const noopProcesses = {
  isAlive: async () => answered(false),
  workerState: async () => answered({ state: 'none', pid: '' }),
  startedAt: async () => answered(null),
  uptimeSeconds: async () => answered(null),
} as unknown as Processes;

/** A `Trees` port stub naming one worktree, with both dirty filters controllable. */
const treesStub = (
  trees: readonly Worktree[],
  dirtyPaths: readonly string[],
  dirtyPathsWithStatus: readonly string[],
): Trees =>
  ({
    list: async () => answered(trees),
    forBranch: async () => answered(null),
    presence: async () => answered('present'),
    isClean: async () => answered(dirtyPaths.length === 0),
    markers: async () => answered([]),
    dirtyPaths: async () => answered(dirtyPaths),
    dirtyPathsWithStatus: async () => answered(dirtyPathsWithStatus),
    changedUnder: async () => answered([]),
    quietSeconds: async () => answered(null),
    unpushedCommits: async () => answered([]),
    unpushedPatches: async () => answered([]),
    deleteBranch: async () => answered(undefined),
    removeOnly: async () => answered(undefined),
    prune: async () => answered(undefined),
  }) as unknown as Trees;

const ctxFor = (trees: Trees): Context =>
  ({
    repoRoot: '/repo',
    invokedFrom: '/repo',
    scriptDir: '/repo/skills/plot/scripts',
    refs: {},
    host: {},
    scripts: {},
    trees,
    processes: noopProcesses,
    fetch: async () => undefined,
  }) as unknown as Context;

describe('runDirtyKind', () => {
  it('reports nothing for a desk whose only dirt is desk_dirt-excused but plot_worker_dirty-caught', async () => {
    // `dirtyPaths` (the WRONG filter `runDirtyKind` used to call) still
    // reports the `.plot/state` pulse fixture as dirty; `dirtyPathsWithStatus`
    // (the RIGHT filter) has already excused it and reports nothing.
    const trees = treesStub([worktree()], ['.plot/state/pulse.json'], []);
    const ctx = ctxFor(trees);
    const lines: string[] = [];

    const count = await runDirtyKind(ctx, '/repo/.plot/agents', (s) => lines.push(s));

    expect(count).toBe(0);
    expect(lines.join('')).not.toContain('LEFTOVER');
  });

  it('still reports a desk whose dirt survives dirtyPathsWithStatus and nobody owns it', async () => {
    const trees = treesStub([worktree()], [], ['?? half-done.txt']);
    const ctx = ctxFor(trees);
    const lines: string[] = [];

    const count = await runDirtyKind(ctx, '/repo/.plot/agents', (s) => lines.push(s));

    expect(count).toBe(1);
    expect(lines.join('')).toContain('LEFTOVER');
  });

  it('does not count a PLOT-BLOCKED marker line as dirt', async () => {
    const trees = treesStub([worktree()], [], ['?? PLOT-BLOCKED.md']);
    const ctx = ctxFor(trees);
    const lines: string[] = [];

    const count = await runDirtyKind(ctx, '/repo/.plot/agents', (s) => lines.push(s));

    expect(count).toBe(0);
  });
});
