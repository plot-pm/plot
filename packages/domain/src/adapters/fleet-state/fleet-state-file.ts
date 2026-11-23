import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { FleetReadingSchema } from '../../entities/fleet.js';
import type { FleetdHeartbeat } from '../../entities/fleetd-heartbeat.js';
import { bridgeVouched } from '../../rules/fleetd-live.js';
import { readFleetdHeartbeatSync } from '../fleetd-heartbeat/fleetd-heartbeat-file.js';
import { stateHomeAtSync } from '../main-checkout.js';
import type { StateHome } from '../../entities/state-home.js';
import type { StateHomeAnswer } from '../../rules/state-home.js';
import type { BridgedPulse, FleetState, ScanAttempt } from '../../ports/fleet-state.js';

/**
 * How old a bridged pulse may be before it is discarded unread.
 *
 * Unchanged from the board's own constant: long enough that a board reopened
 * after a break still gets something labelled with its age, short enough that
 * the file is never read as describing the estate's current state once it is
 * this stale.
 */
export const BRIDGE_MAX_AGE_MS = 15 * 60_000;

/**
 * Bumped when the payload shape changes incompatibly. A file this build does
 * not recognise is read as `answered(null)` rather than coerced — the cost is
 * one empty poll, and the alternative is a confidently wrong board.
 */
const BRIDGE_VERSION = 1;

/**
 * Where the file lives: `.plot/state/last-pulse.json` under the state home, so
 * a linked worktree reads and writes the bridge fleetd writes.
 *
 * @param home - the state home of the repository.
 * @returns the bridge file's path.
 */
export const bridgePath = (home: StateHome): string => path.join(home, '.plot', 'state', 'last-pulse.json');

/** Maps do not survive `JSON.stringify`; entry arrays do. */
const toEntries = <K extends string, V>(map: Map<K, V>): [K, V][] => [...map.entries()];

/**
 * Rebuild a Map from whatever was on disk, keeping only well-shaped pairs.
 *
 * Deliberately forgiving in one direction only: a malformed entry is DROPPED,
 * never guessed at.
 */
const toMap = <V>(raw: unknown, valid: (v: unknown) => v is V): Map<string, V> => {
  const map = new Map<string, V>();
  if (!Array.isArray(raw)) return map;
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [key, value] = pair as [unknown, unknown];
    if (typeof key !== 'string') continue;
    if (!valid(value)) continue;
    map.set(key, value);
  }
  return map;
};

const isAge = (v: unknown): v is number | null => v === null || typeof v === 'number';
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isString = (v: unknown): v is string => typeof v === 'string';

/** Reads the optional scan-attempt record; a malformed one is absent. */
const parseAttempt = (raw: unknown): { attempt?: ScanAttempt } => {
  if (typeof raw !== 'object' || raw === null) return {};
  const a = raw as Record<string, unknown>;
  if (typeof a.startedAt !== 'number' || !Number.isFinite(a.startedAt)) return {};
  if (a.endedAt !== null && typeof a.endedAt !== 'number') return {};
  if (a.outcome !== 'running' && a.outcome !== 'ok' && a.outcome !== 'failed') return {};
  return { attempt: { startedAt: a.startedAt, endedAt: a.endedAt, outcome: a.outcome, error: typeof a.error === 'string' ? a.error : null } };
};

/**
 * Parses a bridge file's text. Returns `null` for a foreign version, an
 * unusable timestamp, an age below 0, an age past `BRIDGE_MAX_AGE_MS` that
 * fleetd's heartbeat does not vouch for, or a pulse that fails its schema.
 *
 * A file from the FUTURE is as untrustworthy as an ancient one — a clock that
 * moved backwards, or a copied checkout. Rejected rather than clamped.
 */
const parseBridge = (raw: string, nowMs: number, heartbeat: FleetdHeartbeat | null): BridgedPulse | null => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== BRIDGE_VERSION) return null;
    const at = parsed.at;
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    const age = nowMs - at;
    if (age < 0) return null;
    if (age > BRIDGE_MAX_AGE_MS && !bridgeVouched({ at }, heartbeat, nowMs)) return null;
    return {
      at,
      pulse: FleetReadingSchema.parse(parsed.pulse),
      ages: toMap(parsed.ages, isAge),
      branchUrlBase: typeof parsed.branchUrlBase === 'string' ? parsed.branchUrlBase : '',
      approvedAt: toMap(parsed.approvedAt, isNumber),
      ideaPlans: toMap(parsed.ideaPlans, isString),
      prError: typeof parsed.prError === 'string' ? parsed.prError : null,
      ...parseAttempt(parsed.attempt),
    };
  } catch {
    return null;
  }
};

