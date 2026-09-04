import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ALL_GATES, planAnnotatedGate } from '@plot-pm/domain/rules/gates';
import { MAX_ATTEMPTS } from '@plot-pm/domain/rules/supervision';

import {
  readTick,
  gatesFor,
  fileOrNull,
  changesetsIn,
  worldFrom,
  type SupervisorWorld,
} from '../../src/server/supervisor.js';
import { tick, tickLine, TICK_INTERVAL_MS, TICK_COST_MS } from '../../src/server/entry/registryd.js';
import type { AgentEntry } from '../../src/server/registry.js';

const OPEN = '<!' + '--';
const CLOSE = '--' + '>';

const GOOD_CHANGESET = [
  '---',
  "'plot': patch",
  '---',
  '',
  'The registry supervises its agents on a tick it re-reads each time.',
  '',
  OPEN,
  'bumps:',
  '  skills:',
  '    plot: patch',
  CLOSE,
  '',
].join('\n');

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

/**
 * A world in which everything finished. Each test names the one answer it
 * changes, so what drives a verdict is visible in the test.
 */
const world = (over: Partial<SupervisorWorld> = {}): SupervisorWorld => ({
  workerAlive: async () => false,
  merge: async () => 'merged',
  dirtyPath: async () => '',
  blockedMarker: async () => '',
  changesets: async () => [{ path: '.changeset/tidy.md', text: GOOD_CHANGESET }],
  workspacePackages: async () => ['plot', '@plot-pm/board', '@plot-pm/domain'],
  planLine: async () => ({ prs: [692], deferred: false, deferredReason: '' }),
  madeProgress: async () => true,
  headroom: async () => 'clear',
  deskFile: () =>
    JSON.stringify({ branch: 'feature/one', status: 'ok', artifacts: [], pr: 692, summary: 'x' }),
  transcriptFound: () => true,
  ...over,
});

describe('the tick reads the registry and decides', () => {
  it('decides nothing over an empty registry', async () => {
    const report = await tick({ registry: async () => [], world: world() });
    expect(report.agents).toBe(0);
    expect(report.decision.writes).toEqual([]);
  });

  it('reaps an agent that declared ok over a desk that passes every gate', async () => {
    const report = await tick({ registry: async () => [manifest()], world: world() });
    expect(report.decision.detail.reaping).toEqual(['feature/one']);
  });

  it('leaves an agent whose worker is alive', async () => {
    const report = await tick({
      registry: async () => [manifest()],
      world: world({ workerAlive: async () => true }),
    });
    expect(report.decision.detail.left).toEqual(['feature/one']);
    expect(report.decision.writes).toEqual([]);
  });

  it('corrects an agent that left no declaration', async () => {
    const report = await tick({
      registry: async () => [manifest()],
      world: world({ deskFile: () => null }),
    });
    expect(report.decision.detail.correcting).toEqual(['feature/one']);
  });

  it('marks a spent agent for a person', async () => {
    const report = await tick({
      registry: async () => [manifest({ attempts: MAX_ATTEMPTS })],
      world: world({ deskFile: () => null }),
    });
    expect(report.decision.detail.needingAPerson).toEqual(['feature/one']);
  });
});

describe('the tick reads attempts, not relaunches', () => {
  /**
   * THE DEFECT THE PLAN NAMES, asserted where the manifest is read rather than
   * where the rule decides: a manifest carrying nine operator restarts and zero
   * supervisor attempts must still have its full automatic budget.
   */
  it('a manifest with nine manual restarts still gets corrected', async () => {
    const report = await tick({
      registry: async () => [manifest({ relaunches: 9, attempts: 0 })],
      world: world({ deskFile: () => null }),
    });
    expect(report.decision.detail.correcting).toEqual(['feature/one']);
    expect(report.decision.writes[0]).toEqual({
      kind: 'agent-attempt',
      worktree: '/estate/.worktrees/feature-one',
      attempts: 1,
    });
  });

  it('a manifest with no manual restarts and a spent budget stops', async () => {
    const report = await tick({
      registry: async () => [manifest({ relaunches: 0, attempts: MAX_ATTEMPTS })],
      world: world({ deskFile: () => null }),
    });
    expect(report.decision.detail.needingAPerson).toEqual(['feature/one']);
  });
});

