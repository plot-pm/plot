import { describe, expect, it } from 'vitest';

import { briefPath } from '../src/rules/brief-path.js';

describe('briefPath', () => {
  it.each([
    ['feature/a-brief-has-one-name', '.plot/briefs/a-brief-has-one-name.md'],
    ['idea/feature-y', '.plot/briefs/feature-y.md'],
    ['release/team/x', '.plot/briefs/x.md'],
    ['plain-slug', '.plot/briefs/plain-slug.md'],
  ])('takes %s after its last slash', (branch, path) => {
    expect(briefPath(branch)).toBe(path);
  });
});
