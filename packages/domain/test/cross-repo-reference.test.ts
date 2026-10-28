import { describe, expect, it } from 'vitest';

import { branchClaims, crossRepoReferences } from '../src/rules/cross-repo-reference.js';

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

  it('reads the template\'s documented Bitbucket example, owner as the workspace', () => {
    const refs = crossRepoReferences(
      plan('## Slices', '', '- `feature/x` — ewz-kus-portal (Bitbucket): the slice → ewz-kus-ws/ewz-kus-portal#42'),
    );
    expect(refs.get('feature/x')).toEqual([{ repo: 'ewz-kus-ws/ewz-kus-portal', number: 42 }]);
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

describe('branchClaims', () => {
  it('gives one row per PR, same-repo and cross-repo, and one empty row for a branch naming none', () => {
    const rows = branchClaims(
      plan(
        '## Slices', '',
        '- `feature/a` — local → #12',
        '- `infra/shared` — one → quatico/one#11',
        '- `infra/shared` — two → quatico/two#22',
        '- `feature/bare` — no annotation',
      ),
    );
    expect(rows).toEqual([
      { branch: 'feature/a', reference: { repo: '', number: 12 } },
      { branch: 'infra/shared', reference: { repo: 'quatico/one', number: 11 } },
      { branch: 'infra/shared', reference: { repo: 'quatico/two', number: 22 } },
      { branch: 'feature/bare', reference: null },
    ]);
  });

  it('keeps two PRs of one branch in one repository, and every arrow on one line', () => {
    const rows = branchClaims(
      plan('## Slices', '', '- `feature/x` — first → a/b#1', '- `feature/x` — second → a/b#2', '- `feature/y` → #585 → #588'),
    );
    expect(rows.map((r) => [r.branch, r.reference?.repo, r.reference?.number])).toEqual([
      ['feature/x', 'a/b', 1],
      ['feature/x', 'a/b', 2],
      ['feature/y', '', 585],
      ['feature/y', '', 588],
    ]);
  });

  it('reads the heading arrow form, the heading PR: form, and PR: on a list item', () => {
    const rows = branchClaims(
      plan(
        '## Waves', '',
        '### One (Branch: feature/one) → a/b#1',
        '### Two (Branch: feature/two, PR: #2)',
        '',
        '## Branches', '',
        '- `feature/three` — PR: c/d#3',
      ),
    );
    expect(rows).toEqual([
      { branch: 'feature/one', reference: { repo: 'a/b', number: 1 } },
      { branch: 'feature/two', reference: { repo: '', number: 2 } },
      { branch: 'feature/three', reference: { repo: 'c/d', number: 3 } },
    ]);
  });

  it('reads one row for a PR named under both Branches and Waves', () => {
    const rows = branchClaims(
      plan('## Branches', '', '- `feature/x` → #7', '', '## Waves', '', '### X (Branch: feature/x, PR: #7)'),
    );
    expect(rows).toEqual([{ branch: 'feature/x', reference: { repo: '', number: 7 } }]);
  });

  it('claims no indented item and no backticked prose term', () => {
    const rows = branchClaims(
      plan('## Slices', '', '- `feature/x` — work', '  - `src/a.ts` → #9', '- `buildFleet()` + refresh → #10'),
    );
    expect(rows).toEqual([{ branch: 'feature/x', reference: null }]);
  });
});
