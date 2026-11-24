import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Finding } from '@plot-pm/domain';
import { startChannel, type RunningChannel } from '@plot-pm/domain/adapters';
import { startEventHub, type EventHub } from '../../src/server/channel-events.js';

/** The hub holds the channel's current findings, against a real channel socket. */

const finding = (over: Partial<Finding> = {}): Finding => ({
  monitor: 'ReleaseMonitor',
  branch: 'release',
  worktree: '',
  finding: 'release unbooked',
  since: '2026-11-24T10:00:00Z',
  evidence: 'v2.36.0: 1 plan(s) unbooked (alpha)',
  measuredAt: '2026-11-24T10:00:00Z',
  ...over,
});

const until = async (holds: () => boolean, ms = 4000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

let channel: RunningChannel | undefined;
let hub: EventHub | undefined;
const dirs: string[] = [];

const socketPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-held-'));
  dirs.push(dir);
  return join(dir, 'c.sock');
};

afterEach(async () => {
  hub?.close();
  hub = undefined;
  await channel?.stop();
  channel = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the event hub holds the findings', () => {
  it('answers null while no channel listens', () => {
    hub = startEventHub({ address: socketPath(), reconnectStartMs: 20, reconnectCapMs: 40 });
    expect(hub.findings()).toBeNull();
  });

  it('holds what the join resends, and replaces a finding by its key', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    channel.publish(finding());
    hub = startEventHub({ address, reconnectStartMs: 20, reconnectCapMs: 40 });
    await until(() => (hub!.findings() ?? []).length === 1);
    expect(hub.findings()![0]!.evidence).toBe('v2.36.0: 1 plan(s) unbooked (alpha)');

    channel.publish(finding({ finding: 'clear', evidence: 'release unbooked no longer holds' }));
    await until(() => hub!.findings()?.[0]?.finding === 'clear');
    expect(hub.findings()).toHaveLength(1);
  });
});
