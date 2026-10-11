import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clockManual, defaultBranchFile } from '@plot-pm/domain/adapters';
import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';

import {
  bindChannelSlot,
  prsBeat,
  queueWorldForRepo,
  relayBeat,
  run,
  startDaemon,
  stopOnSignals,
  writersFor,
  type ChannelSlot,
  type RunSeams,
} from '../../src/server/entry/registryd-main.js';
import type { TickReport } from '../../src/server/entry/registryd.js';
import { startFleetClock } from '../../src/shared/fleet-clock.js';

import type { RunningChannel } from '../../src/shared/channel-socket.js';

const emptySlot = (): ChannelSlot => ({ channel: null, indexMonitor: null, deskRelay: null });
const fakeChannel = (): RunningChannel => ({ stop: async () => undefined }) as unknown as RunningChannel;

describe('the prs beat', () => {
  it('reads the PRs, then the default branch, then runs the monitor', async () => {
    const order: string[] = [];
    const slot: ChannelSlot = {
      channel: fakeChannel(),
      indexMonitor: async () => { order.push('indexMonitor'); },
      deskRelay: null,
    };
    await prsBeat(
      { readPrs: async () => { order.push('readPrs'); }, readDefaultBranch: async () => { order.push('readDefaultBranch'); } },
      slot,
    )();
    expect(order).toEqual(['readPrs', 'readDefaultBranch', 'indexMonitor']);
  });

  it('completes with no channel and no retry, running both reads', async () => {
    const order: string[] = [];
    await prsBeat(
      { readPrs: async () => { order.push('readPrs'); }, readDefaultBranch: async () => { order.push('readDefaultBranch'); } },
      emptySlot(),
    )();
    expect(order).toEqual(['readPrs', 'readDefaultBranch']);
  });

  it('retries the bind after the reads and serves the monitor of the channel it bound', async () => {
    const order: string[] = [];
    const slot = emptySlot();
    const published: string[] = [];
    const retry = () =>
      bindChannelSlot(slot, async () => { order.push('open'); return fakeChannel(); }, () => ({
        indexMonitor: async () => { published.push('monitor-over-new-channel'); },
        deskRelay: async () => { published.push('relay-over-new-channel'); },
      }));
    const beat = prsBeat(
      { readPrs: async () => { order.push('readPrs'); }, readDefaultBranch: async () => { order.push('readDefaultBranch'); } },
      slot,
      retry,
    );
    await beat();
    expect(order).toEqual(['readPrs', 'readDefaultBranch', 'open']);
    expect(slot.channel).not.toBeNull();
    // THE RETRY REPLACED THE LIVE BINDING: the monitor of the new channel ran in the same beat.
    expect(published).toEqual(['monitor-over-new-channel']);
    await relayBeat(slot, () => undefined);
    expect(published).toEqual(['monitor-over-new-channel', 'relay-over-new-channel']);
  });

  it('keeps retrying while the bind fails, and stops once it holds a channel', async () => {
    const slot = emptySlot();
    let opens = 0;
    const retry = () =>
      bindChannelSlot(slot, async () => { opens += 1; return opens < 3 ? null : fakeChannel(); }, () => ({
        indexMonitor: null,
        deskRelay: null,
      }));
    const beat = prsBeat({ readPrs: async () => undefined, readDefaultBranch: async () => undefined }, slot, retry);
    await beat();
    await beat();
    expect(slot.channel).toBeNull();
    await beat();
    await beat();
    expect(opens).toBe(3);
    expect(slot.channel).not.toBeNull();
  });
});

describe('the desk relay beat', () => {
  it('warns where the relay throws and returns', async () => {
    const warnings: string[] = [];
    await relayBeat({ deskRelay: async () => { throw new Error('socket gone'); } }, (s) => warnings.push(s));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('desk relay failed: socket gone');
  });

  it('does nothing with no relay', async () => {
    const warnings: string[] = [];
    await relayBeat({ deskRelay: null }, (s) => warnings.push(s));
    expect(warnings).toEqual([]);
  });
});

