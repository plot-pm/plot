import { describe, it, expect } from 'vitest';
import {
  supervise,
  boundRefusal,
  missingDeclarationFailure,
  MAX_ATTEMPTS,
  type SupervisionReadings,
} from '../src/rules/supervision.js';
import type { DeskReadings } from '../src/rules/gates.js';

/**
 * The marker is assembled rather than written literally, the same reason
 * `gates.test.ts` gives: a literal opens a comment for any tool reading this
 * file the way `plot-plan-meta.sh` does.
 */
const OPEN = '<!' + '--';
const CLOSE = '--' + '>';

const WORKSPACE = ['plot', '@plot-pm/board', '@plot-pm/domain'];

const GOOD_CHANGESET = [
  '---',
  "'plot': patch",
  '---',
  '',
  'The registry supervises its agents on a tick it re-reads each time.',
  '',
  OPEN,
  'bumps:',
  '  skills:',
  '    plot: patch',
  CLOSE,
  '',
].join('\n');

/** A desk that passes every gate. Each test names the one reading it changes. */
const cleanDesk = (over: Partial<DeskReadings> = {}): DeskReadings => ({
  branch: 'feature/one',
  merge: 'merged',
  changesets: [{ path: '.changeset/tidy-moons.md', text: GOOD_CHANGESET }],
  workspacePackages: WORKSPACE,
  dirtyPath: '',
  blockedMarker: '',
  planLine: { prs: [692], deferred: false, deferredReason: '' },
  ...over,
});

/**
 * An agent that finished everything — the base case, on purpose.
 *
 * Every test below changes the one reading it is about, so what drives the
 * verdict is visible in the test rather than buried here.
 */
const finished = (over: Partial<SupervisionReadings> = {}): SupervisionReadings => ({
  branch: 'feature/one',
  worktree: '/estate/.worktrees/feature-one',
  workerAlive: false,
  declaration: {
    read: 'declared',
    declaration: {
      branch: 'feature/one',
      status: 'ok',
      artifacts: ['packages/domain/src/rules/supervision.ts'],
      pr: 692,
      summary: 'the tick',
    },
  },
  desk: cleanDesk(),
  resume: { resumeId: 'a1b2c3', transcriptFound: true },
  attempts: 0,
  madeProgress: true,
  headroom: 'clear',
  ...over,
});

describe('the tick — branch one: a worker is alive', () => {
  it('leaves it alone and reads nothing else', () => {
    // EVERY OTHER READING IS THE WORST CASE. A live worker is answered before
    // any of them, so a verdict of `leave` here proves the ordering rather
    // than the readings.
    const result = supervise(
      finished({
        workerAlive: true,
        declaration: { read: 'absent' },
        desk: cleanDesk({ merge: 'not-merged', dirtyPath: 'src/half.ts' }),
        attempts: MAX_ATTEMPTS,
        madeProgress: false,
        headroom: 'starved',
      }),
    );
    expect(result.verdict).toBe('leave');
    expect(result.cause).toBe('worker-alive');
    expect(result.failures).toEqual([]);
    expect(result.correction).toBe('');
  });

  it('does not spend an attempt', () => {
    const result = supervise(finished({ workerAlive: true, attempts: 1 }));
    expect(result.nextAttempts).toBe(1);
  });
});

describe('the tick — branch two: the envelope is ok and the gates pass', () => {
  it('reaps the desk', () => {
    const result = supervise(finished());
    expect(result.verdict).toBe('reap');
    expect(result.cause).toBe('gates-passed');
    expect(result.failures).toEqual([]);
    expect(result.branch).toBe('feature/one');
    expect(result.worktree).toBe('/estate/.worktrees/feature-one');
  });

  it('spends no attempt reaping', () => {
    expect(supervise(finished({ attempts: 1 })).nextAttempts).toBe(1);
  });

  it('still carries whether resume was available', () => {
    const result = supervise(finished({ resume: { resumeId: '', transcriptFound: false } }));
    expect(result.resume.available).toBe(false);
  });
});

describe('the tick — branch three: the envelope is ok and a gate fails', () => {
  it('corrects, naming what the gate found', () => {
    const result = supervise(finished({ desk: cleanDesk({ merge: 'not-merged' }) }));
    expect(result.verdict).toBe('correct');
    expect(result.cause).toBe('gates-failed');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('No merged PR');
  });

  it('writes the correction as a prompt an agent can act on', () => {
    const result = supervise(finished({ desk: cleanDesk({ dirtyPath: 'src/half.ts' }) }));
    // READ RATHER THAN MATCHED. The plan asks for a gate failure legible as a
    // prompt; what makes it legible is that it names the branch, the problem
    // and the move, in sentences.
    expect(result.correction).toContain('Your work on `feature/one` did not complete');
    expect(result.correction).toContain('src/half.ts');
    expect(result.correction).toContain('Fix every item, then commit and push.');
  });

  it('raises the supervisor’s own counter by one', () => {
    expect(supervise(finished({ desk: cleanDesk({ merge: 'not-merged' }) })).nextAttempts).toBe(1);
  });
});

