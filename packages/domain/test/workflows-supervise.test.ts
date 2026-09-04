import { describe, it, expect } from 'vitest';
import { supervise } from '../src/workflows/supervise.js';
import { MAX_ATTEMPTS, type SupervisionReadings } from '../src/rules/supervision.js';
import type { DeskReadings } from '../src/rules/gates.js';
import type { Write } from '../src/workflows/decision.js';

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

const cleanDesk = (branch: string, over: Partial<DeskReadings> = {}): DeskReadings => ({
  branch,
  merge: 'merged',
  changesets: [{ path: '.changeset/tidy-moons.md', text: GOOD_CHANGESET }],
  workspacePackages: WORKSPACE,
  dirtyPath: '',
  blockedMarker: '',
  planLine: { prs: [692], deferred: false, deferredReason: '' },
  ...over,
});

/** One agent that finished everything. Each test changes what it is about. */
const agent = (
  branch: string,
  over: Partial<SupervisionReadings> = {},
): SupervisionReadings => ({
  branch,
  worktree: `/estate/.worktrees/${branch.replace(/\//g, '-')}`,
  workerAlive: false,
  declaration: {
    read: 'declared',
    declaration: { branch, status: 'ok', artifacts: [], pr: 692, summary: 'done' },
  },
  desk: cleanDesk(branch),
  resume: { resumeId: `session-${branch}`, transcriptFound: true },
  attempts: 0,
  madeProgress: true,
  headroom: 'clear',
  ...over,
});

/** An agent whose worker was killed before it could declare anything. */
const stranded = (branch: string, over: Partial<SupervisionReadings> = {}) =>
  agent(branch, { declaration: { read: 'absent' }, ...over });

const kindsOf = (writes: readonly Write[]) => writes.map((write) => write.kind);

describe('a tick over an empty registry', () => {
  it('decides, and writes nothing', () => {
    const result = supervise({ agents: [] });
    expect(result.outcome).toBe('decided');
    expect(result.workflow).toBe('supervise');
    expect(result.writes).toEqual([]);
    expect(result.detail.agents).toEqual([]);
  });
});

describe('a tick never refuses as a whole', () => {
  /**
   * The property `reap` has, for the same reason: the question is asked of each
   * agent separately, and one agent's live worker says nothing about the next
   * one's stranded desk.
   */
  it('decides even where every agent is blocked or spent', () => {
    const result = supervise({
      agents: [
        agent('feature/a', { workerAlive: true }),
        stranded('feature/b', { attempts: MAX_ATTEMPTS }),
        stranded('feature/c', { madeProgress: false }),
      ],
    });
    expect(result.outcome).toBe('decided');
  });
});

describe('the four branches of the tick, in one pass', () => {
  const result = supervise({
    agents: [
      agent('feature/alive', { workerAlive: true }),
      agent('feature/done'),
      stranded('feature/retry'),
      stranded('feature/spent', { attempts: MAX_ATTEMPTS }),
    ],
  });

  it('leaves the live worker alone', () => {
    expect(result.detail.left).toEqual(['feature/alive']);
  });

  it('reaps the finished desk', () => {
    expect(result.detail.reaping).toEqual(['feature/done']);
    expect(result.writes).toContainEqual({
      kind: 'worktree-remove',
      path: '/estate/.worktrees/feature-done',
    });
    expect(result.writes).toContainEqual({
      kind: 'manifest-clear',
      worktree: '/estate/.worktrees/feature-done',
    });
    expect(result.writes).toContainEqual({ kind: 'log-clear', branch: 'feature/done' });
  });

  it('corrects the stranded one', () => {
    expect(result.detail.correcting).toEqual(['feature/retry']);
  });

  it('marks the spent one for a person', () => {
    expect(result.detail.needingAPerson).toEqual(['feature/spent']);
  });

  it('reports every agent it read, in registry order', () => {
    expect(result.detail.agents.map((row) => row.branch)).toEqual([
      'feature/alive',
      'feature/done',
      'feature/retry',
      'feature/spent',
    ]);
  });
});

