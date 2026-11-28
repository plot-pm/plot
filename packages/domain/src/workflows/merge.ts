import type { PortResult } from '../port-result.js';
import type { DefaultBranchReading, SettledReading } from '../entities/default-branch.js';
import type { Pr } from '../entities/pr.js';
import type { BuildPort } from '../ports/build.js';
import type { DefaultBranchStore } from '../ports/default-branch.js';
import type { Host, PrConversationReading, PrReviewReading } from '../ports/host.js';
import { checkedReview, reviewPasses } from '../rules/checked-review.js';
import type { Refs } from '../ports/refs.js';
import type { RepairRecordStore } from '../ports/repair-record.js';
import type { ReleaseHoldPersonStore } from '../ports/release-hold-person.js';
import type { PrIndexRow } from '../entities/pr-index.js';
import { holdClock, releasePersonHold } from '../rules/release-hold-person.js';
import type { ReleaseHoldReading } from '../rules/slice-pr-next.js';
import type { Scripts } from '../ports/scripts.js';
import { minHexLenFor } from '../adapters/host/min-hex-len.js';
import { baseBranchRed, declaredRuns, defaultBranchAgeMs, foldRuns, holdsApply } from '../rules/default-branch.js';
import {
  EPISODE_LINE_DEPTH,
  repairEpisode,
  repairMergeVerdict,
  repairRoleOf,
  type RepairMergeReading,
  type RepairMergeRefusal,
  type RepairRole,
  type RepairScope,
} from '../rules/repair-pr.js';
import { humanCommentOpen } from '../rules/human-comment-open.js';
import { mergeChecksVerdict } from '../rules/merge-checks.js';
import { sameCommit } from '../rules/same-commit.js';
import { settledPast, type UnsettledReading } from '../rules/settled-past.js';
import { readUnsettled } from './unsettled-line.js';
import { isSyncPr, mayBeSyncPr, syncPathVerdict, type UnreadSyncGate } from '../rules/state-sync.js';
import type { StateWriteTarget } from '../rules/write-target.js';
import { RELEASE_BRANCH } from '../rules/release-branch.js';
import { SPRINT_BRANCH_PREFIX } from '../rules/slice-base.js';
import type { StateHomeRead } from '../rules/state-home.js';
import { type Caller, type Outcome, decide, refuse } from './decision.js';

/**
 * Why `merge` refused. Each is the end of the action: nothing merges, and no
 * caller retries with the pin dropped.
 */
export type MergeRefusal =
  | 'unattended'
  | 'unaskable'
  | 'pr-not-open'
  | 'head-moved'
  | 'draft'
  | 'checks-not-green'
  | 'checks-unbound'
  | 'default-branch-red'
  | 'base-branch-red'
  | 'default-branch-stale'
  | 'default-branch-unsettled'
  | 'default-branch-unread'
  | 'state-home-unread'
  | 'review-not-passed'
  | 'review-foreign-writer'
  | 'review-writer-unread'
  | 'human-comment-open'
  | 'human-comment-unread'
  | 'release-pr'
  | 'release-waiting'
  | 'sync-path-outside-set'
  | 'sync-diff-unread'
  | 'sync-gate-unread'
  | Exclude<RepairMergeRefusal, 'unaskable'>;

