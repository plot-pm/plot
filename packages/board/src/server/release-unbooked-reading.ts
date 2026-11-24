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
import type { BuildBoardOptions } from './board.js';
import { readConfigAsync } from './board.js';
import { realEstate } from './estate.js';

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
 * @param own - the board's own reading.
 * @returns the answer and its source.
 */
export const releaseUnbookedFor = async (
  opts: BuildBoardOptions,
  heartbeat: FleetdHeartbeat | null,
  now: number,
  own: OwnUnbookedRead = ownUnbookedRead,
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
