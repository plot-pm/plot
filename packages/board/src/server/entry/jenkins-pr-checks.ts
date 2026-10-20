import {
  bindChecks,
  rowsToBind,
  SHA_LOOKUPS_PER_PASS,
  type BoundChecks,
  type JenkinsShaRun,
  type PrRowHead,
} from '@plot-pm/domain/rules/jenkins-pr-checks';
import { bitbucketPrState, bitbucketReview } from '@plot-pm/domain/rules/bitbucket-pr-reading';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Binds Jenkins PR-row checks to head commits — the rules `rowsToBind` and
 * `bindChecks` reached from `plot-host.sh`, once per `pr-list` pass.
 *
 * ```
 * { jq -c . <<<"$colours"; jq -c . <<<"$rows"; jq -c . <<<"${bound:-null}"; } | plot-jenkins-pr-checks.mjs rows
 * <branch>\t<sha>\t<job>                      # one row to read by sha
 * printf '<branch>\t<sha>\t<job>\t<runs json>\n' | plot-jenkins-pr-checks.mjs bind
 * {"<branch>":{"checks":"green","job":"<job>","checksSha":"<sha>"}}
 * ```
 *
 * `rows`'s third stdin line is the caller's PR index, read-only: branch ->
 * the `checksSha` already on record there. Absent (`null` or no line) where
 * the caller holds no index — every row then sorts exactly as it always has.
 * See `rowsToBind`'s rotation note.
 *
 * Two more verbs fold what the shell read for Bitbucket (`pr-state`, `pr-review`):
 *
 * ```
 * printf '<pr json|null>\n<colours json|null>\n<bound json|null>\n' | plot-jenkins-pr-checks.mjs state
 * printf '<sha>\n<statuses json>\n<comments json>\n' | plot-jenkins-pr-checks.mjs review
 * ```
 *
 * The shell keeps the transport: it makes the Jenkins call per listed row and
 * the branch-colour map. This entry reads stdin only and spawns nothing.
 *
 * `bind` answers only the rows whose `<runs json>` is a JSON array. A row whose
 * lookup could not ask Jenkins is left out or carries anything else, and the
 * branch colour stands for it.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The rule answered. */
  ok: 0,
  /** The caller named no verb, or one this does not have. */
  usage: 2,
} as const;

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

/**
 * Answers the verb.
 *
 * @param argv - the arguments after the script name.
 * @param stdin - the readings.
 * @param write - where the answer goes.
 * @param warn - where a usage refusal goes.
 * @returns the process exit code.
 */
export const run = (
  argv: string[],
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  const verb = argv[0];
  if (verb !== 'rows' && verb !== 'bind' && verb !== 'state' && verb !== 'review') {
    warn('plot-jenkins-pr-checks: usage: plot-jenkins-pr-checks.mjs <rows|bind|state|review> < readings\n');
    return EXIT.usage;
  }
  const lines = stdin.split('\n').filter((l) => l !== '');
  if (verb === 'state') {
    const [pr, colours, bound] = [0, 1, 2].map((i) => parseLine(lines[i] ?? ''));
    write(`${JSON.stringify(bitbucketPrState(pr as never, colours as never, bound as never))}\n`);
    return EXIT.ok;
  }
  if (verb === 'review') {
    const [statuses, comments] = [1, 2].map((i) => (parseLine(lines[i] ?? '') as { values?: never[] } | null)?.values ?? []);
    write(`${JSON.stringify(bitbucketReview(lines[0] ?? '', statuses, comments))}\n`);
    return EXIT.ok;
  }
  if (verb === 'rows') {
    const colours = parseLine(lines[0] ?? '');
    const rows = parseLine(lines[1] ?? '');
    if (colours === null || typeof colours !== 'object' || !Array.isArray(rows)) return EXIT.ok;
    const parsedBound = parseLine(lines[2] ?? '');
    const bound = parsedBound !== null && typeof parsedBound === 'object'
      ? (parsedBound as Record<string, string>)
      : {};
    for (const r of rowsToBind(
      rows as PrRowHead[], colours as Record<string, { checks?: string; job?: string }>,
      SHA_LOOKUPS_PER_PASS, bound,
    )) {
      write(`${r.branch}\t${r.sha}\t${r.job}\n`);
    }
    return EXIT.ok;
  }
  const bound: Record<string, BoundChecks> = {};
  for (const line of lines) {
    const [branch, sha, job, runs] = line.split('\t');
    const parsed = parseLine(runs ?? '');
    if (branch === undefined || sha === undefined || job === undefined) continue;
    const hit = bindChecks(Array.isArray(parsed) ? (parsed as JenkinsShaRun[]) : null, job, sha);
    if (hit !== null) bound[branch] = hit;
  }
  write(`${JSON.stringify(bound)}\n`);
  return EXIT.ok;
};

// Only when RUN, never when imported; `pathToFileURL` for the macOS `/tmp`
// symlink reason `merge-subject.ts` records.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(process.argv.slice(2), Buffer.concat(chunks).toString('utf8')));
}
