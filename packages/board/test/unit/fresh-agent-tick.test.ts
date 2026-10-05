import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { rmTree } from '../helpers.mjs';

import type { RegisteredTreeReadings } from '@plot-pm/domain/rules/unclaimed';
import type { PortResult } from '@plot-pm/domain';
import type { FreshAgentRecord, FreshAgentRecordStore } from '@plot-pm/domain/ports/fresh-agent-record';
import { ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import { DECLARATION_FILENAME } from '@plot-pm/domain/entities/declaration';
import { freshAgentRecordFile } from '@plot-pm/domain/adapters';

import {
  freshAgentCandidateTrees,
  runFromEndingDetail,
  readFreshAgentCandidates,
  freshAgentDecisions,
  applyFreshAgentDecisions,
  freshAgentLines,
  type FreshAgentPorts,
  type FreshAgentCandidateReadings,
} from '../../src/server/entry/registryd.js';
import type { DeskContinuation } from '../../src/server/continue.js';
import { startFreshSession } from '../../src/server/entry/registryd-main.js';
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

const endingFile = (reason: string, detail = '') =>
  JSON.stringify({ reason, actor: 'agent', branch: 'feature/x', detail });

describe('readFreshAgentCandidates', () => {
  it('reads the ending reason off the desk', async () => {
    const deskFile = (worktree: string, name: string) =>
      name === ENDING_FILENAME ? endingFile('corrections-spent') : null;
    const [reading] = await readFreshAgentCandidates([tree()], deskFile, emptyStore);
    expect(reading?.ending).toBe('corrections-spent');
  });

  it('reads null where no ending was written', async () => {
    const [reading] = await readFreshAgentCandidates([tree()], () => null, emptyStore);
    expect(reading?.ending).toBeNull();
  });

  it('reads the corrections file text verbatim', async () => {
    const deskFile = (worktree: string, name: string) =>
      name === CORRECTION_FILENAME ? '## Correction 1 of 2\n\n' : null;
    const [reading] = await readFreshAgentCandidates([tree()], deskFile, emptyStore);
    expect(reading?.correctionsText).toContain('Correction 1 of 2');
  });

  it('a missing corrections file reads as empty text, never a failure', async () => {
    const [reading] = await readFreshAgentCandidates([tree()], () => null, emptyStore);
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
    const [reading] = await readFreshAgentCandidates([tree()], () => null, store);
    expect(reading?.priorFreshSessions).toBe(1);
  });

  it('an unanswerable store reads as zero, never as a session already run', async () => {
    const failedStore: Pick<FreshAgentRecordStore, 'rowsFor'> = {
      rowsFor: async () => ({ ok: false, why: 'failed' }),
    };
    const [reading] = await readFreshAgentCandidates([tree()], () => null, failedStore);
    expect(reading?.priorFreshSessions).toBe(0);
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
          correctionsText: '## Correction 1 of 2\n\n',
          runUrl: 'https://github.com/plot-pm/plot/actions/runs/123',
          conclusion: 'failure',
          priorFreshSessions: 0,
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
          correctionsText: '',
          runUrl: '',
          conclusion: '',
          priorFreshSessions: 1,
        },
      ],
      2,
    );
    expect(decision?.verdict).toBe('needs-a-person');
    expect(decision?.answer).toBe('');
  });

  it('decides none for every other ending', () => {
    const [decision] = freshAgentDecisions(
      [
        {
          plan: PLAN,
          escalated: false,
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'unstarted',
          correctionsText: '',
          runUrl: '',
          conclusion: '',
          priorFreshSessions: 0,
        },
      ],
      2,
    );
    expect(decision?.verdict).toBe('none');
    expect(decision?.answer).toBe('');
  });
});

describe('readFreshAgentCandidates, the declaration and the plan', () => {
  const declared = (status: string) => JSON.stringify({ branch: 'feature/x', status });

  it('reads a blocked declaration as already escalated', async () => {
    const deskFile = (_worktree: string, name: string) =>
      name === DECLARATION_FILENAME ? declared('blocked') : null;
    const [reading] = await readFreshAgentCandidates([tree()], deskFile, emptyStore);
    expect(reading?.escalated).toBe(true);
  });

  it('reads an ok declaration, an absent one and an unreadable one as not escalated', async () => {
    for (const text of [declared('ok'), null, 'not json']) {
      const deskFile = (_worktree: string, name: string) => (name === DECLARATION_FILENAME ? text : null);
      const [reading] = await readFreshAgentCandidates([tree()], deskFile, emptyStore);
      expect(reading?.escalated).toBe(false);
    }
  });

  it('carries the plan the tree names', async () => {
    const [reading] = await readFreshAgentCandidates([tree()], () => null, emptyStore);
    expect(reading?.plan).toBe(PLAN);
  });

  it('reads an empty plan where the tree names none', async () => {
    const [reading] = await readFreshAgentCandidates([tree({ plan: undefined })], () => null, emptyStore);
    expect(reading?.plan).toBe('');
  });
});

