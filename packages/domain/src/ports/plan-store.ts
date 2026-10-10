import type { PortResult } from '../port-result.js';

/**
 * One plan file, as the plan parser reports it.
 *
 * Field names follow the parser's JSON rather than the domain's casing: this
 * is the wire shape an adapter hands over, and a rename here would be a second
 * spelling of the format contract.
 */
export interface PlanRecord {
  /** The path the plan was read from, relative to the repository root. */
  file: string;
  /** `canonical`, `frontmatter`, or `none` for a file that is not a plan. */
  format: string;
  /**
   * The phase, normalized: `draft`, `approved`, `delivered`, `released`,
   * `rejected`, `superseded`, or one of two absences.
   *
   * `NONE` means the file stated no phase and `UNKNOWN` means it stated one
   * this parser does not recognise. They are kept apart for the reason every
   * three-valued answer in Plot is: a file with no phase is not a plan —
   * `docs/plans/` also holds decision logs and worker reports — while an
   * unrecognised phase is a plan somebody mis-spelled.
   */
  phase: string;
  /** The phase as written in the file. */
  phaseRaw: string;
  /** The plan's type — `feature`, `bug`, `docs`, `infra`. */
  type: string;
  /** The plan's title, from its first heading. */
  title: string;
  /** The sprint slug the plan is a member of, or `''`. */
  sprint: string;
  /** The story slug the plan belongs to, or `''`. */
  story: string;
  /** The person accountable for the plan, or `''`. */
  assignee: string;
  /** Every branch the plan names, across all of its slices. */
  branches: readonly string[];
  /** Every PR number the plan's branch lines annotate. */
  prs: readonly number[];
  /** The PR numbers a deferred branch line or slice heading annotates; each is also in {@link prs}. */
  deferredPrs: readonly number[];
  /** The plan's slices, in the order the file declares them. */
  slices: readonly PlanRecordSlice[];
  /** The declared review channel — `pr`, `in-session`, `ballot`, `none`. */
  review: string;
  /** The declared implementation home, normalized. */
  impl: string;
  /** The `Approved:` record verbatim, or `''`. */
  approvedRaw: string;
  /** The `Delivered:` record verbatim, or `''`. */
  deliveredRaw: string;
  /** The `Released:` record verbatim, or `''`. */
  releasedRaw: string;
  /** Every `Started:` record verbatim, in file order. */
  startedRaw: readonly string[];
}

/** One slice of a plan, holding the branches it wants landed together. */
export interface PlanRecordSlice {
  /** The slice's name, from its `### ` heading. */
  name: string;
  /** The branches the slice names. */
  branches: readonly PlanRecordBranch[];
}

/** One branch line inside a slice. */
export interface PlanRecordBranch {
  /** The branch name. */
  branch: string;
  /** Whether the plan gave the branch up rather than finishing it. */
  deferred: boolean;
  /** Why it was deferred; `''` when it was not. */
  deferredReason: string;
  /** The claim annotation the plan carries, or `''`. */
  claimed: string;
  /** Every branch this one's `<!-- waits: ... -->` annotation names, empty where it names none. */
  waitsOn: readonly string[];
}

/**
 * Reads and writes the plan, story and sprint files — the STATED source of
 * truth — and the other repository files a lifecycle write edits beside them,
 * such as `.plot/hold`.
 *
 * Every operation answers about files on disk. A file that is not a plan is
 * answered rather than refused: `format: 'none'` is a reading, and a caller
 * that filters on it is doing so knowingly.
 *
 * A path may be absolute or relative to the repository root. A lifecycle write
 * edits a booking worktree beside the repository, so it names absolute paths.
 */
export interface PlanStore {
  /**
   * Reads one plan file.
   *
   * @param file - the plan's path, relative to the repository root.
   * @returns the parsed plan, or a failure when the file cannot be read.
   */
  readPlan(file: string): Promise<PortResult<PlanRecord>>;

  /**
   * Reads many plan files in one call.
   *
   * Batched because the parser accepts many paths per invocation, and one
   * process per plan prices the parser out of ambient use.
   *
   * @param files - the plans' paths, relative to the repository root.
   * @returns one record per readable file, in the order the parser emits them.
   */
  readPlans(files: readonly string[]): Promise<PortResult<readonly PlanRecord[]>>;

  /**
   * Lists every plan file the repository holds.
   *
   * @returns the paths, relative to the repository root.
   */
  listPlans(): Promise<PortResult<readonly string[]>>;

  /**
   * Reads one `## Plot Config` key.
   *
   * Configuration is read and never written: a value that changes without a
   * person editing it is state, and state does not live in this file.
   *
   * @param key - the key's name as it appears in the config section.
   * @param fallback - what to answer with when the key is absent.
   * @returns the configured value, or `fallback`.
   */
  config(key: string, fallback: string): Promise<PortResult<string>>;

  /**
   * Lists the entries of one directory.
   *
   * @param dir - the directory, absolute or relative to the repository root.
   * @returns the entry names in name order; empty where the directory does not
   *   exist, because a lifecycle write treats a missing directory and an empty
   *   one alike.
   */
  listDir(dir: string): Promise<PortResult<readonly string[]>>;

  /**
   * Reads one file's text.
   *
   * @param file - the file, absolute or relative to the repository root.
   * @returns the content, or null where the file does not exist; a failure
   *   where it exists and cannot be read.
   */
  readText(file: string): Promise<PortResult<string | null>>;

  /**
   * Writes one file whole or not at all.
   *
   * Writes a sibling temporary file and renames it over the target, so a reader
   * never observes a half-written file. Creates missing parent directories.
   *
   * @param file - the file, absolute or relative to the repository root.
   * @param content - the complete new content.
   * @returns nothing; a failure means the target holds its previous content.
   */
  writeText(file: string, content: string): Promise<PortResult<void>>;
}
