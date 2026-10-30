import type { DefaultBranchReading } from '../entities/default-branch.js';
import type { Pr } from '../entities/pr.js';
import type { DefaultBranchStore } from '../ports/default-branch.js';
import type { Host, PrReviewReading } from '../ports/host.js';
import type { Refs } from '../ports/refs.js';
import type { Scripts } from '../ports/scripts.js';
import { defaultBranchAgeMs } from '../rules/default-branch.js';
import { minHexLenFor } from '../rules/min-hex-len.js';
import { sameCommit } from '../rules/same-commit.js';
import { type Outcome, decide, refuse } from './decision.js';

/**
 * Why `merge` refused. Each is the end of the action: nothing merges, and no
 * caller retries with the pin dropped.
 */
export type MergeRefusal =
  | 'unaskable'
  | 'pr-not-open'
  | 'head-moved'
  | 'draft'
  | 'checks-not-green'
  | 'checks-unbound'
  | 'default-branch-red'
  | 'default-branch-stale'
  | 'default-branch-unsettled'
  | 'default-branch-unread'
  | 'review-not-passed';

/** What `merge` reads. Every reading is the host's, taken fresh for this call. */
export interface MergeReadings {
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
   * The `plot/review` state on the pinned head, re-asked through the host and
   * never folded from the checks rollup. `'unaskable'` where the read failed.
   */
  readonly review: PrReviewReading | 'unaskable';
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
   * Requires a default-branch reading to proceed. Off by default because
   * `null` is overloaded — {@link DefaultBranchReading} also reads `null` for
   * a version this Plot does not know, so a person's one-shot merge must keep
   * holding nothing on a missing reading. fleetd sets this.
   */
  readonly requireReading?: boolean;
}

/** What a passing merge decides, beyond its write. */
export interface MergeDetail {
  /** The PR to merge. */
  readonly pr: number;
  /** The head commit the merge is pinned to. */
  readonly sha: string;
  /** Whether a default-branch reading within `Checks wait` existed; absent is reported, not permitted. */
  readonly defaultBranchRead: boolean;
}

const short = (sha: string | undefined): string =>
  sha === undefined || sha === '' ? 'none' : sha.slice(0, 12);

/**
 * Decides whether a PR may merge at the commit the caller read.
 *
 * Refuses unless all four hold at the host's answer now: the head names the
 * same commit as the caller's sha (see {@link sameCommit} — a short host head
 * and a full-length caller sha, in either direction, still match, at the floor
 * `input.minHexLen` sets), the check rollup is green for that head, the PR is not a
 * draft, and the default branch is not red. A host that did not answer, or that names no head commit,
 * refuses as `unaskable`, and so does a default-branch read that failed. A
 * missing default-branch reading holds nothing (unless `input.requireReading`,
 * which refuses it as `default-branch-unread`) and the decision says so in its
 * detail. A reading whose `askedAt` is older than `input.checksWaitMs`, or does
 * not parse, refuses as `default-branch-stale`: a merge cannot be undone, so a
 * reading no host confirmed within the bound permits nothing, whether it reads
 * red or green.
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
 * above.
 *
 * `review-not-passed` guards the `plot/review` status, re-asked through the
 * host and never folded from the checks rollup — a rollup can read green with
 * `plot/review` absent. It refuses unless `readings.review` answers `success`
 * on the pinned head (`pr.headSha`); a different sha, `absent`, `failure`,
 * `pending` and a failed read all refuse.
 *
 * @param readings - the host's PR answer, the default-branch reading and tip, and the review reading.
 * @param input - the PR, the head commit the caller read, the clock and the `Checks wait` bound.
 * @returns a decision with one `pr-merge` write pinned to the host's head in
 *   the host's own form (`pr.headSha`, which names the caller's commit), or the
 *   first refusal, naming the reading it saw.
 */
