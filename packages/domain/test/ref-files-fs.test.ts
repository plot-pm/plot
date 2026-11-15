import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nodeRefFs, refFilesFs, type RefFs } from '../src/adapters/refs/ref-files-fs.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

let home = '';
let repo = '';
let dotGit = '';

const put = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'plot-ref-files-fs-')));
  repo = join(home, 'repo');
  dotGit = join(repo, '.git');
  put(join(dotGit, 'config'), '[core]\n\tbare = false\n');
  put(join(dotGit, 'HEAD'), 'ref: refs/heads/main\n');
  put(join(dotGit, 'refs/heads/main'), `${A}\n`);
  put(join(dotGit, 'refs/remotes/origin/HEAD'), 'ref: refs/remotes/origin/main\n');
  put(join(dotGit, 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted \n${B} refs/remotes/origin/main\n${C} refs/tags/v1.0\n^${A}\n`);
});

afterEach(() => {
  if (home !== '') rmSync(home, { recursive: true, force: true });
});

/** The node file system with a `packed-refs` stamp that changes on the reads `changes` names. */
const stampChanging = (changes: (call: number) => boolean): RefFs => {
  let call = 0;
  return {
    ...nodeRefFs,
    stamp: (path) => {
      call += 1;
      return changes(call) ? `changed-${call}` : nodeRefFs.stamp(path);
    },
  };
};

describe('refFilesFs, the packed-refs retry', () => {
  it('retries once where packed-refs changes between the stamps, and answers', () => {
    // Call 2 is the stamp after the first read; calls 3 and 4 bracket the retry.
    const reader = refFilesFs(repo, stampChanging((call) => call === 2), {});
    expect(reader.resolve('origin/main')).toEqual({ ok: true, value: B });
  });

  it('answers unaskable where packed-refs changes during the retry too', () => {
    const reader = refFilesFs(repo, stampChanging((call) => call % 2 === 0), {});
    expect(reader.refState('both')).toEqual({ ok: false, why: 'unaskable', reason: 'packed-refs changed during two reads' });
  });
});

describe('refFilesFs, what it answers', () => {
  it('answers each Refs method from the files', () => {
    const reader = refFilesFs(repo, undefined, {});
    expect(reader.refState('both')).toEqual({
      ok: true,
      value: [
        { ref: 'refs/heads/main', sha: A, head: true },
        { ref: 'refs/remotes/origin/HEAD', sha: B },
        { ref: 'refs/remotes/origin/main', sha: B },
      ],
    });
    expect(reader.defaultBranch()).toEqual({ ok: true, value: 'main' });
    expect(reader.listBranches(true)).toEqual({ ok: true, value: ['main'] });
    expect(reader.branchTips(['refs/heads/'])).toEqual({ ok: true, value: [{ branch: 'main', sha: A }] });
    expect(reader.branchTips(['refs/heads/[m]'])).toMatchObject({ ok: false, why: 'unaskable' });
    expect(reader.currentBranch()).toEqual({ ok: true, value: 'main' });
    expect(reader.resolve('v1.0')).toEqual({ ok: true, value: C });
    expect(reader.resolve('nothing')).toEqual({ ok: false, why: 'failed' });
    expect(reader.resolve('main~1')).toMatchObject({ ok: false, why: 'unaskable' });
    expect(reader.remoteHead('main')).toEqual({ ok: true, value: 'present' });
    expect(reader.remoteHead('gone')).toEqual({ ok: true, value: 'absent' });
    expect(reader.remoteHead('a..b')).toMatchObject({ ok: false, why: 'unaskable' });
  });

  it('answers unaskable where origin/HEAD dangles or HEAD names an unborn branch', () => {
    put(join(dotGit, 'refs/remotes/origin/HEAD'), 'ref: refs/remotes/origin/gone\n');
    put(join(dotGit, 'HEAD'), 'ref: refs/heads/unborn\n');
    const reader = refFilesFs(repo, undefined, {});
    expect(reader.defaultBranch()).toMatchObject({ ok: false, why: 'unaskable' });
    expect(reader.currentBranch()).toMatchObject({ ok: false, why: 'unaskable' });
    expect(reader.listBranches(true)).toMatchObject({ ok: false, why: 'unaskable' });
    expect(reader.refState('remote')).toMatchObject({ ok: false, why: 'unaskable' });
  });

  it('reads per-worktree refs from the linked worktree own git directory', () => {
    const own = join(dotGit, 'worktrees', 'wt');
    put(join(own, 'HEAD'), `${C}\n`);
    put(join(own, 'commondir'), '../..\n');
    put(join(own, 'refs/bisect/bad'), `${B}\n`);
    put(join(dotGit, 'refs/bisect/bad'), `${A}\n`);
    put(join(home, 'wt', '.git'), `gitdir: ${own}\n`);
    const reader = refFilesFs(join(home, 'wt'), undefined, {});
    expect(reader.resolve('refs/bisect/bad')).toEqual({ ok: true, value: B });
    expect(reader.currentBranch()).toEqual({ ok: true, value: 'HEAD' });
    expect(reader.resolve('main')).toEqual({ ok: true, value: A });
  });

  it('reads a linked worktree with no commondir file as its own common directory', () => {
    const own = join(home, 'solo.git');
    put(join(own, 'config'), '');
    put(join(own, 'HEAD'), `${A}\n`);
    put(join(home, 'solo', '.git'), `gitdir: ${own}\n`);
    expect(refFilesFs(join(home, 'solo'), undefined, {}).resolve('HEAD')).toEqual({ ok: true, value: A });
  });

  it('skips a loose file whose name git refuses and a ref deleted during the scan', () => {
    put(join(dotGit, 'refs/heads/main.lock'), `${B}\n`);
    put(join(dotGit, 'refs/heads/vanishing'), `${B}\n`);
    const fs: RefFs = { ...nodeRefFs, read: (path) => (path.endsWith('vanishing') ? undefined : nodeRefFs.read(path)) };
    expect(refFilesFs(repo, fs, {}).listBranches(false)).toEqual({ ok: true, value: ['main'] });
  });
});

describe('refFilesFs, where git answers instead', () => {
  const everyMethod = (dir: string, env: Record<string, string> = {}) => {
    const reader = refFilesFs(dir, undefined, env);
    return [
      reader.refState('both'),
      reader.defaultBranch(),
      reader.listBranches(false),
      reader.branchTips(['refs/heads/']),
      reader.resolve('main'),
      reader.currentBranch(),
      reader.remoteHead('main'),
      reader.worktrees(),
    ];
  };

  it('answers unaskable on every method for a reftable repository', () => {
    put(join(dotGit, 'config'), '[core]\n\tbare = false\n[extensions]\n\trefStorage = reftable\n');
    for (const result of everyMethod(repo)) {
      expect(result).toEqual({ ok: false, why: 'unaskable', reason: 'extensions.refStorage is reftable' });
    }
  });

  it('answers unaskable where the environment moves the git directory', () => {
    for (const result of everyMethod(repo, { GIT_DIR: dotGit })) {
      expect(result).toEqual({ ok: false, why: 'unaskable', reason: 'the environment sets a git directory' });
    }
  });

  it('answers unaskable with no readable .git, no gitdir line and no config', () => {
    expect(everyMethod(join(home, 'none'))[0]).toMatchObject({ reason: 'no readable .git' });
    put(join(home, 'odd', '.git'), 'not a pointer\n');
    expect(everyMethod(join(home, 'odd'))[7]).toMatchObject({ reason: 'no readable .git' });
    rmSync(join(dotGit, 'config'));
    expect(everyMethod(repo)[0]).toMatchObject({ reason: 'no readable config' });
  });

  it('answers unaskable where a loose ref, HEAD or packed-refs does not parse', () => {
    put(join(dotGit, 'refs/heads/broken'), 'junk\n');
    expect(everyMethod(repo)[0]).toMatchObject({ reason: 'a loose ref does not parse' });
    rmSync(join(dotGit, 'refs/heads/broken'));
    put(join(dotGit, 'refs/worktree/broken'), 'junk\n');
    expect(everyMethod(repo)[0]).toMatchObject({ reason: 'a loose ref does not parse' });
    rmSync(join(dotGit, 'refs/worktree/broken'));
    put(join(dotGit, 'HEAD'), 'junk\n');
    expect(everyMethod(repo)[0]).toMatchObject({ reason: 'HEAD does not parse' });
    put(join(dotGit, 'HEAD'), 'ref: refs/heads/main\n');
    put(join(dotGit, 'packed-refs'), `^${A}\n`);
    expect(everyMethod(repo)[0]).toMatchObject({ reason: 'packed-refs does not parse' });
  });
});

describe('refFilesFs().worktrees', () => {
  const linked = (id: string, gitdir: string | undefined, head = 'ref: refs/heads/topic\n'): string => {
    const own = join(dotGit, 'worktrees', id);
    put(join(own, 'HEAD'), head);
    if (gitdir !== undefined) put(join(own, 'gitdir'), `${gitdir}\n`);
    return own;
  };

  it('lists the main checkout first and each linked worktree, absolute and relative', () => {
    linked('abs', join(home, 'abs', '.git'));
    put(join(home, 'abs', '.git'), 'gitdir: x\n');
    linked('rel', '../../../../rel/.git');
    put(join(home, 'rel', '.git'), 'gitdir: x\n');
    linked('gone', '../../../../gone/.git');
    linked('none', undefined);
    put(join(dotGit, 'worktrees', 'stray-file'), '');
    const trees = refFilesFs(repo, undefined, {}).worktrees();
    expect(trees.ok && trees.value.map((tree) => [tree.path, tree.isMain, tree.prunable])).toEqual([
      [repo, true, false],
      [join(home, 'abs'), false, false],
      [join(home, 'gone'), false, true],
      [join(home, 'rel'), false, false],
    ]);
  });

  it('reads the main checkout through a symlinked path as git does, physically', () => {
    symlinkSync(repo, join(home, 'link'));
    const trees = refFilesFs(join(home, 'link'), undefined, {}).worktrees();
    expect(trees.ok && trees.value[0]?.path).toBe(repo);
  });

  it('answers unaskable for a bare repository, a common directory not named .git and an unreadable HEAD', () => {
    put(join(dotGit, 'config'), '[core]\n\tbare = true\n');
    expect(refFilesFs(repo, undefined, {}).worktrees()).toMatchObject({ reason: 'the repository is bare' });

    put(join(home, 'sep.git', 'config'), '');
    put(join(home, 'sep', '.git'), `gitdir: ${join(home, 'sep.git')}\n`);
    expect(refFilesFs(join(home, 'sep'), undefined, {}).worktrees()).toMatchObject({
      reason: 'the common git directory is not a checkout .git',
    });
    expect(refFilesFs(join(home, 'sep'), { ...nodeRefFs, real: () => undefined }, {}).worktrees()).toMatchObject({
      reason: 'the common git directory is not a checkout .git',
    });

    put(join(dotGit, 'config'), '');
    linked('bad', join(home, 'bad', '.git'), 'junk\n');
    expect(refFilesFs(repo, undefined, {}).worktrees()).toMatchObject({ reason: 'a worktree HEAD does not parse' });
  });
});

describe('nodeRefFs', () => {
  it('answers undefined and empty for paths that are absent', () => {
    const missing = join(home, 'missing');
    expect(nodeRefFs.read(missing)).toBeUndefined();
    expect(nodeRefFs.kind(missing)).toBeUndefined();
    expect(nodeRefFs.stamp(missing)).toBeUndefined();
    expect(nodeRefFs.list(missing)).toEqual([]);
    expect(nodeRefFs.real(missing)).toBeUndefined();
  });

  it('reads present paths', () => {
    expect(nodeRefFs.kind(dotGit)).toBe('dir');
    expect(nodeRefFs.kind(join(dotGit, 'HEAD'))).toBe('file');
    expect(nodeRefFs.stamp(join(dotGit, 'HEAD'))).toMatch(/^\d+:\d+:\d+$/);
    expect(nodeRefFs.real(dotGit)).toBe(dotGit);
  });
});
