import { describe, expect, it } from 'vitest';

import { agentLoop, type AgentLoopReadings } from '../src/workflows/agent-loop.js';
import { backgroundDropCorrection } from '../src/rules/background-drop.js';
import type { Write } from '../src/workflows/decision.js';
import { supervise } from '../src/workflows/supervise.js';
import { checksFromRuns } from '../src/rules/checks-verdict.js';
import type { SupervisionReadings } from '../src/rules/supervision.js';
import { deskLifecycle, type DeskReadings as LifecycleDeskReadings } from '../src/rules/desk-lifecycle.js';
import { endingIsAttributable, isDecision, isRefusal } from '../src/transitions/agent.js';
import { readDeclaration } from '../src/entities/declaration.js';
import { performDecision } from '../src/adapters/performer/perform-fs.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRANCH = 'infra/the-loop-has-a-workflow';
const WORKTREE = '/estate/.worktrees/infra-the-loop-has-a-workflow';
const SESSION = 'sess-the-loop-has-a-workflow';

/** A full readings object, idle and free, that every test starts from and overrides. */
const freeLoop: AgentLoopReadings = {
  assignedBranch: '',
  waitedSeconds: 0,
  boundSeconds: 28800,
  registration: 'unset',
  claim: null,
  takeUpRefused: null,
  base: 'origin/main',
  running: null,
  exit: null,
  startRetries: 0,
  maxStartRetries: 2,
  markerWritten: false,
  markerText: '',
  handBack: null,
  checksResumeId: '',
  handBackSummary: '',
  localChecks: null,
  sliceRuns: 0,
  sliceMaxRuns: 12,
  backgroundDropResumed: false,
  sliceCostUsd: null,
  sliceMaxSpendUsd: null,
  resetRefusals: [],
  pushed: false,
  prOpen: false,
  checks: null,
  checksPassed: null,
  tip: 'pushed',
  correctionAttempts: 0,
  correctionBudget: 2,
  pr: null,
  correctionText: '',
  resumeId: '',
  passAt: '2026-10-05T10:00:00.000Z',
  worktree: WORKTREE,
  session: SESSION,
};

const kindsOf = (writes: readonly Write[]) => writes.map((w) => w.kind);

/** The one `loop-end` write a decision carries, or undefined. */
const endWrite = (writes: readonly Write[]) =>
  writes.find((w): w is Extract<Write, { kind: 'loop-end' }> => w.kind === 'loop-end');

/** The one `declaration` write a decision carries, or undefined. */
const declarationWrite = (writes: readonly Write[]) =>
  writes.find((w): w is Extract<Write, { kind: 'declaration' }> => w.kind === 'declaration');

/**
 * The declaration file `supervise` would read after this decision: the
 * `declaration` write `agentLoop` emitted, serialised and read back through
 * `readDeclaration`; `absent` when the decision emitted none.
 */
const declarationReadFrom = (writes: readonly Write[]) => {
  const write = declarationWrite(writes);
  return readDeclaration(
    write === undefined
      ? null
      : JSON.stringify({ branch: write.branch, status: write.status, artifacts: [], pr: null, summary: write.summary }),
  );
};

/** What `supervise` answers for a dead agent whose desk holds what `readings` made `agentLoop` write. */
const superviseAfter = (readings: AgentLoopReadings) =>
  supervise({
    agents: [agentFor(BRANCH, { workerAlive: false, declaration: declarationReadFrom(agentLoop(readings).writes) })],
  });

describe('agentLoop — row 1: no assignment, inside Worker bound', () => {
  it('waits one pass with no writes and no ending', () => {
    const result = agentLoop({ ...freeLoop, waitedSeconds: 100 });
    expect(result.outcome).toBe('decided');
    expect(result.writes).toEqual([]);
    expect(result.detail.exitCode).toBeNull();
  });

  it('supervise has nothing to say about a free loop — not asked, no manifest', () => {
    // No agent entry exists for a free loop with no slice: `supervise` is
    // never called with one, which is itself the `not asked` answer the
    // table names for this row.
    const result = supervise({ agents: [] });
    expect(result.detail.agents).toEqual([]);
  });
});

describe('agentLoop — row 2: no assignment, Worker bound reached', () => {
  it('ends the free wait with no ending reason, exit 124', () => {
    const result = agentLoop({ ...freeLoop, waitedSeconds: 28800, boundSeconds: 28800 });
    expect(result.writes).toEqual([]);
    expect(result.detail.exitCode).toBe(124);
    expect(endWrite(result.writes)).toBeUndefined();
  });
});

describe('agentLoop — row 3: manifest gone (loopRegistration answers gone)', () => {
  it('ends with unregistered, actor agent, exit 124', () => {
    const result = agentLoop({ ...freeLoop, registration: 'gone' });
    const end = endWrite(result.writes);
    expect(end).toBeDefined();
    expect(end?.reason).toBe('unregistered');
    expect(end?.actor).toBe('agent');
    expect(end?.exitCode).toBe(124);
  });

  it('endingIsAttributable accepts actor agent for unregistered', () => {
    expect(
      isDecision(endingIsAttributable(SESSION, { actor: 'agent', reason: 'unregistered' })),
    ).toBe(true);
  });

  it('supervise answers not asked — no manifest exists to read', () => {
    const result = supervise({ agents: [] });
    expect(result.detail.agents).toEqual([]);
  });
});

