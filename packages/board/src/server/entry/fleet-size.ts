import { fleetSize, DEFAULT_FLEET_SIZE, type FleetSize } from '@plot-pm/domain/rules/fleet-size';
import { headroomFor } from '@plot-pm/domain/entities/machine';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-dispatch.sh --start` runs, once per dispatch.
 *
 * ```
 * printf '%s\t%s\t%s' 3 1 8 | node plot-fleet-size.mjs
 * 2	clear	started 2 of 3 — 1 already running
 * ```
 *
 * **A BUNDLE BECAUSE A SOURCE IMPORT CANNOT REACH A PLUGIN INSTALL.** `--start`
 * imported `rules/fleet-size.ts` and `entities/machine.ts` as `file://` sources.
 * Node 24 strips the types, so the TypeScript was never the obstacle — the
 * second import is. `machine.ts` opens with `import { z } from 'zod'`, and an
 * install carrying no `node_modules` cannot resolve it:
 *
 * ```
 * machine.ts FAILED: Cannot find package 'zod'
 * fleet-size.ts: imported
 * ```
 *
 * So the bundle carries BOTH rules with `zod` bundled in. A bundle of
 * `fleetSize` alone would import cleanly and still fail, because `headroomFor`
 * is the half that reaches `zod`.
 *
 * **ITS OWN BUNDLE, NOT A VERB ON `plot-ask.mjs`.** That entry answers `board`
 * and `fleet` by RUNNING `plot-fleet-scan.sh` — 18.3 s — so a dispatcher asking
 * how many agents to start would start a fleet scan to find out. Sized like the
 * narrow bundles rather than the schema-carrying ones: this imports one rule and
 * one entity, not the entity schemas.
 *
 * **TAB-SEPARATED, LIKE THE SIBLING ENTRIES A BASH CALLER READS.** The caller
 * splits three fields with parameter expansion; JSON here would mean the shell
 * parsing what this just composed.
 */

/** What `--start` asks: a request, a running count, and what one fork cost. */
export interface StartReadings {
  /** How many agents were asked for, or `null` for the rule's own default. */
  requested: number | null;
  /** How many workers are already running on this machine. */
  running: number;
  /** What one fork cost in milliseconds, or `null` where nothing measured it. */
  spawnCostMs: number | null;
}

/**
 * Reads the three readings from one tab-separated line.
 *
 * An EMPTY FIELD IS `null`, never zero, for both nullable readings. Zero is the
 * fastest fork there is and would read as the clearest possible machine; an
 * absent request is the rule's default rather than a request for none.
 *
 * @param text the whole of stdin — `requested\trunning\tspawnCostMs`
 * @returns the three readings
 * @throws when the line does not hold three fields, or a present field is not a number
 */
export const readingsFrom = (text: string): StartReadings => {
  const fields = text.replace(/\n$/, '').split('\t');
  if (fields.length !== 3) {
    throw new Error(`expected 3 tab-separated fields on stdin, got ${fields.length}`);
  }
  const [requested, running, cost] = fields;
  const num = (field: string, name: string): number => {
    const value = Number(field);
    if (!Number.isFinite(value)) throw new Error(`${name} is not a number: '${field}'`);
    return value;
  };
  return {
    requested: requested === '' ? null : num(requested, 'requested'),
    running: num(running, 'running'),
    spawnCostMs: cost === '' ? null : num(cost, 'spawnCostMs'),
  };
};

/**
 * Decide how many agents to start.
 *
 * The headroom is asked of the Machine entity and handed to the rule as a
 * reading, never re-derived here — the discipline `FleetSizeReadings.headroom`
 * states, so the thresholds keep one home.
 *
 * @param readings the request, the running count and the fork cost
 * @returns the rule's whole answer
 */
export const decide = (readings: StartReadings): FleetSize =>
  fleetSize({
    requested: readings.requested === null ? DEFAULT_FLEET_SIZE : readings.requested,
    running: readings.running,
    spawnCostMs: readings.spawnCostMs,
    headroom: headroomFor(readings.spawnCostMs),
  });

/**
 * Answer one line of readings.
 *
 * **THE SHORTFALL IS LAST BECAUSE IT IS A SENTENCE.** It is printed to the
 * operator — `plot-dispatch.sh` reads it into `start_why` and echoes it beside
 * the summary — so it travels, and a sentence may hold anything except the
 * separator. Last means the caller's `${rest#*<tab>}` takes the whole remainder,
 * so a shortfall carrying a tab could still only widen its own field. The two
 * fields ahead of it are a number and one word from a closed set.
 *
 * @param text the whole of stdin, one tab-separated line
 * @returns `start\theadroom\tshortfall`, no trailing newline
 * @throws when the readings are unreadable
 */
export const answer = (text: string): string => {
  const decided = decide(readingsFrom(text));
  return `${decided.start}\t${decided.headroom}\t${decided.shortfall}`;
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
    process.stderr.write(`plot-fleet-size: ${(err as Error).message}\n`);
    return 2;
  }
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing. This slice's own
// gate runs the bundle from a temp copy, which is exactly that case.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
