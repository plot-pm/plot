import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueIndexFile } from '@plot-pm/domain/adapters';
import { cadenceRateOf, ISSUE_INDEX_VERSION, type Issue, type IssueIndex } from '@plot-pm/domain';
import type { IssueIndexStore } from '@plot-pm/domain/ports/issue-index';

import {
  fleetIssues,
  freshIssueState,
  issueGateOf,
  issueGateOpen,
  issueIndexRowOf,
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
const SINCE = new Date(NOW - 14 * 86_400_000).toISOString();
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
 * connector's account and `issue-list` as told, recording every call. Where
 * `inbox` is given, a `plot-config.sh` declaring `Ticket prefixes` is written
 * alongside it, so `trackerJira`'s D23 gate (packages/domain/src/adapters/
 * tracker/tracker-jira.ts) lets the inbox read through.
 */
type FakeList = { rows?: number; stderr?: string; code?: number; token?: string };

const fakeHost = (
  issueList: FakeList,
  closed: FakeList = {},
  inbox?: FakeList,
): { dir: string; argv: () => string[] } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-issue-refresh-'));
  dirs.push(dir);
  const argvFile = path.join(dir, 'argv');
  const linesOf = (list: FakeList, line: (n: number) => string): string =>
    Array.from({ length: list.rows ?? 0 }, (_, i) => `printf '%s\\n' ${JSON.stringify(line(i + 1))}`).join('\n');
  const closedLine = (n: number): string => JSON.stringify({ ...JSON.parse(issueLine(n)), closedAt: '2026-10-12T00:00:00Z' });
  const answer = (list: FakeList, line: (n: number) => string): string =>
    `${linesOf(list, line)}\n`
    + (list.token ? `  printf '%s\\n' ${JSON.stringify(JSON.stringify({ nextPageToken: list.token }))}\n` : '')
    + (list.stderr ? `  printf '%s\\n' ${JSON.stringify(list.stderr)} >&2\n` : '')
    + `  exit ${list.code ?? 0}\n`;
  fs.writeFileSync(
    path.join(dir, 'plot-host.sh'),
    '#!/usr/bin/env bash\n'
    + `printf '%s\\n' "$*" >> ${JSON.stringify(argvFile)}\n`
    + 'if [ "$1" = spend-rate ]; then\n'
    + `  if [ "$3" = jira ]; then echo '{"account":"${JIRA_ACCOUNT}"}'; else echo '{"account":"${ACCOUNT}"}'; fi\n`
    + '  exit 0\nfi\n'
    + 'if [ "$1" = issue-list ]; then\n'
    + '  case " $* " in *" --state closed "*)\n'
    + answer(closed, closedLine)
    + '  ;; *" --state inbox "*)\n'
    + answer(inbox ?? { rows: 0 }, issueLine)
    + '  ;; esac\n'
    + answer(issueList, issueLine)
    + 'fi\nexit 0\n',
  );
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  if (inbox !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'plot-config.sh'),
      '#!/usr/bin/env bash\n'
      + 'if [ "$1" = get ] && [ "$2" = "Ticket prefixes" ]; then echo "PROJ"; exit 0; fi\n'
      + 'exit 0\n',
    );
    fs.chmodSync(path.join(dir, 'plot-config.sh'), 0o755);
  }
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

describe('issueIndexRowOf', () => {
  const issue = (over: Partial<Issue> = {}): Issue => ({
    id: '1',
    title: 'one',
    url: 'u1',
    createdAt: null,
    body: null,
    status: '',
    statusCategory: '',
    closedAt: null,
    assignees: [],
    ...over,
  });

  it('writes both assignees of a two-assignee issue into the row', () => {
    expect(issueIndexRowOf(issue({ assignees: ['alice', 'bob'] }))).toEqual({
      number: '1',
      title: 'one',
      url: 'u1',
      assignees: ['alice', 'bob'],
    });
  });

  it('omits assignees where the tracker named none', () => {
    expect(issueIndexRowOf(issue())).toEqual({ number: '1', title: 'one', url: 'u1' });
  });
});