/** What `merge` reads. Every reading is the host's, taken fresh for this call. */
export interface MergeReadings {
  /** Who is asking for the merge; an unattended caller is refused before anything else is read. */
  readonly caller: Caller;
  /**
   * Whether the state home the default-branch and base readings live under was
   * found. `'unaskable'` refuses `state-home-unread` for a PR into the default
   * branch or a `sprint/*` base (see {@link stateHomeGuards}). Absent reads as `'read'`.
   */
  readonly stateHome?: StateHomeRead;
  /**
   * The PR as the host answers now; null where the host holds none, and
   * `'unaskable'` where the host did not answer.
   */
  readonly pr: Pr | null | 'unaskable';
  /**
   * The default branch's CI reading; null where none is recorded, and
   * `'unaskable'` where the read itself failed. A missing, unparseable or
   * other-version file is null and holds nothing; a failed read is not.
   */
  readonly defaultBranch: DefaultBranchReading | null | 'unaskable';
  /**
   * The default branch's remote tip, read fresh for this call through
   * `git ls-remote` and no host API budget. `'unaskable'` where the read
   * failed or could not say.
   */
  readonly defaultBranchTip: string | 'unaskable';
  /**
   * The first-parent line from the reading's settled commit to the remote tip.
   * Absent reads as `'unread'`, so a tip past the settled commit refuses as
   * `default-branch-unsettled`.
   */
  readonly unsettled?: UnsettledReading;
  /** The paths a commit may change and still not unsettle the reading; absent reads as empty. */
  readonly pathSet?: readonly string[];
  /**
   * The repository's default branch name, read through `Refs.defaultBranch`;
   * `'unaskable'` where the read failed. Absent reads as `'unaskable'`. The
   * default-branch holds apply unless this names a branch and the PR's `base`
   * names a different one (see {@link holdsApply}).
   */
  readonly defaultBranchName?: string | 'unaskable';
  /**
   * The reading kept for the PR's base branch, read only where the default-branch
   * holds do not apply (see {@link holdsApply}). `'unaskable'` where the read
   * failed; absent reads as no reading.
   */
  readonly baseReading?: DefaultBranchReading | null | 'unaskable';
  /**
   * The base's repair record, its episode and the red commit's runs asked
   * again, read only where the base reads red. Absent reads as no record:
   * every PR into the base then refuses `base-branch-red`.
   */
  readonly baseRepair?: RepairMergeReading;
  /**
   * The `plot/review` state on the pinned head, re-asked through the host and
   * never folded from the checks rollup. `'unaskable'` where the read failed.
   */
  readonly review: PrReviewReading | 'unaskable';
  /**
   * The Review app's bot login `plot/review` is judged against: `''` where no
   * writer is declared, and `'unaskable'` where it could not be resolved.
   * Absent reads as `''`.
   */
  readonly reviewWriter?: string | 'unaskable';
  /**
   * The PR's whole conversation, re-asked through the host and never read from
   * the PR index. `'unaskable'` where the read failed or was not asked.
   */
  readonly conversation: PrConversationReading | 'unaskable';
  /**
   * The repair record, its episode and the red commit's runs asked again,
   * read only where the default branch is settled red. Absent reads as no
   * record: every PR then refuses `default-branch-red`.
   */
  readonly repair?: RepairMergeReading;
  /**
   * The changed paths of a sync PR and the set they must lie in. Present only
   * where the PR runs from the state branch to the default branch; absent for
   * every other PR and for a repository with no state key. `'unknown'` where
   * the gate is unread and the PR could be a sync PR.
   */
  readonly sync?: { readonly files: readonly string[] | 'unknown'; readonly set: readonly string[] } | 'unknown';
  /**
   * The person hold: the PR index rows and `release-hold-person.json`'s record.
   * Absent, or a `null` record, holds nothing.
   */
  readonly releaseHold?: ReleaseHoldReading;
}

/** What the caller asks for. */
export interface MergeInput {
  /** The PR to merge. */
  readonly pr: number;
  /** The head commit the caller read the checks for. */
  readonly sha: string;
  /** The current time, as epoch milliseconds. */
  readonly now: number;
  /** The `Checks wait` bound, in milliseconds; an older default-branch reading refuses the merge. */
  readonly checksWaitMs: number;
  /**
   * The hex-prefix floor {@link sameCommit} enforces for the `head-moved`
   * check. The caller's to set: a host that always reports and expects a
   * full-length head can raise it to close the collision window a short
   * prefix leaves open, while a host that legitimately reports a shorter head
   * needs a lower floor. {@link mergeAt} sets it from the host's backend word
   * through {@link minHexLenFor}.
   */
  readonly minHexLen: number;
  /**
   * Set only by the `release-approve` path, which has already read the PR's
   * review on this head. A release PR otherwise refuses as `release-pr`.
   */
  readonly viaReleaseApprove?: boolean;
  /**
   * Requires a default-branch reading to proceed. Off by default because
   * `null` is overloaded — {@link DefaultBranchReading} also reads `null` for
   * a version this Plot does not know, so a person's one-shot merge must keep
   * holding nothing on a missing reading. fleetd sets this.
   */
  readonly requireReading?: boolean;
  /**
   * The check names (`Merge checks`) that must each have a completed `SUCCESS`
   * on the head, read from `pr.checkRuns` through {@link mergeChecksVerdict}.
   * Absent or empty requires none.
   */
  readonly mergeChecks?: readonly string[];
}

/** What a passing merge decides, beyond its write. */
export interface MergeDetail {
  /** The PR to merge. */
  readonly pr: number;
  /** The head commit the merge is pinned to. */
  readonly sha: string;
  /** Whether a default-branch reading within `Checks wait` existed; absent is reported, not permitted. */
  readonly defaultBranchRead: boolean;
  /** Which field of the repair record admitted the PR on a red default branch; absent where the branch was not red. */
  readonly repair?: RepairRole;
}

/**
 * Whether a person's merge may pass a default-branch head that reads `unknown`.
 *
 * A head with no run to wait for never settles, so the reading's `settled`
 * stays on an older commit. The bound holds only where the caller is a person,
 * the head reads `unknown`, the tip is the reading's own head, and that head
 * has stood longer than `checksWaitMs` since `headSince`. It writes nothing
 * and never applies to `fleetd`; a `headSince` that does not parse never passes.
 */
const unknownHeadBound = (
  caller: Caller,
  reading: DefaultBranchReading,
  tip: string,
  now: number,
  checksWaitMs: number,
): boolean => {
  if (caller !== 'person' || reading.head !== 'unknown' || tip !== reading.headSha) return false;
  const since = Date.parse(reading.headSince);
  return !Number.isNaN(since) && now - since > checksWaitMs;
};

export { holdsApply };

/**
 * Whether a PR's merge reads a state file under the state home.
 *
 * @param base - the PR's base branch; `''` where unread.
 * @param defaultBranchName - the repository's default branch name, or `'unaskable'`.
 * @returns true where the default-branch holds apply ({@link holdsApply}) or the base is a `sprint/*` branch.
 */
