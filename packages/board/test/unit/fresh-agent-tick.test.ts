import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { rmTree } from '../helpers.mjs';

import type { RegisteredTreeReadings } from '@plot-pm/domain/rules/unclaimed';
import type { PortResult } from '@plot-pm/domain';
import type { FreshAgentRecord, FreshAgentRecordStore } from '@plot-pm/domain/ports/fresh-agent-record';
import { ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import { DECLARATION_FILENAME } from '@plot-pm/domain/entities/declaration';
import { freshAgentRecordFile, endingAskRecordFile, deskFs } from '@plot-pm/domain/adapters';
import type { Trees } from '@plot-pm/domain/ports/trees';
import type { PrMergedReading } from '@plot-pm/domain/rules/ending-action';
import { deskFixture, deskFixtureCalls } from '@plot-pm/domain/adapters/desk/desk-fixture';
import { questionEscalation, parseQuestionEscalation } from '@plot-pm/domain/rules/question-escalation';

import {
  freshAgentCandidateTrees,
  runFromEndingDetail,
  readFreshAgentCandidates,
  freshAgentDecisions,
  applyFreshAgentDecisions,
  freshAgentLines,
  markerTextFor,
  prMergedReading,
  type FreshAgentDecision,
  type FreshAgentPorts,
  type FreshAgentAskReads,
  type FreshAgentCandidateReadings,
} from '../../src/server/entry/registryd.js';
import type { DeskContinuation } from '../../src/server/continue.js';
import { startFreshSession, freshAgentDeskReads } from '../../src/server/entry/registryd-main.js';
import { markerReading } from '../../src/server/worker-question.js';
import { agentsFixture } from '@plot-pm/domain/adapters/agents/agents-fixture';

const PLAN = '2026-10-05-a-plan';

const tree = (over: Partial<RegisteredTreeReadings> = {}): RegisteredTreeReadings => ({
  path: '/estate/.worktrees/feature-x',
  branch: 'feature/x',
  isMain: false,
  prunable: false,
  registered: false,
  planNamed: true,
  plan: PLAN,
  dirtyCount: 0,
  ...over,
});

const CORRECTION_FILENAME = 'PLOT-CORRECTION.md';

describe('freshAgentCandidateTrees', () => {
  it('names an unregistered, plan-named, non-main desk', () => {
    expect(freshAgentCandidateTrees([tree()])).toEqual([tree()]);
  });

  it('excludes the main checkout', () => {
    expect(freshAgentCandidateTrees([tree({ isMain: true })])).toEqual([]);
  });

  it('excludes a desk a manifest already names — supervise already sees that one', () => {
    expect(freshAgentCandidateTrees([tree({ registered: true })])).toEqual([]);
  });

  it('excludes a desk no plan names — isUnclaimedTree already sees that one', () => {
    expect(freshAgentCandidateTrees([tree({ planNamed: false })])).toEqual([]);
  });
});

describe('runFromEndingDetail', () => {
  it('reads the run URL and the conclusion out of the shell\'s own sentence', () => {
    const detail =
      'the build failed on each of 2 corrections; the last was: the run at https://github.com/plot-pm/plot/actions/runs/123 for a1b2c3d concluded failure';
    expect(runFromEndingDetail(detail)).toEqual({
      runUrl: 'https://github.com/plot-pm/plot/actions/runs/123',
      conclusion: 'failure',
    });
  });

  it('answers empty strings for a detail that does not hold the sentence', () => {
    expect(runFromEndingDetail('something else entirely')).toEqual({ runUrl: '', conclusion: '' });
  });
});

const answeredRows = (rows: readonly FreshAgentRecord[]): PortResult<readonly FreshAgentRecord[]> => ({
  ok: true,
  value: rows,
});

const emptyStore: Pick<FreshAgentRecordStore, 'rowsFor'> = {
  rowsFor: async () => answeredRows([]),
};

const noHeldFiles = async (): Promise<readonly string[] | null> => [];
const noMarker = async (): Promise<boolean> => false;
const noAsks: FreshAgentAskReads = {
  endingAt: async () => null,
  record: { asked: async () => ({ ok: true, value: false }) },
  prMerged: async () => 'unanswerable',
};

const endingFile = (reason: string, detail = '') =>
  JSON.stringify({ reason, actor: 'agent', branch: 'feature/x', detail });

describe('readFreshAgentCandidates', () => {
  it('reads the ending reason off the desk', async () => {
    const deskFile = (worktree: string, name: string) =>
      name === ENDING_FILENAME ? endingFile('corrections-spent') : null;
    const [reading] = await readFreshAgentCandidates([tree()], deskFile, emptyStore, noHeldFiles, noMarker, noAsks);
    expect(reading?.ending).toBe('corrections-spent');
  });

  it('reads null where no ending was written', async () => {
    const [reading] = await readFreshAgentCandidates([tree()], () => null, emptyStore, noHeldFiles, noMarker, noAsks);
    expect(reading?.ending).toBeNull();
  });

  it('reads the corrections file text verbatim', async () => {
    const deskFile = (worktree: string, name: string) =>
      name === CORRECTION_FILENAME ? '## Correction 1 of 2\n\n' : null;
    const [reading] = await readFreshAgentCandidates([tree()], deskFile, emptyStore, noHeldFiles, noMarker, noAsks);
    expect(reading?.correctionsText).toContain('Correction 1 of 2');
  });

  it('a missing corrections file reads as empty text, never a failure', async () => {
    const [reading] = await readFreshAgentCandidates([tree()], () => null, emptyStore, noHeldFiles, noMarker, noAsks);
    expect(reading?.correctionsText).toBe('');
  });

  it('counts the rows the store answers for this branch', async () => {
    const store: Pick<FreshAgentRecordStore, 'rowsFor'> = {
      rowsFor: async (plan, branch) =>
        answeredRows(
          plan === PLAN && branch === 'feature/x'
            ? [{ plan, branch, worktree: tree().path, at: '2026-10-05T12:00:00.000Z', runUrl: '' }]
            : [],
        ),
    };
    const [reading] = await readFreshAgentCandidates([tree()], () => null, store, noHeldFiles, noMarker, noAsks);
    expect(reading?.priorFreshSessions).toBe(1);
  });

  it('an unanswerable store reads as zero, never as a session already run', async () => {
    const failedStore: Pick<FreshAgentRecordStore, 'rowsFor'> = {
      rowsFor: async () => ({ ok: false, why: 'failed' }),
    };
    const [reading] = await readFreshAgentCandidates([tree()], () => null, failedStore, noHeldFiles, noMarker, noAsks);
    expect(reading?.priorFreshSessions).toBe(0);
  });

  it('reads the detail the ending carries', async () => {
    const deskFile = (worktree: string, name: string) =>
      name === ENDING_FILENAME ? endingFile('run-limit', 'Slice max runs reached: 5') : null;
    const [reading] = await readFreshAgentCandidates([tree()], deskFile, emptyStore, noHeldFiles, noMarker, noAsks);
    expect(reading?.detail).toBe('Slice max runs reached: 5');
  });
});

describe('freshAgentDecisions', () => {
  it('decides start-fresh and composes an answer for a first spent budget', () => {
    const [decision] = freshAgentDecisions(
      [
        {
          plan: PLAN,
          escalated: false,
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'corrections-spent',
          refusedAssignment: '',
          correctionsText: '## Correction 1 of 2\n\n',
          runUrl: 'https://github.com/plot-pm/plot/actions/runs/123',
          conclusion: 'failure',
          detail: '',
          priorFreshSessions: 0,
          heldFiles: [],
          endingAt: '',
          endingAsked: false,
          prMerged: 'unanswerable',
        },
      ],
      2,
    );
    expect(decision?.verdict).toBe('start-fresh');
    expect(decision?.answer).toContain('Correction 1 of 2');
    expect(decision?.answer).toContain('https://github.com/plot-pm/plot/actions/runs/123');
  });

  it('decides needs-a-person and composes no answer on a second spent budget', () => {
    const [decision] = freshAgentDecisions(
      [
        {
          plan: PLAN,
          escalated: false,
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'corrections-spent',
          refusedAssignment: '',
          correctionsText: '',
          runUrl: '',
          conclusion: '',
          detail: '',
          priorFreshSessions: 1,
          heldFiles: [],
          endingAt: '',
          endingAsked: false,
          prMerged: 'unanswerable',
        },
      ],
      2,
    );
    expect(decision?.verdict).toBe('needs-a-person');
    expect(decision?.answer).toBe('');
  });

  it('leaves every other ending alone', () => {
    const [decision] = freshAgentDecisions(
      [
        {
          plan: PLAN,
          escalated: false,
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'bound',
          refusedAssignment: '',
          correctionsText: '',
          runUrl: '',
          conclusion: '',
          detail: '',
          priorFreshSessions: 0,
          heldFiles: [],
          endingAt: '',
          endingAsked: false,
          prMerged: 'unanswerable',
        },
      ],
      2,
    );
    expect(decision?.verdict).toBe('leave');
    expect(decision?.answer).toBe('');
  });

  it('decides start-fresh for a first turn-limit ending, with a turn-limit answer rather than the corrections wording', () => {
    const [decision] = freshAgentDecisions(
      [
        {
          plan: PLAN,
          escalated: false,
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'turn-limit',
          refusedAssignment: '',
          correctionsText: '',
          runUrl: '',
          conclusion: '',
          detail: '',
          priorFreshSessions: 0,
          heldFiles: [],
          endingAt: '',
          endingAsked: false,
          prMerged: 'unanswerable',
        },
      ],
      2,
    );
    expect(decision?.verdict).toBe('start-fresh');
    expect(decision?.answer).toContain('Agent max turns');
    expect(decision?.answer).not.toContain('correction budget');
  });

  it('decides needs-a-person on a second turn-limit ending for the same slice', () => {
    const [decision] = freshAgentDecisions(
      [
        {
          plan: PLAN,
          escalated: false,
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'turn-limit',
          refusedAssignment: '',
          correctionsText: '',
          runUrl: '',
          conclusion: '',
          detail: '',
          priorFreshSessions: 1,
          heldFiles: [],
          endingAt: '',
          endingAsked: false,
          prMerged: 'unanswerable',
        },
      ],
      2,
    );
    expect(decision?.verdict).toBe('needs-a-person');
    expect(decision?.answer).toBe('');
  });

  it('a slice that already spent its fresh session on corrections-spent answers needs-a-person on a later turn-limit', () => {
    // THE CROSS-RULE COMPOSITION THE BRIEF NAMES: two separate allowances must
    // not let one slice start two fresh sessions. `priorFreshSessions` counts
    // every fresh session this slice had regardless of which ending earned
    // it, so a turn-limit reading after a corrections-spent fresh session
    // already carries `priorFreshSessions: 1` and must not re-earn a second.
    const [decision] = freshAgentDecisions(
      [
        {
          plan: PLAN,
          escalated: false,
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'turn-limit',
          refusedAssignment: '',
          correctionsText: '',
          runUrl: '',
          conclusion: '',
          detail: '',
          priorFreshSessions: 1,
          heldFiles: [],
          endingAt: '',
          endingAsked: false,
          prMerged: 'unanswerable',
        },
      ],
      2,
    );
    expect(decision?.verdict).toBe('needs-a-person');
  });

  it('a slice that already spent its fresh session on turn-limit answers needs-a-person on a later corrections-spent', () => {
    const [decision] = freshAgentDecisions(
      [
        {
          plan: PLAN,
          escalated: false,
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'corrections-spent',
          refusedAssignment: '',
          correctionsText: '',
          runUrl: '',
          conclusion: '',
          detail: '',
          priorFreshSessions: 1,
          heldFiles: [],
          endingAt: '',
          endingAsked: false,
          prMerged: 'unanswerable',
        },
      ],
      2,
    );
    expect(decision?.verdict).toBe('needs-a-person');
  });

  const needsPersonReading = (ending: FreshAgentCandidateReadings['ending'], priorFreshSessions: number): FreshAgentCandidateReadings => ({
    plan: PLAN,
    escalated: false,
    branch: 'feature/x',
    worktree: tree().path,
    ending,
    refusedAssignment: '',
    correctionsText: '',
    runUrl: '',
    conclusion: '',
    detail: 'the detail',
    priorFreshSessions,
    heldFiles: [],
    endingAt: '',
    endingAsked: false,
    prMerged: 'unanswerable',
  });

  it('answers needs-a-person for after-prompt holding-work, corrections-spent and turn-limit on their second reach, together with the five outright reasons — no row keyed on ending alone', () => {
    // A TABLE, SO A ROW KEYED LOOSELY ON `ending` ALONE (ignoring
    // `priorFreshSessions`) FAILS HERE RATHER THAN IN PRODUCTION:
    // after-prompt holding-work, corrections-spent and turn-limit need one
    // prior fresh session to reach needs-a-person; the five outright reasons
    // need none.
    const earnedFirst = (['holding-work', 'corrections-spent', 'turn-limit'] as const).map((ending) =>
      needsPersonReading(ending, 1),
    );
    const outright = (['blocked', 'spend-limit', 'unstarted', 'run-limit', 'checks-unanswered'] as const).map((ending) =>
      needsPersonReading(ending, 0),
    );
    const decisions = freshAgentDecisions([...earnedFirst, ...outright], 2);
    expect(decisions.map((d) => d.verdict)).toEqual(Array(decisions.length).fill('needs-a-person'));
    expect(decisions.map((d) => d.escalate)).toEqual(Array(decisions.length).fill(true));
    expect(decisions.every((d) => d.markerText !== '')).toBe(true);
  });
});

describe('readFreshAgentCandidates, the marker and the plan', () => {
  it('reads a worktree the marker reader names as already escalated', async () => {
    const [reading] = await readFreshAgentCandidates([tree()], () => null, emptyStore, noHeldFiles, async () => true, noAsks);
    expect(reading?.escalated).toBe(true);
  });

  it('reads a worktree with no marker as not escalated', async () => {
    const [reading] = await readFreshAgentCandidates([tree()], () => null, emptyStore, noHeldFiles, noMarker, noAsks);
    expect(reading?.escalated).toBe(false);
  });

  it('reads escalated off the marker even where a stale blocked declaration says otherwise — a declaration is no longer the source', async () => {
    // THE BUG A DECLARATION-BASED READ WOULD HIDE: a run-limit desk from
    // before this change may hold a `status: 'ok'` declaration (or none at
    // all) and still need a marker written for the first time.
    const deskFile = (_worktree: string, name: string) =>
      name === 'PLOT-DECLARATION.md' ? JSON.stringify({ branch: 'feature/x', status: 'ok' }) : null;
    const [reading] = await readFreshAgentCandidates([tree()], deskFile, emptyStore, noHeldFiles, async () => true, noAsks);
    expect(reading?.escalated).toBe(true);
  });

  it('carries the plan the tree names', async () => {
    const [reading] = await readFreshAgentCandidates([tree()], () => null, emptyStore, noHeldFiles, noMarker, noAsks);
    expect(reading?.plan).toBe(PLAN);
  });

  it('reads an empty plan where the tree names none', async () => {
    const [reading] = await readFreshAgentCandidates([tree({ plan: undefined })], () => null, emptyStore, noHeldFiles, noMarker, noAsks);
    expect(reading?.plan).toBe('');
  });
});

const spentReading = (over: Partial<FreshAgentCandidateReadings> = {}): FreshAgentCandidateReadings => ({
  plan: PLAN,
  branch: 'feature/x',
  worktree: '/estate/.worktrees/feature-x',
  ending: 'corrections-spent',
  refusedAssignment: '',
  correctionsText: '## Correction 1 of 2\n\nCI reported: x\n',
  runUrl: 'https://github.com/plot-pm/plot/actions/runs/123',
  conclusion: 'failure',
  detail: '',
  priorFreshSessions: 0,
  escalated: false,
  heldFiles: [],
  endingAt: '',
  endingAsked: false,
  prMerged: 'unanswerable',
  ...over,
});

describe('the holding-work readings and decisions', () => {
  const holdingFile = (refusedAssignment: string) =>
    JSON.stringify({ reason: 'holding-work', actor: 'agent', branch: 'feature/x', detail: '', refusedAssignment });

  it('reads the refused assignment off the ending', async () => {
    const deskFile = (_w: string, name: string) => (name === ENDING_FILENAME ? holdingFile('feature/y') : null);
    const [reading] = await readFreshAgentCandidates([tree()], deskFile, emptyStore, noHeldFiles, noMarker, noAsks);
    expect(reading?.refusedAssignment).toBe('feature/y');
  });

  it('reads the held files the desk reports', async () => {
    const [reading] = await readFreshAgentCandidates([tree()], () => null, emptyStore, async () => ['a.ts'], noMarker, noAsks);
    expect(reading?.heldFiles).toEqual(['a.ts']);
  });

  it('composes the held-work answer, naming each held file, for an after-prompt holding-work', () => {
    const [decision] = freshAgentDecisions([spentReading({ ending: 'holding-work', heldFiles: ['a.ts'] })], 2);
    expect(decision?.verdict).toBe('start-fresh');
    expect(decision?.answer).toMatch(/^- a\.ts$/m);
    expect(decision?.answer).not.toContain('correction budget');
  });

  it('a take-up holding-work gives release-claim, no answer, and no start', async () => {
    const reading = spentReading({ ending: 'holding-work', refusedAssignment: 'feature/y', heldFiles: ['a.ts'] });
    const decisions = freshAgentDecisions([reading], 2);
    expect(decisions.map((d) => [d.verdict, d.answer, d.escalate])).toEqual([['release-claim', '', false]]);
    const { starts, calls, ports } = rig(started);
    expect(await applyFreshAgentDecisions(decisions, ports)).toEqual([]);
    expect(starts).toEqual([]);
    expect(calls.blockedMarkers).toEqual([]);
  });
});

describe('freshAgentDecisions, escalation', () => {
  it('escalates a second spent budget once and not again after the declaration exists', () => {
    const [first] = freshAgentDecisions([spentReading({ priorFreshSessions: 1 })], 2);
    const [second] = freshAgentDecisions([spentReading({ priorFreshSessions: 1, escalated: true })], 2);
    expect(first?.escalate).toBe(true);
    expect(second?.verdict).toBe('needs-a-person');
    expect(second?.escalate).toBe(false);
  });

  it('never escalates a first spent budget or an ending that stays leave', () => {
    const decisions = freshAgentDecisions(
      [spentReading(), spentReading({ ending: 'bound', priorFreshSessions: 3 })],
      2,
    );
    expect(decisions.map((d) => d.escalate)).toEqual([false, false]);
  });

  it('escalates outright for unstarted, with no prior fresh session needed', () => {
    const [decision] = freshAgentDecisions([spentReading({ ending: 'unstarted', detail: 'exit 1' })], 2);
    expect(decision?.verdict).toBe('needs-a-person');
    expect(decision?.escalate).toBe(true);
    expect(decision?.markerText).toContain('never ran a slice');
  });
});

/** Every directory `rig` created, removed by its exact name after each test. */
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmTree(home);
});

