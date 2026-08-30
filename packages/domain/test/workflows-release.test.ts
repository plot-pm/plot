import { describe, it, expect } from 'vitest';
import {
  release,
  decided,
  refused,
  type ReleaseReadings,
  type Write,
} from '../src/workflows/index.js';

const ready = (over: Partial<ReleaseReadings> = {}): ReleaseReadings => ({
  sprintItems: [],
  sprintFiles: {},
  deliveredPlans: [
    {
      slug: 'a-plan',
      file: 'docs/plans/2026-08-30-a-plan.md',
      type: 'feature',
      tag: 'v2.5.0',
      releasedRecord: '',
    },
  ],
  version: '2.5.0',
  derivedBump: 'minor',
  tagExists: true,
  ...over,
});

const on = { on: '2026-08-30' };
const kinds = (writes: readonly Write[]) => writes.map((w) => w.kind);
const item = (over: Partial<ReleaseReadings['sprintItems'][number]> = {}) => ({
  sprint: 'a-sprint',
  tier: 'must' as const,
  plan: 'unfinished-plan',
  status: 'open' as const,
  ...over,
});

describe('release — the sprint gate', () => {
  it('refuses an open Must Have and names what clears it', () => {
    const out = release(ready({ sprintItems: [item()] }), on);
    expect(refused(out) && out.reason).toBe('must-haves-open');
    expect(refused(out) && out.detail).toContain('--ignore-sprint');
  });

  it('reports a disputed Must Have as what it is, not merely unfinished', () => {
    const out = release(ready({ sprintItems: [item({ status: 'disputed' })] }), on);
    expect(refused(out) && out.detail).toContain('checked in the sprint, but the plan is not delivered');
  });

  it('names which sprint each item came from — two teams may share one train', () => {
    const out = release(ready({ sprintItems: [item({ sprint: 'team-b' })] }), on);
    expect(refused(out) && out.detail).toContain('sprint team-b');
  });

  it('refuses a Must Have even unattended — that variable never converts a refusal', () => {
    const out = release(ready({ sprintItems: [item()] }), { ...on, unattended: true });
    expect(refused(out) && out.reason).toBe('must-haves-open');
  });

  it('passes an RC over an open Must Have — an RC is how the item gets finished', () => {
    const out = release(ready({ sprintItems: [item()] }), { ...on, candidate: true });
    expect(decided(out)).toBe(true);
  });

  it('passes with --ignore-sprint, the named escape', () => {
    const out = release(ready({ sprintItems: [item()] }), { ...on, ignoreSprint: true });
    expect(decided(out)).toBe(true);
  });

  it('does not apply at all where no sprint declares a release', () => {
    expect(decided(release(ready({ sprintItems: [] }), on))).toBe(true);
  });

  it('cuts nothing when the Should-Have prompt is declined', () => {
    const out = release(ready({ sprintItems: [item({ tier: 'should' })] }), {
      ...on,
      proceedOverShoulds: false,
    });
    expect(refused(out) && out.reason).toBe('should-haves-declined');
  });

  it('proceeds when the Should-Have prompt is accepted', () => {
    const out = release(ready({ sprintItems: [item({ tier: 'should' })] }), {
      ...on,
      proceedOverShoulds: true,
    });
    expect(decided(out) && out.detail.openShoulds).toEqual(['unfinished-plan']);
  });

  it('turns the Should-Have prompt into a warning when nobody is there', () => {
    const out = release(ready({ sprintItems: [item({ tier: 'should' })] }), {
      ...on,
      unattended: true,
    });
    expect(decided(out) && out.detail.unasked[0]).toContain('PLOT-UNASKED');
    expect(decided(out) && out.detail.unasked[0]).toContain('proceeded');
  });

  it('lets a Could Have neither block nor prompt', () => {
    const out = release(ready({ sprintItems: [item({ tier: 'could' })] }), on);
    expect(decided(out) && out.detail.openCoulds).toEqual(['unfinished-plan']);
  });

  it('ignores a done item at every tier', () => {
    const out = release(ready({ sprintItems: [item({ status: 'done' })] }), on);
    expect(decided(out)).toBe(true);
  });
});

describe('release — the version', () => {
  it('refuses when no version was given and none can be derived', () => {
    const out = release(ready({ version: '', derivedBump: '' }), on);
    expect(refused(out) && out.reason).toBe('version-underivable');
    expect(refused(out) && out.detail).toContain('nothing tagged');
  });

  it('refuses an underived version even where a bump is implied — a tag is permanent', () => {
    const out = release(ready({ version: '', derivedBump: 'minor' }), on);
    expect(refused(out) && out.reason).toBe('version-underivable');
    expect(refused(out) && out.detail).toContain('minor');
  });

  it('refuses a version that is not semver', () => {
    const out = release(ready({ version: 'next' }), on);
    expect(refused(out) && out.reason).toBe('version-invalid');
  });

  it.each(['2.5.0', 'v2.5.0'])('reads %s as the canonical v2.5.0', (version) => {
    const out = release(ready({ version }), on);
    expect(decided(out) && out.detail.version).toBe('v2.5.0');
  });

  it('accepts a release candidate version', () => {
    const out = release(ready({ version: 'v2.5.0-rc.1' }), { ...on, candidate: true });
    expect(decided(out) && out.detail.version).toBe('v2.5.0-rc.1');
  });

  it('refuses to mark plans before the tag exists', () => {
    const out = release(ready({ tagExists: false }), on);
    expect(refused(out) && out.reason).toBe('tag-absent');
  });
});

