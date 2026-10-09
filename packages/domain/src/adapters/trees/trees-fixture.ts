import type { Worktree } from '../../entities/worktree.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import type { Trees } from '../../ports/trees.js';
import type { TreePresence } from '../../rules/reapable.js';
import type { CommitReading } from '../../rules/sample.js';

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
   * The paths each worktree holds on the floor, keyed by path.
   *
   * Already FILTERED, as the port returns them: a fixture states what the
   * caller would see, not what `git status` printed before the exclusions ran.
   * A test that wants to prove the filter itself needs the git adapter, since
   * the filter lives in the shell and a fixture cannot stand in for it.
   *
   * A path absent from the table holds nothing — an answer, not a failure,
   * which is the same direction {@link markers} answers in.
   */
  dirty?: Readonly<Record<string, readonly string[]>>;
  /**
   * The porcelain lines {@link dirtyPathsWithStatus} would read, keyed by
   * path, status code included (`?? half-done.txt`). A path absent from the
   * table holds none.
   */
  dirtyWithStatus?: Readonly<Record<string, readonly string[]>>;
  /**
   * The unfiltered changed paths each checkout holds, keyed by path; read by
   * `changedUnder`, which answers those under a given pathspec. A path absent
   * from the table holds none.
   */
  changed?: Readonly<Record<string, readonly string[]>>;
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
  /**
   * What `aheadOfUpstream` answers, keyed by path. A path absent from the
   * table has no upstream, which `aheadOfUpstream` answers as `failed`.
   */
  ahead?: Readonly<Record<string, number>>;
  /**
   * The `user.email` each checkout reports, keyed by path. A path absent from
   * the table has none configured, which `userEmail` answers as `failed`.
   */
  emails?: Readonly<Record<string, string>>;
  /**
   * What each checkout reports as changed, keyed by path.
   *
   * The porcelain text verbatim, so a caller comparing two readings can see a
   * tree change while staying dirty. A path absent from the table reports `''`
   * — nothing changed — which is the same direction {@link TreesFixture.clean}
   * takes for a path it was told about.
   */
  statuses?: Readonly<Record<string, string>>;
  /**
   * Seconds since the newest change in each tree, keyed by path. A path absent
   * from the table reads `null` — nothing to read — and `null` is also how a
   * test states an unreadable tree.
   */
  quiet?: Readonly<Record<string, number | null>>;
  /**
   * What `hasCommits` answers, keyed by path. A path absent from the table
   * reads `unanswerable`, the direction the git adapter fails in.
   */
  commits?: Readonly<Record<string, CommitReading>>;
  /**
   * What `commitBeyondClaim` answers, keyed by path. A path absent from the
   * table reads `unanswerable`, the direction the git adapter fails in.
   */
  claimCommits?: Readonly<Record<string, CommitReading>>;
  /** Paths where `resetOnto` refuses — the checkout-failure case. */
  resetRefusedAt?: readonly string[];
  /** Paths where `removeOnly` refuses — the git-level removal failure case. */
  removeRefusedAt?: readonly string[];
  /** Branches where `deleteBranch` refuses. */
  deleteRefusedFor?: readonly string[];
  /**
   * What `unpushedCommits` answers, keyed by path. A path absent from the
   * table reads `failed`, the direction the git adapter fails in.
   */
  unpushed?: Readonly<Record<string, readonly string[]>>;
  /**
   * What `unpushedPatches` answers, keyed by path. A path absent from the
   * table reads `failed`, the direction the git adapter fails in.
   */
  unpushedPatches?: Readonly<Record<string, readonly string[]>>;
  /** Paths where `commit` fails. */
  commitFailsAt?: readonly string[];
  /** Paths where `push` fails. */
  pushFailsAt?: readonly string[];
  /**
   * Which paths {@link hasStagedChanges} answers `true` for. A path absent
   * from the set answers `false` — nothing staged — matching a fresh
   * checkout rather than an unreadable one.
   */
  staged?: readonly string[];
  /** Paths where `hasStagedChanges` fails outright — git could not be asked. */
  stagedCheckFailsAt?: readonly string[];
  /** Paths where `commitAs` fails. */
  commitAsFailsAt?: readonly string[];
  /** Every call received, for a test to assert against. */
  calls?: {
    resets: { path: string; branch: string; base: string }[];
    commits: { path: string; message: string }[];
    pushes: { path: string; branch: string }[];
    commitsAs: { path: string; who: string; message: string }[];
  };
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
 * @param fixture - the desks, their cleanliness, markers, dirty paths and branches.
 * @returns a `Trees` backed by that fixture.
 */
