import type { PrIndexRow } from '../entities/pr-index.js';
import { isEmptyClaim, type CommitReading } from './empty-claim.js';
import { REPAIR_BRANCH_SHA_LENGTH } from './repair-pr.js';

/** How long a head that no agent owns must stand before the fixer acts on it, in milliseconds. */
export const PERSON_QUIET_MS = 3_600_000;

/** The head-branch prefix of a release PR. */
const RELEASE_PREFIX = 'changeset-release/';

/** The head-branch prefix of a plan PR. */
const PLAN_PREFIX = 'idea/';

/** The head branches the repair and revert roles own. */
const REPAIR_OWNED = [
  new RegExp(`^bug/main-repair-[0-9a-f]{${REPAIR_BRANCH_SHA_LENGTH}}$`),
  new RegExp(`^bug/sprint-repair-[0-9a-f]{${REPAIR_BRANCH_SHA_LENGTH}}$`),
  /^bug\/revert-[1-9][0-9]*$/,
];

/** Who owns a PR's head branch, as {@link fixerOwner} answers it. */
export type FixerOwner = 'desk' | 'none' | 'unread';

/** One claim-range commit: a {@link CommitReading} with its committer time in epoch milliseconds. */
export type ClaimCommit = CommitReading & { readonly at: number };

/** What {@link fixerOwner} reads, as values. */
export interface FixerOwnerInput {
  /** Whether a worktree on this machine holds the branch; `unread` where the listing failed. */
  readonly worktree: 'here' | 'absent' | 'unread';
  /** Whether a registry manifest names the branch; `unread` where the registry could not be read. */
  readonly manifest: boolean | 'unread';
  /** The commits of `origin/<base>..origin/<head>`; `unread` where the range could not be read. */
  readonly claims: readonly ClaimCommit[] | 'unread';
  /** `Claim stale after`, in milliseconds; `null` where the key does not parse, so a claim never goes stale. */
  readonly claimStaleMs: number | null;
  /** Epoch milliseconds of the tick. */
  readonly now: number;
}

/**
 * Who owns a PR's head branch.
 *
 * Only fleet evidence makes `desk`: a registry manifest naming the branch, or
 * an empty claim marker ({@link isEmptyClaim}) on the base-to-head range. A
 * worktree on this machine is not evidence by itself. A claimed branch with
 * no worktree here and no manifest answers `none` once its newest claim
 * marker is at least `claimStaleMs` old.
 *
 * @param input - the readings, as values.
 * @returns `unread` where any reading failed, `desk` where fleet evidence
 *   holds, and `none` otherwise.
 */
export const fixerOwner = (input: FixerOwnerInput): FixerOwner => {
  const { worktree, manifest, claims, claimStaleMs, now } = input;
  if (worktree === 'unread' || manifest === 'unread' || claims === 'unread') return 'unread';
  if (manifest) return 'desk';
  const markers = claims.filter(isEmptyClaim);
  if (markers.length === 0) return 'none';
  if (worktree === 'here' || claimStaleMs === null) return 'desk';
  const newest = Math.max(...markers.map((marker) => marker.at));
  return now - newest >= claimStaleMs ? 'none' : 'desk';
};

/**
 * Parses `Claim stale after` into milliseconds.
 *
 * @param hours - the configured value, in hours.
 * @returns the bound, or `null` where the value is not a positive number.
 */
export const claimStaleMsOf = (hours: string): number | null => {
  const value = Number(hours.trim());
  return hours.trim() !== '' && Number.isFinite(value) && value > 0 ? value * 3_600_000 : null;
};

/** Why a PR is outside the fixer's scope. */
export type FixerScopeOut =
  | 'no-row'
  | 'not-open'
  | 'draft'
  | 'release-pr'
  | 'plan-pr'
  | 'repair-owned'
  | 'base-unread'
  | 'base-out-of-scope'
  | 'owner-unread'
  | 'head-age-unread'
  | 'person-pushed-recently';

