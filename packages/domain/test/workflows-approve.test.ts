import { describe, it, expect } from 'vitest';
import {
  approve,
  decided,
  refused,
  type ApproveReadings,
  type Write,
} from '../src/workflows/index.js';

/**
 * A plan that approves cleanly, which each test spoils in exactly one way.
 *
 * Built as a whole rather than assembled per test: a refusal proven against a
 * bespoke reading proves the refusal fires for that reading, not that it fires
 * for a plan which would otherwise have been approved.
 */
const ready = (over: Partial<ApproveReadings> = {}): ApproveReadings => ({
  slug: 'a-plan',
  file: 'docs/plans/2026-08-30-a-plan.md',
  parsed: true,
  phase: 'draft',
  review: 'pr',
  impl: 'own-branches',
  branches: ['feature/one', 'feature/two'],
  sprint: '',
  sprintFile: '',
  approvedRecord: '',
  pr: { number: 42, state: 'OPEN', draft: false, branch: 'idea/a-plan' },
  ...over,
});

const on = { on: '2026-08-30', who: 'Jan Wloka' };
const kinds = (writes: readonly Write[]) => writes.map((w) => w.kind);

describe('approve — the refusals, each without a repository', () => {
  it('refuses a slug no plan file matched', () => {
    const out = approve(ready({ file: '' }), on);
    expect(refused(out) && out.reason).toBe('plan-not-found');
  });

  it('refuses a file the parser could not read, rather than guessing', () => {
    const out = approve(ready({ parsed: false }), on);
    expect(refused(out) && out.reason).toBe('plan-unparseable');
  });

  it.each(['delivered', 'released'])('refuses a plan already %s', (phase) => {
    const out = approve(ready({ phase }), on);
    expect(refused(out) && out.reason).toBe('state-terminal');
  });

  it.each(['NONE', ''])('refuses a phase it cannot read (%s)', (phase) => {
    const out = approve(ready({ phase }), on);
    expect(refused(out) && out.reason).toBe('state-unreadable');
  });

  it('refuses a phase it does not recognise', () => {
    const out = approve(ready({ phase: 'rejected' }), on);
    expect(refused(out) && out.reason).toBe('state-wrong');
  });

  it.each(['in-session', 'ballot'])('refuses %s review — the approval needs a human', (review) => {
    const out = approve(ready({ review }), on);
    expect(refused(out) && out.reason).toBe('review-human');
  });

  it('refuses an unrecognised review channel rather than treating it as pr', () => {
    const out = approve(ready({ review: 'two-thumbs' }), on);
    expect(refused(out) && out.reason).toBe('review-unrecognised');
    // The detail is the argument: defaulting would approve a plan nobody
    // discussed, with a commit indistinguishable from a legitimate one.
    expect(refused(out) && out.detail).toContain("treating it as 'pr'");
  });

  it('refuses a closed plan PR', () => {
    const out = approve(ready({ pr: { number: 42, state: 'CLOSED', draft: false, branch: 'idea/a-plan' } }), on);
    expect(refused(out) && out.reason).toBe('pr-closed');
  });

  it('refuses when the host holds no PR for the branch', () => {
    const out = approve(ready({ pr: { number: 0, state: 'NONE', draft: false, branch: 'idea/a-plan' } }), on);
    expect(refused(out) && out.reason).toBe('pr-absent');
  });
});

