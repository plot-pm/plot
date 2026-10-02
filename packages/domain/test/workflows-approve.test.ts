import { describe, it, expect } from 'vitest';
import {
  approve,
  decided,
  refused,
  type ApproveInput,
  type ApproveReadings,
  type Write,
} from '../src/workflows/index.js';
import {
  approve as transitionApprove,
  isRefusal as isTransitionRefusal,
} from '../src/transitions/plan.js';

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

/**
 * The approver's side, which each test varies in one way.
 *
 * `people` declares the default `who`, so a test saying nothing about the
 * reviewer tests the gate it means to rather than the reviewer gate.
 */
const on = (over: Partial<ApproveInput> = {}): ApproveInput => ({
  on: '2026-08-30',
  who: 'jwloka',
  channel: 'in-session',
  people: ['jwloka', 'eins78'],
  ...over,
});
const kinds = (writes: readonly Write[]) => writes.map((w) => w.kind);

describe('approve — an unnamed slice', () => {
  const named = [{ name: 'A slice', branches: [{ branch: 'feature/one' }] }];
  const unnamed = [{ name: '', branches: [{ branch: 'feature/nameless' }] }];

  it('refuses a plan naming a branch under no heading, and names the branch', () => {
    const out = approve(ready({ slices: unnamed }), on());
    expect(refused(out) && out.reason).toBe('slice-unnamed');
    expect(refused(out) && out.detail).toContain("'feature/nameless'");
    expect(refused(out) && out.detail).toContain(
      "add '### <name> (Branch: feature/nameless)' above it under '## Slices'",
    );
  });

  it('WRITES NOTHING when it refuses — the plan is left exactly as it was found', () => {
    const out = approve(ready({ slices: unnamed }), on());
    expect(decided(out)).toBe(false);
    expect(out).not.toHaveProperty('writes');
  });

  it('refuses a DEFERRED branch under no heading, which can return to the queue', () => {
    const deferred = [{ name: '', branches: [{ branch: 'feature/given-up', deferred: true }] }];
    const out = approve(ready({ slices: deferred }), on());
    expect(refused(out) && out.reason).toBe('slice-unnamed');
    expect(refused(out) && out.detail).toContain("'feature/given-up'");
  });

  it('refuses before the review channel, so every channel reports the real defect', () => {
    const out = approve(ready({ slices: unnamed, review: 'in-session' }), on());
    expect(refused(out) && out.reason).toBe('slice-unnamed');
  });

  it('refuses an already-approved plan that holds one, rather than repairing it', () => {
    const out = approve(ready({ slices: unnamed, phase: 'approved' }), on());
    expect(refused(out) && out.reason).toBe('slice-unnamed');
  });

  it('approves a plan whose every branch sits under a heading', () => {
    const out = approve(ready({ slices: named }), on());
    expect(decided(out)).toBe(true);
  });

  it('approves when no slices were read at all — absent is not false', () => {
    const out = approve(ready(), on());
    expect(decided(out)).toBe(true);
  });

  it('approves a plan that names no branch at all', () => {
    const out = approve(ready({ slices: [], branches: [] }), on());
    expect(decided(out)).toBe(true);
  });
});

describe('approve — the refusals, each without a repository', () => {
  it('refuses a slug no plan file matched', () => {
    const out = approve(ready({ file: '' }), on());
    expect(refused(out) && out.reason).toBe('plan-not-found');
  });

  it('refuses a file the parser could not read, rather than guessing', () => {
    const out = approve(ready({ parsed: false }), on());
    expect(refused(out) && out.reason).toBe('plan-unparseable');
  });

  it.each(['delivered', 'released'])('refuses a plan already %s', (phase) => {
    const out = approve(ready({ phase }), on());
    expect(refused(out) && out.reason).toBe('state-terminal');
  });

  it.each(['NONE', ''])('refuses a phase it cannot read (%s)', (phase) => {
    const out = approve(ready({ phase }), on());
    expect(refused(out) && out.reason).toBe('state-unreadable');
  });

  it('refuses a phase it does not recognise', () => {
    const out = approve(ready({ phase: 'rejected' }), on());
    expect(refused(out) && out.reason).toBe('state-wrong');
  });

  it('refuses a ballot review — the tally is the approval, not a named reviewer', () => {
    const out = approve(ready({ review: 'ballot' }), on());
    expect(refused(out) && out.reason).toBe('review-human');
  });

  it('refuses an in-session review that names no reviewer', () => {
    const out = approve(ready({ review: 'in-session' }), on({ who: '' }));
    expect(refused(out) && out.reason).toBe('review-human');
    expect(refused(out) && out.detail).toContain('--who');
  });

  it('refuses an in-session review whose reviewer is whitespace', () => {
    const out = approve(ready({ review: 'in-session' }), on({ who: '   ' }));
    expect(refused(out) && out.reason).toBe('review-human');
  });

  it('refuses an in-session reviewer the People key never declared', () => {
    const out = approve(ready({ review: 'in-session' }), on({ who: 'someone-else' }));
    expect(refused(out) && out.reason).toBe('reviewer-undeclared');
    expect(refused(out) && out.detail).toContain('People');
  });

  // Catches a membership test written `people.length === 0 || includes(who)`.
  it('refuses a named in-session reviewer when the project declares nobody', () => {
    const out = approve(ready({ review: 'in-session' }), on({ who: 'jwloka', people: [] }));
    expect(refused(out) && out.reason).toBe('reviewer-undeclared');
  });

  it('refuses an unrecognised review channel rather than treating it as pr', () => {
    const out = approve(ready({ review: 'two-thumbs' }), on());
    expect(refused(out) && out.reason).toBe('review-unrecognised');
    // The detail is the argument: defaulting would approve a plan nobody
    // discussed, with a commit indistinguishable from a legitimate one.
    expect(refused(out) && out.detail).toContain("treating it as 'pr'");
  });

  it('refuses a closed plan PR', () => {
    const out = approve(ready({ pr: { number: 42, state: 'CLOSED', draft: false, branch: 'idea/a-plan' } }), on());
    expect(refused(out) && out.reason).toBe('pr-closed');
  });

  it('refuses when the host holds no PR for the branch', () => {
    const out = approve(ready({ pr: { number: 0, state: 'NONE', draft: false, branch: 'idea/a-plan' } }), on());
    expect(refused(out) && out.reason).toBe('pr-absent');
  });
});

