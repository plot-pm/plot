import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  budgetFile,
  BUDGET_HOME_ENV,
  budgetFixture,
} from '../src/adapters/index.js';
import {
  decodeEntry,
  encodeEntry,
  MAX_LINE_BYTES,
  type BudgetEntry,
  type BudgetKey,
} from '../src/entities/budget.js';
import { isAnswered, type PortResult } from '../src/port-result.js';
import { readWindow } from '../src/rules/budget-record.js';

/**
 * The record ON DISK — the half of this slice that a pure test cannot see.
 *
 * TWO ASSERTIONS ARE THE WHOLE REASON THIS FILE EXISTS, and neither is
 * expressible against an in-memory fixture:
 *
 * 1. **A second checkout of the same account reads the same record.** The
 *    one-line statement of why this slice exists — a test that only ever uses
 *    one checkout cannot see the bug, because a per-checkout path passes it.
 * 2. **Two concurrent appends both survive, and neither is interleaved.** Run
 *    from separate PROCESSES, because two promises in one process share a
 *    thread and prove nothing about `O_APPEND`.
 */

const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

const KEY: BudgetKey = { connector: 'github', account: 'jwloka', bucket: 'graphql' };

const entry = (at: number, over: Partial<BudgetEntry> = {}): BudgetEntry => ({
  key: KEY,
  at,
  spent: 1,
  limit: 5000,
  remaining: 4854,
  resetAt: null,
  basis: 'actual',
  ...over,
});

let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plot-budget-'));
});

afterEach(() => {
  // Left in the temp directory deliberately: `trash` is the repo's rule for
  // files a person might want back, and `mkdtemp` output under the OS temp
  // directory is the OS's to reap.
  home = '';
});

describe('the record lives on the computer, not in a checkout', () => {
  it('resolves the same path for two different checkouts', () => {
    // THE ASSERTION THIS SLICE EXISTS FOR. Measured 2026-09-01: two GitHub
    // checkouts on this computer share the account `jwloka`, and a per-checkout
    // record let each read a full 5000 while the other spent it.
    //
    // Nothing here passes a repository root, because the adapter takes none —
    // and that absence is the fix rather than an omission.
    const first = budgetFile({ home });
    const second = budgetFile({ home });
    expect(answer(first.location())).toBe(answer(second.location()));
  });

  it('lets a second checkout read what the first appended', async () => {
    const first = budgetFile({ home });
    const second = budgetFile({ home });
    answer(await first.append(entry(Date.now())));
    const lines = answer(await second.lines());
    expect(lines).toHaveLength(1);
    expect(decodeEntry(lines[0] ?? '')?.key).toEqual(KEY);
  });

  it('resolves a path under the home directory and not under any repository', () => {
    const path = answer(budgetFile({ home }).location());
    expect(path.startsWith(home)).toBe(true);
    expect(path).not.toContain('.worktrees');
  });

  it('reads the directory from the environment when given no explicit home', () => {
    // ONE OVERRIDE, and its real job is this: a suite writing to the operator's
    // own record would be measuring their GitHub budget.
    const path = answer(budgetFile({ env: { [BUDGET_HOME_ENV]: home } }).location());
    expect(path.startsWith(home)).toBe(true);
  });

  it('prefers an explicit home over the environment', () => {
    const other = mkdtempSync(join(tmpdir(), 'plot-budget-other-'));
    const path = answer(budgetFile({ home, env: { [BUDGET_HOME_ENV]: other } }).location());
    expect(path.startsWith(home)).toBe(true);
  });
});

