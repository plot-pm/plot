// The Tokens and Time left cells of a Fleet agent row, and the two rules under them.
import { describe, it, expect } from 'vitest';
import type { AgentPlacement } from '../src/rules/delivery-placement.js';
import { agentRowCells } from '../src/rules/delivery-row-form.js';
import { boundSecondsOf, timeLeft, timeLeftValue, TIME_LEFT_RED_BELOW } from '../src/rules/agent-time-left.js';
import { lastRunTokens, runLineRoleOf, tokenCountValue } from '../src/rules/agent-run-tokens.js';

const agent = (over: Partial<AgentPlacement> = {}): AgentPlacement =>
  ({ id: 'a', role: 'loop', section: 'fleet', group: 'working', actsOn: 'x', linked: true, blockedOn: null, ...over });

const NOW = 1_000_000_000_000;
const BOUND = 100; // seconds; 100 000 ms makes 20 % exactly 20 000 ms

describe('timeLeft', () => {
  it('is bound − (now − start), with the fraction left', () => {
    const t = timeLeft(NOW - 25_000, BOUND, NOW)!;
    expect(t.leftMs).toBe(75_000);
    expect(t.fraction).toBe(0.75);
    expect(t.red).toBe(false);
  });

  it('is red below 20 % left, and exactly 20 % is not', () => {
    expect(TIME_LEFT_RED_BELOW).toBe(0.2);
    expect(timeLeft(NOW - 80_000, BOUND, NOW)).toMatchObject({ fraction: 0.2, red: false });
    expect(timeLeft(NOW - 80_100, BOUND, NOW)!.red).toBe(true);
    expect(timeLeft(NOW - 79_900, BOUND, NOW)!.red).toBe(false);
  });

  it('is zero and red for a start older than the bound, never negative', () => {
    expect(timeLeft(NOW - 500_000, BOUND, NOW)).toEqual({ leftMs: 0, fraction: 0, red: true });
  });

  it('counts a start in the future as no time elapsed', () => {
    expect(timeLeft(NOW + 50_000, BOUND, NOW)).toEqual({ leftMs: 100_000, fraction: 1, red: false });
  });

  it('is null for a null or absent start and for a null or absent bound, not zero', () => {
    expect(timeLeft(null, BOUND, NOW)).toBeNull();
    expect(timeLeft(undefined, BOUND, NOW)).toBeNull();
    expect(timeLeft(NOW, null, NOW)).toBeNull();
    expect(timeLeft(NOW, undefined, NOW)).toBeNull();
  });

  it('is null for a bound of 0 or less and for a non-finite figure, with no division by zero', () => {
    expect(timeLeft(NOW, 0, NOW)).toBeNull();
    expect(timeLeft(NOW, -5, NOW)).toBeNull();
    expect(timeLeft(NOW, Number.NaN, NOW)).toBeNull();
    expect(timeLeft(Number.NaN, BOUND, NOW)).toBeNull();
  });

  it('is shown in hours and minutes', () => {
    expect(timeLeftValue(7 * 3_600_000 + 59 * 60_000 + 59_000)).toBe('7h 59m');
    expect(timeLeftValue(42 * 60_000)).toBe('42m');
    expect(timeLeftValue(0)).toBe('0m');
  });
});

describe('boundSecondsOf', () => {
  const bounds = { worker: 28800, reviewer: 3600, fixer: 1800 };
  it('picks the bound the table names per role', () => {
    expect(boundSecondsOf('loop', bounds)).toBe(28800);
    expect(boundSecondsOf('design', bounds)).toBe(28800);
    expect(boundSecondsOf('verify', bounds)).toBe(28800);
    expect(boundSecondsOf('reviewer', bounds)).toBe(3600);
    expect(boundSecondsOf('fixer', bounds)).toBe(1800);
  });
  it('is null for idea, brief and approver, and for bounds nobody read', () => {
    for (const role of ['idea', 'brief', 'approver'] as const) expect(boundSecondsOf(role, bounds)).toBeNull();
    expect(boundSecondsOf('loop', undefined)).toBeNull();
    expect(boundSecondsOf('loop', { worker: null, reviewer: null, fixer: null })).toBeNull();
  });
});

const model = (over: Record<string, number> = {}) => ({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0, ...over });
const run = (over: Record<string, unknown>): string => JSON.stringify({
  kind: 'run', branch: 'feature/x', at: '2026-11-18T10:00:00Z', sessionId: 's1', role: 'worker',
  models: { m: model() }, costUsd: 0, turns: 1, ...over,
});