describe('agentLoop — row 4: an assignment', () => {
  it('resets the desk, commits and pushes the claim, then runs the first prompt — in that order', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, claim: 'absent' });
    expect(result.writes).toEqual([
      { kind: 'desk-reset', worktree: WORKTREE, branch: BRANCH, base: 'origin/main' },
      { kind: 'commit', message: `plot: claim ${BRANCH}`, paths: [] },
      { kind: 'push', branch: BRANCH, onto: '' },
      { kind: 'prompt-run', worktree: WORKTREE, branch: BRANCH },
    ]);
    expect(result.detail.exitCode).toBeNull();
    expect(result.detail.note).toContain('desk reset');
  });

  it('reports the claim read the caller supplied', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, claim: 'absent' });
    expect(result.detail.note).toContain('read: absent');
  });

  it('reports the claim read as unknown when the caller supplied none', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, claim: null });
    expect(result.detail.note).toContain('unknown');
  });

  it('records the branch as refused and clears the assignment when the desk reset was refused', () => {
    // THE JS LOOP'S HELD CHECKOUT: the reset fails most often because another
    // worktree holds the branch, and without the record the queue hands the
    // slice to the next free agent (250 times for one slice, 2026-10-03).
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, takeUpRefused: 'desk-reset', claim: null });
    expect(result.writes).toEqual([
      { kind: 'refused-slice', branch: BRANCH },
      { kind: 'assignment-clear', session: SESSION },
    ]);
    expect(result.detail.exitCode).toBeNull();
  });

  it.each(['commit', 'push'] as const)('clears the assignment and writes nothing else when the %s was refused', (refused) => {
    const claim = refused === 'push' ? 'held-by-agent' : null;
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, takeUpRefused: refused, claim });
    expect(result.writes).toEqual([{ kind: 'assignment-clear', session: SESSION }]);
    expect(result.detail.exitCode).toBeNull();
    expect(result.detail.note).toBe(
      `the ${refused} at take-up was refused, claim: ${claim ?? 'unknown'}; the assignment is cleared`,
    );
  });
});

describe('agentLoop — row 4: a desk holding only an unanswered PLOT-BLOCKED question at take-up', () => {
  const readings: AgentLoopReadings = {
    ...freeLoop,
    assignedBranch: BRANCH,
    resetRefusals: ['blocked-marker'],
    markerText: 'PLOT-BLOCKED: use fetch or axios?',
  };

  it('ends blocked with exactly a declaration and a loop-end: no reset, claim, push or prompt', () => {
    const result = agentLoop(readings);
    expect(kindsOf(result.writes)).toEqual(['declaration', 'loop-end']);
    expect(declarationWrite(result.writes)).toMatchObject({ status: 'blocked', branch: BRANCH });
    expect(declarationWrite(result.writes)?.summary).toContain('fetch or axios');
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('blocked');
    expect(end?.actor).toBe('agent');
    expect(end?.exitCode).toBe(0);
    expect(end?.detail).toContain('not taken up');
  });

  it('names the question generically when the caller read no marker text', () => {
    const result = agentLoop({ ...readings, markerText: '' });
    expect(declarationWrite(result.writes)?.summary).toBe('an unanswered PLOT-BLOCKED question');
  });

  it('supervise answers needs-a-person from the declaration this row writes', () => {
    const result = superviseAfter(readings);
    expect(result.detail.needingAPerson).toEqual([BRANCH]);
  });
});

describe('agentLoop — row 4: a desk holding unlanded work at take-up', () => {
  for (const held of [['uncommitted-changes'], ['unpushed-commits'], ['blocked-marker', 'unpushed-commits']] as const) {
    it(`ends holding-work over ${held.join(' + ')}: no reset, no claim, no prompt, no declaration`, () => {
      const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, resetRefusals: held });
      expect(kindsOf(result.writes)).toEqual(['loop-end']);
      const end = endWrite(result.writes);
      expect(end?.reason).toBe('holding-work');
      expect(end?.actor).toBe('agent');
      expect(end?.exitCode).toBe(0);
      expect(end?.detail).toContain(held[held.length - 1]);
      expect(end?.detail).not.toContain('blocked-marker');
      expect(declarationWrite(result.writes)).toBeUndefined();
    });
  }

  it('names both conditions when the desk holds both', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      resetRefusals: ['uncommitted-changes', 'unpushed-commits'],
    });
    expect(endWrite(result.writes)?.detail).toContain('uncommitted-changes, unpushed-commits');
  });

  it('supervise answers correct — with no declaration, the agent is handed land-your-work', () => {
    const result = superviseAfter({ ...freeLoop, assignedBranch: BRANCH, resetRefusals: ['uncommitted-changes'] });
    expect(result.detail.correcting).toEqual([BRANCH]);
  });
});

describe('agentLoop — row 5: prompt running, idleNow answers idle', () => {
  const readings: AgentLoopReadings = {
    ...freeLoop,
    assignedBranch: BRANCH,
    running: { verdict: 'idle', transcriptReadable: true },
  };

  it('ends with quiet, actor monitor, exit 124, and a worker-finding', () => {
    const result = agentLoop(readings);
    expect(kindsOf(result.writes)).toEqual(['worker-finding', 'loop-end']);
    expect(result.writes[0]).toEqual({
      kind: 'worker-finding',
      worktree: WORKTREE,
      branch: BRANCH,
      finding: 'idle',
      since: '2026-10-05T10:00:00.000Z',
      evidence: 'the watcher reported idle',
    });
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('quiet');
    expect(end?.actor).toBe('monitor');
    expect(end?.exitCode).toBe(124);
  });

  it('supervise answers correct — a live-looking manifest, no declaration, gates fail on a dirty desk', () => {
    const agent = agentFor(BRANCH, { workerAlive: false, declaration: { read: 'absent' } });
    const result = supervise({ agents: [agent] });
    expect(result.detail.correcting).toEqual([BRANCH]);
  });

  it('deskLifecycle re-reads a desk this row leaves clean, with no commit', () => {
    const lifecycle = deskLifecycle(cleanLifecycleDesk());
    expect(lifecycle.state).toBe('working');
    expect(lifecycle.exit.kind).toBe('re-read');
  });

  it('deskLifecycle re-reads the same desk dirty, with a file-changing commit', () => {
    const lifecycle = deskLifecycle(
      cleanLifecycleDesk({ dirtyPath: 'src/x.ts', fileChangingCommits: 1 }),
    );
    expect(lifecycle.state).toBe('holding-work');
    expect(lifecycle.exit.kind).toBe('person');
  });
});