describe('approve — a decision names every write', () => {
  it('names the merge, the phase, the record, a hold per branch, the commit and the push', () => {
    const out = approve(ready(), on);
    expect(decided(out) && kinds(out.writes)).toEqual([
      'pr-merge',
      'plan-phase',
      'plan-record',
      'hold-clear',
      'hold-clear',
      'commit',
      'push',
    ]);
  });

  it('takes a draft PR out of draft BEFORE merging — the reverse cannot exist', () => {
    const out = approve(ready({ pr: { number: 42, state: 'OPEN', draft: true, branch: 'idea/a-plan' } }), on);
    expect(decided(out) && kinds(out.writes).slice(0, 2)).toEqual(['pr-ready', 'pr-merge']);
  });

  it('clears the hold for every branch the plan names, and no other', () => {
    const out = approve(ready({ branches: ['feature/one', 'feature/two'] }), on);
    const holds = decided(out) ? out.writes.filter((w) => w.kind === 'hold-clear') : [];
    expect(holds).toEqual([
      { kind: 'hold-clear', branch: 'feature/one' },
      { kind: 'hold-clear', branch: 'feature/two' },
    ]);
  });

  it('records the date, the approver and the PR the approval rode on', () => {
    const out = approve(ready(), on);
    const record = decided(out) && out.writes.find((w) => w.kind === 'plan-record');
    expect(record).toEqual({
      kind: 'plan-record',
      file: 'docs/plans/2026-08-30-a-plan.md',
      field: 'Approved',
      value: '2026-08-30, Jan Wloka, plan-PR #42 merged',
    });
  });

  it('stages only the plan, the hold and the sprint file — never everything', () => {
    const out = approve(ready({ sprint: 'a-sprint', sprintFile: 'docs/sprints/W35-a-sprint.md' }), on);
    const commit = decided(out) && out.writes.find((w) => w.kind === 'commit');
    expect(commit && commit.kind === 'commit' && commit.paths).toEqual([
      'docs/plans/2026-08-30-a-plan.md',
      '.plot/hold',
      'docs/sprints/W35-a-sprint.md',
    ]);
  });

  it('stages no hold file for a plan naming no branches', () => {
    const out = approve(ready({ branches: [] }), on);
    const commit = decided(out) && out.writes.find((w) => w.kind === 'commit');
    expect(commit && commit.kind === 'commit' && commit.paths).toEqual([
      'docs/plans/2026-08-30-a-plan.md',
    ]);
  });

  it('annotates the sprint item where a sprint file names the plan', () => {
    const out = approve(ready({ sprint: 'a-sprint', sprintFile: 'docs/sprints/W35-a-sprint.md' }), on);
    expect(decided(out) && out.writes).toContainEqual({
      kind: 'sprint-annotation',
      file: 'docs/sprints/W35-a-sprint.md',
      plan: 'a-plan',
      status: 'approved',
      pr: 42,
      branch: 'feature/one',
    });
  });

  it('annotates nothing where the plan is in a sprint no file names', () => {
    const out = approve(ready({ sprint: 'a-sprint', sprintFile: '' }), on);
    expect(decided(out) && kinds(out.writes)).not.toContain('sprint-annotation');
  });

  it('records an empty branch on the annotation for a plan naming none', () => {
    const out = approve(ready({ branches: [], sprint: 's', sprintFile: 'docs/sprints/s.md' }), on);
    const ann = decided(out) && out.writes.find((w) => w.kind === 'sprint-annotation');
    expect(ann && ann.kind === 'sprint-annotation' && ann.branch).toBe('');
  });
});

describe('approve — same branch, and the idempotent case', () => {
  it('merges nothing under `same branch` — that PR carries the implementation', () => {
    const out = approve(ready({ impl: 'same-branch' }), on);
    expect(decided(out) && kinds(out.writes)).not.toContain('pr-merge');
    expect(decided(out) && out.detail.sameBranch).toBe(true);
  });

  it('records `reviewed` rather than `merged` under `same branch`', () => {
    const out = approve(ready({ impl: 'same-branch' }), on);
    const record = decided(out) && out.writes.find((w) => w.kind === 'plan-record');
    expect(record && record.kind === 'plan-record' && record.value).toContain('reviewed');
  });

  it('pushes in place under `same branch`, not through a booking branch', () => {
    const out = approve(ready({ impl: 'same-branch' }), on);
    const push = decided(out) && out.writes.find((w) => w.kind === 'push');
    expect(push).toEqual({ kind: 'push', branch: '', onto: '' });
  });

  it('does not re-merge a PR the host already merged', () => {
    const out = approve(ready({ pr: { number: 42, state: 'MERGED', draft: false, branch: 'idea/a-plan' } }), on);
    expect(decided(out) && kinds(out.writes)).not.toContain('pr-merge');
  });

  it('leaves an already-approved plan with nothing to write, and says so', () => {
    const out = approve(
      ready({
        phase: 'approved',
        branches: [],
        approvedRecord: '2026-08-29, Jan Wloka, plan-PR #42 merged',
        pr: { number: 42, state: 'MERGED', draft: false, branch: 'idea/a-plan' },
      }),
      on,
    );
    expect(decided(out) && out.writes).toEqual([]);
    expect(decided(out) && out.detail.alreadyRecorded).toBe(true);
  });

  it('still repairs the holds when the phase was already flipped', () => {
    const out = approve(
      ready({
        phase: 'approved',
        approvedRecord: '2026-08-29, Jan Wloka, plan-PR #42 merged',
        pr: { number: 42, state: 'MERGED', draft: false, branch: 'idea/a-plan' },
      }),
      on,
    );
    // The half-state this script exists to repair: phase flipped, holds left set.
    expect(decided(out) && kinds(out.writes)).toEqual(['hold-clear', 'hold-clear', 'commit', 'push']);
  });

  it('approves a Design plan — approving is its forward exit', () => {
    const out = approve(ready({ phase: 'design' }), on);
    expect(decided(out)).toBe(true);
  });

  it.each(['NONE', ''])('reads review %s as pr — a pre-Plot-2 plan on an idea branch', (review) => {
    const out = approve(ready({ review }), on);
    expect(decided(out)).toBe(true);
  });
});
