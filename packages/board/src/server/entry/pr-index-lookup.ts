import { prIndexFile } from '@plot-pm/domain/adapters';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { answerLookups, type PrIndexQuery } from './pr-index-lookup-answer.js';

/**
 * The `node` entry point `plot-impl-status.sh` runs, once per plan.
 *
 * ```
 * printf '447\t-\nfeature/x\t-\n' | node plot-pr-index-lookup.mjs github
 * 447	MERGED	false	https://github.com/o/r/pull/447	feature/a
 * -	ask	-	-	-
 * ```
 *
 * **THE FIRST SHELL CONSUMER OF `PrIndexStore`, and the first outside the
 * process that writes it.** The board constructs `prIndexFile()` in
 * `fleet.ts:2537` and folds a result after each host call, so the store has had
 * a reader and a writer since `83c4abdc1` — both inside one running board. What
 * had never been asked is whether a shell script can read it with no board
 * running, which is the question this bundle answers.
 *
 * **IT READS THE DISK, like `slice-spend.ts` and unlike every other entry
 * here.** The bundles beside it take their readings on stdin, which is right
 * where a reading is a handful of git answers. The store is not: 319 KB and 969
 * rows on this machine, so handing it to the shell would mean `jq` over the
 * file — and `jq` is a second implementation of `decodePrIndex`, free to drift
 * from it the first time `PR_INDEX_VERSION` moves. The reading is the adapter's,
 * which is where the layering rule puts anything that reaches the world.
 *
 * **CALLING `prIndexFile()` IS WHAT BUYS `--git-common-dir`.** A desk resolves
 * the same file as the main checkout because the adapter resolves it that way,
 * and `PLOT_PR_INDEX_HOME` is honoured for the same reason — both for free,
 * neither re-implemented. `--show-toplevel` is the defect `pr-index-file.ts`
 * documents: `plot-reap.sh` removes the desks.
 *
 * **IT READS AND NEVER WRITES.** Folding what the shell's host fallback learned
 * back into the store would put a second writer beside the board, and two
 * read-fold-write sequences on one file race: `rename` makes each WRITE atomic,
 * not the sequence around it. Whether a consumer should write is wave 2's
 * question, and it is named in this slice's PR rather than answered by
 * improvising here.
 *
 * **NO HOST, NO NETWORK, NO BOARD.** This reads one local file. The shell owns
 * every host call, which keeps `plot-host.sh` the one place that talks to the
 * host CLI — `scripts/check-host-cli-callers.sh` is the gate on that.
 *
 * ## Why `ask` is a separate word from every state
 *
 * A row this bundle will not answer from is reported as `ask`, never as an
 * absent PR. The shell then calls the host exactly as it does today. Three
 * different situations produce it — no store, no row, and a row whose state
 * could still change — and collapsing any of them into "no PR" is the failure
 * mode `an-unasked-host-is-not-an-absent-pr` is named after, in a delivery
 * gate: absent read as false, and four fully-merged plans refused.
 *
 * 326.9 KB, and the reason is the schema rather than the adapter — `slice-spend`'s
 * case exactly. `decodePrIndex` is a VALUE import that runs `entities/pr-index`'s
 * `z.object` at the top level, so zod and its locale table come with it. The
 * alternative is hand-rolling the store's validation, which is the second
 * implementation this bundle exists to avoid.
 */

/**
 * Read stdin, print one answer line per query.
 *
 * @param text the whole of stdin, one query per line
 * @param connector which connector's store to read
 * @param write where the answer goes
 * @returns the process exit code — 0 answered, 2 unreadable input
 */
export const run = async (
  text: string,
  connector: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> => {
  let queries: PrIndexQuery[];
  try {
    queries = queriesFrom(text);
  } catch (err) {
    process.stderr.write(`plot-pr-index-lookup: ${(err as Error).message}\n`);
    return 2;
  }
  // A STORE THAT COULD NOT BE READ IS `null`, WHICH ANSWERS `ask` FOR EVERY
  // QUERY. The port already answers `answered(null)` for a missing, empty,
  // unparseable or unrecognised file; `failed` is the store that exists and
  // could not be read at all. Both mean the same thing to this caller — ask the
  // host — so the two `ok: false` reasons are deliberately not told apart here.
  //
  // READ `ok`, NEVER AN INVENTED FIELD. Written first as
  // `result.outcome === 'answered'`, which is not `PortResult`'s shape: the
  // test was never true, every store read fell through to `null`, and the
  // bundle answered `ask` for a store it had just parsed. It failed SAFE — the
  // shell asked the host and the answers stayed right — so no assertion about
  // correctness could see it, and the reader read nothing. That is why the
  // store-hit test below counts HOST CALLS rather than checking the answer.
  //
  // Narrowed inline rather than through `valueOr`, which says exactly this and
  // lives in the domain's BARREL — and the barrel re-exports every entity, so
  // importing one helper from it would pull in schemas this bundle never calls.
  const result = await prIndexFile().read(connector);
  write(answerLookups(result.ok ? result.value : null, queries));
  return 0;
};

/**
 * Parse one query per line: `<number-or-dash><TAB><branch-or-dash>`.
 *
 * A line names the PR number the plan annotated, or the branch to match against
 * heads where it annotated none — the two resolutions `plot-impl-status.sh`
 * already performs, asked of the store instead of the host.
 *
 * A line that does not parse refuses the WHOLE batch rather than being skipped.
 * The caller reads the answer positionally, so a dropped line would shift every
 * answer after it onto the wrong branch — `branch-state.ts`'s reason, and the
 * same consequence here: a branch would be reported with another branch's PR.
 *
 * @param text the stdin document, one query per line
 * @returns the queries, in order
 * @throws when any non-empty line is not two tab-separated fields
 */
export const queriesFrom = (text: string): PrIndexQuery[] =>
  text
    .split('\n')
    .filter((line) => line !== '')
    .map((line, i) => {
      const fields = line.split('\t');
      if (fields.length !== 2) {
        throw new Error(
          `line ${i + 1}: expected '<number>\\t<branch>', got ${fields.length} field(s)`,
        );
      }
      const [number, branch] = fields as [string, string];
      // A NUMBER THAT IS NOT ONE IS NOT COERCED TO ZERO. `0` is a PR number no
      // host issues, so a coerced value would look up a row that cannot exist
      // and answer `ask` — right by accident, and silent about a plan whose
      // annotation the shell mis-read.
      if (number !== '-' && !/^[0-9]+$/.test(number)) {
        throw new Error(`line ${i + 1}: '${number}' is not a PR number`);
      }
      return {
        number: number === '-' ? null : Number(number),
        branch: branch === '-' ? null : branch,
      };
    });

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const connector = process.argv[2] ?? 'github';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(await run(Buffer.concat(chunks).toString('utf8'), connector));
}