describe('agentLoop — row 6: prompt running, idle reading unavailable past the floor', () => {
  it('ends bound when a transcript could be read', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      running: { verdict: 'silent', transcriptReadable: true },
      waitedSeconds: 28800,
      boundSeconds: 28800,
    });
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('bound');
    expect(end?.actor).toBe('bound');
    expect(end?.exitCode).toBe(124);
  });

  it('ends unreadable when no transcript could be read', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      running: { verdict: 'silent', transcriptReadable: false },
      waitedSeconds: 28800,
      boundSeconds: 28800,
    });
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('unreadable');
    expect(end?.actor).toBe('bound');
    expect(end?.exitCode).toBe(124);
  });

  it('waits while still inside the bound, whatever the transcript readability', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      running: { verdict: 'silent', transcriptReadable: false },
      waitedSeconds: 100,
      boundSeconds: 28800,
    });
    expect(result.writes).toEqual([]);
    expect(result.detail.exitCode).toBeNull();
  });

  it('supervise answers correct on this row too', () => {
    const agent = agentFor(BRANCH, { workerAlive: false, declaration: { read: 'absent' } });
    const result = supervise({ agents: [agent] });
    expect(result.detail.correcting).toEqual([BRANCH]);
  });
});

describe('agentLoop — row 7: prompt exit unstarted', () => {
  it('retries with agent-attempt while under the retry budget', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'unstarted' },
      startRetries: 0,
      maxStartRetries: 2,
    });
    expect(kindsOf(result.writes)).toEqual(['agent-attempt']);
    const attempt = result.writes.find((w) => w.kind === 'agent-attempt');
    expect(attempt).toMatchObject({ attempts: 1 });
    expect(result.detail.exitCode).toBeNull();
  });

  it('blocks once retries are spent: marker, declaration, loop-end unstarted exit 1', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'unstarted' },
      startRetries: 2,
      maxStartRetries: 2,
    });
    expect(kindsOf(result.writes)).toEqual(['blocked-marker', 'declaration', 'loop-end']);
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('unstarted');
    expect(end?.actor).toBe('agent');
    expect(end?.exitCode).toBe(1);
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
  });

  it('endingIsAttributable accepts actor agent for unstarted', () => {
    expect(isDecision(endingIsAttributable(SESSION, { actor: 'agent', reason: 'unstarted' }))).toBe(
      true,
    );
  });

  it('supervise answers needs-a-person from the declaration this row writes', () => {
    const result = superviseAfter({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'unstarted' },
      startRetries: 2,
      maxStartRetries: 2,
    });
    expect(result.detail.needingAPerson).toEqual([BRANCH]);
  });

  it('deskLifecycle reads refused-empty on a fresh desk the marker leaves clean', () => {
    const lifecycle = deskLifecycle(
      cleanLifecycleDesk({ blockedMarker: true, markerRecordsWork: false, fileChangingCommits: 0 }),
    );
    expect(lifecycle.state).toBe('refused-empty');
    expect(lifecycle.exit.kind).toBe('copy-then-reap');
  });

  it('deskLifecycle reads refused-with-work when the desk also holds unlanded work', () => {
    const lifecycle = deskLifecycle(
      cleanLifecycleDesk({
        blockedMarker: true,
        markerRecordsWork: true,
        dirtyPath: 'src/x.ts',
        fileChangingCommits: 1,
      }),
    );
    expect(lifecycle.state).toBe('refused-with-work');
    expect(lifecycle.exit.kind).toBe('person');
  });

  it('the three-count test: a start retry raises attempts and never correctionAttempts', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'unstarted' },
      startRetries: 0,
      maxStartRetries: 2,
      correctionAttempts: 0,
    });
    const attempt = result.writes.find((w) => w.kind === 'agent-attempt');
    expect(attempt).toMatchObject({ attempts: 1 });
    expect(result.writes.some((w) => w.kind === 'correction-count')).toBe(false);
  });
});

describe('agentLoop — row 8: prompt exit wait (a usage limit with a known reset)', () => {
  it('waits until the reset, inside Worker bound, with no writes', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: {
        answer: 'wait',
        reset: { epoch: 1_800_000_000, iso: '2027-01-15T12:00:00.000Z' },
        line: '5-hour limit reached ∙ resets 1pm (America/Chicago)',
      },
    });
    expect(result.writes).toEqual([]);
    expect(result.detail.exitCode).toBeNull();
  });
});

describe('agentLoop — row 9: prompt exit end-limited', () => {
  it('blocks: marker, declaration, loop-end limited exit 1', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'end-limited', line: '5-hour limit reached', cause: 'past-bound' },
    });
    expect(kindsOf(result.writes)).toEqual(['blocked-marker', 'declaration', 'loop-end']);
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('limited');
    expect(end?.actor).toBe('agent');
    expect(end?.exitCode).toBe(1);
  });

  it('endingIsAttributable accepts actor agent for limited', () => {
    expect(isDecision(endingIsAttributable(SESSION, { actor: 'agent', reason: 'limited' }))).toBe(true);
  });

  it('supervise answers needs-a-person from the declaration this row writes', () => {
    const result = superviseAfter({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'end-limited', line: '5-hour limit reached', cause: 'past-bound' },
    });
    expect(result.detail.needingAPerson).toEqual([BRANCH]);
  });

  it('deskLifecycle reads refused-empty on a fresh desk', () => {
    const lifecycle = deskLifecycle(
      cleanLifecycleDesk({ blockedMarker: true, markerRecordsWork: false }),
    );
    expect(lifecycle.state).toBe('refused-empty');
  });
});

describe('agentLoop — row 10: prompt exit ran, the agent wrote a PLOT-BLOCKED marker', () => {
  it('declares blocked and ends blocked, exit 0, no marker write (the agent already wrote one)', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      markerWritten: true,
      markerText: 'PLOT-BLOCKED: use fetch or axios?',
    });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'loop-end']);
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('blocked');
    expect(end?.actor).toBe('agent');
    expect(end?.exitCode).toBe(0);
    expect(declarationWrite(result.writes)?.summary).toContain('fetch or axios');
  });

  it('endingIsAttributable accepts actor agent for blocked', () => {
    expect(isDecision(endingIsAttributable(SESSION, { actor: 'agent', reason: 'blocked' }))).toBe(true);
  });

  it('supervise answers needs-a-person straight from the declaration this row writes, before any gate runs', () => {
    const result = superviseAfter({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      markerWritten: true,
      markerText: 'PLOT-BLOCKED: use fetch or axios?',
    });
    expect(result.detail.needingAPerson).toEqual([BRANCH]);
  });

  it('deskLifecycle reads refused-with-work for a marker on a desk with real commits', () => {
    const lifecycle = deskLifecycle(
      cleanLifecycleDesk({ blockedMarker: true, markerRecordsWork: true, fileChangingCommits: 2 }),
    );
    expect(lifecycle.state).toBe('refused-with-work');
  });
});

