import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DeskManifest } from '@plot-pm/domain/rules/desk-manifest';
import { deskManifestFor } from '../../shared/manifest-stamp.js';
import { readDeskLoop, type DeskLoopReading } from '../../shared/desk-loop.js';

/**
 * Whether each desk holds a live loop — `deskLoopAlive` and `deskWaitsFree`
 * reached without HTTP, for `plot-dispatch.sh`'s `--start`, `--stop` and
 * `--restart`.
 *
 * ```
 * printf '%s\n' "$desk" | plot-desk-loop.mjs
 * alive	4711	.plot-worker.pid	free    # the loop records a free wait
 * alive	4711	manifest pid	held        # a live loop with no free wait
 * none                                     # no recorded pid is alive
 *
 * git worktree list --porcelain | awk … | plot-desk-loop.mjs --count
 * 3
 * ```
 *
 * One desk path per stdin line, one answer line per desk in the same order.
 * The pids are read in `deskLoopAlive`'s order: `.plot-worker.pid`, then the
 * manifest's `pid`, then its `wrapperPid`. `EPERM` reads as alive.
 *
 * The manifest directory is `PLOT_MANIFEST_DIR` when the caller sets it, and
 * otherwise the `Agent registry` key resolved from the working directory.
 *
 * Exit 0 with an answer, 2 for an unknown argument. A caller reads a non-zero
 * exit as *not read*, never as `none`.
 */

/** What reads a desk; injected in tests. */
export interface DeskLoopDeps {
  /** Which manifest names the desk. */
  readonly manifestFor: (worktree: string) => DeskManifest;
  /** The loop reading for one desk. */
  readonly read: (worktree: string, manifest: DeskManifest) => DeskLoopReading;
}

/**
 * One answer line for a loop reading.
 *
 * @param reading - the desk's loop and free-wait reading.
 * @returns `alive\t<pid>\t<source>\t<free|held>` or `none`.
 */
export const answerLine = ({ loop, waitsFree }: DeskLoopReading): string =>
  loop.kind === 'alive' ? `alive\t${loop.pid}\t${loop.source}\t${waitsFree ? 'free' : 'held'}` : 'none';

/**
 * Answers for the desks named on stdin.
 *
 * @param argv - `[]` for one line per desk, `['--count']` for the number of live loops.
 * @param stdin - desk paths, one per line; blank lines are skipped.
 * @param deps - the manifest lookup and the loop reading.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = (
  argv: readonly string[],
  stdin: string,
  deps: DeskLoopDeps,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const count = argv.length === 1 && argv[0] === '--count';
  if (argv.length > 0 && !count) {
    process.stderr.write('plot-desk-loop: usage: plot-desk-loop.mjs [--count] < desk paths, one per line\n');
    return 2;
  }
  const lines = stdin
    .split('\n')
    .filter((desk) => desk !== '')
    .map((desk) => answerLine(deps.read(desk, deps.manifestFor(desk))));
  write(count ? `${lines.filter((line) => line.startsWith('alive\t')).length}\n` : lines.map((line) => `${line}\n`).join(''));
  return 0;
};

// Only when RUN, never when imported. `pathToFileURL` over `realpathSync`
// because `import.meta.url` is realpath-resolved and `process.argv[1]` is not.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptsDir =
    process.env.PLOT_SCRIPTS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifestDir = process.env.PLOT_MANIFEST_DIR || undefined;
  const repoRoot = process.cwd();
  process.exit(
    run(process.argv.slice(2), readFileSync(0, 'utf8'), {
      manifestFor: (desk) => deskManifestFor(repoRoot, desk, { manifestDir, scriptsDir }),
      read: readDeskLoop,
    }),
  );
}
