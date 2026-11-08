import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildSandbox, describeSize, type Sandbox } from './sandbox.js';

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

  it('removes its root by name', async () => {
    const box = await buildSandbox({ host: 'github', desks: 1, openPrs: 0 });

    await box.remove();

    expect(existsSync(box.root)).toBe(false);
  });
});
