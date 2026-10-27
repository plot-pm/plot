import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { readerLockFixture } from '@plot-pm/domain/adapters';
import type { Detached } from '@plot-pm/domain';

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
      const opts = { repoRoot: dir, scriptsDir: dir, readerLock, detached };
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
