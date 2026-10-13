import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueIndexFile } from '@plot-pm/domain/adapters';
import { ISSUE_INDEX_VERSION, type IssueIndex } from '@plot-pm/domain';
import type { IssueIndexStore } from '@plot-pm/domain/ports/issue-index';

import {
  fleetIssues,
  freshIssueState,
  issueGateOf,
  issueGateOpen,
  refreshIssueIndex,
  type IssueState,
  type IssueWorld,
  type PrBackoffReading,
} from '../../src/shared/issue-refresh.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// The issue gate's pass (D28): the spike's Acceptance items 2, 5 and 6, and
// review findings H2, H3, M1, M2 and M3 of PR #1647.

const NOW = 1_800_000_000_000;
const ACCOUNT = 'jwloka';
const JIRA_ACCOUNT = 'jira:0123456789ab';
const RATE_LIMIT = 'API rate limit exceeded for user ID 1. Please wait 300 seconds before retrying.';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmTree(dir);
});

/** One `issue-list` JSON line. */
const issueLine = (n: number): string =>
  JSON.stringify({ number: n, title: `issue ${n}`, url: `https://example.invalid/${n}`, createdAt: '2026-10-01T00:00:00Z' });

/**
 * A scripts directory whose `plot-host.sh` answers `spend-rate` with the
 * connector's account and `issue-list` as told, recording every call.
 */
const fakeHost = (issueList: { rows?: number; stderr?: string; code?: number }): { dir: string; argv: () => string[] } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-issue-refresh-'));
  dirs.push(dir);
  const argvFile = path.join(dir, 'argv');
  const rows = Array.from({ length: issueList.rows ?? 0 }, (_, i) => `printf '%s\\n' ${JSON.stringify(issueLine(i + 1))}`).join('\n');
  fs.writeFileSync(
    path.join(dir, 'plot-host.sh'),
    '#!/usr/bin/env bash\n'
    + `printf '%s\\n' "$*" >> ${JSON.stringify(argvFile)}\n`
    + 'if [ "$1" = spend-rate ]; then\n'
    + `  if [ "$3" = jira ]; then echo '{"account":"${JIRA_ACCOUNT}"}'; else echo '{"account":"${ACCOUNT}"}'; fi\n`
    + '  exit 0\nfi\n'
    + 'if [ "$1" = issue-list ]; then\n'
    + `${rows}\n`
    + (issueList.stderr ? `  printf '%s\\n' ${JSON.stringify(issueList.stderr)} >&2\n` : '')
    + `  exit ${issueList.code ?? 0}\nfi\nexit 0\n`,
  );
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  const argv = (): string[] =>
    fs.existsSync(argvFile) ? fs.readFileSync(argvFile, 'utf8').split('\n').filter(Boolean) : [];
  return { dir, argv };
};

/** A store directory the suite owns. */
const storeHome = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-issue-store-'));
  dirs.push(dir);
  return dir;
};

const noBackoff = (): PrBackoffReading => ({ connector: 'github', account: ACCOUNT, until: null });

const worldOf = (
  scriptDir: string,
  store: IssueIndexStore,
  over: Partial<IssueWorld> = {},
): IssueWorld => ({
  context: { repoRoot: scriptDir, scriptDir },
  declaredTracker: '',
  gitHost: 'github',
  issueStore: store,
  prBackoff: noBackoff,
  now: () => NOW,
  ...over,
});

/** What the store holds on disk, or null. */
const onDisk = async (store: IssueIndexStore): Promise<IssueIndex | null> => {
  const read = await store.read();
  return read.ok ? read.value : null;
};

/** An answered index a previous pass left, with two rows. */
const heldIndex = (over: Partial<IssueIndex> = {}): IssueIndex => ({
  v: ISSUE_INDEX_VERSION,
  source: 'git-host',
  connector: 'github',
  account: ACCOUNT,
  requests: 1,
  nextAt: NOW - 1_000,
  backoffUntil: null,
  at: '2026-10-13T09:58:00.000Z',
  answer: 'answered',
  rows: [
    { number: '1', title: 'one', url: 'u1' },
    { number: '2', title: 'two', url: 'u2' },
  ],
  complete: true,
  ...over,
});

