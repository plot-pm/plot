import { chmodSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, treeOf } from './census-session.js';
import { CENSUS_ROWS, recordCount, rowTitle } from './census-rows.js';
import type { CensusFixture } from './census-report.js';
import { buildSandbox, type Sandbox } from './sandbox.js';
import { censusGate, findStrace } from './strace-run.js';
import type { ExecRecord } from './strace-execs.js';
import { releaseFifo } from './stub-worker.js';

// D1: what one agent launch starts. `start_worker` is called the way
// `test/reconcile/dispatch.test.mjs` calls it, on one desk, with a stub agent
// that blocks on a FIFO. The count is every image the traced launch starts
// except the agent's own tree: the dispatcher's part, the wrapper's start, and
// the wrapper's ending once the agent exits.
//
// P6: over the same launch, while the agent lives and idles and until it
// ends, no image is a monitor script.

const gate = censusGate({ stracePath: findStrace(process.env['PATH'] ?? ''), platform: process.platform });

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const until = async (what: string, ready: () => boolean, ms = 30_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`process census D1: no ${what} within ${ms} ms`);
    await wait(50);
  }
};

const base = (e: ExecRecord): string => e.path.split('/').pop() ?? e.path;

/** Whether an image runs a monitor script, as the command itself or as a shell's first argument. */
const isMonitor = (e: ExecRecord): boolean =>
  /-monitor\.sh$/.test(base(e)) || /-monitor\.sh$/.test(e.argv[1]?.split('/').pop() ?? '');

describe.skipIf(gate.kind !== 'run')('one dispatch (D1, P6)', () => {
  const fixture: CensusFixture = { host: 'github', desks: 1, openPrs: 0 };
  const branch = 'feature/census-dispatch';
  let box: Sandbox;
  let launch: ExecRecord[] = [];
  let agentImages = 0;
  let monitors: ExecRecord[] = [];

  beforeAll(async () => {
    box = await buildSandbox({ host: 'github', desks: 0, openPrs: 0 });
    const worktree = join(box.repo, '.worktrees', 'census-dispatch');
    box.git(box.repo, 'branch', branch, 'main');
    box.git(box.repo, 'worktree', 'add', '--quiet', worktree, branch);
    // THE STUB AGENT: one builtin `read` on a FIFO the test holds, under a name
    // the census can find.
    const fifo = join(box.root, 'census-agent.fifo');
    execFileSync('mkfifo', [fifo]);
    const agent = join(box.root, 'bin', 'census-agent');
    writeFileSync(agent, '#!/bin/sh\nread -r _ < "$CENSUS_AGENT_FIFO"\n');
    chmodSync(agent, 0o755);
    appendFileSync(join(box.repo, 'CLAUDE.md'), '- **Worker command:** census-agent\n');

    const script = [
      'PLOT_DISPATCH_SOURCED=1',
      '. "$CENSUS_DISPATCH"',
      'repo_root=$(git rev-parse --show-toplevel)',
      'start_worker "$CENSUS_BRANCH" "$CENSUS_WORKTREE"',
    ].join('\n');
    const session = startSession({
      command: 'bash',
      args: ['-c', script],
      cwd: box.repo,
      env: {
        ...box.env,
        CENSUS_AGENT_FIFO: fifo,
        CENSUS_DISPATCH: join(box.scriptsDir, 'plot-dispatch.sh'),
        CENSUS_BRANCH: branch,
        CENSUS_WORKTREE: worktree,
      },
      trace: true,
    });
    const pidFile = join(worktree, '.plot-worker.pid');
    await until('agent pid', () => existsSync(pidFile) && /^\d+$/.test(readFileSync(pidFile, 'utf8')));
    // THE AGENT IDLES, live, before it is released: P6's window.
    await wait(2_000);
    await until('reader on the agent FIFO', () => releaseFifo(fifo));
    await until('exit record', () => existsSync(join(worktree, '.plot-worker.exit')));
    const census = (await session.end(90_000)).census;
    const execs = census?.execs ?? [];
    const agentRoot = execs.find((e) => base(e) === 'census-agent');
    const agentTree = agentRoot === undefined || census === null ? [] : treeOf(census, execs, agentRoot.pid);
    agentImages = agentTree.length;
    launch = execs.filter((e) => !agentTree.includes(e));
    monitors = execs.filter(isMonitor);
  }, 180_000);

  afterAll(async () => {
    await box?.remove();
  });

  it(rowTitle(CENSUS_ROWS.D1, fixture), () => {
    recordCount(CENSUS_ROWS.D1, fixture, launch.length, launch);
    expect(agentImages).toBeGreaterThan(0);
    expect(launch.length).toBeGreaterThan(0);
  });

  it(rowTitle(CENSUS_ROWS.P6, fixture), () => {
    recordCount(CENSUS_ROWS.P6, fixture, monitors.length, monitors);
    expect(agentImages).toBeGreaterThan(0);
    expect(monitors).toEqual([]);
  });
});
