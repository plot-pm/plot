import { describe, it, expect } from 'vitest';
import { markReadyDecision, type MarkReadyReadings } from '../src/rules/mark-ready.js';
import type { AgentState } from '../src/entities/agent.js';

const SHA = 'abc1234';

const readings = (over: Partial<MarkReadyReadings> = {}): MarkReadyReadings => ({
  worker: 'finished',
  prOpen: true,
  draft: true,
  headSha: SHA,
  lastPushSha: SHA,
  ...over,
});

describe('markReadyDecision — one worker state per test', () => {
  const NOT_FINISHED: readonly AgentState[] = ['running', 'failed', 'ended', 'stalled', 'waiting', 'none', 'elsewhere'];

  it('answers true for finished with an open draft whose head matches the last push', () => {
    expect(markReadyDecision(readings({ worker: 'finished' }))).toBe(true);
  });

  for (const worker of NOT_FINISHED) {
    it(`answers false for ${worker}`, () => {
      expect(markReadyDecision(readings({ worker }))).toBe(false);
    });
  }
});

describe('markReadyDecision — head must equal the last push', () => {
  it('answers false when the PR head moved past the agent\'s last push', () => {
    expect(markReadyDecision(readings({ headSha: 'moved-on', lastPushSha: SHA }))).toBe(false);
  });
});

describe('markReadyDecision — not a draft', () => {
  it('answers false for an already-ready (non-draft) open PR', () => {
    expect(markReadyDecision(readings({ draft: false }))).toBe(false);
  });

  it('answers false for a closed PR', () => {
    expect(markReadyDecision(readings({ prOpen: false }))).toBe(false);
  });
});

describe('markReadyDecision — absent is not false read as true', () => {
  it('answers false when the PR head could not be read', () => {
    expect(markReadyDecision(readings({ headSha: undefined }))).toBe(false);
  });
});
