import { describe, expect, it } from 'vitest';

import {
  bundleCommitPaths,
  bundleCommitRefusal,
  bundleCommitTouches,
  shippedPathsOf,
  type BundleCommitReadings,
} from '../src/rules/bundle-commit.js';

/** A path the generated set names, so a staged-add test refuses for real. */
const GENERATED_PATH = 'skills/plot/scripts/board/board-server.mjs';

const MERGE_BASE = 'abc123';

const EMPTY: BundleCommitReadings = {
  generated: [GENERATED_PATH],
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

  it('allows a staged bundle when the generated set is empty, as in a repository with no build.mjs', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      generated: [],
      staged: [{ status: 'modified', path: GENERATED_PATH }],
    });
    expect(refusal).toBeNull();
  });

  it('refuses a new bundle the generated set declares, with a git rm repair', () => {
    const born = 'skills/plot/scripts/board/plot-ninth.mjs';
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      generated: [GENERATED_PATH, born],
      staged: [{ status: 'added', path: born }],
    });
    expect(refusal).toContain(`git rm --cached ${born}`);
  });

  it('allows a staged path that touches no generated set at all', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      staged: [{ status: 'added', path: 'packages/domain/src/rules/bundle-commit.ts' }],
    });
    expect(refusal).toBeNull();
  });
});

describe('bundleCommitTouches', () => {
  it('skips a staged .gitattributes beside a real touch, naming only the latter', () => {
    const touches = bundleCommitTouches({
      ...EMPTY,
      staged: [
        { status: 'modified', path: '.gitattributes' },
        { status: 'added', path: GENERATED_PATH },
      ],
    });
    expect(touches).toHaveLength(1);
    expect(touches[0]!.path).toBe(GENERATED_PATH);
  });
});

describe('bundleCommitPaths', () => {
  it('names only the staged paths the generated set declares, in staged order', () => {
    const second = 'skills/plot/scripts/board/plot-ask.mjs';
    expect(
      bundleCommitPaths({
        generated: [second, GENERATED_PATH],
        staged: [
          { status: 'modified', path: GENERATED_PATH },
          { status: 'modified', path: 'skills/plot/scripts/board/README.md' },
          { status: 'added', path: second },
        ],
      }),
    ).toEqual([GENERATED_PATH, second]);
  });

  it('leaves out bundles.generated.ts and .gitattributes even when the set names them', () => {
    expect(
      bundleCommitPaths({
        generated: ['packages/board/src/contract/bundles.generated.ts', '.gitattributes'],
        staged: [
          { status: 'modified', path: 'packages/board/src/contract/bundles.generated.ts' },
          { status: 'modified', path: '.gitattributes' },
        ],
      }),
    ).toEqual([]);
  });
});

describe('shippedPathsOf', () => {
  it('reads every shipped declaration, strips ../../, and sorts without duplicates', () => {
    const text = [
      "import path from 'node:path';",
      "const shippedTask = path.join(here, '../../skills/plot/scripts/board/plot-task.mjs');",
      "const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');",
      "const shippedAgain = path.join(here, '../../skills/plot/scripts/board/plot-task.mjs');",
      '',
    ].join('\n');
    expect(shippedPathsOf(text)).toEqual([
      'skills/plot/scripts/board/board-server.mjs',
      'skills/plot/scripts/board/plot-task.mjs',
    ]);
  });

  it('reads two declarations on one line', () => {
    const text =
      "const shippedA = path.join(here, '../../a.mjs'); const shippedB = path.join(here, '../../b.mjs');";
    expect(shippedPathsOf(text)).toEqual(['a.mjs', 'b.mjs']);
  });

  it('ignores a declaration that is not shipped*, and an argument without ../../', () => {
    const text = [
      "const entry = path.join(here, '../../src/entry.ts');",
      "const shippedLocal = path.join(here, 'local.mjs');",
      "const shippedEmpty = path.join(here, '../../');",
    ].join('\n');
    expect(shippedPathsOf(text)).toEqual([]);
  });

  it('reads nothing from an empty text', () => {
    expect(shippedPathsOf('')).toEqual([]);
  });
});