describe('one issue pass (Acceptance 2)', () => {
  it('writes connector github, the account, requests 1, nextAt 120 s on and backoffUntil null', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    const state = freshIssueState();

    await fleetIssues(worldOf(dir, store), state, () => undefined)();

    expect(await onDisk(store)).toEqual({
      v: ISSUE_INDEX_VERSION,
      source: 'git-host',
      connector: 'github',
      account: ACCOUNT,
      requests: 1,
      nextAt: NOW + 120_000,
      backoffUntil: null,
      at: new Date(NOW).toISOString(),
      answer: 'answered',
      rows: [{ number: '1', title: 'issue 1', url: 'https://example.invalid/1', createdAt: '2026-10-01T00:00:00Z' }],
      complete: true,
    });
    expect(argv()).toEqual(['spend-rate --connector github', 'issue-list --limit 50']);
    expect(state).toEqual({ issueNextAt: NOW + 120_000, issueNextIsBackoff: false, issueError: null });
  });

  it('asks for 50 rows and writes complete false where 50 came back (M2)', async () => {
    const { dir } = fakeHost({ rows: 50 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    const index = await onDisk(store);
    expect(index?.rows).toHaveLength(50);
    expect(index?.complete).toBe(false);
  });

  it('writes connector jira and the Jira account for a declared Jira tracker (H2)', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store, { declaredTracker: 'jira https://x.invalid' }), freshIssueState());
    const index = await onDisk(store);
    expect(index?.source).toBe('tracker');
    expect(index?.connector).toBe('jira');
    expect(index?.account).toBe(JIRA_ACCOUNT);
    expect(argv()[0]).toBe('spend-rate --connector jira');
  });
});

describe('the issue pass and the PR pass backoff (Acceptance 5)', () => {
  it('asks nothing while the PR state holds a backoff on its own connector and account', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    const state = freshIssueState();
    const until = NOW + 300_000;
    await refreshIssueIndex(
      worldOf(dir, store, { prBackoff: () => ({ connector: 'github', account: ACCOUNT, until }) }),
      state,
    );
    expect(argv().filter((call) => call.startsWith('issue-list'))).toEqual([]);
    expect(await onDisk(store)).toBeNull();
    expect(state.issueNextAt).toBe(until);
    expect(state.issueNextIsBackoff).toBe(true);
  });

  it('runs while the PR state\'s backoff belongs to another connector', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(
      worldOf(dir, store, {
        declaredTracker: 'jira https://x.invalid',
        prBackoff: () => ({ connector: 'github', account: ACCOUNT, until: NOW + 300_000 }),
      }),
      freshIssueState(),
    );
    expect(argv()).toContain('issue-list --limit 50');
    expect((await onDisk(store))?.answer).toBe('answered');
  });

  it('runs while the PR state\'s backoff belongs to another account', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(
      worldOf(dir, store, { prBackoff: () => ({ connector: 'github', account: 'someone-else', until: NOW + 300_000 }) }),
      freshIssueState(),
    );
    expect(argv()).toContain('issue-list --limit 50');
  });

  it('runs once the PR state\'s backoff has passed', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(
      worldOf(dir, store, { prBackoff: () => ({ connector: 'github', account: ACCOUNT, until: NOW }) }),
      freshIssueState(),
    );
    expect(argv()).toContain('issue-list --limit 50');
  });
});

