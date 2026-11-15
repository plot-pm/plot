import type { Host } from '../../ports/host.js';
import type { ShellContext } from '../scripts.js';
import { hostShell } from './host-shell.js';

/** The composed in-process reads of this process, by repository root. */
const composed = new Map<string, Host>();

/**
 * Records the `Host` this process composed for its GitHub reads in a repository,
 * so an adapter that builds its own `Host` reads through the same transport.
 *
 * @param repoRoot - the repository root the reads were composed for.
 * @param host - the composed `Host`.
 */
export const recordHostReads = (repoRoot: string, host: Host): void => {
  composed.set(repoRoot, host);
};

/**
 * The `Host` an adapter lists pull requests through: the one this process
 * composed for the repository, else the shell's.
 *
 * @param context - where the scripts and the repository are.
 * @returns the composed `Host`, or `hostShell(context)`.
 */
export const hostForReads = (context: ShellContext): Host => composed.get(context.repoRoot) ?? hostShell(context);
