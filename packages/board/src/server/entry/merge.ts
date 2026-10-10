import type { Host, Scripts } from '@plot-pm/domain';
import type { DefaultBranchStore } from '@plot-pm/domain/ports/default-branch';
import { merge, type MergeRefusal } from '@plot-pm/domain/workflows/merge';

/** The ports one merge needs. */
export interface MergePorts {
  host: Host;
  scripts: Scripts;
  defaultBranch: DefaultBranchStore;
}

/** What `plot-ask.mjs merge` prints, as one JSON line. */
export type MergeResult =
  | { merged: true; pr: number; sha: string; defaultBranchRead: boolean }
  | { merged: false; reason: MergeRefusal | 'host-refused'; detail: string };

/**
 * Merges a PR at the head commit the caller read, or refuses.
 *
 * Re-asks the host through `pr-state` and never the PR index: the index decides
 * only whether to try, and a merge cannot be undone. On a pass the merge goes
 * through `plot-host.sh pr-merge --match-head <sha>`, so a push between the
 * reading and the merge fails at the host. A refusal ends the action; nothing
 * retries without the pin.
 *
 * @param ports - the host, the script port and the default-branch store.
 * @param pr - the PR number.
 * @param sha - the head commit the caller read the checks for.
 * @returns the merge, or the refusal naming its reason; `host-refused` carries
 *   the host's own words.
 */
export const mergeAt = async (ports: MergePorts, pr: number, sha: string): Promise<MergeResult> => {
  const lookup = await ports.host.prState(pr);
  const reading = await ports.defaultBranch.read();
  const outcome = merge(
    {
      pr: lookup.ok ? lookup.value : 'unaskable',
      defaultBranch: reading.ok ? reading.value : null,
    },
    { pr, sha },
  );
  if (outcome.outcome === 'refused') {
    return { merged: false, reason: outcome.reason, detail: outcome.detail };
  }
  const write = outcome.writes[0];
  if (write?.kind !== 'pr-merge' || write.sha === undefined) {
    return { merged: false, reason: 'host-refused', detail: 'the merge decision carried no pinned write' };
  }
  const args = ['pr-merge', String(write.pr), '--match-head', write.sha];
  if (write.deleteBranch) args.push('--delete-branch');
  const landed = await ports.scripts.hostSaid(args);
  if (landed.answer !== 'answered') {
    return { merged: false, reason: 'host-refused', detail: landed.said };
  }
  return { merged: true, pr, sha, defaultBranchRead: outcome.detail.defaultBranchRead };
};
