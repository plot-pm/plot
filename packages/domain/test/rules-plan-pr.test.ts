import { describe, it, expect } from 'vitest';
import {
  isPlanFile,
  namesPlan,
  planPrOf,
  planPrsCarrying,
  planSlugOf,
  type OpenPr,
  type PlanPrReadings,
} from '../src/rules/plan-pr.js';

const DIR = 'docs/plans/';
const FIRST = 'docs/plans/2026-10-12-first-plan.md';
const SECOND = 'docs/plans/2026-10-12-second-plan.md';
const OLD = 'docs/plans/2026-09-01-old-plan.md';

const batch = (over: Partial<OpenPr> = {}): OpenPr => ({
  number: 77,
  head: 'idea/batch-first-plan',
  draft: true,
  headSha: 'c0ffee',
  changed: [SECOND, FIRST, 'docs/plans/active/first-plan.md', 'docs/stories/x/STORY-x.md'],
  ...over,
});

/** A plan the default branch does not hold, with `idea/<slug>` already asked and absent. */
const unmerged = (over: Partial<PlanPrReadings> = {}): PlanPrReadings => ({
  slug: 'first-plan',
  planDir: DIR,
  onMain: false,
  named: null,
  ...over,
});

/** A plan the default branch holds, which merge `m` with second parent `h` added. */
const landed = (over: Partial<PlanPrReadings> = {}): PlanPrReadings => ({
  slug: 'second-plan',
  planDir: DIR,
  onMain: true,
  named: null,
  addition: { sha: 'm', secondParent: 'h' },
  merged: [{ number: 70, headSha: 'other' }, { number: 77, headSha: 'h' }],
  confirmed: { state: 'MERGED', mergeCommit: 'm' },
  ...over,
});

describe('plan file names', () => {
  it('names a date-prefixed plan file and a bare one, and drops the date for the slug', () => {
    expect(namesPlan('first-plan', FIRST)).toBe(true);
    expect(namesPlan('a-plan', 'docs/plans/a-plan.md')).toBe(true);
    expect(planSlugOf('a-plan.md')).toBe('a-plan');
  });

  it('does not take a slug that is only the tail of another slug', () => {
    expect(namesPlan('plan', FIRST)).toBe(false);
  });

  it('counts only .md files directly in the plan directory, with or without its slash', () => {
    expect(isPlanFile(DIR, FIRST)).toBe(true);
    expect(isPlanFile('docs/plans', FIRST)).toBe(true);
    expect(isPlanFile(DIR, 'docs/plans/active/first-plan.md')).toBe(false);
    expect(isPlanFile(DIR, 'docs/plans/notes.txt')).toBe(false);
    expect(isPlanFile(DIR, 'docs/other/first-plan.md')).toBe(false);
  });
});

describe('planPrsCarrying', () => {
  it('finds a batch PR by the plan file it changes, whatever its branch is called', () => {
    const [match, ...rest] = planPrsCarrying('first-plan', DIR, [batch()]);
    expect(rest).toEqual([]);
    expect(match?.file).toBe(FIRST);
    expect(match?.carried).toEqual([SECOND]);
  });

  it('skips a PR that changes no file the slug names', () => {
    expect(planPrsCarrying('first-plan', DIR, [batch({ changed: [OLD] })])).toEqual([]);
  });
});

describe('planPrOf — the reading order', () => {
  it('asks for idea/<slug> first', () => {
    expect(planPrOf({ slug: 'first-plan', planDir: DIR, onMain: false })).toEqual({ outcome: 'ask', ask: 'named' });
  });

  it('takes a MERGED or CLOSED idea/<slug> PR straight away, reading the default branch', () => {
    expect(planPrOf(unmerged({ named: { number: 5, state: 'CLOSED', draft: false } }))).toEqual({
      outcome: 'found', number: 5, state: 'CLOSED', draft: false, headSha: '', branch: '',
      rivals: [], carried: [], route: 'named', read: { at: 'default' },
    });
    const merged = planPrOf(unmerged({ named: { number: 9, state: 'MERGED', draft: false, headSha: 'f00d' } }));
    expect(merged).toEqual({
      outcome: 'found', number: 9, state: 'MERGED', draft: false, headSha: 'f00d', branch: '',
      rivals: [], carried: [], route: 'named', read: { at: 'default' },
    });
  });

  it('asks for the named head next when idea/<slug> is OPEN', () => {
    expect(planPrOf(unmerged({ named: { number: 6, state: 'OPEN', draft: true, headSha: 'abc' } }))).toEqual({
      outcome: 'ask', ask: 'named-head',
    });
  });

  it('refuses pr-head-unheld where git does not hold the named PR\'s head', () => {
    const readings = unmerged({ named: { number: 6, state: 'OPEN', draft: true, headSha: 'abc' }, namedHead: null });
    expect(planPrOf(readings)).toEqual({ outcome: 'refused', reason: 'pr-head-unheld', number: 6 });
  });

  it('refuses pr-carries-no-plan where the named head changes no plan file', () => {
    const readings = unmerged({
      named: { number: 6, state: 'OPEN', draft: true, headSha: 'abc' },
      namedHead: { sha: 'abcfull', changed: [OLD] },
    });
    expect(planPrOf(readings)).toEqual({ outcome: 'refused', reason: 'pr-carries-no-plan', number: 6 });
  });

  it('reads the named OPEN PR at its head, with no rivals, when the default branch lacks the file', () => {
    const readings = unmerged({
      named: { number: 6, state: 'OPEN', draft: true, headSha: 'abc' },
      namedHead: { sha: 'abcfull', changed: [FIRST, SECOND] },
    });
    expect(planPrOf(readings)).toEqual({ outcome: 'ask', ask: 'open' });
    const found = planPrOf({ ...readings, open: [] });
    expect(found).toEqual({
      outcome: 'found', number: 6, state: 'OPEN', draft: true, headSha: 'abcfull', branch: 'idea/first-plan',
      rivals: [], carried: [SECOND], route: 'named', read: { at: 'head', sha: 'abcfull', file: FIRST },
    });
  });

  it('names every other open PR that carries the plan file as a rival, excluding the named PR itself', () => {
    const readings = unmerged({
      named: { number: 6, state: 'OPEN', draft: true, headSha: 'abc' },
      namedHead: { sha: 'abcfull', changed: [FIRST] },
      open: [
        batch({ number: 6, head: 'idea/first-plan', headSha: 'abcfull', changed: [FIRST] }),
        batch({ number: 78, head: 'idea/first-plan-again', headSha: 'riv', changed: [FIRST] }),
      ],
    });
    const found = planPrOf(readings);
    expect(found.outcome === 'found' && found.rivals).toEqual([{ number: 78, sha: 'riv', file: FIRST }]);
  });
});

