// The Fleet header's counts and its today's-output-tokens figure.
import { describe, it, expect } from 'vitest';
import { finishedRuns, fleetCountText, fleetTokensFigure, tokensOnDay } from '../src/rules/agent-run-tokens.js';
import { placeDelivery, type AgentPlacementReading } from '../src/rules/delivery-placement.js';

const model = (over: Record<string, number> = {}) => ({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0, ...over });
const run = (over: Record<string, unknown>): string => JSON.stringify({
  kind: 'run', branch: 'feature/x', at: '2026-11-18T10:00:00', sessionId: 's1', role: 'worker',
  models: { m: model() }, costUsd: 0, turns: 1, ...over,
});
const DAY = { startMs: new Date(2026, 10, 18).getTime(), endMs: new Date(2026, 10, 19).getTime() };

describe('tokensOnDay', () => {
  it('sums every run of the day for one branch and nothing from yesterday', () => {
    const runs = finishedRuns([
      run({ at: '2026-11-17T23:00:00', sessionId: 'a', models: { m: model({ outputTokens: 900 }) } }),
      run({ at: '2026-11-18T09:00:00', sessionId: 'b', models: { m: model({ outputTokens: 100 }) } }),
      run({ at: '2026-11-18T11:00:00', sessionId: 'c', models: { m: model({ outputTokens: 40 }) } }),
    ]);
    expect(tokensOnDay(runs, DAY)!.outputTokens).toBe(140);
  });

  it('counts the difference of a session once, not its cumulative counters twice', () => {
    const runs = finishedRuns([
      run({ at: '2026-11-18T09:00:00', models: { m: model({ outputTokens: 100 }) } }),
      run({ at: '2026-11-18T10:00:00', models: { m: model({ outputTokens: 130 }) } }),
    ]);
    expect(tokensOnDay(runs, DAY)!.outputTokens).toBe(130);
  });

  it('keeps the four counters apart', () => {
    const runs = finishedRuns([run({ models: { m: model({ outputTokens: 5, cacheReadTokens: 5_000_000, inputTokens: 7, cacheCreationTokens: 9 }) } })]);
    expect(tokensOnDay(runs, DAY)).toEqual({ inputTokens: 7, outputTokens: 5, cacheCreationTokens: 9, cacheReadTokens: 5_000_000 });
  });

  it('counts a line whose at does not parse for no day, and a seal or junk line for nothing', () => {
    const runs = finishedRuns([run({ at: 'not a date', models: { m: model({ outputTokens: 50 }) } }), 'junk', JSON.stringify({ branch: 'feature/x', at: '2026-11-18T10:00:00', tokens: model(), turns: 1, models: [] })]);
    expect(tokensOnDay(runs, DAY)!.outputTokens).toBe(0);
  });

  it('is null for an unreadable record and 0 for a readable one with no run today', () => {
    expect(tokensOnDay(null, DAY)).toBeNull();
    expect(tokensOnDay(finishedRuns([]), DAY)!.outputTokens).toBe(0);
  });
});

describe('fleetTokensFigure', () => {
  it('shows output tokens alone and puts the other counters in the tooltip, with no total', () => {
    const f = fleetTokensFigure({ inputTokens: 7, outputTokens: 842, cacheCreationTokens: 9, cacheReadTokens: 5_000_000 }, '2026-11-18');
    expect(f.text).toBe('842 output tokens today, finished runs');
    expect(f.title).toContain('input tokens: 7');
    expect(f.title).toContain('cache creation tokens: 9');
    expect(f.title).toContain('cache read tokens: 5M');
    expect(f.title).toContain('2026-11-18');
  });

  it('shows a dash for an unreadable record and 0 for none today', () => {
    expect(fleetTokensFigure(null, '2026-11-18').text).toBe('—');
    expect(fleetTokensFigure({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, '2026-11-18').text).toBe('0 output tokens today, finished runs');
  });
});

describe('the Fleet counts', () => {
  const agent = (id: string, over: Partial<AgentPlacementReading>): AgentPlacementReading =>
    ({ id, role: 'loop', actsOn: 'x', blockedOn: null, process: 'running', ...over }) as AgentPlacementReading;

  it('equal the agents placed in each group, and an unread process is in none', () => {
    const placed = placeDelivery({
      items: [],
      agents: [
        agent('w1', {}), agent('w2', {}), agent('d1', { role: 'design' }),
        agent('b1', { role: 'verify', blockedOn: 'ci' }),
        agent('f1', { actsOn: null }), agent('f2', { actsOn: null, process: 'stopped' }),
        agent('u1', { process: undefined }),
      ],
    } as never, { mine: 'all' } as never);
    const count = (g: string) => placed.agents.filter((a) => a.group === g).length;
    expect([fleetCountText('working', count('working')), fleetCountText('blocked', count('blocked')), fleetCountText('free', count('free'))].join(' · ')).toBe('3 working · 1 blocked · 2 free');
    expect(count('working') + count('blocked') + count('free')).toBe(placed.agents.length);
    expect(placed.agents).toHaveLength(6);
    expect(placed.unplaced.map((u) => u.id)).toEqual(['u1']);
  });
});
