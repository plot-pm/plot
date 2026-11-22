import {
  baseBranchFile,
  baseRepairFile,
  defaultBranchFile,
  repairRecordFile,
  stateHomeAtSync,
} from '@plot-pm/domain/adapters';
import type { StateHomeAnswer } from '@plot-pm/domain';
import { failed } from '@plot-pm/domain';
import type { DefaultBranchStore } from '@plot-pm/domain/ports/default-branch';
import type { RepairRecordStore } from '@plot-pm/domain/ports/repair-record';

/** Where a process finds its repository, and the state home it resolved at start. */
export interface StateHomeOptions {
  repoRoot: string;
  /** The state home resolved at start. Absent means resolved from `repoRoot` on first use. */
  stateHome?: StateHomeAnswer;
}

/**
 * The state home of the repository the options name.
 *
 * @param opts - the repository root, and the home resolved at start, if any.
 * @returns the held answer, or {@link stateHomeAtSync} over `repoRoot`.
 */
export const stateHomeFor = (opts: StateHomeOptions): StateHomeAnswer => opts.stateHome ?? stateHomeAtSync(opts.repoRoot);

/** A default-branch store over no file: every read and write fails. */
const unreadDefaultBranch: DefaultBranchStore = {
  read: async () => failed(),
  write: async () => failed<void>(),
};

/** A repair record store over no file: every read and write fails. */
const unreadRepairRecord: RepairRecordStore = {
  read: async () => failed(),
  write: async () => failed<void>(),
};

/**
 * The default-branch reading's store under a state home.
 *
 * @param answer - the resolved state home.
 * @returns the file store, or a store whose reads fail where the home is unread.
 */
export const defaultBranchIn = (answer: StateHomeAnswer): DefaultBranchStore =>
  'home' in answer ? defaultBranchFile(answer.home) : unreadDefaultBranch;

/**
 * The repair record's store under a state home.
 *
 * @param answer - the resolved state home.
 * @returns the file store, or a store whose reads fail where the home is unread.
 */
export const repairRecordIn = (answer: StateHomeAnswer): RepairRecordStore =>
  'home' in answer ? repairRecordFile(answer.home) : unreadRepairRecord;

/**
 * A base branch reading's store under a state home.
 *
 * @param answer - the resolved state home.
 * @param base - the base branch.
 * @returns the file store, or a store whose reads fail where the home is unread.
 */
export const baseBranchIn = (answer: StateHomeAnswer, base: string): DefaultBranchStore =>
  'home' in answer ? baseBranchFile(answer.home, base) : unreadDefaultBranch;

/**
 * A base branch repair record's store under a state home.
 *
 * @param answer - the resolved state home.
 * @param base - the base branch.
 * @returns the file store, or a store whose reads fail where the home is unread.
 */
export const baseRepairIn = (answer: StateHomeAnswer, base: string): RepairRecordStore =>
  'home' in answer ? baseRepairFile(answer.home, base) : unreadRepairRecord;
