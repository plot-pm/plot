import type { Finding } from '@plot-pm/domain';
import { planStoreRef } from '@plot-pm/domain/adapters/plan-store/plan-store-ref';
import { fleetdLiveness } from '@plot-pm/domain/rules/fleetd-live';
import type { FleetdHeartbeat } from '@plot-pm/domain/entities/fleetd-heartbeat';
import {
  releaseUnbooked,
  releaseUnbookedShown,
  type ReleaseUnbookedAnswer,
  type ReleaseUnbookedShown,
} from '@plot-pm/domain/rules/release-unbooked';
import { releaseUnbookedReadingsFor } from '@plot-pm/fleet/shared/release-world';
import { lastFinishOf, type LastFinish } from '@plot-pm/domain/entities/release-finish-record';
import type { ReleaseFinishRecordStore } from '@plot-pm/domain/ports/release-finish-record';
import type { BuildBoardOptions } from './board.js';
import { readConfigAsync } from './board.js';
import { realEstate } from './estate.js';
import { releaseFinishRecordIn, stateHomeFor } from './state-home.js';

/** The `releaseUnbooked` answer the Delivery tab shows, its source, and the owed release's last recorded finish. */
export interface ReleaseUnbookedWithFinish extends ReleaseUnbookedShown {
  /** The owed release's last finish record; `null` where no release is owed, no record reads, or the read failed. */
  readonly lastFinish: LastFinish | null;
}

/**
 * The last recorded finish of the release an answer owes.
 *
 * @param shown - the answer and its source.
 * @param records - the release-finish record store.
 * @returns `{ at, outcome, reason }` of the record; `null` where nothing is owed, no record reads, or the read failed.
 */
const lastFinishFor = async (shown: ReleaseUnbookedShown, records: ReleaseFinishRecordStore): Promise<LastFinish | null> => {
  if (typeof shown.answer === 'string') return null;
  const read = await records.read(shown.answer.version).catch(() => ({ ok: false as const }));
  return read.ok ? lastFinishOf(read.value) : null;
};

/** How long the board reuses its own reading, in milliseconds. */
export const RELEASE_UNBOOKED_READ_MS = 60_000;

/** What the board's own reading reads; real adapters over `repoRoot` where absent. */
export type OwnUnbookedRead = (opts: BuildBoardOptions) => Promise<ReleaseUnbookedAnswer>;

/**
 * Asks `releaseUnbooked` from this checkout at `origin/<default branch>`, through the fleet's release reader.
 *
 * @param opts - the board options.
 * @returns the rule's answer; `unaskable` where the default branch's name does not read.
 */
export const ownUnbookedRead: OwnUnbookedRead = async (opts) => {
  const { refs } = realEstate(opts);
  const branch = await refs.defaultBranch();
  if (!branch.ok) return 'unaskable';
  const ref = `origin/${branch.value}`;
  // Plans read at the same ref as tags and sprints: the working tree lags a booking pushed from a temporary worktree.
  const planDir = (await readConfigAsync(opts, 'Plan directory', 'docs/plans/')).replace(/\/+$/, '');
  const readings = await releaseUnbookedReadingsFor({
    refs,
    plans: planStoreRef(refs, { repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }, ref, planDir),
    ref,
    sprintDir: await readConfigAsync(opts, 'Sprint directory', 'docs/sprints/'),
  });
  return releaseUnbooked(readings);
};

const memo = new Map<string, { at: number; answer: ReleaseUnbookedAnswer }>();

/**
 * The `releaseUnbooked` answer the Delivery tab shows, and its source.
 *
 * While fleetd's heartbeat reads `live` and the channel's findings are held,
 * the answer is fleetd's `release unbooked` finding. Otherwise the board asks
 * the rule itself, at most once per {@link RELEASE_UNBOOKED_READ_MS} per repository.
 *
 * @param opts - the board options; `channelFindings` is the hub's copy of the findings.
 * @param heartbeat - fleetd's heartbeat, or `null` where none reads.
 * @param now - the current time, epoch milliseconds.
 * The owed release's last finish record is read on every call and decides nothing about the answer.
 *
 * @param own - the board's own reading.
 * @param records - the release-finish record store; the file store under the state home where absent.
 * @returns the answer, its source, and the owed release's last recorded finish.
 */
export const releaseUnbookedFor = async (
  opts: BuildBoardOptions,
  heartbeat: FleetdHeartbeat | null,
  now: number,
  own: OwnUnbookedRead = ownUnbookedRead,
  records: ReleaseFinishRecordStore = releaseFinishRecordIn(stateHomeFor(opts)),
): Promise<ReleaseUnbookedWithFinish> => {
  const shown = await shownFor(opts, heartbeat, now, own);
  return { ...shown, lastFinish: await lastFinishFor(shown, records) };
};

/** The answer and its source, before the last finish is read. */
const shownFor = async (
  opts: BuildBoardOptions,
  heartbeat: FleetdHeartbeat | null,
  now: number,
  own: OwnUnbookedRead,
): Promise<ReleaseUnbookedShown> => {
  const findings: readonly Finding[] | null =
    fleetdLiveness(heartbeat, now) === 'live' ? (opts.channelFindings?.() ?? null) : null;
  if (findings !== null) return releaseUnbookedShown(findings, () => 'unaskable');
  const held = memo.get(opts.repoRoot);
  if (held !== undefined && now - held.at >= 0 && now - held.at < RELEASE_UNBOOKED_READ_MS) {
    return releaseUnbookedShown(null, () => held.answer);
  }
  const answer = await own(opts).catch((): ReleaseUnbookedAnswer => 'unaskable');
  memo.set(opts.repoRoot, { at: now, answer });
  return releaseUnbookedShown(null, () => answer);
};

/**
 * Forgets the board's own reading, so the next poll asks the rule again.
 *
 * @param repoRoot - the repository whose reading to forget; every repository where absent.
 */
export const forgetReleaseUnbooked = (repoRoot?: string): void => {
  if (repoRoot === undefined) memo.clear();
  else memo.delete(repoRoot);
};