describe('approve — a decision names every write', () => {
  it('names the merge, the phase, the record, a hold per branch, the commit and the push', () => {
    const out = approve(ready(), on());
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
    const out = approve(ready({ pr: { number: 42, state: 'OPEN', draft: true, branch: 'idea/a-plan' } }), on());
    expect(decided(out) && kinds(out.writes).slice(0, 2)).toEqual(['pr-ready', 'pr-merge']);
  });

  it('clears the hold for every branch the plan names, and no other', () => {
    const out = approve(ready({ branches: ['feature/one', 'feature/two'] }), on());
    const holds = decided(out) ? out.writes.filter((w) => w.kind === 'hold-clear') : [];
    expect(holds).toEqual([
      { kind: 'hold-clear', branch: 'feature/one' },
      { kind: 'hold-clear', branch: 'feature/two' },
    ]);
  });

  // `who` goes in verbatim. A PR review never tests it against `people` — only
  // the in-session arm does — so a display name is still recordable here.
  it('records the date, the approver and the PR the approval rode on', () => {
    const out = approve(ready(), on({ who: 'Jan Wloka' }));
    const record = decided(out) && out.writes.find((w) => w.kind === 'plan-record');
    expect(record).toEqual({
      kind: 'plan-record',
      file: 'docs/plans/2026-08-30-a-plan.md',
      field: 'Approved',
      value: '2026-08-30, Jan Wloka, plan-PR #42 merged',
    });
  });

  it('stages only the plan, the hold and the sprint file — never everything', () => {
    const out = approve(ready({ sprint: 'a-sprint', sprintFile: 'docs/sprints/W35-a-sprint.md' }), on());
    const commit = decided(out) && out.writes.find((w) => w.kind === 'commit');
    expect(commit && commit.kind === 'commit' && commit.paths).toEqual([
      'docs/plans/2026-08-30-a-plan.md',
      '.plot/hold',
      'docs/sprints/W35-a-sprint.md',
    ]);
  });

  it('stages no hold file for a plan naming no branches', () => {
    const out = approve(ready({ branches: [] }), on());
    const commit = decided(out) && out.writes.find((w) => w.kind === 'commit');
    expect(commit && commit.kind === 'commit' && commit.paths).toEqual([
      'docs/plans/2026-08-30-a-plan.md',
    ]);
  });

  it('annotates the sprint item where a sprint file names the plan', () => {
    const out = approve(ready({ sprint: 'a-sprint', sprintFile: 'docs/sprints/W35-a-sprint.md' }), on());
    expect(decided(out) && out.writes).toContainEqual({
      kind: 'sprint-annotation',
      file: 'docs/sprints/W35-a-sprint.md',
      plan: 'a-plan',
      tick: false,
      pr: 42,
      branch: 'feature/one',
    });
  });

  it('annotates nothing where the plan is in a sprint no file names', () => {
    const out = approve(ready({ sprint: 'a-sprint', sprintFile: '' }), on());
    expect(decided(out) && kinds(out.writes)).not.toContain('sprint-annotation');
  });

  it('records an empty branch on the annotation for a plan naming none', () => {
    const out = approve(ready({ branches: [], sprint: 's', sprintFile: 'docs/sprints/s.md' }), on());
    const ann = decided(out) && out.writes.find((w) => w.kind === 'sprint-annotation');
    expect(ann && ann.kind === 'sprint-annotation' && ann.branch).toBe('');
  });
});

