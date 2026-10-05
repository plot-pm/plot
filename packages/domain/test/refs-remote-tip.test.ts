import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { refsGit } from '../src/adapters/refs/refs-git.js';

/**
 * `remoteTip` against a REAL remote, the way `refs-git-reads.test.ts` tests
 * every other git question — a mock of `git ls-remote` would assert this
 * file's own argument list rather than the behaviour.
 */
const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

let origin = '';
let clone = '';
let pushedSha = '';

beforeAll(() => {
  origin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-remote-tip-origin-'));
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main'], { cwd: origin });

  clone = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-remote-tip-clone-'));
  execFileSync('git', ['clone', '--quiet', origin, clone]);
  git(clone, ['config', 'user.email', 'test@example.com']);
  git(clone, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(clone, 'a.txt'), 'a\n');
  git(clone, ['add', '-A']);
  git(clone, ['commit', '--quiet', '-m', 'first']);
  git(clone, ['push', '--quiet', 'origin', 'main']);
  pushedSha = git(clone, ['rev-parse', 'HEAD']).trim();
});

afterAll(() => {
  if (origin) fs.rmSync(origin, { recursive: true, force: true });
  if (clone) fs.rmSync(clone, { recursive: true, force: true });
});

const refs = () => refsGit({ repoRoot: clone, scriptDir: path.join(clone, 'scripts') });

describe('refsGit.remoteTip', () => {
  it('answers `pushed` when the remote tip still equals the pushed commit', async () => {
    const result = await refs().remoteTip('main', pushedSha);
    expect(result).toEqual({ ok: true, value: 'pushed' });
  });

  it('answers `other` when a different commit sits at the remote tip', async () => {
    // A SECOND PARTY PUSHES ON TOP — the #1199 shape: another push lands after
    // the one this caller is asking about.
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-remote-tip-second-'));
    execFileSync('git', ['clone', '--quiet', origin, second]);
    execFileSync('git', ['config', 'user.email', 'other@example.com'], { cwd: second });
    execFileSync('git', ['config', 'user.name', 'Other'], { cwd: second });
    fs.writeFileSync(path.join(second, 'b.txt'), 'b\n');
    execFileSync('git', ['add', '-A'], { cwd: second });
    execFileSync('git', ['commit', '--quiet', '-m', 'second'], { cwd: second });
    execFileSync('git', ['push', '--quiet', 'origin', 'main'], { cwd: second });
    fs.rmSync(second, { recursive: true, force: true });

    const result = await refs().remoteTip('main', pushedSha);
    expect(result).toEqual({ ok: true, value: 'other' });
  });

  it('answers `unknown`, never `other`, when the remote cannot be reached', async () => {
    const unreachable = refsGit({
      repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'plot-remote-tip-unreachable-')),
      scriptDir: '/nonexistent/scripts',
    });
    // A REMOTE NAMED `origin` THAT DOES NOT EXIST: `git ls-remote` fails
    // outright, which is the read this operation must answer `unknown` for —
    // never `other`, because a failure to observe is not evidence the tip
    // moved.
    const result = await unreachable.remoteTip('main', pushedSha);
    expect(result).toEqual({ ok: true, value: 'unknown' });
  });
});
