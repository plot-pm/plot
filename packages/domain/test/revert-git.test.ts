import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { revertGit } from '../src/adapters/revert/revert-git.js';

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();

let repo = '';

const write = (file: string, text: string): void => fs.writeFileSync(path.join(repo, file), text);
const commit = (message: string): string => {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
};

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-revert-')));
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  write('a.txt', 'one\n');
  commit('first');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const port = () => revertGit({ repoRoot: repo, scriptDir: repo });

describe('revertGit.revertCommit', () => {
  it('reverts a squash landing', async () => {
    write('a.txt', 'one\ntwo\n');
    const squash = commit('Break it (#12)');
    const answer = await port().revertCommit(repo, squash);
    expect(answer).toEqual({ ok: true, value: 'reverted' });
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('one\n');
    expect(git(repo, ['log', '-1', '--format=%B'])).toContain(`This reverts commit ${squash}`);
  });

  it('reverts a merge-commit landing against the first parent', async () => {
    git(repo, ['checkout', '--quiet', '-b', 'feature/x']);
    write('b.txt', 'branch\n');
    commit('work');
    git(repo, ['checkout', '--quiet', 'main']);
    git(repo, ['merge', '--no-ff', '--quiet', '-m', 'Merge pull request #12 from o/feature/x', 'feature/x']);
    const merge = git(repo, ['rev-parse', 'HEAD']);
    const answer = await port().revertCommit(repo, merge);
    expect(answer).toEqual({ ok: true, value: 'reverted' });
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(false);
  });

  it('aborts and answers conflict where a later commit touches the same lines', async () => {
    write('a.txt', 'broken\n');
    const breaking = commit('Break it (#12)');
    write('a.txt', 'changed again\n');
    const head = commit('Later work');
    const answer = await port().revertCommit(repo, breaking);
    expect(answer).toEqual({ ok: true, value: 'conflict' });
    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(head);
    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('answers failed for a sha git does not know', async () => {
    expect(await port().revertCommit(repo, 'f'.repeat(40))).toEqual({ ok: false, why: 'failed' });
  });
});

describe('revertGit.isReverted', () => {
  it('reads a revert commit on the ref, and its absence', async () => {
    write('a.txt', 'one\ntwo\n');
    const breaking = commit('Break it (#12)');
    expect(await port().isReverted(breaking, 'main')).toEqual({ ok: true, value: false });
    await port().revertCommit(repo, breaking);
    expect(await port().isReverted(breaking, 'main')).toEqual({ ok: true, value: true });
  });
});
