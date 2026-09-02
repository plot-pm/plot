import type { FleetReading } from '../../entities/fleet.js';
import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type {
  BranchDate,
  BranchTip,
  CommitLine,
  MergeStatus,
  RefScope,
  RefState,
  Refs,
  TreeBlob,
} from '../../ports/refs.js';

/** The estate a fixture `Refs` answers from. */
export interface RefsFixture {
  /** The default branch this estate reports. */
  defaultBranch?: string;
  /** The local branches. */
  branches?: readonly string[];
  /** The `origin/*` branches; absent means the same list as {@link branches}. */
  remoteBranches?: readonly string[];
  /**
   * The branches this estate reports as merged.
   *
   * Anything absent from the set reads `not-merged`. A branch that must read
   * `unknown` — the answer that keeps an unreadable ref from being reported as
   * a claim — is stated in {@link unknownMerge} instead, because a set alone
   * cannot express the difference between *no* and *cannot say*.
   */
  merged?: readonly string[];
  /** The branches whose merge status this estate cannot read. */
  unknownMerge?: readonly string[];
  /** Ref name to commit sha. A ref absent from the table cannot be resolved. */
  shas?: Readonly<Record<string, string>>;
  /** Branch name to the files it changed. */
  changedFiles?: Readonly<Record<string, readonly string[]>>;
  /** `<ref>:<path>` to that file's content at that ref. */
  files?: Readonly<Record<string, string>>;
  /**
   * The blobs each ref's tree holds, keyed by ref.
   *
   * Stated as full {@link TreeBlob}s rather than as paths, because the mode is
   * what separates a file from the symlink pointing at it and a fixture that
   * could not express a `120000` entry could not stand in for git on the one
   * question the listing exists to answer.
   */
  trees?: Readonly<Record<string, readonly TreeBlob[]>>;
  /** Object name to the blob's content, for {@link Refs.readBlobs}. */
  blobs?: Readonly<Record<string, string>>;
  /** Branch name to its tip sha, for {@link Refs.branchTips}. */
  tips?: Readonly<Record<string, string>>;
  /** The repository's top-level path; absent means it cannot be resolved. */
  repoRoot?: string;
  /**
   * How far the checkout sits behind each ref.
   *
   * A ref absent from the table answers `null` — *the question has no answer
   * here* — which is what a detached HEAD reports and is deliberately not the
   * same reading as zero.
   */
  behind?: Readonly<Record<string, number>>;
  /**
   * The fleet's whole state.
   *
   * Absent means the scan cannot be asked at all rather than that it answered
   * with nothing — an estate with no pulse is `unaskable`, which is what stops
   * a fixture that forgot to state one from reading as an empty fleet.
   */
  pulse?: FleetReading;
  /**
   * Whether git can be asked about this estate at all.
   *
   * Defaults to true. `false` is the plain-directory case every unit test
   * builds — an estate with no refs, which is a different answer from one whose
   * refs could not be read.
   */
  isRepository?: boolean;
  /**
   * How far ahead of its remote each local branch sits.
   *
   * A branch absent from the table is a FAILED reading rather than zero: zero
   * reads as *nothing to push*, which is a claim, and no local ref is not one.
   */
  ahead?: Readonly<Record<string, number>>;
  /** Path to the object name a hash of that file would produce. */
  oids?: Readonly<Record<string, string>>;
  /** Branch name to its tip's committer date, as epoch seconds. */
  committedAt?: Readonly<Record<string, number>>;
  /** Remote name to its configured URL. */
  remotes?: Readonly<Record<string, string>>;
  /** `<dir>\0<range>` to the commits that range holds, newest first. */
  commits?: Readonly<Record<string, readonly CommitLine[]>>;
}

/** What a fixture reports when it was not told a default branch. */
const DEFAULT_BRANCH = 'main';

/**
 * Whether a full ref pattern names a remote branch.
 *
 * The patterns a caller passes are git's own — `refs/remotes/origin/idea/*` —
 * so the fixture strips the prefix it holds branches under and compares what is
 * left. A trailing `*` matches any suffix, which is the only wildcard
 * `for-each-ref` patterns use here.
 *
 * @param pattern - the full ref pattern.
 * @param branch - the branch name, without a remote prefix.
 * @returns true where git would have listed this branch for this pattern.
 */
const matchesRef = (pattern: string, branch: string): boolean => {
  const prefix = 'refs/remotes/origin/';
  if (!pattern.startsWith(prefix)) return false;
  const wanted = pattern.slice(prefix.length);
  return wanted.endsWith('*')
    ? branch.startsWith(wanted.slice(0, -1))
    : branch === wanted;
};

/**
 * Answers ref questions from a table instead of git.
 *
 * An adapter like any other: the same port, a different world behind it. It is
 * on the DRIVEN side deliberately — nothing above the ports is told a mock
 * exists, so a controller written against `Refs` serves fixtures or the real
 * estate depending only on which adapter was constructed.
 *
 * It reads no environment. The estate is the argument, which is what lets a
 * caller hold exactly the estate it built regardless of what any global says.
 *
 * The three-valued merge answer is preserved rather than flattened: a fixture
 * that could only say merged or not could not stand in for git, whose
 * unreadable-refs case is the one `MergeStatus` exists for.
 *
 * @param fixture - the refs, branches and pulse this estate holds.
 * @returns a `Refs` backed by that fixture.
 */
