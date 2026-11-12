import { looseDelete, type Caller, type Host, type LooseDeleteRefusal, type PinnedTips, type Refs, type Trees } from '@plot-pm/domain';
import { hostShell, refsGit, refsRemoteGit, treesGit } from '@plot-pm/domain/adapters';
import { pinnedTipsFile } from '@plot-pm/domain/adapters/pinned-tips/pinned-tips-file';

/** The ports the delete controller reads and writes through; a test replaces each. */
export interface LooseDeletePorts {
  readonly host: Pick<Host, 'prState' | 'prMerged'>;
  readonly refs: Pick<Refs, 'resolve' | 'remoteSha'>;
  readonly trees: Pick<Trees, 'forBranch' | 'unpushedCommits' | 'deleteRemoteBranch'>;
  readonly pinnedTips: PinnedTips;
}

/** What {@link deleteLooseBranch} takes. */
export interface LooseDeleteInput {
  readonly repoRoot: string;
  readonly scriptsDir: string;
  readonly branch: string;
  readonly caller: Caller;
  /** The ports; the adapters over `repoRoot` where absent. */
  readonly ports?: LooseDeletePorts;
}

/** What the controller did. */
export type LooseDeleteOutcome =
  | { readonly kind: 'refused'; readonly status: number; readonly reason: LooseDeleteRefusal | 'unpinned'; readonly detail: string }
  | { readonly kind: 'failed'; readonly error: string }
  | { readonly kind: 'deleted'; readonly branch: string; readonly tip: string; readonly pin: string };

/** The adapters over one repository. */
export const loosePorts = (repoRoot: string, scriptsDir: string): LooseDeletePorts => {
  const context = { repoRoot, scriptDir: scriptsDir };
  return {
    host: hostShell(context),
    // `refsGit` answers `remoteSha` as `unaskable`; `refsRemoteGit` reads it over `git ls-remote`.
    refs: { ...refsGit(context), remoteSha: refsRemoteGit(context).remoteSha },
    trees: treesGit(context),
    pinnedTips: pinnedTipsFile({ cwd: repoRoot }),
  };
};

/**
 * Deletes the remote ref of a loose branch.
 *
 * Reads the host, this machine's checkout and the remote, and asks the
 * domain's `looseDelete`. On `delete` it pins the tip at
 * `refs/plot/reaped/<branch>/<sha>` and then deletes the remote ref pinned to
 * that tip. A refusal, or a pin that does not land, deletes nothing.
 *
 * @param input - the branch, the caller and the repository.
 * @returns the outcome; `refused` carries the status an HTTP route answers with.
 */
export const deleteLooseBranch = async (input: LooseDeleteInput): Promise<LooseDeleteOutcome> => {
  const { branch } = input;
  const ports = input.ports ?? loosePorts(input.repoRoot, input.scriptsDir);
  const [pr, merged, remoteTip, localTip, worktree] = await Promise.all([
    ports.host.prState(branch),
    ports.host.prMerged(branch),
    ports.refs.remoteSha(branch),
    ports.refs.resolve(`origin/${branch}`),
    ports.trees.forBranch(branch),
  ]);
  const unpushed = !worktree.ok
    ? ({ ok: false, why: 'failed' } as const)
    : worktree.value === null
      ? null
      : await ports.trees.unpushedCommits(worktree.value.path, []);
  const decision = looseDelete({ caller: input.caller, pr, merged, unpushed, remoteTip, localTip });
  if (decision.kind === 'refuse') {
    return { kind: 'refused', status: decision.reason === 'unattended' ? 403 : 409, reason: decision.reason, detail: decision.detail };
  }
  const pinned = await ports.pinnedTips.pin(branch, decision.tip);
  if (!pinned.ok) {
    return { kind: 'refused', status: 409, reason: 'unpinned', detail: 'the tip could not be pinned, so the branch is kept' };
  }
  const deleted = await ports.trees.deleteRemoteBranch(branch, decision.tip);
  if (!deleted.ok) {
    return { kind: 'failed', error: `could not delete '${branch}' — another push may have landed first` };
  }
  return { kind: 'deleted', branch, tip: decision.tip, pin: pinned.value };
};
