import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import { readerLockFixture } from '@plot-pm/domain/adapters';
import type { Detached } from '@plot-pm/domain';
import type { ProcessProbe } from '@plot-pm/domain/ports/process-probe';
import { HEARTBEAT_STALE_MS, READER_STALE_MS } from '@plot-pm/domain/rules/reader-election';

import { freshCacheEntry, maybeRefreshPrs } from '../../src/server/fleet.js';
import { rmTree } from '../helpers.mjs';

// the-boards-share-one-pr-reader: two board instances against one repository
// share ONE PR-reading process rather than each polling the host on its own.
// This file exercises the actual call site in fleet.ts — maybeRefreshPrs,
// through electBoardVerdict and the Detached seam — rather than the pure
// domain rule alone, so a regression at the integration point is caught here
// even where the rule itself stays correct.

const temps: string[] = [];

/** A repository two board instances share, with a real `pr-list` answer. */
const fixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-reader-election-'));
  temps.push(dir);
  const write = (name: string, body: string): void => {
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(path.join(dir, name), 0o755);
  };
  const row = JSON.stringify({
    number: 7, head: 'feature/a', state: 'OPEN', draft: false, checks: 'pass', review: 'none', url: 'https://example.invalid/pr/7',
  });
  write('plot-host.sh', `case "$1" in\n  backend) echo github ;;\n  pr-list) printf '%s\\n' ${JSON.stringify(row)} ;;\nesac\nexit 0`);
  write('plot-config.sh', 'printf \'%s\\n\' "$3"');
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'pr-index'));
  process.env.PLOT_PR_INDEX_HOME = path.join(dir, 'pr-index');
  return dir;
};

const cleanup = (dir: string): void => {
  delete process.env.PLOT_PR_INDEX_HOME;
  rmTree(dir);
  temps.splice(temps.indexOf(dir), 1);
};

/** Builds a recording `Detached` fake: pushes every spawn into `calls` instead of starting a process. */
const recordingDetached = (calls: { script: string; args: readonly string[] }[]): Detached => ({
  node: (script, args) => {
    calls.push({ script, args });
    return { pid: 1, exitCode: () => null };
  },
});

/** A probe that answers `alive` for every pid, and nothing else a board reads. */
const probeAnswering = (alive: boolean | null): ProcessProbe => ({
  alive: () => alive,
  groupAlive: () => alive,
  startedAt: () => null,
  parentPid: () => null,
  self: () => ({ pid: process.pid, startedAt: Date.now(), leadsGroup: false }),
});

describe('one process runs — a second board instance never starts a second reader', () => {
  it('two board instances sharing one repository and one reader lock issue exactly one Detached.node call between them', async () => {
    const dir = fixture();
    try {
      const readerLock = readerLockFixture();
      const calls: { script: string; args: readonly string[] }[] = [];
      const detached = recordingDetached(calls);
      // Two distinct cache entries stand in for two board processes against
      // the same repository: each gets its own CacheEntry (a board process's
      // own in-memory state), but both share the one readerLock and one
      // Detached fake a single machine's lock file and process table would be.
      const optsA = { repoRoot: dir, scriptsDir: dir, readerLock, detached };
      const optsB = { repoRoot: dir, scriptsDir: dir, readerLock, detached };
      const entryA = freshCacheEntry();
      const entryB = freshCacheEntry();

      await maybeRefreshPrs(optsA, entryA);
      expect(calls).toHaveLength(1);

      // The second board's own pass runs after the first already holds no
      // live claim of its own (the board never calls `lock.elect` — only
      // `electBoardVerdict`'s read-only `holder()` + `electReader`), so its
      // verdict reads `elect` again on an empty lock. The spawn guard inside
      // `startReader` is keyed by repoRoot+indexDir+connector and is shared
      // process-wide, so a second caller against the identical key is refused
      // even though it is a different CacheEntry.
      await maybeRefreshPrs(optsB, entryB);
      expect(calls).toHaveLength(1);
    } finally {
      cleanup(dir);
    }
  });
});