describe('the tick — branch four: the envelope is absent', () => {
  it('corrects, and says the declaration is what is missing', () => {
    const result = supervise(finished({ declaration: { read: 'absent' } }));
    expect(result.verdict).toBe('correct');
    expect(result.cause).toBe('declaration-absent');
    // THE DESK PASSED EVERY GATE. Without the declaration failure the agent
    // would be told its work did not complete and not told what to do.
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('No declaration was written');
    expect(result.correction).toContain('.plot-worker.envelope.json');
  });

  it('tells an unreadable declaration apart from an absent one', () => {
    const result = supervise(
      finished({ declaration: { read: 'unreadable', why: 'not JSON' } }),
    );
    expect(result.cause).toBe('declaration-unreadable');
    expect(result.failures[0]).toContain('does not parse: not JSON');
  });

  it('reports every gate failure alongside the missing declaration', () => {
    const result = supervise(
      finished({
        declaration: { read: 'absent' },
        desk: cleanDesk({ merge: 'not-merged', dirtyPath: 'src/half.ts' }),
      }),
    );
    expect(result.failures).toHaveLength(3);
    expect(result.correction).toContain('uncommitted work');
    expect(result.correction).toContain('No merged PR');
    expect(result.correction).toContain('No declaration was written');
  });
});

describe('the tick — branch four: the envelope says blocked', () => {
  it('goes straight to a person, without running a retry', () => {
    const result = supervise(
      finished({
        declaration: {
          read: 'declared',
          declaration: {
            branch: 'feature/one',
            status: 'blocked',
            artifacts: [],
            pr: null,
            summary: 'which retry semantics?',
          },
        },
      }),
    );
    expect(result.verdict).toBe('needs-a-person');
    expect(result.cause).toBe('agent-blocked');
    expect(result.correction).toBe('');
  });

  it('does so with the budget untouched, so a person still has one', () => {
    const result = supervise(
      finished({
        attempts: 0,
        declaration: {
          read: 'declared',
          declaration: {
            branch: 'feature/one',
            status: 'blocked',
            artifacts: [],
            pr: null,
            summary: '',
          },
        },
      }),
    );
    expect(result.nextAttempts).toBe(0);
  });
});

describe('the three bounds refuse in three ways', () => {
  it('a spent budget marks needs-a-person and stops', () => {
    const result = supervise(
      finished({ declaration: { read: 'absent' }, attempts: MAX_ATTEMPTS }),
    );
    expect(result.verdict).toBe('needs-a-person');
    expect(result.cause).toBe('budget-spent');
    // NO LOOP. The correction is empty because there is no next attempt to
    // hand it to, which is what makes the stop visible rather than silent.
    expect(result.correction).toBe('');
    expect(result.nextAttempts).toBe(MAX_ATTEMPTS);
  });

  it('no progress defers rather than stopping', () => {
    const result = supervise(
      finished({ declaration: { read: 'absent' }, madeProgress: false }),
    );
    expect(result.verdict).toBe('defer');
    expect(result.cause).toBe('no-progress');
  });

  it('no machine headroom defers rather than dropping', () => {
    const result = supervise(finished({ declaration: { read: 'absent' }, headroom: 'starved' }));
    expect(result.verdict).toBe('defer');
    expect(result.cause).toBe('no-headroom');
  });

  it('an unmeasured machine is not a clear one', () => {
    const result = supervise(finished({ declaration: { read: 'absent' }, headroom: 'unmeasured' }));
    expect(result.verdict).toBe('defer');
    expect(result.cause).toBe('no-headroom');
  });

  it('a tight machine is not a clear one either', () => {
    expect(boundRefusal({ attempts: 0, madeProgress: true, headroom: 'tight' })).toBe(
      'no-headroom',
    );
  });

  it('every bound holding allows the retry', () => {
    expect(boundRefusal({ attempts: 0, madeProgress: true, headroom: 'clear' })).toBeNull();
    expect(boundRefusal({ attempts: MAX_ATTEMPTS - 1, madeProgress: true, headroom: 'clear' })).toBeNull();
  });

  it('the budget is checked before progress, so a spent one is terminal either way', () => {
    // ORDER MATTERS HERE. An agent with no progress AND no budget must reach a
    // person rather than being deferred forever by the cheaper refusal.
    expect(
      boundRefusal({ attempts: MAX_ATTEMPTS, madeProgress: false, headroom: 'starved' }),
    ).toBe('budget-spent');
  });
});

