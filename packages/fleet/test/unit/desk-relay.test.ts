import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { deskFixture, deskFs, startChannel, subscribe, type RunningChannel } from '@plot-pm/domain/adapters';
import { answered, failed, type PortResult } from '@plot-pm/domain';
import type { Finding, MonitorName } from '@plot-pm/domain/entities/finding';
import type { Worktree } from '@plot-pm/domain/entities/worktree';
import type { ChannelMessage } from '@plot-pm/domain/entities/channel-message';
import { runIndexMonitor } from '../../src/shared/index-monitor.js';
import { runDeskRelay, type DeskRelayWorld } from '../../src/shared/desk-relay.js';

const NOW = '2026-10-10T12:00:00Z';

const finding = (over: Partial<Finding> = {}): Finding => ({
  monitor: 'AgentMonitor',
  branch: 'feature/one',
  worktree: '/w/one',
  finding: 'owes a review',
  since: '2026-10-10T09:00:00Z',
  evidence: '4 commits ahead, no PR',
  measuredAt: '2026-10-10T09:05:00Z',
  ...over,
});

const tree = (path: string, branch: string): Worktree => ({ path, branch }) as Worktree;

/**
 * A channel that follows the real one: one slot per monitor and branch, a
 * `clear` held in its slot the way `absorb` holds it, `publish` recording its
 * monitor's `lastSeen` and `relay` leaving it alone.
 */
const fakeChannel = () => {
  const slots = new Map<string, Finding>();
  const seen: MonitorName[] = [];
  const lastSeen = new Map<MonitorName, string>();
  const published: Finding[] = [];
  const hold = (f: Finding): void => {
    published.push(f);
    slots.set(`${f.monitor} ${f.branch}`, f);
  };
  return {
    slots,
    seen,
    lastSeen,
    published,
    channel: {
      findings: (): readonly Finding[] => [...slots.values()],
      publish: (f: Finding): void => {
        lastSeen.set(f.monitor, NOW);
        hold(f);
      },
      relay: hold,
      seen: (m: MonitorName): void => {
        seen.push(m);
        lastSeen.set(m, NOW);
      },
    },
  };
};

/** The findings a fake channel holds that are not retractions. */
const holding = (c: ReturnType<typeof fakeChannel>): readonly Finding[] =>
  [...c.slots.values()].filter((f) => f.finding !== 'clear');

interface Estate {
  trees: PortResult<readonly Worktree[]>;
  logs: Record<string, readonly Finding[]>;
  unreadable?: readonly string[];
}

/** A relay world over a mutable estate, so a test can change the desks between runs. */
const worldOver = (estate: Estate, channel: ReturnType<typeof fakeChannel>) => {
  const lines: string[] = [];
  const world: DeskRelayWorld = {
    trees: { list: async () => estate.trees },
    desk: {
      readFindings: async (worktree) =>
        deskFixture({ findings: estate.logs, unreadableFindings: estate.unreadable }).readFindings(worktree),
    },
    channel: channel.channel,
    now: () => NOW,
    log: (l) => lines.push(l),
  };
  return { world, lines };
};

const oneDesk = (over: Partial<Estate> = {}): Estate => ({
  trees: answered([tree('/w/one', 'feature/one')]),
  logs: { '/w/one': [finding()] },
  ...over,
});