describe('a freshly renewed fleetd claim reads as follow, not elect', () => {
  it('a board whose lock already holds a just-renewed fleetd heartbeat follows rather than electing or spawning a reader', async () => {
    const dir = fixture();
    try {
      const readerLock = readerLockFixture();
      const now = Date.now();
      // A real fleetd daemon's claim and heartbeat, renewed moments ago —
      // the exact shape `fleetPrs` itself publishes on every successful pass.
      await readerLock.elect('github', { generation: 0, pid: 424242, startedAt: now - 600_000, at: now });
      await readerLock.heartbeat('github', 'fleetd', now);
      const calls: { script: string; args: readonly string[] }[] = [];
      const detached = recordingDetached(calls);
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached, processProbe: probeAnswering(true) };
      const entry = freshCacheEntry();

      await maybeRefreshPrs(opts, entry);

      // Follow means: no reader started, the fleet's own heartbeat is read as
      // live, and the board's displayed reader names the fleet rather than
      // a reader pid or this board's own overlay.
      expect(calls).toHaveLength(0);
      expect(entry.prReader).toBe('fleet');
    } finally {
      cleanup(dir);
    }
  });

  it('elects where the held claim is this process\'s own pid, never following itself', async () => {
    const dir = fixture();
    try {
      const readerLock = readerLockFixture();
      const now = Date.now();
      // electBoardVerdict passes process.pid as the asking pid; a claim
      // already held BY that same pid reads as elect (already holds it),
      // not follow — electReader's own "elects where this process already
      // holds it" case, exercised here through the board's real call site.
      await readerLock.elect('github', { generation: 0, pid: process.pid, startedAt: now - 600_000, at: now });
      const calls: { script: string; args: readonly string[] }[] = [];
      const detached = recordingDetached(calls);
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached };
      const entry = freshCacheEntry();

      await maybeRefreshPrs(opts, entry);

      expect(entry.prReader).not.toBe('fleet');
    } finally {
      cleanup(dir);
    }
  });
});

