import { pulseDelta, type PulseDelta } from '@plot-pm/domain/rules/pulse';
import { FleetReadingSchema } from '@plot-pm/domain/entities/fleet';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-fleet-scan.sh` runs, once per pulse.
 *
 * ```
 * printf '%s\n%s\n' "$previous_bridge" "$incoming_reading" | node plot-delta.mjs
 * Since your last pulse (14 minutes ago):
 *   merged      feature/a-thing (a-plan)
 *   plan ready  a-plan
 * ```
 *
 * **IT RENDERS AND DECIDES NOTHING.** `pulseDelta` is the rule and it is in the
 * domain, done, with its own tests; this bundle parses two readings, calls it,
 * and composes sentences. A diff written here would be the second
 * implementation this repo keeps measuring — seven plans in one week proposed
 * something the estate already had.
 *
 * **A TENTH artifact, for the reason the third through ninth ones give.**
 * `plot-ask.mjs` answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh`,
 * so a scan asking it for its own delta would be an artifact calling the script
 * that called it. This bundle spawns nothing and reads nothing: both readings
 * arrive on stdin.
 *
 * **It imports the rule and the schema directly rather than through the
 * barrel**, for the reason `verdicts.ts` records. Unlike the bundles beside it
 * this one genuinely needs a schema: a previous pulse is a file another build
 * may have written, and the board's rule for its own data is *parse, do not
 * assume*. So it carries `zod` and measures **325 KB** against `verdicts.ts`'s
 * 2 KB — and that is affordable here for a reason those bundles cannot claim.
 * They run once per PLAN inside the scan's loop, ~40 times a pulse; this runs
 * **once per pulse**. Measured 2026-09-06: 47 ms wall, against a scan whose own
 * git work is 12.7 s.
 *
 * **The alternative was a hand-written reader over the four fields the rule
 * touches, and it is the second parser this repo keeps removing.** A narrowing
 * reader that disagreed with `FleetReadingSchema` about a malformed pulse would
 * make the delta and the board read one file two ways.
 *
 * **TWO LINES IN, PROSE OUT.** The caller is bash, and both documents are the
 * JSON it already holds: the incoming reading it just composed, and the bridge
 * file it is about to overwrite. Line 1 is the previous pulse's document or the
 * empty string; line 2 is the incoming reading.
 *
 * **THE FOUR OUTCOMES STAY FOUR.** A first run, an unusable history, a quiet
 * estate and a changed one each get their own sentence — see {@link render}.
 */

/** Milliseconds in a minute, for the one age this renders. */
const MS_PER_MINUTE = 60_000;

/**
 * How long a previous pulse stays usable.
 *
 * FIFTEEN MINUTES, THE BOARD'S OWN NUMBER — `pulse-bridge.ts`'s
 * `BRIDGE_MAX_AGE_MS`. It is repeated rather than imported because that module
 * reads the filesystem and this bundle reads stdin: importing it would pull a
 * reader into an artifact whose whole property is that it opens nothing. The
 * number is the contract of the file both of them handle, and a delta computed
 * against a pulse the board would have discarded is a delta about a repository
 * state that no longer exists.
 */
export const BRIDGE_MAX_AGE_MS = 15 * 60_000;

/**
 * How old the previous pulse was, in a phrase a person reads.
 *
 * Minutes rather than seconds because the bridge expires at fifteen of them:
 * a unit finer than the window's own resolution invites a reader to compare
 * two numbers that were never that precise.
 *
 * @param previousAt - when the previous reading was taken, epoch ms.
 * @param now - the instant to measure against.
 * @returns a phrase like `14 minutes ago`, or `just now` under a minute.
 */
export const agePhrase = (previousAt: number, now: number): string => {
  const minutes = Math.floor((now - previousAt) / MS_PER_MINUTE);
  if (minutes < 1) return 'just now';
  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
};

/**
 * The delta as lines a reader sees above the full report.
 *
 * **EACH OUTCOME SAYS SOMETHING DIFFERENT, and the pair that must never
 * collapse is `unchanged` and `unusable`.** A quiet estate and a history nobody
 * can read look identical to a reader and mean opposite things. `first` is
 * neither: nobody has pulsed here yet, which is where every new adopter starts
 * and is not a failure.
 *
 * NAMED, NEVER COUNTED, which is the rule `readingLoss` states and this
 * inherits: *"3 plans became 2 makes the reader open a terminal to find out
 * which"*. Every line below names the branch or the plan it is about.
 *
 * @param delta - what the rule decided.
 * @param now - the instant to measure the previous pulse's age against.
 * @returns the lines, without a trailing newline; never empty.
 */