export const treesFixture = (fixture: TreesFixture = {}): Trees => {
  const clean = new Set(fixture.clean ?? []);
  const markers = fixture.markers ?? {};
  const dirty = fixture.dirty ?? {};
  const branches = fixture.branches ?? {};
  const statuses = fixture.statuses ?? {};
  const worktrees: readonly Worktree[] = (fixture.worktrees ?? []).map((tree, at) => ({
    path: tree.path ?? '',
    branch: tree.branch ?? '',
    // A FIXTURE STATES WHAT IT MEANS. `detached` defaults false rather than
    // being inferred from an empty branch: the adapter reads git's own
    // `detached` line and never infers, so a fixture that inferred would be
    // testing against a rule the production reader does not apply.
    detached: tree.detached ?? false,
    isMain: tree.isMain ?? at === 0,
    clean: tree.clean ?? clean.has(tree.path ?? ''),
    agentSession: tree.agentSession ?? null,
    prunable: tree.prunable ?? false,
  }));

  return {
    list: async () => answered(worktrees),

    forBranch: async (branch) =>
      answered(worktrees.find((tree) => tree.branch === branch) ?? null),

    // The same derivation the git adapter makes, from the same field, so a
    // fixture can trigger `vanished` without a directory to delete.
    presence: async (branch) => {
      const tree = worktrees.find((each) => each.branch === branch);
      if (tree === undefined) return answered<TreePresence>('absent');
      return answered<TreePresence>(tree.prunable ? 'vanished' : 'present');
    },

    isClean: async (path) => answered(clean.has(path)),

    markers: async (path, prefix) =>
      answered((markers[path] ?? []).filter((name) => name.startsWith(prefix))),

    dirtyPaths: async (path) => answered(dirty[path] ?? []),
    dirtyPathsWithStatus: async (path) => answered(fixture.dirtyWithStatus?.[path] ?? []),
    changedUnder: async (path, pathspecs) =>
      answered((fixture.changed?.[path] ?? []).filter((file) => pathspecs.some((spec) => file.startsWith(spec)))),

    quietSeconds: async (path) => answered<number | null>(fixture.quiet?.[path] ?? null),

    hasCommits: async (path) =>
      answered<CommitReading>(fixture.commits?.[path] ?? 'unanswerable'),

    commitBeyondClaim: async (path) =>
      answered<CommitReading>(fixture.claimCommits?.[path] ?? 'unanswerable'),

    currentBranch: async (path) => {
      const branch = branches[path];
      return branch === undefined ? failed<string>() : answered(branch);
    },

    aheadOfUpstream: async (path) => {
      const count = fixture.ahead?.[path];
      return count === undefined ? failed<number>() : answered(count);
    },

    userEmail: async (path) => {
      const email = fixture.emails?.[path];
      return email === undefined ? failed<string>() : answered(email);
    },

    // Both writes SUCCEED and change nothing. A fixture holds no git records to
    // prune and no filesystem to add to, and answering `failed` would make
    // every caller take its error path against an estate that is fine.
    prune: async () => answered(undefined),

    add: async () => answered(undefined),

    addBranch: async () => answered(undefined),

    removeWithBranch: async () => answered(undefined),

    removeOnly: async (path): Promise<PortResult<void>> =>
      (fixture.removeRefusedAt ?? []).includes(path) ? failed<void>() : answered(undefined),

    deleteBranch: async (branch): Promise<PortResult<void>> =>
      (fixture.deleteRefusedFor ?? []).includes(branch) ? failed<void>() : answered(undefined),

    unpushedCommits: async (path): Promise<PortResult<readonly string[]>> => {
      const shas = fixture.unpushed?.[path];
      return shas === undefined ? failed<readonly string[]>() : answered(shas);
    },

    unpushedPatches: async (path): Promise<PortResult<readonly string[]>> => {
      const shas = fixture.unpushedPatches?.[path];
      return shas === undefined ? failed<readonly string[]>() : answered(shas);
    },

    statusSync: (path) => answered(statuses[path] ?? ''),

    listSync: () => answered(worktrees),

    resetOnto: async (path, branch, base): Promise<PortResult<void>> => {
      if ((fixture.resetRefusedAt ?? []).includes(path)) return failed<void>();
      fixture.calls?.resets.push({ path, branch, base });
      return answered(undefined);
    },

    commit: async (path, message): Promise<PortResult<void>> => {
      if ((fixture.commitFailsAt ?? []).includes(path)) return failed<void>();
      fixture.calls?.commits.push({ path, message });
      return answered(undefined);
    },

    push: async (path, branch): Promise<PortResult<void>> => {
      if ((fixture.pushFailsAt ?? []).includes(path)) return failed<void>();
      fixture.calls?.pushes.push({ path, branch });
      return answered(undefined);
    },

    hasStagedChanges: async (path): Promise<PortResult<boolean>> => {
      if ((fixture.stagedCheckFailsAt ?? []).includes(path)) return failed<boolean>();
      return answered((fixture.staged ?? []).includes(path));
    },

    commitAs: async (path, who, message): Promise<PortResult<void>> => {
      if ((fixture.commitAsFailsAt ?? []).includes(path)) return failed<void>();
      fixture.calls?.commitsAs.push({ path, who, message });
      return answered(undefined);
    },
  };
};
