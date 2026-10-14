import type { StoryStanding } from '../transitions/story.js';

/** D7's four Discovery lanes for a story. */
export type StoryLaneName = 'Draft' | 'Active' | 'Done' | 'Archived';

/** Where a story's file lives, the other input `storyLane` needs beside its standing. */
export type StoryLocation = 'archived' | 'live';

const LANE_OF_STANDING: Record<StoryStanding, StoryLaneName> = {
  draft: 'Draft',
  ready: 'Draft',
  paused: 'Draft',
  active: 'Active',
  'in-review': 'Active',
  done: 'Done',
  archived: 'Done',
};

/**
 * Which of D7's four lanes a story renders in.
 *
 * A story under `<Story directory>/archived/` renders in Archived regardless
 * of its standing — the location wins, because a story a person filed away is
 * shown as archived even if nobody updated its `status:` field to match.
 *
 * @param standing - the story's derived standing (`derivedStanding`).
 * @param location - whether the story's file lives under the archived directory.
 * @returns the lane the story renders in.
 */
export const storyLane = (standing: StoryStanding, location: StoryLocation): StoryLaneName =>
  location === 'archived' ? 'Archived' : LANE_OF_STANDING[standing];

/** One story as `storyLanes` groups it. */
export interface StoryLaneInput {
  readonly standing: StoryStanding;
  readonly location: StoryLocation;
}

/** A PhaseMap's view of which story statuses a lane holds, keyed by lane name. */
export interface StoryLaneMap {
  /** Whether the declared phase map holds this story status at all. */
  holds(status: StoryStanding): boolean;
}

/** One lane and the stories it holds. */
export interface StoryLaneGroup<T> {
  readonly lane: StoryLaneName;
  readonly stories: readonly T[];
}

const STANDINGS_OF_LANE: Record<Exclude<StoryLaneName, 'Archived'>, readonly StoryStanding[]> = {
  Draft: ['draft', 'ready', 'paused'],
  Active: ['active', 'in-review'],
  Done: ['done', 'archived'],
};

/**
 * Groups stories into D7's four lanes, restricted to lanes a declared phase
 * map names or that hold at least one story.
 *
 * `Archived` is never restricted by the map: it answers the `location` input
 * alone, which `workflow-phases.ts` has no vocabulary for. A `Draft`/`Active`/
 * `Done` lane is omitted only when the map declares none of its standings AND
 * no story in the input holds it — an empty lane the map does not mention is
 * left out, not rendered blank.
 *
 * @param map - the declared phase map's view of which story statuses it holds.
 * @param stories - every story to place, with its standing and location.
 * @returns one group per lane that survives the restriction, in D7's order,
 *   each carrying the stories placed in it (Archived only ever holds stories
 *   whose `location` is `archived`).
 */
export const storyLanes = <T extends StoryLaneInput>(
  map: StoryLaneMap,
  stories: readonly T[],
): StoryLaneGroup<T>[] => {
  const placed = new Map<StoryLaneName, T[]>([
    ['Draft', []], ['Active', []], ['Done', []], ['Archived', []],
  ]);
  for (const story of stories) {
    placed.get(storyLane(story.standing, story.location))!.push(story);
  }

  const order: StoryLaneName[] = ['Draft', 'Active', 'Done', 'Archived'];
  return order
    .filter((lane) => {
      if (lane === 'Archived') return placed.get(lane)!.length > 0;
      const declared = STANDINGS_OF_LANE[lane].some((status) => map.holds(status));
      return declared || placed.get(lane)!.length > 0;
    })
    .map((lane) => ({ lane, stories: placed.get(lane)! }));
};
