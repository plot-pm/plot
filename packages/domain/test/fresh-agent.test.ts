import { describe, it, expect } from 'vitest';
import { freshAgentAnswer } from '../src/rules/fresh-agent.js';

describe('freshAgentAnswer', () => {
  const input = {
    branch: 'feature/x',
    budget: 2,
    correctionsText:
      '## Correction 1 of 2 — the build failed on `feature/x`\n\nCI reported: domain coverage gate\n\n---\n\n## Correction 2 of 2 — the build failed on `feature/x`\n\nCI reported: domain coverage gate again\n\n---\n',
    runUrl: 'https://github.com/plot-pm/plot/actions/runs/123',
    conclusion: 'failure',
  };

  it('holds every correction in order', () => {
    const answer = freshAgentAnswer(input);
    const first = answer.indexOf('Correction 1 of 2');
    const second = answer.indexOf('Correction 2 of 2');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it('holds the failing run\'s URL', () => {
    expect(freshAgentAnswer(input)).toContain(input.runUrl);
  });

  it('holds the conclusion', () => {
    expect(freshAgentAnswer(input)).toContain('- conclusion: failure');
  });

  it('names the branch and the budget in the instruction', () => {
    const answer = freshAgentAnswer(input);
    expect(answer).toContain('feature/x');
    expect(answer).toContain('2');
  });

  it('says so rather than going silent when the corrections file could not be read', () => {
    const answer = freshAgentAnswer({ ...input, correctionsText: '' });
    expect(answer).toContain('No `PLOT-CORRECTION.md` could be read');
  });

  it('says so when neither the run URL nor the conclusion could be read', () => {
    const answer = freshAgentAnswer({ ...input, runUrl: '', conclusion: '' });
    expect(answer).toContain('No run could be read');
  });

  it('holds the run URL alone when the conclusion could not be read', () => {
    const answer = freshAgentAnswer({ ...input, conclusion: '' });
    expect(answer).toContain(input.runUrl);
    expect(answer).not.toContain('conclusion:');
  });

  it('holds the conclusion alone when the run URL could not be read', () => {
    const answer = freshAgentAnswer({ ...input, runUrl: '' });
    expect(answer).not.toContain('No run could be read');
    expect(answer).toContain('conclusion: failure');
  });
});
