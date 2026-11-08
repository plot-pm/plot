import {
  FLEETD_HEARTBEAT_VERSION,
  FLEETD_HEARTBEAT_MS,
  type FleetdHeartbeat,
  type FleetdSupervised,
} from '@plot-pm/domain';
import type { Cancel, Clock } from '@plot-pm/domain/ports/clock';
import type { FleetdHeartbeatStore } from '@plot-pm/domain/ports/fleetd-heartbeat';

/**
 * Reads whether an init system started this process, from its environment.
 *
 * `XPC_SERVICE_NAME` is set by launchd to the job label, and to `0` for a
 * process started from a terminal session. `INVOCATION_ID` is set by systemd
 * for each unit invocation. No process runs.
 *
 * @param env - the process environment.
 * @returns `launchd`, `systemd` or `none`.
 */
export const supervisedFrom = (env: Record<string, string | undefined>): FleetdSupervised => {
  const xpc = env.XPC_SERVICE_NAME;
  if (xpc !== undefined && xpc !== '' && xpc !== '0') return 'launchd';
  const invocation = env.INVOCATION_ID;
  if (invocation !== undefined && invocation !== '') return 'systemd';
  return 'none';
};

/** What a heartbeat reports that fleetd's entry decides. */
export interface FleetdHeartbeatSource {
  /** This process's id. */
  pid: number;
  /** When this process started, epoch milliseconds. */
  startedAt: number;
  /** How this process was started. */
  supervised: FleetdSupervised;
  /** The generation of the `RepoSnapshot` fleetd holds. */
  generation: () => number;
}

/**
 * Starts fleetd's heartbeat: one write now, then one every `FLEETD_HEARTBEAT_MS`.
 *
 * The beat comes from the clock, never from a loop's work, so an idle
 * repository and a repository with no git host both keep beating. A write that
 * fails is warned once and retried on the next beat; the warning repeats only
 * after a write has succeeded in between. Writes never overlap.
 *
 * @param clock - the beat source; a manual clock in tests.
 * @param store - where the heartbeat lands.
 * @param source - what fleetd's entry reports.
 * @param warn - receives a one-line reason when a write fails.
 * @returns a function that stops the beats; calling it twice is safe.
 */
export const startFleetdHeartbeat = (
  clock: Clock,
  store: FleetdHeartbeatStore,
  source: FleetdHeartbeatSource,
  warn: (line: string) => void,
): Cancel => {
  let writing = false;
  let failing = false;
  const beat = async (): Promise<void> => {
    if (writing) return;
    writing = true;
    try {
      const at = clock.now();
      if (!at.ok) return;
      const heartbeat: FleetdHeartbeat = {
        version: FLEETD_HEARTBEAT_VERSION,
        pid: source.pid,
        startedAt: source.startedAt,
        beatAt: at.value,
        generation: source.generation(),
        bridgeAt: null,
        supervised: source.supervised,
        watchesWanted: 0,
        watchesArmed: 0,
        lastEventAt: null,
        lastSafetyNetAt: null,
        loops: {},
      };
      const written = await store.write(heartbeat);
      if (!written.ok && !failing) warn('plot-fleetd: could not write fleetd.json — the heartbeat will read absent or stale\n');
      failing = !written.ok;
    } finally {
      writing = false;
    }
  };
  void beat();
  return clock.schedule(FLEETD_HEARTBEAT_MS, () => void beat());
};
