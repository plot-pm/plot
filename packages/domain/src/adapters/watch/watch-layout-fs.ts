import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { WatchDesk, WatchLayout } from '../../rules/snapshot-change.js';

/** Where the watch set's paths are. */
export interface WatchLayoutPaths {
  /** The main checkout's root. */
  repoRoot: string;
  /** The common git directory, absolute. */
  commonDir: string;
  /** The `Agent registry` directory. */
  registryDir: string;
}

/**
 * Reads the linked desks from `<common git dir>/worktrees/<name>/gitdir`, with
 * no process. Each file holds the path of the desk's `.git` file; its parent is
 * the desk. An entry with no readable `gitdir` is skipped.
 *
 * @param paths - where the watch set's paths are.
 * @returns the layout as of now; a missing `worktrees/` directory lists no desk.
 */
export const readWatchLayout = (paths: WatchLayoutPaths): WatchLayout => {
  const admins = join(paths.commonDir, 'worktrees');
  const desks: WatchDesk[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(admins).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    const admin = join(admins, name);
    try {
      const gitFile = readFileSync(join(admin, 'gitdir'), 'utf8').trim();
      if (gitFile !== '') desks.push({ path: dirname(gitFile), admin });
    } catch {
      continue;
    }
  }
  return { repoRoot: paths.repoRoot, commonDir: paths.commonDir, registryDir: paths.registryDir, desks };
};

/** The trailing bytes of the index: git's own checksum, 20 bytes for SHA-1 and 32 for SHA-256. */
const INDEX_TAIL = 32;

/**
 * Fingerprints a desk's git state from two files, with no process: the text of
 * its `HEAD` and the last bytes of its `index`, which hold the index's own
 * checksum. A `git status` that writes nothing leaves both unchanged.
 *
 * @param admin - the desk's `<common git dir>/worktrees/<name>`.
 * @returns the fingerprint, or `null` where either file cannot be read.
 */
export const deskFingerprint = (admin: string): string | null => {
  try {
    const head = readFileSync(join(admin, 'HEAD'), 'utf8');
    const path = join(admin, 'index');
    const size = statSync(path).size;
    const length = Math.min(size, INDEX_TAIL);
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    return `${head}\0${buffer.toString('hex')}`;
  } catch {
    return null;
  }
};