describe('the correction is written before it is handed over', () => {
  /**
   * THE ORDER IS THE PROPERTY. A daemon that died between the two writes must
   * not have started a retry it never recorded — an unrecorded retry is a
   * budget that never runs out, which is the loop the `needs a person` stop
   * exists to prevent.
   */
  it('records the attempt, then hands the correction over', () => {
    const result = supervise({ agents: [stranded('feature/retry')] });
    expect(kindsOf(result.writes)).toEqual(['agent-attempt', 'agent-resume']);
  });

  it('records the new count rather than an increment', () => {
    const result = supervise({ agents: [stranded('feature/retry', { attempts: 1 })] });
    expect(result.writes[0]).toEqual({
      kind: 'agent-attempt',
      worktree: '/estate/.worktrees/feature-retry',
      attempts: 2,
    });
  });

  it('carries the resume handle when the transcript exists', () => {
    const result = supervise({ agents: [stranded('feature/retry')] });
    const resume = result.writes[1];
    expect(resume.kind).toBe('agent-resume');
    if (resume.kind === 'agent-resume') {
      expect(resume.resumeId).toBe('session-feature/retry');
      expect(resume.correction).toContain('did not complete');
    }
  });

  it('carries an empty handle when the adopter did not pass the session id on', () => {
    const result = supervise({
      agents: [
        stranded('feature/retry', { resume: { resumeId: 'x', transcriptFound: false } }),
      ],
    });
    const resume = result.writes[1];
    if (resume.kind === 'agent-resume') {
      // A FRESH WORKER, with the same text in its brief. The empty handle is
      // the difference, and the correction is not.
      expect(resume.resumeId).toBe('');
      expect(resume.correction).toContain('did not complete');
    }
  });
});

describe('a spent budget stops, and the stop is visible', () => {
  const result = supervise({
    agents: [
      stranded('feature/spent', {
        attempts: MAX_ATTEMPTS,
        desk: cleanDesk('feature/spent', { merge: 'not-merged' }),
      }),
    ],
  });

  it('starts nothing — no loop', () => {
    expect(kindsOf(result.writes)).toEqual(['blocked-marker']);
    expect(kindsOf(result.writes)).not.toContain('agent-resume');
    expect(kindsOf(result.writes)).not.toContain('agent-attempt');
  });

  it('leaves the marker the estate already reads as “your turn”', () => {
    const marker = result.writes[0];
    expect(marker.kind).toBe('blocked-marker');
    if (marker.kind === 'blocked-marker') {
      expect(marker.worktree).toBe('/estate/.worktrees/feature-spent');
      expect(marker.question.startsWith('PLOT-BLOCKED:')).toBe(true);
      expect(marker.question).toContain('the supervisor gave up');
      expect(marker.question).toContain(`after ${MAX_ATTEMPTS} attempts`);
    }
  });

  it('gives the person the same list the next attempt would have had', () => {
    const marker = result.writes[0];
    if (marker.kind === 'blocked-marker') {
      expect(marker.question).toContain('What the gates found:');
      expect(marker.question).toContain('No merged PR');
      expect(marker.question).toContain('No declaration was written');
    }
  });
});

describe('an agent that declared itself blocked', () => {
  const blocked = agent('feature/asking', {
    declaration: {
      read: 'declared',
      declaration: {
        branch: 'feature/asking',
        status: 'blocked',
        artifacts: [],
        pr: null,
        summary: 'which retry semantics?',
      },
    },
  });

  it('reaches a person rather than a correction', () => {
    const result = supervise({ agents: [blocked] });
    expect(result.detail.needingAPerson).toEqual(['feature/asking']);
    expect(kindsOf(result.writes)).toEqual(['blocked-marker']);
  });

  it('says the agent stopped, not that the supervisor gave up', () => {
    const marker = supervise({ agents: [blocked] }).writes[0];
    if (marker.kind === 'blocked-marker') {
      expect(marker.question).toContain('declared itself blocked');
      expect(marker.question).not.toContain('the supervisor gave up');
      // NO GATE LIST. The gates were never run: a blocked declaration is
      // answered before them, so quoting failures here would invent readings.
      expect(marker.question).not.toContain('What the gates found:');
    }
  });
});

describe('the bound counts what a tick acts on', () => {
  it('spends nothing on agents whose worker is alive', () => {
    // ONE ACTION ALLOWED, and three live workers sit in front of the stranded
    // desk. A bound spent on them would make a bounded tick blind.
    const result = supervise(
      {
        agents: [
          agent('feature/a', { workerAlive: true }),
          agent('feature/b', { workerAlive: true }),
          agent('feature/c', { workerAlive: true }),
          stranded('feature/d'),
        ],
      },
      { max: 1 },
    );
    expect(result.detail.correcting).toEqual(['feature/d']);
  });

  it('spends nothing on agents a bound deferred', () => {
    const result = supervise(
      {
        agents: [
          stranded('feature/a', { madeProgress: false }),
          stranded('feature/b', { headroom: 'starved' }),
          stranded('feature/c'),
        ],
      },
      { max: 1 },
    );
    expect(result.detail.deferred).toEqual(['feature/a', 'feature/b']);
    expect(result.detail.correcting).toEqual(['feature/c']);
  });

  it('stops acting once the bound is reached, and says which rows it skipped', () => {
    const result = supervise(
      { agents: [stranded('feature/a'), stranded('feature/b'), stranded('feature/c')] },
      { max: 2 },
    );
    expect(result.detail.correcting).toEqual(['feature/a', 'feature/b']);
    expect(result.detail.agents.filter((row) => row.boundedOut).map((row) => row.branch)).toEqual([
      'feature/c',
    ]);
  });

  it('reads every agent with no bound', () => {
    const result = supervise({
      agents: [stranded('feature/a'), stranded('feature/b'), stranded('feature/c')],
    });
    expect(result.detail.correcting).toHaveLength(3);
  });
});

