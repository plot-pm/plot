import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { removeTree } from '../rm-tree.mjs';
import {
  allowedCount,
  commandCounts,
  commandKey,
  compareCensus,
  type CensusEntry,
  grownCommands,
  NOISE_TOLERANCE,
  productRoot,
  readCensusReport,
  recordCensus,
} from './census-report.js';

const sandboxes: string[] = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0)) removeTree(dir);
});

const sandbox = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-census-report-'));
  sandboxes.push(dir);
  return dir;
};

const exec = (path: string, ...rest: string[]) => ({ path, argv: [path, ...rest] });

const entry = (over: Partial<CensusEntry> = {}): CensusEntry => ({
  id: 'S4',
  fixture: { desks: 3, openPrs: 5, host: 'github' },
  count: 10,
  unit: 'execve per pass',
  tolerance: { ratio: 0.1, plus: 2 },
  commands: {},
  ...over,
});

describe('commandKey', () => {
  it('names the image and a first argument that is not an option, both by basename', () => {
    expect(commandKey(exec('/usr/bin/git', 'rev-parse', '--show-toplevel'))).toBe('git rev-parse');
    expect(commandKey(exec('/bin/bash', '/w/base/skills/plot/scripts/plot-host.sh', 'backend'))).toBe('bash plot-host.sh');
    expect(commandKey(exec('/bin/bash', '-c', 'kill -0 1'))).toBe('bash');
    expect(commandKey(exec('/bin/sleep'))).toBe('sleep');
  });

  it('counts images by key', () => {
    expect(commandCounts([exec('/bin/sleep', '1'), exec('/usr/bin/sleep', '1'), exec('/usr/bin/git', 'status')])).toEqual({
      'sleep 1': 2,
      'git status': 1,
    });
  });
});

describe('recordCensus and readCensusReport', () => {
  it('writes nothing when PLOT_CENSUS_REPORT is unset', () => {
    expect(recordCensus({ id: 'S1', fixture: { desks: 0, openPrs: 0, host: 'github' }, count: 0, unit: 'u' }, {})).toBeNull();
  });

  it('appends one line per record, strict by default, with per-command counts', () => {
    const path = join(sandbox(), 'report.jsonl');
    const env = { PLOT_CENSUS_REPORT: path };
    recordCensus(
      { id: 'P1', fixture: { desks: 1, openPrs: 0, host: 'github' }, count: 2, unit: 'execve per minute', execs: [exec('/bin/sleep', '5'), exec('/bin/sleep', '5')] },
      env,
    );
    recordCensus({ id: 'S5', fixture: { desks: 1, openPrs: 0, host: 'bitbucket' }, count: 7, unit: 'execve per change', tolerance: { ratio: 0.1, plus: 2 } }, env);

    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(readCensusReport(path)).toEqual([
      { id: 'P1', fixture: { desks: 1, openPrs: 0, host: 'github' }, count: 2, unit: 'execve per minute', tolerance: 'strict', commands: { 'sleep 5': 2 } },
      { id: 'S5', fixture: { desks: 1, openPrs: 0, host: 'bitbucket' }, count: 7, unit: 'execve per change', tolerance: { ratio: 0.1, plus: 2 }, commands: {} },
    ]);
  });

  it('reads a missing report as no entries', () => {
    expect(readCensusReport(join(sandbox(), 'absent.jsonl'))).toEqual([]);
  });

  it('refuses a line that is not a census entry, naming file and line', () => {
    const path = join(sandbox(), 'bad.jsonl');
    writeFileSync(path, `${JSON.stringify(entry())}\n{"id":"S1"}\n`);
    expect(() => readCensusReport(path)).toThrow(`${path}:2: not a census entry`);
    writeFileSync(path, 'nope\n');
    expect(() => readCensusReport(path)).toThrow(`${path}:1: not JSON`);
  });
});

describe('productRoot', () => {
  it('reads PLOT_CENSUS_PRODUCT, and defaults to this checkout', () => {
    expect(productRoot({ PLOT_CENSUS_PRODUCT: '/w/base' })).toBe('/w/base');
    expect(productRoot({})).toBe(resolve(import.meta.dirname, '../../../..'));
  });
});

