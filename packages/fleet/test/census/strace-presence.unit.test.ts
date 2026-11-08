import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { removeTree } from '../rm-tree.mjs';
import { censusGate, findStrace, requireStrace } from './strace-run.js';

const sandboxes: string[] = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0)) removeTree(dir);
});

const sandbox = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-census-'));
  sandboxes.push(dir);
  return dir;
};

describe('the strace presence check', () => {
  it('finds no strace on a PATH that holds none', () => {
    expect(findStrace(sandbox())).toBeNull();
    expect(findStrace('')).toBeNull();
  });

  it('finds an executable strace on PATH', () => {
    const empty = sandbox();
    const bin = sandbox();
    writeFileSync(join(bin, 'strace'), '#!/bin/sh\n');
    chmodSync(join(bin, 'strace'), 0o755);

    expect(findStrace(`${empty}:${bin}`)).toBe(join(bin, 'strace'));
  });

  it('skips a file named strace that is not executable', () => {
    const bin = sandbox();
    writeFileSync(join(bin, 'strace'), '');
    chmodSync(join(bin, 'strace'), 0o644);

    expect(findStrace(bin)).toBeNull();
  });

  it('fails by name on Linux when strace is absent from PATH', () => {
    const actual = censusGate({ stracePath: findStrace(sandbox()), platform: 'linux' });

    expect(actual.kind).toBe('fail');
    expect(actual.kind === 'fail' && actual.message).toMatch(/^process census: strace not found on PATH/);
    expect(() => requireStrace(sandbox())).toThrow(/strace not found on PATH/);
  });

  it('skips with one line naming strace on macOS', () => {
    const actual = censusGate({ stracePath: null, platform: 'darwin' });

    expect(actual).toEqual({
      kind: 'skip',
      line: 'process census skipped: strace not found on PATH (macOS has no strace; the census runs on Linux CI)',
    });
  });

  it('runs where strace is present', () => {
    expect(censusGate({ stracePath: '/usr/bin/strace', platform: 'linux' })).toEqual({
      kind: 'run',
      strace: '/usr/bin/strace',
    });
  });
});
