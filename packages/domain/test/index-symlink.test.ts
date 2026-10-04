import { describe, expect, it } from 'vitest';

import { indexSymlinkPlacement } from '../src/rules/index-symlink.js';

describe('indexSymlinkPlacement', () => {
  it('computes the active and delivered link paths and the relative target', () => {
    const placement = indexSymlinkPlacement({
      activeDir: 'docs/plans/active/',
      deliveredDir: 'docs/plans/delivered/',
      slug: 'a-plan',
      planBasename: '2026-10-03-a-plan.md',
    });
    expect(placement).toEqual({
      activeLink: 'docs/plans/active/a-plan.md',
      deliveredLink: 'docs/plans/delivered/a-plan.md',
      target: '../2026-10-03-a-plan.md',
    });
  });

  it('adds exactly one separator when a configured directory has no trailing slash', () => {
    const placement = indexSymlinkPlacement({
      activeDir: 'docs/plans/active',
      deliveredDir: 'docs/plans/delivered',
      slug: 'a-plan',
      planBasename: 'a-plan.md',
    });
    expect(placement.activeLink).toBe('docs/plans/active/a-plan.md');
    expect(placement.deliveredLink).toBe('docs/plans/delivered/a-plan.md');
  });
});
