import { describe, it, expect } from 'vitest';
import {
  BRIEF_WRITER_STATES,
  briefWriterNote,
  briefWriterState,
  type BriefWriterReadings,
} from '../src/index.js';

/**
 * `briefWriterState` and `briefWriterNote` — the writer's state for one branch,
 * and the note a row shows for it. The readings are plain values: no browser,
 * no host, no git.
 */

const LOG = '.worktrees/plot-implement-a-plan.log';
const SPENT = { ends: 2, log: '.plot-brief-a-plan.log' };

const reading = (over: Partial<BriefWriterReadings> = {}): BriefWriterReadings => ({
  needsBrief: true,
  writing: false,
  failed: null,
  askedAt: null,
  ...over,
});

describe('briefWriterState — the five answers', () => {
  it('reads a running writer for this branch as writing', () => {
    expect(briefWriterState(reading({ writing: true }))).toBe('writing');
  });

  it('reads a writer that recorded a failure as failed', () => {
    expect(briefWriterState(reading({ failed: LOG }))).toBe('failed');
  });

  it('reads a spent record as spent', () => {
    expect(briefWriterState(reading({ spent: SPENT }))).toBe('spent');
  });

  it('reads a recorded ask with nothing running now as asked', () => {
    expect(briefWriterState(reading({ askedAt: 1_000 }))).toBe('asked');
  });

  it('reads no run and no ask as none', () => {
    expect(briefWriterState(reading())).toBe('none');
  });

  it('reads writing before a recorded failure, and a failure before an ask', () => {
    expect(briefWriterState(reading({ writing: true, failed: LOG, askedAt: 1_000 }))).toBe('writing');
    expect(briefWriterState(reading({ failed: LOG, askedAt: 1_000 }))).toBe('failed');
  });

  it('reads writing before spent, and spent before a failure and an ask', () => {
    expect(briefWriterState(reading({ writing: true, spent: SPENT }))).toBe('writing');
    expect(briefWriterState(reading({ spent: SPENT, failed: LOG }))).toBe('spent');
    expect(briefWriterState(reading({ spent: SPENT, askedAt: 1_000 }))).toBe('spent');
    expect(briefWriterState(reading({ spent: SPENT, failed: LOG, askedAt: 1_000 }))).toBe('spent');
  });

  it('answers only members of BRIEF_WRITER_STATES', () => {
    expect([...BRIEF_WRITER_STATES]).toEqual(['writing', 'spent', 'failed', 'asked', 'none']);
  });
});

describe('briefWriterState — the brief gates first', () => {
  it('answers none for a running writer once the brief is no longer needed', () => {
    // A brief that landed ends the question, also for a pid still alive now.
    expect(briefWriterState(reading({ needsBrief: false, writing: true }))).toBe('none');
  });

  it('answers none for a failed run once the brief is no longer needed', () => {
    expect(briefWriterState(reading({ needsBrief: false, failed: LOG }))).toBe('none');
  });

  it('answers none for a spent record once the brief is no longer needed', () => {
    expect(briefWriterState(reading({ needsBrief: false, spent: SPENT }))).toBe('none');
  });

  it('answers none for a recorded ask once the brief is no longer needed', () => {
    expect(briefWriterState(reading({ needsBrief: false, askedAt: 1_000 }))).toBe('none');
  });
});

describe('briefWriterNote — the note and its age', () => {
  const NOW = 1_000_000_000_000;

  it('gives no note for none', () => {
    expect(briefWriterNote('none', NOW - 1_000, NOW)).toBeNull();
  });

  it('gives a running writer the age of its ask', () => {
    expect(briefWriterNote('writing', NOW - 42_000, NOW)).toEqual({ kind: 'writing', ageMs: 42_000 });
  });

  it('gives a running writer no age where no ask is recorded', () => {
    expect(briefWriterNote('writing', null, NOW)).toEqual({ kind: 'writing', ageMs: null });
  });

  it('gives an ask its age', () => {
    expect(briefWriterNote('asked', NOW - 45_000, NOW)).toEqual({ kind: 'asked', ageMs: 45_000 });
  });

  it('gives a spent record no age, also where an ask is recorded', () => {
    expect(briefWriterNote('spent', NOW - 45_000, NOW)).toEqual({ kind: 'spent', ageMs: null });
  });

  it('gives a failure no age, also where an ask is recorded', () => {
    expect(briefWriterNote('failed', NOW - 45_000, NOW)).toEqual({ kind: 'failed', ageMs: null });
  });
});
