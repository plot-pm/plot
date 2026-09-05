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
import type { QueueWorld } from '../../src/server/queue-reading.js';
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

describe('a tick that cannot complete', () => {
  /**
   * THE FAILURE THIS SLICE EXISTS FOR. Every reading is a call to a machine
   * that can refuse — a registry directory removed mid-pass, a git that will
   * not fork, a host adapter that rejects rather than answering `!ok`. Before
   * this, any one of them escaped `tick` and ended the daemon's loop, so an OS
   * supervisor's restart was the only recovery from a reading that would have
   * succeeded a minute later.
   */
  it('reports the reason rather than throwing', async () => {
    const report = await tick({
      registry: async () => {
        throw new Error('EACCES: permission denied, scandir .plot/agents');
      },
      world: world(),
    });
    expect(report.incomplete).toBe('EACCES: permission denied, scandir .plot/agents');
  });

  it('reports a reading that failed after the registry was read', async () => {
    const report = await tick({
      registry: async () => [manifest()],
      world: world({
        merge: async () => {
          throw new Error('spawn gh ENOMEM');
        },
      }),
    });
    expect(report.incomplete).toBe('spawn gh ENOMEM');
  });

  it('decides nothing rather than deciding partly', async () => {
    // A TRUNCATED DECISION WOULD BE A LIE. Verdicts reached before the failure
    // rest on readings the tick never finished taking, and a performer applying
    // them would act on half an estate.
    const report = await tick({
      registry: async () => [manifest({ branch: 'feature/a', worktree: '/estate/a' })],
      world: world({
        deskFile: () => null,
        madeProgress: async () => {
          throw new Error('git rev-list failed');
        },
      }),
    });
    expect(report.decision.writes).toEqual([]);
    expect(report.decision.detail.agents).toEqual([]);
    expect(report.decision.detail.correcting).toEqual([]);
  });

  it('reports no agents rather than a count no verdict was reached about', async () => {
    // Two agents were read and neither was judged. Reporting `agents=2` would
    // read exactly like a tick that decided to leave both alone.
    const report = await tick({
      registry: async () => [
        manifest({ branch: 'feature/a', worktree: '/estate/a' }),
        manifest({ branch: 'feature/b', worktree: '/estate/b' }),
      ],
      world: world({
        headroom: async () => {
          throw new Error('sysctl unavailable');
        },
      }),
    });
    expect(report.agents).toBe(0);
  });

  it('names a rejection that carried no Error', async () => {
    const report = await tick({
      registry: async () => Promise.reject('the adapter rejected with a string'),
      world: world(),
    });
    expect(report.incomplete).toBe('the adapter rejected with a string');
  });

  it('never reports an empty reason, so a log line always says something', async () => {
    const report = await tick({
      registry: async () => {
        throw new Error('');
      },
      world: world(),
    });
    expect(report.incomplete).not.toBe('');
  });

  it('keeps the reason to one line, because the log is one line', async () => {
    const error = new Error('git failed\n  at readTick\n  at tick');
    const report = await tick({ registry: async () => Promise.reject(error), world: world() });
    expect(report.incomplete).toBe('git failed');
  });

  it('still times the tick it could not take', async () => {
    let clock = 1_000;
    const report = await tick({
      registry: async () => {
        clock += 812;
        throw new Error('spawn git ENOMEM');
      },
      world: world(),
      now: () => clock,
    });
    expect(report.costMs).toBe(812);
  });

  it('says so in its own line rather than in a line of zeros', async () => {
    // A tick that decided nothing and a tick that could not decide have
    // identical counts and mean opposite things: one is a quiet estate, the
    // other is a supervisor that is not supervising.
    const report = await tick({
      registry: async () => Promise.reject(new Error('spawn git ENOMEM')),
      world: world(),
      now: () => 0,
    });
    expect(tickLine(report)).toBe(
      'plot-registryd tick incomplete reason="spawn git ENOMEM" cost=0ms next=re-reads',
    );
  });
});