describe('agentLoop — row 10c: the turn ended with its background work dropped', () => {
  const LINE = 'Background tasks still running after 600s; terminating.';
  const dropped = { ...freeLoop, assignedBranch: BRANCH, exit: { answer: 'dropped' as const, line: LINE }, resumeId: 'sess-7' };

  it('the first time, resumes the session once with the correction that names the line', () => {
    const result = agentLoop(dropped);
    expect(kindsOf(result.writes)).toEqual(['agent-resume']);
    const resume = result.writes[0] as Extract<Write, { kind: 'agent-resume' }>;
    expect(resume.resumeId).toBe('sess-7');
    expect(resume.correction).toBe(backgroundDropCorrection(LINE));
    expect(result.detail.exitCode).toBeNull();
  });

  it('the second time, ends blocked with a marker naming the line and a blocked declaration', () => {
    const result = agentLoop({ ...dropped, backgroundDropResumed: true });
    expect(kindsOf(result.writes)).toEqual(['blocked-marker', 'declaration', 'loop-end']);
    const marker = result.writes[0] as Extract<Write, { kind: 'blocked-marker' }>;
    expect(marker.question).toMatch(/^PLOT-BLOCKED: /);
    expect(marker.question).toContain(LINE);
    expect(endWrite(result.writes)?.reason).toBe('blocked');
    expect(endWrite(result.writes)?.exitCode).toBe(0);
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
  });

  it('at Slice max runs, starts no resume and ends run-limit', () => {
    const result = agentLoop({ ...dropped, sliceRuns: 12, sliceMaxRuns: 12 });
    expect(endWrite(result.writes)?.reason).toBe('run-limit');
    expect(kindsOf(result.writes)).not.toContain('agent-resume');
  });

  it('at Slice max spend, starts no resume and ends spend-limit', () => {
    const result = agentLoop({ ...dropped, sliceCostUsd: 5, sliceMaxSpendUsd: 5 });
    expect(endWrite(result.writes)?.reason).toBe('spend-limit');
    expect(kindsOf(result.writes)).not.toContain('agent-resume');
  });

  it('a marker the agent wrote answers before the drop does', () => {
    const result = agentLoop({ ...dropped, markerWritten: true, markerText: 'PLOT-BLOCKED: which API?' });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'loop-end']);
    expect(endWrite(result.writes)?.reason).toBe('blocked');
  });
});

describe('agentLoop — row 11: prompt exit ran, no marker, resetRefusals names unlanded work', () => {
  it('ends holding-work, exit 0, with NO declaration', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      markerWritten: false,
      resetRefusals: ['uncommitted-changes'],
    });
    expect(kindsOf(result.writes)).toEqual(['loop-end']);
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('holding-work');
    expect(end?.actor).toBe('agent');
    expect(end?.exitCode).toBe(0);
    expect(declarationWrite(result.writes)).toBeUndefined();
  });

  it('also ends holding-work for unpushed-commits', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      resetRefusals: ['unpushed-commits'],
    });
    expect(endWrite(result.writes)?.reason).toBe('holding-work');
  });

  it('endingIsAttributable accepts actor agent for holding-work', () => {
    expect(isDecision(endingIsAttributable(SESSION, { actor: 'agent', reason: 'holding-work' }))).toBe(
      true,
    );
  });

  it('supervise answers correct — with no declaration, the agent is handed land-your-work', () => {
    const agent = agentFor(BRANCH, { workerAlive: false, declaration: { read: 'absent' } });
    const result = supervise({ agents: [agent] });
    expect(result.detail.correcting).toEqual([BRANCH]);
  });

  it('the spent-budget desk: after a pushed correction, markerRecordsWork holds so it is never reaped as empty', () => {
    // A desk with a real file-changing commit (the correction's own work) is
    // never read as refused-empty even where a marker also sits on it.
    const lifecycle = deskLifecycle(
      cleanLifecycleDesk({ blockedMarker: true, markerRecordsWork: true, fileChangingCommits: 1 }),
    );
    expect(lifecycle.state).toBe('refused-with-work');
    expect(lifecycle.state).not.toBe('refused-empty');
  });
});

describe('agentLoop — row 12: prompt exit ran, work pushed, a PR open', () => {
  it('waits for checks, with no writes', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: null,
    });
    expect(result.writes).toEqual([]);
    expect(result.detail.exitCode).toBeNull();
  });
});

describe('agentLoop — row 12a: prompt exit ran, nothing pushed or no PR open', () => {
  it('seals and frees the slice with no checks wait when nothing was pushed', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, exit: { answer: 'ran' }, pushed: false, prOpen: false });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'slice-spend', 'assignment-clear']);
    expect(declarationWrite(result.writes)?.status).toBe('ok');
    expect(endWrite(result.writes)).toBeUndefined();
    expect(result.detail.note).toBe('nothing pushed, no checks wait');
  });

  it('seals and frees the slice with no checks wait when no PR is open', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, exit: { answer: 'ran' }, pushed: true, prOpen: false });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'slice-spend', 'assignment-clear']);
    expect(result.detail.note).toBe('no PR open, no checks wait');
  });

  it('still ends holding-work first when the desk holds unlanded work', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      resetRefusals: ['unpushed-commits'],
    });
    expect(endWrite(result.writes)?.reason).toBe('holding-work');
  });
});

describe('agentLoop — row 12a applies before the CI wait only', () => {
  it('a moved tip mid-wait ends checks-unanswered with a blocked declaration, though pushed now reads false', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: false,
      prOpen: true,
      checks: 'tip-moved',
      tip: 'other',
    });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'loop-end']);
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
    expect(endWrite(result.writes)?.reason).toBe('checks-unanswered');
    expect(endWrite(result.writes)?.detail).toMatch(/^tip-moved: /);
  });

  it('an unreadable tip mid-wait keeps waiting, though pushed reads false', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: false,
      prOpen: true,
      checks: 'wait',
      tip: 'unknown',
    });
    expect(result.writes).toEqual([]);
    expect(result.detail.exitCode).toBeNull();
  });

  it('a settled failing build never seals ok, though the PR now reads closed', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: false,
      checks: 'settled',
      checksPassed: false,
      correctionAttempts: 2,
      correctionBudget: 2,
      pr: 1279,
    });
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
    expect(endWrite(result.writes)?.reason).toBe('corrections-spent');
    expect(kindsOf(result.writes)).not.toContain('assignment-clear');
  });
});

