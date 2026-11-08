import { describe, it, expect } from 'vitest';
import { admit, onJoin, route } from '../src/rules/channel.js';
import { SNAPSHOT_PROTOCOL, serves, isServed } from '../src/entities/subscription.js';
import { decode, encode, type DeltaMessage, type SnapshotMessage } from '../src/entities/channel-message.js';
import { applySnapshotMessage, type HeldSnapshot } from '../src/rules/snapshot-sync.js';
import { emptySnapshot } from '../src/entities/snapshot.js';
import { fullSnapshot } from './fixtures/snapshot.js';
import type { Finding } from '../src/entities/finding.js';

const EPOCH = '2026-11-08T10:00:00.000Z#4242';

const snapshotAt = (generation: number, over: Partial<SnapshotMessage> = {}): SnapshotMessage => ({
  type: 'snapshot',
  protocol: SNAPSHOT_PROTOCOL,
  epoch: EPOCH,
  generation,
  snapshot: { ...emptySnapshot(), generation },
  ...over,
});

const deltaFrom = (base: number, over: Partial<DeltaMessage> = {}): DeltaMessage => ({
  type: 'delta',
  protocol: SNAPSHOT_PROTOCOL,
  epoch: EPOCH,
  generation: base + 1,
  base,
  readings: { config: { state: 'read', readAt: 5, value: { a: 'b' } } },
  ...over,
});

const heldAt = (generation: number): HeldSnapshot => ({
  epoch: EPOCH,
  snapshot: { ...emptySnapshot(), generation },
});

const finding: Finding = {
  monitor: 'AgentMonitor',
  branch: 'feature/one',
  worktree: '/w/one',
  finding: 'owes a review',
  since: '2026-08-31T10:00:00Z',
  evidence: 'e',
  measuredAt: '2026-08-31T10:00:00Z',
};

describe('the snapshot purpose', () => {
  it('admits a matching protocol', () => {
    const actual = admit('c1', { subscriber: 'board', purpose: { kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL } });
    expect(actual).toEqual({
      ok: true,
      subscription: { id: 'c1', subscriber: 'board', purpose: { kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL } },
    });
  });

  it('refuses a different protocol and names both versions', () => {
    const actual = admit('c1', { purpose: { kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL + 1 } });
    expect(actual.ok).toBe(false);
    if (actual.ok) return;
    expect(actual.reason).toContain(`protocol ${SNAPSHOT_PROTOCOL};`);
    expect(actual.reason).toContain(`protocol ${SNAPSHOT_PROTOCOL + 1}`);
    expect(actual.asked).toBe(`snapshot protocol ${SNAPSHOT_PROTOCOL + 1}`);
  });

  it('refuses a snapshot purpose with no protocol as a malformed purpose', () => {
    expect(admit('c1', { purpose: { kind: 'snapshot' } }).ok).toBe(false);
  });

  it('leaves everything and until purposes unchanged', () => {
    expect(admit('c1', { purpose: { kind: 'everything' } }).ok).toBe(true);
    expect(admit('c1', { purpose: { kind: 'until', finding: 'pr merged' } }).ok).toBe(true);
    expect(admit('c1', 'nonsense').ok).toBe(false);
    expect(admit('c1', { purpose: 'nonsense' }).ok).toBe(false);
    expect(admit('c1', { purpose: { kind: 'everything', protocol: 9 } }).ok).toBe(true);
  });

  it('is served by no finding and finished by none', () => {
    const purpose = { kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL } as const;
    expect(serves(purpose, finding)).toBe(false);
    expect(isServed(purpose, finding)).toBe(false);
    const subscription = { id: 'c', subscriber: 's', purpose };
    expect(onJoin(subscription, [finding])).toEqual({ send: [], finished: false });
    expect(route([subscription], finding)).toEqual({ send: [], finished: [] });
  });
});