describe('approve — same branch, and the idempotent case', () => {
  it('merges nothing under `same branch` — that PR carries the implementation', () => {
    const out = approve(ready({ impl: 'same-branch' }), on());
    expect(decided(out) && kinds(out.writes)).not.toContain('pr-merge');
    expect(decided(out) && out.detail.sameBranch).toBe(true);
  });

  it('records `reviewed` rather than `merged` under `same branch`', () => {
    const out = approve(ready({ impl: 'same-branch' }), on());
    const record = decided(out) && out.writes.find((w) => w.kind === 'plan-record');
    expect(record && record.kind === 'plan-record' && record.value).toContain('reviewed');
  });

  it('pushes in place under `same branch`, not through a booking branch', () => {
    const out = approve(ready({ impl: 'same-branch' }), on());
    const push = decided(out) && out.writes.find((w) => w.kind === 'push');
    expect(push).toEqual({ kind: 'push', branch: '', onto: '' });
  });

  it('does not re-merge a PR the host already merged', () => {
    const out = approve(ready({ pr: { number: 42, state: 'MERGED', draft: false, branch: 'idea/a-plan' } }), on());
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
      on(),
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
      on(),
    );
    // The half-state this script exists to repair: phase flipped, holds left set.
    expect(decided(out) && kinds(out.writes)).toEqual(['hold-clear', 'hold-clear', 'commit', 'push']);
  });

  it('approves a Design plan — approving is its forward exit', () => {
    const out = approve(ready({ phase: 'design' }), on());
    expect(decided(out)).toBe(true);
  });

  it.each(['NONE', ''])('reads review %s as pr — a pre-Plot-2 plan on an idea branch', (review) => {
    const out = approve(ready({ review }), on());
    expect(decided(out)).toBe(true);
  });

  // An in-session plan carries no plan PR, so a workflow that still ran the PR
  // switch would refuse `pr-absent` for the plan's intended shape.
  it('approves in-session with no PR reading', () => {
    const out = approve(
      ready({
        review: 'in-session',
        pr: { number: 0, state: 'NONE', draft: false, branch: 'bug/a-plan' },
      }),
      on({ who: 'jwloka', channel: 'in-session' }),
    );
    expect(decided(out)).toBe(true);
    const written = decided(out) ? kinds(out.writes) : [];
    expect(written).not.toContain('pr-ready');
    expect(written).not.toContain('pr-merge');
    const record = decided(out) && out.writes.find((w) => w.kind === 'plan-record');
    expect(record && record.kind === 'plan-record' && record.value).toBe(
      '2026-08-30, jwloka, in-session',
    );
  });

  // A draft PR on the branch is still not read: the channel decides, not the host.
  it('skips the PR writes for an in-session plan whose branch happens to carry a draft PR', () => {
    const out = approve(
      ready({
        review: 'in-session',
        pr: { number: 7, state: 'OPEN', draft: true, branch: 'bug/a-plan' },
      }),
      on({ who: 'jwloka', channel: 'in-session' }),
    );
    const written = decided(out) ? kinds(out.writes) : [];
    expect(written).not.toContain('pr-ready');
    expect(written).not.toContain('pr-merge');
  });

  it('does not refuse an in-session plan for a closed PR on its branch', () => {
    const out = approve(
      ready({
        review: 'in-session',
        pr: { number: 7, state: 'CLOSED', draft: false, branch: 'bug/a-plan' },
      }),
      on({ who: 'jwloka', channel: 'in-session' }),
    );
    expect(decided(out)).toBe(true);
  });
});

/**
 * The two `approve` rules answer the same question in two places.
 *
 * `transitions/plan.ts` decides a state write; `workflows/approve.ts` decides
 * every write a script performs. Neither calls the other and nothing in the
 * board calls the workflow one yet, so this comparison is the only thing
 * holding the pair together: a change made in one file passes that file's own
 * tests and fails here.
 *
 * Declared duplication, in the tradition `docs/shell-and-domain.md` sets for
 * the shell corpus — the pair may differ, and a test says when it does.
 */
describe('the two approve rules agree about a reviewer', () => {
  const people = ['jwloka', 'eins78'];

  const bothAnswer = (review: string, who: string) => {
    const transition = transitionApprove(
      {
        slug: 'a-plan',
        phase: 'draft',
        review,
        approvedRecord: '',
        deliveredRecord: '',
        releasedRecord: '',
      },
      { on: '2026-08-30', who, channel: 'in-session', people },
    );
    const workflow = approve(
      ready({
        review,
        pr: { number: 0, state: 'NONE', draft: false, branch: 'bug/a-plan' },
      }),
      { on: '2026-08-30', who, channel: 'in-session', people },
    );
    return {
      transition: isTransitionRefusal(transition) ? transition.reason : 'approved',
      workflow: refused(workflow) ? workflow.reason : 'approved',
    };
  };

  it.each([
    ['in-session', 'jwloka', 'approved'],
    ['in-session', 'nobody', 'reviewer-undeclared'],
    ['in-session', '', 'review-human'],
    ['in-session', '   ', 'review-human'],
    ['ballot', 'jwloka', 'review-human'],
  ])('%s with who=%o answers %s in both files', (review, who, expected) => {
    const { transition, workflow } = bothAnswer(review, who);
    expect(transition).toBe(expected);
    expect(workflow).toBe(expected);
  });
});
