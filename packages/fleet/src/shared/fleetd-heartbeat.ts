import {
  FLEETD_HEARTBEAT_VERSION,
  FLEETD_HEARTBEAT_MS,
  type FleetdHeartbeat,
  type FleetdHostTransport,
  type FleetdLoop,
  type FleetdSupervised,
} from '@plot-pm/domain';
import type { Clock } from '@plot-pm/domain/ports/clock';
import type { FleetState } from '@plot-pm/domain/ports/fleet-state';
import type { FleetdHeartbeatStore } from '@plot-pm/domain/ports/fleetd-heartbeat';

/**
 * Reads whether an init system started this process, from its environment.
 *
 * `XPC_SERVICE_NAME` is set by launchd to the job label. Terminal applications
 * also set it, to their own bundle name, so only a value equal to the fleet's
 * label reads as launchd. `INVOCATION_ID` is set by systemd for each unit
 * invocation. No process runs.
 *
 * @param env - the process environment.
 * @param label - the fleet's launchd label.
 * @returns `launchd`, `systemd` or `none`.
 */
export const supervisedFrom = (env: Record<string, string | undefined>, label: string): FleetdSupervised => {
  const xpc = env.XPC_SERVICE_NAME;
  if (xpc !== undefined && xpc !== '' && xpc === label) return 'launchd';
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
  /** The `at` of the last bridge this process wrote, epoch milliseconds; null before the first write. */
  bridgeAt: () => number | null;
  /**
   * When each loop last completed a pass, epoch milliseconds. A loop this process runs
   * and that has not yet passed reports null; a loop it does not run is absent.
   */
  passes: () => Partial<Record<FleetdLoop, number | null>>;
  /** How this process reads the git host; absent where it publishes none. */
  hostTransport?: FleetdHostTransport;
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
 * @returns a function that stops the beats and resolves once a final record,
 *   dated 0 so it reads `stale`, has replaced the last beat; calling it twice
 *   is safe.
 */
export const startFleetdHeartbeat = (
  clock: Clock,
  store: FleetdHeartbeatStore,
  source: FleetdHeartbeatSource,
  warn: (line: string) => void,
): (() => Promise<void>) => {
  let writing = false;
  let failing = false;
  let stopped = false;
  let inflight: Promise<void> = Promise.resolve();
  const record = (beatAt: number): FleetdHeartbeat => {
    const passes = source.passes();
    const loops: FleetdHeartbeat['loops'] = {};
    for (const loop of Object.keys(passes) as FleetdLoop[]) loops[loop] = { lastPassAt: passes[loop] ?? null };
    return {
      version: FLEETD_HEARTBEAT_VERSION,
      pid: source.pid,
      startedAt: source.startedAt,
      beatAt,
      generation: source.generation(),
      bridgeAt: source.bridgeAt(),
      supervised: source.supervised,
      watchesWanted: 0,
      watchesArmed: 0,
      lastEventAt: null,
      lastSafetyNetAt: null,
      ...(source.hostTransport === undefined ? {} : { hostTransport: source.hostTransport }),
      loops,
    };
  };
  const beat = async (): Promise<void> => {
    if (writing || stopped) return;
    writing = true;
    try {
      const at = clock.now();
      if (!at.ok) return;
      const heartbeat = record(at.value);
      const written = await store.write(heartbeat);
      if (!written.ok && !failing) warn('plot-fleetd: could not write fleetd.json — the heartbeat will read absent or stale\n');
      failing = !written.ok;
    } finally {
      writing = false;
    }
  };
  const start = (): void => {
    inflight = beat();
  };
  start();
  const cancel = clock.schedule(FLEETD_HEARTBEAT_MS, () => {
    start();
  });
  return async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    cancel();
    await inflight;
    await store.write(record(0));
  };
};

/**
 * Wraps a bridge store to remember the `at` of the last bridge a completed scan wrote.
 * A write that records a `running` or `failed` attempt is not counted.
 *
 * @param state - the bridge store fleetd writes through.
 * @returns the wrapped store, `writes` (the count of landed `ok` writes) and `bridgeAt`, which reads null until a write lands; a failed write leaves it unchanged.
 */
export const trackBridgeWrites = (state: FleetState): { state: FleetState; bridgeAt: () => number | null; writes: () => number } => {
  let bridgeAt: number | null = null;
  let writes = 0;
  return {
    state: {
      ...state,
      write: async (data) => {
        const written = await state.write(data);
        if (written.ok && data.attempt?.outcome === 'ok') {
          bridgeAt = data.at;
          writes += 1;
        }
        return written;
      },
    },
    bridgeAt: () => bridgeAt,
    writes: () => writes,
  };
};