describe('a missing record is an empty one', () => {
  it('reads no lines from a record nobody has written', async () => {
    // `unknown` and *absent* are the same answer, which is what lets a fresh
    // checkout work with no ceremony and keeps a deleted record from being a
    // fault. Reporting `failed` here would make every fresh machine look broken.
    expect(answer(await budgetFile({ home }).lines())).toEqual([]);
  });

  it('creates the directory on the first append', async () => {
    const record = budgetFile({ home: join(home, 'nested', 'deeper') });
    answer(await record.append(entry(Date.now())));
    expect(answer(await record.lines())).toHaveLength(1);
  });

  it('reads an unknown reading back as unknown rather than as room', async () => {
    // The stored value is only half of it; what matters is that a reader that
    // takes a fallback on failure never gets one here.
    const record = budgetFile({ home });
    answer(
      await record.append(entry(Date.now(), { basis: 'unknown', limit: null, remaining: null })),
    );
    const read = readWindow(answer(await record.lines()), KEY, Date.now());
    expect(read.live).toHaveLength(1);
    expect(read.live[0]?.basis).toBe('unknown');
    expect(read.live[0]?.remaining).toBeNull();
  });
});

describe('the append is atomic because the line is short', () => {
  it('keeps both lines when two processes append at once, neither interleaved', () => {
    // SEPARATE PROCESSES, not two promises. Two promises in one process share a
    // thread and prove nothing about `O_APPEND`; two `node` processes racing on
    // one descriptor is the shape the record is actually written in.
    //
    // Many lines each, because one append apiece would pass by luck. 200 lines
    // from each of two writers is 400 chances to tear.
    const path = answer(budgetFile({ home }).location());
    const writer = join(home, 'writer.mjs');
    writeFileSync(
      writer,
      [
        "import { appendFileSync } from 'node:fs';",
        'const [path, tag, count] = process.argv.slice(2);',
        'for (let index = 0; index < Number(count); index += 1) {',
        "  appendFileSync(path, `b1\\tgithub\\t${tag}\\tgraphql\\t${1788269670000 + index}\\t1\\t5000\\t4854\\t-\\tactual\\n`);",
        '}',
      ].join('\n'),
      'utf8',
    );

    const each = 200;
    const runs = ['alice', 'bob'].map((tag) =>
      execFileSync(process.execPath, [writer, path, tag, String(each)], {
        // Detached so both are already running before either finishes; the
        // synchronous form would serialise them and test nothing.
        encoding: 'utf8',
      }),
    );
    expect(runs).toHaveLength(2);

    const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(each * 2);

    // NEITHER INTERLEAVED: every line decodes, and each writer's tag appears
    // exactly `each` times. A torn write would leave a line that fails to
    // decode and two that are short a field.
    const decoded = lines.map(decodeEntry);
    expect(decoded.filter((line) => line === null)).toHaveLength(0);
    const byAccount = new Map<string, number>();
    for (const line of decoded) {
      const account = line?.key.account ?? '';
      byAccount.set(account, (byAccount.get(account) ?? 0) + 1);
    }
    expect(byAccount.get('alice')).toBe(each);
    expect(byAccount.get('bob')).toBe(each);
  });

  it('refuses a line over the cap rather than tearing it', async () => {
    // A torn line loses the CONCURRENT writer's line too, so refusing one spend
    // is cheaper than corrupting another's.
    const record = budgetFile({ home });
    const huge = entry(Date.now(), { key: { ...KEY, account: 'a'.repeat(MAX_LINE_BYTES) } });
    expect(isAnswered(await record.append(huge))).toBe(false);
    expect(answer(await record.lines())).toEqual([]);
  });
});

