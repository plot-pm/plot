import {
  storyLanes, phaseOfStory, ticketLanes, ticketCardFacts, withActionAvailability,
  type ActionAvailability, type StoryLaneMap, type TicketLaneGroups, type TicketLaneRow, type TicketPlan,
} from '@plot-pm/domain';
import type { TicketLaneGroups as WireTicketLanes, TicketLaneRow as WireTicketRow } from '../contract/schema.js';
import type { Known, Ref } from '@plot-pm/domain/entities/card-facts';
import { readConfigAsync, declaredPhaseMap, deriveStoryStatus, type BuildBoardOptions } from './board.js';
import { keptClosedRows, ensureCache, type TicketLaneData } from './fleet.js';

/**
 * The last ticket lanes `discoveryLanes` computed successfully, by repo root and toggle state —
 * read back when `ticketLaneData`'s `plans` answers null (the plans could not
 * be read), per the plan's "plans could not be read, keeps its last good
 * lanes" (plan.md:138), mirroring `refreshIssues`'s own kept-rows-on-failure
 * shape at `fleet.ts:1729-1732`. Never written from a `null`-`plans` pass,
 * so a second consecutive read failure still serves the last SUCCESSFUL one
 * rather than null.
 */
const lastGoodTicketLanes = new Map<string, TicketLaneGroups>();

/** What the ticket cards' facts read beside the lanes. */
export interface TicketFactsReading {
  /** The ticket → story index `Board.ticketStories` carries. */
  ticketStories: Known<Record<string, Ref[]>>;
  /** Which card actions this board runs. */
  available: ActionAvailability;
}

/**
 * The lanes with each ticket's card facts. The plans are the readings
 * `ticketLaneData` made, so a ticket's lane and its facts agree; with the plans
 * unread they read `unknown`.
 *
 * @param lanes - the ticket lanes to draw.
 * @param plans - the plans naming each issue key, or `null` where they could not be read.
 * @param reading - the story index and the board's action availability.
 * @param directory - the declared `People` spellings.
 * @returns the lanes, every row carrying `facts`.
 */
const withTicketFacts = (
  lanes: TicketLaneGroups,
  plans: ReadonlyMap<string, readonly TicketPlan[]> | null,
  reading: TicketFactsReading,
  directory: TicketLaneData['directory'],
): WireTicketLanes => {
  const factsFor = (lane: 'open' | 'in-progress' | 'done') => (row: TicketLaneRow): WireTicketRow => ({
    ...row,
    facts: withActionAvailability(
      ticketCardFacts({
        row,
        lane,
        plans: plans === null ? { unknown: 'failed' } : { value: plans.get(row.id) ?? [] },
        stories: 'unknown' in reading.ticketStories
          ? reading.ticketStories
          : { value: reading.ticketStories.value[row.id] ?? [] },
      }, directory),
      reading.available,
    ),
  });
  return {
    open: lanes.open.map(factsFor('open')),
    'in-progress': lanes['in-progress'].map(factsFor('in-progress')),
    done: lanes.done.map(factsFor('done')),
    moreCount: lanes.moreCount,
  };
};

/**
 * Builds the Discovery tab's lane groups for `/api/board`.
 *
 * Groups `ticketLaneData`'s answer, read from the SAME cache `/api/fleet` reads, and with the
 * toggle on the rows `GET /api/issues/closed` kept ({@link keptClosedRows}) —
 * no tracker call of its own — lanes the tickets through `ticketLanes` and groups `board.stories`/`board.archivedStories` through
 * `storyLanes`. `archived` controls only whether archived-directory stories and
 * the open-ended Done tail are included; the cache read always happens, since
 * the first reading has to come from somewhere.
 *
 * `data.plans === null` (the plans could not be read) is a GROUP-level
 * failure, not a per-ticket one — `ticketLane`'s own doc comment forbids
 * passing a null `plans` reading to it. So this function never does: it
 * reports `plansUnreadable: true` and serves {@link lastGoodTicketLanes} instead
 * of recomputing with a degraded reading.
 *
 * **`issueAnswer`/`issueAbsence` are read from `ensureCache(opts)` directly**,
 * never from `ticketLaneData`'s return — that return is `null` whenever
 * `entry.issueSets === null`, which loses the `nobody`-source absence
 * sentence along with the tickets. The two facts live on the cache entry
 * itself, so they survive a `null` ticket read.
 *
 * @param opts - the board's repo root and scripts directory.
 * @param board - the board payload already built by `boardState`.
 * @param archived - whether the Discovery tab's `?archived=1` toggle is on.
 * @param data - the request's one `ticketLaneData` answer, or null where it has none.
 * @param facts - what the ticket cards' facts read beside the lanes.
 * @returns tickets grouped by lane, stories grouped by lane, and the tracker answer.
 */
export const discoveryLanes = async (
  opts: BuildBoardOptions,
  board: { stories: Array<{ status: string; plans: Array<{ phase: string }> }>; archivedStories: Array<{ status: string; plans: Array<{ phase: string }> }> },
  archived: boolean,
  data: TicketLaneData | null,
  facts: TicketFactsReading,
) => {
  const phasesValue = await readConfigAsync(opts, 'Workflow phases', '');
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
        plans: data.plans,
        kept: lastGoodTicketLanes.get(keptKey) ?? null,
        source: data.ticketSource,
        directory: data.directory,
      },
      archived,
      Date.now(),
    );
  if (lanes !== null && !plansUnreadable) lastGoodTicketLanes.set(keptKey, lanes);
  const { issueAnswer, issueAbsence } = ensureCache(opts);
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

  // Facts are attached after the kept lanes are stored, so a kept lane is re-derived
  // against the current plans reading and stories rather than served stale.
  const tickets = lanes !== null && data !== null ? withTicketFacts(lanes, data.plans, facts, data.directory) : lanes;
  return { tickets, plansUnreadable, storyLanes: storyLaneGroups, issueAnswer, issueAbsence };
};