/** A process stand-in that records its signal handlers and its exit code. */
const fakeProc = (argv: string[] = ['node', 'plot-fleetd.mjs'], repoRoot = '/nonexistent') => {
  const handlers = new Map<string, () => void>();
  const exits: number[] = [];
  const proc = {
    argv,
    env: { PLOT_REPO_ROOT: repoRoot },
    cwd: () => repoRoot,
    on: ((name: string, fn: () => void) => {
      handlers.set(name, fn);
    }) as never,
    exit: ((code: number) => {
      exits.push(code);
    }) as never,
  };
  return { proc, handlers, exits };
};

describe('stopping on a signal', () => {
  it.each(['SIGTERM', 'SIGINT'])('flips stop() and settles requested when %s arrives', async (signal) => {
    const { proc, handlers, exits } = fakeProc();
    const stop = stopOnSignals(proc);
    expect(stop()).toBe(false);
    handlers.get(signal)?.();
    expect(stop()).toBe(true);
    await expect(stop.requested).resolves.toBeUndefined();
    expect(exits).toEqual([]);
  });

  it.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
  ])('exits at once with %s on a second signal', (signal, code) => {
    const { proc, handlers, exits } = fakeProc();
    stopOnSignals(proc);
    handlers.get(signal)?.();
    handlers.get(signal)?.();
    expect(exits).toEqual([code]);
  });
});

/** A completed supervision tick with nothing decided. */
const completedTick = (): TickReport => ({
  startedAt: 0,
  costMs: 1,
  agents: 0,
  incomplete: '',
  handOver: null,
  decision: {
    outcome: 'decided',
    workflow: 'supervise',
    writes: [],
    detail: { agents: [], left: [], reaping: [], correcting: [], needingAPerson: [], deferred: [], unclaimed: [] },
  },
});

/** Lets every pending promise callback run. */
const settle = async (turns = 5): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r));
};

/** Fires one PR beat (every twelfth beat of the fleet clock) and lets it finish. */
const prBeat = async (clock: ReturnType<typeof clockManual>): Promise<void> => {
  for (let i = 0; i < 12; i += 1) {
    clock.advance(1);
    await settle(1);
  }
  await settle();
};

/** A flag the test sets, with the `requested` promise `stopOnSignals` gives. */
const manualStop = () => {
  let stopped = false;
  let resolve: () => void = () => undefined;
  const requested = new Promise<void>((r) => {
    resolve = r;
  });
  const flag = Object.assign(() => stopped, { requested });
  return {
    flag,
    set: () => {
      stopped = true;
      resolve();
    },
  };
};

