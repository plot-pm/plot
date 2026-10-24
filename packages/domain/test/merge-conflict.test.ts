import { describe, expect, it } from 'vitest';
import { MERGE_CONFLICT_HEADING, mergeConflictCorrection } from '../src/rules/merge-conflict.js';

const BRANCH = 'bug/a-desk-merges-main-when-its-pr-conflicts';

describe('mergeConflictCorrection', () => {
  it('opens with the heading and names the branch', () => {
    const text = mergeConflictCorrection(BRANCH);
    expect(text.startsWith(`${MERGE_CONFLICT_HEADING}\n\n`)).toBe(true);
    expect(text).toContain(`\`${BRANCH}\``);
    expect(text).toContain('Merge that branch');
  });

  it('carries no estate-specific text: the wording names no project path or procedure', () => {
    const text = mergeConflictCorrection(BRANCH);
    expect(text).not.toContain('origin/main');
    expect(text).not.toContain('board-server.mjs');
    expect(text).not.toContain('pnpm build:board');
    expect(text).not.toContain('default branch');
  });

  it('names the bounded retry: a reading after the correction budget is spent ends the slice for a person', () => {
    const text = mergeConflictCorrection(BRANCH);
    expect(text).toContain('`Correction budget`');
    expect(text).toContain('ends the slice for a person');
    expect(text).not.toContain('second conflicting reading');
  });
});
