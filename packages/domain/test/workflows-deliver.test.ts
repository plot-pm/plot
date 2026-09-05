import { describe, it, expect } from 'vitest';
import { deliver, decided, refused, type DeliverReadings, type Write } from '../src/workflows/index.js';

const ready = (over: Partial<DeliverReadings> = {}): DeliverReadings => ({
  slug: 'a-plan',
  file: 'docs/plans/2026-08-30-a-plan.md',
  parsed: true,
  phase: 'approved',
  branches: [
    { branch: 'feature/one', deferred: false, merged: true },
    { branch: 'feature/two', deferred: false, merged: true },
  ],
  deliveredRecord: '',
  activeLink: 'docs/plans/active/a-plan.md',
  deliveredLink: 'docs/plans/delivered/a-plan.md',
  sprint: '',
  sprintFile: '',
  ...over,
});

const on = { on: '2026-08-30' };
const kinds = (writes: readonly Write[]) => writes.map((w) => w.kind);

describe('deliver — the refusals, each without a repository', () => {
  it('refuses a slug no plan file matched', () => {
    expect(refused(deliver(ready({ file: '' }), on))).toBe(true);
  });

  it('refuses a file the parser could not read', () => {
    const out = deliver(ready({ parsed: false }), on);
    expect(refused(out) && out.reason).toBe('plan-unparseable');
  });

  it('refuses a plan already released', () => {
    const out = deliver(ready({ phase: 'released' }), on);
    expect(refused(out) && out.reason).toBe('state-terminal');
  });

  it.each(['draft', 'design'])('refuses a plan still %s — approve it first', (phase) => {
    const out = deliver(ready({ phase }), on);
    expect(refused(out) && out.reason).toBe('state-too-early');
  });

  it.each(['NONE', ''])('refuses a phase it cannot read (%s)', (phase) => {
    const out = deliver(ready({ phase }), on);
    expect(refused(out) && out.reason).toBe('state-unreadable');
  });

  it('refuses a phase it does not recognise', () => {
    const out = deliver(ready({ phase: 'superseded' }), on);
    expect(refused(out) && out.reason).toBe('state-wrong');
  });

  it('refuses while any non-deferred branch is unmerged — one of the four guardrails', () => {
    const out = deliver(
      ready({
        branches: [
          { branch: 'feature/one', deferred: false, merged: true },
          { branch: 'feature/two', deferred: false, merged: false },
        ],
      }),
      on,
    );
    expect(refused(out) && out.reason).toBe('branches-unmerged');
    expect(refused(out) && out.detail).toContain('feature/two');
  });

  it('names every unmerged branch, not just the first', () => {
    const out = deliver(
      ready({
        branches: [
          { branch: 'feature/one', deferred: false, merged: false },
          { branch: 'feature/two', deferred: false, merged: false },
        ],
      }),
      on,
    );
    expect(refused(out) && out.detail).toContain('feature/one, feature/two');
  });

  it('exempts a deferred branch — a shelved branch is not outstanding work', () => {
    const out = deliver(
      ready({
        branches: [
          { branch: 'feature/one', deferred: false, merged: true },
          { branch: 'feature/two', deferred: true, merged: false },
        ],
      }),
      on,
    );
    expect(decided(out) && out.detail.deferred).toBe(1);
  });
});

describe('deliver — a decision names every write', () => {
  it('names the phase, the record, the index move, the commit and the push', () => {
    const out = deliver(ready(), on);
    expect(decided(out) && kinds(out.writes)).toEqual([
      'plan-phase',
      'plan-record',
      'index-move',
      'commit',
      'push',
    ]);
  });

  it('MOVES the index link — a phase flip alone reports drift and fails the gate', () => {
    const out = deliver(ready(), on);
    expect(decided(out) && out.writes).toContainEqual({
      kind: 'index-move',
      from: 'docs/plans/active/a-plan.md',
      to: 'docs/plans/delivered/a-plan.md',
    });
  });

  it('moves nothing for a plan with no index link', () => {
    const out = deliver(ready({ activeLink: '', deliveredLink: '' }), on);
    expect(decided(out) && kinds(out.writes)).not.toContain('index-move');
  });

  it('stages both index directories so the moved link lands', () => {
    const out = deliver(ready(), on);
    const commit = decided(out) && out.writes.find((w) => w.kind === 'commit');
    expect(commit && commit.kind === 'commit' && commit.paths).toEqual([
      'docs/plans/2026-08-30-a-plan.md',
      'docs/plans/active/a-plan.md',
      'docs/plans/delivered/a-plan.md',
    ]);
  });

  it('records the delivery date', () => {
    const out = deliver(ready(), on);
    expect(decided(out) && out.writes).toContainEqual({
      kind: 'plan-record',
      file: 'docs/plans/2026-08-30-a-plan.md',
      field: 'Delivered',
      value: '2026-08-30',
    });
  });

  it('annotates the sprint item where a file names the plan', () => {
    const out = deliver(ready({ sprint: 's', sprintFile: 'docs/sprints/W35-s.md' }), on);
    expect(decided(out) && out.writes).toContainEqual({
      kind: 'sprint-annotation',
      file: 'docs/sprints/W35-s.md',
      plan: 'a-plan',
      status: 'delivered',
      pr: null,
      branch: '',
    });
  });

  it('annotates nothing where no sprint file names the plan', () => {
    const out = deliver(ready({ sprint: 's', sprintFile: '' }), on);
    expect(decided(out) && kinds(out.writes)).not.toContain('sprint-annotation');
  });

  it('proceeds on a plan naming no branches — there is nothing to verify', () => {
    const out = deliver(ready({ branches: [] }), on);
    expect(decided(out) && out.detail.merged).toBe(0);
  });

  it('leaves an already-delivered plan with nothing to write', () => {
    const out = deliver(
      ready({
        phase: 'delivered',
        deliveredRecord: '2026-08-29',
        activeLink: '',
        deliveredLink: '',
      }),
      on,
    );
    expect(decided(out) && out.writes).toEqual([]);
    expect(decided(out) && out.detail.alreadyRecorded).toBe(true);
  });

  it('still moves the link when the phase was already flipped — the half-state it repairs', () => {
    const out = deliver(ready({ phase: 'delivered', deliveredRecord: '2026-08-29' }), on);
    expect(decided(out) && kinds(out.writes)).toEqual(['index-move', 'commit', 'push']);
  });
});
