import { describe, expect, it } from 'vitest';

import type { Worktree } from '../src/entities/worktree.js';
import type { AgentDesk, AgentManifest } from '../src/ports/agents.js';
import type { PlanRecord } from '../src/ports/plan-store.js';
import type { ProcessReading } from '../src/ports/processes.js';
import type { RefState } from '../src/ports/refs.js';
import {
  READING_KEYS,
  RepoSnapshotSchema,
  emptySnapshot,
  readingValue,
  type DeskEntry,
  type DeskFiles,
  type PlanEntry,
  type RefEntry,
  type RegistryEntry,
  type DeskProcessReading,
} from '../src/entities/snapshot.js';
import { snapshotOf } from '../src/workflows/plan-walk-cache.js';
import { fullSnapshot } from './fixtures/snapshot.js';

describe('RepoSnapshotSchema', () => {
  it('names one reading key per source the story lists', () => {
    expect(READING_KEYS).toEqual([
      'refs',
      'desks',
      'deskFiles',
      'workers',
      'plans',
      'registry',
      'prs',
      'issues',
      'defaultBranch',
      'config',
      'walk',
      'branchDates',
      'ideaPlans',
      'releaseVersions',
      'unmerged',
      'questions',
    ]);
  });

  it('parses a snapshot that holds every key', () => {
    expect(RepoSnapshotSchema.parse(fullSnapshot())).toEqual(fullSnapshot());
  });

  it('parses the empty snapshot', () => {
    expect(RepoSnapshotSchema.parse(emptySnapshot())).toEqual(emptySnapshot());
  });

  it.each(READING_KEYS)('refuses a snapshot with no %s reading', (key) => {
    const snapshot = fullSnapshot();
    const readings: Record<string, unknown> = { ...snapshot.readings };
    delete readings[key];
    expect(RepoSnapshotSchema.safeParse({ ...snapshot, readings }).success).toBe(false);
  });

  it('refuses a snapshot with no generation', () => {
    const { readings } = fullSnapshot();
    expect(RepoSnapshotSchema.safeParse({ readings }).success).toBe(false);
  });

  it('refuses a failed reading that names no reason', () => {
    const snapshot = fullSnapshot();
    const readings = { ...snapshot.readings, prs: { state: 'failed', readAt: 1, reason: '' } };
    expect(RepoSnapshotSchema.safeParse({ ...snapshot, readings }).success).toBe(false);
  });

  it('refuses a read reading with no read time', () => {
    const snapshot = fullSnapshot();
    const readings = { ...snapshot.readings, prs: { state: 'read', value: [] } };
    expect(RepoSnapshotSchema.safeParse({ ...snapshot, readings }).success).toBe(false);
  });

  it('refuses a PR reading whose rows break the index row schema', () => {
    const snapshot = fullSnapshot();
    const readings = { ...snapshot.readings, prs: { state: 'read', readAt: 1, value: [{ number: 'seven' }] } };
    expect(RepoSnapshotSchema.safeParse({ ...snapshot, readings }).success).toBe(false);
  });
});

describe('emptySnapshot', () => {
  it('holds every key unread at generation 0', () => {
    const snapshot = emptySnapshot();
    expect(snapshot.generation).toBe(0);
    for (const key of READING_KEYS) expect(snapshot.readings[key]).toEqual({ state: 'unread' });
  });
});

describe('an unread reading is not an empty one', () => {
  it('keeps prs unread apart from prs read with zero rows', () => {
    const unread = emptySnapshot().readings.prs;
    const empty = { state: 'read', readAt: 5, value: [] } as const;
    expect(unread).not.toEqual(empty);
    expect(RepoSnapshotSchema.shape.readings.shape.prs.parse(unread)).toEqual({ state: 'unread' });
    expect(RepoSnapshotSchema.shape.readings.shape.prs.parse(empty)).toEqual(empty);
  });

  it('answers unknown for an unread reading', () => {
    expect(readingValue(emptySnapshot().readings.prs)).toBe('unknown');
  });

  it('answers unknown for a failed reading', () => {
    expect(readingValue({ state: 'failed', readAt: 5, reason: 'rate limited' })).toBe('unknown');
  });

  it('answers the rows for a read reading with zero rows', () => {
    expect(readingValue({ state: 'read', readAt: 5, value: [] })).toEqual({ value: [] });
  });
});

describe('the refs reading', () => {
  it('holds what the walk cache snapshot is rebuilt from, digest included', () => {
    const refs = fullSnapshot().readings.refs;
    if (refs.state !== 'read') throw new Error('fixture holds a read refs reading');
    const snapshot = snapshotOf(refs.value.entries);
    expect(snapshot.digest).toBe(refs.value.digest);
    expect(snapshot.headRef).toBe('refs/heads/main');
  });
});

describe('reading values match the port answers they record', () => {
  // Each pair is checked by tsc in both directions: slice 3 records a port's
  // answer as it arrives, and a reader hands the value back to a rule that
  // takes the port's type.
  const both = <A, B>(toB: (a: A) => B, toA: (b: B) => A) => [toB, toA];

  it('assigns in both directions', () => {
    const pairs = [
      both((r: RefState): RefEntry => r, (e: RefEntry): RefState => e),
      both((w: Worktree): DeskEntry => w, (d: DeskEntry): Worktree => d),
      both((d: AgentDesk): DeskFiles[string] => d, (d: DeskFiles[string]): AgentDesk => d),
      both((p: ProcessReading): DeskProcessReading => p, (w: DeskProcessReading): ProcessReading => w),
      both((p: PlanRecord): PlanEntry => p, (f: PlanEntry): PlanRecord => f),
      both((m: AgentManifest): RegistryEntry => m, (e: RegistryEntry): AgentManifest => e),
    ];
    expect(pairs).toHaveLength(6);
  });
});
