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
    expect(quietKind(reading({ prState: 'closed', hasMergedPr: true }))).toBe('merged');
  });

  it('names a merged branch merged, whatever the PR word says', () => {
    // THIS REVERSES A DELIBERATE REFUSAL, and the evidence is why. The kind
    // used to answer plain `quiet`, on the premise that `classifyGroup` placed
    // merged work as done above this rule. That premise held only for a branch
    // the scan itself calls `merged`; one that squash-merged with its head ref
    // deleted arrives `wip`, reaches the fallthrough arm, and took the note of
    // the kind it fell back to. Measured 2026-09-04: #481, #623, #600, #577,
    // #616 and #610 all merged, all reading "nobody is on it".
    expect(quietKind(reading({ hasMergedPr: true }))).toBe('merged');
    expect(quietKind(reading({ prState: 'open', hasMergedPr: true }))).toBe('merged');
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

describe('quietKind — a host that was not asked', () => {
  it('reads an unasked host as plainly quiet, never as abandoned', () => {
    // THE DEFECT. Measured 2026-09-20 on `quatico/quaweb-website`: the PR fetch
    // never landed, seven branches rendered *"commits, no PR ever opened —
    // abandoned"*, and three of them carried pull requests — #358 OPEN, #405
    // and #445 DRAFT. `abandoned` is what tells a person a branch can be
    // deleted, so producing it from an absence of evidence is the one
    // direction this must never fail in.
    expect(quietKind(reading({ prState: 'unknown' }))).toBe('quiet');
    expect(quietKind(reading({ prState: 'unknown' }))).not.toBe('abandoned');
  });

  it('still calls a branch abandoned when the host WAS asked and reported no PR', () => {
    // THE OTHER DIRECTION, and the assertion exists because the naive fix
    // passes without it. Narrowing `abandoned` out of existence would be right
    // about the outage and wrong about every genuinely abandoned branch — one
    // wrong answer traded for another. `'none'` is the host's answer; it keeps
    // its meaning.
    expect(quietKind(reading({ prState: 'none' }))).toBe('abandoned');
  });

  it('reads a merged branch as merged, though the host could not be asked', () => {
    // THE ORDERING, pinned at the top end. The two readings are not
    // independent — a host that did not answer has no `prState` worth
    // consulting — but a branch git reports as merged reads `merged` whether or
    // not the host could be asked. An arm inserted ABOVE `hasMergedPr` instead
    // of below it turns shipped work into an unanswered question.
    expect(quietKind(reading({ prState: 'unknown', hasMergedPr: true }))).toBe('merged');
  });

  it('reads a claim-only branch as an orphaned claim, though the host could not be asked', () => {
    // A branch carrying only the empty claim commit has nothing to open a PR
    // about, so the host's silence changes nothing about what it is.
    expect(quietKind(reading({ prState: 'unknown', isEmptyClaim: true }))).toBe('orphaned-claim');
  });

  it('keeps an unasked branch a person\u2019s to answer', () => {
    // `quiet` is the honest existing answer — nobody is on it, and we cannot
    // say why — and it keeps `quietNeedsPerson`'s fallthrough truthful without
    // a new case.
    expect(quietNeedsPerson(reading({ prState: 'unknown' }))).toBe(true);
    expect(quietNote(reading({ prState: 'unknown' }))).toBe('nobody is on it');
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
      merged: 'merged',
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

  it('releases a merged branch — shipped work is nobody\'s to answer', () => {
    // IT USED TO KEEP ONE, on the premise that `classifyGroup` had already
    // placed it as done above this rule. It had not, for a squash-merged
    // branch, so the row asked a person to look at work that had landed.
    expect(quietNeedsPerson(reading({ prState: 'closed', hasMergedPr: true }))).toBe(false);
  });

  it('agrees with quietKind on every case', () => {
    for (const r of everyCase()) {
      const kind = quietKind(r);
      expect(quietNeedsPerson(r)).toBe(kind !== 'closed-pr' && kind !== 'merged');
    }
  });
});

/**
 * Every combination of the three deciding readings — 16 records, all of them
 * reachable, enumerated rather than sampled so a fourth arm cannot be added
 * without a case covering it.
 *
 * `'unknown'` WIDENS THE DIMENSION RATHER THAN ADDING A CASE. A hand-written
 * seventeenth record would pass this suite and defeat the helper: the product
 * is what makes an unreachable combination impossible to leave untested, and a
 * list appended to is a list somebody can stop appending to. Four PR words
 * against two merges against two claims is 16, and `quietNote`'s and
 * `quietNeedsPerson`'s agreement tests then cover the new word for free.
 */
const everyCase = (): QuietBranchReadings[] => {
  const cases: QuietBranchReadings[] = [];
  for (const prState of ['none', 'open', 'closed', 'unknown'] as const) {
    for (const hasMergedPr of [false, true]) {
      for (const isEmptyClaim of [false, true]) {
        cases.push(reading({ prState, hasMergedPr, isEmptyClaim }));
      }
    }
  }
  return cases;
};
