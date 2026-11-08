import type { FleetdHeartbeat } from '../entities/fleetd-heartbeat.js';
import { fleetdLiveness, type FleetdLiveness } from './fleetd-live.js';
import type { SupervisorRun } from './supervisor-reading.js';

/** What the board's event hub knows about its channel link. */
export type ChannelLink = 'unknown' | 'up' | 'down';

/**
 * Where the board gets its supervisor reading for this beat.
 *
 * `heartbeat` carries the reading itself; `script` means the board must run
 * `plot-fleetctl.sh --status`.
 */
export type SupervisorSource = { source: 'heartbeat'; run: SupervisorRun } | { source: 'script' };

/**
 * Decides whether a beat needs `plot-fleetctl.sh --status`.
 *
 * A `live` heartbeat from a fleetd that an init system started proves the
 * supervisor is loaded: the reading is `up` and no script runs. A `stale` or
 * `absent` heartbeat, and a `live` one from a fleetd started by hand, leave the
 * question to the script, which keeps `down` and `died` their one source.
 *
 * @param heartbeat - the heartbeat read, or null where there is none.
 * @param now - the current time, epoch milliseconds.
 * @returns the reading to use, or `script` where the board must ask.
 */
export const supervisorSource = (heartbeat: FleetdHeartbeat | null, now: number): SupervisorSource =>
  heartbeat !== null && fleetdLiveness(heartbeat, now) === 'live' && heartbeat.supervised !== 'none'
    ? { source: 'heartbeat', run: { asked: true, exitCode: 0, summarised: true, supervisor: 'up' } }
    : { source: 'script' };

/** The two liveness facts the board reports side by side. */
export interface FleetdFacts {
  /** What the heartbeat file reads. */
  file: FleetdLiveness;
  /** What the board's channel link reads. */
  channel: ChannelLink;
}

/**
 * Pairs the heartbeat file's reading with the channel link's, choosing neither.
 *
 * @param heartbeat - the heartbeat read, or null where there is none.
 * @param channel - the hub's channel link.
 * @param now - the current time, epoch milliseconds.
 * @returns both facts.
 */
export const fleetdFacts = (heartbeat: FleetdHeartbeat | null, channel: ChannelLink, now: number): FleetdFacts => ({
  file: fleetdLiveness(heartbeat, now),
  channel,
});
