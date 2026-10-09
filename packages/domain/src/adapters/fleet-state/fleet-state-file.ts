import fs from 'node:fs/promises';
import path from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { FleetReadingSchema } from '../../entities/fleet.js';
import type { BridgedPulse, FleetState } from '../../ports/fleet-state.js';

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

/** Where the file lives, per repo: beside the rest of `.plot`, under `state/`. */
export const bridgePath = (repoRoot: string): string => path.join(repoRoot, '.plot', 'state', 'last-pulse.json');

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

/** The seams a test needs so a suite never touches the operator's own bridge. */
export interface FleetStateFileOptions {
  /** The repository the bridge belongs to. */
  repoRoot: string;
  /** Reads the clock; defaults to `Date.now`. Lets a test age a file without sleeping. */
  now?: () => number;
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
  const file = bridgePath(options.repoRoot);
  const now = options.now ?? (() => Date.now());

  return {
    read: async (): Promise<PortResult<BridgedPulse | null>> => {
      let raw: string;
      try {
        raw = await fs.readFile(file, 'utf8');
      } catch {
        return answered(null);
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.version !== BRIDGE_VERSION) return answered(null);
        const at = parsed.at;
        if (typeof at !== 'number' || !Number.isFinite(at)) return answered(null);
        // A file from the FUTURE is as untrustworthy as an ancient one — a
        // clock that moved backwards, or a copied checkout. Rejected rather
        // than clamped.
        const age = now() - at;
        if (age < 0 || age > BRIDGE_MAX_AGE_MS) return answered(null);
        const pulse = FleetReadingSchema.parse(parsed.pulse);
        return answered({
          at,
          pulse,
          ages: toMap(parsed.ages, isAge),
          branchUrlBase: typeof parsed.branchUrlBase === 'string' ? parsed.branchUrlBase : '',
          approvedAt: toMap(parsed.approvedAt, isNumber),
          ideaPlans: toMap(parsed.ideaPlans, isString),
        });
      } catch {
        return answered(null);
      }
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
