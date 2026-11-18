import type { Host } from '../../ports/host.js';
import type { ShellContext } from '../scripts.js';
import type { GithubApi } from './github-api.js';
import { hostShell } from './host-shell.js';

/** The composed in-process reads of this process, by repository root. */
const composed = new Map<string, Host>();

/** The GitHub client of each composition, by repository root. */
const clients = new Map<string, GithubApi>();

/**
 * Records the `Host` this process composed for its GitHub reads in a repository,
 * so an adapter that builds its own `Host` reads through the same transport.
 *
 * @param repoRoot - the repository root the reads were composed for.
 * @param host - the composed `Host`.
 * @param api - the GitHub client the reads go through; absent on Bitbucket.
 */
export const recordHostReads = (repoRoot: string, host: Host, api?: GithubApi): void => {
  composed.set(repoRoot, host);
  if (api === undefined) clients.delete(repoRoot);
  else clients.set(repoRoot, api);
};

/**
 * The `Host` an adapter lists pull requests through: the one this process
 * composed for the repository, else the shell's.
 *
 * @param context - where the scripts and the repository are.
 * @returns the composed `Host`, or `hostShell(context)`.
 */
export const hostForReads = (context: ShellContext): Host => composed.get(context.repoRoot) ?? hostShell(context);

/**
 * The GitHub client an adapter reads runs and jobs through: the one this
 * process composed for the repository. A CI connector built without it reads
 * through the script, which lists no jobs, so a `<workflow>/<job>` name in
 * `Default branch checks` folds `unknown` there.
 *
 * @param context - where the scripts and the repository are.
 * @returns the composed client, or `undefined` where none was composed.
 */
export const apiForReads = (context: ShellContext): GithubApi | undefined => clients.get(context.repoRoot);
