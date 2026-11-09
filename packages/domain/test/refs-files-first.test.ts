import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { claimReleaseShell } from '../src/adapters/claim-release/claim-release-shell.js';
import type { RefFiles } from '../src/adapters/refs/ref-files-fs.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext, type ShellContext } from '../src/adapters/scripts.js';
import { treesGit } from '../src/adapters/trees/trees-git.js';
import { readRefSnapshot } from '../src/workflows/plan-walk-cache.js';
import { unaskable } from '../src/port-result.js';

// A `git` shim first on PATH records every git process the adapters start,
// including the ones a `bash -c` pipeline or a helper script starts.

const SCRIPTS = new URL('../../../skills/plot/scripts', import.meta.url).pathname;

let root = '';
let repo = '';
let log = '';
let context: ShellContext;
const savedPath = process.env['PATH'];

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  }).trim();

/** The git processes started since the last reset, one argv per line. */
const started = (): string[] => readFileSync(log, 'utf8').split('\n').filter((line) => line !== '');

/** A reader that answers `unaskable` to everything, as on a reftable repository. */
const refusing: RefFiles = {
  refState: () => unaskable('test'),
  defaultBranch: () => unaskable('test'),
  listBranches: () => unaskable('test'),
  branchTips: () => unaskable('test'),
  resolve: () => unaskable('test'),
  currentBranch: () => unaskable('test'),
  remoteHead: () => unaskable('test'),
  worktrees: () => unaskable('test'),
};

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'plot-files-first-')));
  repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'root');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(repo, 'update-ref', 'refs/remotes/origin/feature/a', 'HEAD');
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git(repo, 'branch', 'feature/a');
  git(repo, 'branch', 'feature/b');
  git(repo, 'branch', 'feature/c');
  git(repo, 'worktree', 'add', '-q', join(root, 'side'), 'feature/a');
  git(repo, 'pack-refs', '--all');

  const real = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = join(root, 'bin');
  mkdirSync(bin);
  log = join(root, 'git.log');
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  process.env['PATH'] = `${bin}:${savedPath ?? ''}`;
  context = { ...shellContext(repo), scriptDir: SCRIPTS };
});

afterAll(() => {
  process.env['PATH'] = savedPath;
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  writeFileSync(log, '');
});

