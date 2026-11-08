import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import {
  decodeFleetdHeartbeat,
  encodeFleetdHeartbeat,
  type FleetdHeartbeat,
} from '../../entities/fleetd-heartbeat.js';
import type { FleetdHeartbeatStore } from '../../ports/fleetd-heartbeat.js';

const mainRoots = new Map<string, string>();

/**
 * The main checkout a repository root belongs to.
 *
 * A linked worktree shares fleetd and the reader lock with its main checkout,
 * so all of them read one heartbeat. The root comes from `git rev-parse
 * --git-common-dir`, the directory the reader lock and `issues.json` resolve
 * from. Where that is not a `.git` directory, or git cannot answer, the root
 * is `repoRoot` itself. Cached per root: the answer cannot change while a
 * process runs.
 */
const mainRootOf = (repoRoot: string): string => {
  const known = mainRoots.get(repoRoot);
  if (known !== undefined) return known;
  let root = repoRoot;
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const common = out === '' ? null : resolve(repoRoot, out);
    if (common !== null && basename(common) === '.git') root = realpathSync(dirname(common));
  } catch {
    root = repoRoot;
  }
  mainRoots.set(repoRoot, root);
  return root;
};

/**
 * Where the heartbeat lives, beside `last-pulse.json`, under the main
 * checkout of the repository `repoRoot` belongs to.
 */
export const fleetdHeartbeatPath = (repoRoot: string): string => join(mainRootOf(repoRoot), '.plot', 'state', 'fleetd.json');

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