describe('compareCensus', () => {
  it('allows ratio and plus over the merge base, nothing for strict over 0, and the noise tolerance for strict over a non-zero base', () => {
    expect(allowedCount(10, { ratio: 0.1, plus: 2 })).toBe(13);
    expect(allowedCount(0, 'strict')).toBe(0);
    expect(allowedCount(10, 'strict')).toBe(allowedCount(10, NOISE_TOLERANCE));
    expect(NOISE_TOLERANCE).toEqual({ ratio: 0.1, plus: 2 });
  });

  it('passes a count inside its tolerance', () => {
    expect(compareCensus([entry()], [entry({ count: 13 })]).ok).toBe(true);
  });

  it('fails a grown count and names both counts, the fixture, the tolerance and the commands that grew', () => {
    const base = entry({ commands: { 'git rev-parse': 3, sleep: 7 } });
    const head = entry({ count: 14, commands: { 'git rev-parse': 7, sleep: 7 } });

    const actual = compareCensus([base], [head]);

    expect(actual.ok).toBe(false);
    expect(actual.lines).toEqual([
      'FAIL S4 github desks=3 prs=5: HEAD 14, merge base 10 execve per pass; tolerance 10 % + 2, limit 13',
      '     +4  git rev-parse (3 -> 7)',
    ]);
  });

  it('holds a strict row whose merge-base count is 0 to no growth at all', () => {
    const zero = entry({ id: 'P2', count: 0, tolerance: 'strict' });

    const actual = compareCensus([zero], [{ ...zero, count: 1 }]);

    expect(actual.ok).toBe(false);
    expect(actual.lines[0]).toBe('FAIL P2 github desks=3 prs=5: HEAD 1, merge base 0 execve per pass; tolerance strict, limit 0');
  });

  it('passes per-minute jitter on a strict row whose merge-base count is not 0, and names the noise tolerance', () => {
    const s3 = entry({ id: 'S3', count: 1428, unit: 'execve per minute', tolerance: 'strict' });
    const p1 = entry({ id: 'P1', count: 58.68408401438921, unit: 'sleep execve per minute', tolerance: 'strict' });

    const actual = compareCensus([s3, p1], [{ ...s3, count: 1429 }, { ...p1, count: 58.69770680992887 }]);

    expect(actual.ok).toBe(true);
    expect(actual.lines[0]).toBe(
      'ok   S3 github desks=3 prs=5: HEAD 1429, merge base 1428 execve per minute; tolerance strict→noise 10 % + 2 (base > 0), limit 1572.8',
    );
  });

  it('fails real growth on a strict row whose merge-base count is not 0', () => {
    const base = entry({ id: 'S1', count: 100, unit: 'execve per minute', tolerance: 'strict', commands: { sleep: 100 } });

    const actual = compareCensus([base], [{ ...base, count: 120, commands: { sleep: 120 } }]);

    expect(actual.ok).toBe(false);
    expect(actual.lines).toEqual([
      'FAIL S1 github desks=3 prs=5: HEAD 120, merge base 100 execve per minute; tolerance strict→noise 10 % + 2 (base > 0), limit 112',
      '     +20  sleep (100 -> 120)',
    ]);
  });

  it('keeps an explicit tolerance as stated', () => {
    const base = entry({ count: 100, tolerance: { ratio: 0.01, plus: 0 } });

    const actual = compareCensus([base], [{ ...base, count: 102 }]);

    expect(actual.ok).toBe(false);
    expect(actual.lines[0]).toBe('FAIL S4 github desks=3 prs=5: HEAD 102, merge base 100 execve per pass; tolerance 1 % + 0, limit 101');
  });

  it('passes a row the merge base did not record with one "no before" line', () => {
    const actual = compareCensus([], [entry({ id: 'S6' })]);
    expect(actual).toEqual({
      ok: true,
      lines: ['S6 github desks=3 prs=5: no before (10 execve per pass on HEAD; the merge base recorded none) - passes'],
    });
  });

  it('compares one scenario per fixture, and the last entry of a repeated key', () => {
    const gh = entry();
    const bb = entry({ fixture: { desks: 3, openPrs: 5, host: 'bitbucket' }, count: 50 });
    const actual = compareCensus([gh, bb], [entry({ count: 99 }), entry({ count: 11 }), { ...bb }]);
    expect(actual.ok).toBe(true);
    expect(actual.lines).toHaveLength(2);
  });

  it('lists at most five grown commands, the largest growth first', () => {
    const head = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => [k, i + 1]));
    expect(grownCommands({}, head).map((c) => c.key)).toEqual(['f', 'e', 'd', 'c', 'b']);
    expect(grownCommands({ a: 5 }, { a: 5 })).toEqual([]);
  });
});
