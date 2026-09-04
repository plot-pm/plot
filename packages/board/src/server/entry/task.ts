import { taskState, type TaskReadings, type UnpushedReading }
  from '@plot-pm/domain/rules/task';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot_worker_task_state` runs, once per worktree.
 *
 * ```
 * printf '0\t1\t1\t\n' | node plot-task.mjs
 * waiting
 * ```
 *
 * **A SEVENTH artifact, for the reason the third, fourth, fifth and sixth ones
 * give.** `plot-ask.mjs` answers `board` and `fleet` by RUNNING
 * `plot-fleet-scan.sh`, and the scan SOURCES `plot-worker-state.sh` — so a
 * classifier asking `plot-ask.mjs` would be a script calling an artifact that
 * calls the script. This bundle spawns nothing and reads nothing.
 *
 * **Vendored beside `plot-worker-state.sh`**, which resolves it from its own
 * `${BASH_SOURCE[0]}` directory. That script is shipped in the published npm
 * package, where `packages/` does not exist, so an inline import of the domain
 * source would resolve only in the plot checkout.
 *
 * **It imports the rule directly rather than through the barrel.**
 * `@plot-pm/domain`'s index re-exports every entity and the entities carry
 * `zod` schemas, which is ~320 KB of validator no line here calls. The subpath
 * export exists for exactly this.
 *
 * **Tab-separated in, one word out.** The caller is a bash function inside the
 * scan's per-branch loop, and a JSON round trip there would mean `jq` per
 * branch — a second process to avoid a second format.
 */

/**
 * Parse one worktree's readings: `hasPr<TAB>blocked<TAB>dirty<TAB>unpushed`.
 *
 * Each of the first three fields is `1` for true and anything else for false,
 * which is what a shell test writes. `unpushed` is the string a
 * `git rev-list --count '@{upstream}..HEAD'` produced, so an EMPTY or
 * non-numeric field means the branch has no upstream and the question has no
 * answer — that reads as `null`, which is not `false` and must not become
 * `stalled`.
 *
 * A malformed line is NOT skipped. A missing field would silently become the
 * permissive reading, and the permissive direction here reports `finished`
 * about work nobody can see.
 *
 * @param line the stdin document, one worktree's readings
 * @returns what was measured of the worktree
 * @throws when the line is not four tab-separated fields
 */
export const readingsFrom = (line: string): TaskReadings => {
  const fields = line.replace(/\n$/, '').split('\t');
  if (fields.length !== 4) {
    throw new Error(
      `expected '<has_pr>\\t<blocked>\\t<dirty>\\t<unpushed>', got '${line.replace(/\n$/, '')}'`,
    );
  }
  const [hasPr, blocked, dirty, aheadText] = fields as [string, string, string, string];
  const count = Number(aheadText);
  const unpushed: UnpushedReading =
    aheadText !== '' && Number.isInteger(count) && count >= 0 ? count > 0 : null;
  return {
    hasPr: hasPr === '1',
    blocked: blocked === '1',
    dirty: dirty === '1',
    unpushed,
  };
};

/**
 * Decide one worktree.
 *
 * @param line the stdin document, one worktree's readings
 * @returns the task state, newline-terminated
 */
export const answer = (line: string): string => `${taskState(readingsFrom(line))}\n`;

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
    process.stderr.write(`plot-task: ${(err as Error).message}\n`);
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
