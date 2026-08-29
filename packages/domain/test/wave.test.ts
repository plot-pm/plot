import { describe, it, expect } from 'vitest';
import { WaveBoundSchema, isSliced, plansSpanned, type Wave, type SliceRef } from '../src/index.js';

/**
 * What the fleet lands together — the entity with no source of truth.
 *
 * It is formed at dispatch and persisted nowhere, so it has NO CONSTRUCTOR.
 * Nothing forms one today: the dispatcher requires a plan slug and computes
 * ordering within one plan. The two halves exist and have never been joined.
 */

const slice = (plan: string, name: string, branch: string): SliceRef => ({ plan, name, branch });

describe('a wave spans plans; a slice belongs to one', () => {
  it('is a type that can be described without being constructed by Plot', () => {
    // The honest shape for an entity nothing forms yet: a value can be written
    // in a test, and no factory in the domain mints one.
    const wave: Wave = {
      slices: [slice('plan-a', 'Moving', 'feature/x'), slice('plan-b', 'Counted', 'feature/y')],
      parallelAgents: 3,
    };
    expect(wave.slices).toHaveLength(2);
    expect(wave.parallelAgents).toBe(3);
  });

  it('names the two bounds a wave may be sized by', () => {
    // Which wins is an open question: starting five agents whose work cannot
    // land together is the burst the merge queue was written to predict.
    expect(WaveBoundSchema.options).toEqual(['agents', 'landable']);
  });

  it('spans several plans, which is what nothing does today', () => {
    expect(plansSpanned([slice('plan-a', 'Moving', 'feature/x'), slice('plan-b', 'Counted', 'feature/y')]))
      .toEqual(['plan-a', 'plan-b']);
  });

  it('counts a plan once however many of its slices are in the wave', () => {
    expect(plansSpanned([slice('plan-a', 'One', 'feature/x'), slice('plan-a', 'Two', 'feature/y')]))
      .toEqual(['plan-a']);
  });

  it('spans nothing when it holds nothing', () => {
    expect(plansSpanned([])).toEqual([]);
  });
});

describe('a section naming no branch is unsliced, not a slice holding none', () => {
  it('accepts a slice naming a plan, a name and one branch', () => {
    expect(isSliced(slice('plan-a', 'Moving', 'feature/x'))).toBe(true);
  });

  it('refuses a section with no branch', () => {
    // 9 of the 11 such sections measured here are prose headings a parser read
    // as slices — a plan nobody has sliced rather than a violation.
    expect(isSliced(slice('plan-a', 'Moving', ''))).toBe(false);
  });

  it('refuses a reference belonging to no plan or carrying no name', () => {
    expect(isSliced(slice('', 'Moving', 'feature/x'))).toBe(false);
    expect(isSliced(slice('plan-a', '', 'feature/x'))).toBe(false);
  });
});