describe('agentLoop — row 12b: Checks wait disables the wait', () => {
  it('seals and frees the slice when checksFromRuns answers none', () => {
    const checks = checksFromRuns({ pushedSha: 'f743e573', run: null, tip: 'pushed', waitedSeconds: 0, boundSeconds: 0 });
    expect(checks).toBe('none');
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, exit: { answer: 'ran' }, pushed: true, prOpen: true, checks });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'slice-spend', 'assignment-clear']);
    expect(result.detail.note).toBe('the checks wait is disabled');
  });
});

describe('agentLoop — row 13: checks pass', () => {
  it('declares ok, records slice-spend, clears the assignment, then free', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: true,
    });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'slice-spend', 'assignment-clear']);
    expect(declarationWrite(result.writes)?.status).toBe('ok');
    expect(result.detail.exitCode).toBeNull();
    expect(endWrite(result.writes)).toBeUndefined();
  });

  it('supervise answers leave or reap depending on the manifest the free pass leaves behind — leave while a worker is alive', () => {
    const agent = agentFor(BRANCH, { workerAlive: true });
    const result = supervise({ agents: [agent] });
    expect(result.detail.left).toEqual([BRANCH]);
  });
});

describe('agentLoop — row 14: checks fail, correction budget left', () => {
  it('hands a correction and raises correctionAttempts, never attempts', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: false,
      correctionAttempts: 0,
      correctionBudget: 2,
      correctionText: 'the build failed: TypeError in src/x.ts',
      resumeId: 'resume-abc',
    });
    expect(kindsOf(result.writes)).toEqual(['agent-resume', 'correction-count']);
    const resume = result.writes.find((w) => w.kind === 'agent-resume');
    expect(resume).toMatchObject({ resumeId: 'resume-abc', correction: 'the build failed: TypeError in src/x.ts' });
    const count = result.writes.find((w) => w.kind === 'correction-count');
    expect(count).toMatchObject({ correctionAttempts: 1 });
    expect(result.detail.exitCode).toBeNull();
    expect(endWrite(result.writes)).toBeUndefined();
  });

  it('the three-count test: a correction raises correctionAttempts and never attempts', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: false,
      correctionAttempts: 0,
      correctionBudget: 2,
    });
    expect(result.writes.some((w) => w.kind === 'agent-attempt')).toBe(false);
    const count = result.writes.find((w) => w.kind === 'correction-count');
    expect(count).toMatchObject({ correctionAttempts: 1 });
  });
});

describe('agentLoop — row 15: checks fail, budget spent', () => {
  it('ends corrections-spent, exit 0, with a marker naming the PR and corrections', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: false,
      correctionAttempts: 2,
      correctionBudget: 2,
      pr: 1249,
    });
    expect(kindsOf(result.writes)).toEqual(['blocked-marker', 'declaration', 'loop-end']);
    const marker = result.writes.find((w) => w.kind === 'blocked-marker');
    expect(marker && 'question' in marker ? marker.question : '').toContain('#1249');
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('corrections-spent');
    expect(end?.actor).toBe('agent');
    expect(end?.exitCode).toBe(0);
  });

  it('names "its PR" rather than a number when the caller named none', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: false,
      correctionAttempts: 2,
      correctionBudget: 2,
      pr: null,
    });
    const marker = result.writes.find((w) => w.kind === 'blocked-marker');
    expect(marker && 'question' in marker ? marker.question : '').toContain('its PR');
  });

  it('supervise answers needs-a-person from the declaration this row writes', () => {
    const result = superviseAfter({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: false,
      correctionAttempts: 2,
      correctionBudget: 2,
    });
    expect(result.detail.needingAPerson).toEqual([BRANCH]);
  });

  it('deskLifecycle reads refused-with-work: the corrections left real commits behind', () => {
    const lifecycle = deskLifecycle(
      cleanLifecycleDesk({ blockedMarker: true, markerRecordsWork: true, fileChangingCommits: 3 }),
    );
    expect(lifecycle.state).toBe('refused-with-work');
  });
});

describe('agentLoop — row 16: no check answer by Checks wait', () => {
  it('ends checks-unanswered, detail no-answer, exit 0', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'no-answer',
      tip: 'pushed',
    });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'loop-end']);
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('checks-unanswered');
    expect(end?.detail).toBe('no-answer');
    expect(end?.actor).toBe('agent');
    expect(end?.exitCode).toBe(0);
  });

  it('endingIsAttributable accepts actor agent for checks-unanswered', () => {
    expect(
      isDecision(endingIsAttributable(SESSION, { actor: 'agent', reason: 'checks-unanswered' })),
    ).toBe(true);
  });

  it('supervise answers needs-a-person from the declaration this row writes', () => {
    const result = superviseAfter({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'no-answer',
    });
    expect(result.detail.needingAPerson).toEqual([BRANCH]);
  });
});

describe('agentLoop — row 17: the remote tip is no longer the pushed commit', () => {
  it('ends checks-unanswered, detail tip-moved, exit 0, even with a green run for the new tip', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'tip-moved',
      tip: 'other',
    });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'loop-end']);
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('checks-unanswered');
    expect(end?.detail).toMatch(/^tip-moved: /);
    expect(end?.detail).toContain(BRANCH);
    expect(end?.actor).toBe('agent');
    expect(end?.exitCode).toBe(0);
  });

  it('ends tip-moved even deep inside the bound — the tip reading overrides the wait', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'tip-moved',
      tip: 'other',
      waitedSeconds: 1,
      boundSeconds: 3600,
    });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'loop-end']);
    expect(endWrite(result.writes)?.detail).toMatch(/^tip-moved: /);
  });

  it('supervise answers needs-a-person from the declaration this row writes', () => {
    const result = superviseAfter({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'tip-moved',
      tip: 'other',
    });
    expect(result.detail.needingAPerson).toEqual([BRANCH]);
  });
});