/** A tick's worth of the real record in a private directory, with fake continue and desk ports. */
const rig = (continues: (input: Parameters<FreshAgentPorts['start']>[0]) => Promise<DeskContinuation>) => {
  const home = mkdtempSync(join(tmpdir(), 'plot-fresh-tick-'));
  homes.push(home);
  const record = freshAgentRecordFile({ home });
  const asks = endingAskRecordFile({ home });
  /** What the tick reads of the ending's time and the host; a test changes them between ticks. */
  const world: { endingAt: string | null; merged: PrMergedReading; mergedAsks: number } = {
    endingAt: '2026-10-05T11:00:00.000Z',
    merged: 'not-merged',
    mergedAsks: 0,
  };
  const starts: { branch: string; answer: string }[] = [];
  // MUTATED AFTER EACH WRITE, so a marker written on tick N makes tick N+1's
  // read see `escalated: true` — the same no-overwrite behaviour a real
  // `PLOT-BLOCKED.md` file gives through `hasMarker`.
  const markedWorktrees = new Set<string>();
  const calls = deskFixtureCalls();
  const ports: FreshAgentPorts = {
    record,
    asks,
    desk: {
      writeBlockedMarker: async (worktree, text) => {
        const result = await deskFixture({ markedWorktrees: [...markedWorktrees], calls }).writeBlockedMarker(worktree, text);
        markedWorktrees.add(worktree);
        return result;
      },
    },
    now: () => new Date('2026-10-05T12:00:00.000Z'),
    start: async (input) => {
      starts.push({ branch: input.branch, answer: input.answer });
      return continues(input);
    },
  };
  /** One tick over one desk: read through the real record, decide, apply. */
  const tickOver = async (deskFile: (worktree: string, name: string) => string | null, path = tree().path) => {
    const readings = await readFreshAgentCandidates(
      freshAgentCandidateTrees([tree({ path })]),
      deskFile,
      record,
      noHeldFiles,
      async (worktree) => markedWorktrees.has(worktree),
      {
        endingAt: async () => world.endingAt,
        record: asks,
        prMerged: async () => {
          world.mergedAsks += 1;
          return world.merged;
        },
      },
    );
    return applyFreshAgentDecisions(freshAgentDecisions(readings, 2), ports);
  };
  return { record, asks, world, ports, calls, markedWorktrees, starts, tickOver };
};

