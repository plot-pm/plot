// The two readings behind the Fleet Tokens and Time left cells, and what the
// board pays for each: one stat per build, one parse or config read per change.
import { describe, it, expect } from 'vitest';
import { lastRunTokens } from '@plot-pm/domain';
import { spendCache, workerBoundCache, workerBoundOf } from '../../src/server/agent-readings.js';
import { statCache } from '../../src/server/stat-cache.js';
import { deliveryMapping, type RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';
import { agentRowFactsOf } from '../../src/app/lib/agent-rows/delivery-row-facts.js';
import { agentRowCells } from '@plot-pm/domain';

const model = (over: Record<string, number>) => ({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0, ...over });
const runLine = (branch: string, over: Record<string, unknown> = {}) => JSON.stringify({
  kind: 'run', branch, at: '2026-11-18T10:00:00Z', sessionId: `s-${branch}`, role: 'worker',
  models: { m: model({ outputTokens: 2000, cacheReadTokens: 5_000_000 }) }, costUsd: 0, turns: 1, ...over,
});

const counted = (keys: (string | null)[], lines: readonly string[] | null) => {
  const calls = { stat: 0, read: 0 };
  let i = 0;
  const cache = spendCache(
    async () => { calls.stat++; return keys[Math.min(i++, keys.length - 1)] ?? null; },
    async () => { calls.read++; return lines === null ? { ok: false as const } : { ok: true as const, value: lines }; },
  );
  return { calls, cache };
};

describe('the spend record cache', () => {
  it('parses once for eight agents and not again while the stat is unchanged', async () => {
    const lines = Array.from({ length: 8 }, (_, n) => runLine(`feature/a${n}`));
    const { calls, cache } = counted(['1:1'], lines);
    const build1 = await cache.get();
    for (let n = 0; n < 8; n++) expect(lastRunTokens(build1!.index, `feature/a${n}`, 'loop')!.outputTokens).toBe(2000);
    expect(calls).toEqual({ stat: 1, read: 1 });
    await cache.get();
    expect(calls).toEqual({ stat: 2, read: 1 });
  });

  it('parses again once when the stat changes', async () => {
    const { calls, cache } = counted(['1:1', '1:1', '2:2', '2:2'], [runLine('feature/a')]);
    await cache.get(); await cache.get(); await cache.get(); await cache.get();
    expect(calls.read).toBe(2);
    expect(calls.stat).toBe(4);
  });

  it('shows no figure for any agent on a failed read, and asks again on the next build', async () => {
    const { calls, cache } = counted(['1:1'], null);
    const spend = await cache.get();
    expect(spend).toBeNull();
    expect(lastRunTokens(spend === null ? null : spend.index, 'feature/a', 'loop')).toBeNull();
    await cache.get();
    expect(calls.read).toBe(2);
  });

  it('reads on every call where the source cannot be stat-ed', async () => {
    const { calls, cache } = counted([null], [runLine('feature/a')]);
    await cache.get(); await cache.get();
    expect(calls.read).toBe(2);
  });
});

describe('the Worker bound cache', () => {
  it('reads the config once across builds and again for a new modification time', async () => {
    let key = 'm1';
    let reads = 0;
    const cache = workerBoundCache(async () => key, async () => { reads++; return '28800'; });
    expect(await cache.get()).toBe(28800);
    expect(await cache.get()).toBe(28800);
    expect(reads).toBe(1);
    key = 'm2';
    await cache.get();
    await cache.get();
    expect(reads).toBe(2);
  });

  it('reads a positive whole number of seconds and nothing else', () => {
    expect(workerBoundOf('28800')).toBe(28800);
    for (const bad of ['', '0', '-3', '1.5', 'x']) expect(workerBoundOf(bad)).toBeNull();
  });
});

describe('statCache', () => {
  it('takes one stat per get', async () => {
    let stats = 0;
    const cache = statCache(async () => { stats++; return 'k'; }, async () => ({ ok: true, value: 1 }));
    await cache.get(); await cache.get(); await cache.get();
    expect(stats).toBe(3);
  });
});

describe('the Fleet agent row facts', () => {
  const NOW = 1_800_000_000_000;
  const agent = (over: Record<string, unknown>): RegistryAgent => ({
    session: 's', branch: 'feature/a', state: 'finished', pid: '', identity: 'manifest', worktree: '',
    relaunches: 0, startedAt: new Date(NOW - 3_600_000).toISOString(), ...over,
  }) as unknown as RegistryAgent;
  const mapOf = (agents: RegistryAgent[], bounds?: { worker: number | null; reviewer: number | null; fixer: number | null }) =>
    deliveryMapping({
      rows: [], slices: [], agents, drafts: [], reader: { hostUser: 'me' }, mode: 'all',
      config: { autoReview: true, correctionBudget: 2 }, bounds,
    });
  const idOf = (m: ReturnType<typeof mapOf>) => m.readings.agents[0]!.id;

  it('carries a finished agent’s last run, labelled output, with cache counters only in the tooltip', () => {
    const lastRun = { inputTokens: 10, outputTokens: 4300, cacheCreationTokens: 5, cacheReadTokens: 9_000_000 };
    const m = mapOf([agent({ lastRun })], { worker: 28800, reviewer: 3600, fixer: 3600 });
    const facts = agentRowFactsOf(m, idOf(m), NOW);
    const cells = agentRowCells({ id: idOf(m), role: 'loop', section: 'fleet', group: 'free', actsOn: null, linked: false, blockedOn: null }, facts);
    expect(cells.tokens!.value).toBe('4.3k out');
    expect(cells.tokensTitle).toContain('9,000,000');
    expect(cells.timeLeft!.value).toBe('7h 0m');
    expect(cells.timeLeftBar).toEqual({ fraction: 0.875, red: false });
  });

  it('shows — in Tokens for a running agent and in Time left with no bound read', () => {
    const lastRun = { inputTokens: 0, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 };
    const m = mapOf([agent({ state: 'running', lastRun })]);
    const facts = agentRowFactsOf(m, idOf(m), NOW);
    const cells = agentRowCells({ id: idOf(m), role: 'loop', section: 'fleet', group: 'working', actsOn: null, linked: false, blockedOn: null }, facts);
    expect(cells.tokens).toBeNull();
    expect(cells.timeLeft).toBeNull();
    expect(cells.agent).not.toBeNull();
  });
});