describe('the next tick re-reads and continues', () => {
  /**
   * THE RECOVERY, AND THERE IS NO OTHER ONE. The daemon persists nothing
   * between ticks, so a tick that failed leaves nothing to resume: the next one
   * re-reads the registry and the desks from disk, exactly as it does after a
   * `kill -9`. That is what makes the OS supervisor sufficient and a journal
   * unnecessary.
   */
  it('decides normally on the tick after one that could not complete', async () => {
    let fail = true;
    const options = {
      registry: async () => {
        if (fail) throw new Error('spawn git ENOMEM');
        return [manifest()];
      },
      world: world({ deskFile: () => null }),
    };

    const failed = await tick(options);
    expect(failed.incomplete).toBe('spawn git ENOMEM');

    fail = false;
    const recovered = await tick(options);
    expect(recovered.incomplete).toBe('');
    expect(recovered.decision.detail.correcting).toEqual(['feature/one']);
  });

  it('reaches the decision it would have reached had the failure never happened', async () => {
    // THE STATELESSNESS CLAIM, ASSERTED ACROSS A FAILURE. A daemon that carried
    // anything forward from a failed tick — a retry counter, a skip-set, a
    // partial decision — would make these two decisions differ.
    const registry = async () => [
      manifest({ branch: 'feature/a', worktree: '/estate/a', session: 'a', resumeId: 'a' }),
      manifest({ branch: 'feature/b', worktree: '/estate/b', session: 'b', resumeId: 'b' }),
    ];
    const clean = { registry, world: world({ deskFile: () => null }) };
    const undisturbed = await tick(clean);

    let fail = true;
    const disturbed = {
      registry,
      world: world({
        deskFile: () => null,
        merge: async () => {
          if (fail) throw new Error('spawn gh ENOMEM');
          return 'merged' as const;
        },
      }),
    };
    expect((await tick(disturbed)).incomplete).not.toBe('');
    fail = false;
    expect((await tick(disturbed)).decision).toEqual(undisturbed.decision);
  });

  it('picks up an estate that changed while the tick was failing', async () => {
    // The failure is not a pause: the registry is re-read, so an agent
    // registered during the failed tick is supervised by the next one.
    let entries = [manifest({ branch: 'feature/a', worktree: '/estate/a' })];
    let fail = true;
    const options = {
      registry: async () => {
        if (fail) throw new Error('scandir failed');
        return entries;
      },
      world: world({ deskFile: () => null }),
    };
    await tick(options);
    entries = [
      ...entries,
      manifest({ branch: 'feature/b', worktree: '/estate/b', session: 'b', resumeId: 'b' }),
    ];
    fail = false;
    expect((await tick(options)).decision.detail.correcting).toEqual([
      'feature/a',
      'feature/b',
    ]);
  });

  it('writes no state — a failed tick and a fresh process are the same input', async () => {
    // A DAEMON THAT KEPT A JOURNAL WOULD NEED IT HERE, and this is what says it
    // does not: `tick` is handed the same readings by a caller that just failed
    // and by one that has never run, and answers identically.
    const registry = async () => [manifest()];
    const worldValue = world({ deskFile: () => null });

    const afterFailure = { registry, world: worldValue };
    await tick({
      registry: async () => Promise.reject(new Error('spawn git ENOMEM')),
      world: worldValue,
    });
    const continued = await tick(afterFailure);

    const freshProcess = await tick({ registry, world: world({ deskFile: () => null }) });
    expect(continued.decision).toEqual(freshProcess.decision);
  });
});