const spentDesk = () => (_worktree: string, name: string) => {
  if (name === ENDING_FILENAME) {
    return endingFile(
      'corrections-spent',
      'the build failed on each of 2 corrections; the last was: the run at https://github.com/plot-pm/plot/actions/runs/123 for a1b2c3d concluded failure',
    );
  }
  if (name === CORRECTION_FILENAME) return '## Correction 1 of 2\n\nCI reported: gate\n';
  return null;
};

const started = (input: { beforeStart: () => Promise<boolean> }): Promise<DeskContinuation> =>
  input.beforeStart().then((ok) =>
    ok
      ? { kind: 'started', pid: '4242', previousPid: '', prompt: '/p', log: '/l' }
      : { kind: 'failed', error: 'stopped' },
  );

describe('the tick starts one fresh session through continue', () => {
  it('starts one continue with the composed answer for a spent desk', async () => {
    const { starts, tickOver } = rig(started);
    const applied = await tickOver(spentDesk());
    expect(applied.map((a) => a.outcome)).toEqual(['started']);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.branch).toBe('feature/x');
    expect(starts[0]?.answer).toContain('CI reported: gate');
    expect(starts[0]?.answer).toContain('https://github.com/plot-pm/plot/actions/runs/123');
  });

  it('starts none on the next tick once the start is recorded, and writes a marker asking a person', async () => {
    const { starts, calls, tickOver } = rig(started);
    await tickOver(spentDesk());
    const second = await tickOver(spentDesk());
    expect(starts).toHaveLength(1);
    expect(second.map((a) => a.outcome)).toEqual(['escalated']);
    expect(calls.blockedMarkers).toEqual([
      { worktree: tree().path, text: expect.stringContaining('already had its one fresh session') },
    ]);
  });

  it('writes the marker once: a desk the marker already names gets a second-tick no-op with the text unchanged', async () => {
    const { starts, calls, tickOver } = rig(started);
    await tickOver(spentDesk());
    await tickOver(spentDesk());
    const third = await tickOver(spentDesk());
    expect(third).toEqual([]);
    expect(calls.blockedMarkers).toHaveLength(1);
    expect(starts).toHaveLength(1);
  });

  it('a tick that throws after the record write leaves one row and the next tick starts none', async () => {
    let calls = 0;
    const { record, starts, tickOver } = rig(async (input) => {
      calls += 1;
      await input.beforeStart();
      throw new Error('the spawn died after the record was written');
    });
    const first = await tickOver(spentDesk());
    expect(first.map((a) => a.outcome)).toEqual(['threw']);
    const rows = await record.rowsFor(PLAN, 'feature/x');
    expect(rows.ok && rows.value.length).toBe(1);
    await tickOver(spentDesk());
    expect(calls).toBe(1);
    expect(starts).toHaveLength(1);
  });

  it('records nothing and reports the reason where continue refuses the desk', async () => {
    const { record, tickOver } = rig(async () => ({
      kind: 'refused',
      status: 409,
      reason: 'no-manifest',
      detail: 'no manifest names /estate/.worktrees/feature-x',
    }));
    const applied = await tickOver(spentDesk());
    expect(applied).toEqual([
      {
        branch: 'feature/x',
        outcome: 'refused',
        detail: 'continue refused (no-manifest): no manifest names /estate/.worktrees/feature-x',
      },
    ]);
    const rows = await record.rowsFor(PLAN, 'feature/x');
    expect(rows.ok && rows.value.length).toBe(0);
  });

  it('reports a failed start and a failed record write', async () => {
    const failed = rig(async () => ({ kind: 'failed', error: 'cannot write the prompt' }));
    expect((await failed.tickOver(spentDesk())).map((a) => a.outcome)).toEqual(['start-failed']);

    const stopped = rig(started);
    stopped.ports.record = { append: async () => ({ ok: false, why: 'failed' }) };
    expect((await stopped.tickOver(spentDesk())).map((a) => a.outcome)).toEqual(['start-failed']);
  });

  it('reports a marker that could not be written', async () => {
    const { ports, tickOver } = rig(started);
    ports.desk = { writeBlockedMarker: async () => ({ ok: false, why: 'failed' }) };
    await tickOver(spentDesk());
    expect((await tickOver(spentDesk())).map((a) => a.outcome)).toEqual(['escalation-failed']);
  });

  it('starts nothing but writes a marker for an unstarted desk — it asks a person outright, with no fresh session first', async () => {
    const { starts, calls, tickOver } = rig(started);
    const applied = await tickOver((_w, name) => (name === ENDING_FILENAME ? endingFile('unstarted', 'exit 1: boom') : null));
    expect(applied.map((a) => a.outcome)).toEqual(['escalated']);
    expect(starts).toEqual([]);
    expect(calls.blockedMarkers).toHaveLength(1);
    expect(calls.blockedMarkers[0]?.text).toContain('never ran a slice');
  });

  it('writes a marker for an unstarted desk that the real questionEscalation rule lists and later notifies on', async () => {
    // THE REAL DESK ADAPTER AND THE REAL MARKER READER: the marker this tick
    // writes is the file `escalationWrites` reads, with its own `askedAt`.
    const desk = mkdtempSync(join(tmpdir(), 'plot-fresh-marker-'));
    homes.push(desk);
    const { ports, tickOver } = rig(started);
    ports.desk = deskFs({} as Trees);
    const applied = await tickOver((_w, name) => (name === ENDING_FILENAME ? endingFile('unstarted', 'exit 1: boom') : null), desk);
    expect(applied.map((a) => a.outcome)).toEqual(['escalated']);
    const marker = await markerReading(desk);
    expect(marker?.firstLine).toContain('never ran a slice');

    const ages = parseQuestionEscalation('15m, 1h, 4h');
    const askedMs = Date.parse(marker?.askedAt ?? '');
    expect(questionEscalation({ marker: marker!, ageMs: Date.now() - askedMs, ages, recordedRungs: new Set() })).toEqual({
      rung: 'listed',
      isNew: false,
    });
    expect(questionEscalation({ marker: marker!, ageMs: 60 * 60_000, ages, recordedRungs: new Set() })).toEqual({
      rung: 'notified-1',
      isNew: true,
    });
  });

  it('starts one fresh session for a turn-limit desk, and none on the next tick', async () => {
    const { starts, calls, tickOver } = rig(started);
    const turnLimit = (_w: string, name: string) =>
      name === ENDING_FILENAME ? endingFile('turn-limit', 'the run reached Agent max turns') : null;
    const first = await tickOver(turnLimit);
    const second = await tickOver(turnLimit);
    expect(first.map((a) => a.outcome)).toEqual(['started']);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.answer).toContain('Agent max turns');
    expect(second.map((a) => a.outcome)).toEqual(['escalated']);
    expect(calls.blockedMarkers).toHaveLength(1);
  });

  it('writes a marker outright for a spend-limit or run-limit desk, with no fresh session started — a declaration-only read would miss this', async () => {
    // THE EXACT BUG A DECLARATION-BASED `escalated` READ WOULD HIDE: this desk
    // never ran a fresh session and holds no declaration at all, yet still
    // needs the marker on the FIRST tick it is seen, because these two
    // reasons skip straight to needs-a-person.
    for (const reason of ['spend-limit', 'run-limit']) {
      const { starts, calls, tickOver } = rig(started);
      const applied = await tickOver((_w, name) => (name === ENDING_FILENAME ? endingFile(reason, 'limit detail') : null));
      expect(applied.map((a) => a.outcome)).toEqual(['escalated']);
      expect(starts).toEqual([]);
      expect(calls.blockedMarkers).toHaveLength(1);
    }
  });

  it('a desk asked once and then answered is not asked again about the same ending, and is asked about a newer one', async () => {
    const { calls, markedWorktrees, world, tickOver } = rig(started);
    const runLimit = (_w: string, name: string) =>
      name === ENDING_FILENAME ? endingFile('run-limit', 'Slice max runs reached: 5') : null;
    expect((await tickOver(runLimit)).map((a) => a.outcome)).toEqual(['escalated']);
    // THE PERSON ANSWERS: the continuation deletes the marker, the loop it
    // started exits on the bound and writes no ending, so the old one stays.
    markedWorktrees.delete(tree().path);
    expect(await tickOver(runLimit)).toEqual([]);
    expect(calls.blockedMarkers).toHaveLength(1);
    // A NEW ENDING IS A NEW QUESTION.
    world.endingAt = '2026-10-05T13:00:00.000Z';
    expect((await tickOver(runLimit)).map((a) => a.outcome)).toEqual(['escalated']);
    expect(calls.blockedMarkers).toHaveLength(2);
  });

  it('records the ask for a marker the loop wrote itself, so the answered desk is not asked again either', async () => {
    const { asks, calls, markedWorktrees, tickOver } = rig(started);
    const unstarted = (_w: string, name: string) => (name === ENDING_FILENAME ? endingFile('unstarted', 'exit 1') : null);
    markedWorktrees.add(tree().path);
    expect(await tickOver(unstarted)).toEqual([]);
    expect(await asks.asked(PLAN, 'feature/x', '2026-10-05T11:00:00.000Z')).toEqual({ ok: true, value: true });
    markedWorktrees.delete(tree().path);
    expect(await tickOver(unstarted)).toEqual([]);
    expect(calls.blockedMarkers).toEqual([]);
  });

  it('asks again where the ask could not be recorded, and says so', async () => {
    const { ports, calls, markedWorktrees, tickOver } = rig(started);
    ports.asks = { append: async () => ({ ok: false, why: 'failed' }) };
    const runLimit = (_w: string, name: string) => (name === ENDING_FILENAME ? endingFile('run-limit', 'r') : null);
    const first = await tickOver(runLimit);
    expect(first.map((a) => [a.outcome, a.detail])).toEqual([
      ['escalation-failed', 'the ask could not be recorded in ending-asks.tsv; the next tick asks again'],
    ]);
    markedWorktrees.delete(tree().path);
    expect((await tickOver(runLimit)).map((a) => a.outcome)).toEqual(['escalation-failed']);
    expect(calls.blockedMarkers).toHaveLength(2);
  });

  it('writes no marker for an outright ending whose PR merged, and asks where the host could not say', async () => {
    const merged = rig(started);
    merged.world.merged = 'merged';
    const runLimit = (_w: string, name: string) => (name === ENDING_FILENAME ? endingFile('run-limit', 'r') : null);
    expect(await merged.tickOver(runLimit)).toEqual([]);
    expect(merged.calls.blockedMarkers).toEqual([]);
    expect(merged.world.mergedAsks).toBe(1);

    const unknown = rig(started);
    unknown.world.merged = 'unanswerable';
    expect((await unknown.tickOver(runLimit)).map((a) => a.outcome)).toEqual(['escalated']);
  });

  it('asks the host about a merge only for an outright needs-a-person ending', async () => {
    const { world, tickOver } = rig(started);
    await tickOver(spentDesk());
    expect(world.mergedAsks).toBe(0);
  });

  it('writes the marker for a run-limit desk that holds a blocked declaration and no marker', async () => {
    const { calls, tickOver } = rig(started);
    const deskFile = (_w: string, name: string) => {
      if (name === ENDING_FILENAME) return endingFile('run-limit', 'Slice max runs reached: 5');
      if (name === DECLARATION_FILENAME) return JSON.stringify({ branch: 'feature/x', status: 'blocked' });
      return null;
    };
    expect((await tickOver(deskFile)).map((a) => a.outcome)).toEqual(['escalated']);
    expect(calls.blockedMarkers[0]?.text).toContain('run limit');
  });

  it('reports a thrown non-Error by its text', async () => {
    const { tickOver } = rig(async () => {
      throw 'plain string';
    });
    expect((await tickOver(spentDesk()))[0]?.detail).toBe('plain string');
  });
});

