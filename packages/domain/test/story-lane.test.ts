import { describe, expect, it } from 'vitest';
import { DEFAULT_PHASE_MAP, parsePhaseMap, phaseOfStory, type PhaseMap } from '../src/rules/workflow-phases.js';
import { storyLane, storyLanes, type StoryLaneMap } from '../src/rules/story-lane.js';
import type { StoryStanding } from '../src/transitions/story.js';

const mapOf = (phaseMap: PhaseMap): StoryLaneMap => ({
  holds: (status) => phaseOfStory(phaseMap, status as Parameters<typeof phaseOfStory>[1]) !== null,
});

const parsed = (value: string): PhaseMap => {
  const result = parsePhaseMap(value);
  if (!result.ok) throw new Error(`refused: ${result.refusal.reason}`);
  return result.map;
};

describe('storyLane', () => {
  it('reads Draft for standing draft, ready, paused', () => {
    for (const standing of ['draft', 'ready', 'paused'] as const) {
      expect(storyLane(standing, 'live')).toBe('Draft');
    }
  });

  it('reads Active for standing active, in-review', () => {
    for (const standing of ['active', 'in-review'] as const) {
      expect(storyLane(standing, 'live')).toBe('Active');
    }
  });

  it('reads Done for standing done', () => {
    expect(storyLane('done', 'live')).toBe('Done');
  });

  it('reads Done for derived standing archived', () => {
    expect(storyLane('archived' as StoryStanding, 'live')).toBe('Done');
  });

  it('reads Archived when the story lives under the archived directory, regardless of standing', () => {
    expect(storyLane('active', 'archived')).toBe('Archived');
    expect(storyLane('draft', 'archived')).toBe('Archived');
  });
});

describe('storyLanes', () => {
  it('omits a Draft-only status like paused when the map declares none and no story holds it', () => {
    const map = parsed('Discovery = story:draft, story:ready, story:active, story:in-review, story:done; ' +
      'Design = plan:draft, plan:design; Development = plan:approved; Testing = plan:delivered; Released = plan:released');
    const groups = storyLanes(mapOf(map), [
      { standing: 'draft' as StoryStanding, location: 'live' as const },
    ]);
    const names = groups.map((g) => g.lane);
    expect(names).toEqual(['Draft', 'Active', 'Done']);
    expect(names).not.toContain('Archived');
  });

  it('returns Draft, Active and Done under DEFAULT_PHASE_MAP', () => {
    const groups = storyLanes(mapOf(DEFAULT_PHASE_MAP), []);
    expect(groups.map((g) => g.lane)).toEqual(['Draft', 'Active', 'Done']);
  });

  it('reads a story with derived standing archived into Done under a map silent on story:* entirely', () => {
    const map = parsed('Design = plan:draft, plan:design; Development = plan:approved; ' +
      'Testing = plan:delivered; Released = plan:released');
    const groups = storyLanes(mapOf(map), [
      { standing: 'archived' as StoryStanding, location: 'live' as const },
    ]);
    const done = groups.find((g) => g.lane === 'Done');
    expect(done).toBeDefined();
    expect(done!.stories).toHaveLength(1);
  });

  it('places a story under the archived directory into Archived even with Draft/Active/Done standings present', () => {
    const groups = storyLanes(mapOf(DEFAULT_PHASE_MAP), [
      { standing: 'done' as StoryStanding, location: 'archived' as const },
    ]);
    const archived = groups.find((g) => g.lane === 'Archived');
    expect(archived).toBeDefined();
    expect(archived!.stories).toHaveLength(1);
    const done = groups.find((g) => g.lane === 'Done');
    expect(done!.stories).toHaveLength(0);
  });
});
