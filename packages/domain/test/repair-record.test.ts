import { describe, expect, it } from 'vitest';

import {
  decodeRepairRecord,
  encodeRepairRecord,
  REPAIR_RECORD_VERSION,
  type RepairRecord,
} from '../src/entities/repair-record.js';
import { candidatesFromCommits } from '../src/rules/repair.js';
import { moveRepairState } from '../src/transitions/repair-record.js';

const AT = '2026-10-10T00:00:00.000Z';

const record = (over: Partial<RepairRecord> = {}): RepairRecord => ({
  v: REPAIR_RECORD_VERSION,
  branch: 'main',
  state: 'idle',
  lastGreenSha: 'g'.repeat(40),
  firstRedSha: 'r'.repeat(40),
  redSince: AT,
  candidates: [{ sha: 'c'.repeat(40), subject: 'Fix thing (#7)' }],
  rerun: 'none',
  preRevertRerun: 'none',
  at: AT,
  ...over,
});

describe('the repair record file', () => {
  it('round-trips through encode and decode', () => {
    const original = record({ state: 'repairing', repairPr: 12 });
    expect(decodeRepairRecord(encodeRepairRecord(original))).toEqual(original);
  });

  it('terminates the rendered text with a newline', () => {
    expect(encodeRepairRecord(record()).endsWith('}\n')).toBe(true);
  });

  it('reads an empty file as no record', () => {
    expect(decodeRepairRecord('  \n')).toBeNull();
  });

  it('reads unparseable text as no record', () => {
    expect(decodeRepairRecord('{not json')).toBeNull();
  });

  it('reads another version as no record', () => {
    const other = { ...record(), v: REPAIR_RECORD_VERSION + 1 };
    expect(decodeRepairRecord(JSON.stringify(other))).toBeNull();
  });

  it('reads an unknown field as no record', () => {
    expect(decodeRepairRecord(JSON.stringify({ ...record(), extra: 1 }))).toBeNull();
  });
});

describe('moveRepairState', () => {
  it.each([
    ['idle', 'rerun'],
    ['rerun', 'repairing'],
    ['repairing', 'reverting'],
    ['reverting', 'done'],
    ['idle', 'done'],
    ['reverting', 'exhausted'],
  ] as const)('decides %s -> %s', (from, to) => {
    expect(moveRepairState(from, to)).toEqual({ outcome: 'decided', from, to });
  });

  it('refuses a state it does not know', () => {
    expect(moveRepairState('idle', 'paused')).toMatchObject({ outcome: 'refused', reason: 'state-unrecognised' });
  });

  it('refuses a move to the same state', () => {
    expect(moveRepairState('rerun', 'rerun')).toMatchObject({ outcome: 'refused', reason: 'state-unchanged' });
  });

  it.each(['done', 'exhausted'] as const)('refuses to leave terminal %s', (from) => {
    expect(moveRepairState(from, 'idle')).toMatchObject({ outcome: 'refused', reason: 'state-terminal' });
  });

  it('refuses a move that skips ahead', () => {
    expect(moveRepairState('idle', 'reverting')).toMatchObject({ outcome: 'refused', reason: 'state-unreachable' });
  });
});

describe('candidatesFromCommits', () => {
  const commit = (sha: string, subject: string, forward = false) => ({ sha, tree: `t-${sha}`, subject, forward });

  it('keeps the range newest first as {sha, subject}', () => {
    expect(candidatesFromCommits([commit('r1', 'B (#3)'), commit('m1', 'A (#1)')])).toEqual([
      { sha: 'r1', subject: 'B (#3)' },
      { sha: 'm1', subject: 'A (#1)' },
    ]);
  });

  it('drops a forward merge, which carries no commit of the range', () => {
    expect(candidatesFromCommits([commit('r1', 'B (#3)'), commit('f1', 'Merge main', true), commit('m1', 'A (#1)')]).map((c) => c.sha)).toEqual(['r1', 'm1']);
  });

  it('answers none for an empty range', () => {
    expect(candidatesFromCommits([])).toEqual([]);
  });
});
