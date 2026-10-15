import { describe, expect, it } from 'vitest';
import { storyDateText } from '../src/index.js';

const now = new Date('2026-10-15T12:00:00Z');

describe('storyDateText', () => {
  it('reads an ISO timestamp as a relative age', () => {
    expect(storyDateText('2026-10-14T09:00:00Z', now)).toBe('yesterday');
  });

  it('reads a date-only value', () => {
    expect(storyDateText('2026-10-15', now)).toBe('today');
    expect(storyDateText('2026-10-01', now)).toBe('2 weeks ago');
  });

  it('returns the locale date past 30 days', () => {
    const old = '2026-01-01';
    expect(storyDateText(old, now)).toBe(new Date(old).toLocaleDateString());
  });

  it('returns null for a non-ISO value', () => {
    expect(storyDateText('last Tuesday-ish', now)).toBeNull();
  });

  it('returns null for an absent value', () => {
    expect(storyDateText('', now)).toBeNull();
    expect(storyDateText(undefined, now)).toBeNull();
  });
});