/** What {@link fixerScope} answers. */
export type FixerScopeAnswer =
  | { readonly in: true; readonly owner: 'desk' | 'none' }
  | { readonly in: false; readonly why: Exclude<FixerScopeOut, 'person-pushed-recently'> }
  | { readonly in: false; readonly why: 'person-pushed-recently'; readonly leftMs: number };

/** What {@link fixerScope} reads, as values. */
export interface FixerScopeInput {
  /** The PR's OPEN row; `null` where the store has none. */
  readonly row: PrIndexRow | null;
  /** The default branch's name; absent or `''` where it is unread. */
  readonly defaultBranchName?: string;
  /** The owner of the head branch, from {@link fixerOwner}. */
  readonly owner: FixerOwner;
  /** Whether the fixer's attempts record proves it pushed the row's current head. */
  readonly pushedHead: boolean;
  /** Epoch milliseconds of the tick. */
  readonly now: number;
}

/**
 * The checks of {@link fixerScope} that read the row alone, before the owner.
 *
 * In order: `no-row`, `not-open`, `draft`, `release-pr` (a head under
 * `changeset-release/`), `plan-pr` (a head under `idea/`), `repair-owned`
 * (`bug/main-repair-<12 hex>`, `bug/sprint-repair-<12 hex>`,
 * `bug/revert-<n>`), `base-unread` (no `base` on the row, or no default branch
 * name), `base-out-of-scope` (a base that is neither the default branch nor a
 * `sprint/` branch). A fork PR is not told apart: the row carries no head
 * repository.
 *
 * @param row - the PR's OPEN row, or `null`.
 * @param defaultBranchName - the default branch's name; absent or `''` where unread.
 * @returns the first reason the row is out, or `null` where it passes.
 */
export const fixerScopeRow = (
  row: PrIndexRow | null,
  defaultBranchName: string | undefined,
): Exclude<FixerScopeOut, 'owner-unread' | 'head-age-unread' | 'person-pushed-recently'> | null => {
  if (row === null) return 'no-row';
  if (row.state !== 'OPEN') return 'not-open';
  if (row.draft) return 'draft';
  if (row.head.startsWith(RELEASE_PREFIX)) return 'release-pr';
  if (row.head.startsWith(PLAN_PREFIX)) return 'plan-pr';
  if (REPAIR_OWNED.some((pattern) => pattern.test(row.head))) return 'repair-owned';
  if (row.base === undefined || row.base === '' || defaultBranchName === undefined || defaultBranchName === '') return 'base-unread';
  if (row.base !== defaultBranchName && !row.base.startsWith('sprint/')) return 'base-out-of-scope';
  return null;
};

/**
 * Whether the fleet's fixer acts on a PR, and who owns its head.
 *
 * Applies {@link fixerScopeRow}, then: `owner-unread` where the owner reading
 * failed. For `owner: 'none'` with a head the fixer did not push,
 * `head-age-unread` where `headSince` is absent or does not parse, and
 * `person-pushed-recently` with the time left where the head is less than
 * {@link PERSON_QUIET_MS} old. A head the fixer pushed, or a branch an agent
 * owns, skips the hour.
 *
 * @param input - the readings, as values.
 * @returns `{ in: true, owner }`, or `{ in: false, why }` with the first reason.
 */
export const fixerScope = (input: FixerScopeInput): FixerScopeAnswer => {
  const { row, defaultBranchName, owner, pushedHead, now } = input;
  const out = fixerScopeRow(row, defaultBranchName);
  if (out !== null) return { in: false, why: out };
  if (owner === 'unread') return { in: false, why: 'owner-unread' };
  if (owner === 'desk' || pushedHead) return { in: true, owner };
  const since = row?.headSince === undefined ? Number.NaN : Date.parse(row.headSince);
  if (!Number.isFinite(since)) return { in: false, why: 'head-age-unread' };
  const age = now - since;
  if (age < PERSON_QUIET_MS) return { in: false, why: 'person-pushed-recently', leftMs: PERSON_QUIET_MS - age };
  return { in: true, owner };
};