export const stateHomeGuards = (base: string, defaultBranchName: string | 'unaskable' | undefined): boolean =>
  holdsApply(base, defaultBranchName) || base.startsWith(SPRINT_BRANCH_PREFIX);

const homeUnread = (pr: number, base: string) => refuse('merge', 'state-home-unread',
  `git could not name the main checkout, so the state files PR #${pr} into ${base === '' ? 'its base' : base} needs cannot be found. An unfound home is not an empty one; nothing was merged.`);

const short = (sha: string | undefined): string =>
  sha === undefined || sha === '' ? 'none' : sha.slice(0, 12);

/**
 * Decides whether a PR may merge at the commit the caller read.
 *
 * Refuses unless all four hold at the host's answer now: the head names the
 * same commit as the caller's sha (see {@link sameCommit} — a short host head
 * and a full-length caller sha, in either direction, still match, at the floor
 * `input.minHexLen` sets), the check rollup is green for that head, the PR is not a
 * draft, and the default branch is not red. A host that did not answer, or that names no head commit
 * or no head branch, refuses as `unaskable`, and so does a default-branch read that failed. A
 * missing default-branch reading holds nothing (unless `input.requireReading`,
 * which refuses it as `default-branch-unread`) and the decision says so in its
 * detail. A reading whose `askedAt` is older than `input.checksWaitMs`, or does
 * not parse, refuses as `default-branch-stale`: a merge cannot be undone, so a
 * reading no host confirmed within the bound permits nothing, whether it reads
 * red or green.
 *
 * The default-branch refusals — `unaskable` for a failed default-branch or tip
 * read, `default-branch-unread`, `default-branch-stale`, `default-branch-red`
 * with its repair admission, and `default-branch-unsettled` — apply only where
 * {@link holdsApply} answers true for `pr.base` and
 * `readings.defaultBranchName`. A PR into another branch skips them all, and
 * every other refusal still applies to it.
 *
 * `checks-unbound` guards a rollup that names a commit other than the head.
 * A PR's `checksSha` and `headSha` both name commits on the same ref; when an
 * adapter reports checks against a commit other than the head, the refusal
 * fires.
 *
 * `default-branch-unsettled` guards a default branch whose tip moved past what
 * the reading names. The reading is written on the PR beat, every twelfth 5 s
 * scan beat, while a merge can run on any scan beat — so a freshly-read green
 * `settled` can still name a commit the branch has since moved past. The tip
 * is read fresh (`readings.defaultBranchTip`) and must equal both the
 * reading's `headSha` and its `settled.sha`; a failed tip read refuses as
 * `unaskable`, never as a pass. This check applies only where a reading
 * exists — a missing reading is `default-branch-unread` or holds nothing, as
 * above. One bound passes the check: where the caller is a person, the head
 * reads `unknown`, the tip is the reading's `headSha` and `headSince` lies
 * longer than `input.checksWaitMs` ago, the merge proceeds although `settled`
 * names an older commit. The bound writes no `settled`, lifts no
 * `default-branch-red` (it sits after that check), and never applies to
 * `fleetd`; a `pending` head does not qualify.
 *
 * `default-branch-red` has one exception, read by {@link repairMergeVerdict}:
 * on a red, fresh reading, the PR that the repair record names as `repairPr`
 * or `revertPr` passes, while the record's episode is open, its head branch is
 * the episode's branch, and the red commit's runs, asked again, still read
 * red. Such a PR refuses `repair-episode-closed`, `repair-branch-mismatch`,
 * `repair-red-unconfirmed` or `unaskable` otherwise. Every other PR refuses
 * `default-branch-red`. `default-branch-stale` and `default-branch-unsettled`
 * refuse an admitted PR as they refuse every PR.
 *
 * `checks-not-green` also guards each name in `input.mergeChecks`: a named
 * check with no item in `pr.checkRuns`, or with a queued or running item,
 * reads `pending`, and one that completed without `SUCCESS` reads `failing`.
 * A rollup reads green over the items it holds, so a job that has no check run
 * on the head yet is invisible to it.
 *
 * `review-not-passed` guards the `plot/review` status, re-asked through the
 * host and never folded from the checks rollup — a rollup can read green with
 * `plot/review` absent. It refuses unless `readings.review` answers `success`
 * on the pinned head (`pr.headSha`); a different sha, `absent`, `failure`,
 * `pending` and a failed read all refuse.
 *
 * `human-comment-open` guards the PR's conversation, read by
 * {@link humanCommentOpen}: a person's comment with no later answer refuses,
 * and a conversation that could not be read refuses `human-comment-unread`.
 * Both sit after `review-not-passed` and before the default-branch checks.
 *
 * @param readings - the host's PR answer, the default-branch reading and tip, the review reading and the conversation.
 * @param input - the PR, the head commit the caller read, the clock and the `Checks wait` bound.
 * @returns a decision with one `pr-merge` write pinned to the host's head in
 *   the host's own form (`pr.headSha`, which names the caller's commit), or the
 *   first refusal, naming the reading it saw.
 */