export const render = (delta: PulseDelta, now: number): string[] => {
  if (delta.outcome === 'first') {
    return ['No previous pulse on this machine — this is the first, so there is nothing to compare.'];
  }
  if (delta.outcome === 'unusable') {
    // NOT `nothing changed`. There WAS history and it could not be used —
    // expired past the bridge's window, or written in a shape this build does
    // not know. The reader learns the fleet has been quiet longer than the
    // bound, or that the format moved under them.
    return ['Cannot say what changed — the previous pulse is too old to use or was written by another version.'];
  }
  const since = delta.previousAt === null ? '' : ` (${agePhrase(delta.previousAt, now)})`;
  if (delta.outcome === 'unchanged') {
    return [`Nothing changed since your last pulse${since}.`];
  }

  const lines = [`Since your last pulse${since}:`];
  for (const branch of delta.merged) {
    lines.push(`  merged      ${branch.branch} (${branch.plan})`);
  }
  for (const worker of delta.workersDied) {
    lines.push(`  worker ${worker.state.padEnd(5)}${worker.branch} (${worker.plan})`);
  }
  for (const plan of delta.deliverable) {
    lines.push(`  plan ready  ${plan}`);
  }
  // A LOSS IS NOT ONE OF THE THREE, and it is reported because it is the one
  // thing a reader cannot infer from the picture below: a plan the scan used to
  // see and does not now is absent from that report entirely.
  if (delta.loss !== null) {
    for (const plan of delta.loss.plans) lines.push(`  gone        ${plan} (plan no longer read)`);
    for (const branch of delta.loss.branches) lines.push(`  gone        ${branch} (branch no longer read)`);
  }
  return lines;
};

/**
 * Read one reading off a line, or null where the line names none.
 *
 * PARSED, NEVER TRUSTED. The previous pulse was written by a build that may not
 * be this one, and every failure — absent, truncated, a shape this build does
 * not know — lands on `null`. The caller then tells `first` from `unusable` by
 * whether the line was empty, which is a fact about the FILE rather than about
 * its contents.
 *
 * @param line - the document, or `''` where there was none.
 * @returns the reading, or null where it could not be read.
 */
export const readingOf = (line: string): ReturnType<typeof FleetReadingSchema.parse> | null => {
  const text = line.trim();
  if (text === '') return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    // The bridge wraps the reading; a bare reading is accepted too, because the
    // caller holds the incoming one in that shape and a second spelling here
    // would be a second parser.
    const pulse = 'pulse' in parsed ? parsed.pulse : parsed;
    return FleetReadingSchema.parse(pulse);
  } catch {
    return null;
  }
};

/**
 * When the previous pulse was taken, off the bridge's own field.
 *
 * @param line - the bridge document, or `''`.
 * @returns the instant, or null where the document names none.
 */
export const takenAt = (line: string): number | null => {
  const text = line.trim();
  if (text === '') return null;
  try {
    const at = (JSON.parse(text) as Record<string, unknown>).at;
    return typeof at === 'number' && Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
};

/**
 * Decide and render one pulse's delta.
 *
 * @param text - stdin: the previous bridge document, a newline, the incoming
 *   reading.
 * @param now - the instant to measure the previous pulse's age against.
 * @returns the lines to print above the report, newline-terminated.
 */
export const answer = (text: string, now: number): string => {
  const newline = text.indexOf('\n');
  if (newline < 0) throw new Error('expected two lines: <previous>\\n<incoming>');
  const previousLine = text.slice(0, newline);
  const incomingLine = text.slice(newline + 1);

  const incoming = readingOf(incomingLine);
  if (incoming === null) throw new Error('the incoming reading could not be read');

  const previous = readingOf(previousLine);
  const previousAt = takenAt(previousLine);
  // A FILE THAT EXISTED AND COULD NOT BE USED IS NOT A FIRST RUN. The caller
  // sends an empty line when there was no file at all; anything else means one
  // was found, so a parse that failed here is `unusable` rather than `first`.
  const historyExists = previousLine.trim() !== '';

  // AN EXPIRED PULSE IS UNUSABLE, NOT OLD NEWS. The bridge's window is the
  // board's rule and this honours it: past it the file describes a different
  // repository state, and every honest thing a delta could say about it is
  // "cannot say".
  const expired = previousAt === null || now - previousAt < 0
    || now - previousAt > BRIDGE_MAX_AGE_MS;
  const usable = previous !== null && !expired;

  const delta = pulseDelta(
    usable ? previous : null,
    incoming,
    usable ? previousAt : null,
    historyExists,
  );
  return `${render(delta, now).join('\n')}\n`;
};


/**
 * Read stdin, print the delta.
 *
 * @param text - the whole of stdin.
 * @param write - where the answer goes.
 * @param now - the instant to measure against.
 * @returns the process exit code — 0 answered, 2 unreadable input.
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  now: number = Date.now(),
): number => {
  try {
    write(answer(text, now));
    return 0;
  } catch (err) {
    process.stderr.write(`plot-delta: ${(err as Error).message}\n`);
    return 2;
  }
};

// Only when RUN, never when imported.
//
// `pathToFileURL` rather than a template, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
