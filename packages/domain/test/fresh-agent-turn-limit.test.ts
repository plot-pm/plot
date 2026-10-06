import { describe, it, expect } from 'vitest';
import {
  freshAgentAfterTurnLimit,
  type FreshAgentTurnLimitReadings,
} from '../src/rules/fresh-agent-turn-limit.js';

const readings = (
  over: Partial<FreshAgentTurnLimitReadings> = {},
): FreshAgentTurnLimitReadings => ({
  ending: 'turn-limit',
  priorFreshSessions: 0,
  ...over,
});

describe('freshAgentAfterTurnLimit', () => {
  it('starts one fresh session the first time a slice reaches the turn limit', () => {
    expect(freshAgentAfterTurnLimit(readings())).toBe('start-fresh');
  });

  it('asks a person on a second turn-limit ending for the same slice', () => {
    expect(freshAgentAfterTurnLimit(readings({ priorFreshSessions: 1 }))).toBe('needs-a-person');
  });

  it('asks a person again on a third, a fourth — the count never resets itself', () => {
    expect(freshAgentAfterTurnLimit(readings({ priorFreshSessions: 2 }))).toBe('needs-a-person');
  });

  it('answers none for any ending but turn-limit', () => {
    for (const ending of [
      'bound',
      'quiet',
      'unreadable',
      'spent',
      'unstarted',
      'limited',
      'unregistered',
      'holding-work',
      'blocked',
      'checks-unanswered',
      'corrections-spent',
      'run-limit',
      'spend-limit',
    ] as const) {
      expect(freshAgentAfterTurnLimit(readings({ ending }))).toBe('none');
    }
  });

  it('answers none where no ending was read at all', () => {
    expect(freshAgentAfterTurnLimit(readings({ ending: null }))).toBe('none');
  });

  it('a missing record reads as no prior session, never as one already spent', () => {
    expect(freshAgentAfterTurnLimit(readings({ priorFreshSessions: 0 }))).toBe('start-fresh');
  });
});