export const merge = (readings: MergeReadings, input: MergeInput): Outcome<MergeDetail, MergeRefusal> => {
  const no = (reason: MergeRefusal, detail: string) => refuse('merge', reason, detail);
  if (readings.caller === 'unattended') {
    return no('unattended', `an unattended caller does not merge PR #${input.pr}. Merging is reviewed as an action, and this one had no reviewer.`);
  }
  const { pr } = readings;
  if (pr === 'unaskable') {
    return no('unaskable', `the host did not answer for PR #${input.pr}. A failed read is not an absent reading; nothing was merged.`);
  }
  if (pr === null || pr.state !== 'OPEN') {
    return no('pr-not-open', `PR #${input.pr} is ${pr === null ? 'unknown to the host' : pr.state}. Only an open PR merges.`);
  }
  if (readings.stateHome === 'unaskable' && stateHomeGuards(pr.base, readings.defaultBranchName)) {
    return homeUnread(input.pr, pr.base);
  }
  if (pr.head === '') {
    return no('unaskable', `the host named no head branch for PR #${input.pr}, so neither the release-PR check nor the repair-branch check can read it. Nothing was merged.`);
  }
  if (RELEASE_BRANCH.test(pr.head) && input.viaReleaseApprove !== true) {
    return no('release-pr', `PR #${input.pr} is a release PR and merges only through release-approve, which reads its review first. Run: plot-ask.mjs release-approve ${input.pr} ${short(input.sha)}`);
  }
  if (pr.headSha === undefined || pr.headSha === '') {
    return no('unaskable', `the host named no head commit for PR #${input.pr}, so the merge cannot be pinned to ${short(input.sha)}. Nothing was merged.`);
  }
  if (!sameCommit(pr.headSha, input.sha, input.minHexLen)) {
    return no('head-moved', `the head of PR #${input.pr} is ${short(pr.headSha)}; the caller read ${short(input.sha)}. Re-read the checks for the new head.`);
  }
  if (readings.sync === 'unknown') {
    return no('sync-gate-unread', `the state branch key or the default branch could not be read, and PR #${input.pr} could be a sync PR. An unread gate is not an open one; nothing was merged.`);
  }
  if (readings.sync !== undefined) {
    const verdict = syncPathVerdict(readings.sync.files, readings.sync.set);
    if (!verdict.ok) {
      return no(verdict.refusal, verdict.refusal === 'sync-diff-unread'
        ? `the diff of sync PR #${input.pr} could not be read. An unread diff is not a clean one; nothing was merged.`
        : `sync PR #${input.pr} changes ${verdict.paths.join(', ')}, outside the paths Plot writes. Nothing was merged.`);
    }
  }
  if (pr.draft) return no('draft', `PR #${input.pr} is a draft. Mark it ready, then ask again.`);
  if (pr.checks !== 'green') {
    return no('checks-not-green', `the checks of PR #${input.pr} read '${pr.checks}' at ${short(pr.headSha)}. Merge when they read 'green'.`);
  }
  if (pr.checksSha === undefined || pr.checksSha === '' || pr.checksSha !== pr.headSha) {
    return no('checks-unbound', `the green checks of PR #${input.pr} name ${short(pr.checksSha)}, not the head ${short(pr.headSha)}. A green that names no matching commit proves nothing about this head.`);
  }
  const named = mergeChecksVerdict(pr.checkRuns, input.mergeChecks ?? []);
  if (named.read !== 'green') {
    return no('checks-not-green', `the check '${named.name}' of PR #${input.pr} reads '${named.read}' at ${short(pr.headSha)}: ${named.seen}. Merge when every merge check completed with success on this head.`);
  }
  const review = readings.review;
  const writer = readings.reviewWriter ?? '';
  const judged = review === 'unaskable' ? review : checkedReview(review, writer === 'unaskable' ? null : writer);
  const passes = reviewPasses(judged, pr.headSha, { plain: 'review-not-passed' });
  if (!passes.pass) {
    return no(passes.reason, `${passes.seen} for PR #${input.pr}. Merge when review reads 'success' on this head.`);
  }
  if (readings.conversation === 'unaskable') {
    return no('human-comment-unread', `the conversation of PR #${input.pr} could not be read. An unread conversation is not an empty one; nothing was merged.`);
  }
  const open = humanCommentOpen(readings.conversation);
  if (open !== null) {
    const rest = open.others === 0 ? '' : ` and ${open.others} other${open.others === 1 ? '' : 's'}`;
    return no('human-comment-open', `PR #${input.pr} has a comment by ${open.login === '' ? 'a deleted account' : open.login} at ${open.time} that nobody answered: "${open.firstLine}"${rest}. Reply to it or approve the PR, then ask again; nothing was merged.`);
  }
  let admitted: RepairRole | undefined;
  if (holdsApply(pr.base, readings.defaultBranchName)) {
    const defaultBranch = readings.defaultBranch;
    if (defaultBranch === 'unaskable') {
      return no('unaskable', `the default branch's reading could not be read for PR #${input.pr}. A failed read is not an absent reading; nothing was merged.`);
    }
    if (defaultBranch === null) {
      if (input.requireReading) {
        return no('default-branch-unread', `no default-branch reading exists for PR #${input.pr}, and this caller requires one. Nothing was merged.`);
      }
    } else {
      const age = defaultBranchAgeMs(defaultBranch, input.now);
      if (age === null || age > input.checksWaitMs) {
        const seen = age === null ? `has an askedAt that does not parse ('${defaultBranch.askedAt}')` : `is ${Math.floor(age / 1000)} s old`;
        return no('default-branch-stale', `the reading of ${defaultBranch.branch} ${seen}; Checks wait is ${Math.floor(input.checksWaitMs / 1000)} s. A merge needs a reading a host confirmed within that bound; nothing was merged.`);
      }
      if (defaultBranch.settled?.state === 'red') {
        const verdict = repairMergeVerdict(readings.repair ?? { record: null, episode: 'closed', redRuns: 'unaskable' }, { number: input.pr, head: pr.head });
        if (verdict.verdict === 'not-named') {
          return no('default-branch-red', `${defaultBranch.branch} is red on ${short(defaultBranch.settled.sha)}. A merge now stacks a change on an unproven base.`);
        }
        if (verdict.verdict === 'refused') return no(verdict.reason, verdict.detail);
        admitted = verdict.role;
      }
      if (defaultBranch.settled !== undefined) {
        const tip = readings.defaultBranchTip;
        if (tip === 'unaskable') {
          return no('unaskable', `the default branch's remote tip could not be read for PR #${input.pr}. A failed read is not an absent reading; nothing was merged.`);
        }
        const bounded = unknownHeadBound(readings.caller, defaultBranch, tip, input.now, input.checksWaitMs);
        const line = readings.unsettled ?? 'unread';
        const covered =
          defaultBranch.settled.sha === tip ||
          (admitted === undefined &&
            defaultBranch.settled.state === 'green' &&
            line !== 'unread' &&
            line.headSha === tip &&
            settledPast(defaultBranch.settled, line, readings.pathSet ?? []));
        if (!bounded && (tip !== defaultBranch.headSha || !covered)) {
          return no('default-branch-unsettled', `${defaultBranch.branch}'s tip is now ${short(tip)}, but the reading names head ${short(defaultBranch.headSha)} and settled ${short(defaultBranch.settled.sha)}. A merge needs a reading of the settled tip.`);
        }
      }
    }
    if (admitted === undefined && readings.releaseHold !== undefined && !RELEASE_BRANCH.test(pr.head)) {
      const name = readings.defaultBranchName;
      const held = releasePersonHold(readings.releaseHold.rows, readings.releaseHold.record, name, input.now, input.checksWaitMs);
      if (held.holds && held.pr !== input.pr) {
        return no('release-waiting', `release #${held.pr} holds merges into ${name ?? 'the default branch'} until ${holdClock(held.end)} while a person approves it. Merge after the release, or lift the hold; nothing was merged.`);
      }
    }
  } else {
    const baseReading = readings.baseReading ?? null;
    if (baseReading === 'unaskable') {
      return no('unaskable', `the reading of ${pr.base} could not be read for PR #${input.pr}. A failed read is not an absent reading; nothing was merged.`);
    }
    if (baseBranchRed(pr.base, baseReading, input.now, input.checksWaitMs)) {
      const verdict = repairMergeVerdict(readings.baseRepair ?? { record: null, episode: 'closed', redRuns: 'unaskable' }, { number: input.pr, head: pr.head });
      if (verdict.verdict === 'not-named') {
        return no('base-branch-red', `${pr.base} is red on ${short(baseReading?.settled?.sha)}. A merge now stacks a change on an unproven base.`);
      }
      if (verdict.verdict === 'refused') return no(verdict.reason, verdict.detail);
      admitted = verdict.role;
    }
  }
  return decide('merge', [{ kind: 'pr-merge', pr: input.pr, deleteBranch: false, sha: pr.headSha }], {
    pr: input.pr,
    sha: input.sha,
    defaultBranchRead: readings.defaultBranch !== null,
    ...(admitted ? { repair: admitted } : {}),
  });
};