describe('the tick holds nothing between calls', () => {
  /**
   * `kill -9` COSTS ONE TICK, PROVEN AT THE DAEMON'S LEVEL. Every tick re-reads
   * the registry and consults no previous one, so running the same tick N times
   * over an unchanged estate produces N identical decisions — there is no
   * counter, no seen-set and no queue to lose.
   */
  const estate = [
    manifest({ branch: 'feature/a', worktree: '/estate/a', session: 'a', resumeId: 'a' }),
    manifest({ branch: 'feature/b', worktree: '/estate/b', session: 'b', resumeId: 'b' }),
  ];

  it('reaches the same decision on every tick', async () => {
    const options = { registry: async () => estate, world: world({ deskFile: () => null }) };
    const first = await tick(options);
    for (let run = 0; run < 3; run += 1) {
      const again = await tick(options);
      expect(again.decision).toEqual(first.decision);
    }
  });

  it('re-reads the registry each tick rather than caching it', async () => {
    // The registry CHANGES between ticks — an agent finishes and its manifest
    // is cleared. A daemon holding the first reading would keep supervising it.
    let entries = [...estate];
    const options = {
      registry: async () => entries,
      world: world({ deskFile: () => null }),
    };
    expect((await tick(options)).decision.detail.correcting).toEqual([
      'feature/a',
      'feature/b',
    ]);
    entries = [estate[0]];
    expect((await tick(options)).decision.detail.correcting).toEqual(['feature/a']);
  });

  it('performs nothing — the decision names writes and makes none', async () => {
    const report = await tick({
      registry: async () => estate,
      world: world({ deskFile: () => null }),
    });
    expect(report.decision.writes.length).toBeGreaterThan(0);
    expect(report.decision.outcome).toBe('decided');
  });
});

describe('the machine is asked once per tick, not once per agent', () => {
  it('takes one headroom sample however many agents there are', async () => {
    let asked = 0;
    await tick({
      registry: async () => [
        manifest({ branch: 'feature/a', worktree: '/estate/a' }),
        manifest({ branch: 'feature/b', worktree: '/estate/b' }),
        manifest({ branch: 'feature/c', worktree: '/estate/c' }),
      ],
      world: world({
        headroom: async () => {
          asked += 1;
          return 'clear';
        },
      }),
    });
    expect(asked).toBe(1);
  });

  it('gives every agent in one tick the same headroom', async () => {
    const report = await tick({
      registry: async () => [
        manifest({ branch: 'feature/a', worktree: '/estate/a' }),
        manifest({ branch: 'feature/b', worktree: '/estate/b' }),
      ],
      world: world({ deskFile: () => null, headroom: async () => 'starved' }),
    });
    expect(report.decision.detail.deferred).toEqual(['feature/a', 'feature/b']);
  });
});

describe('readTick joins the readings the rule needs', () => {
  it('carries the manifest’s resume handle and attempt count through', async () => {
    const readings = await readTick(
      [manifest({ resumeId: 'session-9', attempts: 1 })],
      world(),
    );
    expect(readings.agents[0].resume).toEqual({ resumeId: 'session-9', transcriptFound: true });
    expect(readings.agents[0].attempts).toBe(1);
  });

  it('reports no transcript for a manifest that records no handle', async () => {
    // A MANIFEST WITH NO HANDLE IS NEVER ASKED ABOUT A TRANSCRIPT. Looking one
    // up for an empty id would join on `.jsonl` and could match anything.
    let asked = false;
    const readings = await readTick([manifest({ resumeId: '' })], world({
      transcriptFound: () => {
        asked = true;
        return true;
      },
    }));
    expect(asked).toBe(false);
    expect(readings.agents[0].resume.transcriptFound).toBe(false);
  });

  it('reads the desk’s declaration', async () => {
    const readings = await readTick([manifest()], world());
    expect(readings.agents[0].declaration.read).toBe('declared');
  });

  it('reads an absent declaration as absent, not as unreadable', async () => {
    const readings = await readTick([manifest()], world({ deskFile: () => null }));
    expect(readings.agents[0].declaration.read).toBe('absent');
  });

  it('reads bytes that do not parse as unreadable', async () => {
    const readings = await readTick([manifest()], world({ deskFile: () => 'not json' }));
    expect(readings.agents[0].declaration.read).toBe('unreadable');
  });
});

