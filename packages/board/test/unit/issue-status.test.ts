// `plot-issue-status.mjs`: the flags it takes and the skip list that keeps a
// shared issue open. A run owing no write resolves no tracker, so nothing
// here reaches `plot-host.sh`.
import { describe, expect, it } from 'vitest';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import type { StatusWrite } from '@plot-pm/domain/ports/tracker';
import { planFrom, wordsFrom, writeStatuses } from '../../src/server/entry/issue-status.js';

describe('the flags an issue-status write takes', () => {
  it('reads the three status words', () => {
    expect(wordsFrom(['--approved', 'Open', '--delivered', 'QA', '--released', 'Done'])).toEqual({
      approved: 'Open',
      delivered: 'QA',
      released: 'Done',
    });
  });

  it('reads zero or more --skip-issue, defaulting to none', () => {
    expect(wordsFrom([])).toEqual({ approved: '', delivered: '', released: '' });
  });

  it('refuses a flag with no value and an unknown flag', () => {
    expect(() => wordsFrom(['--approved'])).toThrow('--approved needs a value');
    expect(() => wordsFrom(['--word', 'x'])).toThrow("unknown argument '--word'");
  });
});

describe('the plan read from stdin', () => {
  it('reads the phase, lowercased, and the issues as strings', () => {
    expect(planFrom('{"phase":"Approved","issues":[7,"#8"]}')).toEqual({ phase: 'approved', issues: ['7', '#8'] });
  });

  it('throws where stdin is not the parser’s JSON', () => {
    expect(() => planFrom('{"phase":"approved"}')).toThrow('no phase or no issues[]');
  });
});

describe('each owed write goes through the tracker port, skip-aware', () => {
  it('prints one line per issue and hands the port the issue and status', async () => {
    const written: StatusWrite[] = [];
    const { lines, outcomes } = await writeStatuses(
      { phase: 'approved', issues: ['7'], words: { approved: 'Open', delivered: '', released: '' } },
      trackerFixture({ written }),
    );
    expect(written).toEqual([{ prUrl: '', issue: '7', status: 'Open' }]);
    expect(lines).toEqual(['7\twritten\tOpen\n']);
    expect(outcomes).toEqual(['written']);
  });

  // #2374 (2): a skip list must reach this write — a shared issue another
  // unfinished plan also names must never be written here, regardless of
  // what the tracker port would have answered.
  it('skips a named issue without asking the tracker, and writes every other one', async () => {
    const written: StatusWrite[] = [];
    const { lines, outcomes } = await writeStatuses(
      { phase: 'released', issues: ['7', '8'], words: { approved: '', delivered: '', released: 'Done' } },
      trackerFixture({ written }),
      new Set(['7']),
    );
    expect(written).toEqual([{ prUrl: '', issue: '8', status: 'Done' }]);
    expect(lines).toEqual(['7\tskipped\tanother plan unfinished\n', '8\twritten\tDone\n']);
    expect(outcomes).toEqual(['skipped', 'written']);
  });

  it('skips every issue where every one is named, asking the tracker nothing', async () => {
    const written: StatusWrite[] = [];
    const { lines, outcomes } = await writeStatuses(
      { phase: 'released', issues: ['7'], words: { approved: '', delivered: '', released: 'Done' } },
      trackerFixture({ written }),
      new Set(['7']),
    );
    expect(written).toEqual([]);
    expect(lines).toEqual(['7\tskipped\tanother plan unfinished\n']);
    expect(outcomes).toEqual(['skipped']);
  });
});