export const refsFixture = (fixture: RefsFixture = {}): Refs => {
  const branches = fixture.branches ?? [];
  const remoteBranches = fixture.remoteBranches ?? branches;
  const merged = new Set(fixture.merged ?? []);
  const unknownMerge = new Set(fixture.unknownMerge ?? []);
  const shas = fixture.shas ?? {};
  const changedFiles = fixture.changedFiles ?? {};
  const files = fixture.files ?? {};
  const trees = fixture.trees ?? {};
  const blobs = fixture.blobs ?? {};
  const tips = fixture.tips ?? {};
  const behind = fixture.behind ?? {};
  const ahead = fixture.ahead ?? {};
  const oids = fixture.oids ?? {};
  const committedAt = fixture.committedAt ?? {};
  const remotes = fixture.remotes ?? {};
  const commits = fixture.commits ?? {};

  /**
   * The ref/sha pairs a scope covers, derived from the branches and tips this
   * estate already holds.
   *
   * Derived rather than stated, so a fixture cannot list a branch under
   * `branches` and contradict itself under a second key. A branch with no tip
   * is absent — the estate knows the branch and not what it points at, which
   * is exactly what a ref listing would omit.
   */
  const refState = (scope: RefScope): readonly RefState[] => {
    const pairs: RefState[] = [];
    if (scope !== 'remote') {
      for (const branch of branches) {
        const sha = tips[branch];
        if (sha !== undefined) pairs.push({ ref: `refs/heads/${branch}`, sha });
      }
    }
    if (scope !== 'local') {
      for (const branch of remoteBranches) {
        const sha = tips[branch];
        if (sha !== undefined) pairs.push({ ref: `refs/remotes/origin/${branch}`, sha });
      }
    }
    return pairs;
  };

  return {
    defaultBranch: async () => answered(fixture.defaultBranch ?? DEFAULT_BRANCH),

    listBranches: async (remote) => answered(remote ? remoteBranches : branches),

    isMergedByAncestry: async (branch): Promise<PortResult<MergeStatus>> => {
      if (unknownMerge.has(branch)) return answered<MergeStatus>('unknown');
      return answered<MergeStatus>(merged.has(branch) ? 'merged' : 'not-merged');
    },

    resolve: async (ref) => {
      const sha = shas[ref];
      return sha === undefined ? failed<string>() : answered(sha);
    },

    changedFiles: async (branch) => answered(changedFiles[branch] ?? []),

    pulse: async () =>
      fixture.pulse === undefined ? unaskable<FleetReading>() : answered(fixture.pulse),

    listBlobs: async (ref, dir) =>
      answered((trees[ref] ?? []).filter((blob) => blob.path.startsWith(dir))),

    readBlobs: async (shas) => {
      const found = new Map<string, string>();
      for (const sha of shas) {
        const content = blobs[sha];
        // A sha this estate does not hold is ABSENT, never empty: git answers
        // `<sha> missing` and carries no body, and a fixture that answered ''
        // would make an unreadable object indistinguishable from an empty file.
        if (content !== undefined) found.set(sha, content);
      }
      return answered<ReadonlyMap<string, string>>(found);
    },

    branchTips: async (patterns) => {
      const matched: BranchTip[] = [];
      for (const [branch, sha] of Object.entries(tips)) {
        if (patterns.some((pattern) => matchesRef(pattern, branch))) {
          matched.push({ branch, sha });
        }
      }
      return answered<readonly BranchTip[]>(matched);
    },

    repoRoot: async () =>
      fixture.repoRoot === undefined ? failed<string>() : answered(fixture.repoRoot),

    countBehind: async (ref) => answered<number | null>(behind[ref] ?? null),

    showFile: async (ref, path) => {
      const content = files[`${ref}:${path}`];
      return content === undefined ? failed<string>() : answered(content);
    },

    isRepository: async () => answered(fixture.isRepository ?? true),

    refState: async (scope) => answered(refState(scope)),

    refStateSync: (scope) => answered(refState(scope)),

    countAheadSync: (branch) => {
      const count = ahead[branch];
      return count === undefined ? failed<number>() : answered(count);
    },

    hashFilesSync: (paths) => {
      const found = new Map<string, string>();
      for (const path of paths) {
        const oid = oids[path];
        // ALL OR NOTHING, matching git: `hash-object --stdin-paths` aborts at
        // the first unreadable path, so a fixture that returned the readable
        // subset would let a caller pass a test the real adapter fails.
        if (oid === undefined) return failed<ReadonlyMap<string, string>>();
        found.set(path, oid);
      }
      return answered<ReadonlyMap<string, string>>(found);
    },

    fileExistsSync: (ref, path) => answered(files[`${ref}:${path}`] !== undefined),

    branchDates: async (patterns) =>
      answered<readonly BranchDate[]>(
        Object.entries(committedAt)
          .filter(([branch]) => patterns.some((pattern) => matchesRef(pattern, branch)))
          .map(([branch, at]) => ({ branch, committedAt: at })),
      ),

    // Derived from `merged` rather than stated separately, so one estate cannot
    // answer the two merge questions differently.
    unmergedBranches: async () =>
      answered<readonly string[]>(remoteBranches.filter((branch) => !merged.has(branch))),

    remoteUrl: async (remote) => {
      const url = remotes[remote];
      return url === undefined ? failed<string>() : answered(url);
    },

    commitsSync: (dir, range, max) =>
      answered<readonly CommitLine[]>((commits[`${dir}\0${range}`] ?? []).slice(0, max)),
  };
};
