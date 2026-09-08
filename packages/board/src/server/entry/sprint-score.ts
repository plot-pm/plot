import { scoreItem, type PlanDelivery, type SprintItem }
  from '@plot-pm/domain/entities/sprint';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-sprint-release.sh` runs, once per invocation.
 *
 * ```
 * printf 'true\tsome-plan\tfalse\nfalse\t\tnone\n' | node plot-sprint-score.mjs
 * disputed
 * open
 * ```
 *
 * **WHY A CALL RATHER THAN A DUPLICATE.** `docs/shell-and-domain.md` puts a
 * script that runs once per operator command on the calling side: 39 ms against
 * a command a person waited to type is free. `plot-sprint-release.sh` runs when
 * `/plot-release` asks it, not per agent per pass — so it calls, and holds no
 * copy of the rule.
 *
 * **ONE INVOCATION FOR THE WHOLE SPRINT, not one per item.** Every line of
 * stdin is one item and every line of stdout is its status, in the same order.
 * A hop per item would pay 39 ms 134 times for a rule that is three branches.
 *
 * **Tab-separated in, one word out per line.** The caller is bash reading one
 * line per item; a JSON round trip would mean `jq` per item — a second process
 * to avoid a second format.
 */

/**
 * Parse one item's readings: `checked<TAB>slug<TAB>delivered`.
 *
 * `delivered` is the shell's own three-valued word — `true`, `false` or `none`
 * — and `none` means the line names no plan, which the domain now expresses as
 * `'no-plan-named'`. Any other word is NOT coerced: a reading the shell did not
 * produce means the two sides disagree about the wire, and guessing which was
 * meant is how a permissive default gets written.
 *
 * A malformed line is not skipped. A missing field would silently become the
 * permissive reading, and the permissive direction here reports work as done.
 *
 * @param line one item's readings
 * @returns the item and what the estate says about its plan
 * @throws when the line is not three tab-separated fields, or the fields are
 *   not words this wire carries
 */
export const readingFrom = (line: string): { item: SprintItem; delivered: PlanDelivery } => {
  const fields = line.split('\t');
  if (fields.length !== 3) {
    throw new Error(`expected '<checked>\\t<slug>\\t<delivered>', got '${line}'`);
  }
  const [checked, slug, delivered] = fields as [string, string, string];
  if (checked !== 'true' && checked !== 'false') {
    throw new Error(`expected checked 'true' or 'false', got '${checked}'`);
  }
  if (delivered !== 'true' && delivered !== 'false' && delivered !== 'none') {
    throw new Error(`expected delivered 'true', 'false' or 'none', got '${delivered}'`);
  }
  return {
    // `tier`, `text` and `annotation` do not reach `scoreItem`. They are not
    // sent over the wire for that reason: a field a rule never reads is a field
    // two sides can drift on for free.
    item: { tier: 'must', checked: checked === 'true', plan: slug, text: '', annotation: '' },
    delivered: delivered === 'none' ? 'no-plan-named' : delivered === 'true',
  };
};

/**
 * Score every item stdin carries.
 *
 * @param text the whole of stdin, one item per line
 * @returns one status per line, in the order the items arrived
 */
export const answer = (text: string): string => {
  const lines = text.replace(/\n$/, '').split('\n');
  // An EMPTY document is not one empty item. A sprint tier with no items is
  // normal, and `''.split('\n')` is `['']`, which would reach the parser as a
  // malformed line and refuse a sprint that is merely short.
  if (text.replace(/\n$/, '') === '') return '';
  return `${lines.map((line) => {
    const { item, delivered } = readingFrom(line);
    return scoreItem(item, delivered);
  }).join('\n')}\n`;
};

/**
 * Read stdin, print the answers.
 *
 * @param text the whole of stdin
 * @param write where the answers go
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
    process.stderr.write(`plot-sprint-score: ${(err as Error).message}\n`);
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