describe('release — a decision names every write', () => {
  it('marks a delivered plan with the phase and the record', () => {
    const out = release(ready(), on);
    expect(decided(out) && kinds(out.writes)).toEqual([
      'plan-phase',
      'plan-record',
      'commit',
      'push',
    ]);
  });

  it('MOVES NO SYMLINK — delivered/ means no longer active, not phase exactly Delivered', () => {
    const out = release(ready(), on);
    expect(decided(out) && kinds(out.writes)).not.toContain('index-move');
  });

  it('records the version the plan’s own work landed in, not the one being cut', () => {
    const out = release(
      ready({
        version: 'v2.6.0',
        deliveredPlans: [
          { slug: 'older', file: 'docs/plans/older.md', type: 'feature', tag: 'v2.4.0', releasedRecord: '' },
        ],
      }),
      on,
    );
    expect(decided(out) && out.writes).toContainEqual({
      kind: 'plan-record',
      file: 'docs/plans/older.md',
      field: 'Released',
      value: '2026-08-30, v2.4.0',
    });
  });

  it.each(['docs', 'infra'])('leaves a %s plan alone — it was live when it merged', (type) => {
    const out = release(
      ready({
        deliveredPlans: [
          { slug: 'a-doc', file: 'docs/plans/a-doc.md', type, tag: 'v2.5.0', releasedRecord: '' },
        ],
      }),
      on,
    );
    expect(decided(out) && out.detail.notMarked).toEqual([
      { slug: 'a-doc', reason: 'docs-live-on-merge' },
    ]);
    expect(decided(out) && out.writes).toEqual([]);
  });

  it('leaves a plan whose version cannot be resolved, rather than inventing one', () => {
    const out = release(
      ready({
        deliveredPlans: [
          { slug: 'orphan', file: 'docs/plans/orphan.md', type: 'feature', tag: '', releasedRecord: '' },
        ],
      }),
      on,
    );
    expect(decided(out) && out.detail.notMarked).toEqual([
      { slug: 'orphan', reason: 'unresolvable' },
    ]);
  });

  it('leaves a plan already carrying a Released record — the idempotent case', () => {
    const out = release(
      ready({
        deliveredPlans: [
          {
            slug: 'done',
            file: 'docs/plans/done.md',
            type: 'feature',
            tag: 'v2.5.0',
            releasedRecord: '2026-08-01, v2.5.0',
          },
        ],
      }),
      on,
    );
    expect(decided(out) && out.detail.notMarked).toEqual([
      { slug: 'done', reason: 'already-released' },
    ]);
  });

  it('reports the plans it marked', () => {
    const out = release(ready(), on);
    expect(decided(out) && out.detail.marked).toEqual(['a-plan']);
  });

  it('writes the override into the sprint note only once the tag exists', () => {
    const out = release(
      ready({
        sprintItems: [item()],
        sprintFiles: { 'a-sprint': 'docs/sprints/W35-a-sprint.md' },
      }),
      { ...on, ignoreSprint: true },
    );
    const note = decided(out) && out.writes.find((w) => w.kind === 'sprint-note');
    expect(note && note.kind === 'sprint-note' && note.note).toContain('--ignore-sprint');
    expect(note && note.kind === 'sprint-note' && note.note).toContain('[unfinished-plan]');
  });

  it('writes one note per sprint when two share the train', () => {
    const out = release(
      ready({
        sprintItems: [item(), item({ sprint: 'team-b', plan: 'other-plan' })],
        sprintFiles: { 'a-sprint': 'docs/sprints/a.md', 'team-b': 'docs/sprints/b.md' },
      }),
      { ...on, ignoreSprint: true },
    );
    expect(decided(out) && out.writes.filter((w) => w.kind === 'sprint-note')).toHaveLength(2);
  });

  it('writes no note for a sprint whose file it could not find', () => {
    const out = release(
      ready({ sprintItems: [item()], sprintFiles: {} }),
      { ...on, ignoreSprint: true },
    );
    expect(decided(out) && kinds(out.writes)).not.toContain('sprint-note');
  });

  it('writes no note for a sprint file recorded as empty', () => {
    const out = release(
      ready({ sprintItems: [item()], sprintFiles: { 'a-sprint': '' } }),
      { ...on, ignoreSprint: true },
    );
    expect(decided(out) && kinds(out.writes)).not.toContain('sprint-note');
  });

  it('writes no note where --ignore-sprint was not needed', () => {
    const out = release(ready({ sprintFiles: { 'a-sprint': 'docs/sprints/a.md' } }), {
      ...on,
      ignoreSprint: true,
    });
    expect(decided(out) && kinds(out.writes)).not.toContain('sprint-note');
  });

  it('decides with no writes where every delivered plan was skipped', () => {
    const out = release(ready({ deliveredPlans: [] }), on);
    expect(decided(out) && out.writes).toEqual([]);
  });

  it('stages every plan file it wrote to', () => {
    const out = release(ready(), on);
    const commit = decided(out) && out.writes.find((w) => w.kind === 'commit');
    expect(commit && commit.kind === 'commit' && commit.paths).toEqual([
      'docs/plans/2026-08-30-a-plan.md',
      'docs/plans/2026-08-30-a-plan.md',
    ]);
  });
});
