// THROUGH THE NARROW PATHS, not the package root. `@plot-pm/domain` re-exports
// every entity and rule, and esbuild bundles what it is given: measured
// 2026-09-03, the root import produced a 334 KB artifact against
// `plot-movable.mjs`'s 1.2 KB — the whole domain, on the launch path of every
// worker, to answer which file to source.
import { readCharter, charterPath, type CharterReading } from '@plot-pm/domain/entities/charter';
import { resolvePrompt } from '@plot-pm/domain/rules/prompt';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-worker-loop.sh` runs once, before its first
 * prompt.
 *
 * ```
 * node plot-prompt.mjs /repo reviewer
 * declared	.plot/prompts/reviewer.sh	reviewer
 * ```
 *
 * **A SIXTH artifact, for the reason the third, fourth and fifth ones give.**
 * `plot-ask.mjs` answers by RUNNING `plot-fleet-scan.sh`, so a worker loop
 * asking it would start a scan to find out which prompt to source. This bundle
 * reads one file and spawns nothing.
 *
 * **A bundle rather than an inline import of the domain source.**
 * `plot-worker-loop.sh` is vendored into the published npm package, where
 * `packages/` does not exist — an import through the checkout's path would
 * resolve only in the plot repo, and every worker elsewhere would fall back
 * without saying so.
 *
 * **Tab-separated out.** The caller is bash reading one line, and JSON would
 * mean a `jq` dependency on the launch path.
 */

/**
 * Read the named agent's charter from disk.
 *
 * A MISSING FILE IS `absent`, NOT AN ERROR. Every other read failure — a
 * directory in the charter's place, a permission denial — is `unreadable`,
 * because something is there and could not be believed. Collapsing the two
 * would let an unreadable charter run the fallback prompt silently.
 *
 * @param repoRoot - the repo root the charter path is relative to.
 * @param name - the agent name, or `''` when nothing named one.
 * @returns what the charter says, or why it could not be read.
 */
export const read = (repoRoot: string, name: string): CharterReading => {
  if (name === '') return { read: 'unnamed' };
  const path = `${repoRoot}/${charterPath(name)}`;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return readCharter(name, null);
    return { read: 'unreadable', name, why: `${path}: ${(err as Error).message}` };
  }
  return readCharter(name, text);
};

/**
 * Decide which prompt this agent runs.
 *
 * @param repoRoot - the repo root.
 * @param name - the agent name, or `''`.
 * @returns `<resolution>\t<prompt>\t<detail>`; the prompt is empty on a refusal.
 */
export const answer = (repoRoot: string, name: string): string => {
  const resolution = resolvePrompt(read(repoRoot, name));
  switch (resolution.resolve) {
    case 'declared':
      return `declared\t${resolution.prompt}\t${resolution.charter}\n`;
    case 'fallback':
      return `fallback\t${resolution.prompt}\t${resolution.why}\n`;
    case 'refused':
      return `refused\t\t${resolution.why}\n`;
  }
};

/**
 * Print the answer.
 *
 * @param argv - the repo root and the agent name.
 * @param write - where the answer goes.
 * @returns the process exit code — 0 resolved, 2 bad arguments, 3 refused.
 */
export const run = (
  argv: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const [repoRoot, name = ''] = argv;
  if (repoRoot === undefined || repoRoot === '') {
    process.stderr.write('plot-prompt: usage: plot-prompt.mjs <repo-root> [agent-name]\n');
    return 2;
  }
  const line = answer(repoRoot, name);
  write(line);
  // A DISTINCT CODE FOR THE REFUSAL. The caller must not launch on it, and a
  // shell reading only `$?` would otherwise treat an unbelievable charter as a
  // resolved prompt.
  return line.startsWith('refused\t') ? 3 : 0;
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(run(process.argv.slice(2)));
}
