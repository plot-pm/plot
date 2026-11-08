import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession } from './census-session.js';
import { CENSUS_ROWS, recordCount, rowTitle } from './census-rows.js';
import type { CensusFixture } from './census-report.js';
import { buildSandbox, type Sandbox } from './sandbox.js';
import { censusGate, findStrace } from './strace-run.js';
import type { ExecRecord, StraceCensus } from './strace-execs.js';
import { releaseFifo, stubWorkerCommand } from './stub-worker.js';

// What a desk starts on its own: the stub worker (nothing, which is what lets
// every other count hold only Plot's processes) and the AgentMonitor over one
// live, idle desk (P1).

const gate = censusGate({ stracePath: findStrace(process.env['PATH'] ?? ''), platform: process.platform });

const WINDOW_MS = Number(process.env['PLOT_CENSUS_WINDOW_MS'] ?? '60000');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.skipIf(gate.kind !== 'run')('a stub worker', () => {
  let box: Sandbox;
  let census: StraceCensus | null = null;

  beforeAll(async () => {
    box = await buildSandbox({ host: 'github', desks: 0, openPrs: 0 });
    const fifo = join(box.root, 'census-worker.fifo');
    execFileSync('mkfifo', [fifo]);
    const [command, args] = stubWorkerCommand(fifo);
    const session = startSession({ command, args, cwd: box.repo, env: box.env, trace: true });
    await wait(2_000);
    for (let i = 0; i < 100 && !releaseFifo(fifo); i += 1) await wait(20);
    census = (await session.end(30_000)).census;
  }, 60_000);

  afterAll(async () => {
    await box?.remove();
  });

  it('starts nothing while it runs, with the board and fleetd stopped', () => {
    const [own, ...started] = census?.execs ?? [];

    expect(own?.path).toBe('/bin/sh');
    expect(started).toEqual([]);
  });
});

describe.skipIf(gate.kind !== 'run')('an AgentMonitor over one live, idle desk (P1)', () => {
  const fixture: CensusFixture = { host: 'github', desks: 1, openPrs: 0 };
  let box: Sandbox;
  let sleeps: ExecRecord[] = [];
  let elapsedMs = 0;

  beforeAll(async () => {
    box = await buildSandbox(fixture);
    const desk = box.desks[0];
    if (desk === undefined) throw new Error('process census: the fixture holds no desk');
    const started = Date.now();
    const session = startSession({
      command: 'bash',
      args: [join(box.scriptsDir, 'plot-agent-monitor.sh')],
      cwd: desk.worktree,
      env: {
        ...box.env,
        PLOT_BRANCH: desk.branch,
        PLOT_WORKTREE: desk.worktree,
        PLOT_MONITOR_FILE: join(box.root, 'agent-monitor.jsonl'),
      },
      trace: true,
    });
    await wait(WINDOW_MS);
    // THE SUBJECT LEAVES, SO THE MONITOR DOES: its wait reads the pid file and
    // returns on `gone`, which ends the monitor without a signal.
    await desk.worker.stop();
    const census = (await session.end(60_000)).census;
    elapsedMs = Date.now() - started;
    sleeps = (census?.execs ?? []).filter((e) => (e.path.split('/').pop() ?? '') === 'sleep');
  }, WINDOW_MS + 120_000);

  afterAll(async () => {
    await box?.remove();
  });

  it.fails(rowTitle(CENSUS_ROWS.P1, fixture), () => {
    recordCount(CENSUS_ROWS.P1, fixture, (sleeps.length * 60_000) / elapsedMs, sleeps);
    expect(sleeps).toHaveLength(0);
  });
});
