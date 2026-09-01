import type { Worktree } from '../../entities/worktree.js';
import { answered, failed } from '../../port-result.js';
import type { Trees } from '../../ports/trees.js';

/** The desks a fixture `Trees` answers from. */
export interface TreesFixture {
  /**
   * The worktrees this machine holds, git's own order.
   *
   * The FIRST entry is the main checkout, matching what `git worktree list`
   * emits and what `trees-git.ts` derives `isMain` from. Stated as a partial
   * {@link Worktree} per entry so a case that cares only about a branch says
   * only that; every other field takes the reading a real listing gives when
   * it was not asked — `clean: false`, because a tree that was not checked
   * reports unclean and unlanded work stays visible.
   */
  worktrees?: readonly Partial<Worktree>[];
  /**
   * Which paths hold nothing unlanded.
   *
   * A path absent from this set reads unclean, which is the same direction
   * `trees-git.ts` fails in: an uncheckable tree keeps its work visible.
   */
  clean?: readonly string[];
  /**
   * The marker files each path carries, keyed by path.
   *
   * A path absent from the table carries none — an answer, not a failure.
   */
  markers?: Readonly<Record<string, readonly string[]>>;
  /**
   * The branch each checkout is on, keyed by path.
   *
   * A path absent from the table cannot be read at all, which is a FAILURE
   * rather than an empty string: `''` already means a detached HEAD, so a
   * fixture that answered it for an unknown path could not express the
   * difference the port's three outcomes exist to carry. State `''` explicitly
   * for a detached checkout.
   */
  branches?: Readonly<Record<string, string>>;
}

/**
 * Answers worktree questions from a table instead of git.
 *
 * The driven-side twin of `treesGit`: same port, no machine behind it. A
 * caller holding this needs no repository and no `git worktree add`, which is
 * what lets a test assert on a fleet of six desks in a process that owns one.
 *
 * It reads no environment. Everything it answers was decided when it was
 * constructed.
 *
 * @param fixture - the desks, their cleanliness, markers and branches.
 * @returns a `Trees` backed by that fixture.
 */
export const treesFixture = (fixture: TreesFixture = {}): Trees => {
  const clean = new Set(fixture.clean ?? []);
  const markers = fixture.markers ?? {};
  const branches = fixture.branches ?? {};
  const worktrees: readonly Worktree[] = (fixture.worktrees ?? []).map((tree, at) => ({
    path: tree.path ?? '',
    branch: tree.branch ?? '',
    isMain: tree.isMain ?? at === 0,
    clean: tree.clean ?? clean.has(tree.path ?? ''),
    agentSession: tree.agentSession ?? null,
    prunable: tree.prunable ?? false,
  }));

  return {
    list: async () => answered(worktrees),

    forBranch: async (branch) =>
      answered(worktrees.find((tree) => tree.branch === branch) ?? null),

    isClean: async (path) => answered(clean.has(path)),

    markers: async (path, prefix) =>
      answered((markers[path] ?? []).filter((name) => name.startsWith(prefix))),

    currentBranch: async (path) => {
      const branch = branches[path];
      return branch === undefined ? failed<string>() : answered(branch);
    },
  };
};
