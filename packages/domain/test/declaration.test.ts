import { describe, it, expect } from 'vitest';
import {
  DECLARATION_FILENAME,
  DeclarationSchema,
  DeclarationStatusSchema,
  isBlocked,
  isComplete,
  readDeclaration,
  type Declaration,
} from '../src/index.js';

/**
 * The contract, and the four readings it must keep apart.
 *
 * Measured 2026-08-31: three agents hit the 8 h `Worker bound`, died at `exit
 * 124`, and had committed and pushed real work with no PR. Nothing reported it,
 * because Plot inferred completion from a process ending and every worker exits
 * 0. The declaration replaces that inference — so the tests that matter here
 * are the ones about what is NOT declared.
 */

const declared = (over: Partial<Declaration> = {}) => JSON.stringify({
  branch: 'feature/x',
  status: 'ok',
  artifacts: ['packages/domain/src/rules/reap.ts'],
  pr: 571,
  summary: 'one sentence',
  ...over,
});

describe('the declaration names its branch, because an agent hops', () => {
  it('sits at the filename the rest of the family uses', () => {
    // `.plot-worker.exit`, `.plot-worker.pid`, `.plot-worker.log` and
    // `.plot-worker.monitor.*.jsonl` are already the convention.
    expect(DECLARATION_FILENAME).toBe('.plot-worker.envelope.json');
  });

  it('refuses a declaration that names no branch', () => {
    // One per BRANCH, not one per agent: `plot-worker-loop.sh` keeps `session`
    // and `pid` fixed across a hop, so a declaration that cannot be attributed
    // to a branch cannot be attributed at all.
    const reading = readDeclaration(JSON.stringify({ status: 'ok' }));
    expect(reading.read).toBe('unreadable');
  });

  it('reads the branch, the artifacts, the PR and the summary back', () => {
    const reading = readDeclaration(declared());
    expect(reading).toEqual({
      read: 'declared',
      declaration: {
        branch: 'feature/x',
        status: 'ok',
        artifacts: ['packages/domain/src/rules/reap.ts'],
        pr: 571,
        summary: 'one sentence',
      },
    });
  });
});

describe('two values, and a third would be wrong', () => {
  it('accepts ok and blocked and nothing else', () => {
    // A `failed` value would duplicate what the gates decide from what the
    // agent left behind, and the agent is not the one that decides it.
    expect(DeclarationStatusSchema.options).toEqual(['ok', 'blocked']);
    expect(DeclarationStatusSchema.safeParse('failed').success).toBe(false);
  });

  it('refuses a declaration whose status is not one of the two', () => {
    expect(readDeclaration(declared({ status: 'failed' })).read).toBe('unreadable');
  });
});

describe('absence means incomplete, whatever the exit code says', () => {
  it('reads no file as absent', () => {
    // `null` is the caller saying there was no file. An agent killed by the
    // `Worker bound` never reaches the write, which is exactly the 2026-08-31
    // three.
    expect(readDeclaration(null)).toEqual({ read: 'absent' });
    expect(isComplete(readDeclaration(null))).toBe(false);
  });

  it('flips from complete to incomplete when the declaration is taken away', () => {
    // THE DISCRIMINATING FORM. A parse that answered *incomplete* for
    // everything would pass an absence test while proving nothing, so the same
    // desk is asked twice: once holding its declaration and once not, and the
    // verdict must differ.
    const withFile = readDeclaration(declared());
    const withoutFile = readDeclaration(null);
    expect(isComplete(withFile)).toBe(true);
    expect(isComplete(withoutFile)).toBe(false);
    expect(isComplete(withFile)).not.toBe(isComplete(withoutFile));
  });
});

describe('an unreadable declaration is not a complete one, and not an absent one', () => {
  it('does not read bytes that are not JSON as complete', () => {
    const reading = readDeclaration('{ this is not json');
    expect(reading.read).toBe('unreadable');
    expect(isComplete(reading)).toBe(false);
  });

  it('does not read an empty file as absent', () => {
    // A file that exists and holds nothing is a write that failed halfway.
    // Reporting it as absent would claim a measurement nobody made.
    expect(readDeclaration('').read).toBe('unreadable');
  });

  it('does not read valid JSON of the wrong shape as complete', () => {
    expect(readDeclaration(JSON.stringify(['feature/x'])).read).toBe('unreadable');
    expect(readDeclaration(JSON.stringify({ branch: 'feature/x', status: 'ok', pr: 'many' })).read)
      .toBe('unreadable');
  });

  it('keeps unreadable apart from absent in the type', () => {
    // *Cannot answer* is not *no*. This repo has twice shipped a collapse of
    // those two, and a caller distinguishes them by reading `read`, never by
    // reading a flag that says only "incomplete".
    const unreadable = readDeclaration('nonsense');
    const absent = readDeclaration(null);
    expect(unreadable.read).not.toBe(absent.read);
    expect(isComplete(unreadable)).toBe(isComplete(absent));
    if (unreadable.read !== 'unreadable') throw new Error('narrowing');
    expect(unreadable.why.length).toBeGreaterThan(0);
  });
});

describe('blocked is distinguishable from absence in the type', () => {
  it('reads a blocked declaration as declared, not as missing', () => {
    // An agent reporting that it cannot proceed is information; silence is not.
    const reading = readDeclaration(declared({ status: 'blocked', pr: null }));
    expect(reading.read).toBe('declared');
    expect(isBlocked(reading)).toBe(true);
    expect(isBlocked(readDeclaration(null))).toBe(false);
  });

  it('does not read blocked as complete', () => {
    expect(isComplete(readDeclaration(declared({ status: 'blocked' })))).toBe(false);
  });

  it('answers false for blocked on an unreadable desk too', () => {
    expect(isBlocked(readDeclaration('nonsense'))).toBe(false);
  });
});

describe('what an agent chose not to report is empty, not missing', () => {
  it('defaults the three optional fields', () => {
    // A declaration that names only the branch and the status is complete —
    // the agent said the branch is finished, which is the whole question.
    const reading = readDeclaration(JSON.stringify({ branch: 'feature/x', status: 'ok' }));
    expect(reading).toEqual({
      read: 'declared',
      declaration: { branch: 'feature/x', status: 'ok', artifacts: [], pr: null, summary: '' },
    });
    expect(isComplete(reading)).toBe(true);
  });

  it('keeps a key it does not know rather than refusing the declaration', () => {
    // A newer agent writing a field this parse has not learned yet has not
    // written a malformed declaration.
    const reading = readDeclaration(declared({ attempts: 2 } as Partial<Declaration>));
    expect(reading.read).toBe('declared');
    if (reading.read !== 'declared') throw new Error('narrowing');
    expect(reading.declaration).not.toHaveProperty('attempts');
  });

  it('parses the wire form through the schema directly', () => {
    // The schema is the contract three components will read; it is exported so
    // they parse rather than re-derive.
    expect(DeclarationSchema.safeParse({ branch: 'feature/x', status: 'ok' }).success).toBe(true);
  });
});