describe('the annotation gate is dropped where its reading is unavailable', () => {
  /**
   * `PlanRecordBranch` carries `deferred`, `deferredReason` and `claimed` and
   * NO PR numbers, and `plot-plan-meta.sh` emits the PRs a plan annotates as one
   * array for the whole plan. So a line reading `— did the thing → #692` cannot
   * be told from one reading `— did the thing`.
   *
   * Running the gate on that reading fails every correctly annotated branch.
   */
  it('runs all five when the line’s PRs were read', () => {
    expect(gatesFor({ prs: [692], deferred: false, deferredReason: '' })).toEqual(ALL_GATES);
  });

  it('drops the annotation gate when no plan names the branch', () => {
    expect(gatesFor(null)).not.toContain(planAnnotatedGate);
    expect(gatesFor(null)).toHaveLength(ALL_GATES.length - 1);
  });

  it('drops it when the line carries no PR numbers', () => {
    expect(gatesFor({ prs: [], deferred: false, deferredReason: '' })).not.toContain(
      planAnnotatedGate,
    );
  });

  it('does not correct an otherwise finished agent for a line it could not read', async () => {
    const report = await tick({
      registry: async () => [manifest()],
      world: world({ planLine: async () => null }),
    });
    expect(report.decision.detail.reaping).toEqual(['feature/one']);
  });
});

