import { join } from 'node:path';

/** Where an adapter finds the shell scripts and which repository to ask about. */
export interface ShellContext {
  /** The repository root — every relative path an adapter reports is under it. */
  repoRoot: string;
  /** The directory holding `plot-*.sh`. */
  scriptDir: string;
}

/** Where `plot-*.sh` lives inside a repository that has adopted Plot. */
const SCRIPT_SUBDIR = 'skills/plot/scripts';

/**
 * Builds a context from a repository root, using Plot's own layout.
 *
 * @param repoRoot - the repository's absolute path.
 * @returns a context whose scripts resolve under `skills/plot/scripts`.
 */
export const shellContext = (repoRoot: string): ShellContext => ({
  repoRoot,
  scriptDir: join(repoRoot, SCRIPT_SUBDIR),
});

/**
 * Resolves one helper script's absolute path.
 *
 * @param context - where the scripts live.
 * @param name - the script's filename, such as `plot-host.sh`.
 * @returns the absolute path.
 */
export const scriptPath = (context: ShellContext, name: string): string =>
  join(context.scriptDir, name);
