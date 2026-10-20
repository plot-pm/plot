import { describe, expect, it } from 'vitest';
import { MERGE_CONFLICT_HEADING, mergeConflictCorrection } from '../src/rules/merge-conflict.js';

const BRANCH = 'bug/a-desk-merges-main-when-its-pr-conflicts';

describe('mergeConflictCorrection', () => {
  it('opens with the heading and names the branch', () => {
    const text = mergeConflictCorrection(BRANCH);
    expect(text.startsWith(`${MERGE_CONFLICT_HEADING}\n\n`)).toBe(true);
    expect(text).toContain(`\`${BRANCH}\``);
    expect(text).toContain('Merge the default branch');
  });

  it('carries CLAUDE.md\'s board-artifact procedure: restore from merge base, never commit a rebuild', () => {
    const text = mergeConflictCorrection(BRANCH);
    expect(text).toContain('board-server.mjs');
    expect(text).toContain('-merge');
    expect(text).toContain('.gitattributes');
    expect(text).toContain('Restore every conflicting generated path from the merge base against `origin/main`');
    expect(text).toContain('do not commit a rebuild');
    expect(text).toContain('take ours');
  });

  it('names the bounded retry: a reading after the correction budget is spent ends the slice for a person', () => {
    const text = mergeConflictCorrection(BRANCH);
    expect(text).toContain('`Correction budget`');
    expect(text).toContain('ends the slice for a person');
    expect(text).not.toContain('second conflicting reading');
  });
});
