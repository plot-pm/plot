import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';

/**
 * THE TWO FLEET SETTINGS AND THEIR SHARED STATE.
 *
 * Named `fleet-settings` rather than `fleet-controls`: this module holds the
 * settings, while the surface an operator clicks is `FleetControls.tsx`. Two
 * modules whose names differ by one letter — one holding config, one answering
 * every question about the estate — is a confusion that costs somebody an hour.
 *
 * A switch — *is the queue being served?* — and a cap — *how many agents at
 * once?* Two numbers behind the two section headers they describe, and the one
 * departure this wave makes from the board's usual state rules.
 *
 * ## Shared, not per-viewer — deliberately, against the board's convention
 *
 * The board's rule is that view state lives in the URL (shareable) and
 * per-viewer convenience in `localStorage` (private). The collapse state's own
 * comment draws the line: *a URL is shareable, and collapse state should not
 * be… collapse is convenience, not subject matter.* These two controls fail
 * that test in the opposite direction. Auto-dispatch spawns agents that write
 * code and open PRs; the cap bounds how many. Two people reading one board must
 * not disagree about whether the fleet is running or how wide it runs — so the
 * state is one file on disk, read by every board process, not a preference each
 * browser keeps to itself. A `localStorage` implementation would let two tabs
 * hold two answers, which is exactly the failure that makes this subject matter
 * rather than convenience.
 *
 * ## In `.plot/state/`, beside the pulse — never in a committed file
 *
 * `bridgePath` already puts `last-pulse.json` here for the same reason: it
 * describes THIS machine's fleet, so it is gitignored rather than committed. A
 * switch written into `CLAUDE.md` would arrive in a commit — the board teaching
 * itself to edit a human-authored file — so `## Plot Config` supplies the
 * DEFAULT at startup and nothing more. The file is the running answer; the
 * config is where that answer begins on a machine that has never touched it.
 *
 * ## This wave dispatches nothing
 *
 * A switch that is on starts no agent here. It records an intention that wave 3
 * reads. Turning either control off is a promise about the FUTURE only — it
 * never signals a running worker, whose home is the agent panel.
 */

/**
 * The `## Plot Config` keys that seed the defaults, and the defaults themselves.
 *
 * Read through `readConfig` — the one door to `plot-config.sh` — so an adopting
 * project can seed a different starting point without this file knowing where
 * Plot configuration lives. The switch defaults OFF: a board that has never been
 * told to serve the queue must not begin serving it, and wave 3 will only act
 * while it is on. The cap defaults to 3.
 */
export const AUTO_DISPATCH_KEY = 'Auto-dispatch';
export const PARALLEL_AGENTS_KEY = 'Parallel agents';
const AUTO_DISPATCH_DEFAULT = false;
const PARALLEL_AGENTS_DEFAULT = 3;

/**
 * The cap refuses to go below 1. A cap of zero is a stopped fleet expressed as
 * a number, which the switch already says better — two controls saying one
 * thing is how they drift into disagreeing. The floor is enforced HERE, at the
 * write, not merely in the stepper's UI: the endpoint is a second door to this
 * state and a value that never passed through the spinbutton must still land
 * above the floor.
 */
export const MIN_PARALLEL_AGENTS = 1;

/** The current settings, as every reader sees them. */
export interface FleetSettings {
  /** Whether the queue is being served. This wave records it; wave 3 acts on it. */
  autoDispatch: boolean;
  /** How many agents may run at once — never below {@link MIN_PARALLEL_AGENTS}. */
  parallelAgents: number;
}

/**
 * Where the file lives: beside the pulse, under `.plot/state/`.
 *
 * Machine-local by construction and gitignored for it, the same as
 * `bridgePath`. A checked-in copy would be one machine telling another whether
 * its fleet is running.
 */
export function fleetSettingsPath(repoRoot: string): string {
  return path.join(repoRoot, '.plot', 'state', 'fleet-controls.json');
}

/**
 * The defaults, read from `## Plot Config`. The starting point for a machine
 * whose state file does not yet exist — and the fallback for one whose file is
 * unreadable or malformed, since a broken file is not a reason to invent a
 * running fleet.
 *
 * `plot-config.sh` hands back strings; the switch is `true` only for the exact
 * literal `true`, so a typo or an empty value reads as OFF rather than as some
 * truthy coercion. The cap is parsed and floored: a non-numeric or sub-floor
 * config value falls back to the default rather than seeding an illegal state.
 */
