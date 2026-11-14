// The worker loop's half of the liveness token: it takes the descriptor the
// wrapper handed it close-on-exec, and rewrites the desk's pass record.
import { spawn } from 'node:child_process';
import { chmodSync, closeSync, constants, fstatSync, mkdtempSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { livenessTokenFifo } from '@plot-pm/domain/adapters/liveness-token/liveness-token-fifo';
import { TOKEN_FILENAME, TOKEN_ON_PATH_ENV } from '@plot-pm/domain/rules/worker-liveness';

import { acquireToken, recordPassFile } from '../../src/server/entry/worker-loop.js';
import { removeTree } from '../rm-tree.mjs';

const made: string[] = [];
const children: ReturnType<typeof spawn>[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const dir of made.splice(0)) removeTree(dir);
});

const desk = (): string => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'plot-loop-token-')));
  made.push(dir);
  return dir;
};

const ENV = { PLOT_WORKER_TOKEN_FD: '3' };
const token = livenessTokenFifo();

describe('acquireToken', () => {
  it('answers null where the wrapper named no token, or where neither the descriptor nor the path is a FIFO', () => {
    const d = desk();
    expect(acquireToken({}, d)).toBeNull();
    expect(acquireToken(ENV, d, 999)).toBeNull();
    writeFileSync(path.join(d, TOKEN_FILENAME), 'x');
    expect(acquireToken(ENV, d, 999)).toBeNull();
  });

  it('opens the token path again, closes the inherited descriptor, and hands no other child the token', async () => {
    const d = desk();
    const first = token.make(d);
    if (!first.ok) throw new Error(first.reason);
    const inherited = first.token.fd;
    const fresh = acquireToken(ENV, d, inherited);
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(inherited);
    expect(() => fstatSync(inherited)).toThrow();
    expect(fstatSync(fresh!).ino).toBe(statSync(path.join(d, TOKEN_FILENAME)).ino);

    // A child started with three stdio entries outlives the loop's descriptor:
    // the token releases, so the child never held it.
    const other = spawn('sleep', ['30'], { stdio: ['ignore', 'ignore', 'ignore'] });
    children.push(other);
    expect(token.read(d).state).toBe('held');
    closeSync(fresh!);
    expect(token.read(d).state).toBe('released');
  });

  it('re-acquires the token from its path after an execve, where no descriptor arrived', () => {
    const d = desk();
    const first = token.make(d);
    if (!first.ok) throw new Error(first.reason);
    const fresh = acquireToken(ENV, d, 999);
    expect(fresh).not.toBeNull();
    token.close(first.token);
    expect(token.read(d).state).toBe('held');
    closeSync(fresh!);
  });

  it('keeps the inherited descriptor where the path names another FIFO', () => {
    const d = desk();
    const other = desk();
    const theirs = token.make(other);
    const ours = token.make(d);
    if (!theirs.ok || !ours.ok) throw new Error('no token');
    const inherited = openSync(path.join(other, TOKEN_FILENAME), constants.O_RDWR);
    expect(acquireToken(ENV, d, inherited)).toBe(inherited);
    expect(acquireToken(ENV, path.join(d, 'none'), inherited)).toBe(inherited);
    for (const fd of [inherited, theirs.token.fd, ours.token.fd]) closeSync(fd);
  });
});

/** A descriptor this Node holds that `fstat` reports as a FIFO with no device and no inode: libuv's kqueue on macOS; `null` elsewhere. */
const inodelessFifo = (): number | null => {
  for (let fd = 0; fd < 256; fd += 1) {
    try {
      const stat = fstatSync(fd);
      if (stat.isFIFO() && stat.dev === 0 && stat.ino === 0) return fd;
    } catch {
      /* not open */
    }
  }
  return null;
};

describe('acquireToken after the loop replaced itself through execve', () => {
  it('opens the token path where the restart carried the token on it, and leaves fd 3 to its new occupant', () => {
    const d = desk();
    const other = desk();
    const ours = token.make(d);
    const theirs = token.make(other);
    if (!ours.ok || !theirs.ok) throw new Error('no token');
    const occupant = openSync(path.join(other, TOKEN_FILENAME), constants.O_RDWR);
    const fresh = acquireToken({ ...ENV, [TOKEN_ON_PATH_ENV]: '1' }, d, occupant);
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(occupant);
    expect(fstatSync(fresh!).ino).toBe(statSync(path.join(d, TOKEN_FILENAME)).ino);
    expect(() => fstatSync(occupant)).not.toThrow();
    for (const fd of [fresh!, occupant, ours.token.fd, theirs.token.fd]) closeSync(fd);
  });

  it.skipIf(inodelessFifo() === null)('never takes the event loop’s own descriptor, which fstat reports as an inodeless FIFO, for the token', () => {
    const d = desk();
    const ours = token.make(d);
    if (!ours.ok) throw new Error(ours.reason);
    const kqueue = inodelessFifo()!;
    const fresh = acquireToken(ENV, d, kqueue);
    expect(fresh).not.toBe(kqueue);
    expect(fstatSync(fresh!).ino).toBe(statSync(path.join(d, TOKEN_FILENAME)).ino);
    expect(() => fstatSync(kqueue)).not.toThrow();
    closeSync(fresh!);
    token.close(ours.token);
  });
});

describe('acquireToken where the token path cannot be opened', () => {
  it('keeps the inherited descriptor, or answers null with none', () => {
    const d = desk();
    const made_ = token.make(d);
    if (!made_.ok) throw new Error(made_.reason);
    const inherited = openSync(path.join(d, TOKEN_FILENAME), constants.O_RDWR);
    chmodSync(path.join(d, TOKEN_FILENAME), 0o000);
    try {
      expect(acquireToken(ENV, d, inherited)).toBe(inherited);
      expect(() => fstatSync(inherited)).not.toThrow();
      expect(acquireToken(ENV, d, 999)).toBeNull();
    } finally {
      chmodSync(path.join(d, TOKEN_FILENAME), 0o600);
      closeSync(inherited);
      token.close(made_.token);
    }
  });
});

describe('recordPassFile', () => {
  it('rewrites the pass record with the time, and ignores a desk that cannot take it', () => {
    const d = desk();
    recordPassFile(d, Date.UTC(2026, 10, 9, 8, 0, 0));
    expect(readFileSync(path.join(d, '.plot-worker.pass'), 'utf8')).toBe('2026-11-09T08:00:00.000Z\n');
    expect(() => recordPassFile(path.join(d, 'gone'), 0)).not.toThrow();
  });
});
