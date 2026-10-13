import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { issueIndexFile, ISSUE_INDEX_HOME_ENV } from '../src/adapters/issue-index/issue-index-file.js';
import { ISSUE_INDEX_VERSION, type IssueIndex } from '../src/entities/issue-index.js';

const roots: string[] = [];

const scratch = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'plot-issue-index-file-')));
  roots.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const index: IssueIndex = {
  v: ISSUE_INDEX_VERSION,
  source: 'git-host',
  connector: 'github',
  account: 'jwloka',
  requests: 1,
  nextAt: 1_800_000_120_000,
  backoffUntil: null,
  at: '2026-10-13T10:00:00.000Z',
  answer: 'answered',
  rows: [],
  complete: true,
};

describe('issueIndexFile', () => {
  it('answers null for a store no pass has written, then reads back what a pass wrote', async () => {
    const store = issueIndexFile({ home: scratch() });
    expect(await store.read()).toEqual({ ok: true, value: null });
    expect(await store.write(index)).toEqual({ ok: true, value: undefined });
    expect(await store.read()).toEqual({ ok: true, value: index });
  });

  it('answers null for a file it cannot decode', async () => {
    const home = scratch();
    writeFileSync(join(home, 'issues.json'), '{not json');
    expect(await issueIndexFile({ home }).read()).toEqual({ ok: true, value: null });
  });

  it('answers failed for a store path that is a directory', async () => {
    const home = scratch();
    mkdirSync(join(home, 'issues.json'));
    const store = issueIndexFile({ home });
    expect(await store.read()).toEqual({ ok: false, why: 'failed' });
    expect(await store.write(index)).toEqual({ ok: false, why: 'failed' });
  });

  it('reads its directory from the environment variable', async () => {
    const home = scratch();
    const store = issueIndexFile({ env: { [ISSUE_INDEX_HOME_ENV]: home } });
    expect(await store.location()).toEqual({ ok: true, value: join(home, 'issues.json') });
  });

  it('resolves the store under the common git dir, once', async () => {
    const repo = scratch();
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    const store = issueIndexFile({ cwd: repo, env: {} });
    const expected = join(repo, '.git', '.plot', 'state', 'index', 'issues.json');
    expect(await store.location()).toEqual({ ok: true, value: expected });
    expect(await store.location()).toEqual({ ok: true, value: expected });
  });

  it('answers failed where no git dir resolves', async () => {
    const store = issueIndexFile({ cwd: scratch(), env: {} });
    const located = await store.location();
    // A scratch directory under the temp dir has no repository above it.
    expect(located.ok).toBe(false);
    expect(await store.read()).toEqual({ ok: false, why: 'failed' });
    expect(await store.write(index)).toEqual({ ok: false, why: 'failed' });
  });
});