export const merge = (readings: MergeReadings, input: MergeInput): Outcome<MergeDetail, MergeRefusal> => {
  const no = (reason: MergeRefusal, detail: string) => refuse('merge', reason, detail);
  const { pr } = readings;
  if (pr === 'unaskable') {
    return no('unaskable', `the host did not answer for PR #${input.pr}. A failed read is not an absent reading; nothing was merged.`);
  }
  if (pr === null || pr.state !== 'OPEN') {
    return no('pr-not-open', `PR #${input.pr} is ${pr === null ? 'unknown to the host' : pr.state}. Only an open PR merges.`);
  }
  if (pr.headSha === undefined || pr.headSha === '') {
    return no('unaskable', `the host named no head commit for PR #${input.pr}, so the merge cannot be pinned to ${short(input.sha)}. Nothing was merged.`);
  }
  if (!sameCommit(pr.headSha, input.sha, input.minHexLen)) {
    return no('head-moved', `the head of PR #${input.pr} is ${short(pr.headSha)}; the caller read ${short(input.sha)}. Re-read the checks for the new head.`);
  }
  if (pr.draft) return no('draft', `PR #${input.pr} is a draft. Mark it ready, then ask again.`);
  if (pr.checks !== 'green') {
    return no('checks-not-green', `the checks of PR #${input.pr} read '${pr.checks}' at ${short(pr.headSha)}. Merge when they read 'green'.`);
  }
  if (pr.checksSha === undefined || pr.checksSha === '' || pr.checksSha !== pr.headSha) {
    return no('checks-unbound', `the green checks of PR #${input.pr} name ${short(pr.checksSha)}, not the head ${short(pr.headSha)}. A green that names no matching commit proves nothing about this head.`);
  }
  const review = readings.review;
  if (review === 'unaskable' || review.state !== 'success' || review.sha !== pr.headSha) {
    const seen = review === 'unaskable' ? 'the review read failed' : review.sha !== pr.headSha ? `'plot/review' names ${short(review.sha)}, not the head ${short(pr.headSha)}` : `'plot/review' reads '${review.state}'`;
    return no('review-not-passed', `${seen} for PR #${input.pr}. Merge when review reads 'success' on this head.`);
  }
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
      return no('default-branch-red', `${defaultBranch.branch} is red on ${short(defaultBranch.settled.sha)}. A merge now stacks a change on an unproven base.`);
    }
    if (defaultBranch.settled !== undefined) {
      const tip = readings.defaultBranchTip;
      if (tip === 'unaskable') {
        return no('unaskable', `the default branch's remote tip could not be read for PR #${input.pr}. A failed read is not an absent reading; nothing was merged.`);
      }
      if (tip !== defaultBranch.headSha || defaultBranch.settled.sha !== tip) {
        return no('default-branch-unsettled', `${defaultBranch.branch}'s tip is now ${short(tip)}, but the reading names head ${short(defaultBranch.headSha)} and settled ${short(defaultBranch.settled.sha)}. A merge needs a reading of the settled tip.`);
      }
    }
  }
  return decide('merge', [{ kind: 'pr-merge', pr: input.pr, deleteBranch: false, sha: pr.headSha }], {
    pr: input.pr,
    sha: input.sha,
    defaultBranchRead: readings.defaultBranch !== null,
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
  refs: Refs;
  /** The `Checks wait` bound, in milliseconds. */
  checksWaitMs: number;
  /** The clock, as epoch milliseconds. */
  now: () => number;
  /** See {@link MergeInput.requireReading}. Off by default. */
  requireReading?: boolean;
}

/** What `plot-ask.mjs merge` (and fleetd) print or hold, as one JSON line. */
export type MergeResult =
  | { merged: true; pr: number; sha: string; defaultBranchRead: boolean; unpinned: boolean }
  | { merged: false; reason: MergeRefusal | 'host-refused'; detail: string };

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
 * without the pin. A default-branch read or tip read that fails refuses as
 * `unaskable`; an absent reading holds nothing unless `ports.requireReading`.
 *
 * @param ports - the host, the script port, the default-branch store, the
 *   refs port, the `Checks wait` bound, the clock and whether a reading is required.
 * @param pr - the PR number.
 * @param sha - the head commit the caller read the checks for.
 * @returns the merge, or the refusal naming its reason; `host-refused` carries
 *   the host's own words.
 */
export const mergeAt = async (ports: MergePorts, pr: number, sha: string): Promise<MergeResult> => {
  const lookup = await ports.host.prState(pr, { withChecks: true });
  const reading = await ports.defaultBranch.read();
  const backend = await ports.host.backend();
  const settledReading = reading.ok && reading.value !== null && reading.value.settled !== undefined ? reading.value : null;
  const [tip, review] = await Promise.all([
    settledReading !== null ? ports.refs.remoteSha(settledReading.branch) : null,
    ports.host.prReview(pr),
  ]);
  const outcome = merge(
    {
      pr: lookup.ok ? lookup.value : 'unaskable',
      defaultBranch: reading.ok ? reading.value : 'unaskable',
      defaultBranchTip: tip === null ? 'unaskable' : tip.ok && tip.value !== 'unknown' ? tip.value.sha : 'unaskable',
      review: review.ok ? review.value : 'unaskable',
    },
    {
      pr,
      sha,
      now: ports.now(),
      checksWaitMs: ports.checksWaitMs,
      minHexLen: minHexLenFor(backend.ok ? backend.value : ''),
      requireReading: ports.requireReading,
    },
  );
  if (outcome.outcome === 'refused') {
    return { merged: false, reason: outcome.reason, detail: outcome.detail };
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
