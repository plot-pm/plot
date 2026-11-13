import fs from 'node:fs';
import path from 'node:path';
import { answered, failed, looseDelete, type Caller, type Host, type LooseDeleteRefusal, type PinnedTips, type PortResult, type Refs, type Trees } from '@plot-pm/domain';
import { hostShell, refsGit, refsRemoteGit, treesGit } from '@plot-pm/domain/adapters';
import { pinnedTipsFile } from '@plot-pm/domain/adapters/pinned-tips/pinned-tips-file';
import type { OriginPlanReading } from '@plot-pm/domain/rules/origin-resume';
import { originPlanFor } from './origin-desk.js';
import { resolveManifestDir } from './registry.js';

/** The ports the delete controller reads and writes through; a test replaces each. */
export interface LooseDeletePorts {
  readonly host: Pick<Host, 'prState' | 'prMerged'>;
  readonly refs: Pick<Refs, 'resolve' | 'remoteSha' | 'defaultBranch' | 'commitSubjects' | 'countAheadSync'>;
  readonly trees: Pick<Trees, 'forBranch' | 'deleteRemoteBranch'>;
  readonly pinnedTips: PinnedTips;
  /** The plan whose slice names the branch, on the default branch or a sprint branch. */
  readonly plan: (branch: string) => Promise<OriginPlanReading>;
  /** The sessions of the registry manifests that name the branch, live or not. */
  readonly manifests: (branch: string) => Promise<PortResult<readonly string[]>>;
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

/**
 * The sessions of the manifests in `dir` that name `branch`.
 *
 * A missing directory holds no manifest. Any other directory error fails the
 * reading, and a manifest that does not parse counts as naming the branch,
 * because it cannot be shown not to.
 */
const manifestsNaming = (dir: string, branch: string): PortResult<readonly string[]> => {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? answered<readonly string[]>([]) : failed<readonly string[]>();
  }
  const holders: string[] = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>;
      if (m.branch === branch) holders.push(typeof m.session === 'string' && m.session !== '' ? m.session : name);
    } catch {
      holders.push(name);
    }
  }
  return answered<readonly string[]>(holders);
};

/** The adapters over one repository. */
export const loosePorts = (repoRoot: string, scriptsDir: string): LooseDeletePorts => {
  const context = { repoRoot, scriptDir: scriptsDir };
  const refs = refsGit(context);
  return {
    host: hostShell(context),
    // `refsGit` answers `remoteSha` as `unaskable`; `refsRemoteGit` reads it over `git ls-remote`.
    refs: { ...refs, remoteSha: refsRemoteGit(context).remoteSha },
    trees: treesGit(context),
    pinnedTips: pinnedTipsFile({ cwd: repoRoot }),
    plan: (branch) => originPlanFor(refs, context, branch),
    manifests: async (branch) => manifestsNaming(resolveManifestDir(repoRoot, { scriptsDir }), branch),
  };
};

/**
 * Deletes the remote ref of a loose branch.
 *
 * Reads the default branch, the plans, this machine's desks and registry, the
 * branch's commits, the host and the remote, and asks the domain's
 * `looseDelete`. On `delete` it pins the tip at
 * `refs/plot/reaped/<branch>/<sha>` and then deletes the remote ref pinned to
 * that tip. A refusal, or a pin that does not land, deletes nothing.
 *
 * @param input - the branch, the caller and the repository.
 * @returns the outcome; `refused` carries the status an HTTP route answers with.
 */
export const deleteLooseBranch = async (input: LooseDeleteInput): Promise<LooseDeleteOutcome> => {
  const { branch } = input;
  const ports = input.ports ?? loosePorts(input.repoRoot, input.scriptsDir);
  const defaultBranch = await ports.refs.defaultBranch();
  const [plan, worktree, manifests, commits, pr, merged, remoteTip, localTip, localRef] = await Promise.all([
    ports.plan(branch),
    ports.trees.forBranch(branch),
    ports.manifests(branch),
    defaultBranch.ok && defaultBranch.value !== ''
      ? ports.refs.commitSubjects(`origin/${defaultBranch.value}..origin/${branch}`)
      : Promise.resolve(failed<never>()),
    ports.host.prState(branch),
    ports.host.prMerged(branch),
    ports.refs.remoteSha(branch),
    ports.refs.resolve(`origin/${branch}`),
    ports.refs.resolve(`refs/heads/${branch}`),
  ]);
  const desk: PortResult<boolean> = worktree.ok ? answered(worktree.value !== null) : failed<boolean>();
  const unpushed = localRef.ok && localRef.value !== '' ? ports.refs.countAheadSync(branch) : null;
  const decision = looseDelete({
    caller: input.caller, branch, defaultBranch, plan, desk, manifests, commits, pr, merged, unpushed, remoteTip, localTip,
  });
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
