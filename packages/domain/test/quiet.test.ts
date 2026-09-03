import { describe, it, expect } from 'vitest';
import {
  quietKind,
  quietNote,
  quietNeedsPerson,
  type QuietBranchReadings,
  type QuietKind,
} from '../src/index.js';

/**
 * `quiet` — the four things the classifier's fallthrough was calling one thing.
 *
 * NO BROWSER, NO HOST, NO GIT. Every case here is a plain record, which is what
 * taking readings as values buys: the facts the rule reads are already held by
 * whoever asks, so nothing is fetched to answer.
 *
 * The populations are the ones measured on this estate 2026-09-03 — 17 closed
 * PRs, 2 claim-only branches, 6 abandoned — and each has a case below.
 */

const reading = (over: Partial<QuietBranchReadings> = {}): QuietBranchReadings => ({
  branch: 'feature/x',
  prState: 'none',
  hasMergedPr: false,
  isEmptyClaim: false,
  ...over,
});

describe('quietKind — one word per kind of quiet', () => {
  it('names a closed PR as a decision somebody took', () => {
    // 17 rows on this estate. Somebody looked at #53, #51, #363 and said no.
    expect(quietKind(reading({ prState: 'closed' }))).toBe('closed-pr');
  });

  it('names a claim-only branch an orphaned claim, in the sweep’s word', () => {
    // 2 rows. `plot-reap.sh --dry-run` calls it the same thing, which is the
    // point of borrowing the word rather than coining a second one.
    expect(quietKind(reading({ isEmptyClaim: true }))).toBe('orphaned-claim');
  });

  it('names commits with no PR abandoned', () => {
    // 6 rows, and the one kind that genuinely needs a person.
    expect(quietKind(reading())).toBe('abandoned');
  });

  it('leaves a branch with work and an open PR plainly quiet', () => {
    // Nothing here is a decision, nobody abandoned it, and the work is up for
    // review. The fallthrough is a real answer for this branch.
    expect(quietKind(reading({ prState: 'open' }))).toBe('quiet');
  });
});

describe('quietKind — what it refuses to conclude', () => {
  it('refuses to read a merged branch as a rejection, though the host spells it CLOSED', () => {
    // A merged PR reports `CLOSED` through some hosts. Testing the word first
    // would file 85 of this estate's 98 local branches as rejected work.
    expect(quietKind(reading({ prState: 'closed', hasMergedPr: true }))).toBe('quiet');
  });

  it('refuses to invent a kind for a merged branch with no PR word', () => {
    expect(quietKind(reading({ hasMergedPr: true }))).toBe('quiet');
    expect(quietKind(reading({ prState: 'open', hasMergedPr: true }))).toBe('quiet');
  });

  it('refuses to call a decided branch abandoned, however empty it is', () => {
    // A decision outranks every fact about the branch's contents.
    expect(quietKind(reading({ prState: 'closed', isEmptyClaim: true }))).toBe('closed-pr');
  });

  it('refuses to call a claim-only branch abandoned', () => {
    // Nobody abandoned work that was never done. Both readings are true of the
    // same branch — no commits AND no PR — and the claim is the specific one.
    expect(quietKind(reading({ prState: 'none', isEmptyClaim: true }))).toBe('orphaned-claim');
  });

  it('refuses to call a branch under review abandoned', () => {
    // An open PR means the wait is somebody else's.
    expect(quietKind(reading({ prState: 'open' }))).not.toBe('abandoned');
  });

  it('takes silence about a merge as not merged, never as merged', () => {
    // An unreachable host answers `false`, so a branch nothing reports as
    // merged is classified on the readings that remain.
    expect(quietKind(reading({ prState: 'closed', hasMergedPr: false }))).toBe('closed-pr');
  });

  it('reads no age and never asks for one', () => {
    // The whole defect: age described what nothing else matched. There is no
    // age field to pass, so no arm can fall back to one.
    expect(Object.keys(reading())).not.toContain('ageMinutes');
  });
});

describe('quietNote — the sentence, asked of the same rule', () => {
  it('gives one sentence per kind', () => {
    expect(quietNote(reading({ prState: 'closed' }))).toBe('PR closed without merging');
    expect(quietNote(reading({ isEmptyClaim: true }))).toBe('claimed, no work committed');
    expect(quietNote(reading())).toBe('commits, no PR ever opened');
    expect(quietNote(reading({ prState: 'open' }))).toBe('nobody is on it');
  });

  it('never says an age, for any reading', () => {
    // Age is what the fallthrough said when it had nothing else to say.
    for (const r of everyCase()) {
      expect(quietNote(r)).not.toMatch(/\d/);
    }
  });

  it('agrees with quietKind on every case, so word and sentence cannot diverge', () => {
    const sentences: Record<QuietKind, string> = {
      'closed-pr': 'PR closed without merging',
      'orphaned-claim': 'claimed, no work committed',
      abandoned: 'commits, no PR ever opened',
      quiet: 'nobody is on it',
    };
    for (const r of everyCase()) {
      expect(quietNote(r)).toBe(sentences[quietKind(r)]);
    }
  });
});

describe('quietNeedsPerson — which of them is still somebody’s to answer', () => {
  it('lets a closed PR go — somebody already decided', () => {
    // The answer that empties 17 of 26 rows and makes the other 9 readable.
    expect(quietNeedsPerson(reading({ prState: 'closed' }))).toBe(false);
  });

  it('keeps an orphaned claim, abandoned work and plain quiet', () => {
    expect(quietNeedsPerson(reading({ isEmptyClaim: true }))).toBe(true);
    expect(quietNeedsPerson(reading())).toBe(true);
    expect(quietNeedsPerson(reading({ prState: 'open' }))).toBe(true);
  });

  it('keeps a merged branch — it is not the decision this rule releases', () => {
    // `closed-pr` is the only kind that leaves. A merged branch answers
    // `quiet` here and `classifyGroup` places it as done, above this rule.
    expect(quietNeedsPerson(reading({ prState: 'closed', hasMergedPr: true }))).toBe(true);
  });

  it('agrees with quietKind on every case', () => {
    for (const r of everyCase()) {
      expect(quietNeedsPerson(r)).toBe(quietKind(r) !== 'closed-pr');
    }
  });
});

/**
 * Every combination of the three deciding readings — 12 records, all of them
 * reachable, enumerated rather than sampled so a fourth arm cannot be added
 * without a case covering it.
 */
const everyCase = (): QuietBranchReadings[] => {
  const cases: QuietBranchReadings[] = [];
  for (const prState of ['none', 'open', 'closed'] as const) {
    for (const hasMergedPr of [false, true]) {
      for (const isEmptyClaim of [false, true]) {
        cases.push(reading({ prState, hasMergedPr, isEmptyClaim }));
      }
    }
  }
  return cases;
};
