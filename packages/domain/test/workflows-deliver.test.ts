import { describe, it, expect } from 'vitest';
import { deliver, decided, refused, type DeliverReadings, type Write } from '../src/workflows/index.js';

const ready = (over: Partial<DeliverReadings> = {}): DeliverReadings => ({
  slug: 'a-plan',
  file: 'docs/plans/2026-08-30-a-plan.md',
  parsed: true,
  phase: 'approved',
  branches: [
    { branch: 'feature/one', deferred: false, merged: true, carriedWork: true },
    { branch: 'feature/two', deferred: false, merged: true, carriedWork: true },
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
          { branch: 'feature/one', deferred: false, merged: true, carriedWork: true },
          { branch: 'feature/two', deferred: false, merged: false, carriedWork: true },
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
          { branch: 'feature/one', deferred: false, merged: false, carriedWork: true },
          { branch: 'feature/two', deferred: false, merged: false, carriedWork: true },
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
          { branch: 'feature/one', deferred: false, merged: true, carriedWork: true },
          { branch: 'feature/two', deferred: true, merged: false, carriedWork: true },
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
      tick: true,
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

/**
 * A SLICE WHOSE MERGED PR CARRIED NO IMPLEMENTATION.
 *
 * Measured 2026-09-08: `the-probe-reads-the-ci-system` merged as PR #811
 * carrying ZERO files, and `the-ci-connector-is-jenkins` merged as #821
 * carrying a `PLOT-BLOCKED.md` alone. Both plans read Delivered, because
 * delivery asked whether each branch's PR merged and never whether it carried
 * the work. 2.15.0 shipped announcing a Jenkins connector that does not exist.
 *
 * THE ASSERTION IS THAT IT REPORTS AND DOES NOT REFUSE. Of the seven empty
 * merged PRs in that window, only two were this defect — three were claim PRs
 * whose slice finished under a different PR — so a gate that refused would have
 * blocked a delivery whose work was complete. `deliverable` must stay true
 * beside a non-empty finding, and these tests assert exactly that pair.
 */
describe('deliver — a merged PR that carried no work', () => {
  it('names the slice and still delivers — a finding, never a refusal', () => {
    const out = deliver(
      ready({
        branches: [
          { branch: 'feature/the-probe-reads-the-ci-system', deferred: false, merged: true, carriedWork: false },
          { branch: 'feature/the-build-port-exists', deferred: false, merged: true, carriedWork: true },
        ],
      }),
      on,
    );
    expect(decided(out)).toBe(true);
    expect(decided(out) && out.detail.emptySlices).toEqual([
      'feature/the-probe-reads-the-ci-system',
    ]);
    // The delivery's own writes are untouched by the finding.
    expect(decided(out) && kinds(out.writes)).toContain('plan-phase');
  });

  it('says nothing about a slice that carried work', () => {
    const out = deliver(ready(), on);
    expect(decided(out) && out.detail.emptySlices).toEqual([]);
  });

  it('says nothing about a deferred slice — the plan already gave it up', () => {
    const out = deliver(
      ready({
        branches: [
          { branch: 'feature/withdrawn', deferred: true, merged: true, carriedWork: false },
        ],
      }),
      on,
    );
    expect(decided(out) && out.detail.emptySlices).toEqual([]);
  });

  it('says nothing where the diff could not be read — `unknown` never reports', () => {
    const out = deliver(
      ready({
        branches: [
          { branch: 'feature/unreadable', deferred: false, merged: true, carriedWork: 'unknown' },
        ],
      }),
      on,
    );
    expect(decided(out) && out.detail.emptySlices).toEqual([]);
  });

  it('reports both #811 and #821 shapes, and not the third fixture beside them', () => {
    // The three merge commits the plan names, by what each carried:
    //   5d7644ec  #811  zero files              → the defect
    //   dab631d4  #821  PLOT-BLOCKED.md alone   → the defect
    //   682349a6  #809  one real file           → work
    const out = deliver(
      ready({
        branches: [
          { branch: 'feature/the-probe-reads-the-ci-system', deferred: false, merged: true, carriedWork: false },
          { branch: 'feature/the-ci-connector-is-jenkins', deferred: false, merged: true, carriedWork: false },
          { branch: 'bug/a-pipeline-address-is-not-the-host', deferred: false, merged: true, carriedWork: true },
        ],
      }),
      on,
    );
    expect(decided(out)).toBe(true);
    expect(decided(out) && out.detail.emptySlices).toEqual([
      'feature/the-probe-reads-the-ci-system',
      'feature/the-ci-connector-is-jenkins',
    ]);
  });
});
