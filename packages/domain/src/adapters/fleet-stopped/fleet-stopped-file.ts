import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodeFleetStopped, encodeFleetStopped, type FleetStopped } from '../../entities/fleet-stopped.js';
import type { FleetStoppedStore } from '../../ports/fleet-stopped.js';

/** Where the record lives under a repository root. */
export const fleetStoppedPath = (repoRoot: string): string =>
  join(repoRoot, '.plot', 'state', 'fleet-stopped.json');

/**
 * Keeps the fleet's stopped-branches record in `.plot/state/fleet-stopped.json`.
 *
 * @param repoRoot - the repository the file belongs to.
 * @returns a `FleetStoppedStore` over that one file.
 */
export const fleetStoppedFile = (repoRoot: string): FleetStoppedStore => {
  const path = fleetStoppedPath(repoRoot);
  return {
    read: async (): Promise<PortResult<FleetStopped | null>> => {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        // No file is no record, which is an answer; any other error is a failure.
        if ((error as { code?: string }).code === 'ENOENT') return answered(null);
        return failed<FleetStopped | null>();
      }
      return answered(decodeFleetStopped(text));
    },

    write: async (record: FleetStopped): Promise<PortResult<void>> => {
      // Whole or not at all: the rename is atomic within a directory.
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, encodeFleetStopped(record), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },

    clear: async (): Promise<PortResult<void>> => {
      try {
        await unlink(path);
        return answered(undefined);
      } catch (error) {
        // Already gone is already cleared.
        if ((error as { code?: string }).code === 'ENOENT') return answered(undefined);
        return failed<void>();
      }
    },
  };
};
