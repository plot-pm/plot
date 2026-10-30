import { describe, it, expect } from 'vitest';
import { releaseFinish, type ReleaseFinishReadings, type ScopePlan } from '../src/workflows/release-finish.js';

const plan = (slug: string, over: Partial<ScopePlan> = {}): ScopePlan => ({
  slug,
  file: `docs/plans/2026-10-01-${slug}.md`,
  type: 'feature',
  phase: 'delivered',
  releasedRecord: '',
  ...over,
});

const readings = (over: Partial<ReleaseFinishReadings> = {}): ReleaseFinishReadings => ({
  caller: 'person',
  version: 'v2.30.0',
  tagExists: true,
  scope: [plan('a'), plan('b', { type: 'docs' }), plan('c', { type: 'infra' })],
  sprint: { slug: 'w44', file: 'docs/sprints/2026-w44.md', state: 'active' },
  ...over,
});

const input = { on: '2026-10-30' };

const reasonOf = (r: ReleaseFinishReadings) => {
  const out = releaseFinish(r, input);
  return out.outcome === 'refused' ? out.reason : out.outcome;
};

describe('releaseFinish — books a release in one commit', () => {
  it('refuses an unattended caller and a fleetd caller', () => {
    expect(reasonOf(readings({ caller: 'unattended' }))).toBe('unattended');
    expect(reasonOf(readings({ caller: 'fleetd' }))).toBe('unattended');
  });

  it('refuses tag-absent and writes nothing', () => {
    const out = releaseFinish(readings({ tagExists: false }), input);
    expect(out.outcome).toBe('refused');
    expect(out).toMatchObject({ reason: 'tag-absent' });
  });

  it('books docs and infra plans as Released with the others', () => {
    const out = releaseFinish(readings(), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['a', 'b', 'c']);
    const phases = out.writes.filter((w) => w.kind === 'plan-phase').map((w) => w.file);
    expect(phases).toHaveLength(3);
  });

  it('writes one commit and one push, with the sprint close in that commit', () => {
    const out = releaseFinish(readings(), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    const commits = out.writes.filter((w) => w.kind === 'commit');
    expect(commits).toHaveLength(1);
    expect(out.writes.filter((w) => w.kind === 'push')).toHaveLength(1);
    expect(out.detail.closeSprint).toBe('w44');
    expect(commits[0]).toMatchObject({ paths: expect.arrayContaining(['docs/sprints/2026-w44.md']) });
  });

  it('records each plan with the date and the version', () => {
    const out = releaseFinish(readings({ scope: [plan('a')] }), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.writes).toContainEqual({
      kind: 'plan-record',
      file: 'docs/plans/2026-10-01-a.md',
      field: 'Released',
      value: '2026-10-30, v2.30.0',
    });
  });

  it('answers already-released and writes nothing on a second run', () => {
    const done = readings({
      scope: [plan('a', { phase: 'released', releasedRecord: '2026-10-30, v2.30.0' })],
      sprint: { slug: 'w44', file: 'docs/sprints/2026-w44.md', state: 'closed' },
    });
    expect(reasonOf(done)).toBe('already-released');
  });

  it('books only the plans not yet released and still closes an open sprint', () => {
    const half = readings({
      scope: [plan('a', { phase: 'released', releasedRecord: '2026-10-30, v2.30.0' }), plan('b')],
    });
    const out = releaseFinish(half, input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['b']);
    expect(out.detail.closeSprint).toBe('w44');
  });

  it('stops before any write and names a scope plan that is not delivered', () => {
    const out = releaseFinish(readings({ scope: [plan('a'), plan('d', { phase: 'approved' })] }), input);
    expect(out).toMatchObject({ outcome: 'refused', reason: 'plan-unbookable' });
    if (out.outcome === 'refused') expect(out.detail).toContain('d');
  });

  it('names a scope plan whose file is missing', () => {
    const out = releaseFinish(readings({ scope: [plan('e', { file: '' })] }), input);
    expect(out).toMatchObject({ outcome: 'refused', reason: 'plan-unbookable' });
  });
});