/**
 * Whether a backend word names a host that can pin a merge to a commit.
 *
 * `plot-host.sh pr-merge --match-head` requires the flag on every backend.
 * Bitbucket Cloud's merge endpoint takes no head precondition (measured
 * 2026-10-18 against its OpenAPI spec), so its arm re-reads the head
 * immediately before merging and refuses `head-moved` on a mismatch — a
 * reduced window rather than a true pin, but the flag is honoured on every
 * backend this adapter resolves.
 *
 * @param backend - the word `plot-host.sh` resolved, or `''` where it did not answer.
 * @returns true always, so an unanswered backend keeps the pin too.
 */
export const hostPinsMerges = (_backend: string): boolean => true;

/**
 * Asks the host port whether a merge through it is pinned to a head commit.
 *
 * @param host - the host port.
 * @returns {@link hostPinsMerges} of the resolved backend; true where the backend does not answer.
 */
export const canPinMerge = async (host: Host): Promise<boolean> => {
  const backend = await host.backend();
  return hostPinsMerges(backend.ok ? backend.value : '');
};

/** The ports one merge needs. */
export interface MergePorts {
  host: Host;
  scripts: Scripts;
  defaultBranch: DefaultBranchStore;
  /** Opens the reading kept for a PR's base branch; absent reads as no reading. */
  baseBranch?: (base: string) => DefaultBranchStore;
  /** Opens the repair record kept for a PR's base branch; absent reads as no record, so a red base admits no PR. */
  baseRepair?: (base: string) => RepairRecordStore;
  refs: Refs;
  /** The `Checks wait` bound, in milliseconds. */
  checksWaitMs: number;
  /** The clock, as epoch milliseconds. */
  now: () => number;
  /** See {@link MergeInput.requireReading}. Off by default. */
  requireReading?: boolean;
  /** Who is asking for this merge; an unattended caller is refused before any read. */
  caller: Caller;
  /**
   * Whether the state home the stores read under was found. `'unaskable'`
   * reads none of `defaultBranch`, `repair`, `baseBranch` and `baseRepair`.
   * Absent reads as `'read'`.
   */
  stateHome?: StateHomeRead;
  /** The repair record's file. Absent reads as no record, so a red default branch admits no PR. */
  repair?: RepairRecordStore;
  /**
   * The person hold's file and the PR index rows, read only for a PR into the
   * default branch. Absent, a failed read or a missing file holds nothing.
   */
  releaseHold?: {
    record: ReleaseHoldPersonStore;
    rows: () => Promise<PortResult<readonly PrIndexRow[]>>;
  };
  /**
   * The paths Plot's own commits change: `syncPathSet` plus the generated
   * bundles. Absent, a tip past the settled commit never counts as settled.
   */
  plotPaths?: readonly string[];
  /** The CI connector, asked again for the red commit's runs before a repair PR merges. */
  build?: Pick<BuildPort, 'runsForSha'>;
  /** The workflow names `Default branch checks` declares; empty folds every run. */
  checks?: readonly string[];
  /** See {@link MergeInput.mergeChecks}. Absent requires none. */
  mergeChecks?: readonly string[];
  /**
   * The state branch's sync PR gate. Absent where no state key is declared, so
   * `mergeAt` behaves as before. `diff(sha)` returns the paths the PR changes
   * at the pinned head, or `'unknown'`. An {@link UnreadSyncGate} where the key
   * or the default branch could not be read.
   */
  stateSync?: {
    target: StateWriteTarget;
    pathSet: readonly string[];
    defaultBranch: string;
    diff: (sha: string) => Promise<readonly string[] | 'unknown'>;
  } | UnreadSyncGate;
}

