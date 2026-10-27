import { scriptsShell, planStoreShell, hostShell, refsGit } from '@plot-pm/domain/adapters';
import type { Host, PlanStore, Refs, Scripts } from '@plot-pm/domain';
import { agentLogPath } from './agent-log.js';
import type { ConfigReadOptions } from './config-reader.js';

/** Where the fleet acts: the repository, its scripts, and optionally the ports that read/run them. */
export interface ActOptions extends ConfigReadOptions {
  /** The `Scripts` port that starts a script. Absent means the shell adapter over `scriptsDir`. */
  scripts?: Scripts;
  /** The `PlanStore` port that reads plan files. Absent means the shell adapter over `repoRoot`. */
  planStore?: PlanStore;
  /** The `Host` port that names a merge commit. Absent means the shell adapter over `repoRoot`. */
  host?: Host;
  /** The `Refs` port that reads a commit's files. Absent means the git adapter over `repoRoot`. */
  refs?: Refs;
}

/**
 * The `Scripts` port these options start scripts through.
 *
 * @param opts - where the fleet acts.
 * @returns the injected port, or the shell adapter over `opts.scriptsDir`.
 */
export const scriptsOf = (opts: ActOptions): Scripts =>
  opts.scripts ?? scriptsShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });

/**
 * The `PlanStore` port these options read plan files through.
 *
 * @param opts - where the fleet acts.
 * @returns the injected port, or the shell adapter over `opts.repoRoot`.
 */
export const planStoreOf = (opts: ActOptions): PlanStore =>
  opts.planStore ?? planStoreShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });

/**
 * The `Host` port these options ask about merge commits through.
 *
 * @param opts - where the fleet acts.
 * @returns the injected port, or the shell adapter over `opts.repoRoot`.
 */
export const hostOf = (opts: ActOptions): Host =>
  opts.host ?? hostShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });

/**
 * The `Refs` port these options read commits through.
 *
 * @param opts - where the fleet acts.
 * @returns the injected port, or the git adapter over `opts.repoRoot`.
 */
export const refsOf = (opts: ActOptions): Refs =>
  opts.refs ?? refsGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });

/** The fan-out Plot ships — the one this package starts, never a path a caller holds. */
export const DISPATCH_SCRIPT = 'plot-dispatch.sh';

/**
 * Where a dispatch writes its output, for a click and for the fleet alike.
 *
 * One file per plan slug, so an operator reads the same log whether the
 * dispatch was clicked or automatic. `<worktree>/.plot-worker.log` is not this
 * file: that one records what the agent is doing, this one what the dispatcher
 * did.
 *
 * @param repoRoot - the repository the fleet serves.
 * @param slug - the plan slug.
 * @returns an absolute path; the file need not exist.
 */
export const dispatchLogPath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'dispatch', slug, 'log');

/**
 * Where a delivery writes its output — the neighbourhood `dispatchLogPath` uses.
 *
 * @param repoRoot - the repository the fleet serves.
 * @param slug - the plan slug.
 * @returns an absolute path; the file need not exist.
 */
export const deliverLogPath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'deliver', slug, 'log');

/**
 * Where a verification run writes its output.
 *
 * @param repoRoot - the repository the fleet serves.
 * @param slug - the plan slug.
 * @returns an absolute path; the file need not exist.
 */
export const verifyLogPath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'verify', slug, 'log');
