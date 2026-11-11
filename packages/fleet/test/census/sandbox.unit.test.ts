import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { bitbucketApi } from '@plot-pm/domain/adapters/host/bitbucket-api';
import { githubApi } from '@plot-pm/domain/adapters/host/github-api';
import { githubIssueList } from '@plot-pm/domain/adapters/host/github-issue-list';
import { githubPrListing } from '@plot-pm/domain/adapters/host/github-pr-listing';
import { githubRuns } from '@plot-pm/domain/adapters/host/github-runs';

import { buildSandbox, CENSUS_TOKEN, describeSize, type Sandbox } from './sandbox.js';

const open: Sandbox[] = [];

afterEach(async () => {
  for (const box of open.splice(0)) await box.remove();
});

const sandbox = async (...args: Parameters<typeof buildSandbox>): Promise<Sandbox> => {
  const box = await buildSandbox(...args);
  open.push(box);
  return box;
};

const host = (box: Sandbox, ...args: string[]): string =>
  execFileSync('bash', [join(box.scriptsDir, 'plot-host.sh'), ...args], {
    cwd: box.repo,
    env: box.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

describe('the census sandbox', () => {
  it('states its fixture size', () => {
    expect(describeSize({ host: 'github', desks: 3, openPrs: 5 })).toBe('host=github desks=3 open-prs=5');
  });

  it('answers plot-host.sh pr-list on GitHub from the stub gh, with every open PR', async () => {
    const box = await sandbox({ host: 'github', desks: 0, openPrs: 5 });

    expect(host(box, 'backend').trim()).toBe('github');
    const rows = host(box, 'pr-list', '--state', 'open', '--rich').trim().split('\n').map((l) => JSON.parse(l));

    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]).toMatchObject({ head: 'feature/census-slice-1', checks: 'pending' });
    expect(readFileSync(box.stubLog, 'utf8')).toMatch(/^gh pr list --state open/m);
  });

  it('turns a PR green by rewriting its answer file', async () => {
    const box = await sandbox({ host: 'github', desks: 0, openPrs: 1 });
    const { githubPr } = await import('./sandbox.js');
    const sha = box.git(box.repo, 'rev-parse', 'HEAD');
    box.answer('gh', 'pr-list-open', [githubPr(1, 'feature/census-slice-1', sha, 'SUCCESS')]);

    const [row] = host(box, 'pr-list', '--state', 'open', '--rich').trim().split('\n').map((l) => JSON.parse(l));

    expect(row).toMatchObject({ number: 1, checks: 'green' });
  });

  it('answers plot-host.sh pr-list on Bitbucket from the stub bb', async () => {
    const box = await sandbox({ host: 'bitbucket', desks: 0, openPrs: 5 });

    expect(host(box, 'backend').trim()).toBe('bitbucket');
    const out = host(box, 'pr-list', '--state', 'open').trim();

    expect(out.split('\n')).toHaveLength(5);
    expect(readFileSync(box.stubLog, 'utf8')).toMatch(/^bb /m);
  });

  it('answers the Bitbucket fixture tracker, Jira, from the stub curl', async () => {
    const box = await sandbox({ host: 'bitbucket', desks: 0, openPrs: 0 });

    host(box, 'issue-list', '--state', 'open');

    expect(readFileSync(box.stubLog, 'utf8')).toMatch(/^curl .*https:\/\/jira\.census\.invalid\/rest\/api\/2\/search/m);
  });

  it('holds each desk with a live stub worker whose pid is in .plot-worker.pid, and stops each one', async () => {
    const box = await sandbox({ host: 'github', desks: 3, openPrs: 5 });

    expect(box.desks).toHaveLength(3);
    for (const desk of box.desks) {
      expect(readFileSync(join(desk.worktree, '.plot-worker.pid'), 'utf8').trim()).toBe(String(desk.worker.pid));
      expect(() => process.kill(desk.worker.pid, 0)).not.toThrow();
    }

    const codes = await Promise.all(box.desks.map((d) => d.worker.stop()));

    expect(codes).toEqual([0, 0, 0]);
  });

  it('counts one stub-server request per in-process read, under the fixture GH_TOKEN', async () => {
    const box = await sandbox({ host: 'github', desks: 0, openPrs: 1 });
    const api = githubApi({ origin: box.origin, env: box.env });
    const read = { method: 'POST' as const, path: '/graphql', body: { query: '{}' }, label: 'graphql' };

    expect(box.env['GH_TOKEN']).toBe(CENSUS_TOKEN);
    expect(box.env['GITHUB_API_URL']).toBe(box.api?.url);
    expect((await api.request(read)).ok).toBe(true);
    expect(box.api?.count('/graphql')).toBe(1);
    expect((await api.request(read)).ok).toBe(true);

    expect(box.api?.count('/graphql')).toBe(2);
    expect(box.api?.count('/user')).toBe(1);
    expect(box.api?.requests().every((r) => r.authorization === `Bearer ${CENSUS_TOKEN}`)).toBe(true);
  });

  it('answers the in-process reads from the stub gh answer files, so both transports read one fixture', async () => {
    const box = await sandbox({ host: 'github', desks: 0, openPrs: 3 });
    const api = githubApi({ origin: box.origin, env: box.env });
    const shell = (args: string[]) =>
      host(box, 'pr-list', ...args).trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
    const pick = (rows: readonly Record<string, unknown>[]) => rows.map((r) => [r['number'], r['head'], r['state'], r['checks'] ?? null]);
    for (const query of [
      { state: 'open' as const, rich: true, limit: 100 },
      { state: 'all' as const, limit: 100 },
      { state: 'all' as const, rich: true, limit: 100, since: '2025-12-31T00:00:00Z' },
      { state: 'merged' as const, limit: 500 },
    ]) {
      const args = ['--state', query.state, ...(query.rich ? ['--rich'] : []), '--limit', String(query.limit), ...(query.since ? ['--since', query.since] : [])];
      const listed = await githubPrListing(api).prListing(query);
      expect(listed.answer).toBe('answered');
      expect(listed.rows).toHaveLength(query.state === 'merged' ? 0 : 3);
      expect(pick(listed.rows as unknown as Record<string, unknown>[])).toEqual(pick(shell(args)));
    }
    const issues = await githubIssueList(api).list({ state: 'open' }, 100);
    expect(issues.ok && issues.issues).toEqual([]);
    const runs = await githubRuns(api).list('main');
    expect(runs.ok && runs.runs.map((r) => [r.headSha, r.conclusion, r.workflowName])).toEqual([[box.git(box.repo, 'rev-parse', 'main'), 'success', 'CI']]);
  });

  it('answers a request with another token 401, and points no GitHub client at the Bitbucket fixture', async () => {
    const box = await sandbox({ host: 'github', desks: 0, openPrs: 0 });
    const api = githubApi({ origin: box.origin, env: { ...box.env, GH_TOKEN: 'not-the-fixture' } });

    const answer = await api.request({ method: 'POST', path: '/graphql', body: {}, label: 'graphql' });

    expect(answer.ok || answer.refusal.kind).toBe('auth');
    const bitbucket = await sandbox({ host: 'bitbucket', desks: 0, openPrs: 0 });
    expect(bitbucket.env['GITHUB_API_URL']).toBeUndefined();
    expect(box.env['BITBUCKET_API_BASE']).toBeUndefined();
  });

  it('counts one stub-server request per in-process Bitbucket page, from the stub bb answer files', async () => {
    const box = await sandbox({ host: 'bitbucket', desks: 0, openPrs: 5 });
    const api = bitbucketApi({ origin: 'git@bitbucket.org:census/fixture.git', env: box.env });
    const page = { method: 'GET' as const, path: '/repositories/{ws}/{repo}/pullrequests?state=OPEN&pagelen=50', label: 'pr-list state=OPEN' };
    const path = '/2.0/repositories/census/fixture/pullrequests';

    expect(box.env['BITBUCKET_API_BASE']).toBe(`${box.api?.url}/2.0`);
    expect(await api.credentialSource()).toBe('environment');
    const first = await api.request(page);
    expect(first.ok && (first.reply.body as { values: unknown[] }).values).toHaveLength(5);
    expect(box.api?.count(path)).toBe(1);
    const branch = await api.request({
      ...page,
      path: `/repositories/{ws}/{repo}/pullrequests?q=${encodeURIComponent('state="OPEN" AND source.branch.name="feature/census-slice-2"')}&pagelen=50`,
    });
    expect(branch.ok && (branch.reply.body as { values: Array<{ id: number }> }).values.map((v) => v.id)).toEqual([2]);
    expect(box.api?.count(path)).toBe(2);
    const none = await api.request({ ...page, path: '/repositories/{ws}/{repo}/pullrequests?state=MERGED&pagelen=50' });
    expect(none.ok && none.reply.body).toEqual({ values: [], size: 0, pagelen: 50 });
    expect(box.api?.count(path)).toBe(3);

    const refused = await bitbucketApi({ origin: 'git@bitbucket.org:census/fixture.git', env: { ...box.env, BB_TOKEN: 'not-the-fixture' } }).request(page);
    expect(refused.ok || refused.refusal.kind).toBe('auth');
  });

  it('removes its root by name', async () => {
    const box = await buildSandbox({ host: 'github', desks: 1, openPrs: 0 });

    await box.remove();

    expect(existsSync(box.root)).toBe(false);
  });
});