describe('a bound refusal is deferred, never dropped', () => {
  it('reports a starved machine as deferred and writes nothing for it', () => {
    const result = supervise({ agents: [stranded('feature/a', { headroom: 'starved' })] });
    expect(result.detail.deferred).toEqual(['feature/a']);
    expect(result.writes).toEqual([]);
    // THE NEXT TICK RE-ASKS IT. Nothing was written, so nothing was consumed.
    expect(result.detail.agents[0].supervision.nextAttempts).toBe(0);
  });

  it('reports an agent that committed nothing as deferred', () => {
    const result = supervise({ agents: [stranded('feature/a', { madeProgress: false })] });
    expect(result.detail.deferred).toEqual(['feature/a']);
    expect(result.writes).toEqual([]);
  });
});

describe('killing the daemon mid-tick costs one tick and no state', () => {
  /**
   * PROVEN RATHER THAN ASSERTED. The daemon holds nothing it cannot re-read, so
   * a tick is a pure function of the estate. Two properties say so together:
   * the same readings reach the same decision however many ticks ran before,
   * and a tick interrupted after N agents leaves the remaining N unchanged when
   * it is re-run whole.
   */
  const estate = {
    agents: [
      agent('feature/alive', { workerAlive: true }),
      agent('feature/done'),
      stranded('feature/retry'),
      stranded('feature/spent', { attempts: MAX_ATTEMPTS }),
    ],
  };

  it('reaches the same decision on every run', () => {
    const first = supervise(estate);
    for (let run = 0; run < 4; run += 1) expect(supervise(estate)).toEqual(first);
  });

  it('re-running a tick that was cut short after two agents reaches the whole answer', () => {
    // The cut-short tick, expressed as the bound that stops it after two.
    const interrupted = supervise(estate, { max: 2 });
    expect(interrupted.detail.reaping).toEqual(['feature/done']);
    expect(interrupted.detail.correcting).toEqual(['feature/retry']);
    expect(interrupted.detail.needingAPerson).toEqual([]);

    // Nothing was carried over. The next tick re-reads the same estate and
    // reaches everything, including what the bound skipped.
    const whole = supervise(estate);
    expect(whole.detail.needingAPerson).toEqual(['feature/spent']);
  });

  it('does not mutate the readings it was given', () => {
    const readings = structuredClone(estate);
    const before = structuredClone(readings);
    supervise(readings);
    expect(readings).toEqual(before);
  });
});

describe('a daemon’s first tick picks up desks that predate it', () => {
  /**
   * THE RETROACTIVE PROPERTY. It is free rather than implemented: the tick reads
   * the manifests and holds no record of having seen an agent, so a daemon
   * starting for the first time sees exactly what one running for a week sees.
   *
   * Three agents in the shape of the ones measured on 2026-08-31 — committed
   * and pushed, no PR, killed by the bound before they could declare anything.
   */
  it('corrects all three, on a registry it has never read before', () => {
    const result = supervise({
      agents: [
        stranded('feature/a-decision-writes-what-the-script-writes', {
          desk: cleanDesk('feature/a-decision-writes-what-the-script-writes', {
            merge: 'not-merged',
          }),
        }),
        stranded('feature/the-master-agent-asks-the-controller', {
          desk: cleanDesk('feature/the-master-agent-asks-the-controller', { merge: 'not-merged' }),
        }),
        stranded('feature/a-manifest-names-every-process', {
          desk: cleanDesk('feature/a-manifest-names-every-process', { merge: 'not-merged' }),
        }),
      ],
    });
    expect(result.detail.correcting).toHaveLength(3);
    for (const row of result.detail.agents) {
      expect(row.supervision.verdict).toBe('correct');
      expect(row.supervision.correction).toContain('No merged PR');
    }
  });
});
