import { describe, it, expect } from 'vitest';

import type { RegisteredTreeReadings } from '@plot-pm/domain/rules/unclaimed';
import type { PortResult } from '@plot-pm/domain';
import type { FreshAgentRecord, FreshAgentRecordStore } from '@plot-pm/domain/ports/fresh-agent-record';
import { ENDING_FILENAME } from '@plot-pm/domain/entities/ending';

import {
  freshAgentCandidateTrees,
  runFromEndingDetail,
  readFreshAgentCandidates,
  freshAgentDecisions,
} from '../../src/server/entry/registryd.js';

const tree = (over: Partial<RegisteredTreeReadings> = {}): RegisteredTreeReadings => ({
  path: '/estate/.worktrees/feature-x',
  branch: 'feature/x',
  isMain: false,
  prunable: false,
  registered: false,
  planNamed: true,
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
      failedStep: 'failure',
    });
  });

  it('answers empty strings for a detail that does not hold the sentence', () => {
    expect(runFromEndingDetail('something else entirely')).toEqual({ runUrl: '', failedStep: '' });
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
      rowsFor: async (branch) =>
        answeredRows(
          branch === 'feature/x'
            ? [{ branch, worktree: tree().path, at: '2026-10-05T12:00:00.000Z', runUrl: '' }]
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
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'corrections-spent',
          correctionsText: '## Correction 1 of 2\n\n',
          runUrl: 'https://github.com/plot-pm/plot/actions/runs/123',
          failedStep: 'failure',
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
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'corrections-spent',
          correctionsText: '',
          runUrl: '',
          failedStep: '',
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
          branch: 'feature/x',
          worktree: tree().path,
          ending: 'unstarted',
          correctionsText: '',
          runUrl: '',
          failedStep: '',
          priorFreshSessions: 0,
        },
      ],
      2,
    );
    expect(decision?.verdict).toBe('none');
    expect(decision?.answer).toBe('');
  });
});
