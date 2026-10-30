import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { answerRecordFile, decodeAnswerRow } from '../src/adapters/answer-record/answer-record-file.js';
import { isAnswered, type PortResult } from '../src/port-result.js';
import type { AnswerRecord } from '../src/ports/answer-record.js';

const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

const WORKTREE = '/repo/.worktrees/feature-x';
const ASKED_AT = '2026-10-05T12:00:00.000Z';

const row = (over: Partial<AnswerRecord> = {}): AnswerRecord => ({
  worktree: WORKTREE,
  askedAt: ASKED_AT,
  question: 'which adapter?',
  answer: 'use the shell adapter',
  author: 'unblocker',
  outcome: 'answered',
  ...over,
});

let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plot-answer-record-'));
});

describe('the record is empty until an answer is given', () => {
  it('reads no rows for a question nobody answered', async () => {
    const store = answerRecordFile({ home });
    expect(answer(await store.rowsFor(WORKTREE, ASKED_AT))).toEqual([]);
  });

  it('a missing file is an empty record, never a failure', async () => {
    // ABSENCE MUST READ AS "no answer yet," never as "already started" — the
    // one misreading this record must never produce.
    const store = answerRecordFile({ home: join(home, 'never-created') });
    const result = await store.rowsFor(WORKTREE, ASKED_AT);
    expect(isAnswered(result)).toBe(true);
    expect(answer(result)).toEqual([]);
  });
});

describe('append and read', () => {
  it('reads back what it appended', async () => {
    const store = answerRecordFile({ home });
    answer(await store.append(row()));
    expect(answer(await store.rowsFor(WORKTREE, ASKED_AT))).toEqual([row()]);
  });

  it('is append-only — a second answer adds a second row rather than replacing the first', async () => {
    const store = answerRecordFile({ home });
    answer(await store.append(row({ outcome: 'started' })));
    answer(await store.append(row({ outcome: 'answered' })));
    const rows = answer(await store.rowsFor(WORKTREE, ASKED_AT));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.outcome)).toEqual(['started', 'answered']);
  });

  it('answers only the rows for the (worktree, askedAt) asked about', async () => {
    const store = answerRecordFile({ home });
    answer(await store.append(row({ worktree: WORKTREE, askedAt: ASKED_AT })));
    answer(await store.append(row({ worktree: WORKTREE, askedAt: '2026-10-06T09:00:00.000Z' })));
    answer(await store.append(row({ worktree: '/repo/.worktrees/other', askedAt: ASKED_AT })));
    expect(answer(await store.rowsFor(WORKTREE, ASKED_AT))).toHaveLength(1);
  });

  it('lets a second instance over the same home read what the first appended', async () => {
    const first = answerRecordFile({ home });
    const second = answerRecordFile({ home });
    answer(await first.append(row()));
    expect(answer(await second.rowsFor(WORKTREE, ASKED_AT))).toEqual([row()]);
  });
});

describe('decodeAnswerRow', () => {
  it('round-trips a row the adapter wrote', async () => {
    const store = answerRecordFile({ home });
    answer(await store.append(row()));
    expect(decodeAnswerRow([WORKTREE, ASKED_AT, 'which adapter?', 'use the shell adapter', 'unblocker', 'answered'].join('\t'))).toEqual(
      row(),
    );
  });

  it('replaces a tab or newline in a free-text answer with a space, so the row stays one line', async () => {
    const store = answerRecordFile({ home });
    answer(await store.append(row({ answer: 'line one\nline two\twith a tab' })));
    expect(answer(await store.rowsFor(WORKTREE, ASKED_AT))).toEqual([row({ answer: 'line one line two with a tab' })]);
  });

  it('skips a line that does not split into exactly six fields', () => {
    expect(decodeAnswerRow('a\tb\tc')).toBeNull();
    expect(decodeAnswerRow('')).toBeNull();
    expect(decodeAnswerRow('a\tb\tc\td\te\tf\tg')).toBeNull();
  });

  it('skips a line with an empty required field', () => {
    expect(decodeAnswerRow(['', ASKED_AT, 'q', 'a', 'unblocker', 'answered'].join('\t'))).toBeNull();
    expect(decodeAnswerRow([WORKTREE, '', 'q', 'a', 'unblocker', 'answered'].join('\t'))).toBeNull();
    expect(decodeAnswerRow([WORKTREE, ASKED_AT, 'q', 'a', '', 'answered'].join('\t'))).toBeNull();
    expect(decodeAnswerRow([WORKTREE, ASKED_AT, 'q', 'a', 'unblocker', ''].join('\t'))).toBeNull();
  });
});

describe('the error paths', () => {
  it('reads no rows and refuses the append where the git common dir cannot be found', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'plot-answer-record-nogit-'));
    const store = answerRecordFile({ cwd: outside, env: {} });
    expect(answer(await store.rowsFor(WORKTREE, ASKED_AT))).toEqual([]);
    expect((await store.append(row())).ok).toBe(false);
  });

  it('answers failed, not empty, where the file exists and cannot be read', async () => {
    // A DIRECTORY AT THE FILE'S PATH: readFile fails with EISDIR, not ENOENT.
    mkdirSync(join(home, 'answers.tsv'), { recursive: true });
    const store = answerRecordFile({ home });
    expect((await store.rowsFor(WORKTREE, ASKED_AT)).ok).toBe(false);
  });

  it('answers failed where the append cannot land', async () => {
    mkdirSync(join(home, 'answers.tsv'), { recursive: true });
    const store = answerRecordFile({ home });
    expect((await store.append(row())).ok).toBe(false);
  });

  it('answers failed where the directory cannot be created', async () => {
    // THE HOME IS A FILE, so mkdir under it fails with ENOTDIR.
    const blocker = join(home, 'blocker');
    writeFileSync(blocker, 'x');
    const store = answerRecordFile({ home: join(blocker, 'state') });
    expect((await store.append(row())).ok).toBe(false);
  });

  it('resolves the directory from the git common dir of the cwd', async () => {
    const store = answerRecordFile({ cwd: process.cwd(), env: {} });
    expect((await store.rowsFor('/no/such/worktree', ASKED_AT)).ok).toBe(true);
  });
});
