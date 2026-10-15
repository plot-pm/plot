import { storyLanes, phaseOfStory, ticketLanes, type StoryLaneMap, type TicketLaneGroups } from '@plot-pm/domain';
import { readConfigAsync, declaredPhaseMap, deriveStoryStatus, type BuildBoardOptions } from './board.js';
import { ticketLaneData, keptClosedRows } from './fleet.js';

/**
 * The last ticket lanes `discoveryLanes` computed successfully, by repo root and toggle state —
 * read back when `referencedIssues` answers null (the plans directory could not
 * be read), per the plan's "plans could not be read, keeps its last good
 * lanes" (plan.md:138), mirroring `refreshIssues`'s own kept-rows-on-failure
 * shape at `fleet.ts:1729-1732`. Never written from a `null`-`referenced` pass,
 * so a second consecutive read failure still serves the last SUCCESSFUL one
 * rather than null.
 */
const lastGoodTicketLanes = new Map<string, TicketLaneGroups>();

/**
 * Builds the Discovery tab's lane groups for `/api/board`.
 *
 * Reads `ticketLaneData` from the SAME cache `/api/fleet` reads, and with the
 * toggle on the rows `GET /api/issues/closed` kept ({@link keptClosedRows}) —
 * no tracker call of its own — lanes the tickets through `ticketLanes` and groups `board.stories`/`board.archivedStories` through
 * `storyLanes`. `archived` controls only whether archived-directory stories and
 * the open-ended Done tail are included; the cache read always happens, since
 * the first reading has to come from somewhere.
 *
 * `data.referenced === null` (the plans directory could not be read) is a
 * GROUP-level failure, not a per-ticket one — `ticketLane`'s own doc comment
 * forbids passing `namedByPlan: null` to it. So this function never does: it
 * reports `plansUnreadable: true` and serves {@link lastGoodTicketLanes} instead
 * of recomputing with a degraded reading.
 *
 * @param opts - the board's repo root and scripts directory.
 * @param board - the board payload already built by `boardState`.
 * @param archived - whether the Discovery tab's `?archived=1` toggle is on.
 * @returns tickets grouped by lane and stories grouped by lane.
 */
export const discoveryLanes = async (
  opts: BuildBoardOptions,
  board: { stories: Array<{ status: string; plans: Array<{ phase: string }> }>; archivedStories: Array<{ status: string; plans: Array<{ phase: string }> }> },
  archived: boolean,
) => {
  const [data, phasesValue] = await Promise.all([
    ticketLaneData(opts),
    readConfigAsync(opts, 'Workflow phases', ''),
  ]);
  const { map: phaseMap } = declaredPhaseMap(phasesValue);
  // `archived` is a derived standing `phaseOfStory`'s six-value vocabulary has
  // no word for — it answers false for it, the same as `storyLanes`'s own test
  // adapter: the map is silent on it by construction, not by omission.
  const laneMap: StoryLaneMap = {
    holds: (status) => status !== 'archived' && phaseOfStory(phaseMap, status) !== null,
  };

  // The grouping decisions — the toggle's lift of the 14-day window and the
  // Done cap, the row mapping and the kept lanes — are `ticketLanes`'s, in the
  // domain; this reads the cache and remembers the last good answer.
  const keptKey = `${opts.repoRoot}|${archived ? 'archived' : 'recent'}`;
  const { lanes, plansUnreadable } = data === null
    ? { lanes: null, plansUnreadable: false }
    : ticketLanes(
      data.open,
      data.closed,
      archived ? keptClosedRows(opts) : null,
      {
        categoryStated: data.categoryStated,
        named: data.referenced,
        kept: lastGoodTicketLanes.get(keptKey) ?? null,
        source: data.ticketSource,
        directory: data.directory,
      },
      archived,
      Date.now(),
    );
  if (lanes !== null && !plansUnreadable) lastGoodTicketLanes.set(keptKey, lanes);
  const liveStories = board.stories.map((s) => ({
    story: s,
    standing: deriveStoryStatus(s.status, s.plans),
    location: 'live' as const,
  }));
  const archivedStories = archived
    ? board.archivedStories.map((s) => ({
      story: s,
      standing: deriveStoryStatus(s.status, s.plans),
      location: 'archived' as const,
    }))
    : [];
  const storyLaneGroups = storyLanes(laneMap, [...liveStories, ...archivedStories]).map((g) => ({
    lane: g.lane,
    stories: g.stories.map((s) => s.story),
  }));

  return { tickets: lanes, plansUnreadable, storyLanes: storyLaneGroups };
};