describe('one issue pass (Acceptance 2)', () => {
  it('writes connector github, the account, requests 2, nextAt 240 s on and backoffUntil null', async () => {
    const { dir, argv } = fakeHost({ rows: 1 }, { rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    const state = freshIssueState();

    await fleetIssues(worldOf(dir, store), state, () => undefined)();

    expect(await onDisk(store)).toEqual({
      v: ISSUE_INDEX_VERSION,
      source: 'git-host',
      connector: 'github',
      account: ACCOUNT,
      requests: 2,
      nextAt: NOW + 240_000,
      backoffUntil: null,
      at: new Date(NOW).toISOString(),
      answer: 'answered',
      rows: [{ number: '1', title: 'issue 1', url: 'https://example.invalid/1', createdAt: '2026-10-01T00:00:00Z' }],
      complete: true,
      closed: {
        since: SINCE,
        at: new Date(NOW).toISOString(),
        answer: 'answered',
        rows: [{
          number: '1', title: 'issue 1', url: 'https://example.invalid/1',
          createdAt: '2026-10-01T00:00:00Z', closedAt: '2026-10-12T00:00:00Z',
        }],
        complete: true,
      },
    });
    expect(argv()).toEqual([
      'spend-rate --connector github',
      'issue-list --paged --limit 1000',
      `issue-list --state closed --since ${SINCE} --limit 1000`,
    ]);
    expect(state).toEqual({ issueNextAt: NOW + 240_000, issueNextIsBackoff: false, issueError: null });
  });

  it('asks for 1000 open rows and writes complete true where fewer came back', async () => {
    const { dir } = fakeHost({ rows: 50 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    const index = await onDisk(store);
    expect(index?.rows).toHaveLength(50);
    expect(index?.complete).toBe(true);
  });

  it('writes complete false where the open read came back at its 1000-row cap (M2)', async () => {
    const { dir } = fakeHost({ rows: 1000 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    const index = await onDisk(store);
    expect(index?.rows).toHaveLength(1000);
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
    expect(argv()).toContain('issue-list --paged --limit 1000');
    expect((await onDisk(store))?.answer).toBe('answered');
  });

  it('runs while the PR state\'s backoff belongs to another account', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(
      worldOf(dir, store, { prBackoff: () => ({ connector: 'github', account: 'someone-else', until: NOW + 300_000 }) }),
      freshIssueState(),
    );
    expect(argv()).toContain('issue-list --paged --limit 1000');
  });

  it('runs once the PR state\'s backoff has passed', async () => {
    const { dir, argv } = fakeHost({ rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(
      worldOf(dir, store, { prBackoff: () => ({ connector: 'github', account: ACCOUNT, until: NOW }) }),
      freshIssueState(),
    );
    expect(argv()).toContain('issue-list --paged --limit 1000');
  });
});

describe('the closed set of the index', () => {
  const closedOf = async (store: IssueIndexStore) => (await onDisk(store))?.closed;

  it('replaces the closed rows whole, so a reopened ticket leaves closed and joins the open rows', async () => {
    const { dir } = fakeHost({ rows: 1 }, { rows: 0 });
    const store = issueIndexFile({ home: storeHome() });
    await store.write(heldIndex({
      closed: { since: SINCE, at: '2026-10-13T09:58:00.000Z', answer: 'answered', rows: [{ number: '1', title: 'one', url: 'u1' }], complete: true },
    }));
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    const index = await onDisk(store);
    expect(index?.rows?.map((row) => row.number)).toEqual(['1']);
    expect(index?.closed?.rows).toEqual([]);
  });

  it('keeps the previous closed rows and at where only the closed read fails, and refreshes the open rows', async () => {
    const { dir } = fakeHost({ rows: 1 }, { stderr: 'dial tcp: lookup api.github.com: no such host', code: 1 });
    const store = issueIndexFile({ home: storeHome() });
    const kept = { since: '2026-09-01T00:00:00.000Z', at: '2026-10-13T09:58:00.000Z', answer: 'answered' as const, rows: [{ number: '9', title: 'nine', url: 'u9' }], complete: true };
    await store.write(heldIndex({ closed: kept }));
    const state = freshIssueState();
    await refreshIssueIndex(worldOf(dir, store), state);
    const index = await onDisk(store);
    expect(index?.answer).toBe('answered');
    expect(index?.at).toBe(new Date(NOW).toISOString());
    expect(index?.rows).toHaveLength(1);
    expect(await closedOf(store)).toEqual({
      since: kept.since,
      at: kept.at,
      answer: 'failed',
      failedAt: new Date(NOW).toISOString(),
      reason: 'dial tcp: lookup api.github.com: no such host',
      rows: kept.rows,
      complete: true,
    });
    expect(state.issueError).toBe('dial tcp: lookup api.github.com: no such host');
    expect(index?.backoffUntil).toBeNull();
  });

  it('records a closed rate limit as the index backoff and keeps the open rows answered', async () => {
    const { dir } = fakeHost({ rows: 1 }, { stderr: RATE_LIMIT, code: 1 });
    const store = issueIndexFile({ home: storeHome() });
    const state = freshIssueState();
    await refreshIssueIndex(worldOf(dir, store), state);
    const index = await onDisk(store);
    expect(index?.answer).toBe('answered');
    expect(index?.backoffUntil).toBe(NOW + 300_000);
    expect(index?.closed?.answer).toBe('failed');
    expect(state.issueNextAt).toBe(NOW + 300_000);
    expect(state.issueNextIsBackoff).toBe(true);
  });

  it('keeps the previous closed block where the open read fails', async () => {
    const { dir, argv } = fakeHost({ stderr: 'boom', code: 1 });
    const store = issueIndexFile({ home: storeHome() });
    const closed = { since: SINCE, at: '2026-10-13T09:58:00.000Z', answer: 'answered' as const, rows: [], complete: true };
    await store.write(heldIndex({ closed }));
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    expect(await closedOf(store)).toEqual(closed);
    expect(argv().some((call) => call.includes('--state closed'))).toBe(false);
  });

  it('spends one request where the tracker answers unaskable for the closed read', async () => {
    const { dir } = fakeHost({ rows: 1 }, { stderr: 'bb lists no closed date', code: 4 });
    const store = issueIndexFile({ home: storeHome() });
    const state = freshIssueState();
    await refreshIssueIndex(worldOf(dir, store), state);
    const index = await onDisk(store);
    expect(index?.requests).toBe(1);
    expect(index?.nextAt).toBe(NOW + 120_000);
    expect(index?.closed?.answer).toBe('unsupported');
    expect(index?.closed?.rows).toBeUndefined();
    expect(index?.answer).toBe('answered');
  });
});

describe('the inbox set of the index (D23)', () => {
  it('writes no inbox for a git-host source, which has no Ticket prefixes gate to turn on', async () => {
    const { dir } = fakeHost({ rows: 1 }, { rows: 0 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    const index = await onDisk(store);
    expect(index).not.toHaveProperty('inbox');
  });

  it('writes no inbox for a declared Jira tracker with no Ticket prefixes, and spends no extra request', async () => {
    const { dir, argv } = fakeHost({ rows: 1 }, { rows: 0 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store, { declaredTracker: 'jira https://x.invalid' }), freshIssueState());
    const index = await onDisk(store);
    expect(index).not.toHaveProperty('inbox');
    expect(index?.requests).toBe(2);
    expect(argv().some((call) => call.includes('--state inbox'))).toBe(false);
  });

  it('writes the inbox rows and counts the extra request for a declared Jira tracker with Ticket prefixes', async () => {
    const { dir, argv } = fakeHost({ rows: 1 }, { rows: 0 }, { rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store, { declaredTracker: 'jira https://x.invalid' }), freshIssueState());
    const index = await onDisk(store);
    expect(index?.inbox).toEqual([{ number: '1', title: 'issue 1', url: 'https://example.invalid/1', createdAt: '2026-10-01T00:00:00Z' }]);
    expect(index?.requests).toBe(3);
    expect(argv().some((call) => call.includes('--state inbox'))).toBe(true);
  });

  it('keeps the previous inbox rows where the open read fails', async () => {
    const { dir } = fakeHost({ stderr: 'boom', code: 1 }, {}, { rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    const kept = [{ number: '3', title: 'mine', url: 'u3' }];
    await store.write(heldIndex({ source: 'tracker', connector: 'jira', inbox: kept }));
    await refreshIssueIndex(worldOf(dir, store, { declaredTracker: 'jira https://x.invalid' }), freshIssueState());
    expect((await onDisk(store))?.inbox).toEqual(kept);
  });

  it('writes no inbox where the previous pass held none and the open read fails', async () => {
    const { dir } = fakeHost({ stderr: 'boom', code: 1 }, {}, { rows: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await store.write(heldIndex({ source: 'tracker', connector: 'jira' }));
    await refreshIssueIndex(worldOf(dir, store, { declaredTracker: 'jira https://x.invalid' }), freshIssueState());
    expect(await onDisk(store)).not.toHaveProperty('inbox');
  });
});

describe('the requests a pass spent (D28)', () => {
  it('counts 2 open pages and 1 closed request for 150 open and 0 closed rows: requests 3, nextAt 360 s on', async () => {
    const { dir } = fakeHost({ rows: 150 }, { rows: 0 });
    const store = issueIndexFile({ home: storeHome() });
    const state = freshIssueState();
    await refreshIssueIndex(worldOf(dir, store), state);
    const index = await onDisk(store);
    expect(index?.requests).toBe(3);
    expect(index?.nextAt).toBe(NOW + 360_000);
    expect(state.issueNextAt).toBe(NOW + 360_000);
  });

  it('counts 10 + 10 pages for 1000 open and 1000 closed rows: requests 20, nextAt 2400 s on', async () => {
    const { dir } = fakeHost({ rows: 1000 }, { rows: 1000 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    const index = await onDisk(store);
    expect(index?.requests).toBe(20);
    expect(index?.nextAt).toBe(NOW + 2_400_000);
    expect(index?.complete).toBe(false);
    expect(index?.closed?.complete).toBe(false);
  });

  it('hands cadenceRateOf a reading whose subtraction is the spend the pass really made', async () => {
    const { dir } = fakeHost({ rows: 150 }, { rows: 0 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    const gate = await issueGateOf(store)();
    expect(gate).not.toBeNull();
    // 3 requests every 360 s is 30 an hour, the bound the subtraction assumes.
    expect((gate!.requests * 3_600_000) / (gate!.nextAt - NOW)).toBe(30);
    expect(cadenceRateOf({ perHour: 100 }, gate, 'github', ACCOUNT, NOW + 1_000)).toEqual({ perHour: 70 });
  });

  it('counts each page of a paged open read, and reports a repeated token as incomplete (M1)', async () => {
    const { dir, argv } = fakeHost({ rows: 1, token: 'same' }, { rows: 0 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store, { declaredTracker: 'jira https://x.invalid' }), freshIssueState());
    const index = await onDisk(store);
    expect(argv().filter((call) => call.startsWith('issue-list --paged'))).toEqual([
      'issue-list --paged --limit 1000',
      'issue-list --paged --limit 999 --page-token same',
    ]);
    expect(index?.complete).toBe(false);
    expect(index?.requests).toBe(3);
  });
});

describe('a closed read that never answered (L1)', () => {
  it('records no at and the asked since where a first closed read fails', async () => {
    const { dir } = fakeHost({ rows: 1 }, { stderr: 'boom', code: 1 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    expect((await onDisk(store))?.closed).toEqual({
      since: SINCE,
      answer: 'failed',
      failedAt: new Date(NOW).toISOString(),
      reason: 'boom',
    });
  });

  it('records no at where the first closed read is unsupported', async () => {
    const { dir } = fakeHost({ rows: 1 }, { stderr: 'bb lists no closed date', code: 4 });
    const store = issueIndexFile({ home: storeHome() });
    await refreshIssueIndex(worldOf(dir, store), freshIssueState());
    const closed = (await onDisk(store))?.closed;
    expect(closed?.answer).toBe('unsupported');
    expect(closed && 'at' in closed).toBe(false);
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
