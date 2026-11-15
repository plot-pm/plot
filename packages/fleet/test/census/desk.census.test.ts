import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession } from './census-session.js';
import { buildSandbox, type Sandbox } from './sandbox.js';
import { censusGate, findStrace } from './strace-run.js';
import type { StraceCensus } from './strace-execs.js';
import { releaseFifo, stubWorkerCommand } from './stub-worker.js';

// What a desk starts on its own: the stub worker, which starts nothing, so
// every other count holds only Plot's processes. P1, the AgentMonitor over one
// live, idle desk, is retired with the script; P6 in `dispatch.census.test.ts`
// holds that a launched desk starts no monitor process.

const gate = censusGate({ stracePath: findStrace(process.env['PATH'] ?? ''), platform: process.platform });

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