describe('one desk\'s missing marker text', () => {
  it('composes no text for an ending the composer refuses, instead of throwing for the tick', () => {
    expect(markerTextFor(spentReading({ ending: 'bound' }))).toBe('');
  });

  it('reports that desk and still applies the next one', async () => {
    const { ports, calls } = rig(started);
    const decision = (worktree: string, markerText: string): FreshAgentDecision => ({
      plan: PLAN,
      branch: 'feature/x',
      worktree,
      verdict: 'needs-a-person',
      answer: '',
      runUrl: '',
      escalate: true,
      markerText,
      endingAt: '',
    });
    const applied = await applyFreshAgentDecisions([decision('/a', ''), decision('/b', 'a question')], ports);
    expect(applied.map((a) => a.outcome)).toEqual(['escalation-failed', 'escalated']);
    expect(calls.blockedMarkers).toEqual([{ worktree: '/b', text: 'a question' }]);
  });
});

describe('freshAgentDeskReads', () => {
  const reads = () =>
    freshAgentDeskReads(
      { repoRoot: '/nowhere', scriptDir: '/nowhere' },
      { asked: async () => ({ ok: true, value: false }) },
      async () => ({ ok: true, value: 'merged' }),
    );

  it('reads a PLOT-BLOCKED.md marker on the desk as escalated, and its absence as not', async () => {
    const desk = mkdtempSync(join(tmpdir(), 'plot-fresh-reads-'));
    homes.push(desk);
    expect(await reads().hasMarker(desk)).toBe(false);
    writeFileSync(join(desk, 'PLOT-BLOCKED.md'), 'which adapter?\n');
    expect(await reads().hasMarker(desk)).toBe(true);
  });

  it('reads the ending file\'s time, and null where there is no ending', async () => {
    const desk = mkdtempSync(join(tmpdir(), 'plot-fresh-reads-'));
    homes.push(desk);
    expect(await reads().asks.endingAt(desk)).toBeNull();
    writeFileSync(join(desk, ENDING_FILENAME), endingFile('run-limit'));
    const at = new Date('2026-10-05T11:00:00.000Z');
    utimesSync(join(desk, ENDING_FILENAME), at, at);
    expect(await reads().asks.endingAt(desk)).toBe('2026-10-05T11:00:00.000Z');
  });

  it('maps the host\'s merge answer to a reading', async () => {
    expect(await reads().asks.prMerged('feature/x')).toBe('merged');
  });
});