describe('reading one desk from disk', () => {
  it('tells an absent file from an empty one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-supervisor-'));
    try {
      expect(fileOrNull(join(dir, 'nothing.json'))).toBeNull();
      writeFileSync(join(dir, 'empty.json'), '');
      expect(fileOrNull(join(dir, 'empty.json'))).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a directory as absent rather than throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-supervisor-'));
    try {
      expect(fileOrNull(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a desk’s changesets and skips Changesets’ own furniture', async () => {
    const desk = mkdtempSync(join(tmpdir(), 'plot-desk-'));
    try {
      mkdirSync(join(desk, '.changeset'));
      writeFileSync(join(desk, '.changeset', 'tidy-moons.md'), GOOD_CHANGESET);
      writeFileSync(join(desk, '.changeset', 'README.md'), '# not a changeset');
      writeFileSync(join(desk, '.changeset', 'config.json'), '{}');
      const files = await changesetsIn(desk);
      expect(files.map((f) => f.path)).toEqual(['.changeset/tidy-moons.md']);
      expect(files[0].text).toBe(GOOD_CHANGESET);
    } finally {
      rmSync(desk, { recursive: true, force: true });
    }
  });

  it('reads a desk with no .changeset directory as having none', async () => {
    const desk = mkdtempSync(join(tmpdir(), 'plot-desk-'));
    try {
      expect(await changesetsIn(desk)).toEqual([]);
    } finally {
      rmSync(desk, { recursive: true, force: true });
    }
  });
});

describe('the world joins what the ports answer', () => {
  const options = {
    repoRoot: '/estate',
    isAlive: async (pid: number) => pid === 4242,
    prMerged: async () => 'merged' as const,
    dirtyPaths: async () => ['src/half.ts', 'src/other.ts'],
    markers: async () => ['PLOT-BLOCKED.md'],
    planLine: async () => null,
    workspacePackages: async () => ['plot'],
    madeProgress: async () => true,
    spawnCostMs: async () => 4,
    recordedPid: () => 4242,
  };

  it('reads a desk with no recorded pid as having no live worker', async () => {
    // A READING RATHER THAN A GUESS: the wrapper stamps the pid file the moment
    // it learns its own child, so its absence means nothing was started here.
    const built = worldFrom({ ...options, recordedPid: () => null });
    expect(await built.workerAlive('/estate/a')).toBe(false);
  });

  it('asks the process port about a recorded pid', async () => {
    const built = worldFrom(options);
    expect(await built.workerAlive('/estate/a')).toBe(true);
    expect(await worldFrom({ ...options, recordedPid: () => 9 }).workerAlive('/estate/a')).toBe(
      false,
    );
  });

  it('takes the first dirty path, which is what the failure quotes', async () => {
    expect(await worldFrom(options).dirtyPath('/estate/a')).toBe('src/half.ts');
  });

  it('reads a clean desk as an empty path rather than undefined', async () => {
    const built = worldFrom({ ...options, dirtyPaths: async () => [] });
    expect(await built.dirtyPath('/estate/a')).toBe('');
  });

  it('names the blocked marker rather than flagging it', async () => {
    expect(await worldFrom(options).blockedMarker('/estate/a')).toBe('PLOT-BLOCKED.md');
    const none = worldFrom({ ...options, markers: async () => [] });
    expect(await none.blockedMarker('/estate/a')).toBe('');
  });

  it('derives headroom from the spawn cost rather than taking a verdict', async () => {
    expect(await worldFrom(options).headroom()).toBe('clear');
    expect(await worldFrom({ ...options, spawnCostMs: async () => 80 }).headroom()).toBe(
      'starved',
    );
    expect(await worldFrom({ ...options, spawnCostMs: async () => null }).headroom()).toBe(
      'unmeasured',
    );
  });

  it('passes the branch and merge answers straight through', async () => {
    const built = worldFrom(options);
    expect(await built.merge('feature/one')).toBe('merged');
    expect(await built.workspacePackages()).toEqual(['plot']);
    expect(await built.planLine('feature/one')).toBeNull();
    expect(await built.madeProgress('/estate/a', 'feature/one')).toBe(true);
  });

  it('reads a desk file through the same absent/empty distinction', async () => {
    const desk = mkdtempSync(join(tmpdir(), 'plot-desk-'));
    try {
      const built = worldFrom(options);
      expect(built.deskFile(desk, 'nothing.json')).toBeNull();
      writeFileSync(join(desk, 'there.json'), '{}');
      expect(built.deskFile(desk, 'there.json')).toBe('{}');
      expect(await built.changesets(desk)).toEqual([]);
    } finally {
      rmSync(desk, { recursive: true, force: true });
    }
  });

  it('reports no transcript for a session nothing wrote one for', () => {
    const built = worldFrom({ ...options, home: '/estate/nowhere' });
    expect(built.transcriptFound('/estate/a', 'no-such-session')).toBe(false);
  });
});

describe('the tick reports itself in one line', () => {
  it('names the counts a person scans for', async () => {
    const report = await tick({
      registry: async () => [
        manifest({ branch: 'feature/a', worktree: '/estate/a' }),
        manifest({ branch: 'feature/b', worktree: '/estate/b' }),
      ],
      world: world({ deskFile: () => null }),
      now: (() => {
        let t = 1_000;
        return () => (t += 250);
      })(),
    });
    expect(tickLine(report)).toBe(
      'plot-registryd tick agents=2 left=0 reap=0 correct=2 person=0 defer=0 cost=250ms',
    );
  });

  it('reports a quiet tick as zeros rather than as silence', async () => {
    const report = await tick({ registry: async () => [], world: world(), now: () => 0 });
    expect(tickLine(report)).toBe(
      'plot-registryd tick agents=0 left=0 reap=0 correct=0 person=0 defer=0 cost=0ms',
    );
  });
});

describe('the interval was measured before it was chosen', () => {
  it('is longer than the fleet scan’s cadence, which it must not approach', () => {
    // The scan is 18.3 s against the board's 5 s poll. The tick's own cost is
    // under a second, so the interval is set by what it competes with rather
    // than by what it costs.
    expect(TICK_INTERVAL_MS).toBeGreaterThan(18_300);
  });

  it('is more than an order of magnitude above the measured tick cost', () => {
    expect(TICK_INTERVAL_MS / TICK_COST_MS).toBeGreaterThan(10);
  });

  it('is far below the Worker bound it exists to catch the end of', () => {
    expect(TICK_INTERVAL_MS).toBeLessThan(8 * 60 * 60 * 1000);
  });
});
