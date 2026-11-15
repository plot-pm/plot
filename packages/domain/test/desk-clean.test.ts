import { describe, expect, it } from 'vitest';

import { deskClean } from '../src/rules/desk-clean.js';

describe('deskClean', () => {
  it('reads clean with no counted dirt and nothing ahead of the upstream', () => {
    expect(deskClean([], 0)).toBe(true);
  });

  it('reads clean where git cannot count the upstream', () => {
    expect(deskClean([], null)).toBe(true);
  });

  it('reads not clean with a counted path', () => {
    expect(deskClean(['src/a.ts'], 0)).toBe(false);
  });

  it('reads not clean with commits ahead of the upstream', () => {
    expect(deskClean([], 2)).toBe(false);
  });

  it('reads not clean for a worktree that cannot be read', () => {
    expect(deskClean(null, null)).toBe(false);
  });
});
