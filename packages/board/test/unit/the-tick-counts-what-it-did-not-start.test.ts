import { describe, it, expect } from 'vitest';

import {
  readTick,
  worldFrom,
  type SupervisorWorld,
  type TreeReading,
} from '../../src/server/supervisor.js';
import { tick, tickLine, unclaimedLines } from '../../src/server/entry/registryd.js';
import type { AgentEntry } from '../../src/server/registry.js';

/** One registry manifest, in the shape `plot-dispatch.sh` writes it. */
const manifest = (over: Partial<AgentEntry> = {}): AgentEntry =>
  ({
    session: 'a1b2c3',
    resumeId: 'a1b2c3',
    identity: 'manifest',
    branch: 'feature/one',
    worktree: '/estate/.worktrees/feature-one',
    command: 'plot-worker-loop.sh',
    startedAt: '2026-09-04T10:00:00Z',
    pid: '4242',
    previousPid: '',
    relaunches: 0,
    attempts: 0,
    state: 'none',
    ...over,
  }) as AgentEntry;

/** One entry from `git worktree list --porcelain`, as the world reports it. */
const tree = (over: Partial<TreeReading> = {}): TreeReading => ({
  path: '/private/tmp/wt818',
  branch: '',
  isMain: false,
  prunable: false,
  planNamed: false,
  dirtyCount: 0,
  ...over,
});

/**
 * A world over a quiet estate, with a live worker on every desk.
 *
 * The agents are left alone here on purpose: every test below is about the
 * SECOND population, so nothing a verdict does should reach its assertions.
 */
const world = (over: Partial<SupervisorWorld> = {}): SupervisorWorld => ({
  workerAlive: async () => true,
  merge: async () => 'merged',
  dirtyPath: async () => '',
  blockedMarker: async () => '',
  changesets: async () => [],
  workspacePackages: async () => ['plot'],
  planLine: async () => null,
  madeProgress: async () => true,
  headroom: async () => 'clear',
  deskFile: () => null,
  transcriptFound: () => false,
  ...over,
});

describe('the tick counts the trees it did not start', () => {
  it('reports zero on an estate where every worktree is dispatched', async () => {
    // The plan's own done-when. Nothing is printed rather than a line of zeros:
    // a supervisor saying `unclaimed=0` every minute is a field a person stops
    // reading, and the finding exists to be noticed.
    const report = await tick({
      registry: async () => [manifest({ worktree: '/estate/.worktrees/one' })],
      world: world({
        trees: async () => [
          tree({ path: '/estate', isMain: true }),
          tree({ path: '/estate/.worktrees/one', branch: 'feature/one' }),
        ],
      }),
      now: () => 0,
    });

    expect(report.decision.detail.unclaimed).toEqual([]);
    expect(tickLine(report)).not.toContain('unclaimed=');
    expect(unclaimedLines(report)).toEqual([]);
  });

  it('names a hand-made tree nobody dispatched, and what the scan pays for it', async () => {
    const report = await tick({
      registry: async () => [],
      world: world({ trees: async () => [tree()] }),
      now: () => 0,
    });

    expect(tickLine(report)).toContain('unclaimed=1');
    expect(unclaimedLines(report)).toEqual([
      'plot-registryd 1 worktree nobody dispatched — the scan walks all of them, 7ms every pulse',
      '  /private/tmp/wt818 (detached) — git worktree remove /private/tmp/wt818',
    ]);
  });

  it('keeps a DETACHED desk the registry names', async () => {
    // The plan read "a detached tree can never be claimed, so it is unclaimed
    // by construction". Measured 2026-09-09, two of six registered agents here
    // held a detached desk — `plot-dispatch.sh --start` cuts a free agent's
    // tree detached at `origin/<main>`. The registration is the claim, and
    // deriving it from the HEAD shape would name a live worker's desk a
    // leftover.
    const report = await tick({
      registry: async () => [manifest({ branch: '', worktree: '/estate/.worktrees/free-a' })],
      world: world({
        trees: async () => [tree({ path: '/estate/.worktrees/free-a', branch: '' })],
      }),
      now: () => 0,
    });

    expect(report.decision.detail.unclaimed).toEqual([]);
  });

  it('names a dirty tree for a person and prints no command for it', async () => {
    const report = await tick({
      registry: async () => [],
      world: world({
        trees: async () => [tree({ branch: 'feature/two', dirtyCount: 4 })],
      }),
      now: () => 0,
    });

    expect(unclaimedLines(report)).toEqual([
      'plot-registryd 1 worktree nobody dispatched — the scan walks all of them, 7ms every pulse; 1 hold uncommitted work and are for a person to read',
      '  /private/tmp/wt818 (feature/two) — 4 uncommitted, read it before removing it',
    ]);
  });

  it('sends a vanished directory to `git worktree prune`', async () => {
    const report = await tick({
      registry: async () => [],
      world: world({ trees: async () => [tree({ prunable: true })] }),
      now: () => 0,
    });

    expect(unclaimedLines(report)[1]).toBe('  /private/tmp/wt818 (detached) — git worktree prune');
  });

  it('removes nothing and names no write', async () => {
    // IT REPORTS AND DOES NOT REMOVE. The reaper refuses on a dirty tree for
    // the same reason: the supervisor cannot know why a directory exists.
    const report = await tick({
      registry: async () => [],
      world: world({
        trees: async () => [tree({ path: '/private/tmp/a' }), tree({ path: '/private/tmp/b' })],
      }),
      now: () => 0,
    });

    expect(report.decision.detail.unclaimed).toHaveLength(2);
    expect(report.decision.writes).toEqual([]);
  });

  it('reports nothing where nobody asked for the trees', async () => {
    // ABSENT IS *NOBODY ASKED*, NOT *NOTHING WAS CARRIED*. A world built before
    // the finding existed still supervises every desk.
    const report = await tick({ registry: async () => [], world: world(), now: () => 0 });

    expect(report.decision.detail.unclaimed).toEqual([]);
    expect(tickLine(report)).not.toContain('unclaimed=');
  });

  it('reports nothing on a tick that could not complete', async () => {
    const report = await tick({
      registry: async () => {
        throw new Error('the registry directory went away');
      },
      world: world({ trees: async () => [tree()] }),
      now: () => 0,
    });

    expect(report.incomplete).toBe('the registry directory went away');
    expect(report.decision.detail.unclaimed).toEqual([]);
  });
});

