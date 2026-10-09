import http from 'node:http';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { readFleetSettings, writeFleetSettings, type FleetSettings } from '@plot-pm/fleet/shared/fleet-settings-store';

/**
 * `POST /api/fleet-controls` — the HTTP half of the fleet settings.
 *
 * The settings themselves, their defaults, their file and the reader/writer
 * that touch neither `node:http` nor the board's entry points live in
 * `fleet-settings-store.ts` — re-exported here unchanged so an existing
 * import of this module keeps working.
 */
export {
  AUTO_DISPATCH_KEY,
  PARALLEL_AGENTS_KEY,
  MACHINE_OVERRIDE_KEY,
  MIN_PARALLEL_AGENTS,
  type FleetSettings,
  fleetSettingsPath,
  defaultFleetSettings,
  readFleetSettings,
  writeFleetSettings,
} from '@plot-pm/fleet/shared/fleet-settings-store';

export interface FleetSettingsOptions extends BuildBoardOptions {
  host: string;
  port: number;
}

/**
 * Read one field of a PATCH body: present-and-well-typed, or left as it was.
 *
 * The endpoint accepts a partial write — the switch toggles without restating
 * the cap, and the stepper steps without restating the switch — so a field the
 * body omits keeps its current value rather than resetting to a default. A field
 * present but the WRONG type is a caller bug and rejected, distinct from an
 * absent one that is a legitimate partial write. `undefined` here says *not in
 * the body*; any other bad value throws.
 */
function field<T>(body: Record<string, unknown>, key: string, guard: (v: unknown) => v is T): T | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (!guard(value)) throw new Error(`${key} has the wrong type`);
  return value;
}

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Handle `POST /api/fleet-controls`. Merges a partial write into the current
 * state and answers with the RESULTING settings, so a caller never asks a second
 * endpoint whether its write landed — the `/api/claim` contract, for the same
 * reason: this route returns state, not an acknowledgement.
 *
 * The same-origin guard is IMPORTED, not restated — `isSameOrigin` from the one
 * route that owns it. A second copy of a security decision is a second place for
 * it to be weakened. The loopback boundary is enforced ahead of this in the
 * router by `write-gate.ts`, exactly as it is for every other write route; this
 * handler adds only the CSRF check the binding cannot cover.
 *
 * A partial merge, not a replace: the switch and the stepper post independently,
 * each naming only the field it changes, and the field this body omits keeps the
 * value already on disk. The floor on the cap is applied by `writeFleetSettings`,
 * so a body naming `parallelAgents: 0` lands as 1 and the response says so — the
 * one truth about the state, returned rather than assumed.
 */
export async function handleFleetSettings(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: FleetSettingsOptions,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (!isSameOrigin(req, opts.port)) {
    json(403, { error: 'cross-origin request refused' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (typeof body !== 'object' || body === null) {
    json(400, { error: 'body must be a JSON object' });
    return;
  }

  // Merge onto the CURRENT state, read fresh, so a partial write leaves the
  // other control untouched — and so two near-simultaneous writes each see the
  // most recently persisted value rather than a stale in-memory snapshot.
  const current = await readFleetSettings(opts);
  let autoDispatch: boolean | undefined;
  let parallelAgents: number | undefined;
  let machineOverride: boolean | undefined;
  try {
    autoDispatch = field(body as Record<string, unknown>, 'autoDispatch', isBoolean);
    parallelAgents = field(body as Record<string, unknown>, 'parallelAgents', isInteger);
    machineOverride = field(body as Record<string, unknown>, 'machineOverride', isBoolean);
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const next: FleetSettings = {
    autoDispatch: autoDispatch ?? current.autoDispatch,
    parallelAgents: parallelAgents ?? current.parallelAgents,
    machineOverride: machineOverride ?? current.machineOverride,
  };

  try {
    writeFleetSettings(opts.repoRoot, next);
  } catch (err) {
    // A control write is a person's explicit act on the fleet — a swallowed
    // failure would leave the board showing the old answer with no sign the
    // write was lost, so it surfaces rather than degrading silently.
    json(500, { error: `cannot write fleet controls: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // The resulting state, re-read so the response reflects exactly what a reader
  // will get on the next poll — the floor already applied, no field guessed.
  json(200, await readFleetSettings(opts));
}
