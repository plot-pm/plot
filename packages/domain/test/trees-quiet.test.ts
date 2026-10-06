import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { treesFixture } from '../src/adapters/trees/trees-fixture.js';
import { treesGit } from '../src/adapters/trees/trees-git.js';

/**
 * `quietSeconds` and `hasCommits` against a REAL repository, for the reason
 * `trees-reads.test.ts` gives: each answer is a git invocation, and a wrong
 * flag or a misread exit code survives a mock.
 */
const scriptDir = path.join(fileURLToPath(new URL('../../..', import.meta.url)), 'skills', 'plot', 'scripts');
const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

let root = '';
let desk = '';
let bare = '';

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-trees-quiet-')));
  bare = path.join(root, 'origin.git');
  desk = path.join(root, 'desk');
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare]);
  git(root, ['clone', '--quiet', bare, desk]);
  git(desk, ['config', 'user.email', 'test@example.com']);
  git(desk, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(desk, 'a.txt'), 'one\n');
  git(desk, ['add', '-A']);
  git(desk, ['commit', '--quiet', '-m', 'first']);
  git(desk, ['push', '--quiet', 'origin', 'HEAD:main']);
  git(desk, ['fetch', '--quiet', 'origin']);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const trees = () => treesGit({ repoRoot: desk, scriptDir });

describe('treesGit().quietSeconds', () => {
  it('answers null for an empty path and for a path that is not a directory', async () => {
    expect(await trees().quietSeconds('')).toEqual({ ok: true, value: null });
    expect(await trees().quietSeconds(path.join(root, 'nothing-here'))).toEqual({ ok: true, value: null });
  });

  it('reads the age of the last commit on a clean tree', async () => {
    const answer = await trees().quietSeconds(desk);
    expect(answer.ok && answer.value !== null && answer.value >= 0).toBe(true);
  });

  it('reads a freshly edited file, a nested one and a rename as recent', async () => {
    fs.mkdirSync(path.join(desk, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(desk, 'sub', 'new.txt'), 'x\n');
    fs.writeFileSync(path.join(desk, 'a.txt'), 'two\n');
    git(desk, ['mv', 'a.txt', 'b.txt']);
    const answer = await trees().quietSeconds(desk);
    expect(answer.ok && answer.value !== null && answer.value <= 5).toBe(true);
    git(desk, ['mv', 'b.txt', 'a.txt']);
    git(desk, ['checkout', '--', 'a.txt']);
    fs.rmSync(path.join(desk, 'sub'), { recursive: true, force: true });
  });

  it('skips a deleted path, whose mtime cannot be read', async () => {
    fs.rmSync(path.join(desk, 'a.txt'));
    const answer = await trees().quietSeconds(desk);
    expect(answer.ok && answer.value !== null).toBe(true);
    git(desk, ['checkout', '--', 'a.txt']);
  });
});

describe('treesGit().hasCommits', () => {
  it('is unanswerable for an empty path and for a path that is not a directory', async () => {
    expect(await trees().hasCommits('')).toEqual({ ok: true, value: 'unanswerable' });
    expect(await trees().hasCommits(path.join(root, 'nothing-here'))).toEqual({ ok: true, value: 'unanswerable' });
  });

  it('answers no while the branch holds only an empty claim commit', async () => {
    git(desk, ['commit', '--quiet', '--allow-empty', '-m', 'claim']);
    expect(await trees().hasCommits(desk)).toEqual({ ok: true, value: 'no' });
  });

  it('answers yes once a commit touched a file', async () => {
    fs.writeFileSync(path.join(desk, 'work.txt'), 'w\n');
    git(desk, ['add', '-A']);
    git(desk, ['commit', '--quiet', '-m', 'work']);
    expect(await trees().hasCommits(desk)).toEqual({ ok: true, value: 'yes' });
  });

  it('reads origin/HEAD where the clone names one', async () => {
    git(desk, ['remote', 'set-head', 'origin', 'main']);
    expect(await trees().hasCommits(desk)).toEqual({ ok: true, value: 'yes' });
  });

  it('is unanswerable where no origin/<default> ref exists', async () => {
    const lone = path.join(root, 'lone');
    git(root, ['init', '--quiet', '--initial-branch=main', lone]);
    expect(await trees().hasCommits(lone)).toEqual({ ok: true, value: 'unanswerable' });
  });

  it('is unanswerable where the base ref cannot be counted against', async () => {
    const odd = path.join(root, 'odd');
    git(root, ['init', '--quiet', '--initial-branch=main', odd]);
    git(odd, ['config', 'user.email', 'test@example.com']);
    git(odd, ['config', 'user.name', 'Test']);
    git(odd, ['commit', '--quiet', '--allow-empty', '-m', 'one']);
    git(odd, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(odd, ['checkout', '--quiet', '--orphan', 'other']);
    git(odd, ['commit', '--quiet', '--allow-empty', '-m', 'unrelated']);
    expect((await trees().hasCommits(odd)).ok).toBe(true);
  });
});

describe('treesFixture quiet and commits', () => {
  const fixture = treesFixture({ quiet: { '/a': 12, '/b': null }, commits: { '/a': 'yes' } });

  it('answers the table and reads an absent path as nothing to read', async () => {
    expect(await fixture.quietSeconds('/a')).toEqual({ ok: true, value: 12 });
    expect(await fixture.quietSeconds('/b')).toEqual({ ok: true, value: null });
    expect(await fixture.quietSeconds('/c')).toEqual({ ok: true, value: null });
  });

  it('answers unanswerable for a path the table does not name', async () => {
    expect(await fixture.hasCommits('/a')).toEqual({ ok: true, value: 'yes' });
    expect(await fixture.hasCommits('/c')).toEqual({ ok: true, value: 'unanswerable' });
  });
});