/** The seams a test needs so a suite never touches the operator's own bridge. */
export interface FleetStateFileOptions {
  /** The state home the bridge lives under. */
  home: StateHome;
  /** Reads the clock; defaults to `Date.now`. Lets a test age a file without sleeping. */
  now?: () => number;
  /**
   * Reads fleetd's heartbeat; defaults to none. A bridge older than
   * `BRIDGE_MAX_AGE_MS` is returned while this reading vouches for it
   * ({@link bridgeVouched}).
   */
  heartbeat?: () => FleetdHeartbeat | null;
}

/**
 * Keeps one repository's bridged pulse, as a single JSON file under `.plot/state/`.
 *
 * **MACHINE-LOCAL BY CONSTRUCTION** — it describes worktrees and refs on this
 * machine — so the file is gitignored rather than committed.
 *
 * @param options - the repository to resolve the file for, and a clock for tests.
 * @returns a `FleetState` backed by one file.
 */
export const fleetStateFile = (options: FleetStateFileOptions): FleetState => {
  const file = bridgePath(options.home);
  const now = options.now ?? (() => Date.now());
  const heartbeat = options.heartbeat ?? (() => null);

  return {
    read: async (): Promise<PortResult<BridgedPulse | null>> => {
      let raw: string;
      try {
        raw = await fs.readFile(file, 'utf8');
      } catch {
        return answered(null);
      }
      return answered(parseBridge(raw, now(), heartbeat()));
    },

    readSync: (): PortResult<BridgedPulse | null> => {
      let raw: string;
      try {
        raw = fsSync.readFileSync(file, 'utf8');
      } catch {
        return answered(null);
      }
      return answered(parseBridge(raw, now(), heartbeat()));
    },

    write: async (data: BridgedPulse): Promise<PortResult<void>> => {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const payload = JSON.stringify({
          version: BRIDGE_VERSION,
          at: data.at,
          pulse: data.pulse,
          ages: toEntries(data.ages),
          branchUrlBase: data.branchUrlBase,
          approvedAt: toEntries(data.approvedAt),
          ideaPlans: toEntries(data.ideaPlans),
          prError: data.prError,
          attempt: data.attempt,
        });
        // The temp name carries the pid: two processes writing at once must
        // not collide on the SAME temp file, which would produce exactly the
        // torn payload the rename exists to prevent.
        const temp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(temp, payload, 'utf8');
        await fs.rename(temp, file);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};

/** A bridge over no file: every read answers no pulse, every write fails. */
const unreadFleetState: FleetState = {
  read: async () => answered(null),
  readSync: () => answered(null),
  write: async () => failed<void>(),
};

/**
 * The bridge under a resolved state home.
 *
 * @param answer - the resolved state home.
 * @param options - the clock and heartbeat seams of {@link fleetStateFile}.
 * @returns the file-backed bridge, or, where the home is unread, a bridge
 *   whose reads answer `answered(null)` and whose writes answer `failed`.
 */
export const fleetStateIn = (answer: StateHomeAnswer, options: Omit<FleetStateFileOptions, 'home'> = {}): FleetState =>
  'home' in answer ? fleetStateFile({ ...options, home: answer.home }) : unreadFleetState;

/**
 * Keeps one repository's bridged pulse, reading fleetd's heartbeat file for a
 * vouch on every read.
 *
 * A bridge older than {@link BRIDGE_MAX_AGE_MS} is returned while
 * `.plot/state/fleetd.json` reads `live` and names that bridge's `at`. The
 * state home is resolved with {@link stateHomeAtSync}.
 *
 * @param repoRoot - a main checkout or a linked worktree.
 * @returns a `FleetState` whose reads consult the heartbeat file; where the
 *   home is unread, reads answer no pulse and writes fail.
 */
export const fleetStateVouched = (repoRoot: string): FleetState => {
  const answer = stateHomeAtSync(repoRoot);
  return 'home' in answer
    ? fleetStateFile({ home: answer.home, heartbeat: () => readFleetdHeartbeatSync(answer.home) })
    : unreadFleetState;
};
