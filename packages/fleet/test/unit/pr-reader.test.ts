import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { HEARTBEAT_STALE_MS } from '@plot-pm/domain/rules/reader-election';
import { readerLockFile, readerLockFixture } from '@plot-pm/domain/adapters';

import { run, scriptDirFor, stillFollowed } from '../../src/server/entry/pr-reader.js';
import { removeTree } from '../rm-tree.mjs';

/** A liveness reader that always answers "alive" for the pids given. */
const allAlive = async (pids: readonly number[]) =>
  new Map(pids.map((pid) => [pid, { alive: true, startedAt: null }]));

/** A liveness reader that always answers "dead" for the pids given. */
const allDead = async (pids: readonly number[]) =>
  new Map(pids.map((pid) => [pid, { alive: false, startedAt: null }]));

describe('stillFollowed — the reader checks heartbeat counts, never a starting pid', () => {
  it('reads followers from a live board heartbeat whose own pid never named this reader at start', async () => {
    // The acceptance clause: "survives the exit of the board that started it".
    // The board that started this reader is long gone — its pid appears
    // nowhere in this call — and a second board's heartbeat is what keeps
    // the reader alive. Nothing here is keyed to a starting pid at all.
    const now = Date.now();
    const otherBoardPid = 999_999;
    const heartbeats = [{ name: `board.${otherBoardPid}`, at: now }];
    expect(await stillFollowed(heartbeats, now, allAlive)).toBe('followers');
  });

  it('reads none once every board heartbeat is both stale and the process dead, regardless of which board started the reader', async () => {
    const now = Date.now();
    const startingBoardPid = 111_111;
    // Deliberately a heartbeat under a DIFFERENT pid than the board that
    // started this reader — proving the exit check counts live heartbeats,
    // not whether the starting board's own pid is still running.
    const heartbeats = [{ name: `board.${startingBoardPid + 1}`, at: now - HEARTBEAT_STALE_MS - 1 }];
    expect(await stillFollowed(heartbeats, now, allDead)).toBe('none');
  });

  it('reads none with zero heartbeats published, independent of any pid', async () => {
    const now = Date.now();
    expect(await stillFollowed([], now, allAlive)).toBe('none');
  });

  it('stays followed exactly up to HEARTBEAT_STALE_MS and reads none one millisecond past it — the 2-minute bound named by the constant, not a hardcoded guess', async () => {
    const now = Date.now();
    const boardPid = 222_222;
    const justFresh = [{ name: `board.${boardPid}`, at: now - (HEARTBEAT_STALE_MS - 1) }];
    expect(await stillFollowed(justFresh, now, allAlive)).toBe('followers');

    const justStale = [{ name: `board.${boardPid}`, at: now - HEARTBEAT_STALE_MS }];
    expect(await stillFollowed(justStale, now, allAlive)).toBe('none');
  });
});

/** A `PrWorld` whose host answers nothing and whose store holds nothing, stamped at `now`. */
const quietWorld = (now: number) =>
  ({
    scripts: { hostSaid: async () => ({ answer: 'answered' as const, stdout: '' }) },
    host: { backend: async () => ({ ok: true as const, value: 'github' }) },
    store: {
      read: async () => ({ ok: true as const, value: null }),
      write: async () => ({ ok: true as const, value: undefined }),
      location: async () => ({ ok: true as const, value: '/dev/null' }),
    },
    now: () => now,
  }) as unknown as import('../../src/shared/pr-refresh.js').PrWorld;

describe('the reader and fleetd heartbeat under different names', () => {
  it('a reader pass heartbeats as reader.<pid>, which stillFollowed never counts as fleetd or as a follower', async () => {
    const { fleetPrs } = await import('../../src/shared/fleet-clock.js');
    const { freshPrState } = await import('../../src/shared/pr-refresh.js');
    const lock = readerLockFixture();
    const now = Date.now();
    await fleetPrs(quietWorld(now), freshPrState(), { lock, name: `reader.${process.pid}` }, () => undefined)();
    const beats = await lock.heartbeats('github');
    const names = beats.ok ? beats.value.map((b) => b.name) : [];
    expect(names).toEqual([`reader.${process.pid}`]);
    expect(await stillFollowed(beats.ok ? beats.value : [], now, allAlive)).toBe('none');
  });

  it('reads fleetd for any fresh fleetd heartbeat', async () => {
    const now = Date.now();
    expect(await stillFollowed([{ name: 'fleetd', at: now - 1_000 }], now, allDead)).toBe('fleetd');
  });

  it('a fleetd pass that reads held against a live reader still publishes its fleetd heartbeat', async () => {
    const { fleetPrs } = await import('../../src/shared/fleet-clock.js');
    const { freshPrState } = await import('../../src/shared/pr-refresh.js');
    const lock = readerLockFixture({ isAlive: () => true });
    const now = Date.now();
    // The standalone reader: another live process holding a fresh claim.
    await lock.elect('github', { generation: 0, pid: process.ppid, startedAt: now - 60_000, at: now });
    await fleetPrs(quietWorld(now), freshPrState(), { lock }, () => undefined)();
    const held = await lock.holder('github');
    expect(held.ok && held.value?.pid).toBe(process.ppid);
    const beats = await lock.heartbeats('github');
    expect(beats.ok ? beats.value.map((b) => b.name) : []).toContain('fleetd');
  });
});

