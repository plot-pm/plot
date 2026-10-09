// `readResetRefusals` against real git, after a rejected claim push: the desk
// keeps its unpushed claim commit, `push -u` set no upstream, and the
// rejection's `fetchRemoteHead` created `refs/remotes/origin/<branch>`. The
// next assignment's reset must not be refused over that claim commit, as
// `desk_reset_refusal` (`plot-worker-loop.sh`) does not refuse it.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refsGit, refsRemoteGit, treesGit } from '@plot-pm/domain/adapters';
import { readResetRefusals } from '../../src/server/entry/worker-loop.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmTree(dir);
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const identify = (repo: string): void => {
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
};

/** A bare origin holding `main` and `taken`, and a clone whose desk claimed `taken` and was rejected. */
const rejectedClaim = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-reset-refusal-'));
  made.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const other = path.join(root, 'other');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, work);
  identify(work);
  git(work, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(work, 'push', '-q', 'origin', 'main');

  git(root, 'clone', '-q', origin, other);
  identify(other);
  git(other, 'checkout', '-q', '-b', 'taken');
  git(other, 'commit', '-q', '--allow-empty', '-m', 'plot: claim taken (the other agent)');
  git(other, 'push', '-q', 'origin', 'taken');

  const desk = path.join(root, 'desk');
  // The base detached, then the branch: `resetOnto`'s two steps, which set no upstream.
  git(work, 'worktree', 'add', '-q', '--detach', desk, 'origin/main');
  git(desk, 'checkout', '-q', '-b', 'taken');
  git(desk, 'commit', '-q', '--allow-empty', '-m', 'plot: claim taken');
  expect(() => git(desk, 'push', '-qu', 'origin', 'taken')).toThrow();
  return { work, desk };
};

describe('readResetRefusals after a rejected claim push', () => {
  it('does not refuse the next reset over the unpushed claim commit', async () => {
    const { work, desk } = rejectedClaim();
    const context = { repoRoot: work, scriptDir: SCRIPTS };
    expect(await refsRemoteGit(context).fetchRemoteHead('taken')).toEqual({ ok: true, value: 'present' });
    // The origin ref now exists and the claim commit is not on it.
    expect(refsGit(context).countAheadSync('taken')).toEqual({ ok: true, value: 1 });

    // Every reading answers, so an empty list is the refusals' answer and not a failed read.
    expect(await treesGit(context).dirtyPaths(desk)).toEqual({ ok: true, value: [] });
    expect(await readResetRefusals({ trees: treesGit(context) }, desk)).toEqual([]);
  });

  it('still refuses a desk whose upstream is behind its HEAD', async () => {
    const { work, desk } = rejectedClaim();
    const context = { repoRoot: work, scriptDir: SCRIPTS };
    git(desk, 'checkout', '-q', '-b', 'mine', 'origin/main');
    git(desk, 'push', '-qu', 'origin', 'mine');
    git(desk, 'commit', '-q', '--allow-empty', '-m', 'work');

    expect(await readResetRefusals({ trees: treesGit(context) }, desk)).toEqual(['unpushed-commits']);
  });
});
