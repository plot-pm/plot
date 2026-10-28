import { describe, expect, it } from 'vitest';

import type { ReapRecordRow } from '../src/ports/reap-record.js';
import {
  recordedBranchVerdict,
  recordedWorktreeVerdict,
  stillPrMerged,
  type BranchRowCheck,
} from '../src/rules/recorded-reap.js';
import type { TreeReadings } from '../src/rules/reapable.js';

const branchRow = (overrides: Partial<ReapRecordRow> = {}): ReapRecordRow => ({
  kind: 'branch',
  identity: 'bug/one',
  tipSha: 'abc1234',
  reason: 'pr merged',
  ...overrides,
});

const check = (overrides: Partial<BranchRowCheck> = {}): BranchRowCheck => ({
  tipSha: 'abc1234',
  checkedOut: false,
  defaultBranch: 'main',
  ...overrides,
});

describe('recordedBranchVerdict', () => {
  it('acts when the tip is unchanged, not checked out, and not the default branch', () => {
    const verdict = recordedBranchVerdict(branchRow(), check());
    expect(verdict).toEqual({ identity: 'bug/one', act: true, refusals: [] });
  });

  it('keeps a row whose tip moved since the dry run', () => {
    const verdict = recordedBranchVerdict(branchRow(), check({ tipSha: 'def5678' }));
    expect(verdict.act).toBe(false);
    expect(verdict.refusals).toContain('tip-changed');
  });

  it('keeps a row checked out in a new worktree since the dry run', () => {
    const verdict = recordedBranchVerdict(branchRow(), check({ checkedOut: true }));
    expect(verdict.act).toBe(false);
    expect(verdict.refusals).toContain('now-checked-out');
  });

  it('keeps a row that is now the default branch', () => {
    const verdict = recordedBranchVerdict(branchRow({ identity: 'main' }), check({ defaultBranch: 'main' }));
    expect(verdict.act).toBe(false);
    expect(verdict.refusals).toContain('default-branch');
  });

  it('keeps a branch a person removed from the record by hand', () => {
    const verdict = recordedBranchVerdict(undefined, check());
    expect(verdict.act).toBe(false);
    expect(verdict.refusals).toEqual(['not-recorded']);
  });
});

const liveTree = (overrides: Partial<TreeReadings & { tipSha: string }> = {}): TreeReadings & { tipSha: string } => ({
  branch: 'bug/one',
  defaultBranch: 'main',
  isMain: false,
  workerPid: null,
  dirtyPath: '',
  blockedMarker: false,
  merge: 'merged',
  tipSha: 'abc1234',
  ...overrides,
});

describe('recordedWorktreeVerdict', () => {
  it('acts when the tip is unchanged and every live gate passes', () => {
    const verdict = recordedWorktreeVerdict(branchRow({ kind: 'worktree', identity: '/tree/one' }), liveTree());
    expect(verdict).toEqual({ identity: '/tree/one', act: true, refusals: [] });
  });

  it('keeps a row whose tip moved, even though the live gate alone would pass', () => {
    const verdict = recordedWorktreeVerdict(
      branchRow({ kind: 'worktree', identity: '/tree/one' }),
      liveTree({ tipSha: 'def5678' }),
    );
    expect(verdict.act).toBe(false);
    expect(verdict.refusals).toContain('tip-changed');
  });

  it('keeps a row that gained a dirty path since the dry run, with the live refusal', () => {
    const verdict = recordedWorktreeVerdict(
      branchRow({ kind: 'worktree', identity: '/tree/one' }),
      liveTree({ dirtyPath: 'src/file.ts' }),
    );
    expect(verdict.act).toBe(false);
    expect(verdict.refusals).toContain('uncommitted-changes');
  });

  it('keeps a row that gained a live worker pid since the dry run', () => {
    const verdict = recordedWorktreeVerdict(
      branchRow({ kind: 'worktree', identity: '/tree/one' }),
      liveTree({ workerPid: '4242' }),
    );
    expect(verdict.act).toBe(false);
    expect(verdict.refusals).toContain('live-worker');
  });

  it('keeps a worktree not in the record at all', () => {
    const verdict = recordedWorktreeVerdict(undefined, liveTree());
    expect(verdict.act).toBe(false);
    expect(verdict.refusals).toEqual(['not-recorded']);
  });
});

describe('stillPrMerged', () => {
  it('is true only for a fresh merged answer', () => {
    expect(stillPrMerged('merged')).toBe(true);
  });

  it('is false for a fresh not-merged answer, keeping a flipped host answer from deleting', () => {
    expect(stillPrMerged('not-merged')).toBe(false);
  });

  it('is false for unknown, never treating silence as permission', () => {
    expect(stillPrMerged('unknown')).toBe(false);
  });

  it('is false for a failed or throttled re-ask', () => {
    expect(stillPrMerged(null)).toBe(false);
  });
});
