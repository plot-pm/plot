import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { issueIndexFile } from '../src/adapters/issue-index/issue-index-file.js';
import { ISSUE_WRITE_SPOOL_BYTES, issueWriteSpoolOver } from '../src/adapters/issue-index/issue-write-spool-file.js';
import { handOffIssueWrite } from '../src/adapters/issue-index/hand-off-issue-write.js';
import type { Tracker } from '../src/ports/tracker.js';

const roots: string[] = [];
const scratch = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'plot-issue-spool-')));
  roots.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const write = { connector: 'jira', account: 'jira:abc', number: 'A-1', status: 'Delivered' };

describe('issueWriteSpoolOver', () => {
  it('drains an absent spool as an empty list', async () => {
    const spool = issueWriteSpoolOver(issueIndexFile({ home: scratch() }));
    expect(await spool.drain()).toEqual({ ok: true, value: [] });
  });

  it('drains what was appended, in order, and leaves no file behind', async () => {
    const home = scratch();
    const spool = issueWriteSpoolOver(issueIndexFile({ home }));
    await spool.append(write);
    await spool.append({ ...write, number: 'A-2' });
    const drained = await spool.drain();
    expect(drained.ok && drained.value.map((w) => w.number)).toEqual(['A-1', 'A-2']);
    expect(readdirSync(home)).toEqual([]);
    expect(await spool.drain()).toEqual({ ok: true, value: [] });
  });

  it('drops a line that does not parse', async () => {
    const home = scratch();
    const spool = issueWriteSpoolOver(issueIndexFile({ home }));
    await spool.append(write);
    writeFileSync(join(home, 'issue-writes.jsonl'), 'not json\n{"nope":1}\n', { flag: 'a' });
    const drained = await spool.drain();
    expect(drained.ok && drained.value).toEqual([write]);
  });

  it('refuses an append once the spool reaches its bound', async () => {
    const home = scratch();
    const spool = issueWriteSpoolOver(issueIndexFile({ home }));
    writeFileSync(join(home, 'issue-writes.jsonl'), 'x'.repeat(ISSUE_WRITE_SPOOL_BYTES));
    expect((await spool.append(write)).ok).toBe(false);
  });
});

describe('handOffIssueWrite', () => {
  const trackerOf = (spender: Awaited<ReturnType<Tracker['spender']>>): Pick<Tracker, 'spender'> => ({
    spender: async () => spender,
  });

  it('tags the write with the tracker connector and account', async () => {
    const spool = issueWriteSpoolOver(issueIndexFile({ home: scratch() }));
    const handed = await handOffIssueWrite(
      trackerOf({ ok: true, value: { connector: 'jira', account: 'jira:abc' } }),
      spool,
      { number: 'A-1', status: 'Delivered' },
    );
    expect(handed).toBe(true);
    const drained = await spool.drain();
    expect(drained.ok && drained.value).toEqual([write]);
  });

  it('hands nothing where the tracker cannot name its connector', async () => {
    const home = scratch();
    const spool = issueWriteSpoolOver(issueIndexFile({ home }));
    const handed = await handOffIssueWrite(trackerOf({ ok: false, why: 'failed' }), spool, { number: 'A-1' });
    expect(handed).toBe(false);
    expect(readdirSync(home)).toEqual([]);
  });
});
