import { describe, expect, it } from 'vitest';

import { crossRepoReferences } from '../src/rules/cross-repo-reference.js';

const plan = (...body: string[]): string =>
  ['# A plan', '', '## Status', '', '- **State:** Approved', '', ...body].join('\n');

describe('crossRepoReferences', () => {
  it('reads a list claim’s cross-repo reference', () => {
    const refs = crossRepoReferences(plan('## Slices', '', '- `feature/x` — the work → quatico/other#4711'));
    expect(refs.get('feature/x')).toEqual([{ repo: 'quatico/other', number: 4711 }]);
  });

  it('reads a heading claim’s cross-repo reference', () => {
    const refs = crossRepoReferences(plan('## Waves', '', '### One (Branch: feature/y) → acme/widget.js#7'));
    expect(refs.get('feature/y')).toEqual([{ repo: 'acme/widget.js', number: 7 }]);
  });

  it('reads a heading’s `PR: owner/repo#N` form', () => {
    const refs = crossRepoReferences(plan('## Waves', '', '### One (Branch: feature/y, PR: acme/widget.js#7)'));
    expect(refs.get('feature/y')).toEqual([{ repo: 'acme/widget.js', number: 7 }]);
  });

  it('ignores a same-repo reference', () => {
    expect(crossRepoReferences(plan('## Branches', '', '- `feature/x` — work → #12')).size).toBe(0);
  });

  it('keeps every line that names a reference, one per repository', () => {
    const refs = crossRepoReferences(
      plan('## Slices', '', '### One (Branch: feature/x)', '', '- `feature/x` → a/b#1', '- `feature/x` → c/d#2'),
    );
    expect(refs.get('feature/x')).toEqual([
      { repo: 'a/b', number: 1 },
      { repo: 'c/d', number: 2 },
    ]);
  });

  it('reads nothing outside the slice sections or inside a fence', () => {
    const refs = crossRepoReferences(
      plan(
        '## Design', '', '- `feature/x` → a/b#1', '',
        '## Slices', '', '```', '- `feature/y` → a/b#2', '```', '',
        '## Notes', '', '- `feature/z` → a/b#3',
      ),
    );
    expect(refs.size).toBe(0);
  });
});
