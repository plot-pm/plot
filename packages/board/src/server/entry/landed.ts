import { landed, openPr, type LookupReading, type PrReadings }
  from '@plot-pm/domain/rules/landed';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-pr-merged.sh` runs, once per question.
 *
 * ```
 * printf 'found\tnone\n' | node plot-landed.mjs
 * landed	no-open-pr
 * ```
 *
 * **A NINTH artifact, for the reason the third through eighth ones give.**
 * `plot-ask.mjs` answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh`,
 * and that scan sources the very file this one is called from — so asking
 * `plot-ask.mjs` would be a script calling an artifact that calls the script.
 * This bundle spawns nothing and reads nothing.
 *
 * **Vendored beside `plot-pr-merged.sh`**, which resolves it from its own
 * `${BASH_SOURCE[0]}` directory. Its four callers are shipped in the published
 * npm package, where `packages/` does not exist, so an inline import of the
 * domain source would resolve only in the plot checkout — and `pr_merged`
 * would then answer *not merged* about every branch, which is the safe
 * direction and a useless reaper.
 *
 * **It imports the rule directly rather than through the barrel**, for the
 * reason `task.ts` records: the index re-exports every entity and the entities
 * carry `zod` schemas, ~320 KB of validator no line here calls.
 *
 * **Tab-separated in, two words out.** The caller is a bash function on the
 * reaper's per-branch loop, and a JSON round trip there would mean `jq` per
 * branch — a second process to avoid a second format.
 *
 * **THE HOST IS ASKED IN SHELL, AND THAT IS THE LAYERING RATHER THAN A
 * SHORTCUT.** The shell function is the adapter: it runs the host CLI, and it
 * turns a failed call into `unaskable` rather than into an empty result. This
 * bundle is the domain reached from that adapter, and it decides.
 */

/**
 * Parse the readings: `merged<TAB>open`.
 *
 * Each field is a {@link LookupReading} word the adapter wrote — `found`,
 * `none`, or `unaskable`.
 *
 * AN UNRECOGNISED WORD IS NOT `unaskable`, and the difference is which side of
 * the rule a bug lands on. Reading it as `unaskable` would be safe on the merge
 * side and PERMISSIVE on the open side, where it releases a veto; refusing the
 * line outright leaves the shell to answer *not merged*, which keeps.
 *
 * @param line the stdin document, one branch's two lookups
 * @returns what the lookups produced
 * @throws when the line is not two recognised tab-separated words
 */
export const readingsFrom = (line: string): PrReadings => {
  const fields = line.replace(/\n$/, '').split('\t');
  if (fields.length !== 2) {
    throw new Error(`expected '<merged>\\t<open>', got '${line.replace(/\n$/, '')}'`);
  }
  const [merged, open] = fields as [string, string];
  return { merged: wordOf(merged, 'merged'), open: wordOf(open, 'open') };
};

/**
 * Read one lookup word.
 *
 * @param value the field as the adapter wrote it
 * @param field which lookup it belongs to, for the message
 * @returns the reading
 * @throws when the word is not one of the three
 */
const wordOf = (value: string, field: string): LookupReading => {
  if (value !== 'found' && value !== 'none' && value !== 'unaskable') {
    throw new Error(`unrecognised ${field} reading '${value}' — expected found, none or unaskable`);
  }
  return value;
};

/**
 * Decide one branch.
 *
 * BOTH ANSWERS ON ONE LINE, because the two shell functions ask about the same
 * branch and a second process per question would double the cost of the pair.
 *
 * @param line the stdin document, one branch's two lookups
 * @returns `<landed|not-landed|unknown><TAB><open-pr|no-open-pr>`, newline-terminated
 */
export const answer = (line: string): string => {
  const readings = readingsFrom(line);
  return `${landed(readings)}\t${openPr(readings) ? 'open-pr' : 'no-open-pr'}\n`;
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
    process.stderr.write(`plot-landed: ${(err as Error).message}\n`);
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
