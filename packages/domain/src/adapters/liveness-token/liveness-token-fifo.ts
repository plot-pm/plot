import { execFileSync } from 'node:child_process';
import { closeSync, constants, lstatSync, openSync, readSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { LivenessToken, MadeToken } from '../../ports/liveness-token.js';
import { TOKEN_FILENAME, type TokenReading } from '../../rules/worker-liveness.js';

/** The answer for a path that holds no FIFO. */
const NONE: TokenReading = { state: 'none', madeAtMs: null };

/** Removes a path, ignoring a missing one. */
const remove = (path: string): void => {
  try {
    rmSync(path, { force: true });
  } catch {
    /* nothing to remove */
  }
};

/** What a failed call printed or raised, in one line. */
const reasonOf = (error: unknown): string => {
  const e = error as { stderr?: Buffer | string; code?: string; message?: string };
  const stderr = e.stderr === undefined ? '' : String(e.stderr).trim();
  return (stderr || e.code || e.message || 'unknown error').replace(/\s+/g, ' ');
};

/**
 * The liveness token as a FIFO in the desk.
 *
 * `read` opens the FIFO `O_RDONLY | O_NONBLOCK` and reads once: `EAGAIN` is
 * `held`, end-of-file is `released`, and a missing path, another kind of file
 * or any other error is `none`. `make` runs `mkfifo` on a temporary name, the
 * one process it starts.
 *
 * @param mkfifo - the `mkfifo` program; a test passes one that fails.
 * @returns the token port.
 */
export const livenessTokenFifo = (mkfifo = 'mkfifo'): LivenessToken => ({
  read: (desk) => {
    const path = join(desk, TOKEN_FILENAME);
    let madeAtMs: number;
    try {
      const stat = lstatSync(path);
      if (!stat.isFIFO()) return NONE;
      madeAtMs = stat.mtimeMs;
    } catch {
      return NONE;
    }
    let fd: number;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    } catch {
      return NONE;
    }
    try {
      const read = readSync(fd, Buffer.alloc(1), 0, 1, null);
      return { state: read === 0 ? 'released' : 'held', madeAtMs };
    } catch (error) {
      return (error as { code?: string }).code === 'EAGAIN' ? { state: 'held', madeAtMs } : NONE;
    } finally {
      closeSync(fd);
    }
  },

  make: (desk) => {
    const path = join(desk, TOKEN_FILENAME);
    const temporary = `${path}.${process.pid}.tmp`;
    remove(temporary);
    let fd: number | null = null;
    try {
      execFileSync(mkfifo, ['-m', '600', temporary], { stdio: ['ignore', 'ignore', 'pipe'] });
      fd = openSync(temporary, constants.O_RDWR);
      renameSync(temporary, path);
      return { ok: true, token: { path, fd } };
    } catch (error) {
      if (fd !== null) closeSync(fd);
      remove(temporary);
      remove(path);
      return { ok: false, reason: `${temporary}: ${reasonOf(error)}` };
    }
  },

  close: (token: MadeToken) => {
    try {
      closeSync(token.fd);
    } catch {
      /* already closed */
    }
  },
});
