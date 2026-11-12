import type { FleetdHeartbeat, FleetdLoop } from '../entities/fleetd-heartbeat.js';
import { missedBeatsTolerance } from './channel.js';

/** How often fleetd writes its heartbeat, in milliseconds: the fleet's 5 s beat. */
export const FLEETD_HEARTBEAT_MS = 5_000;

/** Whether fleetd's heartbeat reads as alive, late or missing. */
export type FleetdLiveness = 'live' | 'stale' | 'absent';

/**
 * How long each loop may go without completing a pass before it reads late.
 *
 * `scan` is twice the scan budget (`FLEET_SCAN_BUDGET_MS`, 90 s). `tick` is
 * five of its default 60 s intervals. `pr-reader` and `issue-reader` allow ten
 * minutes, because their gates back off after a host refusal.
 */
export const FLEETD_LOOP_BOUND_MS: Readonly<Record<FleetdLoop, number>> = {
  tick: 300_000,
  scan: 180_000,
  'pr-reader': 600_000,
  'issue-reader': 600_000,
};

/**
 * Reads whether fleetd is alive from its heartbeat.
 *
 * `live` while the heartbeat is at most three beats old. A heartbeat dated
 * after `now` reads `stale`, because a clock that moved backwards or a copied
 * checkout proves nothing about this process.
 *
 * @param heartbeat - the heartbeat read, or null where there is none.
 * @param now - the current time, epoch milliseconds.
 * @returns `absent` for no heartbeat, `live` for a recent one, `stale` otherwise.
 */
export const fleetdLiveness = (heartbeat: FleetdHeartbeat | null, now: number): FleetdLiveness => {
  if (heartbeat === null) return 'absent';
  const age = now - heartbeat.beatAt;
  return age >= 0 && age <= missedBeatsTolerance(2 * FLEETD_HEARTBEAT_MS) ? 'live' : 'stale';
};

/**
 * Reads whether every loop fleetd runs completed a pass within its own bound.
 *
 * A fresh `beatAt` proves the timer runs and nothing else; this answers the
 * wedged loop under a healthy timer. A loop that has not yet passed is judged
 * from `startedAt`. A loop absent from the heartbeat is not run and not judged.
 *
 * @param heartbeat - the heartbeat read.
 * @param now - the current time, epoch milliseconds.
 * @returns true when no loop is late.
 */
export const observerFresh = (heartbeat: FleetdHeartbeat, now: number): boolean =>
  lateLoops(heartbeat, now).length === 0;

/**
 * Reads whether fleetd is alive and its PR loop is not late.
 *
 * @param heartbeat - the heartbeat read, or null where there is none.
 * @param now - the current time, epoch milliseconds.
 * @returns true when the heartbeat reads `live` and `pr-reader` is not in {@link lateLoops}.
 */
export const fleetdReadsPrs = (heartbeat: FleetdHeartbeat | null, now: number): boolean =>
  heartbeat !== null && fleetdLiveness(heartbeat, now) === 'live' && !lateLoops(heartbeat, now).includes('pr-reader');

/**
 * Reads whether fleetd is alive and its issue loop is not late.
 *
 * A loop absent from the heartbeat is not run and not judged, as in {@link fleetdReadsPrs}.
 * A late `tick` or `scan` loop does not count: the issue index is written by `issue-reader` alone.
 *
 * @param heartbeat - the heartbeat read, or null where there is none.
 * @param now - the current time, epoch milliseconds.
 * @returns true when the heartbeat reads `live` and `issue-reader` is not in {@link lateLoops}.
 */
export const fleetdReadsIssues = (heartbeat: FleetdHeartbeat | null, now: number): boolean =>
  heartbeat !== null && fleetdLiveness(heartbeat, now) === 'live' && !lateLoops(heartbeat, now).includes('issue-reader');

/** The loops whose lateness is the heartbeat's age: a quiet fleetd runs no pass for them. */
const BY_BEAT: readonly FleetdLoop[] = ['tick', 'scan'];

/**
 * Names the loops that are late.
 *
 * `scan` and `tick` are late when `beatAt` is older than the loop's bound, not
 * when the last finished pass is: a scan that starts only on a trigger leaves
 * no pass on a quiet repository. `pr-reader` and `issue-reader` are late when
 * their last pass is older than the bound.
 *
 * @param heartbeat - the heartbeat read.
 * @param now - the current time, epoch milliseconds.
 * @returns the late loops, in `tick`, `scan`, `pr-reader`, `issue-reader` order.
 */
export const lateLoops = (heartbeat: FleetdHeartbeat, now: number): FleetdLoop[] =>
  (Object.keys(FLEETD_LOOP_BOUND_MS) as FleetdLoop[]).filter((loop) => {
    const pass = heartbeat.loops[loop];
    if (pass === undefined) return false;
    const since = BY_BEAT.includes(loop) ? heartbeat.beatAt : (pass.lastPassAt ?? heartbeat.startedAt);
    return now - since > FLEETD_LOOP_BOUND_MS[loop];
  });

/**
 * Reads whether fleetd vouches for a bridge as its latest write.
 *
 * True while the heartbeat reads `live`, its `scan` loop is not late and its
 * `bridgeAt` equals the bridge's `at`. An idle repository writes no new bridge, so the bridge ages
 * while fleetd is healthy; the heartbeat's `bridgeAt` names the one bridge
 * fleetd still stands behind. A heartbeat naming another bridge, or none,
 * vouches for nothing.
 *
 * @param bridge - the bridge read, by its `at` in epoch milliseconds.
 * @param heartbeat - the heartbeat read, or null where there is none.
 * @param now - the current time, epoch milliseconds.
 * @returns true when fleetd is live, its scan is on time and it names this bridge.
 */
export const bridgeVouched = (bridge: { at: number }, heartbeat: FleetdHeartbeat | null, now: number): boolean =>
  heartbeat !== null &&
  fleetdLiveness(heartbeat, now) === 'live' &&
  !lateLoops(heartbeat, now).includes('scan') &&
  heartbeat.bridgeAt === bridge.at;

/**
 * The sentence the board shows while a live fleetd leaves the scan to it
 * because a loop is late.
 *
 * @param loops - the late loops, from {@link lateLoops}.
 * @returns the note, or null where no loop is late.
 */
export const lateLoopNote = (loops: readonly FleetdLoop[]): string | null =>
  loops.length === 0 ? null : `the fleet is beating but its ${loops.join(', ')} loop has not completed a pass in time; the board scans in its place`;
