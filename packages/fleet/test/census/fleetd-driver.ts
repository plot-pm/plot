import { join } from 'node:path';

import { startSession, type Session, type SessionEnd } from './census-session.js';
import type { FleetdEntry } from './fleetd-entry-build.js';
import type { Sandbox } from './sandbox.js';

export type FleetdRun = {
  session: Session;
  /** Runs one completed pass and resolves once the entry reports it done. */
  pass: () => Promise<number>;
  /** Stops fleetd and returns the session's end, census included when traced. */
  stop: () => Promise<SessionEnd>;
};

/**
 * Starts fleetd's `run` through the census entry in `box`, on the clock the
 * entry drives, optionally under `strace -f`.
 *
 * @param entry - the built entry.
 * @param box - the sandbox fleetd supervises.
 * @param options - `trace` runs it under `strace`; `spawnLog` names the file
 *   the entry appends its direct children to; `clock: 'system'` runs fleetd
 *   on the system clock, with no passes.
 */
export const startFleetd = (
  entry: FleetdEntry,
  box: Sandbox,
  options: { trace: boolean; spawnLog?: string; clock?: 'manual' | 'system' },
): FleetdRun => {
  const session = startSession({
    command: process.execPath,
    args: [entry.launcher, '--interval', '60'],
    cwd: box.repo,
    env: {
      ...box.env,
      CENSUS_CLOCK: options.clock ?? 'manual',
      ...(options.spawnLog ? { CENSUS_SPAWN_LOG: options.spawnLog } : {}),
    },
    trace: options.trace,
  });
  let passes = 0;
  return {
    session,
    pass: async () => {
      passes += 1;
      const n = passes;
      session.send('pass');
      await session.waitFor(new RegExp(`^census: pass ${n} done$`), 180_000);
      return n;
    },
    stop: async () => {
      session.send('stop');
      const end = await session.end(60_000);
      if (end.code !== 0) {
        throw new Error(`process census: fleetd exited ${end.code ?? end.signal}\nstderr: ${end.stderr.slice(-4000)}`);
      }
      return end;
    },
  };
};

/** The file a sandbox's fleetd entry logs its direct children to. */
export const spawnLogOf = (box: Sandbox): string => join(box.root, 'fleetd-spawns.jsonl');
