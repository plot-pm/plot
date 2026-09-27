import { describe, it, expect } from 'vitest';
import {
  decodeSupervisionReport,
  encodeSupervisionReport,
  SUPERVISION_REPORT_VERSION,
  type SupervisionReport,
} from '../src/entities/supervision-report.js';

/**
 * The report's own format — asserted on the DECODER, not through a file.
 *
 * `supervision-report-file.test.ts` drives the adapter, so it proves the file
 * round-trips. These prove the rule the adapter leans on: what counts as a
 * report this Plot can read, and what every unreadable shape answers.
 *
 * ONE ANSWER FOR EVERY UNREADABLE SHAPE, which is the contract the board
 * depends on. An empty file, a torn write, a wrong version and a changed shape
 * all mean *no tick judged anything I can read* — never *the desks are fine*.
 */

const report = (over: Partial<SupervisionReport> = {}): SupervisionReport => ({
  v: SUPERVISION_REPORT_VERSION,
  at: 1_700_000_000_000,
  rows: [{ branch: 'bug/a', worktree: '/desks/a', verdict: 'defer', cause: 'no-headroom' }],
  ...over,
});

describe('decodeSupervisionReport — absent is not false', () => {
  it('round-trips a report through the encoder', () => {
    expect(decodeSupervisionReport(encodeSupervisionReport(report()))).toEqual(report());
  });

  it('ends the encoded report with a newline', () => {
    // One JSON document per file, newline-terminated, so `cat` and a shell
    // reader both see a complete line.
    expect(encodeSupervisionReport(report()).endsWith('\n')).toBe(true);
  });

  it('reads an empty file as nothing to start from', () => {
    expect(decodeSupervisionReport('')).toBeNull();
  });

  it('reads a file of whitespace as nothing to start from', () => {
    // A file created by a `touch`, or one whose write was cut before any byte
    // of JSON landed. Guarded before `JSON.parse`, whose message for it says
    // nothing a reader could use.
    expect(decodeSupervisionReport('   \n\t\n')).toBeNull();
  });

  it('reads a torn write as nothing to start from', () => {
    expect(decodeSupervisionReport('{"v":1,"at":1,"rows":[{"bran')).toBeNull();
  });

  it('reads an unrecognised version as nothing to start from', () => {
    // A LITERAL VERSION makes a future format unparseable by construction,
    // which is the fallback a reader is required to take.
    expect(decodeSupervisionReport(JSON.stringify({ v: 99, at: 1, rows: [] }))).toBeNull();
  });

  it('refuses a report with no clock', () => {
    // The clock is what lets a reader age the record, so a report without one
    // cannot prove it is fresh and is not a report.
    expect(decodeSupervisionReport(JSON.stringify({ v: 1, rows: [] }))).toBeNull();
  });

  it('refuses a negative clock', () => {
    expect(decodeSupervisionReport(JSON.stringify({ v: 1, at: -1, rows: [] }))).toBeNull();
  });

  it('refuses a row missing its cause', () => {
    const text = JSON.stringify({
      v: 1, at: 1, rows: [{ branch: 'bug/a', worktree: '/d', verdict: 'defer' }],
    });
    expect(decodeSupervisionReport(text)).toBeNull();
  });

  it('refuses an unknown field rather than dropping it', () => {
    // `.strict()`, so a field this Plot does not know makes the file
    // unreadable rather than silently discarded — the same direction the
    // version literal points.
    const text = JSON.stringify({ v: 1, at: 1, rows: [], extra: true });
    expect(decodeSupervisionReport(text)).toBeNull();
  });

  it('reads a tick that judged no desk as an empty report, not as absent', () => {
    // AN EMPTY REPORT IS AN ANSWER: the supervisor ran and placed no desk. It
    // must not read as *no report*, which is what a reader falls back to when
    // nothing has ticked.
    const decoded = decodeSupervisionReport(JSON.stringify({ v: 1, at: 5, rows: [] }));
    expect(decoded).toEqual({ v: 1, at: 5, rows: [] });
  });

  it('keeps a row that names no branch', () => {
    // A FREE agent holds no slice, so the tick judges it with an empty branch.
    // Measured 2026-09-27: a `min(1)` here made a whole live report
    // unparseable and cost all eight desks their cause.
    const text = JSON.stringify({
      v: 1, at: 1,
      rows: [{ branch: '', worktree: '/desks/free', verdict: 'leave', cause: 'worker-alive' }],
    });
    expect(decodeSupervisionReport(text)?.rows).toHaveLength(1);
  });

  it('carries a cause word it does not recognise, leaving the narrowing to the reader', () => {
    // The cause is a STRING here on purpose: a newer daemon's tenth cause must
    // not make the whole file unreadable for the desks beside it. The reader
    // tests the word against the nine it knows and drops what it cannot place.
    const text = JSON.stringify({
      v: 1, at: 1,
      rows: [{ branch: 'bug/a', worktree: '/d', verdict: 'defer', cause: 'a-cause-from-next-year' }],
    });
    expect(decodeSupervisionReport(text)?.rows[0]?.cause).toBe('a-cause-from-next-year');
  });
});
