import { describe, it, expect } from 'vitest';
import { logMissNotFound, logMissWord, type LogMissReason } from '../src/index.js';

const reasons: LogMissReason[] = ['no-worktree', 'no-log', 'unreadable', 'pulse-partial', 'no-pulse'];

describe('logMissWord', () => {
  it('gives each reason its own sentence', () => {
    const words = reasons.map(logMissWord);
    expect(new Set(words).size).toBe(reasons.length);
    for (const word of words) expect(word.length).toBeGreaterThan(0);
  });

  it('tells a partial pulse apart from no pulse', () => {
    expect(logMissWord('pulse-partial')).toContain('has not reached this branch yet');
    expect(logMissWord('no-pulse')).toContain('no fleet reading');
  });

  it('names the worktree for a missing worktree and a missing log', () => {
    expect(logMissWord('no-worktree')).toContain('No worktree');
    expect(logMissWord('no-log')).toContain('no worker has written a log');
    expect(logMissWord('unreadable')).toContain('permissions');
  });
});

describe('logMissNotFound', () => {
  it('answers 404 only when the board has no desk to look in', () => {
    expect(reasons.filter(logMissNotFound)).toEqual(['no-worktree', 'pulse-partial', 'no-pulse']);
  });
});
