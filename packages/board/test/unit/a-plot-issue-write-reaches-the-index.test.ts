import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import { foldVerification } from '@plot-pm/domain/rules/verification';
import type { IssueWrite } from '@plot-pm/domain';
import type { IssueWriteSpool } from '@plot-pm/domain/ports/issue-write-spool';
import { openRefutedIssues } from '../../src/server/entry/verify.js';
import { writeStatuses } from '../../src/server/entry/issue-status.js';

const spend = { connector: 'jira', account: 'jira:abc' };

/** A spool that keeps what it is handed. */
const memorySpool = (): { spool: IssueWriteSpool; held: IssueWrite[] } => {
  const held: IssueWrite[] = [];
  return {
    held,
    spool: {
      append: async (write) => {
        held.push(write);
        return { ok: true, value: undefined };
      },
      drain: async () => ({ ok: true, value: held.splice(0) }),
    },
  };
};

const reading = { phase: 'delivered', issues: ['A-1'], words: { approved: '', delivered: 'Delivered', released: '' } };

describe('a status write hands its row to the issue index', () => {
  it('hands the issue and the status the tracker took, tagged with its connector', async () => {
    const { spool, held } = memorySpool();
    await writeStatuses(reading, trackerFixture({ spender: spend }), spool);
    expect(held).toEqual([{ ...spend, number: 'A-1', status: 'Delivered' }]);
  });

  it('hands nothing for a write the tracker refused or failed', async () => {
    const { spool, held } = memorySpool();
    await writeStatuses(reading, trackerFixture({ spender: spend, outcome: 'no-target' }), spool);
    await writeStatuses(reading, trackerFixture({ spender: spend, statusWriteFails: true }), spool);
    expect(held).toEqual([]);
  });
});

describe('an opened refuted-claim issue hands its row to the issue index', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const stateFile = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), 'plot-write-through-'));
    roots.push(root);
    return path.join(root, 'verify', 'p.json');
  };
  const verdicts = (() => {
    const fold = foldVerification(['one'], [{ lens: 'a', text: 'Claim-1: refuted\n' }]);
    if (fold.fold !== 'record') throw new Error('expected a record');
    return fold.verdicts;
  })();

  it('hands the new issue with its id and title', async () => {
    const { spool, held } = memorySpool();
    await openRefutedIssues(trackerFixture({ scheme: 'jira', baseUrl: 'https://j.test', spender: spend }), stateFile(), 'p', 'abc1234', verdicts, [], spool);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ ...spend, number: '1', url: 'https://j.test/browse/1' });
    expect(held[0]!.title).toContain('one');
  });

  it('hands nothing where the tracker failed to open it', async () => {
    const { spool, held } = memorySpool();
    await openRefutedIssues(trackerFixture({ scheme: 'jira', spender: spend, issueOpenFails: true }), stateFile(), 'p', 'abc1234', verdicts, [], spool);
    expect(held).toEqual([]);
  });
});
