import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CENSUS_ROWS, recordCount, rowTitle, topCommands, type CensusRow } from './census-rows.js';
import type { ExecRecord } from './strace-execs.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const PLAN = fileURLToPath(new URL('../../../../docs/plans/2026-11-08-process-census-gate.md', import.meta.url));
const WRAPPER_PLAN = fileURLToPath(new URL('../../../../docs/plans/2026-11-09-node-worker-wrapper.md', import.meta.url));
const BOARD_API_PLAN = fileURLToPath(new URL('../../../../docs/plans/2026-11-09-board-api-starts-nothing.md', import.meta.url));
const LIVENESS_PLAN = fileURLToPath(new URL('../../../../docs/plans/2026-11-09-liveness-token.md', import.meta.url));
const TRIGGERS_PLAN = fileURLToPath(new URL('../../../../docs/plans/2026-11-10-triggers-replace-the-tick.md', import.meta.url));
const CONNECTORS_PLAN = fileURLToPath(new URL('../../../../docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md', import.meta.url));
const GITHUB_READS_PLAN = fileURLToPath(new URL('../../../../docs/plans/2026-11-09-github-reads-in-process.md', import.meta.url));

/** The rows of the census plan that a later plan retired. */
const RETIRED = new Set(['P1']);

/** The plan's two tables, `| Id | … | Target | Turned green by |`, as id → [target, turned green by]. */
const planRows = (): Map<string, { target: string; greenBy: string }> => {
  const rows = new Map<string, { target: string; greenBy: string }>();
  for (const line of readFileSync(PLAN, 'utf8').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const id = cells[1] ?? '';
    if (!/^[SP]\d$/.test(id) || RETIRED.has(id)) continue;
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
  it('holds every row of the plan but the retired P1, D1 of the worker wrapper plan, S7 of the board API plan, P5 of the GitHub reads plan, P6 of the liveness token plan and P7, P8, P9 and S8 of the triggers plan and P11 of the connectors plan', () => {
    expect(Object.keys(CENSUS_ROWS).filter((id) => id !== 'D1' && id !== 'S7' && id !== 'P5' && id !== 'P6' && id !== 'P7' && id !== 'P8' && id !== 'P9' && id !== 'P11' && id !== 'S8').sort()).toEqual([...planRows().keys()].sort());
    expect(Object.keys(CENSUS_ROWS).sort()).toEqual(['D1', 'P11', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    expect(readFileSync(WRAPPER_PLAN, 'utf8')).toContain(`\`D1: ${CENSUS_ROWS.D1.claim}\``);
  });

  it('holds P6 as the liveness token plan words it, a zero row turned green by its Monitor in fleetd slice', () => {
    expect(readFileSync(LIVENESS_PLAN, 'utf8')).toContain(`\`P6: ${CENSUS_ROWS.P6.claim}\``);
    expect(readFileSync(LIVENESS_PLAN, 'utf8')).toContain('P1 is retired in the same slice that deletes the script');
    expect(CENSUS_ROWS.P6).toMatchObject({ target: 'zero', greenBy: { plan: 'liveness-token', slice: 'Monitor in fleetd' }, green: true });
    expect(rowTitle(CENSUS_ROWS.P6)).toMatch(/turned green by plan liveness-token, slice Monitor in fleetd/);
  });

  it('holds S8 as the triggers plan words it, a measured row held within 10 % + 2', () => {
    expect(readFileSync(TRIGGERS_PLAN, 'utf8')).toContain(`| S8 | ${CENSUS_ROWS.S8.claim} | measured, 10 % + 2 | Safety net |`);
    expect(CENSUS_ROWS.S8).toMatchObject({ target: 'measured', tolerance: { ratio: 0.1, plus: 2 } });
    expect(rowTitle(CENSUS_ROWS.S8)).toMatch(/measured, held within 10 % \+ 2/);
  });

  it('holds P7 as the triggers plan words it, a zero row turned green by its Fleet size slice', () => {
    expect(readFileSync(TRIGGERS_PLAN, 'utf8').replace(/`/g, '')).toContain(`| P7 | ${CENSUS_ROWS.P7.claim} | zero | Fleet size |`);
    expect(CENSUS_ROWS.P7).toMatchObject({ target: 'zero', greenBy: { plan: 'triggers-replace-the-tick', slice: 'Fleet size' }, green: true });
    expect(rowTitle(CENSUS_ROWS.P7)).toMatch(/turned green by plan triggers-replace-the-tick, slice Fleet size/);
  });

  it('holds P8 as the triggers plan words it, a zero row turned green by its Scan on trigger slice', () => {
    expect(readFileSync(TRIGGERS_PLAN, 'utf8').replace(/`/g, '')).toContain(`| P8 | ${CENSUS_ROWS.P8.claim} | zero | Scan on trigger |`);
    expect(CENSUS_ROWS.P8).toMatchObject({ target: 'zero', greenBy: { plan: 'triggers-replace-the-tick', slice: 'Scan on trigger' }, green: true });
    expect(rowTitle(CENSUS_ROWS.P8)).toMatch(/turned green by plan triggers-replace-the-tick, slice Scan on trigger/);
  });

  it('holds P9 as the triggers plan words it, a zero row turned green by its Quiet beats slice', () => {
    expect(readFileSync(TRIGGERS_PLAN, 'utf8').replace(/`/g, '')).toContain(`| P9 | ${CENSUS_ROWS.P9.claim} | zero | Quiet beats |`);
    expect(CENSUS_ROWS.P9).toMatchObject({ target: 'zero', greenBy: { plan: 'triggers-replace-the-tick', slice: 'Quiet beats' }, green: true });
    expect(rowTitle(CENSUS_ROWS.P9)).toMatch(/turned green by plan triggers-replace-the-tick, slice Quiet beats/);
  });

  it('holds P11 as the connectors plan words it, a zero row turned green by its Jira cutover slice', () => {
    expect(readFileSync(CONNECTORS_PLAN, 'utf8')).toContain(`\`P11: ${CENSUS_ROWS.P11.claim}\``);
    expect(CENSUS_ROWS.P11).toMatchObject({ target: 'zero', greenBy: { plan: 'bitbucket-and-jira-read-in-process', slice: 'Jira cutover' }, green: true });
    expect(rowTitle(CENSUS_ROWS.P11)).toMatch(/turned green by plan bitbucket-and-jira-read-in-process, slice Jira cutover/);
  });

  it('holds P5 as the GitHub reads plan words it, a zero row turned green by its Cutover slice', () => {
    expect(readFileSync(GITHUB_READS_PLAN, 'utf8')).toContain(`\`P5: ${CENSUS_ROWS.P5.claim}\``);
    expect(CENSUS_ROWS.P5).toMatchObject({ target: 'zero', greenBy: { plan: 'github-reads-in-process', slice: 'Cutover' }, green: true });
    expect(rowTitle(CENSUS_ROWS.P5)).toMatch(/turned green by plan github-reads-in-process, slice Cutover/);
  });

  it('holds S7 as the board API plan words it, a zero row turned green by its Census zero slice', () => {
    const plan = readFileSync(BOARD_API_PLAN, 'utf8').replace(/`/g, '');
    expect(plan).toContain(`S7 reads: "${CENSUS_ROWS.S7.claim}"`);
    expect(CENSUS_ROWS.S7).toMatchObject({ target: 'zero', unit: 'execve per minute', greenBy: { plan: 'board-api-starts-nothing', slice: 'Census zero' }, green: true });
    expect(rowTitle(CENSUS_ROWS.S7)).toMatch(/turned green by plan board-api-starts-nothing, slice Census zero/);
  });

  it('keeps S3 as board-reads-the-channel turned it green, and its window sends no GET /api/board', () => {
    expect(CENSUS_ROWS.S3).toEqual({
      id: 'S3',
      claim: 'an idle board with one visible SSE client and fleetd running starts nothing',
      unit: 'execve per minute',
      target: 'zero',
      greenBy: { plan: 'board-reads-the-channel', slice: 'Census zero' },
      green: true,
    });
    const board = readFileSync(`${here}board.census.test.ts`, 'utf8');
    const s3 = board.slice(board.indexOf("fleetd running (S3)'"), board.indexOf('const POLL_MS'));
    expect(s3).toContain('it(rowTitle(CENSUS_ROWS.S3, fixture)');
    expect(s3).not.toMatch(/during|pollBoard/);
  });

  it('holds D1 measured, with no growth allowed', () => {
    expect(CENSUS_ROWS.D1).toMatchObject({ target: 'measured', tolerance: 'strict' });
    expect(rowTitle(CENSUS_ROWS.D1)).toBe('D1: one dispatch (measured, held within no growth)');
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
