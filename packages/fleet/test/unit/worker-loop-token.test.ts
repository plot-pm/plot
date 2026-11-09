// The worker loop's half of the liveness token: it finds the descriptor the
// wrapper handed it and rewrites the desk's pass record each pass.
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { recordPassFile, tokenFdOf } from '../../src/server/entry/worker-loop.js';
import { removeTree } from '../rm-tree.mjs';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) removeTree(dir);
});

describe('tokenFdOf', () => {
  it('answers 3 only where the wrapper named fd 3 and fd 3 is a FIFO', () => {
    expect(tokenFdOf({ PLOT_WORKER_TOKEN_FD: '3' }, () => true)).toBe(3);
    expect(tokenFdOf({ PLOT_WORKER_TOKEN_FD: '3' }, () => false)).toBeNull();
    expect(tokenFdOf({ PLOT_WORKER_TOKEN_FD: '4' }, () => true)).toBeNull();
    expect(tokenFdOf({}, () => true)).toBeNull();
  });

  it('reads this test process’s fd 3 as no FIFO', () => {
    expect(tokenFdOf({ PLOT_WORKER_TOKEN_FD: '3' })).toBeNull();
  });
});

describe('recordPassFile', () => {
  it('rewrites the pass record with the pass time, and ignores a desk that cannot take it', () => {
    const desk = mkdtempSync(path.join(os.tmpdir(), 'plot-loop-pass-'));
    made.push(desk);
    recordPassFile(desk, Date.UTC(2026, 10, 9, 8, 0, 0));
    expect(readFileSync(path.join(desk, '.plot-worker.pass'), 'utf8')).toBe('2026-11-09T08:00:00.000Z\n');
    expect(statSync(path.join(desk, '.plot-worker.pass')).isFile()).toBe(true);
    expect(() => recordPassFile(path.join(desk, 'gone'), 0)).not.toThrow();
  });
});
