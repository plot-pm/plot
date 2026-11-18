import { describe, it, expect } from 'vitest';
import { planSourceOf, type PlanSourceReadings } from '../src/rules/plan-source.js';
import type { PlanPrFound } from '../src/rules/plan-pr.js';

const FILE = 'docs/plans/2026-11-16-the-tab-header.md';

const atHead = (over: Partial<PlanPrFound> = {}): PlanPrFound => ({
  outcome: 'found',
  number: 3469,
  state: 'OPEN',
  draft: true,
  headSha: 'a'.repeat(40),
  branch: 'idea/batch-the-tab-header',
  rivals: [],
  carried: [],
  route: 'open',
  read: { at: 'head', sha: 'a'.repeat(40), file: FILE },
  ...over,
});

const readings = (over: Partial<PlanSourceReadings> = {}): PlanSourceReadings => ({
  slug: 'the-tab-header',
  inCheckout: false,
  onMainFile: '',
  main: 'main',
  pr: undefined,
  blob: '',
  rivals: [],
  ...over,
});

describe('planSourceOf', () => {
  it('reads a plan only the checkout holds from the checkout', () => {
    expect(planSourceOf(readings({ inCheckout: true }))).toEqual({ outcome: 'found', source: { at: 'checkout' } });
  });

  it('reads a plan the default branch holds from the default branch, even where the checkout holds it too', () => {
    expect(planSourceOf(readings({ inCheckout: true, onMainFile: FILE }))).toEqual({
      outcome: 'found',
      source: { at: 'default', branch: 'main', file: FILE },
    });
  });

  it('reads a plan only the default branch holds from the default branch', () => {
    expect(planSourceOf(readings({ onMainFile: FILE }))).toEqual({
      outcome: 'found',
      source: { at: 'default', branch: 'main', file: FILE },
    });
  });

  it('reads a plan on a batch PR from that PR head', () => {
    expect(planSourceOf(readings({ pr: atHead(), blob: 'b1' }))).toEqual({
      outcome: 'found',
      source: { at: 'pr-head', number: 3469, branch: 'idea/batch-the-tab-header', sha: 'a'.repeat(40), file: FILE },
    });
  });

  it('prefers the plan PR head over the checkout copy', () => {
    const answer = planSourceOf(readings({ inCheckout: true, pr: atHead({ route: 'named', branch: 'idea/the-tab-header' }), blob: 'b1' }));
    expect(answer.outcome === 'found' && answer.source.at).toBe('pr-head');
  });

  it('refuses pr-copies-differ when an open rival carries a differing copy', () => {
    const answer = planSourceOf(readings({ pr: atHead(), blob: 'b1', rivals: [{ number: 3470, blob: 'b2' }] }));
    expect(answer).toMatchObject({ outcome: 'refused', reason: 'pr-copies-differ' });
    expect(answer.outcome === 'refused' && answer.detail).toContain('#3470');
  });

  it('accepts an open rival whose copy is identical', () => {
    const answer = planSourceOf(readings({ pr: atHead(), blob: 'b1', rivals: [{ number: 3470, blob: 'b1' }] }));
    expect(answer.outcome === 'found' && answer.source.at).toBe('pr-head');
  });

  it('passes the finder\'s own refusals through', () => {
    expect(planSourceOf(readings({ pr: { outcome: 'refused', reason: 'pr-head-unheld', number: 9 } }))).toMatchObject({ reason: 'pr-head-unheld' });
    expect(planSourceOf(readings({ pr: { outcome: 'refused', reason: 'pr-carries-no-plan', number: 9 } }))).toMatchObject({ reason: 'pr-carries-no-plan' });
  });

  it('reads a merged plan PR answer from the checkout or the default branch, not from a head', () => {
    const merged = atHead({ state: 'MERGED', route: 'merged', branch: '', read: { at: 'default' } });
    expect(planSourceOf(readings({ pr: merged, onMainFile: FILE }))).toMatchObject({ outcome: 'found', source: { at: 'default' } });
  });

  it('refuses plan-not-found where no source holds the plan', () => {
    expect(planSourceOf(readings())).toMatchObject({ outcome: 'refused', reason: 'plan-not-found' });
  });
});
