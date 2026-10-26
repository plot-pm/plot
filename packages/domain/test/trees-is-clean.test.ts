import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { treesGit } from '../src/adapters/trees/trees-git.js';

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

let repo = '';
let shimDir = '';
let argvLog = '';
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
const originalPath = process.env.PATH;

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-is-clean-')));
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'first']);

  // A `git` that records its argv and runs the real one: the lock flag is an
  // argument, and nothing but the argument list shows it was passed.
  shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-is-clean-shim-'));
  argvLog = path.join(shimDir, 'argv.log');
  const shim = path.join(shimDir, 'git');
  fs.writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${argvLog}'\nexec '${realGit}' "$@"\n`);
  fs.chmodSync(shim, 0o755);
});

afterAll(() => {
  process.env.PATH = originalPath;
  for (const dir of [repo, shimDir]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const trees = () => treesGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });

describe('Trees.isClean', () => {
  it('reports clean where the tree holds only untracked files', async () => {
    fs.writeFileSync(path.join(repo, 'scratch.tmp'), 'untracked\n');
    expect(await trees().isClean(repo)).toEqual({ ok: true, value: true });
    fs.rmSync(path.join(repo, 'scratch.tmp'));
  });

  it('reports dirty where a tracked file is modified', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
    expect(await trees().isClean(repo)).toEqual({ ok: true, value: false });
    git(repo, ['checkout', '--', 'a.txt']);
  });

  it('runs git status with --no-optional-locks', async () => {
    process.env.PATH = `${shimDir}${path.delimiter}${originalPath}`;
    try {
      await trees().isClean(repo);
    } finally {
      process.env.PATH = originalPath;
    }
    const calls = fs.readFileSync(argvLog, 'utf8').split('\n').filter((l) => l.includes(' status '));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^--no-optional-locks /);
    expect(calls[0]).toContain('--untracked-files=no');
  });
});
