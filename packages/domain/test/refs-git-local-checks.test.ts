import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { refsGit } from '../src/adapters/refs/refs-git.js';

/**
 * The three readings `localChecks` takes from git, against a real repository:
 * the working tree's changes, the files naming a term, and the `-merge` paths.
 */

const git = (cwd: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd, stdio: 'ignore' });
};

let repo = '';

const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
};

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-refs-local-checks-'));
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  write('.gitattributes', 'skills/plot/scripts/board/*.mjs -merge\n');
  write('skills/plot/scripts/plot-reap.sh', 'echo reap\n');
  write('skills/plot/scripts/board/board-server.mjs', '// generated\n');
  write('test/reconcile/reap.test.mjs', "const s = 'plot-reap.sh';\n");
  write('test/reconcile/sub/deep.test.mjs', "const s = 'plot-reap.sh';\n");
  write('docs/note.md', 'plot-reap.sh is named here too\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'first']);
  // A modified file, a staged new file and an untracked one.
  write('skills/plot/scripts/plot-reap.sh', 'echo changed\n');
  write('staged.txt', 'x\n');
  git(repo, ['add', 'staged.txt']);
  write('untracked/new.sh', 'echo new\n');
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('refsGit: the local-checks readings', () => {
  it('workingChanges lists modified, staged and untracked paths', async () => {
    const result = await refsGit({ repoRoot: repo, scriptDir: repo }).workingChanges();
    expect(result.ok && [...result.value].sort()).toEqual([
      'skills/plot/scripts/plot-reap.sh',
      'staged.txt',
      'untracked/new.sh',
    ]);
  });

  it('filesNaming searches only under the globs, with `*` inside one segment', async () => {
    const refs = refsGit({ repoRoot: repo, scriptDir: repo });
    const one = await refs.filesNaming('plot-reap.sh', ['test/reconcile/*.test.mjs']);
    expect(one.ok && one.value).toEqual(['test/reconcile/reap.test.mjs']);
    const deep = await refs.filesNaming('plot-reap.sh', ['test/**/*.test.mjs']);
    expect(deep.ok && [...deep.value].sort()).toEqual(['test/reconcile/reap.test.mjs', 'test/reconcile/sub/deep.test.mjs']);
  });

  it('filesNaming answers an empty list when nothing matches, and for no globs', async () => {
    const refs = refsGit({ repoRoot: repo, scriptDir: repo });
    const none = await refs.filesNaming('no-such-name.sh', ['test/**/*.test.mjs']);
    expect(none).toEqual({ ok: true, value: [] });
    expect(await refs.filesNaming('plot-reap.sh', [])).toEqual({ ok: true, value: [] });
  });

  it('mergeUnset names the paths .gitattributes marks -merge', async () => {
    const result = await refsGit({ repoRoot: repo, scriptDir: repo }).mergeUnset([
      'skills/plot/scripts/board/board-server.mjs',
      'skills/plot/scripts/plot-reap.sh',
    ]);
    expect(result.ok && result.value).toEqual(['skills/plot/scripts/board/board-server.mjs']);
  });
});
