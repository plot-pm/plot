import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decodeEndingAskRow, endingAskRecordFile } from '../src/adapters/ending-ask-record/ending-ask-record-file.js';
import type { EndingAskRecord } from '../src/ports/ending-ask-record.js';

const PLAN = '2026-10-07-a-plan';
const ENDING_AT = '2026-10-08T10:00:00.000Z';

const row = (over: Partial<EndingAskRecord> = {}): EndingAskRecord => ({
  plan: PLAN,
  branch: 'infra/x',
  endingAt: ENDING_AT,
  at: '2026-10-08T10:01:00.000Z',
  ...over,
});

let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plot-ending-ask-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('endingAskRecordFile', () => {
  it('answers not asked where the file is missing', async () => {
    expect(await endingAskRecordFile({ home }).asked(PLAN, 'infra/x', ENDING_AT)).toEqual({ ok: true, value: false });
  });

  it('answers asked for the plan, branch and ending time it appended', async () => {
    const store = endingAskRecordFile({ home });
    expect((await store.append(row())).ok).toBe(true);
    expect(await store.asked(PLAN, 'infra/x', ENDING_AT)).toEqual({ ok: true, value: true });
  });

  it('answers not asked for a newer ending on the same branch', async () => {
    const store = endingAskRecordFile({ home });
    await store.append(row());
    expect(await store.asked(PLAN, 'infra/x', '2026-10-08T11:00:00.000Z')).toEqual({ ok: true, value: false });
  });

  it('answers not asked for another branch or another plan', async () => {
    const store = endingAskRecordFile({ home });
    await store.append(row());
    expect(await store.asked(PLAN, 'infra/y', ENDING_AT)).toEqual({ ok: true, value: false });
    expect(await store.asked('another-plan', 'infra/x', ENDING_AT)).toEqual({ ok: true, value: false });
  });

  it('answers failed where the file exists and cannot be read', async () => {
    mkdirSync(join(home, 'ending-asks.tsv'));
    expect((await endingAskRecordFile({ home }).asked(PLAN, 'infra/x', ENDING_AT)).ok).toBe(false);
  });

  it('answers failed for an append it cannot write', async () => {
    writeFileSync(join(home, 'nested'), '');
    expect((await endingAskRecordFile({ home: join(home, 'nested') }).append(row())).ok).toBe(false);
  });

  it('skips a torn line rather than reading it as an ask', async () => {
    writeFileSync(join(home, 'ending-asks.tsv'), `${PLAN}\tinfra/x\n`);
    expect(await endingAskRecordFile({ home }).asked(PLAN, 'infra/x', '')).toEqual({ ok: true, value: false });
  });
});

describe('decodeEndingAskRow', () => {
  it('reads the four fields it writes', () => {
    expect(decodeEndingAskRow(`${PLAN}\tinfra/x\t${ENDING_AT}\tz`)).toEqual({ plan: PLAN, branch: 'infra/x', endingAt: ENDING_AT, at: 'z' });
  });

  it('refuses a row with no branch or no ending time', () => {
    expect(decodeEndingAskRow(`${PLAN}\t\t${ENDING_AT}\tz`)).toBeNull();
    expect(decodeEndingAskRow(`${PLAN}\tinfra/x\t\tz`)).toBeNull();
  });
});
