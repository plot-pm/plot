import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueIndexFile, issueWriteSpoolOver } from '@plot-pm/domain/adapters';
import { ISSUE_INDEX_VERSION, type IssueIndex } from '@plot-pm/domain';

import {
  drainIssueWrites,
  fleetIssues,
  issueIndexBusy,
  fleetIssueWrites,
  freshIssueState,
  type IssueWorld,
} from '../../src/shared/issue-refresh.js';
import { fleetDivisors } from '../../src/shared/fleet-clock.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmTree(dir);
});

const held: IssueIndex = {
  v: ISSUE_INDEX_VERSION,
  source: 'tracker',
  connector: 'jira',
  account: 'jira:abc',
  requests: 3,
  nextAt: 1_800_000_120_000,
  backoffUntil: null,
  at: '2026-10-13T10:00:00.000Z',
  answer: 'answered',
  rows: [{ number: 'A-1', title: 'one', url: 'u', status: 'To Do', statusCategory: 'To Do', updatedAt: '2026-10-13T09:00:00Z' }],
  complete: true,
  fullReadAt: '2026-10-13T08:00:00.000Z',
  passesSinceFull: 2,
};

const world = (): IssueWorld => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-issue-write-through-'));
  dirs.push(home);
  const issueStore = issueIndexFile({ home });
  return {
    context: { repoRoot: home, scriptDir: home },
    declaredTracker: 'jira',
    gitHost: 'github',
    issueStore,
    issueWrites: issueWriteSpoolOver(issueStore),
    prBackoff: () => ({ connector: null, account: null, until: null }),
  };
};

describe('the issue write-through', () => {
  it('folds a spooled status write into the held index without moving the read cadence', async () => {
    const w = world();
    await w.issueStore.write(held);
    await w.issueWrites!.append({ connector: 'jira', account: 'jira:abc', number: 'A-1', status: 'Delivered', statusCategory: 'Done' });
    expect(await drainIssueWrites(w)).toBe(1);
    const read = await w.issueStore.read();
    const after = read.ok ? read.value : null;
    expect(after).toMatchObject({ at: held.at, nextAt: held.nextAt, backoffUntil: null, requests: 4, rows: [] });
    expect(after?.closed).toBeUndefined();
  });

  it('writes no index where none is held, and still empties the spool', async () => {
    const w = world();
    await w.issueWrites!.append({ connector: 'jira', account: 'jira:abc', number: 'A-1', title: 't', url: 'u' });
    expect(await drainIssueWrites(w)).toBe(1);
    expect(await w.issueStore.read()).toEqual({ ok: true, value: null });
    expect(await w.issueWrites!.drain()).toEqual({ ok: true, value: [] });
  });

  it('leaves the spool for the next beat while an issue pass writes the index', async () => {
    const w = world();
    await w.issueStore.write(held);
    await w.issueWrites!.append({ connector: 'jira', account: 'jira:abc', number: 'A-1', status: 'Delivered' });
    const state = freshIssueState();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow: IssueWorld = {
      ...w,
      issueStore: { ...w.issueStore, read: async () => { await gate; return w.issueStore.read(); } },
    };
    const pass = fleetIssues(slow, state, () => undefined)();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(issueIndexBusy(state)).toBe(true);
    await fleetIssueWrites(w, state, () => undefined)();
    release();
    await pass;
    expect(issueIndexBusy(state)).toBe(false);
    expect((await w.issueWrites!.drain())).toMatchObject({ ok: true, value: [{ number: 'A-1' }] });
  });

  it('drains on every base beat', () => {
    expect(fleetDivisors().find((d) => d.name === 'issue-writes')?.everyNthBeat).toBe(1);
  });
});
