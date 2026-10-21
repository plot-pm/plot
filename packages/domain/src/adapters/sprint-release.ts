import { runProcess } from './run-script.js';
import { scriptPath, type ShellContext } from './scripts.js';

/** The collector that reports every active sprint's `Release:` target and Must-haves. */
const COLLECTOR = 'plot-sprint-release.sh';

/**
 * Runs `plot-sprint-release.sh` and returns its JSON report.
 *
 * The collector's stderr is dropped and its exit code is not read: a caller
 * treats a non-empty report as the answer and an empty one as "the sprint
 * estate could not be read".
 *
 * @param context - where the scripts and the repository are.
 * @param args - the collector's arguments: one sprint slug, or none for every active sprint.
 * @returns the collector's stdout, trimmed; `''` where it wrote nothing.
 */
export const sprintReleaseFactsShell = async (context: ShellContext, args: readonly string[]): Promise<string> => {
  const said = await runProcess('bash', [scriptPath(context, COLLECTOR), ...args], { cwd: context.repoRoot });
  return said.stdout.trim();
};
