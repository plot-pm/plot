import { hostShell, type ShellContext } from '@plot-pm/domain/adapters';
import type { Host } from '@plot-pm/domain/ports/host';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-impl-status.sh` runs for an annotated slice line.
 *
 * ```
 * node plot-pr-state.mjs 4711 quatico/the-github-side
 * {"number":4711,"state":"MERGED",…}
 * ```
 *
 * The first argument is the PR number. The second, where given, is the
 * repository a cross-repo `owner/repo#N` reference names: `Host.prState` then
 * resolves the host that repository lives on (`rules/cross-repo-probe.ts`).
 * Prints the PR as JSON, or `{"state":"NONE"}` where the host holds none.
 * Exits 2 on a bad argument, 3 where the host could not be asked, and 4 where
 * this backend has no answer at all.
 */

/**
 * Asks the host for one PR and prints the answer.
 *
 * @param argv - the arguments after the script name: number, then an optional repo.
 * @param host - the host to ask.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  host: Host,
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> => {
  const [number, repo] = argv;
  if (number === undefined || !/^[0-9]+$/.test(number)) {
    process.stderr.write(`plot-pr-state: expected a PR number, got '${number ?? ''}'\n`);
    return 2;
  }
  const answer = await host.prState(Number(number), repo !== undefined && repo !== '' ? { repo } : {});
  if (!answer.ok) {
    const said = host.lastRefusal()?.said;
    if (said) process.stderr.write(`${said}\n`);
    return answer.why === 'unaskable' ? 4 : 3;
  }
  write(`${JSON.stringify(answer.value ?? { state: 'NONE' })}\n`);
  return 0;
};

// Only when RUN, never when imported. `pathToFileURL` rather than a template,
// for the reason `panel.ts` records: `import.meta.url` is realpath-resolved.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const context: ShellContext = {
    repoRoot: process.cwd(),
    scriptDir: process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..'),
  };
  process.exit(await run(process.argv.slice(2), hostShell(context)));
}
