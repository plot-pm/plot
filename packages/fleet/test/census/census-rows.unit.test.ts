import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CENSUS_ROWS, recordCount, rowTitle, topCommands, type CensusRow } from './census-rows.js';
import type { ExecRecord } from './strace-execs.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const PLAN = fileURLToPath(new URL('../../../../docs/plans/2026-11-08-process-census-gate.md', import.meta.url));

/** The plan's two tables, `| Id | … | Target | Turned green by |`, as id → [target, turned green by]. */
const planRows = (): Map<string, { target: string; greenBy: string }> => {
  const rows = new Map<string, { target: string; greenBy: string }>();
  for (const line of readFileSync(PLAN, 'utf8').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const id = cells[1] ?? '';
    if (!/^[SP]\d$/.test(id)) continue;
    rows.set(id, { target: cells[cells.length - 3] ?? '', greenBy: cells[cells.length - 2] ?? '' });
  }
  return rows;
};

/** Every test title the census files write, read from their source. */
const censusSources = (): string =>
  readdirSync(here)
    .filter((f) => f.endsWith('.census.test.ts'))
    .map((f) => readFileSync(`${here}${f}`, 'utf8'))
    .join('\n');

/** Whether a zero row carries `green: true`, the mark its slice sets when it turns the row into `it`. */
const isGreen = (row: CensusRow): boolean => row.target === 'zero' && row.green === true;

const exec = (path: string, ...argv: string[]): ExecRecord => ({ pid: 1, ppid: null, syscall: 'execve', path, argv });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the census rows', () => {
  it('holds every row of the plan, S1 to S6 and P1 to P4', () => {
    expect(Object.keys(CENSUS_ROWS).sort()).toEqual([...planRows().keys()].sort());
    expect(Object.keys(CENSUS_ROWS).sort()).toEqual(['P1', 'P2', 'P3', 'P4', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  });

  it('writes a zero target of the plan as a zero row, and every other as measured', () => {
    for (const [id, { target }] of planRows()) {
      expect(CENSUS_ROWS[id as keyof typeof CENSUS_ROWS].target, id).toBe(target.startsWith('0') ? 'zero' : 'measured');
    }
  });

  it('names in each zero row title the plan and slice the plan says turns it green', () => {
    for (const [id, { greenBy }] of planRows()) {
      const row = CENSUS_ROWS[id as keyof typeof CENSUS_ROWS];
      if (row.target !== 'zero') continue;
      const title = rowTitle(row);
      for (const name of greenBy.match(/`([^`]+)`/g)?.map((s) => s.slice(1, -1)) ?? []) expect(title, id).toContain(name);
      const slice = /slice \*([^*]+)\*/.exec(greenBy)?.[1];
      if (slice !== undefined) expect(title, id).toContain(`slice ${slice}`);
      expect(title, id).toMatch(isGreen(row) ? /turned green by / : /expected to fail until /);
    }
  });

  it('writes every zero row as it.fails until it turns green, and every green or measured row as it', () => {
    const source = censusSources();
    for (const row of Object.values(CENSUS_ROWS)) {
      const call = row.target === 'zero' && !isGreen(row) ? 'it.fails(' : 'it(';
      const other = call === 'it(' ? 'it.fails(' : 'it(';
      expect(source, row.id).not.toContain(`${other}rowTitle(CENSUS_ROWS.${row.id}`);
      expect(source, row.id).toContain(`${call}rowTitle(CENSUS_ROWS.${row.id}`);
    }
  });

  it('prints a count beside its fixture size and top commands, and records nothing with no report path', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const execs = [exec('/usr/bin/git', 'git', 'rev-parse'), exec('/usr/bin/git', 'git', 'log'), exec('/bin/sleep', 'sleep', '1')];
    const saved = process.env['PLOT_CENSUS_REPORT'];
    delete process.env['PLOT_CENSUS_REPORT'];
    try {
      const line = recordCount(CENSUS_ROWS.S5, { host: 'github', desks: 3, openPrs: 5 }, 3, execs);

      expect(line).toBe('process census S5 host=github desks=3 open-prs=5: 3 execve per change (top: git x2, sleep x1)');
      expect(log).toHaveBeenCalledWith(line);
    } finally {
      if (saved !== undefined) process.env['PLOT_CENSUS_REPORT'] = saved;
    }
  });

  it('lists at most five top commands, most first', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const execs = names.flatMap((n, i) => Array.from({ length: 6 - i }, () => exec(`/bin/${n}`, n)));

    expect(topCommands(execs)).toBe('a x6, b x5, c x4, d x3, e x2');
  });
});