describe('run — the reader hands its role back to fleetd', () => {
  it('exits and releases its claim when a fresh fleetd heartbeat exists, though a board still follows it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-reader-handback-'));
    try {
      const repo = path.join(root, 'repo');
      const scripts = path.join(root, 'installed-scripts');
      const lockDir = path.join(root, 'index');
      fs.mkdirSync(repo);
      fs.mkdirSync(scripts);
      fs.mkdirSync(lockDir);
      execFileSync('git', ['init', '--quiet'], { cwd: repo });
      fs.writeFileSync(path.join(scripts, 'plot-host.sh'), '#!/usr/bin/env bash\ncase "$1" in\n  backend) echo github ;;\nesac\nexit 0\n');
      fs.chmodSync(path.join(scripts, 'plot-host.sh'), 0o755);
      fs.writeFileSync(path.join(scripts, 'plot-config.sh'), `#!/usr/bin/env bash\nprintf '%s\\n' "$3"\n`);
      fs.chmodSync(path.join(scripts, 'plot-config.sh'), 0o755);
      const lock = readerLockFile({ home: lockDir });
      const now = Date.now();
      // A board that still follows, and a restarted fleetd that read `held` and heartbeat.
      await lock.heartbeat('github', `board.${process.pid}`, now);
      await lock.heartbeat('github', 'fleetd', now);
      const before = process.env.PLOT_PR_INDEX_HOME;
      process.env.PLOT_PR_INDEX_HOME = lockDir;
      try {
        expect(await run({ lockDir, connector: 'github' }, repo, scripts, () => undefined, allAlive)).toBe(0);
      } finally {
        if (before === undefined) delete process.env.PLOT_PR_INDEX_HOME;
        else process.env.PLOT_PR_INDEX_HOME = before;
      }
      const holder = await lock.holder('github');
      expect(holder.ok && holder.value).toBe(null);
      // fleetd's next pass, from another live pid, elects.
      const next = await lock.elect('github', { generation: 0, pid: process.ppid, startedAt: now - 60_000, at: Date.now() });
      expect(next.ok && next.value).toBe('elected');
    } finally {
      removeTree(root);
    }
  }, 15_000);
});

describe('scriptDirFor — the reader finds its scripts beside its own bundle', () => {
  it('resolves the directory above the bundle, whatever repository the reader runs in', () => {
    const bundle = pathToFileURL('/opt/plot/skills/plot/scripts/board/plot-pr-reader.mjs').href;
    expect(scriptDirFor({}, bundle)).toBe('/opt/plot/skills/plot/scripts');
  });

  it('takes PLOT_SCRIPTS_DIR over the bundle location', () => {
    const bundle = pathToFileURL('/opt/plot/skills/plot/scripts/board/plot-pr-reader.mjs').href;
    expect(scriptDirFor({ PLOT_SCRIPTS_DIR: '/elsewhere/scripts' }, bundle)).toBe('/elsewhere/scripts');
  });
});

describe('run — one pass with no follower', () => {
  it('asks the host through the scripts directory it is given, not the repository, and releases its claim on exit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-reader-run-'));
    try {
      const repo = path.join(root, 'repo');
      const scripts = path.join(root, 'installed-scripts');
      const lockDir = path.join(root, 'index');
      fs.mkdirSync(repo);
      fs.mkdirSync(scripts);
      fs.mkdirSync(lockDir);
      execFileSync('git', ['init', '--quiet'], { cwd: repo });
      const calls = path.join(root, 'calls.log');
      fs.writeFileSync(
        path.join(scripts, 'plot-host.sh'),
        `#!/usr/bin/env bash\necho "$1" >> ${JSON.stringify(calls)}\ncase "$1" in\n  backend) echo github ;;\nesac\nexit 0\n`,
      );
      fs.chmodSync(path.join(scripts, 'plot-host.sh'), 0o755);
      fs.writeFileSync(path.join(scripts, 'plot-config.sh'), `#!/usr/bin/env bash\nprintf '%s\\n' "$3"\n`);
      fs.chmodSync(path.join(scripts, 'plot-config.sh'), 0o755);
      const before = process.env.PLOT_PR_INDEX_HOME;
      process.env.PLOT_PR_INDEX_HOME = lockDir;
      try {
        expect(await run({ lockDir, connector: 'github' }, repo, scripts, () => undefined, allDead)).toBe(0);
      } finally {
        if (before === undefined) delete process.env.PLOT_PR_INDEX_HOME;
        else process.env.PLOT_PR_INDEX_HOME = before;
      }
      expect(fs.readFileSync(calls, 'utf8')).toMatch(/pr-list/);
      const beats = await readerLockFile({ home: lockDir }).heartbeats('github');
      expect(beats.ok ? beats.value.map((b) => b.name) : []).toEqual([`reader.${process.pid}`]);
      const holder = await readerLockFile({ home: lockDir }).holder('github');
      expect(holder.ok && holder.value).toBe(null);
    } finally {
      removeTree(root);
    }
  });
});
