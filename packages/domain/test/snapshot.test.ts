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
  type RepoSnapshot,
} from '../src/entities/snapshot.js';
import { snapshotOf } from '../src/workflows/plan-walk-cache.js';
import { planRecord } from '../src/adapters/plan-store/plan-store-fixture.js';
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
      'branchPlans',
      'sprints',
      'stories',
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

describe('the plan-card readings', () => {
  const entry: PlanEntry = {
    ...planRecord({ file: 'docs/plans/2026-01-01-x.md', phase: 'delivered' }),
    issues: ['226', 'PROJ-12'],
    designRaw: '2026-10-12, alice, cli',
    verifiedRaw: 'delivery 2026-11-01 at abc1234',
    rounds: 2,
  };
  const story = {
    slug: 's', title: 'S', status: 'active', declaredStatus: 'active', issue: '#3170', author: 'jwloka',
    created: '2026-11-01', updated: '2026-11-02', objective: 'o', design: 'd', path: 'docs/stories/s/STORY-s.md',
    designDocs: ['DESIGN-a.md'], hasOpenPoints: true, hasSessionLog: false, tablePlans: ['a-plan'],
  };
  const withReadings = (): RepoSnapshot => {
    const snapshot = fullSnapshot();
    snapshot.readings.plans = {
      state: 'read',
      readAt: 2,
      value: {
        ref: 'origin/main',
        resolved: 'a'.repeat(40),
        records: [entry, { ...planRecord({ file: 'docs/plans/missing.md' }), error: 'file not found' }],
        authors: { state: 'read', value: { [entry.file]: 'Jan Wloka' } },
        delivered: { state: 'read', value: { [entry.file]: { claimLines: ['- Claim-1 supported — it works'], deliveryCommit: 'abc1234' } } },
      },
    };
    snapshot.readings.branchPlans = {
      state: 'read',
      readAt: 2,
      value: [{ branch: 'feature/y', path: 'docs/plans/2026-01-02-other-name.md', record: planRecord({ file: 'docs/plans/2026-01-02-other-name.md', phase: 'draft' }) }],
    };
    snapshot.readings.stories = { state: 'read', readAt: 2, value: { live: [story], archived: [{ ...story, slug: 'old' }] } };
    return snapshot;
  };

  it.each([
    ['issues', (s: RepoSnapshot) => (s.readings.plans.state === 'read' ? s.readings.plans.value.records[0]!.issues : null)],
    ['designRaw', (s: RepoSnapshot) => (s.readings.plans.state === 'read' ? s.readings.plans.value.records[0]!.designRaw : null)],
    ['verifiedRaw', (s: RepoSnapshot) => (s.readings.plans.state === 'read' ? s.readings.plans.value.records[0]!.verifiedRaw : null)],
    ['rounds', (s: RepoSnapshot) => (s.readings.plans.state === 'read' ? s.readings.plans.value.records[0]!.rounds : null)],
    ['error', (s: RepoSnapshot) => (s.readings.plans.state === 'read' ? s.readings.plans.value.records[1]!.error : null)],
    ['resolved', (s: RepoSnapshot) => (s.readings.plans.state === 'read' ? s.readings.plans.value.resolved : null)],
    ['authors', (s: RepoSnapshot) => (s.readings.plans.state === 'read' ? s.readings.plans.value.authors : null)],
    ['delivered', (s: RepoSnapshot) => (s.readings.plans.state === 'read' ? s.readings.plans.value.delivered : null)],
    ['branchPlans', (s: RepoSnapshot) => s.readings.branchPlans],
    ['sprints', (s: RepoSnapshot) => s.readings.sprints],
    ['stories', (s: RepoSnapshot) => s.readings.stories],
  ])('round-trips %s through RepoSnapshotSchema as JSON', (_field, pick) => {
    const snapshot = withReadings();
    const parsed = RepoSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
    expect(pick(parsed)).toEqual(pick(snapshot));
    expect(pick(parsed)).not.toBeNull();
    expect(pick(parsed)).not.toBeUndefined();
  });

  it('refuses a failed author answer that names no reason', () => {
    const snapshot = withReadings();
    if (snapshot.readings.plans.state !== 'read') throw new Error('fixture');
    const plans = { ...snapshot.readings.plans, value: { ...snapshot.readings.plans.value, authors: { state: 'failed', reason: '' } } };
    expect(RepoSnapshotSchema.safeParse({ ...snapshot, readings: { ...snapshot.readings, plans } }).success).toBe(false);
  });

  it('holds no identity key', () => {
    expect(READING_KEYS as readonly string[]).not.toContain('identity');
    expect(Object.keys(RepoSnapshotSchema.shape.readings.shape)).not.toContain('identity');
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
