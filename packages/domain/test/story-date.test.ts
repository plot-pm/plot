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

  it('reads 2 to 6 days as a day count', () => {
    expect(storyDateText('2026-10-13', now)).toBe('2 days ago');
    expect(storyDateText('2026-10-12', now)).toBe('3 days ago');
    expect(storyDateText('2026-10-11', now)).toBe('4 days ago');
    expect(storyDateText('2026-10-10', now)).toBe('5 days ago');
    expect(storyDateText('2026-10-09', now)).toBe('6 days ago');
  });

  it('switches ranges at the boundaries', () => {
    expect(storyDateText('2026-10-15T12:00:00Z', now)).toBe('today');
    expect(storyDateText('2026-10-14T12:00:00Z', now)).toBe('yesterday');
    expect(storyDateText('2026-10-13T12:00:00Z', now)).toBe('2 days ago');
    expect(storyDateText('2026-10-08T12:00:00Z', now)).toBe('1 weeks ago');
    expect(storyDateText('2026-10-09T12:00:00Z', now)).toBe('6 days ago');
    expect(storyDateText('2026-09-17T12:00:00Z', now)).toBe('4 weeks ago');
    const edge = '2026-09-15T12:00:00Z';
    expect(storyDateText(edge, now)).toBe(new Date(edge).toLocaleDateString());
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