describe('a tick starts agents when queued > running', () => {
  /**
   * A queue world holding one plan with one unclaimed, briefed branch.
   *
   * NO REPOSITORY AND NO PROCESS TABLE. Every member is a reading the fleet
   * scan and the brief gate already take, so the whole hand-over half is
   * reachable from plain records.
   */
  const queueWorld = (over: Partial<QueueWorld> = {}): QueueWorld => ({
    plans: async () => [
      {
        file: 'docs/plans/2026-09-05-a-plan.md',
        // LOWERCASE, as `plot-plan-meta.sh` normalises it and `sliceVerdicts`
        // reads it. `Approved` is what the file says; this is what the parser
        // emits, and the rule tests the parser's spelling.
        phase: 'approved',
        slices: [{ branches: [{ branch: 'feature/waiting', deferred: false }] }],
      } as never,
    ],
    claimedBranches: async () => new Set<string>(),
    briefPresent: async () => true,
    sliceHasMerged: async () => false,
    queuedHasLanded: async () => 'not-landed',
    workerAlive: async () => true,
    blocked: async () => false,
    ...over,
  });

  const cap = (size: number) => async () => ({
    size,
    headroom: 'clear' as const,
    spawnCostMs: 1,
    desks: ['', '', ''],
  });

  it('names a start for a slice nothing could take', async () => {
    const report = await tick({
      registry: async () => [],
      world: world(),
      queue: queueWorld(),
      fleet: cap(3),
    });

    expect(report.handOver?.detail.held).toEqual([
      { branch: 'feature/waiting', hold: 'no-free-agent' },
    ]);
    expect(report.handOver?.writes.filter((w) => w.kind === 'worker-start')).toHaveLength(3);
  });

  it('starts nothing and reports `null` when nobody asked it to scale', async () => {
    // NULL IS *NOBODY ASKED*, NOT *THE FLEET WAS THE RIGHT SIZE*. A daemon
    // running without `--start-agents` must not claim it measured a fleet it
    // was never allowed to grow.
    const report = await tick({
      registry: async () => [],
      world: world(),
      queue: queueWorld(),
    });

    expect(report.handOver?.detail.scaling).toBeNull();
    expect(report.handOver?.writes.some((w) => w.kind === 'worker-start')).toBe(false);
  });

  it('omits `started=` from the line when nobody asked, rather than printing a zero', async () => {
    const report = await tick({
      registry: async () => [],
      world: world(),
      queue: queueWorld({ plans: async () => [] }),
      now: () => 0,
    });
    expect(tickLine(report)).not.toContain('started=');
  });

  it('prints `started=` when it was asked, including a zero it measured', async () => {
    const report = await tick({
      registry: async () => [],
      world: world(),
      queue: queueWorld({ plans: async () => [] }),
      fleet: cap(3),
      now: () => 0,
    });
    expect(tickLine(report)).toContain('started=0');
  });

  it('offers nothing for a branch the host says merged, and starts nobody to take it', async () => {
    // THE DEFECT, THROUGH THE TICK THAT FOUND IT. Measured 2026-09-05: the
    // first supervisor tick that ever matched decided three hand-overs, and
    // two were branches merged an hour earlier. The ref reading could not see
    // it — merging deletes the ref, so a finished branch reads exactly like one
    // nobody has started.
    const report = await tick({
      registry: async () => [],
      world: world(),
      queue: queueWorld({ queuedHasLanded: async () => 'landed' }),
      fleet: cap(3),
    });

    expect(report.handOver?.detail.assignments).toEqual([]);
    expect(report.handOver?.detail.held).toEqual([
      { branch: 'feature/waiting', hold: 'already-merged' },
    ]);
    expect(report.handOver?.writes.some((w) => w.kind === 'worker-start')).toBe(false);
  });

  it('offers nothing when the host could not be asked, and names the reading that failed', async () => {
    // SILENCE HOLDS THE SLICE. The reaper reads an unreachable host as *not
    // merged* and keeps a checkout; here the same word would hand finished
    // work to a free agent, so the direction inverts.
    const report = await tick({
      registry: async () => [],
      world: world(),
      queue: queueWorld({ queuedHasLanded: async () => 'unknown' }),
      fleet: cap(3),
    });

    expect(report.handOver?.detail.assignments).toEqual([]);
    expect(report.handOver?.detail.held).toEqual([
      { branch: 'feature/waiting', hold: 'merge-unknown' },
    ]);
  });

  it('asks the host only about a slice it could otherwise hand over', async () => {
    // THE HOST IS THE ONE READING WITH A RATE LIMIT BEHIND IT, and this estate
    // carried 454 queued slices on the tick that found the defect. A slice
    // already held by a missing brief cannot be handed over whatever the host
    // says, so asking would spend the budget on an answer nothing reads.
    const asked: string[] = [];
    await tick({
      registry: async () => [],
      world: world(),
      queue: queueWorld({
        briefPresent: async () => false,
        queuedHasLanded: async (branch) => {
          asked.push(branch);
          return 'not-landed';
        },
      }),
    });
    expect(asked).toEqual([]);
  });

  it('writes nothing between ticks — the same estate twice reaches the same decision', async () => {
    // THE STATELESSNESS IS THE TICK'S OWN CONTRACT, and scaling must not be the
    // thing that breaks it. The count comes from the queue and the fleet as
    // each pass measures them, so a daemon SIGKILLed between deciding and
    // starting repeats the reading rather than resuming a target.
    const options = {
      registry: async () => [],
      world: world(),
      queue: queueWorld(),
      fleet: cap(3),
      now: () => 0,
    };
    const first = await tick(options);
    const second = await tick(options);
    expect(second.handOver?.detail.scaling).toEqual(first.handOver?.detail.scaling);
    expect(second.handOver?.writes).toEqual(first.handOver?.writes);
  });
});