describe('agentLoop — row 18: the remote tip cannot be read', () => {
  it('keeps waiting, inside Checks wait, with no writes', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'wait',
      tip: 'unknown',
    });
    expect(result.writes).toEqual([]);
    expect(result.detail.exitCode).toBeNull();
  });

  it('an unknown tip at Checks wait ends no-answer, never tip-moved', () => {
    const checks = checksFromRuns({
      pushedSha: 'f743e573',
      run: null,
      tip: 'unknown',
      waitedSeconds: 3600,
      boundSeconds: 3600,
    });
    expect(checks).toBe('no-answer');
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks,
      tip: 'unknown',
    });
    expect(endWrite(result.writes)?.detail).toBe('no-answer');
  });
});

describe('failures 1 to 4 as table cases', () => {
  it('failure 1: a desk holding 14 uncommitted files ends holding-work rather than cutting a new desk', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      resetRefusals: ['uncommitted-changes'],
    });
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('holding-work');
    // The row never reads an assignment-clear: the desk stays with its slice.
    expect(result.writes.some((w) => w.kind === 'assignment-clear')).toBe(false);
  });

  it('failure 2: a continued agent with no BuildMonitor reads the build connector directly and settles on a real answer', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: false,
      correctionAttempts: 0,
      correctionBudget: 2,
    });
    // Unlike the shell's 1,800 s expiry with "no CI answer" while CI had
    // failed, the pass settles on the connector's own answer and corrects.
    expect(kindsOf(result.writes)).toEqual(['agent-resume', 'correction-count']);
  });

  it('failure 3: the run after a correction is read on the very next settled pass', () => {
    const corrected = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: true,
      correctionAttempts: 1,
      correctionBudget: 2,
    });
    expect(declarationWrite(corrected.writes)?.status).toBe('ok');
  });

  it('failure 4: a PLOT-BLOCKED marker ends exit 0, which the dispatch wrapper reads as clear rather than gone', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      markerWritten: true,
      markerText: 'PLOT-BLOCKED: which approach?',
    });
    expect(endWrite(result.writes)?.exitCode).toBe(0);
  });
});

describe('agentLoop carries no state between passes', () => {
  it('no write it returns ever names a loop state field', () => {
    const allWrites: Write[] = [
      ...agentLoop({ ...freeLoop, assignedBranch: BRANCH, claim: 'absent' }).writes,
      ...agentLoop({
        ...freeLoop,
        assignedBranch: BRANCH,
        exit: { answer: 'ran' },
        markerWritten: true,
        markerText: 'x',
      }).writes,
      ...agentLoop({
        ...freeLoop,
        assignedBranch: BRANCH,
        exit: { answer: 'ran' },
        pushed: true,
        prOpen: true,
        checks: 'settled',
        checksPassed: true,
      }).writes,
    ];
    for (const write of allWrites) {
      expect(Object.keys(write)).not.toContain('loopState');
      expect(Object.keys(write)).not.toContain('state');
    }
  });

  it('is a pure function: the same readings produce the same decision every time', () => {
    const readings: AgentLoopReadings = {
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: false,
      correctionAttempts: 0,
      correctionBudget: 2,
    };
    expect(agentLoop(readings)).toEqual(agentLoop(readings));
  });
});

