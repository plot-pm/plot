import { proposeStack, type StackProposal, type StackReadings }
  from '@plot-pm/domain/rules/stack';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `/plot-init` and `/plot-board-setup` run, once per
 * adoption.
 *
 * ```
 * plot-detect-repo.sh | node plot-propose-stack.mjs
 * {"node":{...},"commitStyle":{...},"ticket":{...},"language":{...}}
 * ```
 *
 * **ITS OWN BUNDLE, NOT A VERB ON `plot-ask.mjs`.** One bundle per question is
 * the seam `a-shell-script-asks-the-domain` settled: a caller asking what a
 * repository's readings propose should not load the fleet controller to get an
 * answer. The cost is stated rather than argued away — a bundle is a third of a
 * megabyte whatever the question, and `docs/shell-and-domain.md` licenses it
 * because this runs once per operator command, where `node`'s 34 ms start is
 * free.
 *
 * **JSON IN, JSON OUT**, where the sibling entries take tab-separated words.
 * The readings are nested and the caller is an agent reading a proposal rather
 * than a bash loop reading one word per line; a flat wire here would mean the
 * skill re-assembling the shape it just took apart.
 *
 * **IT ACCEPTS BOTH COLLECTORS' REPORTS AND NEEDS NEITHER WHOLE.** Adoption
 * reads two probes and `/plot-board-setup` merges them, so this takes the
 * merged object and reads only the fields it judges. A field it does not know
 * is ignored rather than refused: the collectors grow, and a bundle that
 * refused an unknown key would fail on the next field either one adds.
 */

/**
 * The probe-report reader, from the module both entries share.
 *
 * **IT MOVED OUT OF THIS FILE, and the reason is a measured failure.**
 * `entry/adopt.ts` needs the same mapping and imported it from here on
 * 2026-09-09; the bundle then ran THIS file's main block, because an imported
 * entry's `import.meta.url` is the bundle's own path and its
 * `pathToFileURL(process.argv[1])` comparison matches too. `plot-adopt.mjs`
 * printed a `StackProposal` and exited before its own main block ran.
 *
 * So it lives in `stack-readings.ts` — a module with no main block — and both
 * entries import it. Re-exported here because that is where every caller and
 * the existing test already reach for it.
 */
export { readingsFrom } from './stack-readings.js';

/**
 * Judge one probe report.
 *
 * @param text the whole of stdin, one JSON object
 * @returns the proposals, as one JSON object and a newline
 * @throws when stdin is not one JSON object
 */
export const answer = (text: string): string => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected one JSON object on stdin');
  }
  const proposal: StackProposal = proposeStack(readingsFrom(parsed as Record<string, unknown>));
  return `${JSON.stringify(proposal)}\n`;
};

/**
 * Read stdin, print the proposals.
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
    process.stderr.write(`plot-propose-stack: ${(err as Error).message}\n`);
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
