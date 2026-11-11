import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { buildActions } from '../src/adapters/build/build-actions.js';
import { exportedIssue, githubIssueList } from '../src/adapters/host/github-issue-list.js';
import { githubRuns } from '../src/adapters/host/github-runs.js';
import type { ShellContext } from '../src/adapters/scripts.js';
import { trackerGithub } from '../src/adapters/tracker/tracker-github.js';
import { refusalKind } from '../src/rules/refusal.js';
import { exchangeClient, readExchangeFixtures, startExchangeReplay, type ExchangeOverride, type ExchangeReplay } from './fixtures/github-exchange-replay.js';

const roots: string[] = [];
const open: { replay: ExchangeReplay; cleanup: () => void }[] = [];

afterEach(async () => {
  for (const one of open.splice(0)) {
    await one.replay.close();
    one.cleanup();
  }
});

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** A context whose `plot-host.sh` is the given body. */
const hostThat = (body: string): ShellContext => {
  const root = mkdtempSync(join(tmpdir(), 'plot-github-in-process-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return { repoRoot: root, scriptDir };
};

const issueFixtures = new Map(readExchangeFixtures('github-issue-reads').map((f) => [f.name, f]));
const runFixtures = new Map(readExchangeFixtures('github-runs-for-sha').map((f) => [f.name, f]));

/** A client over a stub that answers the named fixture's exchanges, or the override first. */
const clientOver = async (fixture: string | null, override?: ExchangeOverride, origin?: string | null) => {
  const exchanges = fixture === null ? [] : (issueFixtures.get(fixture) ?? runFixtures.get(fixture))?.exchanges ?? [];
  const replay = await startExchangeReplay(exchanges, override);
  const { api, cleanup } = exchangeClient(replay.url, origin);
  open.push({ replay, cleanup });
  return { api, replay };
};

const SECONDARY = 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.';

/** One page of the repository issue listing. */
const issuePage = (numbers: readonly number[], hasNextPage: boolean, enabled = true) => ({
  status: 200,
  body: {
    data: {
      repository: {
        hasIssuesEnabled: enabled,
        issues: { totalCount: 500, nodes: numbers.map((n) => ({ number: n, title: `t${n}`, url: `u${n}`, createdAt: 'c', assignees: { nodes: [] }, issueType: null, milestone: null })), pageInfo: { hasNextPage, endCursor: `c${numbers.length}` } },
      },
    },
  },
});

const hundred = (from: number) => Array.from({ length: 100 }, (_, i) => from - i);

describe('the issue read keeps its three outcomes', () => {
  it('an empty list, a failed request and unaskable stay apart', async () => {
    const empty = await clientOver('open-none');
    const emptyTracker = trackerGithub(hostThat('exit 9'), empty.api);
    expect(await emptyTracker.issueListOpen(1000)).toEqual({ ok: true, value: { issues: [], complete: true, pages: 1 } });
    expect(emptyTracker.lastRefusal()).toBeNull();
    expect(emptyTracker.lastHostRefusal()).toBeNull();

    const refused = await clientOver(null, () => ({ status: 403, body: { message: SECONDARY }, headers: { 'Retry-After': '60' } }));
    const refusedTracker = trackerGithub(hostThat('exit 9'), refused.api);
    expect(await refusedTracker.issueListOpen(1000)).toEqual({ ok: false, why: 'failed' });
    expect(refusedTracker.lastRefusal()).toBe(SECONDARY);
    expect(refusedTracker.lastHostRefusal()).toEqual({ kind: 'secondary', said: SECONDARY, waitMs: 60_000 });
    expect(refusalKind(refusedTracker.lastRefusal() ?? '')).toBe('secondary');

    const nowhere = await clientOver(null, undefined, null);
    const nowhereTracker = trackerGithub(hostThat('exit 9'), nowhere.api);
    const unasked = await nowhereTracker.issueListChanged('2026-11-01', 1000);
    expect(unasked).toMatchObject({ ok: false, why: 'unaskable' });
    expect(nowhere.replay.sent).toEqual([]);
    expect(nowhereTracker.lastRefusal()).toBeNull();
  });

  it('a page refused after page 1 fails the whole read, as gh prints no rows for a failed call', async () => {
    const { api, replay } = await clientOver(null, (_sent, index) => (index === 0 ? issuePage(hundred(900), true) : { status: 502, body: { message: 'Bad gateway' } }));
    const tracker = trackerGithub(hostThat('exit 9'), api);
    expect(await tracker.issueListOpen(1000)).toEqual({ ok: false, why: 'failed' });
    expect(replay.sent).toHaveLength(2);
    expect(tracker.lastHostRefusal()).toMatchObject({ kind: 'failed' });
  });

  it('a GraphQL errors array and a repository with issues disabled are refusals', async () => {
    const errors = await clientOver(null, () => ({ status: 200, body: { errors: [{ message: 'Something broke' }, { message: 'Again' }] } }));
    const errorsTracker = trackerGithub(hostThat('exit 9'), errors.api);
    expect(await errorsTracker.issueListOpen(10)).toEqual({ ok: false, why: 'failed' });
    expect(errorsTracker.lastRefusal()).toBe('GraphQL: Something broke, Again');

    const disabled = await clientOver('issues-disabled');
    const disabledTracker = trackerGithub(hostThat('exit 9'), disabled.api);
    expect(await disabledTracker.issueListOpen(1000)).toEqual({ ok: false, why: 'failed' });
    expect(disabledTracker.lastRefusal()).toBe("the 'plot-fixture/issues' repository has disabled issues");
  });

  it('stops at the limit and reads the cut as incomplete', async () => {
    const { api } = await clientOver('open-at-limit');
    const read = await trackerGithub(hostThat('exit 9'), api).issueListOpen(5);
    expect(read.ok && [read.value.issues.length, read.value.complete, read.value.pages]).toEqual([5, false, 1]);
  });

  it('sorts a closed read by closedAt, newest first', async () => {
    const { api } = await clientOver('closed-since');
    const read = await trackerGithub(hostThat('exit 9'), api).issueListClosed('2026-10-10', 1000);
    const closed = read.ok ? read.value.issues.map((i) => i.closedAt ?? '') : [];
    expect(closed.length).toBeGreaterThan(1);
    expect(closed).toEqual([...closed].sort().reverse());
  });

  it('the inbox stays unaskable and sends nothing', async () => {
    const { api, replay } = await clientOver(null);
    expect(await trackerGithub(hostThat('exit 9'), api).issueListInbox(10)).toMatchObject({ ok: false, why: 'unaskable' });
    expect(replay.sent).toEqual([]);
  });

  it('the shell route reports no host refusal', async () => {
    const tracker = trackerGithub(hostThat('exit 3'));
    expect(await tracker.issueListOpen(10)).toEqual({ ok: false, why: 'failed' });
    expect(tracker.lastHostRefusal()).toBeNull();
  });
});

describe('the in-process issue listing', () => {
  it('asks the search type once, again after a refusal, and reads ISSUE where GitHub has no ISSUE_ADVANCED', async () => {
    let introspections = 0;
    const { api, replay } = await clientOver(null, (sent) => {
      const body = sent.body as { query: string; variables?: { type?: string } };
      if (/SearchType_enumValues/.test(body.query)) {
        introspections += 1;
        return introspections === 1 ? { status: 502, body: { message: 'down' } } : introspections === 2 ? { status: 200, body: { errors: [{ message: 'no' }] } } : { status: 200, body: { data: { SearchType: { enumValues: [{ name: 'ISSUE' }] } } } };
      }
      return { status: 200, body: { data: { repository: { hasIssuesEnabled: true }, search: { nodes: [], pageInfo: { hasNextPage: false } } } } };
    });
    const listing = githubIssueList(api);
    expect(await listing.list({ state: 'closed', since: '2026-10-01' }, 10)).toMatchObject({ ok: false, refusal: { kind: 'failed' } });
    expect(await listing.list({ state: 'closed', since: '2026-10-01' }, 10)).toMatchObject({ ok: false, refusal: { kind: 'failed', said: 'GraphQL: no' } });
    expect(await listing.list({ state: 'changed', since: '2026-10-01' }, 10)).toEqual({ ok: true, issues: [], ended: true, pages: 1 });
    expect(await listing.list({ state: 'changed', since: '2026-10-01' }, 10)).toEqual({ ok: true, issues: [], ended: true, pages: 1 });
    expect(introspections).toBe(3);
    expect((replay.sent.at(-1)?.body as { variables: { type: string } }).variables.type).toBe('ISSUE');
  });

  it('answers a refusal where the origin names no repository', async () => {
    const { api } = await clientOver(null, undefined, null);
    expect(await githubIssueList(api).list({ state: 'open' }, 10)).toMatchObject({ ok: false, refusal: { kind: 'failed' } });
  });

  it('exports null strings as empty and null times as Go zero time, as gh does', () => {
    expect(exportedIssue({ number: 1, title: null, url: null, createdAt: null, issueType: { name: null }, milestone: { title: null }, updatedAt: null, state: null }, 'changed')).toEqual({
      number: 1, title: '', url: '', createdAt: '0001-01-01T00:00:00Z', assignees: [], issueType: { name: '' }, milestone: { title: '' }, updatedAt: '0001-01-01T00:00:00Z', state: '', closedAt: null,
    });
    expect(exportedIssue(null, 'closed')).toMatchObject({ issueType: null, milestone: null, closedAt: null, labels: [] });
  });
});

describe('the in-process runsForSha', () => {
  const SHA = runFixtures.get('several-workflows')?.sha as string;

  it('picks every run for the commit, newest first, with the workflow names gh resolves', async () => {
    const { api } = await clientOver('several-workflows');
    const build = buildActions(hostThat('exit 9'), api);
    const read = await build.runsForSha('main', SHA);
    expect(read.ok && read.value.map((r) => [r.workflow, r.conclusion])).toEqual([
      ['CI', 'success'], ['Board', 'failure'], ['Release', null], ['CI', 'cancelled'], ['Board', 'action_required'], ['Release', 'skipped'], ['', 'neutral'],
    ]);
    expect(build.lastRefusal()).toBeNull();
    expect(build.lastHostRefusal()).toBeNull();
  });

  it('a refused request answers unaskable with GitHub’s message, as a failing gh does', async () => {
    const { api } = await clientOver(null, () => ({ status: 403, body: { message: SECONDARY }, headers: { 'Retry-After': '30' } }));
    const build = buildActions(hostThat('exit 9'), api);
    expect(await build.runsForSha('main', SHA)).toEqual({ ok: false, why: 'unaskable', reason: SECONDARY });
    expect(build.lastRefusal()).toBe(SECONDARY);
    expect(build.lastHostRefusal()).toEqual({ kind: 'secondary', said: SECONDARY, waitMs: 30_000 });
  });

  it('a script read after an in-process one reports the script’s refusal again', async () => {
    const { api } = await clientOver(null, () => ({ status: 502, body: { message: 'down' } }));
    const build = buildActions(hostThat('echo boom >&2; exit 1'), api);
    await build.runsForSha('main', SHA);
    expect(build.lastRefusal()).toMatch(/down/);
    expect(await build.runs('main')).toEqual({ ok: false, why: 'failed' });
    expect(build.lastRefusal()).toBe('boom');
    for (const call of [() => build.runForSha('main', SHA), () => build.rerunFailed('main', SHA), () => build.rerunAll('main', SHA), () => build.limit()]) {
      expect(await call()).toEqual({ ok: false, why: 'failed' });
    }
  });

  it('the shell route still runs plot-host.sh runs-for-sha', async () => {
    const build = buildActions(hostThat(`printf '[]'`));
    expect(await build.runsForSha('main', SHA)).toEqual({ ok: true, value: [] });
    expect(build.lastHostRefusal()).toBeNull();
  });

  it('an origin with no repository answers a refusal and sends nothing', async () => {
    const { api, replay } = await clientOver(null, undefined, null);
    expect(await githubRuns(api).list('main')).toMatchObject({ ok: false, refusal: { kind: 'failed' } });
    expect(replay.sent).toEqual([]);
  });

  /** A runs answer of one run on workflow `id`. */
  const oneRun = (workflow: number) => ({ status: 200, body: { total_count: 1, workflow_runs: [{ id: 1, head_sha: 'a', status: 'completed', conclusion: null, html_url: 'u', run_started_at: null, workflow_id: workflow }] } });

  it('pages the workflows until it has their total, and stops on an empty page', async () => {
    const flows = (from: number, count: number, total: number) => ({ status: 200, body: { total_count: total, workflows: Array.from({ length: count }, (_, i) => ({ id: from + i, name: `w${from + i}` })) } });
    const { api, replay } = await clientOver(null, (_sent, index) => (index === 0 ? oneRun(150) : index === 1 ? flows(1, 100, 160) : flows(101, 60, 160)));
    expect(await githubRuns(api).list('main')).toEqual({ ok: true, runs: [{ headSha: 'a', conclusion: '', status: 'completed', startedAt: '0001-01-01T00:00:00Z', url: 'u', databaseId: 1, workflowName: 'w150' }] });
    expect(replay.sent.map((s) => s.path)).toEqual([
      '/repos/plot-fixture/issues/actions/runs?branch=main&exclude_pull_requests=true&per_page=20',
      '/repos/plot-fixture/issues/actions/workflows?page=1&per_page=100',
      '/repos/plot-fixture/issues/actions/workflows?page=2&per_page=100',
    ]);
    const empty = await clientOver(null, (_sent, index) => (index === 0 ? oneRun(7) : index === 1 ? { status: 200, body: { total_count: 9, workflows: [] } } : { status: 200, body: { id: 7, name: 'Seven' } }));
    expect(await githubRuns(empty.api).list('main')).toMatchObject({ ok: true, runs: [{ workflowName: 'Seven' }] });
  });

  it('a refused workflows page or workflow lookup refuses the read; a 404 lookup names no workflow', async () => {
    const pageRefused = await clientOver(null, (_sent, index) => (index === 0 ? oneRun(7) : { status: 502, body: { message: 'down' } }));
    expect(await githubRuns(pageRefused.api).list('main')).toMatchObject({ ok: false, refusal: { kind: 'failed' } });
    const lookupRefused = await clientOver(null, (_sent, index) => (index === 0 ? oneRun(7) : index === 1 ? { status: 200, body: { total_count: 0, workflows: [] } } : { status: 502, body: { message: 'down' } }));
    expect(await githubRuns(lookupRefused.api).list('main')).toMatchObject({ ok: false, refusal: { kind: 'failed' } });
  });
});