describe('agentLoop — the hand-back rows', () => {
  const ran = { ...freeLoop, assignedBranch: BRANCH, exit: { answer: 'ran' } } as const;

  it('next: checks with no local-checks answer yet emits a checks write with no loop-end', () => {
    const result = agentLoop({
      ...ran,
      handBack: 'checks',
      checksResumeId: 'sess-123',
      handBackSummary: 'implemented the port',
      resetRefusals: ['unpushed-commits'],
    });
    expect(result.writes).toEqual([
      {
        kind: 'checks',
        branch: BRANCH,
        worktree: WORKTREE,
        resumeId: 'sess-123',
        summary: 'implemented the port',
      },
    ]);
    expect(endWrite(result.writes)).toBeUndefined();
  });

  it('next: checks with passing local checks resumes the session with the one pass line', () => {
    const result = agentLoop({
      ...ran,
      handBack: 'checks',
      checksResumeId: 'sess-123',
      handBackSummary: 'implemented the port',
      localChecks: { passed: true },
    });
    expect(result.writes).toEqual([
      {
        kind: 'agent-resume',
        branch: BRANCH,
        worktree: WORKTREE,
        resumeId: 'sess-123',
        correction: 'local checks passed: implemented the port',
      },
    ]);
  });

  it('next: checks with a failing local check resumes with the failing command and its tail', () => {
    const result = agentLoop({
      ...ran,
      handBack: 'checks',
      checksResumeId: 'sess-123',
      handBackSummary: 'implemented the port',
      localChecks: {
        passed: false,
        command: 'pnpm --filter @plot-pm/domain exec tsc --noEmit -p .',
        tail: "src/x.ts(3,1): error TS2304: Cannot find name 'y'.",
      },
    });
    expect(result.writes).toHaveLength(1);
    const resume = result.writes[0];
    expect(resume?.kind).toBe('agent-resume');
    if (resume?.kind !== 'agent-resume') return;
    expect(resume.resumeId).toBe('sess-123');
    expect(resume.correction).toContain('pnpm --filter @plot-pm/domain exec tsc --noEmit -p .');
    expect(resume.correction).toContain("error TS2304: Cannot find name 'y'.");
    expect(resume.correction).not.toContain('passed');
  });

  it('next: checks at Slice max runs starts no resume and ends run-limit with a blocked declaration', () => {
    const result = agentLoop({
      ...ran,
      handBack: 'checks',
      checksResumeId: 'sess-123',
      localChecks: { passed: true },
      sliceRuns: 12,
      sliceMaxRuns: 12,
    });
    expect(result.writes.some((w) => w.kind === 'agent-resume')).toBe(false);
    expect(endWrite(result.writes)?.reason).toBe('run-limit');
    expect(endWrite(result.writes)?.actor).toBe('agent');
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
  });

  it('next: checks at Slice max spend starts no resume and ends spend-limit with a blocked declaration', () => {
    const result = agentLoop({
      ...ran,
      handBack: 'checks',
      checksResumeId: 'sess-123',
      localChecks: { passed: true },
      sliceCostUsd: 5,
      sliceMaxSpendUsd: 5,
    });
    expect(result.writes.some((w) => w.kind === 'agent-resume')).toBe(false);
    expect(endWrite(result.writes)?.reason).toBe('spend-limit');
    expect(endWrite(result.writes)?.actor).toBe('agent');
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
  });

  it('next: checks with uncommitted changes ends holding-work rather than running the checks', () => {
    const result = agentLoop({ ...ran, handBack: 'checks', resetRefusals: ['uncommitted-changes'] });
    expect(endWrite(result.writes)?.reason).toBe('holding-work');
    expect(result.writes.some((w) => w.kind === 'checks')).toBe(false);
  });

  it('a PLOT-BLOCKED marker outranks a checks hand-back', () => {
    const result = agentLoop({ ...ran, handBack: 'checks', markerWritten: true, markerText: 'which schema?' });
    expect(endWrite(result.writes)?.reason).toBe('blocked');
    expect(declarationWrite(result.writes)?.summary).toBe('which schema?');
  });

  it('next: blocked ends blocked with a declaration carrying the summary', () => {
    const result = agentLoop({
      ...ran,
      handBack: 'blocked',
      handBackSummary: 'need a person to decide the migration approach',
    });
    const end = endWrite(result.writes);
    expect(end?.reason).toBe('blocked');
    expect(end?.actor).toBe('agent');
    expect(declarationWrite(result.writes)).toMatchObject({
      status: 'blocked',
      summary: 'need a person to decide the migration approach',
    });
  });

  it('next: blocked with an empty summary declares a fallback summary, never an empty one', () => {
    const result = agentLoop({ ...ran, handBack: 'blocked', handBackSummary: '' });
    expect(declarationWrite(result.writes)?.summary).toBe('the agent handed back blocked');
  });

  it('a PLOT-BLOCKED marker outranks a pushed hand-back', () => {
    const result = agentLoop({
      ...ran,
      handBack: 'pushed',
      markerWritten: true,
      markerText: 'which schema?',
      pushed: true,
      prOpen: true,
    });
    expect(endWrite(result.writes)?.reason).toBe('blocked');
  });

  it('unlanded work outranks a pushed hand-back', () => {
    const result = agentLoop({
      ...ran,
      handBack: 'pushed',
      resetRefusals: ['uncommitted-changes'],
      pushed: true,
      prOpen: true,
    });
    expect(endWrite(result.writes)?.reason).toBe('holding-work');
  });

  it('a pushed hand-back whose push did not happen reads the nothing-pushed row', () => {
    const result = agentLoop({ ...ran, handBack: 'pushed', pushed: false, prOpen: false });
    expect(result.detail.note).toBe('nothing pushed, no checks wait');
  });

  it('next: pushed with the push on the remote and a PR open waits for CI', () => {
    const result = agentLoop({ ...ran, handBack: 'pushed', pushed: true, prOpen: true, checks: null });
    expect(result.detail.note).toBe('waiting for checks');
    expect(result.writes).toEqual([]);
  });

  it('next: pushed seals on a settled pass, same as the existing CI wait', () => {
    const result = agentLoop({
      ...ran,
      handBack: 'pushed',
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: true,
    });
    expect(declarationWrite(result.writes)?.status).toBe('ok');
  });

  it('next: done falls through unchanged to the marker row, same as no hand-back', () => {
    const withDone = agentLoop({ ...ran, handBack: 'done', markerWritten: true, markerText: 'x' });
    const withNull = agentLoop({ ...ran, handBack: null, markerWritten: true, markerText: 'x' });
    expect(withDone).toEqual(withNull);
  });

  it('a null hand-back (no structured_output) reads the desk, same as today', () => {
    const result = agentLoop({
      ...ran,
      handBack: null,
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: true,
    });
    expect(declarationWrite(result.writes)?.status).toBe('ok');
  });

  it('a checks hand-back with a limit exit answers the limit, never the hand-back', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'end-limited', line: 'limit', cause: 'no-reset' },
      handBack: 'checks',
      checksResumeId: 'sess-123',
    });
    expect(endWrite(result.writes)?.reason).toBe('limited');
    expect(result.writes.some((w) => w.kind === 'checks')).toBe(false);
  });

  it('a pushed hand-back with a limit exit also answers the limit', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'end-limited', line: 'limit', cause: 'past-bound' },
      handBack: 'pushed',
    });
    expect(endWrite(result.writes)?.reason).toBe('limited');
  });
});

describe('agentLoop — Slice max runs', () => {
  it('at take-up, a slice at its run limit starts no run and ends run-limit with a blocked declaration', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, sliceRuns: 12, sliceMaxRuns: 12 });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'loop-end']);
    expect(result.writes.some((w) => w.kind === 'prompt-run')).toBe(false);
    expect(endWrite(result.writes)?.reason).toBe('run-limit');
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
  });

  it('below the limit, take-up starts the run', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, sliceRuns: 11, sliceMaxRuns: 12 });
    expect(result.writes.some((w) => w.kind === 'prompt-run')).toBe(true);
  });

  it('a failed CI build with correction budget left starts no correction run at the limit', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: false,
      correctionAttempts: 0,
      correctionBudget: 2,
      sliceRuns: 12,
      sliceMaxRuns: 12,
    });
    expect(result.writes.some((w) => w.kind === 'agent-resume')).toBe(false);
    expect(endWrite(result.writes)?.reason).toBe('run-limit');
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
  });
});