/**
 * Reads the repair exception's values for one PR on a red reading.
 *
 * Reads the record first, and walks the first-parent line and asks the runs
 * again only where the record names the PR. Without `ports.build` the runs
 * read `unaskable`.
 */
export const readRepair = async (
  ports: Pick<MergePorts, 'repair' | 'build' | 'checks'> & { refs: Pick<Refs, 'firstParentLine'> },
  branch: string, settled: SettledReading, pr: number, scope: RepairScope = 'default'): Promise<RepairMergeReading> => {
  const tag = scope === 'base' ? { scope } : {};
  const read = ports.repair ? await ports.repair.read() : { ok: true as const, value: null };
  if (!read.ok) return { record: 'unaskable', episode: 'unaskable', redRuns: 'unaskable', ...tag };
  const record = read.value;
  if (record === null || repairRoleOf(record, pr, scope) === null) return { record, episode: 'closed', redRuns: 'unaskable', ...tag };
  const line = await ports.refs.firstParentLine(settled.sha, EPISODE_LINE_DEPTH);
  const episode = repairEpisode(record, branch, settled, line.ok ? line.value : 'unaskable');
  if (episode !== 'open' || ports.build === undefined) return { record, episode, redRuns: 'unaskable', ...tag };
  const runs = await ports.build.runsForSha(branch, settled.sha, ports.checks ?? []);
  return { record, episode, redRuns: runs.ok ? foldRuns(declaredRuns(runs.value, ports.checks ?? [])) : 'unaskable', ...tag };
};

/**
 * Reads the person hold's record and the PR index rows.
 *
 * @param ports - the hold's file and the index rows' reader.
 * @returns the reading, or `undefined` where either read failed, which holds nothing.
 */
export const readReleaseHold = async (
  ports: NonNullable<MergePorts['releaseHold']>,
): Promise<ReleaseHoldReading | undefined> => {
  const record = await ports.record.read();
  if (!record.ok || record.value === null) return undefined;
  const rows = await ports.rows();
  return rows.ok ? { rows: rows.value, record: record.value } : undefined;
};

/** What `plot-ask.mjs merge` (and fleetd) print or hold, as one JSON line. */
export type MergeResult =
  | { merged: true; pr: number; sha: string; defaultBranchRead: boolean; unpinned: boolean }
  | {
      merged: false;
      reason: MergeRefusal | 'host-refused';
      detail: string;
      /** The newest conversation time read; set by `human-comment-open`, and `''` where none parsed. */
      conversationAt?: string;
    };

