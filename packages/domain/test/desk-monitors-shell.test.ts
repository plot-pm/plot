import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { deskMonitorsShell } from '../src/adapters/desk-monitors/desk-monitors-shell.js';
import type { ShellContext } from '../src/adapters/scripts.js';
import type { MonitoredDesk } from '../src/ports/desk-monitors.js';

/**
 * `deskMonitorsShell.start` against stub monitor scripts.
 *
 * Each stub writes the environment it was started with into the desk and
 * exits, so the test reads what a real monitor would have been given.
 */

const roots: string[] = [];

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** A repository whose scripts directory holds the named stubs, and a desk. */
const fixture = (
  stubs: readonly string[],
  body = (name: string): string =>
    `printf '%s\\n' "$PLOT_BRANCH" "$PLOT_WORKTREE" "$PLOT_MANIFEST_FILE" "$PLOT_PID_FILE" "$(ps -o pgid= -p $$ | tr -d ' ')" > "$PLOT_WORKTREE/${name}.env.tmp" && mv "$PLOT_WORKTREE/${name}.env.tmp" "$PLOT_WORKTREE/${name}.env"`,
): { context: ShellContext; desk: MonitoredDesk } => {
  const root = mkdtempSync(join(tmpdir(), 'plot-desk-monitors-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  const worktree = join(root, 'desk');
  mkdirSync(scriptDir);
  mkdirSync(worktree);
  for (const name of stubs) {
    const file = join(scriptDir, name);
    writeFileSync(file, `#!/bin/sh\n${body(name)}\n`);
    chmodSync(file, 0o755);
  }
  return {
    context: { repoRoot: root, scriptDir },
    desk: {
      branch: 'bug/x',
      worktree,
      manifestFile: join(root, 'sess.json'),
      pidFile: join(worktree, '.plot-worker.pid'),
      log: join(worktree, '.plot-worker.log'),
    },
  };
};

/** Waits until `pid` runs a command line naming `name`, as a started shell script soon does. */
const waitForCommand = async (pid: number, name: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if (execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).includes(name)) return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Whether `pid` ends within ten seconds. */
const gone = async (pid: number): Promise<boolean> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

const waitFor = async (file: string): Promise<string> => {
  const deadline = Date.now() + 10_000;
  while (!existsSync(file) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  return readFileSync(file, 'utf8');
};

describe('deskMonitorsShell.start', () => {
  it('starts the BuildMonitor with the environment the dispatch wrapper gives it', async () => {
    const { context, desk } = fixture(['plot-agent-monitor.sh', 'plot-build-monitor.sh']);

    const result = deskMonitorsShell(context).start(desk);

    expect(result.ok).toBe(true);
    const pids = result.ok ? result.value : { agentMonitorPid: '', buildMonitorPid: '' };
    expect(pids.buildMonitorPid).toMatch(/^\d+$/);
    expect(pids.agentMonitorPid).toMatch(/^\d+$/);
    const expected = [desk.branch, desk.worktree, desk.manifestFile, desk.pidFile];
    const build = (await waitFor(join(desk.worktree, 'plot-build-monitor.sh.env'))).split('\n');
    expect(build.slice(0, 4)).toEqual(expected);
    const agent = (await waitFor(join(desk.worktree, 'plot-agent-monitor.sh.env'))).split('\n');
    expect(agent.slice(0, 4)).toEqual(expected);
  });

  it('starts each monitor detached, in a process group of its own', async () => {
    const { context, desk } = fixture(['plot-build-monitor.sh']);
    const ownGroup = execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim();

    const result = deskMonitorsShell(context).start(desk);

    const pid = result.ok ? result.value.buildMonitorPid : '';
    const group = (await waitFor(join(desk.worktree, 'plot-build-monitor.sh.env'))).split('\n')[4];
    expect(group).toBe(pid);
    expect(group).not.toBe(ownGroup);
  });

  it('reports an absent monitor script as not started', () => {
    const { context, desk } = fixture([]);

    expect(deskMonitorsShell(context).start(desk)).toEqual({
      ok: true,
      value: { agentMonitorPid: '', buildMonitorPid: '' },
    });
  });

  it('stops a running monitor', async () => {
    const { context, desk } = fixture(['plot-build-monitor.sh'], () => 'while :; do sleep 0.2; done');
    const monitors = deskMonitorsShell(context);
    const started = monitors.start(desk);
    const pid = started.ok ? started.value.buildMonitorPid : '';
    await waitForCommand(Number(pid), 'plot-build-monitor.sh');

    expect(monitors.stop([pid])).toEqual({ ok: true, value: [pid] });
    expect(await gone(Number(pid))).toBe(true);
  });

  it('treats an empty or gone pid as stopped', async () => {
    const child = spawn('true');
    await new Promise((r) => child.on('exit', r));

    expect(deskMonitorsShell(fixture([]).context).stop(['', String(child.pid)])).toEqual({ ok: true, value: [] });
  });

  it('leaves a live pid alone when its command line names no monitor', async () => {
    const child = spawn('sleep', ['30']);
    try {
      expect(deskMonitorsShell(fixture([]).context).stop([String(child.pid)])).toEqual({ ok: true, value: [] });
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
    } finally {
      child.kill('SIGKILL');
      await new Promise((r) => child.on('exit', r));
    }
  });

  it('fails when the log cannot be opened', () => {
    const { context, desk } = fixture([]);

    expect(deskMonitorsShell(context).start({ ...desk, log: join(desk.worktree, 'missing', 'log') })).toEqual({
      ok: false,
      why: 'failed',
    });
  });
});
