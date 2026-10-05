import { describe, expect, it } from 'vitest';
import { answer, readingsFrom, run } from '../../src/server/entry/branch-state.js';

/**
 * THE ENTRY IS AN ADAPTER AND THESE TEST THE ADAPTATION.
 *
 * `branchState`'s own precedence is asserted in the domain, once. What can
 * only fail here is the wire: eleven tab-separated fields, where field 9 names
 * every prerequisite the plan declares (comma-separated, `-` for none) and
 * field 10 carries the parallel comma-separated PR-state list (`?` where the
 * question was not yet put, never a per-item marker).
 *
 * `the-parser-reads-every-wait` (slice 2) teaches the scan to emit several
 * names; today it always sends one, so every live case here is a one-item
 * list. The multi-item cases are what prove the entry reads a list rather than
 * borrowing the first or last column.
 */

/** One branch line, as the scan's eleven tab-separated fields would write it. */
const line = (
  deferred: string,
  refTip: string,
  mainTip: string,
  subject: string,
  reach: string,
  pr: string,
  ahead: string,
  real: string,
  waitsBranch: string,
  waitsPr: string,
  listComplete: string,
): string =>
  [deferred, refTip, mainTip, subject, reach, pr, ahead, real, waitsBranch, waitsPr, listComplete].join(
    '\t',
  );

const UNSTARTED = ['false', '-', 'aaa', 'false', 'ok', 'NONE', '0', '0'] as const;

describe('readingsFrom — the waits columns', () => {
  it('reads `-` as no prerequisite at all', () => {
    const [reading] = readingsFrom(`${line(...UNSTARTED, '-', '?', 'true')}\n`);
    expect(reading?.waits).toEqual([]);
  });

  it('reads one name and one state as a one-item list', () => {
    const [reading] = readingsFrom(`${line(...UNSTARTED, 'feature/prereq', 'OPEN', 'true')}\n`);
    expect(reading?.waits).toEqual([{ branch: 'feature/prereq', pr: 'OPEN' }]);
  });

  it('reads several comma-separated names against their parallel states', () => {
    const [reading] = readingsFrom(
      `${line(...UNSTARTED, 'feature/a,feature/b', 'MERGED,OPEN', 'true')}\n`,
    );
    expect(reading?.waits).toEqual([
      { branch: 'feature/a', pr: 'MERGED' },
      { branch: 'feature/b', pr: 'OPEN' },
    ]);
  });

  it('reads `?` as not-yet-asked for every named prerequisite, never a reading', () => {
    // `?` IS NOT A READING AND `-` IS. A `?` names the prerequisites but
    // withholds an answer for them, which is different from the plan naming
    // none at all.
    const [reading] = readingsFrom(`${line(...UNSTARTED, 'feature/a,feature/b', '?', 'true')}\n`);
    expect(reading?.waits).toEqual([]);
  });

  it('throws naming the line when the name list and the state list disagree in length', () => {
    // A DEFECT IN THE SCAN, NEVER GUESSED AT. `countFrom` throws the same way
    // for a malformed count; this is the parallel-column equivalent.
    expect(() => readingsFrom(`${line(...UNSTARTED, 'feature/a,feature/b', 'OPEN', 'true')}\n`)).toThrow(
      /line 1/,
    );
  });
});

describe('answer — needsPrerequisite follows the name list, not the state list', () => {
  it('flags a branch whose prerequisites are named but not yet read', () => {
    const out = answer(`${line(...UNSTARTED, 'feature/a,feature/b', '?', 'true')}\n`);
    expect(out).toBe('open\t1\topen\n');
  });

  it('does not flag a branch with no prerequisite at all', () => {
    const out = answer(`${line(...UNSTARTED, '-', '?', 'true')}\n`);
    expect(out).toBe('open\t0\topen\n');
  });

  it('does not re-ask a branch whose prerequisites already carry a reading', () => {
    const out = answer(`${line(...UNSTARTED, 'feature/a,feature/b', 'MERGED,MERGED', 'true')}\n`);
    expect(out).toBe('open\t0\topen\n');
  });
});

describe('answer — the third column is the state under a prerequisite', () => {
  it('names `open` under a `waiting` branch the host could answer for', () => {
    const out = answer(`${line(...UNSTARTED, 'feature/a', 'OPEN', 'true')}\n`);
    expect(out).toBe('waiting\t0\topen\n');
  });

  it('names `unknown` under a `waiting` branch the host could not answer for', () => {
    const failed = ['false', '-', 'aaa', 'false', 'failed', 'NONE', '0', '0'] as const;
    const out = answer(`${line(...failed, 'feature/a', 'OPEN', 'true')}\n`);
    expect(out).toBe('waiting\t0\tunknown\n');
  });
});

describe('run — the process wiring', () => {
  it('answers 0 and writes the derived line', () => {
    const out: string[] = [];
    const code = run(`${line(...UNSTARTED, '-', '?', 'true')}\n`, (s) => out.push(s));
    expect(code).toBe(0);
    expect(out.join('')).toBe('open\t0\topen\n');
  });
});
