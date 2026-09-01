import { firstMoveRefusal, type AheadReading, type MoveReadings, type TreeActivity }
  from '@plot-pm/domain/rules/movable';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-dispatch.sh --migrate` runs, once per worktree.
 *
 * ```
 * printf 'running\t4242\t\t0\n' | node plot-movable.mjs
 * live-worker	4242
 * ```
 *
 * **A FOURTH artifact, for the reason the third one gave.** `plot-ask.mjs`
 * answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh`, so a dispatcher
 * asking it would be an artifact calling a script that calls the dispatcher.
 * This bundle spawns nothing and reads nothing.
 *
 * **A bundle rather than the inline heredoc `plot-reap.sh` uses.** The reaper
 * imports `packages/domain/src/rules/reapable.ts` through a path derived from
 * its own checkout, which resolves only in the plot repo. `plot-dispatch.sh` is
 * vendored into the published npm package, where `packages/` does not exist —
 * the fail-safe would turn every migration into "the rule could not be asked"
 * and keep every worktree. Shipped beside the script, this resolves in both
 * layouts.
 *
 * **Tab-separated in, tab-separated out.** The caller is bash reading one line
 * per tree, and a JSON round trip would mean `jq` per worktree — a second
 * process to avoid a second format.
 */

/**
 * Parse one tree's readings: `activity<TAB>pid<TAB>dirty<TAB>ahead`.
 *
 * `ahead` is the string a `git rev-list --count` produced, so an EMPTY field or
 * a non-numeric one means the branch has no upstream and the question has no
 * answer. That reads as `unknown`, which does not refuse — refusing an
 * unanswerable question would keep every worktree in a remote-less repo.
 *
 * A malformed line is NOT skipped. A missing field would silently become the
 * permissive reading, and the permissive direction here moves a checkout an
 * agent is writing to.
 *
 * @param line the stdin document, one tree's readings
 * @returns what was measured of the tree
 * @throws when the line is not four tab-separated fields
 */
export const readingsFrom = (line: string): MoveReadings => {
  const fields = line.replace(/\n$/, '').split('\t');
  if (fields.length !== 4) {
    throw new Error(
      `expected '<activity>\\t<pid>\\t<dirty>\\t<ahead>', got '${line.replace(/\n$/, '')}'`,
    );
  }
  const [activity, activePid, dirtyPath, aheadText] = fields as [string, string, string, string];
  const count = Number(aheadText);
  const ahead: AheadReading =
    aheadText !== '' && Number.isInteger(count) && count >= 0 ? count : 'unknown';
  return {
    // Every state that is not one of the two the rule reads collapses to
    // `other`. A move asks whether someone is at the desk, not what their
    // process exited with — and an unrecognised word must not become one of
    // the two that mean something.
    activity: activity === 'running' || activity === 'waiting'
      ? (activity as TreeActivity)
      : 'other',
    activePid,
    dirtyPath,
    ahead,
  };
};

/**
 * Decide one tree.
 *
 * @param line the stdin document, one tree's readings
 * @returns `move\t` when nothing refused, else `<refusal>\t<detail>`
 */
export const answer = (line: string): string => {
  const problem = firstMoveRefusal(readingsFrom(line));
  return problem === null ? 'move\t' : `${problem.refusal}\t${problem.detail}`;
};

/**
 * Read stdin, print the answer.
 *
 * @param text the whole of stdin
 * @param write where the answer goes
 * @returns the process exit code — 0 answered, 2 unreadable input
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  try {
    write(answer(text));
    return 0;
  } catch (err) {
    process.stderr.write(`plot-movable: ${(err as Error).message}\n`);
    return 2;
  }
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