describe('prMergedReading', () => {
  it('reads merged and not-merged as the host said, and a failed or unknown answer as unanswerable — never merged', () => {
    expect(prMergedReading({ ok: true, value: 'merged' })).toBe('merged');
    expect(prMergedReading({ ok: true, value: 'not-merged' })).toBe('not-merged');
    expect(prMergedReading({ ok: true, value: 'unknown' })).toBe('unanswerable');
    expect(prMergedReading({ ok: false, why: 'failed' })).toBe('unanswerable');
  });
});

describe('freshAgentLines', () => {
  it('sends started and escalated to the log and every other outcome to the error stream', () => {
    const lines = freshAgentLines([
      { branch: 'a', outcome: 'started', detail: 'ok' },
      { branch: 'b', outcome: 'escalated', detail: 'ok' },
      { branch: 'c', outcome: 'refused', detail: 'no' },
    ]);
    expect(lines.map((l) => l.error)).toEqual([false, false, true]);
    expect(lines[2]?.line).toBe('plot-registryd fresh-agent c: refused — no');
  });
});

describe('startFreshSession registers the agent a spent desk lacks', () => {
  const calls = () => ({
    attempts: [],
    corrections: [],
    clearedAssignments: [],
    registered: [] as { session: string; branch: string; worktree: string; command: string }[],
    deregistered: [] as string[],
  });
  const wiring = (
    c: ReturnType<typeof calls>,
    continueDesk: Parameters<typeof startFreshSession>[1]['continueDesk'],
    registerFails = false,
  ): Parameters<typeof startFreshSession>[1] => ({
    agents: agentsFixture({ calls: c, registerFails }),
    command: 'loop.sh',
    newSession: () => 'new-session',
    continueDesk,
    opts: { repoRoot: '/r', scriptsDir: '/s' },
  });
  const input = (beforeStart: () => Promise<boolean>) => ({
    branch: 'feature/x',
    worktree: tree().path,
    answer: 'the composed answer',
    main: 'main',
    beforeStart,
  });

  it('a spent desk with no manifest gets one registration and one continue with the composed answer', async () => {
    const c = calls();
    const seen: { answer: string; fresh?: boolean }[] = [];
    const result = await startFreshSession(
      input(async () => true),
      wiring(c, async (i) => {
        seen.push({ answer: i.answer, fresh: i.fresh });
        return { kind: 'started', pid: '7', previousPid: '', prompt: '', log: '' };
      }),
    );
    expect(result.kind).toBe('started');
    expect(c.registered).toEqual([
      { session: 'new-session', branch: 'feature/x', worktree: tree().path, command: 'loop.sh' },
    ]);
    expect(seen).toEqual([{ answer: 'the composed answer', fresh: true }]);
    expect(c.deregistered).toEqual([]);
  });

  it('a failed registration starts nothing and leaves no row', async () => {
    const c = calls();
    let continues = 0;
    const rigged = rig(async (i) =>
      startFreshSession(
        { ...input(i.beforeStart) },
        wiring(
          c,
          async () => {
            continues += 1;
            return { kind: 'started', pid: '7', previousPid: '', prompt: '', log: '' };
          },
          true,
        ),
      ),
    );
    const applied = await rigged.tickOver(spentDesk());
    expect(applied.map((a) => a.outcome)).toEqual(['start-failed']);
    expect(continues).toBe(0);
    const rows = await rigged.record.rowsFor(PLAN, 'feature/x');
    expect(rows.ok && rows.value.length).toBe(0);
  });

  it('a continue refusal after the registration removes the manifest', async () => {
    const c = calls();
    const result = await startFreshSession(
      input(async () => true),
      wiring(c, async () => ({ kind: 'refused', status: 409, reason: 'no-question', detail: 'x' })),
    );
    expect(result.kind).toBe('refused');
    expect(c.registered).toHaveLength(1);
    expect(c.deregistered).toEqual(['new-session']);
  });

  it('a failed continue removes the manifest too', async () => {
    const c = calls();
    await startFreshSession(
      input(async () => true),
      wiring(c, async () => ({ kind: 'failed', error: 'x' })),
    );
    expect(c.deregistered).toEqual(['new-session']);
  });

  it('a throw after the registration removes the manifest and rethrows', async () => {
    const c = calls();
    await expect(
      startFreshSession(
        input(async () => true),
        wiring(c, async () => {
          throw new Error('spawn died');
        }),
      ),
    ).rejects.toThrow('spawn died');
    expect(c.deregistered).toEqual(['new-session']);
  });
});
