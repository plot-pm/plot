import {
  sample,
  publication,
  type MonitorReading,
  type MonitorVerdict,
} from '@plot-pm/domain/rules/sample';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-worker-monitor.sh` runs, once per pass.
 *
 * ```
 * printf 'alive\tidle\tabc\tyes\nalive\tidle\tabc\tyes\n' | node plot-monitor.mjs
 * idle
 * ```
 *
 * **A FOURTH artifact, for the reason the third one names.** `plot-ask.mjs`
 * answers by RUNNING `plot-fleet-scan.sh`, so anything that script's siblings
 * call must not be it. This bundle spawns nothing and reads nothing — the
 * monitor makes no host call at all, and an entry point that could would put
 * one behind a ~30 s cadence.
 *
 * **It imports the rules directly rather than through the barrel**, for the
 * measured reason `verdicts.ts` records: the index re-exports every entity and
 * the entities carry `zod` schemas, so a barrel import costs ~320 KB of
 * validator no line here calls.
 *
 * **The WHOLE RUN in one call, not one pass per process.** The monitor's loop
 * is in the shell and its cadence is the shell's, but a process spawned per
 * pass would pay node's start-up on every tick of every monitored worker. The
 * caller sends the readings it holds — the previous pass and this one — and
 * gets back the verdict plus what to publish, which is both of the questions
 * the shell used to answer for itself.
 *
 * **Tab-separated in, one word out.** The caller is bash, and a JSON round trip
 * there would mean `jq` on the monitor's own cadence — a second process to
 * avoid a second format.
 */

/** How the shell spells `PidStatus` on the wire — the domain's three words. */
const PID_STATUS = new Set<string>(['alive', 'dead', 'unrecorded']);
/** How the shell spells `WorkerActivity`: `working`, `idle`, or empty. */
const ACTIVITY = new Set<string>(['working', 'idle', '']);
/** How the shell spells `CommitReading`. */
const COMMITS = new Set<string>(['yes', 'no', 'unanswerable']);

/**
 * Parse one reading per line: `pid<TAB>activity<TAB>fingerprint<TAB>commits`.
 *
 * A line that does not parse is NOT skipped and does not fall back to a
 * default. An unreadable pid word defaulting to `alive` would suppress `gone`,
 * and one defaulting to `dead` would invent it — both are a verdict about a
 * worker nobody measured. So a malformed line refuses the whole batch.
 *
 * The fingerprint is the one field with no vocabulary: it is an opaque string
 * and any value is legitimate, the empty one included — a worktree that is not
 * there fingerprints as a constant, which is a reading and not an error.
 *
 * @param text the stdin document, one reading per line
 * @returns the readings in order, oldest first
 * @throws when any non-empty line is not four tab-separated fields, or when a
 *   field outside the fingerprint holds a word the domain does not define
 */
export const readingsFrom = (text: string): MonitorReading[] =>
  text
    .split('\n')
    .filter((line) => line !== '')
    .map((line, i) => {
      const fields = line.split('\t');
      const [pid, activity, fingerprint, commits] = fields;
      if (fields.length !== 4 || fingerprint === undefined
        || !PID_STATUS.has(pid!) || !ACTIVITY.has(activity!) || !COMMITS.has(commits!)) {
        throw new Error(
          `line ${i + 1}: expected '<pid>\\t<activity>\\t<fingerprint>\\t<commits>', got '${line}'`,
        );
      }
      return {
        pid: pid as MonitorReading['pid'],
        activity: activity as MonitorReading['activity'],
        fingerprint,
        commits: commits as MonitorReading['commits'],
      };
    });

/**
 * Decide the last reading, against the one before it.
 *
 * One line or two. ONE is the monitor's first pass, where there is no previous
 * reading and `gone` is the only finding a single sample can make; TWO is every
 * pass after it. More than two refuses rather than silently reading the last
 * pair, because a caller sending three has misunderstood which readings the
 * rule compares, and answering it would hide that.
 *
 * @param text the stdin document, one reading per line, oldest first
 * @returns the verdict, and what to publish given what already stands
 * @throws when the document holds no readings or more than two
 */
export const decide = (
  text: string,
  published: MonitorVerdict,
): { verdict: MonitorVerdict; publish: string } => {
  const readings = readingsFrom(text);
  if (readings.length < 1 || readings.length > 2) {
    throw new Error(`expected 1 or 2 readings, got ${readings.length}`);
  }
  const current = readings[readings.length - 1]!;
  const previous = readings.length === 2 ? readings[0]! : null;
  const verdict = sample(previous, current);
  return { verdict, publish: publication(published, verdict) ?? '' };
};

/**
 * Read stdin, print `verdict<TAB>publish`.
 *
 * The publish field is EMPTY where nothing is to be said, which is the common
 * case: a held finding is published once and a healthy worker is silent. An
 * empty field rather than an absent one keeps the line's shape constant, so the
 * caller's `IFS=$'\t' read` needs no arm for it.
 *
 * @param text the whole of stdin
 * @param published what the caller last published, or `silent`
 * @param write where the answer goes
 * @returns the process exit code — 0 answered, 2 unreadable input
 */
export const run = (
  text: string,
  published: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  try {
    const standing = (published === '' ? 'silent' : published) as MonitorVerdict;
    if (!['gone', 'idle', 'silent'].includes(standing)) {
      throw new Error(`unknown standing finding '${published}'`);
    }
    const { verdict, publish } = decide(text, standing);
    write(`${verdict}\t${publish}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`plot-monitor: ${(err as Error).message}\n`);
    return 2;
  }
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS a bundle invoked under `/tmp`
// compared against `/private/tmp`, never ran, and exited 0 having written
// nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8'), process.argv[2] ?? 'silent'));
}