describe('a refused issue read (Acceptance 6)', () => {
  it('writes backoffUntil from the refusal and keeps the previous rows and at', async () => {
    const { dir } = fakeHost({ stderr: RATE_LIMIT, code: 1 });
    const store = issueIndexFile({ home: storeHome() });
    const held = heldIndex();
    await store.write(held);
    const state = freshIssueState();

    await refreshIssueIndex(worldOf(dir, store), state);

    const index = await onDisk(store);
    expect(index?.answer).toBe('failed');
    expect(index?.backoffUntil).toBe(NOW + 300_000);
    expect(index?.rows).toEqual(held.rows);
    expect(index?.complete).toBe(true);
    expect(index?.at).toBe(held.at);
    expect(index?.failedAt).toBe(new Date(NOW).toISOString());
    expect(index?.reason).toBe(RATE_LIMIT);
    expect(index?.requests).toBe(1);
    expect(index?.nextAt).toBe(NOW + 120_000);
    expect(state).toEqual({ issueNextAt: NOW + 300_000, issueNextIsBackoff: true, issueError: RATE_LIMIT });
  });

  it('asks nothing on the next pass while its own recorded backoff is live', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await store.write(heldIndex({ answer: 'failed', backoffUntil: NOW + 60_000 }));
    const state = freshIssueState();
    await refreshIssueIndex(worldOf(dir, store), state);
    expect(argv().filter((call) => call.startsWith('issue-list'))).toEqual([]);
    expect(state.issueNextAt).toBe(NOW + 60_000);
    expect(state.issueNextIsBackoff).toBe(true);
  });

  it('writes no backoff for a refusal that is not a rate limit, and keeps the rows', async () => {
    const { dir } = fakeHost({ stderr: 'dial tcp: lookup api.github.com: no such host', code: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await store.write(heldIndex());
    const state = freshIssueState();
    await refreshIssueIndex(worldOf(dir, store), state);
    const index = await onDisk(store);
    expect(index?.backoffUntil).toBeNull();
    expect(index?.rows).toHaveLength(2);
    expect(state.issueNextAt).toBe(NOW + 120_000);
    expect(state.issueNextIsBackoff).toBe(false);
  });

  it('keeps no rows of another source', async () => {
    const { dir } = fakeHost({ stderr: 'boom', code: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await store.write(heldIndex({ source: 'tracker', connector: 'jira' }));
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    const index = await onDisk(store);
    expect(index?.rows).toBeUndefined();
    expect(index?.at).toBe(new Date(NOW).toISOString());
  });

  it('writes a first failed pass with no rows', async () => {
    const { dir } = fakeHost({ code: 3 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    const index = await onDisk(store);
    expect(index?.answer).toBe('failed');
    expect(index?.reason).toBe('plot-host.sh exited 3');
    expect(index?.rows).toBeUndefined();
  });
});

describe('a source that cannot be asked (M3)', () => {
  it('writes no file and asks nothing for a tracker no connector lists', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    const state = freshIssueState();
    await refreshIssueIndex(worldOf(dir, store, { declaredTracker: 'linear' }), state);
    expect(await onDisk(store)).toBeNull();
    expect(argv()).toEqual([]);
    expect(state.issueError).toContain('`linear`');
    expect(state.issueNextAt).toBe(NOW + 120_000);
  });

  it('keeps a reason sentence, never the word unsupported, where the git host cannot list issues', async () => {
    const { dir } = fakeHost({ code: 4 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store, { gitHost: 'bitbucket' }), freshIssueState());
    const index = await onDisk(store);
    expect(index?.answer).toBe('unsupported');
    expect(index?.reason).toBe('the git host `bitbucket` lists no issues');
    expect(index?.backoffUntil).toBeNull();
  });

  it('keeps the sentence the exit 4 stated over its own substitute', async () => {
    const { dir } = fakeHost({ stderr: 'plot-host: bitbucket has no issue listing', code: 4 });
    const store = issueIndexFile({ home: storeHome() });
    const state = freshIssueState();
    await refreshIssueIndex(worldOf(dir, store, { gitHost: 'bitbucket' }), state);
    const index = await onDisk(store);
    expect(index?.answer).toBe('unsupported');
    expect(index?.reason).toBe('bitbucket has no issue listing');
    expect(state.issueError).toBe('bitbucket has no issue listing');
    expect(index?.backoffUntil).toBeNull();
  });

  it('names the declared tracker where it cannot be asked', async () => {
    const { dir } = fakeHost({ code: 4 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store, { declaredTracker: 'jira' }), freshIssueState());
    expect((await onDisk(store))?.reason).toBe('the declared tracker `jira` cannot be asked for its issues');
  });
});

describe('the issue gate (M1)', () => {
  it('opens on the 24th beat after a pass that started 50 ms after its beat', () => {
    const beat = NOW;
    const state: IssueState = { issueNextAt: beat + 50 + 120_000, issueNextIsBackoff: false, issueError: null };
    expect(issueGateOpen(state.issueNextAt, state.issueNextIsBackoff, () => beat + 24 * 5_000)).toBe(true);
  });

  it('holds a backoff to the millisecond', () => {
    expect(issueGateOpen(NOW, true, () => NOW - 1)).toBe(false);
    expect(issueGateOpen(NOW, true, () => NOW)).toBe(true);
  });

  it('runs no pass while the gate is shut', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const state: IssueState = { issueNextAt: NOW + 60_000, issueNextIsBackoff: false, issueError: null };
    await fleetIssues(worldOf(dir, issueIndexFile({ home: storeHome() })), state, () => undefined)();
    expect(argv()).toEqual([]);
  });

  it('warns rather than throws where a pass throws', async () => {
    const { dir } = fakeHost({ rows: 1 });
    const lines: string[] = [];
    const throwing: IssueIndexStore = {
      location: async () => ({ ok: false, why: 'failed' }),
      read: async () => {
        throw new Error('disk gone');
      },
      write: async () => ({ ok: true, value: undefined }),
    };
    await fleetIssues(worldOf(dir, throwing), freshIssueState(), (line) => lines.push(line))();
    expect(lines).toEqual(['plot-fleetd: issue read failed: disk gone']);
  });
});

describe('issueGateOf', () => {
  it('answers null where no index exists', async () => {
    expect(await issueGateOf(issueIndexFile({ home: storeHome() }))()).toBeNull();
  });

  it('answers the cadence fields, an absent account as null', async () => {
    const store = issueIndexFile({ home: storeHome() });
    const { account: _account, ...noAccount } = heldIndex({ backoffUntil: NOW + 5 });
    await store.write(noAccount);
    expect(await issueGateOf(store)()).toEqual({
      connector: 'github',
      account: null,
      requests: 1,
      nextAt: NOW - 1_000,
      backoffUntil: NOW + 5,
    });
  });
});
