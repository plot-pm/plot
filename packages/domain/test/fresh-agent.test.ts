import { describe, it, expect } from 'vitest';
import {
  freshAgentAfterCorrections,
  freshAgentAnswer,
  type FreshAgentReadings,
} from '../src/rules/fresh-agent.js';

const readings = (over: Partial<FreshAgentReadings> = {}): FreshAgentReadings => ({
  ending: 'corrections-spent',
  hasManifest: false,
  priorFreshSessions: 0,
  ...over,
});

describe('freshAgentAfterCorrections', () => {
  it('starts one fresh session the first time a slice spends its budget', () => {
    expect(freshAgentAfterCorrections(readings())).toBe('start-fresh');
  });

  it('asks a person on the second spent budget on the same slice', () => {
    // THE UNBOUNDED CASE THE PLAN NAMES. A rule that restarted forever would
    // pass every test above this one and still be wrong — this is the bound.
    expect(freshAgentAfterCorrections(readings({ priorFreshSessions: 1 }))).toBe('needs-a-person');
  });

  it('asks a person again on a third, a fourth — the count never resets itself', () => {
    expect(freshAgentAfterCorrections(readings({ priorFreshSessions: 2 }))).toBe('needs-a-person');
  });

  it('answers none for any ending but corrections-spent', () => {
    for (const ending of [
      'bound',
      'quiet',
      'unreadable',
      'spent',
      'limited',
      'unregistered',
      'holding-work',
      'blocked',
      'checks-unanswered',
    ] as const) {
      expect(freshAgentAfterCorrections(readings({ ending }))).toBe('none');
    }
  });

  it('answers none for an unstarted ending — the meaning this value used to carry', () => {
    // CATCHES THE REGRESSION NAMED IN THE PLAN: a prompt that never ran is a
    // different failure from a spent budget, and the two shared one reason
    // before this rule existed. A rule that still answered on 'unstarted'
    // would silently widen itself back to the overloaded meaning.
    expect(freshAgentAfterCorrections(readings({ ending: 'unstarted' }))).toBe('none');
  });

  it('answers none where no ending was read at all', () => {
    expect(freshAgentAfterCorrections(readings({ ending: null }))).toBe('none');
  });

  it('a missing record reads as no prior session, never as one already spent', () => {
    // THE PLAN'S OWN SPLIT: absent is not false, and absent is not true either.
    // A missing fresh-agents.tsv can start one session too many; it must never
    // read as "this slice already had one" and strand it at a person for a
    // record this estate never wrote. The caller distinguishes "no record" from
    // "a record saying zero" before this rule ever sees `priorFreshSessions`,
    // so both arrive here as 0 and both get the same answer.
    expect(freshAgentAfterCorrections(readings({ priorFreshSessions: 0 }))).toBe('start-fresh');
  });

  it('does not start a desk a manifest already names, even on corrections-spent', () => {
    // CATCHES A TICK THAT ACTS ON BOTH THE SUPERVISE PATH AND THIS RULE. A
    // manifest naming the desk means something else is already acting on it —
    // this rule's start-fresh must never race it.
    expect(freshAgentAfterCorrections(readings({ hasManifest: true }))).toBe('none');
  });

  it('a manifest present overrides even a second spent budget — still none, not needs-a-person', () => {
    expect(
      freshAgentAfterCorrections(readings({ hasManifest: true, priorFreshSessions: 1 })),
    ).toBe('none');
  });

  it('answers none for an agent-written PLOT-BLOCKED with no corrections-spent ending', () => {
    // CATCHES A RULE KEYED ON THE MARKER'S PRESENCE, WHICH WOULD ANSWER A
    // QUESTION NOBODY ASKED IT. This rule takes no marker-presence reading at
    // all — only the ending matters — so a desk ending 'blocked' (an agent's
    // own question) must read none here whatever marker sits in the tree.
    expect(freshAgentAfterCorrections(readings({ ending: 'blocked' }))).toBe('none');
  });
});

describe('freshAgentAnswer', () => {
  const input = {
    branch: 'feature/x',
    budget: 2,
    correctionsText:
      '## Correction 1 of 2 — the build failed on `feature/x`\n\nCI reported: domain coverage gate\n\n---\n\n## Correction 2 of 2 — the build failed on `feature/x`\n\nCI reported: domain coverage gate again\n\n---\n',
    runUrl: 'https://github.com/plot-pm/plot/actions/runs/123',
    failedStep: 'domain coverage',
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

  it('holds the failed step', () => {
    expect(freshAgentAnswer(input)).toContain('domain coverage');
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

  it('says so when neither the run URL nor the failed step could be read', () => {
    const answer = freshAgentAnswer({ ...input, runUrl: '', failedStep: '' });
    expect(answer).toContain('No run could be read');
  });
});