describe('a claim whose holder died is not followed', () => {
  it('an unreleased claim from a dead pid, older than READER_STALE_MS, makes the board start a reader and ask the host itself', async () => {
    const dir = fixture();
    try {
      const readerLock = readerLockFixture();
      const now = Date.now();
      // A reader that exited without releasing, 20 minutes ago.
      const old = now - 2 * READER_STALE_MS;
      await readerLock.elect('github', { generation: 0, pid: 999_991, startedAt: old - 60_000, at: old });
      const calls: { script: string; args: readonly string[] }[] = [];
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached: recordingDetached(calls), processProbe: probeAnswering(false) };
      const entry = freshCacheEntry();

      await maybeRefreshPrs(opts, entry);

      expect(calls).toHaveLength(1);
      expect(entry.prReader).toBe('this board');
      expect(entry.prsByNumber?.has(7)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('a just-renewed claim from a pid the process table reads as dead is not followed either', async () => {
    const dir = fixture();
    try {
      const readerLock = readerLockFixture();
      // A real pid that has exited: the default probe reads it through kill(pid, 0).
      const gone = spawnSync(process.execPath, ['-e', '']).pid;
      expect(gone).toBeGreaterThan(0);
      const now = Date.now();
      await readerLock.elect('github', { generation: 0, pid: gone as number, startedAt: now - 60_000, at: now });
      const calls: { script: string; args: readonly string[] }[] = [];
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached: recordingDetached(calls) };
      const entry = freshCacheEntry();

      await maybeRefreshPrs(opts, entry);

      expect(calls).toHaveLength(1);
      expect(entry.prReader).toBe('this board');
      expect(entry.prsByNumber?.has(7)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('a just-renewed claim from a live pid is followed and names that reader', async () => {
    const dir = fixture();
    try {
      const readerLock = readerLockFixture();
      const now = Date.now();
      await readerLock.elect('github', { generation: 0, pid: 999_992, startedAt: now - 60_000, at: now });
      const calls: { script: string; args: readonly string[] }[] = [];
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached: recordingDetached(calls), processProbe: probeAnswering(true) };
      const entry = freshCacheEntry();

      await maybeRefreshPrs(opts, entry);

      expect(calls).toHaveLength(0);
      expect(entry.prReader).toBe('reader 999992');
    } finally {
      cleanup(dir);
    }
  });
});

describe('a board following a standalone reader with no fleet', () => {
  it('reads issues from the host on every tick, because no fleet writes the issue index', async () => {
    const dir = fixture();
    try {
      const hosts = path.join(dir, 'hosts.log');
      fs.writeFileSync(
        path.join(dir, 'plot-host.sh'),
        `#!/usr/bin/env bash\necho "$1" >> ${JSON.stringify(hosts)}\ncase "$1" in\n  backend) echo github ;;\nesac\nexit 0\n`,
      );
      const issueListed = (): number =>
        fs.existsSync(hosts) ? fs.readFileSync(hosts, 'utf8').split('\n').filter((l) => l === 'issue-list').length : 0;
      const readerLock = readerLockFixture();
      const now = Date.now();
      // A standalone reader's claim: live, renewed, and no `fleetd` heartbeat or fleet bridge beside it.
      await readerLock.elect('github', { generation: 0, pid: 999_993, startedAt: now - 60_000, at: now });
      const calls: { script: string; args: readonly string[] }[] = [];
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached: recordingDetached(calls), processProbe: probeAnswering(true) };
      const entry = freshCacheEntry();

      await maybeRefreshPrs(opts, entry);
      expect(entry.prReader).toBe('reader 999993');
      const afterFirst = issueListed();
      expect(afterFirst).toBeGreaterThan(0);

      entry.prNextAt = 0;
      entry.prNextIsBackoff = false;
      entry.issueNextAt = 0;
      entry.issueNextIsBackoff = false;
      await maybeRefreshPrs(opts, entry);

      expect(entry.prReader).toBe('reader 999993');
      expect(issueListed()).toBeGreaterThan(afterFirst);
      expect(calls).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  it('writes its heartbeat before it reads, so a reader started this tick counts it even when the tick throws', async () => {
    const dir = fixture();
    try {
      const readerLock = readerLockFixture();
      // Starting the reader throws, so nothing after it in the tick runs.
      const throwing: Detached = {
        node: () => {
          throw new Error('spawn failed');
        },
      };
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached: throwing, processProbe: probeAnswering(false) };
      const entry = freshCacheEntry();

      await expect(maybeRefreshPrs(opts, entry)).rejects.toThrow('spawn failed');

      const beats = await readerLock.heartbeats('github');
      expect(beats.ok && beats.value.map((b) => b.name)).toContain(`board.${process.pid}`);
    } finally {
      cleanup(dir);
    }
  });
});

describe('a board restarts a reader that exited', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a new reader once the last one exited and HEARTBEAT_STALE_MS passed since it started, and not before', async () => {
    const dir = fixture();
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      const t0 = Date.now();
      const readerLock = readerLockFixture();
      let exited: number | null = null;
      const calls: { script: string; args: readonly string[] }[] = [];
      const detached: Detached = {
        node: (script, args) => {
          calls.push({ script, args });
          return { pid: 1, exitCode: () => exited };
        },
      };
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached };
      const entry = freshCacheEntry();
      const tick = async (): Promise<void> => {
        entry.prNextAt = 0;
        entry.prNextIsBackoff = false;
        await maybeRefreshPrs(opts, entry);
      };

      await tick();
      expect(calls).toHaveLength(1);

      // The reader exits at once (first pass, or a backoff that outlived the heartbeats).
      exited = 0;
      vi.setSystemTime(t0 + 1_000);
      await tick();
      expect(calls).toHaveLength(1);

      vi.setSystemTime(t0 + HEARTBEAT_STALE_MS);
      await tick();
      expect(calls).toHaveLength(2);
    } finally {
      cleanup(dir);
    }
  });

  it('heartbeats on a tick whose PR gate is closed, so a long reader backoff does not make it read as gone', async () => {
    const dir = fixture();
    try {
      const readerLock = readerLockFixture();
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached: recordingDetached([]) };
      const entry = freshCacheEntry();
      entry.backend = 'github';
      entry.prNextAt = Date.now() + 10 * 60_000;
      entry.prNextIsBackoff = true;

      await maybeRefreshPrs(opts, entry);

      const beats = await readerLock.heartbeats('github');
      expect(beats.ok ? beats.value.map((b) => b.name) : []).toEqual([`board.${process.pid}`]);
    } finally {
      cleanup(dir);
    }
  });

  it('shows a healthy standalone reader as reader <pid>, not as the fleet', async () => {
    const dir = fixture();
    try {
      const readerLock = readerLockFixture();
      const now = Date.now();
      await readerLock.elect('github', { generation: 0, pid: process.ppid, startedAt: now - 60_000, at: now });
      await readerLock.heartbeat('github', `reader.${process.ppid}`, now);
      const calls: { script: string; args: readonly string[] }[] = [];
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached: recordingDetached(calls) };
      const entry = freshCacheEntry();

      await maybeRefreshPrs(opts, entry);

      expect(entry.prReader).toBe(`reader ${process.ppid}`);
      expect(calls).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });
});
