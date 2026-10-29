import { describe, it, expect } from 'vitest';
import { sprintItemDestination } from '../src/index.js';

describe('sprintItemDestination', () => {
  it('opens a known member whose slug has a card', () => {
    expect(sprintItemDestination({ slug: 'a-plan', known: true }, new Set(['a-plan']))).toBe('a-plan');
  });

  it('has no destination for a known: false member', () => {
    expect(sprintItemDestination({ slug: 'a-plan', known: false }, new Set(['a-plan']))).toBeNull();
  });

  it('has no destination for an empty slug', () => {
    expect(sprintItemDestination({ slug: '', known: true }, new Set(['a-plan']))).toBeNull();
  });

  it('has no destination for a known slug with no card', () => {
    expect(sprintItemDestination({ slug: 'missing-plan', known: true }, new Set(['a-plan']))).toBeNull();
  });
});
