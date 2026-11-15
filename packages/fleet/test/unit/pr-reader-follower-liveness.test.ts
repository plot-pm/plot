import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';

import { readerLockFile } from '@plot-pm/domain/adapters';

import { run, stillFollowed } from '../../src/server/entry/pr-reader.js';
import { removeTree } from '../rm-tree.mjs';

/** Starts a process that lives until it is killed. */
const liveChild = (): ChildProcess => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });

/** Kills `child` with `SIGKILL` and resolves once it has exited and been reaped. */
const killed = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });

/** The pid of a process that ran and has exited. */
const deadPid = async (): Promise<number> => {
  const child = liveChild();
  const pid = child.pid as number;
  await killed(child);
  return pid;
};

describe('stillFollowed — a board follower is read through process.kill(pid, 0)', () => {
  it('reads a live board.<pid> follower as followed and the same follower as not once it is killed', async () => {
    const child = liveChild();
    const pid = child.pid as number;
    try {
      const now = Date.now();
      const heartbeats = [{ name: `board.${pid}`, at: now }];
      expect(await stillFollowed(heartbeats, null, now)).toBe('followers');
      await killed(child);
      expect(await stillFollowed(heartbeats, null, now)).toBe('none');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });

  it.skipIf(process.getuid?.() === 0)('reads a follower owned by another user (EPERM) as alive', async () => {
    // pid 1 is init or launchd, owned by root: `kill(1, 0)` answers EPERM to
    // any other user, which means the process exists.
    expect(() => process.kill(1, 0)).toThrow(expect.objectContaining({ code: 'EPERM' }));
    const now = Date.now();
    expect(await stillFollowed([{ name: 'board.1', at: now }], null, now)).toBe('followers');
  });

  it('reads a follower whose pid names no process (ESRCH) as not followed', async () => {
    const pid = await deadPid();
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    const now = Date.now();
    expect(await stillFollowed([{ name: `board.${pid}`, at: now }], null, now)).toBe('none');
  });
});

describe('run — a PR beat starts no ps', () => {
  it('runs a pass and its follower check with no ps process, through the production liveness', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-reader-no-ps-'));
    const beforePath = process.env.PATH;
    const beforeHome = process.env.PLOT_PR_INDEX_HOME;
    try {
      const repo = path.join(root, 'repo');
      const scripts = path.join(root, 'installed-scripts');
      const lockDir = path.join(root, 'index');
      const shims = path.join(root, 'shims');
      for (const dir of [repo, scripts, lockDir, shims]) fs.mkdirSync(dir);
      execFileSync('git', ['init', '--quiet'], { cwd: repo });
      const calls = path.join(root, 'calls.log');
      const psCalls = path.join(root, 'ps.log');
      fs.writeFileSync(
        path.join(scripts, 'plot-host.sh'),
        `#!/usr/bin/env bash\necho "$1" >> ${JSON.stringify(calls)}\ncase "$1" in\n  backend) echo github ;;\nesac\nexit 0\n`,
      );
      fs.chmodSync(path.join(scripts, 'plot-host.sh'), 0o755);
      fs.writeFileSync(path.join(scripts, 'plot-config.sh'), `#!/usr/bin/env bash\nprintf '%s\\n' "$3"\n`);
      fs.chmodSync(path.join(scripts, 'plot-config.sh'), 0o755);
      // A `ps` first on PATH records every start and then runs the real one.
      fs.writeFileSync(path.join(shims, 'ps'), `#!/bin/sh\necho "$*" >> ${JSON.stringify(psCalls)}\nexec /bin/ps "$@"\n`);
      fs.chmodSync(path.join(shims, 'ps'), 0o755);
      process.env.PATH = `${shims}${path.delimiter}${beforePath ?? ''}`;
      process.env.PLOT_PR_INDEX_HOME = lockDir;
      const follower = await deadPid();
      await readerLockFile({ home: lockDir }).heartbeat('github', `board.${follower}`, Date.now());

      expect(await run({ lockDir, connector: 'github' }, repo, scripts)).toBe(0);

      expect(fs.readFileSync(calls, 'utf8')).toMatch(/pr-list/);
      expect(fs.existsSync(psCalls)).toBe(false);
    } finally {
      process.env.PATH = beforePath;
      if (beforeHome === undefined) delete process.env.PLOT_PR_INDEX_HOME;
      else process.env.PLOT_PR_INDEX_HOME = beforeHome;
      removeTree(root);
    }
  }, 15_000);
});