describe('agentLoop — Slice max spend', () => {
  it('at take-up, a slice at its spend limit starts no run and ends spend-limit with a blocked declaration', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, sliceCostUsd: 5, sliceMaxSpendUsd: 5 });
    expect(kindsOf(result.writes)).toEqual(['declaration', 'loop-end']);
    expect(result.writes.some((w) => w.kind === 'prompt-run')).toBe(false);
    expect(endWrite(result.writes)?.reason).toBe('spend-limit');
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
  });

  it('below the limit, take-up starts the run', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, sliceCostUsd: 4, sliceMaxSpendUsd: 5 });
    expect(result.writes.some((w) => w.kind === 'prompt-run')).toBe(true);
  });

  it('with no Slice max spend configured, an unmeasured or costly slice still starts its run', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, sliceCostUsd: 1000, sliceMaxSpendUsd: null });
    expect(result.writes.some((w) => w.kind === 'prompt-run')).toBe(true);
  });

  it('a failed CI build with correction budget left starts no correction run at the spend limit', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: true,
      checks: 'settled',
      checksPassed: false,
      correctionAttempts: 0,
      correctionBudget: 2,
      sliceCostUsd: 5,
      sliceMaxSpendUsd: 5,
    });
    expect(result.writes.some((w) => w.kind === 'agent-resume')).toBe(false);
    expect(endWrite(result.writes)?.reason).toBe('spend-limit');
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
  });
});

describe('agentLoop — the ends only an SDK run reports', () => {
  it('a bound abort ends bound, attributed to the bound, with a gone finding', () => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, exit: { answer: 'bound' } });
    expect(endWrite(result.writes)).toMatchObject({ reason: 'bound', actor: 'bound', exitCode: 124 });
    expect(result.writes.some((w) => w.kind === 'worker-finding')).toBe(true);
  });

  it.each([
    ['turn-limit' as const],
    ['spend-limit' as const],
  ])('%s ends with that reason and a blocked declaration', (answer) => {
    const result = agentLoop({ ...freeLoop, assignedBranch: BRANCH, exit: { answer }, handBack: 'pushed' });
    expect(endWrite(result.writes)).toMatchObject({ reason: answer, actor: 'agent' });
    expect(declarationWrite(result.writes)?.status).toBe('blocked');
    expect(isDecision(endingIsAttributable(SESSION, { actor: 'agent', reason: answer }))).toBe(true);
  });
});

describe("endingIsAttributable still refuses the watcher's own reasons for actor agent", () => {
  it('refuses bound, quiet, unreadable and spent', () => {
    for (const reason of ['bound', 'quiet', 'unreadable', 'spent']) {
      const result = endingIsAttributable(SESSION, { actor: 'agent', reason });
      expect(isRefusal(result)).toBe(true);
    }
  });
});

describe('perform-fs: readDeclaration round-trips what agentLoop writes', () => {
  it('parses the summary agentLoop puts into a declaration write as a believable blocked declaration', () => {
    const result = agentLoop({
      ...freeLoop,
      assignedBranch: BRANCH,
      exit: { answer: 'ran' },
      markerWritten: true,
      markerText: 'PLOT-BLOCKED: which approach?',
    });
    const write = declarationWrite(result.writes);
    expect(write).toBeDefined();
    if (!write) return;
    const text = JSON.stringify({
      branch: write.branch,
      status: write.status,
      artifacts: [],
      pr: null,
      summary: write.summary,
    });
    const reading = readDeclaration(text);
    expect(reading.read).toBe('declared');
    if (reading.read !== 'declared') return;
    expect(reading.declaration.status).toBe('blocked');
  });
});

describe('perform-fs skips every write kind agentLoop can emit, and still throws on an unnamed kind', () => {
  it('skips desk-reset, assignment-clear, prompt-run, correction-count, declaration, slice-spend, loop-end, worker-finding, build-finding', () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-agent-loop-perform-'));
    try {
      const writes: Write[] = [
        { kind: 'desk-reset', worktree: WORKTREE, branch: BRANCH, base: 'origin/main' },
        { kind: 'assignment-clear', session: SESSION },
        { kind: 'prompt-run', worktree: WORKTREE, branch: BRANCH },
        { kind: 'correction-count', worktree: WORKTREE, correctionAttempts: 1 },
        { kind: 'declaration', worktree: WORKTREE, branch: BRANCH, status: 'ok', summary: '' },
        { kind: 'slice-spend', branch: BRANCH, worktree: WORKTREE },
        {
          kind: 'loop-end',
          worktree: WORKTREE,
          branch: BRANCH,
          reason: 'blocked',
          actor: 'agent',
          detail: 'x',
          exitCode: 0,
        },
        { kind: 'worker-finding', worktree: WORKTREE, branch: BRANCH, finding: 'idle', since: '', evidence: '' },
        {
          kind: 'build-finding',
          worktree: WORKTREE,
          branch: BRANCH,
          finding: 'build failed',
          evidence: 'the run at https://x concluded failure for f743e57',
        },
      ];
      const report = performDecision({ root }, { outcome: 'decided', workflow: 'agent-loop', writes, detail: null });
      expect(report.written).toEqual([]);
      expect(report.skipped).toEqual(writes.map((w) => w.kind));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still throws on a kind neither performed nor skipped', () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-agent-loop-perform-'));
    try {
      const writes = [{ kind: 'not-a-real-kind' } as unknown as Write];
      expect(() =>
        performDecision({ root }, { outcome: 'decided', workflow: 'agent-loop', writes, detail: null }),
      ).toThrow(/unrecognised write kind/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// --- fixtures -------------------------------------------------------------

/** An agent reading, idle and finished, for `supervise` fixtures. */
const agentFor = (branch: string, over: Partial<SupervisionReadings> = {}): SupervisionReadings => ({
  branch,
  worktree: WORKTREE,
  session: SESSION,
  workerAlive: false,
  declaration: { read: 'absent' },
  desk: {
    branch,
    merge: 'not-asked',
    changesets: [],
    workspacePackages: ['plot', '@plot-pm/board', '@plot-pm/domain'],
    dirtyPath: '',
    blockedMarker: '',
    planLine: null,
  },
  resume: { resumeId: `session-${branch}`, transcriptFound: true },
  attempts: 0,
  madeProgress: true,
  headroom: 'clear',
  ...over,
});

/** A clean, claimed, unmarked lifecycle desk, overridden per test. */
const cleanLifecycleDesk = (over: Partial<LifecycleDeskReadings> = {}): LifecycleDeskReadings => ({
  workerPid: null,
  dirtyPath: '',
  blockedMarker: false,
  merge: 'not-merged',
  unpushed: [],
  fileChangingCommits: 0,
  claimRef: true,
  markerRecordsWork: false,
  manifestKnown: true,
  ...over,
});
