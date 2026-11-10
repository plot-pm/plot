import { FLEETD_HEARTBEAT_VERSION, type FleetdHeartbeat } from '@plot-pm/domain/entities/fleetd-heartbeat';
import { fleetdHeartbeatFile } from '@plot-pm/domain/adapters';

/**
 * Writes fleetd's heartbeat file under `repoRoot`, as a running fleetd does.
 *
 * @param repoRoot - the repository root.
 * @param ageMs - how long ago it beat; 0 reads `live`, past 30 000 reads `stale`.
 * @param over - fields to replace.
 */
export const writeFleetdHeartbeat = async (repoRoot: string, ageMs = 0, over: Partial<FleetdHeartbeat> = {}): Promise<void> => {
  const beatAt = Date.now() - ageMs;
  await fleetdHeartbeatFile({ repoRoot }).write({
    version: FLEETD_HEARTBEAT_VERSION,
    pid: process.ppid,
    startedAt: beatAt - 600_000,
    beatAt,
    generation: 1,
    bridgeAt: null,
    supervised: 'none',
    watchesWanted: 0,
    watchesArmed: 0,
    lastEventAt: null,
    lastSafetyNetAt: null,
    loops: {},
    ...over,
  });
};
