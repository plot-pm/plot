import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { encodeEntry, type BudgetEntry } from '../src/entities/budget.js';
import { isAnswered } from '../src/port-result.js';
import { GENERATION_MS } from '../src/rules/budget-rotation.js';

const AT = 1_788_000_000_000;

const entry = (at: number): BudgetEntry => ({
  key: { connector: 'github', account: 'someone', bucket: 'graphql' },
  at,
  spent: 1,
  limit: 5000,
  remaining: 4999,
  resetAt: null,
  basis: 'actual',
});

let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plot-budget-rotation-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  home = '';
});

const seed = (at: number): void => writeFileSync(join(home, 'budget.tsv'), encodeEntry(entry(at)));
const read = (name: string): string => (existsSync(join(home, name)) ? readFileSync(join(home, name), 'utf8') : '');

describe('budgetFile with rotate', () => {
  it('renames a generation one generation old over budget.tsv.1 before it appends', async () => {
    seed(AT);
    const record = budgetFile({ home, rotate: true, now: () => AT + GENERATION_MS, pid: 4242 });

    expect(isAnswered(await record.append(entry(AT + GENERATION_MS)))).toBe(true);

    expect(read('budget.tsv.1')).toBe(encodeEntry(entry(AT)));
    expect(read('budget.tsv')).toBe(encodeEntry(entry(AT + GENERATION_MS)));
    expect(read('budget.gen').trim()).toBe('2');
    expect(existsSync(join(home, 'budget.lock'))).toBe(false);
    const lines = await record.lines();
    expect(isAnswered(lines) && lines.value).toHaveLength(2);
  });

  it('appends to a young generation without rotating', async () => {
    seed(AT);
    const record = budgetFile({ home, rotate: true, now: () => AT + GENERATION_MS - 1 });

    await record.append(entry(AT + 1));

    expect(existsSync(join(home, 'budget.tsv.1'))).toBe(false);
    expect(read('budget.tsv').split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('skips the rotation and still appends where another process holds the lock', async () => {
    seed(AT);
    mkdirSync(join(home, 'budget.lock'));
    writeFileSync(join(home, 'budget.lock', 'owner'), `1\t${AT}\n`);
    const record = budgetFile({ home, rotate: true, now: () => AT + GENERATION_MS });

    await record.append(entry(AT + GENERATION_MS));

    expect(existsSync(join(home, 'budget.tsv.1'))).toBe(false);
    expect(read('budget.tsv').split('\n').filter(Boolean)).toHaveLength(2);
    expect(existsSync(join(home, 'budget.lock', 'owner'))).toBe(true);
  });

  it('leaves an odd counter to the shell and does not rotate under it', async () => {
    seed(AT);
    writeFileSync(join(home, 'budget.gen'), '3\n');
    const record = budgetFile({ home, rotate: true, now: () => AT + GENERATION_MS });

    await record.append(entry(AT + GENERATION_MS));

    expect(existsSync(join(home, 'budget.tsv.1'))).toBe(false);
    expect(read('budget.gen').trim()).toBe('3');
  });

  it('does not rotate without the option', async () => {
    seed(AT);
    const record = budgetFile({ home });

    await record.append(entry(AT + 2 * GENERATION_MS));

    expect(existsSync(join(home, 'budget.tsv.1'))).toBe(false);
  });

  it('rotates a missing record into nothing and appends a fresh generation', async () => {
    const record = budgetFile({ home, rotate: true, now: () => AT });

    await record.append(entry(AT));

    expect(read('budget.tsv')).toBe(encodeEntry(entry(AT)));
    expect(existsSync(join(home, 'budget.gen'))).toBe(false);
  });
});
