import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import {
  decodeFleetdHeartbeat,
  encodeFleetdHeartbeat,
  type FleetdHeartbeat,
} from '../../entities/fleetd-heartbeat.js';
import type { FleetdHeartbeatStore } from '../../ports/fleetd-heartbeat.js';

/** Where the heartbeat lives under a repository root, beside `last-pulse.json`. */
export const fleetdHeartbeatPath = (repoRoot: string): string => join(repoRoot, '.plot', 'state', 'fleetd.json');

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Keeps fleetd's heartbeat as `.plot/state/fleetd.json` under the repository root.
 *
 * Each write goes to a temp file and then `rename`s over the heartbeat, so a
 * reader sees the previous heartbeat or the new one and never half of one.
 *
 * @param options - the repository root the file lives under.
 * @returns a `FleetdHeartbeatStore` backed by one file.
 */
export const fleetdHeartbeatFile = (options: { repoRoot: string }): FleetdHeartbeatStore => {
  const path = fleetdHeartbeatPath(options.repoRoot);
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
        await mkdir(join(options.repoRoot, '.plot', 'state'), { recursive: true });
        await writeFile(temp, encodeFleetdHeartbeat(heartbeat), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};

/**
 * Reads the heartbeat synchronously, for a caller that cannot await.
 *
 * @param repoRoot - the repository root the file lives under.
 * @returns the heartbeat, or null where the file is missing, unreadable or unrecognised.
 */
export const readFleetdHeartbeatSync = (repoRoot: string): FleetdHeartbeat | null => {
  try {
    return decodeFleetdHeartbeat(readFileSync(fleetdHeartbeatPath(repoRoot), 'utf8'));
  } catch {
    return null;
  }
};