describe('run — the loop wiring', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'registryd-run-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** The seams every run test shares: no scan, no host read, no socket. */
  const quiet = (events: string[], overrides: Partial<RunSeams> = {}): RunSeams => ({
    clock: clockManual(0),
    scan: async () => undefined,
    readPrs: async () => undefined,
    readDefaultBranch: async () => undefined,
    openChannel: (async () => ({
      stop: async () => {
        events.push('channel-stop');
      },
    })) as never,
    overChannel: () => ({
      indexMonitor: null,
      deskRelay: async () => {
        events.push('relay');
      },
    }),
    ...overrides,
  });

  it('runs the relay after a completed tick and after a failed tick', async () => {
    const events: string[] = [];
    const stop = manualStop();
    let ticks = 0;
    const code = await run(
      [],
      dir,
      () => undefined,
      async () => {
        events.push('sleep');
        if (events.filter((e) => e === 'sleep').length === 2) stop.set();
      },
      stop.flag,
      () => undefined,
      dir,
      quiet(events, {
        tick: async () => {
          ticks += 1;
          events.push(ticks === 1 ? 'tick-ok' : 'tick-throws');
          if (ticks === 1) return completedTick();
          throw new Error('host gone');
        },
      }),
    );
    expect(code).toBe(0);
    expect(events).toEqual(['tick-ok', 'relay', 'sleep', 'tick-throws', 'relay', 'sleep', 'channel-stop']);
  });

  it('retries a failed bind on a later PR beat, reads the default branch there, and stops the channel it bound', async () => {
    const events: string[] = [];
    const warnings: string[] = [];
    const clock = clockManual(0);
    const stop = manualStop();
    let opens = 0;
    const code = await run(
      [],
      dir,
      () => undefined,
      async () => {
        await prBeat(clock);
        stop.set();
      },
      stop.flag,
      (s) => warnings.push(s),
      dir,
      quiet(events, {
        clock,
        tick: async () => completedTick(),
        readDefaultBranch: async () => {
          events.push('read-default-branch');
        },
        openChannel: (async () => {
          opens += 1;
          if (opens === 1) throw new Error('address in use');
          return {
            stop: async () => {
              events.push('channel-stop');
            },
          };
        }) as never,
      }),
    );
    expect(code).toBe(0);
    expect(opens).toBe(2);
    expect(warnings.filter((w) => w.includes('the channel could not start'))).toHaveLength(1);
    expect(events).toContain('read-default-branch');
    expect(events.at(-1)).toBe('channel-stop');
  });

  it('warns where the monitor throws on the PR beat', async () => {
    const events: string[] = [];
    const warnings: string[] = [];
    const clock = clockManual(0);
    const stop = manualStop();
    await run(
      [],
      dir,
      () => undefined,
      async () => {
        await prBeat(clock);
        stop.set();
      },
      stop.flag,
      (s) => warnings.push(s),
      dir,
      quiet(events, {
        clock,
        tick: async () => completedTick(),
        overChannel: () => ({
          indexMonitor: async () => {
            throw new Error('monitor blew up');
          },
          deskRelay: null,
        }),
      }),
    );
    expect(warnings).toContain('plot-fleetd: pr-reader failed: monitor blew up');
  });

  it('returns well before the interval when a stop arrives during the wait', async () => {
    const events: string[] = [];
    const stop = manualStop();
    const started = Date.now();
    let entered: () => void = () => undefined;
    const waiting = new Promise<void>((r) => {
      entered = r;
    });
    const pending = run(
      [],
      dir,
      () => undefined,
      () => {
        entered();
        return new Promise<void>(() => undefined);
      },
      stop.flag,
      () => undefined,
      dir,
      quiet(events, { tick: async () => completedTick() }),
    );
    await waiting;
    stop.set();
    expect(await pending).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(events.at(-1)).toBe('channel-stop');
  });

  it('skips the wait when the stop arrives during the tick', async () => {
    const events: string[] = [];
    const stop = manualStop();
    let sleeps = 0;
    const code = await run(
      [],
      dir,
      () => undefined,
      async () => {
        sleeps += 1;
      },
      stop.flag,
      () => undefined,
      dir,
      quiet(events, {
        tick: async () => {
          stop.set();
          return completedTick();
        },
      }),
    );
    expect(code).toBe(0);
    expect(sleeps).toBe(0);
  });
});

describe('startDaemon — the process entry', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'registryd-daemon-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('ends on SIGTERM during the 60 s wait, well before it elapses', async () => {
    const { proc, handlers, exits } = fakeProc(['node', 'plot-fleetd.mjs', '--interval', '60'], dir);
    const events: string[] = [];
    let ticked: () => void = () => undefined;
    const firstTick = new Promise<void>((r) => {
      ticked = r;
    });
    const started = Date.now();
    const pending = startDaemon(proc, dir, () => undefined, () => undefined, {
      clock: clockManual(0),
      scan: async () => undefined,
      readPrs: async () => undefined,
      readDefaultBranch: async () => undefined,
      openChannel: (async () => ({
        stop: async () => {
          events.push('channel-stop');
        },
      })) as never,
      overChannel: () => ({ indexMonitor: null, deskRelay: null }),
      // A THROWING TICK reaches the wait with no spawn in between, so the
      // signal below arrives while the 60 s wait runs.
      tick: async () => {
        ticked();
        throw new Error('host gone');
      },
    });
    await firstTick;
    await settle(20);
    expect(handlers.has('SIGTERM')).toBe(true);
    handlers.get('SIGTERM')?.();
    const code = await Promise.race([
      pending,
      new Promise<string>((r) => setTimeout(() => r('still waiting'), 5_000)),
    ]);
    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(events).toEqual(['channel-stop']);
    expect(exits).toEqual([]);
  });
});