const spentReading = (over: Partial<FreshAgentCandidateReadings> = {}): FreshAgentCandidateReadings => ({
  plan: PLAN,
  branch: 'feature/x',
  worktree: '/estate/.worktrees/feature-x',
  ending: 'corrections-spent',
  correctionsText: '## Correction 1 of 2\n\nCI reported: x\n',
  runUrl: 'https://github.com/plot-pm/plot/actions/runs/123',
  conclusion: 'failure',
  priorFreshSessions: 0,
  escalated: false,
  ...over,
});

describe('freshAgentDecisions, escalation', () => {
  it('escalates a second spent budget once and not again after the declaration exists', () => {
    const [first] = freshAgentDecisions([spentReading({ priorFreshSessions: 1 })], 2);
    const [second] = freshAgentDecisions([spentReading({ priorFreshSessions: 1, escalated: true })], 2);
    expect(first?.escalate).toBe(true);
    expect(second?.verdict).toBe('needs-a-person');
    expect(second?.escalate).toBe(false);
  });

  it('never escalates a first spent budget or another ending', () => {
    const decisions = freshAgentDecisions(
      [spentReading(), spentReading({ ending: 'unstarted', priorFreshSessions: 3 })],
      2,
    );
    expect(decisions.map((d) => d.escalate)).toEqual([false, false]);
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
  const sealed: { worktree: string; branch: string; status?: string }[] = [];
  const starts: { branch: string; answer: string }[] = [];
  const ports: FreshAgentPorts = {
    record,
    desk: {
      sealDeclaration: async (worktree, branch, status) => {
        sealed.push({ worktree, branch, status });
        return { ok: true, value: undefined };
      },
    },
    now: () => new Date('2026-10-05T12:00:00.000Z'),
    start: async (input) => {
      starts.push({ branch: input.branch, answer: input.answer });
      return continues(input);
    },
  };
  /** One tick over one desk: read through the real record, decide, apply. */
  const tickOver = async (deskFile: (worktree: string, name: string) => string | null) => {
    const readings = await readFreshAgentCandidates(freshAgentCandidateTrees([tree()]), deskFile, record);
    return applyFreshAgentDecisions(freshAgentDecisions(readings, 2), ports);
  };
  return { record, ports, sealed, starts, tickOver };
};

const spentDesk = (declaration: string | null = null) => (_worktree: string, name: string) => {
  if (name === ENDING_FILENAME) {
    return endingFile(
      'corrections-spent',
      'the build failed on each of 2 corrections; the last was: the run at https://github.com/plot-pm/plot/actions/runs/123 for a1b2c3d concluded failure',
    );
  }
  if (name === CORRECTION_FILENAME) return '## Correction 1 of 2\n\nCI reported: gate\n';
  if (name === DECLARATION_FILENAME) return declaration;
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

  it('starts none on the next tick once the start is recorded, and declares the slice blocked', async () => {
    const { starts, sealed, tickOver } = rig(started);
    await tickOver(spentDesk());
    const second = await tickOver(spentDesk());
    expect(starts).toHaveLength(1);
    expect(second.map((a) => a.outcome)).toEqual(['escalated']);
    expect(sealed).toEqual([
      { worktree: tree().path, branch: 'feature/x', status: 'blocked' },
    ]);
  });

  it('declares blocked once: a desk whose declaration already says blocked is left alone', async () => {
    const { starts, sealed, tickOver } = rig(started);
    await tickOver(spentDesk());
    await tickOver(spentDesk());
    const third = await tickOver(spentDesk(JSON.stringify({ branch: 'feature/x', status: 'blocked' })));
    expect(third).toEqual([]);
    expect(sealed).toHaveLength(1);
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

  it('reports a declaration that could not be written', async () => {
    const { ports, tickOver } = rig(started);
    ports.desk = { sealDeclaration: async () => ({ ok: false, why: 'failed' }) };
    await tickOver(spentDesk());
    expect((await tickOver(spentDesk())).map((a) => a.outcome)).toEqual(['escalation-failed']);
  });

  it('starts nothing for a desk whose ending is not corrections-spent', async () => {
    const { starts, tickOver } = rig(started);
    const applied = await tickOver((_w, name) => (name === ENDING_FILENAME ? endingFile('unstarted') : null));
    expect(applied).toEqual([]);
    expect(starts).toEqual([]);
  });

  it('reports a thrown non-Error by its text', async () => {
    const { tickOver } = rig(async () => {
      throw 'plain string';
    });
    expect((await tickOver(spentDesk()))[0]?.detail).toBe('plain string');
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
