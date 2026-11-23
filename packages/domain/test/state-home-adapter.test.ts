import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stateHomeAtSync } from '../src/adapters/main-checkout.js';
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