describe('the snapshot and delta messages', () => {
  it('round-trip through encode and decode', () => {
    const messages = [snapshotAt(4), deltaFrom(4)];
    for (const message of messages) expect(decode(encode(message))).toEqual(message);
  });

  it('skip a snapshot whose envelope generation differs from its body', () => {
    const line = JSON.stringify({ ...snapshotAt(4), generation: 5 });
    expect(decode(line)).toBeUndefined();
  });

  it('skip a delta that does not advance', () => {
    expect(decode(JSON.stringify(deltaFrom(4, { generation: 4 })))).toBeUndefined();
  });

  it('carry a full snapshot', () => {
    const message = snapshotAt(10, { snapshot: fullSnapshot() });
    expect(decode(encode(message))).toEqual(message);
  });
});

describe('applySnapshotMessage', () => {
  it('adopts a full snapshot', () => {
    const actual = applySnapshotMessage(undefined, snapshotAt(4));
    expect(actual).toEqual({ outcome: 'adopt', held: { epoch: EPOCH, snapshot: snapshotAt(4).snapshot } });
  });

  it('adopts a snapshot from a new epoch over a held copy', () => {
    const actual = applySnapshotMessage(heldAt(9), snapshotAt(1, { epoch: 'other' }));
    expect(actual).toMatchObject({ outcome: 'adopt', held: { epoch: 'other' } });
  });

  it('applies deltas in order and holds the last generation', () => {
    const first = applySnapshotMessage(undefined, snapshotAt(4));
    if (first.outcome !== 'adopt') throw new Error('expected adopt');
    const second = applySnapshotMessage(first.held, deltaFrom(4));
    if (second.outcome !== 'apply') throw new Error('expected apply');
    const third = applySnapshotMessage(second.held, deltaFrom(5, { readings: { refs: { state: 'unread' } } }));
    expect(second.outcome).toBe('apply');
    expect(third.outcome).toBe('apply');
    if (third.outcome !== 'apply') return;
    expect(third.held.snapshot.generation).toBe(6);
    expect(third.held.snapshot.readings.config).toEqual({ state: 'read', readAt: 5, value: { a: 'b' } });
    expect(third.held.snapshot.readings.refs).toEqual({ state: 'unread' });
  });

  it('does not change the held copy it was given', () => {
    const held = heldAt(4);
    applySnapshotMessage(held, deltaFrom(4));
    expect(held.snapshot.readings.config).toEqual({ state: 'unread' });
  });

  it('answers resync for a delta whose base is below the held generation', () => {
    const actual = applySnapshotMessage(heldAt(6), deltaFrom(5));
    expect(actual).toMatchObject({ outcome: 'resync' });
  });

  it('answers resync for a delta whose base is above the held generation', () => {
    expect(applySnapshotMessage(heldAt(4), deltaFrom(5)).outcome).toBe('resync');
  });

  it('answers resync for a delta from a new epoch', () => {
    const actual = applySnapshotMessage(heldAt(4), deltaFrom(4, { epoch: 'restarted' }));
    expect(actual).toMatchObject({ outcome: 'resync' });
    if (actual.outcome === 'resync') expect(actual.reason).toContain('restarted');
  });

  it('answers resync for a delta before any snapshot', () => {
    expect(applySnapshotMessage(undefined, deltaFrom(0)).outcome).toBe('resync');
  });

  it('answers mismatch for a refused answer', () => {
    const actual = applySnapshotMessage(heldAt(4), {
      type: 'refused',
      reason: 'a subscription must carry a purpose',
      asked: '',
      measurable: [],
    });
    expect(actual).toEqual({
      outcome: 'mismatch',
      reason: 'a subscription must carry a purpose',
      ours: SNAPSHOT_PROTOCOL,
      theirs: undefined,
    });
  });

  it('answers mismatch for a message of another protocol, snapshot or delta', () => {
    for (const message of [snapshotAt(4, { protocol: 2 }), deltaFrom(4, { protocol: 2 })]) {
      const actual = applySnapshotMessage(heldAt(4), message);
      expect(actual).toMatchObject({ outcome: 'mismatch', ours: SNAPSHOT_PROTOCOL, theirs: 2 });
      if (actual.outcome === 'mismatch') expect(actual.reason).toContain('protocol 2');
    }
  });
});