describe('runDeskRelay', () => {
  it('publishes a desk finding verbatim, keeping its monitor, since and measuredAt', async () => {
    const c = fakeChannel();
    const w = worldOver(oneDesk(), c);
    await runDeskRelay(w.world);
    expect(c.published).toEqual([finding()]);
    expect(w.lines).toEqual([
      'plot-fleetd: desk-relay publish AgentMonitor feature/one: owes a review (4 commits ahead, no PR)\n',
    ]);
  });

  it('publishes nothing on the second run over an unchanged file', async () => {
    const c = fakeChannel();
    const w = worldOver(oneDesk(), c);
    await runDeskRelay(w.world);
    await runDeskRelay(w.world);
    expect(c.published).toHaveLength(1);
  });

  it('publishes nothing for the same finding and evidence with a later measuredAt', async () => {
    const c = fakeChannel();
    const estate = oneDesk();
    await runDeskRelay(worldOver(estate, c).world);
    estate.logs = { '/w/one': [finding({ measuredAt: '2026-10-10T11:59:00Z', since: '2026-10-10T11:00:00Z' })] };
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.published).toHaveLength(1);
  });

  it('publishes once for the same finding word with new evidence', async () => {
    const c = fakeChannel();
    const estate = oneDesk();
    await runDeskRelay(worldOver(estate, c).world);
    estate.logs = { '/w/one': [finding({ evidence: '5 commits ahead, no PR' })] };
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.published).toHaveLength(2);
    expect(c.published[1]?.evidence).toBe('5 commits ahead, no PR');
  });

  it('clears the slot when the desk finding is gone', async () => {
    const c = fakeChannel();
    const estate = oneDesk();
    await runDeskRelay(worldOver(estate, c).world);
    estate.logs = { '/w/one': [] };
    const w = worldOver(estate, c);
    await runDeskRelay(w.world);
    expect(holding(c)).toEqual([]);
    expect(c.published[1]).toMatchObject({ monitor: 'AgentMonitor', branch: 'feature/one', finding: 'clear', since: NOW });
    expect(w.lines[0]).toContain('desk-relay clear AgentMonitor feature/one');
  });

  it('clears the slots of a desk removed from the worktree list', async () => {
    const c = fakeChannel();
    const estate = oneDesk();
    await runDeskRelay(worldOver(estate, c).world);
    estate.trees = answered([]);
    await runDeskRelay(worldOver(estate, c).world);
    expect(holding(c)).toEqual([]);
    expect(c.slots.get('AgentMonitor feature/one')?.finding).toBe('clear');
  });

  it('sends a removed desk exactly one clear across two runs', async () => {
    const c = fakeChannel();
    const estate = oneDesk();
    await runDeskRelay(worldOver(estate, c).world);
    estate.trees = answered([]);
    await runDeskRelay(worldOver(estate, c).world);
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.published.filter((f) => f.finding === 'clear')).toHaveLength(1);
    expect(c.published).toHaveLength(2);
  });

  it('keeps a held finding where the worktree list fails', async () => {
    const c = fakeChannel();
    const estate = oneDesk();
    await runDeskRelay(worldOver(estate, c).world);
    estate.trees = failed();
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.slots.size).toBe(1);
    expect(c.published).toHaveLength(1);
  });

  it('keeps a held finding where the desk log cannot be read', async () => {
    const c = fakeChannel();
    const estate = oneDesk();
    await runDeskRelay(worldOver(estate, c).world);
    estate.unreadable = ['/w/one'];
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.slots.size).toBe(1);
    expect(c.published).toHaveLength(1);
  });

  it('does not relay a leftover finding naming a branch the desk no longer holds', async () => {
    const c = fakeChannel();
    const estate = oneDesk({ trees: answered([tree('/w/one', 'feature/other')]) });
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.published).toEqual([]);
  });

  it('lets a detached head contribute nothing', async () => {
    const c = fakeChannel();
    const estate = oneDesk({ trees: answered([tree('/w/one', '')]) });
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.published).toEqual([]);
  });

  it('shares one slot between two desks and lets the newest measuredAt win', async () => {
    const c = fakeChannel();
    const older = finding({ worktree: '/w/a', evidence: 'older', measuredAt: '2026-10-10T08:00:00Z' });
    const newer = finding({ worktree: '/w/b', evidence: 'newer', measuredAt: '2026-10-10T10:00:00Z' });
    const estate: Estate = {
      trees: answered([tree('/w/a', 'feature/one'), tree('/w/b', 'feature/one')]),
      logs: { '/w/a': [older], '/w/b': [newer] },
    };
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.published).toEqual([newer]);
  });

  it('touches no IndexMonitor slot, and the IndexMonitor run touches no relayed slot', async () => {
    const c = fakeChannel();
    const index = finding({ monitor: 'IndexMonitor', finding: 'checks green', worktree: '', branch: 'feature/two' });
    c.channel.publish(index);
    const estate = oneDesk();
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.slots.get('IndexMonitor feature/two')).toEqual(index);
    estate.trees = answered([]);
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.slots.get('IndexMonitor feature/two')).toEqual(index);

    const relayed = fakeChannel();
    await runDeskRelay(worldOver(oneDesk(), relayed).world);
    await runIndexMonitor({
      index: async () => ({ v: 4, connector: 'github', watermark: null, complete: true, at: NOW, wholeAt: NOW, rows: [] }) as never,
      defaultBranch: async () => null,
      sliceBranches: async () => new Set(['feature/one']),
      channel: relayed.channel,
      now: () => NOW,
      log: () => undefined,
    });
    expect(relayed.slots.get('AgentMonitor feature/one')).toEqual(finding());
  });

  it('never moves lastSeen, for a publish or for a clear', async () => {
    const c = fakeChannel();
    const estate = oneDesk();
    await runDeskRelay(worldOver(estate, c).world);
    estate.logs = { '/w/one': [] };
    await runDeskRelay(worldOver(estate, c).world);
    expect(c.published.map((f) => f.finding)).toEqual(['owes a review', 'clear']);
    expect(c.seen).toEqual([]);
    expect([...c.lastSeen.keys()]).toEqual([]);
  });
});

describe('a subscriber on a real socket', () => {
  let channel: RunningChannel | undefined;
  let dir = '';
  afterEach(async () => {
    await channel?.stop();
    channel = undefined;
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('waiting until owes a review is served after the desk file gains that line', async () => {
    dir = mkdtempSync(join(tmpdir(), 'plot-desk-relay-'));
    const desk = join(dir, 'desk');
    mkdirSync(desk);
    channel = await startChannel({ address: join(dir, 'c.sock') });
    const messages: ChannelMessage[] = [];
    const served = new Promise<void>((resolve, reject) => {
      subscribe(
        { address: join(dir, 'c.sock'), subscriber: 't', purpose: { kind: 'until', finding: 'owes a review', branch: '' } },
        (m) => messages.push(m),
        (reason) => (messages.some((m) => m.type === 'served') ? resolve() : reject(new Error(`ended: ${reason}`))),
      );
    });
    while (channel.subscriberCount() === 0) await new Promise((r) => setTimeout(r, 10));

    const trees = { list: async () => answered([tree(desk, 'feature/one')]) };
    const world: DeskRelayWorld = {
      trees,
      desk: deskFs(trees as never),
      channel,
      now: () => NOW,
      log: () => undefined,
    };
    writeFileSync(join(desk, '.plot-worker.monitor.agent.jsonl'), '');
    await runDeskRelay(world);
    expect(messages.some((m) => m.type === 'served')).toBe(false);

    appendFileSync(
      join(desk, '.plot-worker.monitor.agent.jsonl'),
      `${JSON.stringify(finding({ worktree: desk }))}\n`,
    );
    await runDeskRelay(world);
    await served;
    expect(messages.some((m) => m.type === 'served')).toBe(true);
  });
});
