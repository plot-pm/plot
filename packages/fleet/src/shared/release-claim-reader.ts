import {
  releaseClaim,
  decided,
  refused,
  answered,
  failed,
  unaskable,
  isAnswered,
  type ClaimReleaseReadings,
  type ClaimReleasePrReading,
  type PortResult,
} from '@plot-pm/domain';
import { agentsFs, processesShell, refsGit, hostShell, claimReleaseShell } from '@plot-pm/domain/adapters';

/**
 * REFUSES TWO OF THE SCRIPT'S SIX. `releaseClaim` (the domain decision) only
 * reads what this route already gathers for every row: a live agent (from the
 * manifests, not merely a ref) and an open-or-merged PR. The script's other
 * four refusals — a live worker pid, a file-changing remote commit, unpushed
 * or dirty desk work, a `PLOT-BLOCKED` marker — stay enforced in the shell,
 * which {@link claimReleaseShell} still calls unchanged for the mechanics.
 */

/** What the route (or the CLI) answers, on every outcome. */
export interface ReleaseClaimResult {
  branch: string;
  /** True once the claim is gone — including the no-claim no-op. */
  released: boolean;
  /** Whether there was a claim to release at all. */
  hadClaim: boolean;
  /** A human sentence: why it was refused, or what happened. */
  detail: string;
}

/** Agent states the shell's `live_holders_of_branch` counts as holding the branch. */
const LIVE_HOLDER_STATES = new Set(['running', 'waiting']);

/**
 * Who holds `branch`, read the same way the shell's `live_holders_of_branch`
 * does: every manifest naming the branch, narrowed to the sessions whose
 * worker is currently `running` or `waiting`.
 */
async function liveHolders(
  branch: string,
  context: { repoRoot: string; scriptDir: string },
): Promise<readonly string[]> {
  const agents = agentsFs(context);
  const processes = processesShell(context);
  const declared = await agents.declared();
  if (!isAnswered(declared)) return [];
  const holders: string[] = [];
  for (const manifest of declared.value) {
    if (manifest.branch !== branch) continue;
    const reading = await processes.workerState(manifest.worktree, false);
    if (isAnswered(reading) && LIVE_HOLDER_STATES.has(reading.value.state)) {
      holders.push(manifest.session);
    }
  }
  return holders;
}

/**
 * The branch's PR, read through the two `Host` calls `releaseClaim` needs
 * combined into one reading — `failed`/`unaskable` pass through unchanged, so
 * silence never reads as "no PR".
 */
async function prReading(
  branch: string,
  context: { repoRoot: string; scriptDir: string },
): Promise<PortResult<ClaimReleasePrReading>> {
  const host = hostShell(context);
  const state = await host.prState(branch);
  if (!isAnswered(state)) return state.why === 'unaskable' ? unaskable() : failed();
  const merged = await host.prMerged(branch);
  if (!isAnswered(merged)) return merged.why === 'unaskable' ? unaskable() : failed();
  if (state.value === null) {
    return answered({ open: false, merged: merged.value === 'merged', number: 0, state: '' });
  }
  return answered({
    open: state.value.state === 'OPEN',
    merged: merged.value === 'merged' || state.value.state === 'MERGED',
    number: state.value.number,
    state: state.value.state,
  });
}

/**
 * Gathers the readings `releaseClaim` needs, decides, and — on a decision
 * with a claim to release — runs the script. ONE FUNCTION so the route and
 * the CLI share one decision rather than two copies of it.
 *
 * @returns the outcome, never throwing: a gathering failure refuses exactly
 *   as `releaseClaim` itself refuses an `unknown` PR reading.
 */
export async function gatherReadingsAndRelease(
  branch: string,
  context: { repoRoot: string; scriptDir: string },
): Promise<{ status: number; result: ReleaseClaimResult }> {
  const refs = refsGit(context);
  const [branches, holders, pr] = await Promise.all([
    refs.listBranches(true),
    liveHolders(branch, context),
    prReading(branch, context),
  ]);
  const claimed = (isAnswered(branches) && branches.value.includes(branch)) || holders.length > 0;
  const readings: ClaimReleaseReadings = { branch, claimed, holders, pr };
  const outcome = releaseClaim(readings);

  if (refused(outcome)) {
    return {
      status: 409,
      result: { branch, released: false, hadClaim: true, detail: outcome.reason },
    };
  }
  if (!decided(outcome)) {
    return {
      status: 500,
      result: { branch, released: false, hadClaim: true, detail: 'releaseClaim answered neither a decision nor a refusal' },
    };
  }
  if (!outcome.detail.hadClaim) {
    return {
      status: 200,
      result: { branch, released: true, hadClaim: false, detail: 'nothing to release' },
    };
  }

  const run = claimReleaseShell(context).release(branch);
  if (!isAnswered(run)) {
    return {
      status: 500,
      result: { branch, released: false, hadClaim: true, detail: 'the release script could not be run' },
    };
  }
  if (run.value.refused) {
    return {
      status: 409,
      result: { branch, released: false, hadClaim: true, detail: run.value.sentence },
    };
  }
  return {
    status: 200,
    result: { branch, released: true, hadClaim: true, detail: run.value.sentence },
  };
}
