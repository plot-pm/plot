import type { FleetdHeartbeat } from '../entities/fleetd-heartbeat.js';
import { fleetdLiveness, observerFresh } from './fleetd-live.js';
import type { ReaderVerdict } from './reader-election.js';
import type { SnapshotLink } from './snapshot-link.js';

/** What the board server knows about who watches it. */
export interface BoardWatchReading {
  /** Event streams held open on `GET /api/events`. */
  clients: number;
}

/**
 * Whether the board runs its refresh pulse.
 *
 * A shown tab is an attached event stream, so the pulse runs while at least one
 * stream is attached and stops at zero.
 *
 * @param reading the number of attached event streams
 * @returns true while one or more streams are attached
 */
export const pulseWanted = ({ clients }: BoardWatchReading): boolean => clients > 0;

/** What a plain request knows about the board's last reads. */
export interface ColdReadReading {
  /** Whether the refresh pulse runs. */
  pulseRunning: boolean;
  /** Whether a scan is in progress. */
  scanning: boolean;
  /** When the last scan's answer is from, in milliseconds; null before the first. */
  lastScanAt: number | null;
  /** When the last cold read started, in milliseconds; null before the first. */
  lastColdReadAt: number | null;
  /** The request's time, in milliseconds. */
  now: number;
  /** The refresh period, in milliseconds. */
  refreshMs: number;
}

/**
 * Whether a plain request starts one scan.
 *
 * A request with no pulse running starts one scan when both the last scan and
 * the last cold read are at least `refreshMs` old, and never starts the pulse.
 * A running pulse or a scan in progress answers no. A clock that moved
 * backwards answers yes, since a negative gap proves nothing about recency.
 *
 * @param reading the pulse, the scan and the request time
 * @returns true when the request starts one scan
 */
export const coldReadDue = (reading: ColdReadReading): boolean => {
  if (reading.pulseRunning || reading.scanning) return false;
  const last = Math.max(reading.lastScanAt ?? -Infinity, reading.lastColdReadAt ?? -Infinity);
  const gap = reading.now - last;
  return gap < 0 || gap >= reading.refreshMs;
};

/** What the board knows when it decides whether to start this machine's PR reader. */
export interface ReaderWatchReading {
  /** Event streams held open on `GET /api/events`. */
  clients: number;
  /** The board's verdict over the reader lock. */
  verdict: ReaderVerdict;
  /** Whether a fresh `fleetd` heartbeat exists under the lock. */
  fleetdLive: boolean;
}

/**
 * Whether the board starts this machine's `plot-pr-reader.mjs`.
 *
 * The board starts the reader only while an event stream is attached, the lock
 * elects, and no live `fleetd` heartbeat already reads PRs. A plain request
 * with no stream attached starts no reader.
 *
 * @param reading the attached streams, the lock verdict and the fleetd heartbeat
 * @returns true when the board starts the reader
 */
export const readerWanted = ({ clients, verdict, fleetdLive }: ReaderWatchReading): boolean =>
  pulseWanted({ clients }) && verdict === 'elect' && !fleetdLive;

/** What the board knows about fleetd's channel when it picks where its view comes from. */
export interface BoardSourceReading {
  /** Event streams held open on `GET /api/events`. */
  clients: number;
  /** The `fleetdLiveness` answer for the heartbeat under the reader lock. */
  fleetd: 'live' | 'stale' | 'absent';
  /** Whether the heartbeat's observer stamp is fresh (`observerFresh`). */
  observerFresh: boolean;
  /**
   * The board's channel to fleetd: `current` holds a snapshot of this
   * protocol and generation, `mismatch` speaks another protocol, `resyncing`
   * waits for a full snapshot, and `none` holds no snapshot.
   */
  channel: 'current' | 'mismatch' | 'resyncing' | 'none';
}

/**
 * Where the board's view comes from: fleetd's snapshot, the board's own reads,
 * nowhere, or the last view held while a live fleetd speaks another protocol.
 */
export type BoardSource = 'snapshot' | 'own' | 'idle' | 'held';

/**
 * Picks the source of the board's view.
 *
 * @param reading the attached streams, fleetd's liveness and the channel state
 * @returns `held` while fleetd is `live` and the channel is `mismatch`, with or
 *   without a stream attached; `idle` with no stream attached; `snapshot` while
 *   fleetd is `live`, its observer is fresh and the channel is `current`; `own`
 *   otherwise
 */
export const boardSource = (reading: BoardSourceReading): BoardSource => {
  if (reading.fleetd === 'live' && reading.channel === 'mismatch') return 'held';
  if (!pulseWanted(reading)) return 'idle';
  return reading.fleetd === 'live' && reading.observerFresh && reading.channel === 'current' ? 'snapshot' : 'own';
};

/** What the board reads when it picks its source on one beat. */
export interface BoardSourceFacts {
  /** Event streams held open on `GET /api/events`. */
  clients: number;
  /** fleetd's heartbeat, or null where there is none to read. */
  heartbeat: FleetdHeartbeat | null;
  /** The hub's snapshot link, or undefined where the board has no hub. */
  link: SnapshotLink | undefined;
  /** The current time, epoch milliseconds. */
  now: number;
}

/**
 * The channel state `boardSource` reads, from the hub's snapshot link.
 *
 * @param link - the hub's snapshot link, or undefined where the board has no hub.
 * @returns `none` for no hub and for an `absent` link; the link's state otherwise.
 */
export const boardChannelOf = (link: SnapshotLink | undefined): BoardSourceReading['channel'] =>
  link === undefined || link.state === 'absent' ? 'none' : link.state;

/**
 * Picks the source of the board's view from the heartbeat and the snapshot link.
 *
 * @param facts - the attached streams, the heartbeat, the link and the clock.
 * @returns `boardSource` over `fleetdLiveness`, `observerFresh` and `boardChannelOf`.
 */
export const boardSourceOf = ({ clients, heartbeat, link, now }: BoardSourceFacts): BoardSource =>
  boardSource({
    clients,
    fleetd: fleetdLiveness(heartbeat, now),
    observerFresh: heartbeat !== null && observerFresh(heartbeat, now),
    channel: boardChannelOf(link),
  });

/** The command that reloads fleetd on the current bundle and signals no agent. */
export const FLEETD_RESTART_COMMAND = 'skills/plot/scripts/plot-fleetctl.sh --restart';

/**
 * The page's note for a board that holds its view because fleetd speaks
 * another snapshot protocol.
 *
 * @param source - where the board's last refresh took its view from, or null before the first.
 * @param link - the hub's snapshot link, or undefined where the board has no hub.
 * @returns null unless `source` is `held` and `link` is `mismatch`; otherwise
 *   one sentence naming both protocols and {@link FLEETD_RESTART_COMMAND}.
 */
export const heldViewNote = (source: BoardSource | null, link: SnapshotLink | undefined): string | null => {
  if (source !== 'held' || link === undefined || link.state !== 'mismatch') return null;
  const theirs = link.theirs === undefined
    ? 'fleetd refused this board\'s snapshot request'
    : `fleetd speaks snapshot protocol ${link.theirs}`;
  return `This board speaks snapshot protocol ${link.ours} and ${theirs}, so the board reads nothing for itself and shows fleetd's last bridge. `
    + `Run \`${FLEETD_RESTART_COMMAND}\` to load the current bundle into fleetd; it signals no agent.`;
};