describe('a swallowed subscriber throw', () => {
  it('warns with the subscriber name and the reason, and the clock keeps running', async () => {
    const clock = clockManual(0);
    const warnings: string[] = [];
    let scans = 0;
    startFleetClock(
      clock,
      { scan: async () => { scans += 1; }, prs: async () => { throw new Error('monitor blew up'); } },
      (s) => warnings.push(s),
    );
    for (let i = 0; i < 12; i += 1) {
      clock.advance(1);
      await new Promise((r) => setImmediate(r));
    }
    expect(scans).toBe(12);
    expect(warnings).toEqual(['plot-fleetd: pr-reader failed: monitor blew up']);
  });
});

describe('the queue world holds on a settled-red default branch', () => {
  const reading = (askedAt: string): DefaultBranchReading => ({
    v: DEFAULT_BRANCH_VERSION,
    branch: 'main',
    headSha: 'abc',
    head: 'red',
    settled: { sha: 'abc', state: 'red' },
    failingRuns: [],
    headSince: askedAt,
    askedAt,
    at: askedAt,
  });
  const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();
  const held = async (file: DefaultBranchReading | null): Promise<boolean> => {
    const dir = mkdtempSync(join(tmpdir(), 'registryd-wiring-'));
    try {
      if (file !== null) await defaultBranchFile(dir).write(file);
      return await queueWorldForRepo(dir, dir, { calls: 0 }).defaultBranchRed();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('holds on a red reading within Checks wait (default 3600 s)', async () => {
    expect(await held(reading(iso(60_000)))).toBe(true);
  });

  it('holds nothing on a red reading older than Checks wait', async () => {
    expect(await held(reading(iso(2 * 3_600_000)))).toBe(false);
  });

  it('holds nothing with no file', async () => {
    expect(await held(null)).toBe(false);
  });
});

describe('the writers for a mode', () => {
  const capture = () => {
    const lines: string[] = [];
    return { lines, stream: { write: (text: string) => lines.push(text) } };
  };

  it('sends --once to stdout and stderr and opens no log', () => {
    const stdout = capture();
    const stderr = capture();
    const opened: string[] = [];
    const writers = writersFor(['--once'], '/logs', { stdout: stdout.stream, stderr: stderr.stream }, (path) => {
      opened.push(path);
      return { write: () => undefined };
    });
    writers.out('tick\n');
    writers.err('held\n');
    expect(stdout.lines).toEqual(['tick\n']);
    expect(stderr.lines).toEqual(['held\n']);
    expect(opened).toEqual([]);
  });

  it('sends the looping daemon to fleetd.log and fleetd.err and not to the terminal', () => {
    const stdout = capture();
    const stderr = capture();
    const logs = new Map<string, string[]>();
    const writers = writersFor(['--start-agents'], '/logs', { stdout: stdout.stream, stderr: stderr.stream }, (path) => {
      const lines: string[] = [];
      logs.set(path, lines);
      return { write: (text: string) => lines.push(text) };
    });
    writers.out('tick\n');
    writers.err('held\n');
    expect(logs.get('/logs/fleetd.log')).toEqual(['tick\n']);
    expect(logs.get('/logs/fleetd.err')).toEqual(['held\n']);
    expect(stdout.lines).toEqual([]);
    expect(stderr.lines).toEqual([]);
  });
});