describe('planPrOf — a plan the default branch does not hold', () => {
  it('asks for the open PRs', () => {
    expect(planPrOf(unmerged())).toEqual({ outcome: 'ask', ask: 'open' });
  });

  it('answers the batch PR, its head, and the other plans it carries', () => {
    expect(planPrOf(unmerged({ open: [batch()] }))).toEqual({
      outcome: 'found', number: 77, state: 'OPEN', draft: true, headSha: 'c0ffee',
      branch: 'idea/batch-first-plan', rivals: [], carried: [SECOND],
      route: 'open', read: { at: 'head', sha: 'c0ffee', file: FIRST },
    });
  });

  it('names every further PR that changes the plan file as a rival, with its head sha and file', () => {
    const rival = batch({ number: 78, head: 'idea/first-plan-again', headSha: 'riv', changed: [FIRST] });
    const answer = planPrOf(unmerged({ open: [batch(), batch({ number: 79, changed: [OLD] }), rival] }));
    expect(answer.outcome === 'found' && answer.rivals).toEqual([{ number: 78, sha: 'riv', file: FIRST }]);
  });

  it('answers none where no open PR changes the plan file', () => {
    expect(planPrOf(unmerged({ open: [batch({ changed: [OLD] })] }))).toEqual({ outcome: 'none' });
  });
});

describe('planPrOf — a plan the default branch holds', () => {
  it('never takes an open PR that changes the plan, and asks for the addition instead', () => {
    const readings = landed({ addition: undefined, merged: undefined, confirmed: undefined, open: [batch({ changed: [SECOND] })] });
    expect(planPrOf(readings)).toEqual({ outcome: 'ask', ask: 'addition' });
  });

  it('answers none for a file no merge added: a direct push, or a squash', () => {
    expect(planPrOf(landed({ addition: { sha: '', secondParent: '' } }))).toEqual({ outcome: 'none' });
    expect(planPrOf(landed({ addition: { sha: 's', secondParent: '' } }))).toEqual({ outcome: 'none' });
  });

  it('asks for the merged PRs, then for the one whose head the merge brought in', () => {
    expect(planPrOf(landed({ merged: undefined, confirmed: undefined }))).toEqual({ outcome: 'ask', ask: 'merged' });
    expect(planPrOf(landed({ confirmed: undefined }))).toEqual({ outcome: 'ask', ask: 'confirm', number: 77 });
  });

  it('answers none where no merged PR has that head', () => {
    expect(planPrOf(landed({ merged: [{ number: 70, headSha: 'other' }] }))).toEqual({ outcome: 'none' });
  });

  it('answers none where a merged PR names no head at all', () => {
    expect(planPrOf(landed({ merged: [{ number: 70, headSha: '' }] }))).toEqual({ outcome: 'none' });
  });

  it('takes a case-insensitive prefix of at least 7 hex characters as the same head', () => {
    const readings = landed({
      addition: { sha: 'm', secondParent: '0123456789abcdef' },
      merged: [{ number: 70, headSha: 'other' }, { number: 81, headSha: '0123456789AB' }],
      confirmed: undefined,
    });
    expect(planPrOf(readings)).toEqual({ outcome: 'ask', ask: 'confirm', number: 81 });
  });

  it('answers none where a merged head is shorter than 7 hex characters', () => {
    const readings = landed({
      addition: { sha: 'm', secondParent: '0123456789abcdef' },
      merged: [{ number: 81, headSha: '012345' }],
      confirmed: undefined,
    });
    expect(planPrOf(readings)).toEqual({ outcome: 'none' });
  });

  it('answers the merged PR the host confirms at that merge commit', () => {
    expect(planPrOf(landed())).toEqual({
      outcome: 'found', number: 77, state: 'MERGED', draft: false, headSha: 'h', branch: '', rivals: [], carried: [],
      route: 'merged', read: { at: 'default' },
    });
    const unnamed = planPrOf(landed({ confirmed: { state: 'MERGED', mergeCommit: '' } }));
    expect(unnamed.outcome).toBe('found');
  });

  it('answers none where the host holds no such PR, does not say MERGED, or names another merge commit', () => {
    expect(planPrOf(landed({ confirmed: null }))).toEqual({ outcome: 'none' });
    expect(planPrOf(landed({ confirmed: { state: 'CLOSED', mergeCommit: '' } }))).toEqual({ outcome: 'none' });
    expect(planPrOf(landed({ confirmed: { state: 'MERGED', mergeCommit: 'elsewhere' } }))).toEqual({ outcome: 'none' });
  });
});
