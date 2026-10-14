import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { reviewBypasses, type MergedReview, type ReviewState } from '@plot-pm/domain/rules/review-bypass';
import type { Host } from '@plot-pm/domain';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The `node` entry point section 20a of `plot-reconcile-scan.sh` runs.
 *
 * ```
 * plot-review-bypass.mjs --since <ISO date | ''> [--limit <n>]
 * ```
 *
 * Lists the merged PRs, reads each PR's `plot/review` status and bypass
 * comment through the `Host` port, and prints what `reviewBypasses` decides.
 * Each reported PR is one line starting `  PR #<n>`, so a caller counts
 * findings with `grep -c '^  PR #'`. A PR whose read failed is named on a
 * line starting `  unread PR #<n>`; it is never skipped and never counted as
 * a bypass. The line `(none` is printed only when no PR is reported and no
 * read failed. With an empty `--since` the command asks the host nothing and
 * prints that the section was not evaluated.
 *
 * Exit 0 after an answer, 2 on bad arguments, 3 when the merged list itself
 * cannot be read.
 */

/** The review states the host may report, as the rule reads them. */
const STATES: readonly ReviewState[] = ['success', 'failure', 'pending'];

/** Default size of the merged-PR list. */
const DEFAULT_LIMIT = 100;

/**
 * Reads every merged PR's review.
 *
 * @param host - the host to ask.
 * @param limit - how many merged PRs to list.
 * @returns the readings and whether the list reached its limit, or null when
 *   the merged list cannot be read.
 */
export const readMerged = async (
  host: Host,
  limit: number,
): Promise<{ readings: MergedReview[]; truncated: boolean } | null> => {
  const listed = await host.prList('merged', limit);
  if (!listed.ok) return null;
  const readings: MergedReview[] = [];
  for (const pr of listed.value) {
    if (pr.mergedAt === null) continue;
    const read = await host.prReview(pr.number);
    const review: ReviewState = !read.ok
      ? 'unread'
      : (STATES.find((s) => s === read.value.state) ?? 'absent');
    readings.push({
      number: pr.number,
      mergedAt: pr.mergedAt,
      review,
      bypassed: read.ok && read.value.bypass,
    });
  }
  return { readings, truncated: listed.value.length >= limit };
};

/**
 * Renders the rule's report.
 *
 * @param report - what `reviewBypasses` decided.
 * @returns the lines to print.
 */
export const render = (report: ReturnType<typeof reviewBypasses>): string[] => {
  if (report.kind === 'off') {
    return ['  (not evaluated — no `Review required since` key is set, so no merge is held to the rule)'];
  }
  const lines = [
    ...report.bypasses.map(
      (n) => `  PR #${n} merged with no passing plot/review and no review-bypass: comment`,
    ),
    ...report.unread.map((n) => `  unread PR #${n} — the host read failed; its review is unknown`),
  ];
  if (lines.length === 0) {
    lines.push('  (none — every examined merge carries a passing plot/review or a bypass note)');
  }
  return lines;
};

/**
 * Runs the command.
 *
 * @param host - the host to ask.
 * @param since - the cutoff value, or an empty string for none.
 * @param limit - the merged-list size.
 * @param write - where lines go.
 * @returns the exit code.
 */
export const run = async (
  host: Host,
  since: string,
  limit: number,
  write: (line: string) => void,
): Promise<number> => {
  if (since === '') {
    for (const line of render(reviewBypasses([], null))) write(line);
    return 0;
  }
  const merged = await readMerged(host, limit);
  if (merged === null) {
    write('  (not evaluated — the merged-PR list could not be read from the host)');
    return 3;
  }
  for (const line of render(reviewBypasses(merged.readings, since))) {
    write(line);
  }
  if (merged.truncated) {
    write(`  note: merged-PR list hit its limit of ${limit} — older merged PRs were not examined.`);
  }
  return 0;
};

/**
 * Reads one flag's value from the arguments.
 *
 * @param args - the arguments after the script name.
 * @param flag - the flag to find.
 * @returns the value after the flag, or undefined.
 */
const flagValue = (args: readonly string[], flag: string): string | undefined => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const since = flagValue(args, '--since');
  const limit = Number(flagValue(args, '--limit') ?? DEFAULT_LIMIT);
  if (since === undefined || !Number.isInteger(limit) || limit < 1) {
    process.stderr.write('usage: plot-review-bypass.mjs --since <ISO date | \'\'> [--limit <n>]\n');
    process.exit(2);
  }
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = process.env.PLOT_REPO_ROOT ?? process.cwd();
  process.exit(
    await run(hostShell({ repoRoot, scriptDir }), since, limit, (l) => process.stdout.write(`${l}\n`)),
  );
}
