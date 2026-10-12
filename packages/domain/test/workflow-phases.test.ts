import { describe, expect, it } from 'vitest';

import { StoryStatusSchema } from '../src/entities/story.js';
import { BOARD_PHASES, PHASE_WORKFLOWS } from '../src/entities/workflow.js';
import {
  DEFAULT_PHASE_MAP,
  parsePhaseMap,
  phaseOfPlan,
  phaseOfStory,
  phaseWorkflows,
  planPhases,
  type PhaseMap,
} from '../src/rules/workflow-phases.js';

const parsed = (value: string): PhaseMap => {
  const result = parsePhaseMap(value);
  if (!result.ok) throw new Error(`refused: ${result.refusal.reason}`);
  return result.map;
};

const refusal = (value: string) => {
  const result = parsePhaseMap(value);
  if (result.ok) throw new Error('expected a refusal');
  return result.refusal;
};

describe('DEFAULT_PHASE_MAP', () => {
  it('names the five default phases in BOARD_PHASES order', () => {
    expect(DEFAULT_PHASE_MAP.map((entry) => entry.name)).toEqual([...BOARD_PHASES]);
  });

  it('equals what its own grammar parses to', () => {
    const text =
      'Discovery = story:*; Design = plan:draft, plan:design; Development = plan:approved; ' +
      'Testing = plan:delivered; Released = plan:released';
    expect(parsed(text)).toEqual(DEFAULT_PHASE_MAP);
  });
});

describe('parsePhaseMap', () => {
  it('keeps the declared order and expands story:* to every status', () => {
    const map = parsed('B = plan:approved; A = story:*, plan:draft');
    expect(map.map((entry) => entry.name)).toEqual(['B', 'A']);
    expect(map[1]!.story).toEqual([...StoryStatusSchema.options]);
  });

  it('accepts a phase name outside the five defaults', () => {
    expect(parsed('Triage = plan:draft').map((entry) => entry.name)).toEqual(['Triage']);
  });

  it('ignores a blank entry such as a trailing semicolon', () => {
    expect(parsed('A = plan:draft;  ;')).toHaveLength(1);
  });

  it.each([
    ['no "="', 'Design plan:draft', 'missing "="'],
    ['an empty name', ' = plan:draft', 'name is empty'],
    ['an empty member list', 'Design = ', 'no member'],
    ['an empty member', 'Design = plan:draft,, plan:design', 'member is empty'],
    ['a member without a prefix', 'Design = draft', 'lacks a "plan:" or "story:" prefix'],
    ['a prefix naming nothing', 'Design = plan:', 'names nothing'],
    ['an unknown plan state', 'Design = plan:bogus', 'not a plan state'],
    ['an unknown story status', 'Design = story:bogus', 'not a story status'],
    ['a repeated phase name', 'A = plan:draft; A = plan:approved', 'declared twice'],
  ])('refuses %s, naming the entry', (_label, value, reason) => {
    const found = refusal(value);
    expect(found.reason).toContain(reason);
    expect(value).toContain(found.entry);
    expect(found.entry).not.toBe('');
  });

  it('refuses an empty value', () => {
    expect(refusal('  ').reason).toContain('no phase');
  });

  it.each(['rejected', 'superseded'])('refuses plan:%s, which no phase can hold', (state) => {
    const found = refusal(`Design = plan:draft, plan:${state}`);
    expect(found.reason).toContain(`plan:${state} cannot be declared`);
  });

  it('refuses a plan state declared in two phases', () => {
    const found = refusal('A = plan:draft; B = plan:draft');
    expect(found.entry).toBe('B = plan:draft');
    expect(found.reason).toContain('already held by "A"');
  });

  it('refuses a story status declared in two phases, including through story:*', () => {
    expect(refusal('A = story:draft; B = story:draft').reason).toContain('already held by "A"');
    expect(refusal('A = story:*; B = story:done').reason).toContain('already held by "A"');
  });
});

describe('phaseOfPlan', () => {
  it('places each state in the phase holding it', () => {
    expect(phaseOfPlan(DEFAULT_PHASE_MAP, { state: 'draft' })).toBe('Design');
    expect(phaseOfPlan(DEFAULT_PHASE_MAP, { state: 'design' })).toBe('Design');
    expect(phaseOfPlan(DEFAULT_PHASE_MAP, { state: 'approved' })).toBe('Development');
    expect(phaseOfPlan(DEFAULT_PHASE_MAP, { state: 'delivered' })).toBe('Testing');
    expect(phaseOfPlan(DEFAULT_PHASE_MAP, { state: 'released' })).toBe('Released');
  });

  it('answers null for a state no phase holds', () => {
    for (const state of ['rejected', 'superseded', 'none', 'bogus']) {
      expect(phaseOfPlan(DEFAULT_PHASE_MAP, { state })).toBeNull();
    }
    expect(phaseOfPlan(parsed('A = plan:draft'), { state: 'approved' })).toBeNull();
  });

  it('reads a deliverable plan in the phase holding plan:delivered', () => {
    expect(phaseOfPlan(DEFAULT_PHASE_MAP, { state: 'approved', deliverable: true })).toBe('Testing');
    expect(phaseOfPlan(DEFAULT_PHASE_MAP, { state: 'approved', deliverable: false })).toBe('Development');
  });

  it('falls back to the state\'s own phase when no phase holds plan:delivered', () => {
    const map = parsed('A = plan:draft; B = plan:approved');
    expect(phaseOfPlan(map, { state: 'approved', deliverable: true })).toBe('B');
    expect(phaseOfPlan(map, { state: 'rejected', deliverable: true })).toBeNull();
  });
});

describe('phaseOfStory', () => {
  it('places every status in Discovery under the default map', () => {
    for (const status of StoryStatusSchema.options) {
      expect(phaseOfStory(DEFAULT_PHASE_MAP, status)).toBe('Discovery');
    }
  });

  it('answers null for a status no phase holds', () => {
    expect(phaseOfStory(parsed('A = story:draft'), 'done')).toBeNull();
  });
});

describe('planPhases', () => {
  it('lists the phases holding a plan state, in declared order', () => {
    expect(planPhases(DEFAULT_PHASE_MAP)).toEqual(['Design', 'Development', 'Testing', 'Released']);
    expect(planPhases(parsed('Z = story:*, plan:released; Y = plan:draft'))).toEqual(['Z', 'Y']);
  });
});

describe('phaseWorkflows', () => {
  it('equals the hand-written placement the default map replaced', () => {
    expect(phaseWorkflows(DEFAULT_PHASE_MAP)).toEqual({
      Discovery: [],
      Design: ['approve'],
      Development: ['dispatch', 'implement', 'deliver'],
      Testing: ['release'],
      Released: [],
    });
    expect(PHASE_WORKFLOWS).toEqual(phaseWorkflows(DEFAULT_PHASE_MAP));
  });

  it('gives a workflow to the first declared phase holding a state it acts on', () => {
    const map = parsed('Late = plan:design; Early = plan:draft; Build = plan:approved');
    expect(phaseWorkflows(map)).toEqual({
      Late: ['approve'],
      Early: [],
      Build: ['dispatch', 'implement', 'deliver'],
    });
  });

  it('gives a workflow to no phase when none holds its states', () => {
    expect(phaseWorkflows(parsed('A = plan:draft'))).toEqual({ A: ['approve'] });
  });
});
