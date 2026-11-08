import { describe, expect, it } from 'vitest';

import { annotateSlicePr } from '../src/rules/slice-pr-annotation.js';

describe('annotateSlicePr', () => {
  it('appends the PR number to the branch\'s bulleted line', () => {
    const content = ['## Slices', '', '### Fix', '', '- `bug/foo` — do the thing'].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '42');
    expect(result).toEqual({ outcome: 'annotated', content: ['## Slices', '', '### Fix', '', '- `bug/foo` — do the thing → #42'].join('\n') });
  });

  it('matches only the line carrying the exact branch name in backticks', () => {
    const content = ['## Slices', '', '- `bug/foo` — one thing', '- `bug/foo-v2` — another'].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '42');
    expect(result).toEqual({ outcome: 'annotated', content: ['## Slices', '', '- `bug/foo` — one thing → #42', '- `bug/foo-v2` — another'].join('\n') });
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
    const content = ['## Slices', '', '- `bug/other` — do the thing'].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '42');
    expect(result).toEqual({ outcome: 'refused', reason: 'branch-unaddressed' });
  });

  it('refuses a same-repo annotation already present, rather than doubling it', () => {
    const content = ['## Slices', '', '- `bug/foo` — do the thing → #42'].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '43');
    expect(result).toEqual({ outcome: 'refused', reason: 'already-annotated' });
  });

  it('refuses a cross-repo annotation already present', () => {
    const content = ['## Slices', '', '- `bug/foo` — do the thing → owner/repo#42'].join('\n');
    const result = annotateSlicePr(content, 'bug/foo', '43');
    expect(result).toEqual({ outcome: 'refused', reason: 'already-annotated' });
  });

  it('annotates the slice line and leaves an earlier prose line byte-identical', () => {
    const prose = '- `bug/x` — described under design → #1';
    const content = ['## Design', '', prose, '', '## Slices', '', '- `bug/x` — the slice'].join('\n');
    expect(annotateSlicePr(content, 'bug/x', '2')).toEqual({
      outcome: 'annotated',
      content: ['## Design', '', prose, '', '## Slices', '', '- `bug/x` — the slice → #2'].join('\n'),
    });
  });

  it('does not refuse on a PR annotation carried by a prose line outside the section', () => {
    const content = ['## Design', '- `bug/x` → #9', '## Slices', '- `bug/x` — slice'].join('\n');
    expect(annotateSlicePr(content, 'bug/x', '2').outcome).toBe('annotated');
  });

  it('refuses a branch on two slice lines, naming both and writing nothing', () => {
    const content = ['## Slices', '', '- `bug/x` — one', '### Next', '- `bug/x` — two'].join('\n');
    expect(annotateSlicePr(content, 'bug/x', '2')).toEqual({ outcome: 'refused', reason: 'branch-claimed-twice', lines: [3, 5] });
  });

  it('reads no claim inside a code fence', () => {
    const content = ['## Slices', '', '```', '- `bug/x` — in a fence', '```', '', '- `bug/x` — real'].join('\n');
    expect(annotateSlicePr(content, 'bug/x', '2')).toEqual({
      outcome: 'annotated',
      content: ['## Slices', '', '```', '- `bug/x` — in a fence', '```', '', '- `bug/x` — real → #2'].join('\n'),
    });
  });

  it('refuses a branch named only outside a slice section', () => {
    const content = ['## Design', '- `bug/x` — prose'].join('\n');
    expect(annotateSlicePr(content, 'bug/x', '2')).toEqual({ outcome: 'refused', reason: 'branch-unaddressed' });
  });
});
