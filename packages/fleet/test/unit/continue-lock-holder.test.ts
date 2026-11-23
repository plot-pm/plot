import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProcessProbe } from '@plot-pm/domain';
import { CONTINUE_LOCK_BOUND_MS, continueLockHolder, continueLockPath } from '../../src/shared/continue-lock.js';
import { removeTree } from '../rm-tree.mjs';

const NOW = 1_800_000_000_000;

let desk = '';

beforeEach(() => {
  desk = fs.mkdtempSync(path.join(os.tmpdir(), 'continue-lock-holder-'));
});

afterEach(() => {
  removeTree(desk);
});

/** A process table where `alive` answers for every pid and each pid started at `startedAt`. */
const probe = (alive: boolean, startedAt: number): ProcessProbe =>
  ({
    alive: () => alive,
    startedAt: () => startedAt,
    self: () => ({ pid: process.pid, startedAt }),
  }) as unknown as ProcessProbe;

const lockWith = (text: string): void => fs.writeFileSync(continueLockPath(desk), text);

describe('continueLockHolder', () => {
  it('reads a missing lock file as holding nothing', () => {
    expect(continueLockHolder(desk, { probe: probe(true, 100), now: () => NOW })).toEqual({ held: false });
  });

  it('names the live holder and the milliseconds left', () => {
    lockWith(`4242\t100\t${NOW - 10_000}\n`);
    expect(continueLockHolder(desk, { probe: probe(true, 100), now: () => NOW })).toEqual({
      held: true,
      pid: 4242,
      expiresInMs: CONTINUE_LOCK_BOUND_MS - 10_000,
    });
  });

  it('reads an expired lock as holding nothing', () => {
    lockWith(`4242\t100\t${NOW - CONTINUE_LOCK_BOUND_MS}\n`);
    expect(continueLockHolder(desk, { probe: probe(true, 100), now: () => NOW })).toEqual({ held: false });
  });

  it('reads a dead holder as holding nothing', () => {
    lockWith(`4242\t100\t${NOW - 10_000}\n`);
    expect(continueLockHolder(desk, { probe: probe(false, 100), now: () => NOW })).toEqual({ held: false });
  });

  it('reads an unparseable or empty body as holding nothing', () => {
    lockWith('not a record\n');
    expect(continueLockHolder(desk, { probe: probe(true, 100), now: () => NOW })).toEqual({ held: false });
    lockWith('');
    expect(continueLockHolder(desk, { probe: probe(true, 100), now: () => NOW })).toEqual({ held: false });
  });

  it('throws where the lock file exists and cannot be read', () => {
    fs.mkdirSync(continueLockPath(desk));
    expect(() => continueLockHolder(desk, { probe: probe(true, 100), now: () => NOW })).toThrow();
  });
});
