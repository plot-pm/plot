import type { FleetPulse } from '../../entities/fleet.js';
import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type { MergeStatus, Refs } from '../../ports/refs.js';

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
   * The fleet's whole state.
   *
   * Absent means the scan cannot be asked at all rather than that it answered
   * with nothing — an estate with no pulse is `unaskable`, which is what stops
   * a fixture that forgot to state one from reading as an empty fleet.
   */
  pulse?: FleetPulse;
}

/** What a fixture reports when it was not told a default branch. */
const DEFAULT_BRANCH = 'main';

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
      fixture.pulse === undefined ? unaskable<FleetPulse>() : answered(fixture.pulse),

    showFile: async (ref, path) => {
      const content = files[`${ref}:${path}`];
      return content === undefined ? failed<string>() : answered(content);
    },
  };
};
