import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendEscalation,
  encodeEscalation,
  escalationsPath,
  parseEscalationLine,
  readEscalations,
  recordedRungsFor,
  type EscalationRecord,
} from '../../src/shared/escalations.js';
import { rmTree } from '../helpers.mjs';

// EVERY TEMP PATH THIS FILE CREATES, REMOVED BY THE EXACT NAME `mkdtempSync`
// RETURNED. See terminal-cache.test.ts's own comment for why.
const trackedTempPaths: string[] = [];
const trackTemp = <T extends string>(dir: T): T => {
  trackedTempPaths.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of trackedTempPaths) {
    try {
      rmTree(dir);
    } catch {
      /* a sandbox already gone is the wanted state */
    }
  }
});

const repoRoot = (): string => trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-escalations-')));

const RECORD: EscalationRecord = {
  worktree: '/desks/feature-x',
  askedAt: '2026-10-05T13:36:00.000Z',
  rung: 'notified-1',
  at: '2026-10-05T13:52:00.000Z',
  status: 'sent',
};

describe('escalations.tsv — the once-per-rung record', () => {
  it('reads no records from a missing file', () => {
    const root = repoRoot();
    expect(readEscalations(root)).toEqual([]);
  });

  it('reads no records from an empty file', () => {
    const root = repoRoot();
    fs.mkdirSync(path.dirname(escalationsPath(root)), { recursive: true });
    fs.writeFileSync(escalationsPath(root), '');
    expect(readEscalations(root)).toEqual([]);
  });

  it('skips a truncated line rather than throwing', () => {
    const root = repoRoot();
    fs.mkdirSync(path.dirname(escalationsPath(root)), { recursive: true });
    // A line cut mid-field by a torn append — fewer than five tab-separated columns.
    fs.writeFileSync(escalationsPath(root), '/desks/feature-x\t2026-10-05T13:36:00.000Z\tnotified-1\n');
    expect(readEscalations(root)).toEqual([]);
  });

  it('appends and reads back one record', () => {
    const root = repoRoot();
    expect(appendEscalation(root, RECORD)).toBe(true);
    expect(readEscalations(root)).toEqual([RECORD]);
  });

  it('appends multiple records across calls, in order', () => {
    const root = repoRoot();
    appendEscalation(root, RECORD);
    const second: EscalationRecord = { ...RECORD, rung: 'notified-2', status: 'sent' };
    appendEscalation(root, second);
    expect(readEscalations(root)).toEqual([RECORD, second]);
  });

  it('never throws appending into a missing directory', () => {
    const root = repoRoot();
    expect(() => appendEscalation(root, RECORD)).not.toThrow();
  });

  it('answers false, without throwing, where `.plot/state` cannot be created', () => {
    const root = repoRoot();
    fs.mkdirSync(path.join(root, '.plot'));
    fs.writeFileSync(path.join(root, '.plot', 'state'), '');
    expect(appendEscalation(root, RECORD)).toBe(false);
  });
});

describe('parseEscalationLine', () => {
  it('round-trips encodeEscalation', () => {
    expect(parseEscalationLine(encodeEscalation(RECORD).trimEnd())).toEqual(RECORD);
  });

  it('answers null for an empty column', () => {
    expect(parseEscalationLine('\t2026-10-05T13:36:00.000Z\tnotified-1\tat\tsent')).toBeNull();
  });

  it('answers null for the wrong column count', () => {
    expect(parseEscalationLine('a\tb\tc')).toBeNull();
  });
});

describe('recordedRungsFor — keyed on worktree AND modification time', () => {
  it('finds the rung recorded for this exact desk and marker', () => {
    const rungs = recordedRungsFor([RECORD], RECORD.worktree, RECORD.askedAt);
    expect(rungs.has('notified-1')).toBe(true);
  });

  it('does not find a rung recorded under a different worktree', () => {
    const rungs = recordedRungsFor([RECORD], '/desks/other', RECORD.askedAt);
    expect(rungs.size).toBe(0);
  });

  it('does not find a rung recorded under a different modification time — a new marker starts again at listed', () => {
    const rungs = recordedRungsFor([RECORD], RECORD.worktree, '2026-10-05T18:00:00.000Z');
    expect(rungs.size).toBe(0);
  });
});
