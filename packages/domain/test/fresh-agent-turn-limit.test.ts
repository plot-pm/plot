import { describe, it, expect } from 'vitest';
import { freshAgentTurnLimitAnswer } from '../src/rules/fresh-agent-turn-limit.js';

describe('freshAgentTurnLimitAnswer', () => {
  it('names the branch and the turn limit, and no correction budget', () => {
    const answer = freshAgentTurnLimitAnswer('infra/x');
    expect(answer).toContain('`infra/x`');
    expect(answer).toContain('Agent max turns');
    expect(answer).not.toContain('correction');
  });
});
