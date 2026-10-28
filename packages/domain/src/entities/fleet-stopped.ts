import { z } from 'zod';

/**
 * The version word the fleet-stopped file carries.
 *
 * A literal, so a future format's file fails the parse rather than the reader.
 */
export const FLEET_STOPPED_VERSION = 1;

/**
 * The branches `plot-fleetctl.sh --stop` stopped in one run.
 *
 * Written by `--stop`, consumed and cleared by the next `--start` — the
 * record of which branches a fleet-level stop touched, so a fleet-level
 * start restarts exactly those and nothing a person stopped by other means.
 */
export const FleetStoppedSchema = z
  .object({
    v: z.literal(FLEET_STOPPED_VERSION),
    /** The branches this `--stop` run stopped. */
    branches: z.array(z.string()),
    /** When `--stop` wrote the file, ISO-8601, this machine's clock. */
    at: z.string(),
  })
  .strict();
export type FleetStopped = z.infer<typeof FleetStoppedSchema>;

/**
 * Parses the file's text, or null where it is not one this Plot knows.
 *
 * Every failure is null — unparseable JSON, another `v`, an empty file — and
 * null holds nothing: no record is not an empty stop list.
 *
 * @param text - the file's contents.
 * @returns the record, or null where the text cannot be read as one.
 */
export const decodeFleetStopped = (text: string): FleetStopped | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = FleetStoppedSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a record as the text written to disk.
 *
 * @param record - the record to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodeFleetStopped = (record: FleetStopped): string => `${JSON.stringify(record, null, 2)}\n`;