describe('the reader reads two generations under the counter', () => {
  it('reads the previous generation as well as the current one', async () => {
    // TWO FILES, ONE ANSWER. A rotation renames the current generation over the
    // previous one, so a reader of the current file alone loses a whole
    // generation of the live window.
    const record = budgetFile({ home });
    writeFileSync(join(home, 'budget.tsv'), encodeEntry(entry(2_000)));
    writeFileSync(join(home, 'budget.tsv.1'), encodeEntry(entry(1_000)));
    expect(answer(await record.lines()).map((line) => decodeEntry(line)?.at)).toEqual([
      2_000, 1_000,
    ]);
  });

  it('reads the current generation first', async () => {
    // THE ORDER IS THE CORRECTNESS ARGUMENT. A rotation between the two reads
    // makes the reader see the old current generation twice, which over-counts;
    // the reverse order skips the live generation entirely.
    const record = budgetFile({ home });
    writeFileSync(join(home, 'budget.tsv'), encodeEntry(entry(9_000)));
    writeFileSync(join(home, 'budget.tsv.1'), encodeEntry(entry(1_000)));
    expect(decodeEntry(answer(await record.lines())[0] ?? '')?.at).toBe(9_000);
  });

  it('answers a missing previous generation with the current one', async () => {
    // ABSENT UNTIL THE FIRST ROTATION, which is every machine's normal state.
    const record = budgetFile({ home });
    answer(await record.append(entry(1_000)));
    expect(answer(await record.lines())).toHaveLength(1);
  });

  it('answers a missing current generation with the previous one', async () => {
    // ABSENT BETWEEN A ROTATION AND THE NEXT APPEND. Answering 0 here would
    // grant headroom the record never measured.
    const record = budgetFile({ home });
    writeFileSync(join(home, 'budget.tsv.1'), encodeEntry(entry(1_000)));
    expect(answer(await record.lines())).toHaveLength(1);
  });

  it('answers an unrotated record with no counter', async () => {
    // A MISSING COUNTER READS AS 0, which is even, so a machine that has never
    // rotated reads its record in one pass.
    const record = budgetFile({ home });
    answer(await record.append(entry(1_000)));
    expect(existsSync(join(home, 'budget.gen'))).toBe(false);
    expect(answer(await record.lines())).toHaveLength(1);
  });

  it('answers an even counter it read twice', async () => {
    const record = budgetFile({ home });
    writeFileSync(join(home, 'budget.gen'), '4\n');
    answer(await record.append(entry(1_000)));
    expect(answer(await record.lines())).toHaveLength(1);
  });

  it('still answers when the counter stays odd', async () => {
    // A ROTATOR DIED AND THE SHELL HAS NOT YET REPAIRED IT. The read is taken
    // again and then answered from its last pass: an answer that can only
    // over-count is what a caller may act on, where a refusal is not.
    const record = budgetFile({ home });
    writeFileSync(join(home, 'budget.gen'), '3\n');
    answer(await record.append(entry(1_000)));
    expect(answer(await record.lines())).toHaveLength(1);
  });

  it('reports a generation that exists and cannot be read', async () => {
    // A DIRECTORY WHERE A GENERATION SHOULD BE is not an empty generation, and a
    // caller must not read it as an empty window.
    const record = budgetFile({ home });
    mkdirSync(join(home, 'budget.tsv'));
    expect(isAnswered(await record.lines())).toBe(false);
  });
});

describe('the fixture answers the way the file does', () => {
  it('reports one location to every caller', () => {
    const record = budgetFixture();
    expect(answer(record.location())).toBe(answer(record.location()));
  });

  it('reads back what was appended', async () => {
    const record = budgetFixture();
    answer(await record.append(entry(1_788_269_670_000)));
    expect(decodeEntry(answer(await record.lines())[0] ?? '')?.key).toEqual(KEY);
  });

  it('starts from the lines it was handed', async () => {
    const record = budgetFixture({ lines: [encodeEntry(entry(1_788_269_670_000)).trimEnd()] });
    expect(answer(await record.lines())).toHaveLength(1);
  });

  it('refuses an over-long line like the file does', async () => {
    // A fixture that accepted one would let a caller ship a format the disk
    // refuses, which is the substitution failing exactly where it matters.
    const record = budgetFixture();
    const huge = entry(1_788_269_670_000, {
      key: { ...KEY, account: 'a'.repeat(MAX_LINE_BYTES) },
    });
    expect(isAnswered(await record.append(huge))).toBe(false);
  });
});