describe('refsGit and treesGit read the ref files first', () => {
  it('answer every covered read with no git process', async () => {
    const refs = refsGit(context);
    const trees = treesGit(context);
    const head = git(repo, 'rev-parse', 'HEAD');
    writeFileSync(log, '');

    expect(await refs.defaultBranch()).toEqual({ ok: true, value: 'main' });
    expect(await refs.listBranches(false)).toEqual({ ok: true, value: ['feature/a', 'feature/b', 'feature/c', 'main'] });
    expect(await refs.listBranches(true)).toEqual({ ok: true, value: ['feature/a', 'main'] });
    expect(await refs.branchTips(['refs/remotes/origin/feature/*'])).toEqual({ ok: true, value: [{ branch: 'feature/a', sha: head }] });
    expect(await refs.resolve('origin/main')).toEqual({ ok: true, value: head });
    expect(await refs.resolve('no-such-ref')).toEqual({ ok: false, why: 'failed' });
    expect(await refs.currentBranch()).toEqual({ ok: true, value: 'main' });
    expect(await refs.remoteHead('feature/a')).toEqual({ ok: true, value: 'present' });
    expect(await refs.remoteHead('feature/z')).toEqual({ ok: true, value: 'absent' });
    const state = await refs.refState('both');
    expect(state.ok && state.value.map((one) => one.ref)).toContain('refs/heads/main');
    expect(refs.refStateSync('local')).toEqual(await refs.refState('local'));
    const listed = await trees.list();
    expect(listed.ok && listed.value.map((tree) => [tree.path, tree.branch, tree.isMain])).toEqual([
      [repo, 'main', true],
      [join(root, 'side'), 'feature/a', false],
    ]);
    expect(trees.listSync()).toEqual(listed);
    expect(await trees.forBranch('feature/a')).toEqual({ ok: true, value: listed.ok ? listed.value[1] : null });
    expect(await trees.presence('feature/b')).toEqual({ ok: true, value: 'absent' });

    expect(started()).toEqual([]);
  });

  it('fill the ref snapshot with no git process', async () => {
    const snapshot = await readRefSnapshot(refsGit(context));
    expect(snapshot.ok).toBe(true);
    expect(started()).toEqual([]);
  });

  it('ask git for every answer the reader leaves unaskable, and git answers', async () => {
    const refs = refsGit(context, undefined, undefined, refusing);
    const trees = treesGit(context, undefined, refusing);
    const viaFiles = refsGit(context);
    const head = git(repo, 'rev-parse', 'HEAD');
    writeFileSync(log, '');

    expect(await refs.defaultBranch()).toEqual({ ok: true, value: 'main' });
    expect(await refs.listBranches(true)).toEqual(await viaFiles.listBranches(true));
    expect(await refs.branchTips(['refs/heads/'])).toEqual(await viaFiles.branchTips(['refs/heads/']));
    expect(await refs.resolve('main')).toEqual({ ok: true, value: head });
    expect(await refs.currentBranch()).toEqual({ ok: true, value: 'main' });
    expect(await refs.remoteHead('main')).toEqual({ ok: true, value: 'present' });
    expect(await refs.refState('both')).toEqual(await viaFiles.refState('both'));
    expect(refs.refStateSync('remote')).toEqual(await viaFiles.refState('remote'));
    const listed = await trees.list();
    expect(listed.ok && listed.value.map((tree) => tree.path)).toEqual([repo, join(root, 'side')]);
    expect(trees.listSync()).toEqual(listed);

    const calls = started();
    for (const asked of [
      'symbolic-ref --quiet --short refs/remotes/origin/HEAD',
      'for-each-ref --format=%(refname:strip=3) refs/remotes/origin',
      'for-each-ref --format=%(refname:short)\t%(objectname) refs/heads/',
      'rev-parse main',
      'rev-parse --abbrev-ref HEAD',
      'rev-parse --verify --quiet refs/remotes/origin/main',
      'for-each-ref --format=%(refname) %(objectname) %(HEAD) refs/heads refs/remotes',
      'for-each-ref --format=%(refname) %(objectname) %(HEAD) refs/remotes/origin',
      'worktree list --porcelain',
    ]) {
      expect(calls, asked).toContain(asked);
    }
  });

  it('ask git for everything with no reader', async () => {
    const refs = refsGit(context, undefined, undefined, null);
    const trees = treesGit(context, undefined, null);
    expect(await refs.currentBranch()).toEqual({ ok: true, value: 'main' });
    expect((await trees.list()).ok).toBe(true);
    expect(started()).toEqual(['rev-parse --abbrev-ref HEAD', 'worktree list --porcelain']);
  });
});

describe('a destructive action keeps git with the file reader present', () => {
  it('deleteBranch, deleteRemoteBranch, removeOnly and removeWithBranch start git', async () => {
    const trees = treesGit(context);
    git(repo, 'worktree', 'add', '-q', join(root, 'gone'), 'feature/c');
    writeFileSync(log, '');

    await trees.deleteBranch('feature/b');
    await trees.deleteRemoteBranch('feature/a', '0'.repeat(40));
    await trees.removeOnly(join(root, 'gone'));
    await trees.removeWithBranch(join(root, 'never'), 'feature/c');

    expect(started()).toEqual([
      'branch -D feature/b',
      `push --force-with-lease=refs/heads/feature/a:${'0'.repeat(40)} origin --delete feature/a`,
      `worktree remove --force ${join(root, 'gone')}`,
      `worktree remove --force ${join(root, 'never')}`,
      'branch -D feature/c',
    ]);
  });

  it('the claim release starts git', () => {
    claimReleaseShell(context).release('feature/no-claim', { claimOnly: true });
    expect(started().length).toBeGreaterThan(0);
  });
});
