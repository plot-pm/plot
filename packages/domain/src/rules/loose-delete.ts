import type { Caller } from '../workflows/decision.js';
import type { MergedAnswer, PrLookup } from '../ports/host.js';
import type { RemoteShaReading } from '../ports/refs.js';
import type { PortResult } from '../port-result.js';

/** Why the delete controller refuses a branch. */
export type LooseDeleteRefusal =
  | 'unattended'
  | 'open-pr'
  | 'merged'
  | 'unpushed'
  | 'unaskable'
  | 'no-remote-branch'
  | 'tip-moved';

/** What the delete controller read about one branch before it decides. */
export interface LooseDeleteReadings {
  /** Who asks. */
  readonly caller: Caller;
  /** The host's PR for the branch, `null` where it holds none. */
  readonly pr: PortResult<PrLookup>;
  /** Whether the host merged any PR for the branch. */
  readonly merged: PortResult<MergedAnswer>;
  /** The commits this machine's checkout of the branch holds that no remote holds; `null` where this machine has no checkout. */
  readonly unpushed: PortResult<readonly string[]> | null;
  /** The commit the branch points at on the remote, read live. */
  readonly remoteTip: PortResult<RemoteShaReading>;
  /** The commit `origin/<branch>` resolves to in this clone. */
  readonly localTip: PortResult<string>;
}

/** The controller's decision: delete at `tip`, or refuse. */
export type LooseDeleteDecision =
  | { readonly kind: 'delete'; readonly tip: string }
  | { readonly kind: 'refuse'; readonly reason: LooseDeleteRefusal; readonly detail: string };

const refuse = (reason: LooseDeleteRefusal, detail: string): LooseDeleteDecision => ({ kind: 'refuse', reason, detail });

/**
 * Decides whether a loose branch's remote ref may be deleted.
 *
 * Refuses an unattended caller, a host that cannot be asked about the PR or
 * the merge, an open PR, a merged PR, an unpushed commit in this machine's
 * checkout, a branch with no remote ref, and a remote tip that differs from
 * the one this clone holds. Silence is never permission: every reading that
 * did not answer refuses. A refusal ends the action.
 *
 * @param readings - what the controller read.
 * @returns `delete` with the tip to pin and lease against, or the refusal.
 */
export const looseDelete = (readings: LooseDeleteReadings): LooseDeleteDecision => {
  if (readings.caller === 'unattended') return refuse('unattended', 'an unattended caller deletes no branch');
  if (!readings.pr.ok) return refuse('unaskable', 'the host cannot say whether a PR exists for the branch');
  if (!readings.merged.ok || readings.merged.value === 'unknown') {
    return refuse('unaskable', 'the host cannot say whether the branch merged');
  }
  if (readings.pr.value !== null && readings.pr.value.state === 'OPEN') {
    return refuse('open-pr', `PR #${readings.pr.value.number} is open for the branch`);
  }
  if (readings.merged.value === 'merged') return refuse('merged', 'the host merged a PR for the branch; plot-release-refs.sh owns it');
  if (readings.unpushed !== null) {
    if (!readings.unpushed.ok) return refuse('unaskable', 'git cannot say whether the checkout holds an unpushed commit');
    if (readings.unpushed.value.length > 0) {
      return refuse('unpushed', `the checkout holds ${readings.unpushed.value.length} commit(s) no remote holds`);
    }
  }
  if (!readings.remoteTip.ok || readings.remoteTip.value === 'unknown') {
    return refuse('no-remote-branch', 'the remote ref could not be read, or the branch is not on the remote');
  }
  const tip = readings.remoteTip.value.sha;
  if (!readings.localTip.ok || readings.localTip.value !== tip) {
    return refuse('tip-moved', 'the remote tip is not the tip this clone holds; fetch and look again');
  }
  return { kind: 'delete', tip };
};
