import { proposeStack, type CiSignals, type StackProposal, type StackReadings }
  from '@plot-pm/domain/rules/stack';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `/plot-init` and `/plot-board-setup` run, once per
 * adoption.
 *
 * ```
 * plot-detect-repo.sh | node plot-propose-stack.mjs
 * {"node":{...},"commitStyle":{...},"ticket":{...},"language":{...},"ci":{...}}
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
 * Read one number from a probe's report.
 *
 * @param value what the field held
 * @param fallback what an absent or unreadable field means
 * @returns the number, or the fallback
 */
const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Read one string from a probe's report.
 *
 * @param value what the field held
 * @returns the string, or `''` where the field was absent or not a string
 */
const stringOr = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Read the CI signals from a probe's report.
 *
 * **AN ABSENT `ci_signals` IS `null`, NEVER `{false, false}`.** The two say
 * different things — *the collector did not look* against *the collector looked
 * and the tree shows nothing* — and only the second licenses writing no `CI:`
 * key on the repository's behalf. `plot-detect-repo.sh` does not report the
 * field yet, so `null` is the answer on this estate today.
 *
 * @param value what the `ci_signals` field held
 * @returns the two signals, or `null` where the field was absent or not an
 *   object
 */
const ciSignalsFrom = (value: unknown): CiSignals | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const signals = value as Record<string, unknown>;
  return {
    jenkinsfile: signals.jenkinsfile === true,
    ghWorkflows: signals.gh_workflows === true,
  };
};

/**
 * Turn a merged probe report into the readings the rule takes.
 *
 * **AN ABSENT FIELD IS A READING NOBODY TOOK, and it is read that way.** A
 * missing `node_floor` means the repository pins nothing, which the rule
 * answers `null` for rather than assuming a floor; a missing count is zero
 * matches, which proposes nothing. Neither is coerced into the reassuring
 * direction.
 *
 * @param report the merged JSON the two collectors printed
 * @returns the readings, with every absent field read as *nothing was found*
 */
export const readingsFrom = (report: Record<string, unknown>): StackReadings => {
  const styles = (report.commit_style_counts ?? {}) as Record<string, unknown>;
  return {
    nodeVersion: stringOr(report.node),
    nodeFloor:
      typeof report.node_floor === 'number' && Number.isFinite(report.node_floor)
        ? report.node_floor
        : null,
    commitStyleCounts: {
      colon: numberOr(styles.colon, 0),
      dash: numberOr(styles.dash, 0),
      conventional: numberOr(styles.conventional, 0),
    },
    ticketPrefix: stringOr(report.ticket_prefix),
    ticketPrefixCount: numberOr(report.ticket_prefix_count, 0),
    subjectsRead: numberOr(report.subjects_read, 0),
    germanWordCount: numberOr(report.german_words, 0),
    hasHubDoc: stringOr(report.hub_docs) !== '',
    ciSignals: ciSignalsFrom(report.ci_signals),
  };
};

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
