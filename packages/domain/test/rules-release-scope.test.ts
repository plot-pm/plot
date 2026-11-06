import { describe, expect, it } from 'vitest';
import { namedOutsideScope, scopeSlugs } from '../src/rules/release-scope.js';

describe('scopeSlugs', () => {
  it('reads unstruck items under Must, Should and Could once each, and nothing under other headings', () => {
    const sprint = [
      '## Sprint Goal', '- [ ] [goal-item] not scope', '',
      '### Must Have', '- [x] [alpha] a', '- [ ] ~~[struck]~~ left', '- [ ] [alpha] again',
      '### Should Have', '- [ ] [beta] b',
      '## Could Have', '- [ ] [gamma] c',
      '## Notes', '- [ ] [note-item] n',
    ].join('\n');
    expect(scopeSlugs(sprint)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('answers an empty list for a file with no tier', () => {
    expect(scopeSlugs('# S\n\ntext\n')).toEqual([]);
  });
});

describe('namedOutsideScope', () => {
  it('names each plan outside the scope once, through its slug, and skips in-scope and plan-less changesets', () => {
    const shipped = [
      { file: 'a.md', plan: 'docs/plans/2026-10-01-alpha.md' },
      { file: 'b.md', plan: 'docs/plans/2026-10-02-omega.md' },
      { file: 'c.md', plan: 'docs/plans/2026-10-02-omega.md' },
      { file: 'd.md', plan: '' },
    ];
    expect(namedOutsideScope(shipped, ['alpha'])).toEqual(['omega']);
  });
});
