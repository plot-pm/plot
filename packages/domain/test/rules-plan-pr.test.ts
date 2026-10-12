import { describe, it, expect } from 'vitest';
import {
  namesPlan,
  planPrsCarrying,
  planSlugOf,
  plansChanged,
  prNumberInSubject,
  type PlanBlob,
  type PlanPrCandidate,
} from '../src/rules/plan-pr.js';

const ONE = 'docs/plans/2026-10-12-the-phases-are-declared.md';
const TWO = 'docs/plans/2026-10-12-the-board-has-three-tabs.md';
const OLD = 'docs/plans/2026-09-01-an-older-plan.md';

const main: PlanBlob[] = [{ path: OLD, sha: 'old' }];

const pr = (over: Partial<PlanPrCandidate> = {}): PlanPrCandidate => ({
  number: 1608,
  head: 'idea/batch-plot-works-in-five-phases',
  draft: true,
  headSha: 'c0ffee',
  plans: [{ path: OLD, sha: 'old' }, { path: ONE, sha: 'one' }, { path: TWO, sha: 'two' }],
  ...over,
});

describe('namesPlan', () => {
  it('names a date-prefixed plan file and a bare one', () => {
    expect(namesPlan('the-phases-are-declared', ONE)).toBe(true);
    expect(namesPlan('a-plan', 'docs/plans/a-plan.md')).toBe(true);
  });

  it('does not take a slug that is only the tail of another slug', () => {
    expect(namesPlan('declared', ONE)).toBe(false);
  });
});

describe('planSlugOf', () => {
  it('drops the directory, the date and the extension', () => {
    expect(planSlugOf(TWO)).toBe('the-board-has-three-tabs');
    expect(planSlugOf('a-plan.md')).toBe('a-plan');
  });
});

describe('plansChanged', () => {
  it('names the files the default branch lacks or holds with other content, in path order', () => {
    const head = [{ path: TWO, sha: 'two' }, { path: OLD, sha: 'edited' }, { path: ONE, sha: 'one' }];
    expect(plansChanged(head, main)).toEqual([OLD, TWO, ONE].sort());
  });

  it('names nothing for a head equal to the default branch', () => {
    expect(plansChanged(main, main)).toEqual([]);
  });
});

describe('planPrsCarrying', () => {
  it('finds a batch PR by the plan file it adds, whatever its branch is called', () => {
    const [match, ...rest] = planPrsCarrying('the-phases-are-declared', main, [pr()]);
    expect(rest).toEqual([]);
    expect(match?.pr.number).toBe(1608);
    expect(match?.file).toBe(ONE);
    expect(match?.carried).toEqual([TWO]);
  });

  it('skips a PR whose head holds the plan exactly as the default branch does', () => {
    const merged: PlanBlob[] = [...main, { path: ONE, sha: 'one' }];
    const later = pr({ number: 1700, plans: merged });
    expect(planPrsCarrying('the-phases-are-declared', merged, [later])).toEqual([]);
  });

  it('counts a PR that changes a plan the default branch already holds', () => {
    const onMain: PlanBlob[] = [...main, { path: ONE, sha: 'one' }];
    const edit = pr({ number: 1701, plans: [{ path: ONE, sha: 'one-edited' }] });
    expect(planPrsCarrying('the-phases-are-declared', onMain, [edit]).map((m) => m.pr.number)).toEqual([1701]);
  });

  it('answers one match per carrying PR, so the caller sees two PRs as ambiguous', () => {
    const rival = pr({ number: 1609, head: 'idea/the-phases-are-declared', plans: [{ path: ONE, sha: 'other' }] });
    const unrelated = pr({ number: 1610, head: 'feature/x', plans: main });
    const matches = planPrsCarrying('the-phases-are-declared', main, [pr(), unrelated, rival]);
    expect(matches.map((m) => m.pr.number)).toEqual([1608, 1609]);
    expect(matches[1]?.carried).toEqual([]);
  });
});

describe('prNumberInSubject', () => {
  it('reads the number from both hosts\' merge subjects', () => {
    expect(prNumberInSubject('Merge pull request #1608 from plot-pm/idea/batch-x')).toBe(1608);
    expect(prNumberInSubject('Merged in idea/batch-x (pull request #12)')).toBe(12);
  });

  it('answers null for a subject that names no number', () => {
    expect(prNumberInSubject("Merge branch 'main' into feature/x")).toBeNull();
  });
});
