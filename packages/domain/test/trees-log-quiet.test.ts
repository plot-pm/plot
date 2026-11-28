import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { treesGit } from '../src/adapters/trees/trees-git.js';

/**
 * `logQuietSeconds` against a real desk: four signals at distinct times, and
 * each one alone moves the answer.
 */
const scriptDir = path.join(fileURLToPath(new URL('../../..', import.meta.url)), 'skills', 'plot', 'scripts');
const SIGNAL_FILES = ['.plot-worker.pass', '.plot-worker.monitor.agent.jsonl', '.plot-worker.log'] as const;

let root = '';
let desk = '';

const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const git = (args: readonly string[], committedAgo?: number): string =>
  execFileSync('git', [...args], {
    cwd: desk,
    encoding: 'utf8',
    env: committedAgo === undefined ? process.env : { ...process.env, GIT_COMMITTER_DATE: `@${nowSeconds() - committedAgo} +0000` },
  });
const touch = (name: string, secondsAgo: number): void => {
  const at = nowSeconds() - secondsAgo;
  fs.utimesSync(path.join(desk, name), at, at);
};
const commitAgo = (secondsAgo: number): void => {
  git(['commit', '--quiet', '--allow-empty', '-m', `at ${secondsAgo}`], secondsAgo);
};
const allOld = (): void => {
  for (const name of SIGNAL_FILES) touch(name, 9000);
  commitAgo(9000);
};
const quiet = async (): Promise<number | null> => {
  const answer = await treesGit({ repoRoot: desk, scriptDir }).logQuietSeconds!(desk);
  if (!answer.ok) throw new Error('logQuietSeconds failed');
  return answer.value;
};

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-trees-log-quiet-')));
  desk = path.join(root, 'desk');
  fs.mkdirSync(desk);
  git(['init', '--quiet', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  for (const name of SIGNAL_FILES) fs.writeFileSync(path.join(desk, name), 'x\n');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const near = (value: number | null, expected: number): boolean => value !== null && Math.abs(value - expected) <= 5;

describe('treesGit().logQuietSeconds', () => {
  it('reads an old log with a new pass file from the pass file', async () => {
    allOld();
    touch('.plot-worker.log', 7178);
    touch('.plot-worker.pass', 60);
    expect(near(await quiet(), 60)).toBe(true);
  });

  it.each(SIGNAL_FILES)('moves when %s alone is new', async (name) => {
    allOld();
    expect(near(await quiet(), 9000)).toBe(true);
    touch(name, 120);
    expect(near(await quiet(), 120)).toBe(true);
  });

  it('moves when the HEAD commit alone is new', async () => {
    allOld();
    commitAgo(240);
    expect(near(await quiet(), 240)).toBe(true);
  });

  it('answers from the signals that exist where some are missing', async () => {
    allOld();
    touch('.plot-worker.monitor.agent.jsonl', 300);
    fs.rmSync(path.join(desk, '.plot-worker.pass'));
    fs.rmSync(path.join(desk, '.plot-worker.log'));
    expect(near(await quiet(), 300)).toBe(true);
    for (const name of SIGNAL_FILES) fs.writeFileSync(path.join(desk, name), 'x\n');
  });

  it('answers null where no signal can be read', async () => {
    const bare = path.join(root, 'empty');
    fs.mkdirSync(bare);
    const answer = await treesGit({ repoRoot: desk, scriptDir }).logQuietSeconds!(bare);
    expect(answer).toEqual({ ok: true, value: null });
    expect(await treesGit({ repoRoot: desk, scriptDir }).logQuietSeconds!('')).toEqual({ ok: true, value: null });
  });
});
