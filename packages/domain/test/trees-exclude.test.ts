import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shellContext } from '../src/adapters/scripts.js';
import { treesFixture } from '../src/adapters/trees/trees-fixture.js';
import { treesGit } from '../src/adapters/trees/trees-git.js';

/**
 * `mainRoot` and `excludePath` against a REAL repository and a linked
 * worktree: each answer is a git invocation, and a wrong flag survives a mock.
 */
const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

let root = '';
let main = '';
let linked = '';

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'plot-trees-exclude-')));
  main = join(root, 'main');
  linked = join(root, 'linked');
  git(root, ['init', '--quiet', '--initial-branch=main', main]);
  git(main, ['config', 'user.email', 'test@example.com']);
  git(main, ['config', 'user.name', 'Test']);
  git(main, ['commit', '--quiet', '--allow-empty', '-m', 'first']);
  git(main, ['worktree', 'add', '--quiet', '-b', 'side', linked]);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const excludeFile = () => join(main, '.git', 'info', 'exclude');
const linesOf = () => readFileSync(excludeFile(), 'utf8').split('\n').filter((l) => l === '.worktrees/');

describe('treesGit.mainRoot', () => {
  it('names the main checkout from the main checkout and from a linked worktree', async () => {
    const trees = treesGit(shellContext(main));
    expect(await trees.mainRoot(main)).toEqual({ ok: true, value: main });
    expect(await trees.mainRoot(linked)).toEqual({ ok: true, value: main });
  });

  it('fails outside a repository', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'plot-trees-outside-')));
    try {
      expect((await treesGit(shellContext(main)).mainRoot(outside)).ok).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('treesGit.excludePath', () => {
  it('appends the line once and leaves the file alone on a second call', async () => {
    const trees = treesGit(shellContext(main));
    expect((await trees.excludePath(main, '.worktrees/')).ok).toBe(true);
    expect(linesOf()).toEqual(['.worktrees/']);
    expect((await trees.excludePath(main, '.worktrees/')).ok).toBe(true);
    expect(linesOf()).toEqual(['.worktrees/']);
    expect(git(main, ['check-ignore', '.worktrees/']).trim()).toBe('.worktrees/');
  });

  it('writes through a linked worktree to the shared exclude file', async () => {
    const trees = treesGit(shellContext(main));
    expect((await trees.excludePath(linked, '.desks/')).ok).toBe(true);
    expect(readFileSync(excludeFile(), 'utf8')).toContain('.desks/\n');
  });

  it('writes nothing for a line .gitignore already carries', async () => {
    writeFileSync(join(main, '.gitignore'), 'scratch/\n');
    const before = readFileSync(excludeFile(), 'utf8');
    expect((await treesGit(shellContext(main)).excludePath(main, 'scratch/')).ok).toBe(true);
    expect(readFileSync(excludeFile(), 'utf8')).toBe(before);
  });

  it('starts a new line when the file ends without a newline', async () => {
    writeFileSync(excludeFile(), '# only\nkeep');
    expect((await treesGit(shellContext(main)).excludePath(main, 'tail/')).ok).toBe(true);
    expect(readFileSync(excludeFile(), 'utf8')).toBe('# only\nkeep\ntail/\n');
  });
});

describe('treesFixture: mainRoot and excludePath', () => {
  it('records an exclusion once and answers the root', async () => {
    const excludes: { path: string; line: string }[] = [];
    const trees = treesFixture({
      mainRoot: '/main',
      ignored: ['seen/'],
      calls: { resets: [], commits: [], pushes: [], commitsAs: [], stages: [], excludes },
    });
    expect(await trees.mainRoot('/linked')).toEqual({ ok: true, value: '/main' });
    await trees.excludePath('/main', 'seen/');
    await trees.excludePath('/main', 'new/');
    await trees.excludePath('/main', 'new/');
    expect(excludes).toEqual([{ path: '/main', line: 'new/' }]);
  });
});
