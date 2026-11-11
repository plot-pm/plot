import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { deskMonitorsShell } from '../src/adapters/desk-monitors/desk-monitors-shell.js';
import type { ShellContext } from '../src/adapters/scripts.js';

/** `deskMonitorsShell.stop` against stub monitor scripts and plain processes. */

const roots: string[] = [];

const started: number[] = [];

afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
});

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** A repository whose scripts directory holds the named stubs, each running `body`. */
const fixture = (stubs: readonly string[], body = 'while :; do sleep 0.2; done'): { context: ShellContext } => {
  const root = mkdtempSync(join(tmpdir(), 'plot-desk-monitors-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  for (const name of stubs) {
    const file = join(scriptDir, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return { context: { repoRoot: root, scriptDir } };
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

describe('deskMonitorsShell.stop', () => {
  it('stops a running monitor', async () => {
    const { context } = fixture(['plot-agent-monitor.sh']);
    const monitors = deskMonitorsShell(context);
    const child = spawn(join(context.scriptDir, 'plot-agent-monitor.sh'), [], { detached: true, stdio: 'ignore' });
    child.unref();
    started.push(child.pid!);
    const pid = String(child.pid);
    await waitForCommand(Number(pid), 'plot-agent-monitor.sh');

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

  it('leaves a live pid alone when its arguments only mention the monitor script name', async () => {
    const { context } = fixture([]);
    const child = spawn('sleep', ['30', 'plot-agent-monitor.sh']);
    try {
      expect(deskMonitorsShell(context).stop([String(child.pid)])).toEqual({ ok: true, value: [] });
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
    } finally {
      child.kill('SIGKILL');
      await new Promise((r) => child.on('exit', r));
    }
  });
});
