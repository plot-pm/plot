import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DefaultBranchReading, Pr } from '@plot-pm/domain';
import { answered } from '@plot-pm/domain';
import { defaultBranchFile } from '@plot-pm/domain/adapters';
import { mergeAt as realMergeAt } from '@plot-pm/domain/workflows/merge';

import type { MergePorts } from '../../src/server/entry/merge.js';
import { removeTree } from '../rm-tree.mjs';

/**
 * `plot-ask.mjs merge` READS THE DEFAULT BRANCH'S REMOTE TIP.
 *
 * On a fresh settled reading, `mergeAt` asks `refs.remoteSha` for the tip. The
 * entry's `mergeAt` is replaced so the test captures the ports the entry
 * composes; the domain's real `mergeAt` then runs over those refs and that
 * store, with only the host and the script port stubbed.
 */

const captured: MergePorts[] = [];
vi.mock('../../src/server/entry/merge.js', () => ({
  mergeAt: vi.fn(async (ports: MergePorts) => {
    captured.push(ports);
    return { merged: false, reason: 'host-refused', detail: 'stubbed' };
  }),
}));

const { run } = await import('../../src/server/entry/main.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');
const HEAD = 'a'.repeat(40);

const made: string[] = [];
const savedEnv = { root: process.env.PLOT_REPO_ROOT, scripts: process.env.PLOT_SCRIPTS_DIR };
const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

afterEach(() => {
  captured.splice(0);
  restore('PLOT_REPO_ROOT', savedEnv.root);
  restore('PLOT_SCRIPTS_DIR', savedEnv.scripts);
  for (const dir of made.splice(0)) removeTree(dir);
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

/** A clone whose `origin` holds `main` at one commit; returns the clone and that commit. */
const repoWithOrigin = (): { repoRoot: string; tip: string } => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-merge-tip-'));
  made.push(base);
  const origin = path.join(base, 'origin.git');
  const repoRoot = path.join(base, 'repo');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(base, 'init', '-q', '-b', 'main', repoRoot);
  git(repoRoot, 'remote', 'add', 'origin', origin);
  git(repoRoot, 'commit', '-q', '--allow-empty', '-m', 'one');
  git(repoRoot, 'push', '-q', 'origin', 'main');
  return { repoRoot, tip: git(repoRoot, 'rev-parse', 'HEAD') };
};

const greenAt = (tip: string): DefaultBranchReading => {
  const now = new Date().toISOString();
  return {
    v: 1,
    branch: 'main',
    headSha: tip,
    head: 'green',
    settled: { sha: tip, state: 'green' },
    failingRuns: [],
    headSince: now,
    askedAt: now,
    at: now,
  };
};

const pr: Pr = {
  number: 7, repo: '', head: 'feature/x', base: 'main', state: 'OPEN', mergedAt: null, mergeCommit: '',
  draft: false, mergeable: 'mergeable', review: '', checks: 'green', failingChecks: [],
  url: '', author: '', headSha: HEAD, checksSha: HEAD,
};

describe('plot-ask merge reads the default branch\'s remote tip', () => {
  it('merges on a fresh green settled reading of the tip', async () => {
    const { repoRoot, tip } = repoWithOrigin();
    expect((await defaultBranchFile(repoRoot).write(greenAt(tip))).ok).toBe(true);
    process.env.PLOT_REPO_ROOT = repoRoot;
    process.env.PLOT_SCRIPTS_DIR = REAL_SCRIPTS;

    expect(await run(['merge', '7', HEAD], HERE, vi.fn())).toBe(1);
    expect(captured).toHaveLength(1);
    const ports = captured[0]!;

    expect(await ports.refs.remoteSha('main')).toEqual(answered({ sha: tip }));

    const calls: string[][] = [];
    const out = await realMergeAt(
      {
        ...ports,
        host: {
          backend: async () => answered('github'),
          prState: async () => answered(pr),
          prReview: async () => answered({ sha: HEAD, state: 'success', description: '', time: '', bypass: false }),
        } as unknown as MergePorts['host'],
        scripts: {
          hostSaid: async (args: string[]) => {
            calls.push(args);
            return { answer: 'answered', said: '' };
          },
        } as unknown as MergePorts['scripts'],
      },
      7,
      HEAD,
    );
    expect(out).toMatchObject({ merged: true, pr: 7, sha: HEAD, defaultBranchRead: true });
    expect(calls).toEqual([['pr-merge', '7', '--match-head', HEAD]]);
  });
});
