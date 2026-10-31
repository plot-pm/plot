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

const BASE = 'b'.repeat(40);
const MAIN = 'a'.repeat(40);
const SAME = '1'.repeat(40);
const OTHER = '2'.repeat(40);

/** A staged entry holding `sha` in the index at mode 100644. */
const entry = (status: 'added' | 'modified' | 'renamed' | 'deleted', path: string, sha = SAME, mode = '100644') => ({
  status,
  path,
  indexMode: mode,
  indexSha: sha,
});

/** A merge base that holds `SAME` at the generated path; nothing is staged. */
const EMPTY: BundleCommitReadings = {
  generated: [GENERATED_PATH],
  staged: [],
  mergeBase: BASE,
  atMergeBase: { [GENERATED_PATH]: { mode: '100644', sha: SAME } },
  mainTip: BASE,
  merging: false,
};

describe('bundleCommitRefusal', () => {
  it('allows a commit staging nothing', () => {
    expect(bundleCommitRefusal(EMPTY)).toBeNull();
  });

  it('allows a staged copy equal to the merge base in mode and sha', () => {
    expect(bundleCommitRefusal({ ...EMPTY, staged: [entry('modified', GENERATED_PATH, SAME)] })).toBeNull();
  });

  it('refuses a staged copy that differs from the merge base, restoring from its sha', () => {
    const refusal = bundleCommitRefusal({ ...EMPTY, staged: [entry('modified', GENERATED_PATH, OTHER)] });
    expect(refusal).toContain(`git restore --staged --worktree --source="${BASE}" -- ${GENERATED_PATH}`);
  });

  it('refuses a mode-only difference', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      staged: [entry('modified', GENERATED_PATH, SAME, '100755')],
    });
    expect(refusal).toContain('git restore');
  });

  it('refuses a path the merge base does not hold, with a git rm repair', () => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      atMergeBase: { [GENERATED_PATH]: null },
      staged: [entry('added', GENERATED_PATH)],
    });
    expect(refusal).toContain(`git rm --cached ${GENERATED_PATH}`);
    expect(refusal).not.toContain('git restore');
  });

  it('allows a staged delete of a generated path', () => {
    expect(bundleCommitRefusal({ ...EMPTY, staged: [entry('deleted', GENERATED_PATH, '0'.repeat(40), '000000')] })).toBeNull();
  });

  it('refuses a staged rename landing a differing generated path, naming the new path', () => {
    const refusal = bundleCommitRefusal({ ...EMPTY, staged: [entry('renamed', GENERATED_PATH, OTHER)] });
    expect(refusal).toContain(GENERATED_PATH);
  });

  it('allows a staged bundles.generated.ts and a staged .gitattributes', () => {
    expect(
      bundleCommitRefusal({
        ...EMPTY,
        staged: [
          entry('modified', 'packages/board/src/contract/bundles.generated.ts', OTHER),
          entry('modified', '.gitattributes', OTHER),
        ],
      }),
    ).toBeNull();
  });

  it.each([
    ['the merge base is unreadable', { mergeBase: null }],
    ['the merge base entries are unreadable', { atMergeBase: null }],
    ['the path was not read', { atMergeBase: {} }],
  ] as const)('refuses with no repair line when %s', (_name, broken) => {
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      ...broken,
      staged: [entry('modified', GENERATED_PATH, SAME)],
    });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain(GENERATED_PATH);
    expect(refusal).not.toContain('git rm');
    expect(refusal).not.toContain('git restore');
  });

  it('adds the merge-first line on a branch behind origin/main with no merge in progress', () => {
    const behind = { ...EMPTY, mainTip: MAIN, staged: [entry('modified', GENERATED_PATH, OTHER)] };
    expect(bundleCommitRefusal(behind)).toContain('git merge origin/main');
    expect(bundleCommitRefusal({ ...behind, merging: true })).not.toContain('git merge origin/main');
    expect(bundleCommitRefusal({ ...behind, mainTip: BASE })).not.toContain('git merge origin/main');
  });

  it('allows a staged bundle when the generated set is empty, as in a repository with no build.mjs', () => {
    expect(
      bundleCommitRefusal({ ...EMPTY, generated: [], staged: [entry('modified', GENERATED_PATH, OTHER)] }),
    ).toBeNull();
  });

  it('refuses a new bundle the generated set declares, with a git rm repair', () => {
    const born = 'skills/plot/scripts/board/plot-ninth.mjs';
    const refusal = bundleCommitRefusal({
      ...EMPTY,
      generated: [GENERATED_PATH, born],
      atMergeBase: { [born]: null },
      staged: [entry('added', born)],
    });
    expect(refusal).toContain(`git rm --cached ${born}`);
  });

  it('allows a staged path that touches no generated set at all', () => {
    expect(
      bundleCommitRefusal({ ...EMPTY, staged: [entry('added', 'packages/domain/src/rules/bundle-commit.ts')] }),
    ).toBeNull();
  });
});

describe('bundleCommitTouches', () => {
  it('skips a staged .gitattributes and an equal copy beside a differing one', () => {
    const second = 'skills/plot/scripts/board/plot-ask.mjs';
    const touches = bundleCommitTouches({
      ...EMPTY,
      generated: [GENERATED_PATH, second],
      atMergeBase: { [GENERATED_PATH]: { mode: '100644', sha: SAME }, [second]: { mode: '100644', sha: SAME } },
      staged: [
        entry('modified', '.gitattributes'),
        entry('modified', GENERATED_PATH, SAME),
        entry('modified', second, OTHER),
      ],
    });
    expect(touches.map((touch) => touch.path)).toEqual([second]);
  });
});

describe('bundleCommitPaths', () => {
  it('names only the staged paths the generated set declares, in staged order', () => {
    const second = 'skills/plot/scripts/board/plot-ask.mjs';
    expect(
      bundleCommitPaths({
        generated: [second, GENERATED_PATH],
        staged: [
          entry('modified', GENERATED_PATH),
          entry('modified', 'skills/plot/scripts/board/README.md'),
          entry('added', second),
        ],
      }),
    ).toEqual([GENERATED_PATH, second]);
  });

  it('leaves out bundles.generated.ts and .gitattributes even when the set names them', () => {
    expect(
      bundleCommitPaths({
        generated: ['packages/board/src/contract/bundles.generated.ts', '.gitattributes'],
        staged: [
          entry('modified', 'packages/board/src/contract/bundles.generated.ts'),
          entry('modified', '.gitattributes'),
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
