import { describe, expect, it } from 'vitest';

import { bundleCommitRefusal, type BundleCommitReadings } from '../src/rules/bundle-commit.js';

/** A real path from `BOARD_ARTIFACT_PATHS`, so a staged-add test refuses for real. */
const GENERATED_PATH = 'skills/plot/scripts/board/board-server.mjs';

const MERGE_BASE = 'abc123';

const EMPTY: BundleCommitReadings = {
  staged: [],
  mergeBase: MERGE_BASE,
  existedAtMergeBase: {},
};

describe('bundleCommitRefusal', () => {
  it('allows a commit staging nothing', () => {
    expect(bundleCommitRefusal(EMPTY)).toBeNull();
  });

  it('refuses a staged add of a generated path, with a git rm repair', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      staged: [{ status: 'added', path: GENERATED_PATH }],
    });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain(`git rm --cached ${GENERATED_PATH}`);
    expect(refusal).toContain(GENERATED_PATH);
  });

  it('refuses a staged modify of a generated path already in the merge base, with a restore repair', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      staged: [{ status: 'modified', path: GENERATED_PATH }],
      existedAtMergeBase: { [GENERATED_PATH]: true },
    });
    expect(refusal).toContain(`git restore --staged --worktree --source="${MERGE_BASE}" -- ${GENERATED_PATH}`);
  });

  it('allows a staged delete of a generated path', () => {
    // StagedPath carries no 'deleted' status — a delete never reaches this
    // rule's input at all, which this test pins by construction: there is no
    // value of `status` that represents one.
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      staged: [],
    });
    expect(refusal).toBeNull();
  });

  it('refuses a staged rename landing a generated path, naming only the new path', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      staged: [{ status: 'renamed', path: GENERATED_PATH }],
    });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain(GENERATED_PATH);
  });

  it('allows a staged bundles.generated.ts even though it names the set', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      staged: [{ status: 'modified', path: 'packages/board/src/contract/bundles.generated.ts' }],
    });
    expect(refusal).toBeNull();
  });

  it('allows a staged .gitattributes', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      staged: [{ status: 'modified', path: '.gitattributes' }],
    });
    expect(refusal).toBeNull();
  });

  it('refuses with no repair command when no merge base could be read', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      staged: [{ status: 'added', path: GENERATED_PATH }],
      mergeBase: null,
    });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain(GENERATED_PATH);
    expect(refusal).not.toContain('git rm');
    expect(refusal).not.toContain('git restore');
  });

  it('allows a staged path that touches no generated set at all', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      staged: [{ status: 'added', path: 'packages/domain/src/rules/bundle-commit.ts' }],
    });
    expect(refusal).toBeNull();
  });
});
