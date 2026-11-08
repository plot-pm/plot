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
  it('allows ratio and plus over the merge base, and nothing for strict', () => {
    expect(allowedCount(10, { ratio: 0.1, plus: 2 })).toBe(13);
    expect(allowedCount(4, 'strict')).toBe(4);
    expect(allowedCount(0, 'strict')).toBe(0);
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

  it('holds a strict row to the merge base with no tolerance, also while it is an expected failure', () => {
    const base = entry({ id: 'P1', count: 6, tolerance: 'strict', commands: { 'sleep 5': 6 } });
    expect(compareCensus([base], [{ ...base }]).ok).toBe(true);
    expect(compareCensus([base], [{ ...base, count: 7, commands: { 'sleep 5': 7 } }]).ok).toBe(false);
    const zero = { ...base, count: 0, commands: {} };
    expect(compareCensus([zero], [{ ...zero, count: 1 }]).ok).toBe(false);
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