describe('lastRunTokens', () => {
  it('gives the second run its difference against the same session, not its cumulative total', () => {
    const lines = [
      run({ models: { m: model({ outputTokens: 1000, inputTokens: 10 }) } }),
      run({ at: '2026-11-18T11:00:00Z', models: { m: model({ outputTokens: 1800, inputTokens: 25 }) } }),
    ];
    expect(lastRunTokens(lines, 'feature/x', 'loop')).toEqual({ inputTokens: 15, outputTokens: 800, cacheCreationTokens: 0, cacheReadTokens: 0 });
  });

  it('gives the first line of a session its own figure', () => {
    const lines = [
      run({ models: { m: model({ outputTokens: 1000 }) } }),
      run({ sessionId: 's2', models: { m: model({ outputTokens: 400 }) } }),
    ];
    expect(lastRunTokens(lines, 'feature/x', 'loop')!.outputTokens).toBe(400);
  });

  it('sums a run over its models and keeps the four counters apart', () => {
    const lines = [run({ models: { a: model({ outputTokens: 5, cacheReadTokens: 7 }), b: model({ outputTokens: 6, cacheReadTokens: 1 }) } })];
    expect(lastRunTokens(lines, 'feature/x', 'loop')).toEqual({ inputTokens: 0, outputTokens: 11, cacheCreationTokens: 0, cacheReadTokens: 8 });
  });

  it('reads only the branch and role asked, and skips seal lines and unparseable lines', () => {
    const seal = JSON.stringify({ branch: 'feature/x', at: 'x', tokens: { inputTokens: 1, outputTokens: 999, cacheCreationTokens: 0, cacheReadTokens: 0 }, turns: 1, models: [] });
    const lines = [
      run({ models: { m: model({ outputTokens: 10 }) } }),
      run({ branch: 'feature/other', models: { m: model({ outputTokens: 500 }) } }),
      run({ role: 'brief', sessionId: 's9', models: { m: model({ outputTokens: 600 }) } }),
      seal,
      '{ torn',
    ];
    expect(lastRunTokens(lines, 'feature/x', 'loop')!.outputTokens).toBe(10);
    expect(lastRunTokens(lines, 'feature/x', 'brief')!.outputTokens).toBe(600);
  });

  it('is null for an unreadable record, an empty record and a branch with no run line, never zero', () => {
    expect(lastRunTokens(null, 'feature/x', 'loop')).toBeNull();
    expect(lastRunTokens([], 'feature/x', 'loop')).toBeNull();
    expect(lastRunTokens([run({ branch: 'feature/y' })], 'feature/x', 'loop')).toBeNull();
    expect(lastRunTokens([run({})], '', 'loop')).toBeNull();
  });

  it('maps the loop role to the run-line role worker', () => {
    expect(runLineRoleOf('loop')).toBe('worker');
    expect(runLineRoleOf('fixer')).toBe('fixer');
  });

  it('counts as thousands and millions', () => {
    expect(tokenCountValue(842)).toBe('842');
    expect(tokenCountValue(1234)).toBe('1.2k');
    expect(tokenCountValue(12_345)).toBe('12k');
    expect(tokenCountValue(1_000)).toBe('1k');
    expect(tokenCountValue(2_500_000)).toBe('2.5M');
  });
});

describe('the Tokens cell', () => {
  const big = { inputTokens: 1200, outputTokens: 4300, cacheCreationTokens: 80_000, cacheReadTokens: 9_000_000 };

  it('shows the output figure, with the other three counters only in the tooltip', () => {
    const c = agentRowCells(agent(), { lastRun: big, running: false });
    expect(c.tokens).toEqual({ value: '4.3k out', links: [] });
    expect(c.tokens!.value).not.toMatch(/9|M/);
    expect(c.tokensTitle).toContain('4,300');
    expect(c.tokensTitle).toContain('1,200');
    expect(c.tokensTitle).toContain('80,000');
    expect(c.tokensTitle).toContain('9,000,000');
  });

  it('is null for a running agent, even with a reading', () => {
    const c = agentRowCells(agent(), { lastRun: big, running: true });
    expect(c.tokens).toBeNull();
    expect(c.tokensTitle).toBeNull();
  });

  it('is null where no run was read', () => {
    expect(agentRowCells(agent(), {}).tokens).toBeNull();
    expect(agentRowCells(agent(), { lastRun: null }).tokens).toBeNull();
  });
});

describe('the Time left cell', () => {
  it('shows the time and a bar for an agent with a start and a bound', () => {
    const c = agentRowCells(agent(), { startedAt: NOW - 25_000, boundSeconds: BOUND, now: NOW });
    expect(c.timeLeft).toEqual({ value: '1m', links: [] });
    expect(c.timeLeftBar).toEqual({ fraction: 0.75, red: false });
  });

  it('turns the bar red below 20 % and not at 20 %', () => {
    expect(agentRowCells(agent(), { startedAt: NOW - 80_000, boundSeconds: BOUND, now: NOW }).timeLeftBar!.red).toBe(false);
    expect(agentRowCells(agent(), { startedAt: NOW - 80_100, boundSeconds: BOUND, now: NOW }).timeLeftBar!.red).toBe(true);
  });

  it('draws a start older than the bound as 0 % and red', () => {
    expect(agentRowCells(agent(), { startedAt: NOW - 900_000, boundSeconds: BOUND, now: NOW }).timeLeftBar).toEqual({ fraction: 0, red: true });
  });

  it('has no cell and no bar for a bound with no start, a start with no bound, or no clock', () => {
    for (const facts of [
      { startedAt: null, boundSeconds: BOUND, now: NOW },
      { startedAt: NOW, boundSeconds: null, now: NOW },
      { startedAt: NOW, boundSeconds: BOUND },
      {},
    ]) {
      const c = agentRowCells(agent(), facts);
      expect(c.timeLeft).toBeNull();
      expect(c.timeLeftBar).toBeNull();
    }
  });
});