export function defaultFleetSettings(opts: BuildBoardOptions): FleetSettings {
  const rawSwitch = readConfig(opts, AUTO_DISPATCH_KEY, String(AUTO_DISPATCH_DEFAULT)).trim();
  const rawCap = readConfig(opts, PARALLEL_AGENTS_KEY, String(PARALLEL_AGENTS_DEFAULT)).trim();
  const parsedCap = Number.parseInt(rawCap, 10);
  return {
    autoDispatch: rawSwitch === 'true',
    parallelAgents:
      Number.isInteger(parsedCap) && parsedCap >= MIN_PARALLEL_AGENTS
        ? parsedCap
        : PARALLEL_AGENTS_DEFAULT,
  };
}

/**
 * Coerce anything on disk into a valid pair, falling back per-field to the
 * defaults. Forgiving in one direction only, the rule `readBridge` and
 * `pulse-bridge`'s `toMap` both keep: a field that is not the right shape is
 * DROPPED to its default, never guessed at. A cap below the floor is raised to
 * the floor — the same clamp the write applies, so a file hand-edited to 0 does
 * not read back as a stopped fleet the switch did not ask for.
 */
function coerce(raw: unknown, fallback: FleetSettings): FleetSettings {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const obj = raw as Record<string, unknown>;
  const autoDispatch =
    typeof obj.autoDispatch === 'boolean' ? obj.autoDispatch : fallback.autoDispatch;
  const parallelAgents =
    typeof obj.parallelAgents === 'number' && Number.isInteger(obj.parallelAgents)
      ? Math.max(MIN_PARALLEL_AGENTS, obj.parallelAgents)
      : fallback.parallelAgents;
  return { autoDispatch, parallelAgents };
}

/**
 * The current settings: the file if it holds a well-shaped answer, else the
 * config-seeded defaults.
 *
 * Read fresh on every call — this is on `buildFleet`'s render clock, not
 * cached — so a write through the endpoint is visible on the very next poll
 * without a cache to invalidate. That is what makes *a second board process
 * reads the same values* true: neither process holds authoritative state in
 * memory; both read this file, and the file is the shared answer.
 */
export function readFleetSettings(opts: BuildBoardOptions): FleetSettings {
  const fallback = defaultFleetSettings(opts);
  let raw: string;
  try {
    raw = fs.readFileSync(fleetSettingsPath(opts.repoRoot), 'utf8');
  } catch {
    // No file is the ordinary first state, not an error: the machine has never
    // touched a control, so the config defaults ARE the answer.
    return fallback;
  }
  try {
    return coerce(JSON.parse(raw), fallback);
  } catch {
    // A file that exists and will not parse falls back rather than throwing: the
    // board serving stale-but-valid defaults beats a poll that 500s on a byte a
    // hand-edit corrupted.
    return fallback;
  }
}

/**
 * Write the settings, atomically, so two board processes on one repo cannot
 * hand each other a torn file.
 *
 * Temp file plus `rename`, the discipline `writeBridge` documents: `rename` is
 * atomic within a filesystem, so a reader mid-write sees the old file whole or
 * the new file whole, never half of either. The temp name carries the pid for
 * the same reason it does there — two writers must not collide on one temp path
 * and produce the torn payload the rename exists to prevent.
 *
 * The cap is floored on the way in: this is the second door to the state (the
 * endpoint being the first), and a caller that hands a sub-floor number must
 * still land a legal one. Unlike `writeBridge`, a failure is NOT swallowed — a
 * control write is a person's explicit act on the fleet, and silently dropping
 * it would leave the board rendering the old answer with no sign the write was
 * lost. The endpoint turns a throw here into a 500 the operator can see.
 */
export function writeFleetSettings(repoRoot: string, controls: FleetSettings): void {
  const file = fleetSettingsPath(repoRoot);
  const clamped: FleetSettings = {
    autoDispatch: controls.autoDispatch,
    parallelAgents: Math.max(MIN_PARALLEL_AGENTS, Math.trunc(controls.parallelAgents)),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(clamped), 'utf8');
  fs.renameSync(tmp, file);
}

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
  const current = readFleetSettings(opts);
  let autoDispatch: boolean | undefined;
  let parallelAgents: number | undefined;
  try {
    autoDispatch = field(body as Record<string, unknown>, 'autoDispatch', isBoolean);
    parallelAgents = field(body as Record<string, unknown>, 'parallelAgents', isInteger);
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const next: FleetSettings = {
    autoDispatch: autoDispatch ?? current.autoDispatch,
    parallelAgents: parallelAgents ?? current.parallelAgents,
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
  json(200, readFleetSettings(opts));
}