describe('the two counters are read separately', () => {
  /**
   * THE DEFECT THE PLAN NAMES. `relaunches` is a person's record of their own
   * `--restart`s; `attempts` is the supervisor's. Conflating them lets three
   * manual restarts exhaust the automatic budget.
   *
   * The rule reads `attempts` and takes no `relaunches` field AT ALL, which is
   * the strongest form of the assertion available: there is no value a caller
   * could pass that would make a manual restart count.
   */
  it('a manual restart does not consume the automatic budget', () => {
    const readings = finished({ declaration: { read: 'absent' }, attempts: 0 });
    const withManualRestarts = { ...readings, relaunches: 9 } as SupervisionReadings;

    const result = supervise(withManualRestarts);
    expect(result.verdict).toBe('correct');
    expect(result.nextAttempts).toBe(1);
  });

  it('the supervisor’s own tries do consume it', () => {
    const first = supervise(finished({ declaration: { read: 'absent' }, attempts: 0 }));
    expect(first.verdict).toBe('correct');
    const second = supervise(finished({ declaration: { read: 'absent' }, attempts: 1 }));
    expect(second.verdict).toBe('correct');
    const third = supervise(finished({ declaration: { read: 'absent' }, attempts: 2 }));
    expect(third.verdict).toBe('needs-a-person');
  });
});

describe('resume availability travels with the verdict', () => {
  it('reports the handle when a transcript exists', () => {
    const result = supervise(finished({ declaration: { read: 'absent' } }));
    expect(result.resume).toEqual({ available: true, resumeId: 'a1b2c3' });
  });

  it('reports no-id when the manifest never recorded a handle', () => {
    const result = supervise(
      finished({ declaration: { read: 'absent' }, resume: { resumeId: '', transcriptFound: false } }),
    );
    expect(result.resume.available).toBe(false);
    if (!result.resume.available) expect(result.resume.why).toBe('no-id');
  });

  it('reports no-transcript when the adopter did not pass the id on', () => {
    const result = supervise(
      finished({
        declaration: { read: 'absent' },
        resume: { resumeId: 'a1b2c3', transcriptFound: false },
      }),
    );
    expect(result.resume.available).toBe(false);
    if (!result.resume.available) expect(result.resume.why).toBe('no-transcript');
    // THE CORRECTION IS UNCHANGED. The same text serves both paths — a fresh
    // worker reads it in its brief.
    expect(result.correction).toContain('Your work on `feature/one` did not complete');
  });
});

describe('the missing-declaration failure', () => {
  it('tells an agent that wrote nothing what to write', () => {
    const text = missingDeclarationFailure('feature/one', { read: 'absent' });
    expect(text).toContain('absence means the work did not complete');
    expect(text).toContain('"status": "ok"');
  });

  it('tells an agent that wrote bad bytes to rewrite them', () => {
    const text = missingDeclarationFailure('feature/one', {
      read: 'unreadable',
      why: 'branch: Too small',
    });
    expect(text).toContain('does not parse: branch: Too small');
    expect(text).toContain('Rewrite');
  });

  it('tells a blocked agent to resolve what stopped it', () => {
    // TOTAL RATHER THAN REACHABLE FROM THE TICK: `supervise` answers a blocked
    // declaration before this is called. The function still covers the case,
    // so a caller that reaches it gets words rather than a wrong sentence.
    const text = missingDeclarationFailure('feature/one', {
      read: 'declared',
      declaration: {
        branch: 'feature/one',
        status: 'blocked',
        artifacts: [],
        pr: null,
        summary: '',
      },
    });
    expect(text).toContain('says `blocked`');
  });
});

describe('the tick holds nothing between calls', () => {
  /**
   * THE `kill -9` PROPERTY, PROVEN RATHER THAN ASSERTED — at the rule's level.
   * The daemon costs one tick because the decision is a function of readings,
   * so the same readings must produce the same verdict however many ticks ran
   * before, and in whatever order.
   */
  it('reaches the same verdict on the same readings, every time', () => {
    const readings = finished({ declaration: { read: 'absent' }, attempts: 1 });
    const first = supervise(readings);
    const others = [supervise(readings), supervise(readings), supervise(readings)];
    for (const other of others) expect(other).toEqual(first);
  });

  it('is unaffected by what was decided about another agent first', () => {
    const stranded = finished({ declaration: { read: 'absent' } });
    const alone = supervise(stranded);

    supervise(finished({ attempts: MAX_ATTEMPTS, declaration: { read: 'absent' } }));
    supervise(finished({ workerAlive: true }));
    supervise(finished());

    expect(supervise(stranded)).toEqual(alone);
  });

  it('does not mutate the readings it was given', () => {
    const readings = finished({ declaration: { read: 'absent' } });
    const before = structuredClone(readings);
    supervise(readings);
    expect(readings).toEqual(before);
  });
});
