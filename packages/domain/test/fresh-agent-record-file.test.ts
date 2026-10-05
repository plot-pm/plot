import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  freshAgentRecordFile,
  decodeRow as decodeFreshAgentRow,
} from '../src/adapters/fresh-agent-record/fresh-agent-record-file.js';
import { isAnswered, type PortResult } from '../src/port-result.js';
import type { FreshAgentRecord } from '../src/ports/fresh-agent-record.js';

const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

const row = (over: Partial<FreshAgentRecord> = {}): FreshAgentRecord => ({
  branch: 'feature/x',
  worktree: '/repo/.worktrees/feature-x',
  at: '2026-10-05T12:00:00.000Z',
  runUrl: 'https://github.com/plot-pm/plot/actions/runs/123',
  ...over,
});

let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plot-fresh-agent-'));
});

describe('the record is empty until a session is started', () => {
  it('reads no rows for a branch nobody wrote', async () => {
    const store = freshAgentRecordFile({ home });
    expect(answer(await store.rowsFor('feature/x'))).toEqual([]);
  });

  it('a missing file is an empty record, never a failure', async () => {
    // THE PLAN'S OWN CONTRACT: absence must read as "no fresh session yet,"
    // never as a refusal a caller might mistake for "already had one."
    const store = freshAgentRecordFile({ home: join(home, 'never-created') });
    const result = await store.rowsFor('feature/x');
    expect(isAnswered(result)).toBe(true);
    expect(answer(result)).toEqual([]);
  });
});

describe('append and read', () => {
  it('reads back what it appended', async () => {
    const store = freshAgentRecordFile({ home });
    answer(await store.append(row()));
    expect(answer(await store.rowsFor('feature/x'))).toEqual([row()]);
  });

  it('is append-only — a second start adds a second row rather than replacing the first', async () => {
    const store = freshAgentRecordFile({ home });
    answer(await store.append(row({ at: '2026-10-05T12:00:00.000Z' })));
    answer(await store.append(row({ at: '2026-10-06T09:00:00.000Z' })));
    const rows = answer(await store.rowsFor('feature/x'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.at)).toEqual(['2026-10-05T12:00:00.000Z', '2026-10-06T09:00:00.000Z']);
  });

  it('answers only the rows for the branch asked about', async () => {
    const store = freshAgentRecordFile({ home });
    answer(await store.append(row({ branch: 'feature/x' })));
    answer(await store.append(row({ branch: 'feature/y' })));
    expect(answer(await store.rowsFor('feature/x'))).toHaveLength(1);
    expect(answer(await store.rowsFor('feature/y'))).toHaveLength(1);
  });

  it('lets a second instance over the same home read what the first appended', async () => {
    const first = freshAgentRecordFile({ home });
    const second = freshAgentRecordFile({ home });
    answer(await first.append(row()));
    expect(answer(await second.rowsFor('feature/x'))).toEqual([row()]);
  });
});

describe('decodeFreshAgentRow', () => {
  it('round-trips a row the adapter wrote', async () => {
    const store = freshAgentRecordFile({ home });
    answer(await store.append(row()));
    expect(decodeFreshAgentRow(['feature/x', '/repo/.worktrees/feature-x', '2026-10-05T12:00:00.000Z', row().runUrl].join('\t'))).toEqual(row());
  });

  it('answers a row with an empty runUrl where none was read', () => {
    expect(decodeFreshAgentRow('feature/x\t/repo/desk\t2026-10-05T12:00:00.000Z\t')).toEqual({
      branch: 'feature/x',
      worktree: '/repo/desk',
      at: '2026-10-05T12:00:00.000Z',
      runUrl: '',
    });
  });

  it('skips a line that does not split into four fields, rather than guessing', () => {
    expect(decodeFreshAgentRow('feature/x\t/repo/desk')).toBeNull();
    expect(decodeFreshAgentRow('')).toBeNull();
  });

  it('skips a line with an empty required field', () => {
    expect(decodeFreshAgentRow('\t/repo/desk\t2026-10-05T12:00:00.000Z\t')).toBeNull();
    expect(decodeFreshAgentRow('feature/x\t\t2026-10-05T12:00:00.000Z\t')).toBeNull();
  });
});
