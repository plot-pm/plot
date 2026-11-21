// The merge pass run from a linked worktree reads the default-branch reading under the main checkout.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { PR_INDEX_VERSION } from '@plot-pm/domain';
import { defaultBranchFile, prIndexFile, stateHomeAtSync } from '@plot-pm/domain/adapters';
import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { Host } from '@plot-pm/domain/ports/host';

import { runAutoMergePass } from '../../src/shared/auto-merge.js';
import { removeTree } from '../rm-tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');
const NOW = Date.parse('2026-11-21T08:00:00Z');
const HEAD = '3'.repeat(40);
const RED_SHA = 'c'.repeat(40);

const RED: DefaultBranchReading = {
  v: 1,
  branch: 'main',
  headSha: RED_SHA,
  head: 'red',
  settled: { sha: RED_SHA, state: 'red' },
  failingRuns: [],
  headSince: '2026-11-21T07:50:00.000Z',
  askedAt: '2026-11-21T07:58:00.000Z',
  at: '2026-11-21T07:58:00.000Z',
};

const host = { backend: async () => ({ ok: true as const, value: 'bitbucket' }) } as unknown as Host;

const made: string[] = [];
const savedIndexHome = process.env.PLOT_PR_INDEX_HOME;
afterEach(() => {
  if (savedIndexHome === undefined) delete process.env.PLOT_PR_INDEX_HOME;
  else process.env.PLOT_PR_INDEX_HOME = savedIndexHome;
  for (const dir of made.splice(0)) removeTree(dir);
});

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
};

/** A main checkout whose refresh wrote a red reading, a linked worktree, and a PR index with one open row. */
const deskOverRedMain = async (): Promise<string> => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-merge-desk-')));
  made.push(base);
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'one');
  const desk = path.join(main, '.worktrees', 'desk');
  git(main, 'worktree', 'add', '-q', '-b', 'slice', desk);
  const home = stateHomeAtSync(main);
  if (!('home' in home)) throw new Error(`no state home under ${main}`);
  expect((await defaultBranchFile(home.home).write(RED)).ok).toBe(true);
  const index = path.join(base, 'index');
  fs.mkdirSync(index);
  process.env.PLOT_PR_INDEX_HOME = index;
  const wrote = await prIndexFile({ home: index }).write('bitbucket', {
    v: PR_INDEX_VERSION,
    connector: 'bitbucket',
    watermark: null,
    complete: true,
    at: '2026-11-21T07:59:00Z',
    rows: [{
      number: 3, head: 'feature/p3', base: 'main', state: 'OPEN', draft: false, checks: 'green', review: '', url: 'u',
      headSha: HEAD, checksSha: HEAD, ciChecks: 'green',
      plotReview: 'success', plotReviewSha: HEAD, plotReviewJudged: 'success', plotReviewCheckedSha: HEAD,
    }],
  });
  expect(wrote.ok).toBe(true);
  return desk;
};

describe('runAutoMergePass from a linked worktree', () => {
  // The pass reads nothing and selects nothing where no reading exists, so a
  // tick over the open row proves it read the main checkout's file.
  it('runs the tick over the reading fleetd wrote under the main checkout', async () => {
    const desk = await deskOverRedMain();
    expect(fs.existsSync(path.join(desk, '.plot', 'state', 'default-branch.json'))).toBe(false);
    const out = await runAutoMergePass({ repoRoot: desk, scriptsDir: REAL_SCRIPTS, hostAdapter: host }, new Map(), NOW);
    expect(out?.steps.map((s) => s.pr)).toEqual([3]);
    expect(out?.merged).toBeUndefined();
  });

  it('answers no tick where the main checkout holds no reading', async () => {
    const desk = await deskOverRedMain();
    const home = stateHomeAtSync(desk);
    if (!('home' in home)) throw new Error('no state home');
    fs.rmSync(path.join(home.home, '.plot', 'state', 'default-branch.json'));
    expect(await runAutoMergePass({ repoRoot: desk, scriptsDir: REAL_SCRIPTS, hostAdapter: host }, new Map(), NOW)).toBeNull();
  });
});