/**
 * Merges a PR at the head commit the caller read, or refuses.
 *
 * Re-asks the host through `pr-state --with-checks` and never the PR index: the index decides
 * only whether to try, and a merge cannot be undone. The default branch's tip
 * is read fresh through `Refs.remoteSha` — not taken from the stored reading,
 * which is written on the PR beat while a merge can run on any scan beat. On a
 * pass the merge goes through `plot-host.sh pr-merge --match-head <sha>`, so a
 * push between the reading and the merge fails at the host; a host that cannot
 * pin merges with no pin flag. A refusal ends the action; nothing retries
 * without the pin.
 *
 * The reads run in this order: the default-branch reading, the default
 * branch's tip (only where the reading has a settled commit), `prState`, the
 * default branch's name through `Refs.defaultBranch` (only where the PR names a
 * base), then the backend, `prReview` and the review writer, and the repair
 * record last. The default-branch holds apply only where {@link holdsApply}
 * answers true for the PR's base and that name; a failed `prState` or an empty
 * base keeps them. For such a PR, where the tip differs from the settled
 * commit on a fresh, non-red reading — and the person's `unknown`-head bound
 * does not apply — it refuses `default-branch-unsettled` after the one
 * `prState` call and with no `prReview` call. A default-branch read or tip
 * read that fails refuses as `unaskable`; an absent reading holds nothing
 * unless `ports.requireReading`. A PR into another branch skips every
 * default-branch hold and reads no repair record.
 * Where `ports.stateHome` is `'unaskable'` it reads no store: after `prState`
 * and the default branch's name it refuses `state-home-unread` for an open PR
 * a person asks to merge into the default branch or a `sprint/*` base, with no
 * review, conversation or backend call; any other PR goes on with no reading.
 * On a settled red reading it reads the repair record last; where the record
 * names the PR it walks the settled commit's first-parent line and asks the
 * settled commit's runs again through `ports.build`, folding the declared
 * `ports.checks`, so the red is confirmed immediately before the merge.
 *
 * @param ports - the host, the script port, the default-branch store, the
 *   refs port, the `Checks wait` bound, the clock and whether a reading is required.
 * @param pr - the PR number.
 * @param sha - the head commit the caller read the checks for.
 * @param viaReleaseApprove - true when `release-approve` hands a release PR over.
 * @returns the merge, or the refusal naming its reason; `host-refused` carries
 *   the host's own words.
 */