describe('readTick joins the registry it supervised from', () => {
  it('asks for the trees ONCE per tick, not once per agent', async () => {
    // A property of the machine rather than of an agent — the same rule the
    // headroom reading follows.
    let asked = 0;
    await readTick(
      [manifest({ worktree: '/a' }), manifest({ worktree: '/b' }), manifest({ worktree: '/c' })],
      world({
        trees: async () => {
          asked += 1;
          return [];
        },
      }),
    );

    expect(asked).toBe(1);
  });

  it('marks a tree registered from the same list the agents were read from', async () => {
    const readings = await readTick(
      [manifest({ worktree: '/estate/.worktrees/one' })],
      world({
        trees: async () => [
          tree({ path: '/estate/.worktrees/one' }),
          tree({ path: '/private/tmp/wt818' }),
        ],
      }),
    );

    expect(readings.trees?.map((t) => [t.path, t.registered])).toEqual([
      ['/estate/.worktrees/one', true],
      ['/private/tmp/wt818', false],
    ]);
  });

  it('carries no trees at all where the world does not read them', async () => {
    const readings = await readTick([manifest()], world());
    expect(readings.trees).toBeUndefined();
  });
});

describe('worldFrom passes the tree reading through', () => {
  /** The options every `worldFrom` call needs, with nothing measured. */
  const options = {
    repoRoot: '/estate',
    isAlive: async () => false,
    prMerged: async () => 'not-merged' as const,
    dirtyPaths: async () => [],
    markers: async () => [],
    planLine: async () => null,
    workspacePackages: async () => [],
    madeProgress: async () => false,
    spawnCostMs: async () => null,
    recordedPid: () => null,
  };

  it('omits the member rather than stubbing it when the caller gave none', async () => {
    // A member answering an empty list would report an estate carrying no
    // worktree at all, which is false of every machine — and `readTick` reads
    // the ABSENCE as *nobody asked*.
    expect(worldFrom(options).trees).toBeUndefined();
  });

  it('hands the reading the caller gave over untouched', async () => {
    const built = worldFrom({ ...options, worktrees: async () => [tree()] });
    expect(await built.trees?.()).toEqual([tree()]);
  });
});
