import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stateHomeAtSync } from '../src/adapters/main-checkout.js';
import { processAnswers } from '../src/adapters/git-dirs/git-dirs.js';
import { runProcess } from '../src/adapters/run-script.js';
import { stateHomeAt } from '../src/adapters/state-home/state-home-git.js';

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
};

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'state-home-')));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const repoWithWorktree = (): { main: string; desk: string } => {
  const main = join(dir, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const desk = join(main, '.worktrees', 'desk');
  git(main, 'worktree', 'add', '-q', '-b', 'slice', desk);
  return { main, desk };
};

const submodule = (): string => {
  const lib = join(dir, 'lib');
  mkdirSync(lib);
  git(lib, 'init', '-q', '-b', 'main');
  git(lib, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  git(workspace, 'init', '-q', '-b', 'main');
  git(workspace, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'app/web');
  return join(workspace, 'app', 'web');
};

describe.each([
  ['stateHomeAt', stateHomeAt],
  ['stateHomeAtSync', (root: string) => Promise.resolve(stateHomeAtSync(root))],
] as const)('%s', (_name, homeOf) => {
  it('answers the main checkout for the main checkout', async () => {
    const { main } = repoWithWorktree();
    expect(await homeOf(main)).toEqual({ home: main });
  });

  it('answers the main checkout for a linked worktree', async () => {
    const { main, desk } = repoWithWorktree();
    expect(await homeOf(desk)).toEqual({ home: main });
  });

  it('answers the submodule working tree for a submodule', async () => {
    const web = submodule();
    expect(await homeOf(web)).toEqual({ home: web });
  });

  it('answers unread for a directory outside any repository', async () => {
    expect(await homeOf(dir)).toEqual({ unread: true });
  });

  it('answers unread for a separate git directory', async () => {
    const work = join(dir, 'work');
    mkdirSync(work);
    git(dir, 'init', '-q', '--separate-git-dir', join(dir, 'store'), work);
    expect(await homeOf(work)).toEqual({ unread: true });
  });
});

describe('stateHomeAt and core.worktree', () => {
  const counting = () => {
    const calls: string[][] = [];
    const run: typeof runProcess = (command, args, options) => {
      calls.push([command, ...args]);
      return runProcess(command, args, options);
    };
    return { calls, run };
  };
  const configCalls = (calls: string[][]) => calls.filter((call) => call.includes('config'));

  it('starts no git config for a normal checkout', async () => {
    const { main } = repoWithWorktree();
    const { calls, run } = counting();
    expect(await stateHomeAt(main, processAnswers, run)).toEqual({ home: main });
    expect(configCalls(calls)).toEqual([]);
  });

  it('starts no git config for a linked desk', async () => {
    const { main, desk } = repoWithWorktree();
    const { calls, run } = counting();
    expect(await stateHomeAt(desk, processAnswers, run)).toEqual({ home: main });
    expect(configCalls(calls)).toEqual([]);
  });

  it('starts one git config for a submodule', async () => {
    const web = submodule();
    const { calls, run } = counting();
    expect(await stateHomeAt(web, processAnswers, run)).toEqual({ home: web });
    expect(configCalls(calls)).toHaveLength(1);
  });

  it('answers unread where git config fails with an exit other than 1', async () => {
    const web = submodule();
    const run: typeof runProcess = () => Promise.resolve({ code: 3, stdout: '', stderr: 'bad config' });
    expect(await stateHomeAt(web, processAnswers, run)).toEqual({ unread: true });
  });

  it('answers unread where core.worktree names no directory', async () => {
    const web = submodule();
    const run: typeof runProcess = () => Promise.resolve({ code: 0, stdout: '../../../../gone\n', stderr: '' });
    expect(await stateHomeAt(web, processAnswers, run)).toEqual({ unread: true });
  });
});
