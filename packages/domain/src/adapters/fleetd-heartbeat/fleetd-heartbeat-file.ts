import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import {
  decodeFleetdHeartbeat,
  encodeFleetdHeartbeat,
  type FleetdHeartbeat,
} from '../../entities/fleetd-heartbeat.js';
import type { FleetdHeartbeatStore } from '../../ports/fleetd-heartbeat.js';
import type { StateHome } from '../../entities/state-home.js';
import type { StateHomeAnswer } from '../../rules/state-home.js';

/**
 * Where the heartbeat lives: `.plot/state/fleetd.json` under the state home,
 * beside `last-pulse.json`.
 *
 * @param home - the state home of the repository.
 * @returns the heartbeat file's path.
 */
export const fleetdHeartbeatPath = (home: StateHome): string => join(home, '.plot', 'state', 'fleetd.json');

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Keeps fleetd's heartbeat as `.plot/state/fleetd.json` under the state home.
 *
 * Each write goes to a temp file and then `rename`s over the heartbeat, so a
 * reader sees the previous heartbeat or the new one and never half of one.
 *
 * @param options - the state home the file lives under.
 * @returns a `FleetdHeartbeatStore` backed by one file.
 */
export const fleetdHeartbeatFile = (options: { home: StateHome }): FleetdHeartbeatStore => {
  const path = fleetdHeartbeatPath(options.home);
  return {
    read: async (): Promise<PortResult<FleetdHeartbeat | null>> => {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        return isMissing(error) ? answered(null) : failed<FleetdHeartbeat | null>();
      }
      return answered(decodeFleetdHeartbeat(text));
    },

    write: async (heartbeat: FleetdHeartbeat): Promise<PortResult<void>> => {
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, encodeFleetdHeartbeat(heartbeat), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};

/** A heartbeat store over no file: a read answers no heartbeat, a write fails. */
const unreadFleetdHeartbeat: FleetdHeartbeatStore = {
  read: async () => answered(null),
  write: async () => failed<void>(),
};

/**
 * The heartbeat store under a resolved state home.
 *
 * @param answer - the resolved state home.
 * @returns the file store, or, where the home is unread, a store whose read
 *   answers `answered(null)` and whose write answers `failed`.
 */
export const fleetdHeartbeatIn = (answer: StateHomeAnswer): FleetdHeartbeatStore =>
  'home' in answer ? fleetdHeartbeatFile({ home: answer.home }) : unreadFleetdHeartbeat;

/**
 * Reads the heartbeat synchronously, for a caller that cannot await.
 *
 * @param home - the state home the file lives under.
 * @returns the heartbeat, or null where the file is missing, unreadable or unrecognised.
 */
export const readFleetdHeartbeatSync = (home: StateHome): FleetdHeartbeat | null => {
  try {
    return decodeFleetdHeartbeat(readFileSync(fleetdHeartbeatPath(home), 'utf8'));
  } catch {
    return null;
  }
};