export const mergeAt = async (
  ports: MergePorts,
  pr: number,
  sha: string,
  viaReleaseApprove = false,
): Promise<MergeResult> => {
  const unread = ports.stateHome === 'unaskable';
  const reading: PortResult<DefaultBranchReading | null> = unread ? { ok: true, value: null } : await ports.defaultBranch.read();
  const settledReading = reading.ok && reading.value !== null && reading.value.settled !== undefined ? reading.value : null;
  const tip = settledReading !== null ? await ports.refs.remoteSha(settledReading.branch) : null;
  const tipSha = tip === null ? 'unaskable' : tip.ok && tip.value !== 'unknown' ? tip.value.sha : 'unaskable';
  const lookup = await ports.host.prState(pr, { withChecks: true });
  const base = lookup.ok && lookup.value !== null ? lookup.value.base : '';
  const named = base === '' ? null : await ports.refs.defaultBranch();
  const defaultBranchName = named === null ? 'unaskable' : named.ok ? named.value : 'unaskable';
  const holds = holdsApply(base, defaultBranchName);
  if (unread && ports.caller !== 'unattended' && lookup.ok && lookup.value !== null && lookup.value.state === 'OPEN'
    && stateHomeGuards(base, defaultBranchName)) {
    const out = homeUnread(pr, base);
    return { merged: false, reason: out.reason, detail: out.detail };
  }
  const settledSha = settledReading?.settled?.state === 'green' ? settledReading.settled.sha : undefined;
  const plotPaths = ports.plotPaths;
  let line: { readonly unsettled: UnsettledReading; readonly pathSet: readonly string[] } | undefined;
  let covered = false;
  if (holds && settledSha !== undefined && tipSha !== 'unaskable' && tipSha !== settledSha && plotPaths !== undefined) {
    const unsettled = await readUnsettled(ports.refs, settledSha, tipSha);
    line = { unsettled, pathSet: plotPaths };
    covered = unsettled !== 'unread' && unsettled.headSha === tipSha && settledPast({ sha: settledSha }, unsettled, plotPaths);
  }
  if (holds && settledReading !== null && tipSha !== 'unaskable' && ports.caller !== 'unattended' && settledReading.settled?.state !== 'red') {
    const age = defaultBranchAgeMs(settledReading, ports.now());
    if (age !== null && age <= ports.checksWaitMs && tipSha !== settledReading.settled?.sha && !covered
      && !unknownHeadBound(ports.caller, settledReading, tipSha, ports.now(), ports.checksWaitMs)) {
      return {
        merged: false,
        reason: 'default-branch-unsettled',
        detail: `${settledReading.branch}'s tip is now ${short(tipSha)}, but the reading settled ${short(settledReading.settled?.sha)}. No review was asked; a merge needs a reading of the settled tip.`,
      };
    }
  }
  const baseRead = !holds && !unread && ports.baseBranch !== undefined ? await ports.baseBranch(base).read() : undefined;
  const backend = await ports.host.backend();
  const [review, writer] = await Promise.all([
    ports.host.prReview(pr),
    ports.host.reviewWriter(),
  ]);
  // Read only where merge() can reach the conversation check: a draft, red or
  // unreviewed PR refuses earlier and must not cost three REST pages. A skipped
  // read is 'unaskable', so a check reached without a read still refuses.
  const reviewed = review.ok && review.value.state === 'success';
  const reachesConversation = lookup.ok && lookup.value !== null && lookup.value.state === 'OPEN'
    && !lookup.value.draft && lookup.value.checks === 'green' && reviewed;
  const conversation: PortResult<PrConversationReading> = reachesConversation
    ? await ports.host.prConversation(pr)
    : { ok: false, why: 'unaskable' };
  // Read last, so the red commit's runs are asked immediately before the merge.
  const repair = holds && settledReading !== null && settledReading.settled?.state === 'red'
    ? await readRepair(ports, settledReading.branch, settledReading.settled, pr)
    : undefined;
  const baseReading = baseRead !== undefined && baseRead.ok ? baseRead.value : null;
  const baseRepair = ports.baseRepair !== undefined && baseReading !== null && baseReading.settled !== undefined
    && baseBranchRed(base, baseReading, ports.now(), ports.checksWaitMs)
    ? await readRepair({ ...ports, repair: ports.baseRepair(base) }, baseReading.branch, baseReading.settled, pr, 'base')
    : undefined;
  const lookedPr = lookup.ok ? lookup.value : null;
  const releaseHold = holds && !unread && ports.releaseHold !== undefined ? await readReleaseHold(ports.releaseHold) : undefined;
  const gate = ports.stateSync;
  const sync = gate === undefined || lookedPr === null ? undefined
    : 'unread' in gate ? (mayBeSyncPr(lookedPr, gate) ? 'unknown' as const : undefined)
    : isSyncPr(lookedPr, gate.target, gate.defaultBranch) ? { files: await gate.diff(sha), set: gate.pathSet }
    : undefined;
  const outcome = merge(
    {
      caller: ports.caller,
      ...(ports.stateHome ? { stateHome: ports.stateHome } : {}),
      ...(sync ? { sync } : {}),
      pr: lookup.ok ? lookup.value : 'unaskable',
      defaultBranch: reading.ok ? reading.value : 'unaskable',
      defaultBranchTip: tipSha,
      ...(line ?? {}),
      defaultBranchName,
      ...(baseRead === undefined ? {} : { baseReading: baseRead.ok ? baseRead.value : 'unaskable' as const }),
      review: review.ok ? review.value : 'unaskable',
      reviewWriter: writer.ok ? writer.value : 'unaskable',
      conversation: conversation.ok ? conversation.value : 'unaskable',
      ...(repair ? { repair } : {}),
      ...(baseRepair ? { baseRepair } : {}),
      ...(releaseHold ? { releaseHold } : {}),
    },
    {
      pr,
      sha,
      now: ports.now(),
      checksWaitMs: ports.checksWaitMs,
      minHexLen: minHexLenFor(backend.ok ? backend.value : ''),
      requireReading: ports.requireReading,
      viaReleaseApprove,
      mergeChecks: ports.mergeChecks,
    },
  );
  if (outcome.outcome === 'refused') {
    if (outcome.reason !== 'human-comment-open' && outcome.reason !== 'human-comment-unread') {
      return { merged: false, reason: outcome.reason, detail: outcome.detail };
    }
    // The record fleetd keeps compares against the newest time the read saw.
    const open = conversation.ok ? humanCommentOpen(conversation.value) : null;
    return { merged: false, reason: outcome.reason, detail: outcome.detail, ...(open === null ? {} : { conversationAt: open.conversationAt }) };
  }
  const write = outcome.writes[0];
  /* v8 ignore next 3 -- merge()'s one decide('merge', ...) call always writes kind: 'pr-merge' and pr.headSha, never undefined */
  if (write?.kind !== 'pr-merge' || write.sha === undefined) {
    return { merged: false, reason: 'host-refused', detail: 'the merge decision carried no pinned write' };
  }
  const args = ['pr-merge', String(write.pr)];
  const pinned = await canPinMerge(ports.host);
  /* v8 ignore else -- hostPinsMerges always returns true, so canPinMerge never resolves false */
  if (pinned) args.push('--match-head', write.sha);
  /* v8 ignore next -- merge()'s one decide('merge', ...) call always writes deleteBranch: false */
  if (write.deleteBranch) args.push('--delete-branch');
  const landed = await ports.scripts.hostSaid(args);
  if (landed.answer !== 'answered') {
    return { merged: false, reason: 'host-refused', detail: landed.said };
  }
  return { merged: true, pr, sha, defaultBranchRead: outcome.detail.defaultBranchRead, unpinned: !pinned };
};
