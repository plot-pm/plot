import { describe, it, expect } from 'vitest';
import { planHref } from '../../src/app/lib/plan';

describe('planHref', () => {
  it('routes to /plan/<basename> from a repo-relative plan path', () => {
    expect(planHref({ path: 'docs/plans/2026-07-12-foo.md' })).toBe('/plan/2026-07-12-foo.md');
  });

  it('uses only the basename regardless of nesting (e.g. active/ symlinks)', () => {
    expect(planHref({ path: 'docs/plans/active/bar.md' })).toBe('/plan/bar.md');
  });

  it('percent-encodes unusual characters in the basename', () => {
    expect(planHref({ path: 'docs/plans/a b&c.md' })).toBe('/plan/a%20b%26c.md');
  });
});
