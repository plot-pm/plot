import { describe, expect, it } from 'vitest';

import { annotateSlicePr } from '../src/rules/slice-pr-annotation.js';

describe('annotateSlicePr', () => {
  it('appends the PR number to the branch\'s bulleted line', () => {
    const content = ['## Slices', '', '### Fix', '', '- `bug/foo` — do the thing'].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '42');
    expect(result).toEqual({ outcome: 'annotated', content: ['## Slices', '', '### Fix', '', '- `bug/foo` — do the thing → #42'].join('\n') });
  });

  it('matches only the line carrying the exact branch name in backticks', () => {
    const content = ['- `bug/foo` — one thing', '- `bug/foo-v2` — another'].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '42');
    expect(result).toEqual({ outcome: 'annotated', content: ['- `bug/foo` — one thing → #42', '- `bug/foo-v2` — another'].join('\n') });
  });

  it('matches the Slices bullet, not an earlier Started: line carrying the same branch in backticks', () => {
    const content = [
      '## Status',
      '',
      '- **Started:** 2026-10-23, Claude, `bug/foo`',
      '',
      '## Slices',
      '',
      '- `bug/foo` — do the thing',
    ].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '42');
    expect(result).toEqual({
      outcome: 'annotated',
      content: [
        '## Status',
        '',
        '- **Started:** 2026-10-23, Claude, `bug/foo`',
        '',
        '## Slices',
        '',
        '- `bug/foo` — do the thing → #42',
      ].join('\n'),
    });
  });

  it('refuses when no line carries the branch name', () => {
    const content = ['- `bug/other` — do the thing'].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '42');
    expect(result).toEqual({ outcome: 'refused', reason: 'branch-unaddressed' });
  });

  it('refuses a same-repo annotation already present, rather than doubling it', () => {
    const content = ['- `bug/foo` — do the thing → #42'].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '43');
    expect(result).toEqual({ outcome: 'refused', reason: 'already-annotated' });
  });

  it('refuses a cross-repo annotation already present', () => {
    const content = ['- `bug/foo` — do the thing → owner/repo#42'].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '43');
    expect(result).toEqual({ outcome: 'refused', reason: 'already-annotated' });
  });
});
