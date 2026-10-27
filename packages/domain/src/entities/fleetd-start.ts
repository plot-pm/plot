import { z } from 'zod';

/**
 * The version word a record carries.
 *
 * A LITERAL, so an unrecognised value fails the parse rather than the reader —
 * the same contract {@link import('./supervision-report.js').SUPERVISION_REPORT_VERSION} keeps.
 */
export const FLEETD_START_VERSION = 1;

/**
 * What fleetd wrote about itself at the start of its current process.
 *
 * Written once, at the top of `run()`, and never read back by the daemon
 * itself — only `plot-fleetctl.sh --status`, through `plot-ask.mjs spawner`,
 * reads it. A reader compares {@link spawnContract} against the gate's own
 * number to answer `current`/`stale`/`unknown` ({@link import('../rules/spawn-contract.js').spawnerStatus}),
 * and {@link bundleHash} against a fresh hash of {@link bundlePath} to report
 * bundle drift — evidence, never the verdict.
 */
export const FleetdStartSchema = z
  .object({
    /** The format, so an older or newer file is unparseable rather than misread. */
    v: z.literal(FLEETD_START_VERSION),
    /** The process id that wrote this record. A record whose pid does not match the running supervisor reads `unknown`. */
    pid: z.number().int().positive(),
    /** When this process started, epoch milliseconds. */
    startedAt: z.number().nonnegative(),
    /** The spawn contract number this process compiled with. */
    spawnContract: z.number().int().positive(),
    /** Where the bundle this process is running from lives, relative to the repository root. */
    bundlePath: z.string().min(1),
    /** That bundle's content hash at start, as `refs.hashFilesSync` reports it. */
    bundleHash: z.string().min(1),
  })
  .strict();

export type FleetdStart = z.infer<typeof FleetdStartSchema>;

/**
 * Parses a record file's whole contents, or null where it is not one.
 *
 * AN UNREADABLE RECORD IS NOTHING TO START FROM, NEVER A FAILURE. An
 * unrecognised `v`, a shape that changed and a torn write all mean the same
 * thing to a reader: no fleetd start recorded that I can read.
 *
 * @param text - the file's contents.
 * @returns the record, or null where it is absent or unrecognised.
 */
export const decodeFleetdStart = (text: string): FleetdStart | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = FleetdStartSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a record for writing.
 *
 * @param record - what fleetd knows about its own start.
 * @returns the file's contents.
 */
export const encodeFleetdStart = (record: FleetdStart): string => `${JSON.stringify(record)}\n`;
