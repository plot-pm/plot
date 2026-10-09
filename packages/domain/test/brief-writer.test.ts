import { describe, it, expect } from 'vitest';
import {
  briefWriterState,
  type BriefWriterReadings,
} from '../src/index.js';

/**
 * `briefWriterState` — #1417: the board showed an age for a brief ask, and an
 * age cannot say when the writer is done. This reads the writer's own process
 * instead, scoped to the one branch it was given.
 *
 * NO BROWSER, NO HOST, NO GIT — the readings are already plain values.
 */

const reading = (over: Partial<BriefWriterReadings> = {}): BriefWriterReadings => ({
  needsBrief: true,
  runState: 'none',
  askedAt: null,
  ...over,
});

describe('briefWriterState — the four answers', () => {
  it('reads a running writer for this branch as writing', () => {
    expect(briefWriterState(reading({ runState: 'running' }))).toBe('writing');
  });

  it('reads a writer that recorded a failure as failed', () => {
    expect(briefWriterState(reading({ runState: 'failed' }))).toBe('failed');
  });

  it('reads a recorded ask with nothing running now as asked', () => {
    expect(briefWriterState(reading({ askedAt: 1_000 }))).toBe('asked');
  });

  it('reads no run and no ask as none', () => {
    expect(briefWriterState(reading())).toBe('none');
  });
});

describe('briefWriterState — the brief gates first', () => {
  it('answers none for a running writer once the brief is no longer needed', () => {
    // A brief that landed is the end of the question, even for a pid that is
    // still alive this instant — this is the case a naive implementation that
    // tests only the process would miss.
    expect(briefWriterState(reading({ needsBrief: false, runState: 'running' }))).toBe('none');
  });

  it('answers none for a failed run once the brief is no longer needed', () => {
    expect(briefWriterState(reading({ needsBrief: false, runState: 'failed' }))).toBe('none');
  });

  it('answers none for a recorded ask once the brief is no longer needed', () => {
    expect(briefWriterState(reading({ needsBrief: false, askedAt: 1_000 }))).toBe('none');
  });
});

describe('briefWriterState — a branchless run never reads writing', () => {
  it('reads asked, not writing, when the caller passes none for a branch no run named', () => {
    // The caller is the one that decides this: a run given no branch leaves
    // `runState: 'none'` for every sibling and lets `askedAt` carry the ask,
    // so the indicator does not widen back onto every brief-less branch.
    expect(briefWriterState(reading({ runState: 'none', askedAt: 1_000 }))).toBe('asked');
  });
});
