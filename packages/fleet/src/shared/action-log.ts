import { scriptsShell } from '@plot-pm/domain/adapters';
import type { Scripts } from '@plot-pm/domain';
import { agentLogPath } from './agent-log.js';
import type { ConfigReadOptions } from './config-reader.js';

/** Where the fleet acts: the repository, its scripts, and optionally the port that runs them. */
export interface ActOptions extends ConfigReadOptions {
  /** The `Scripts` port that starts a script. Absent means the shell adapter over `scriptsDir`. */
  scripts?: Scripts;
}

/**
 * The `Scripts` port these options start scripts through.
 *
 * @param opts - where the fleet acts.
 * @returns the injected port, or the shell adapter over `opts.scriptsDir`.
 */
export const scriptsOf = (opts: ActOptions): Scripts =>
  opts.scripts ?? scriptsShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });

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
