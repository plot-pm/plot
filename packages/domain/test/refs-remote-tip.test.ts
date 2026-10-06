import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { refsGit } from '../src/adapters/refs/refs-git.js';
import { refsRemoteGit } from '../src/adapters/refs/refs-remote-git.js';

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

const refs = () => refsRemoteGit({ repoRoot: clone, scriptDir: path.join(clone, 'scripts') });

describe('refsRemoteGit.remoteTip', () => {
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
    const unreachable = refsRemoteGit({
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

describe('refsRemoteGit with a stubbed command', () => {
  const ctx = { repoRoot: '/nowhere', scriptDir: '/nowhere/scripts' };
  const stub = (code: number, stdout: string) => async () => ({ code, stdout, stderr: '' });

  it('asks ls-remote for one branch on origin with a 10 s timeout', async () => {
    const seen: { args: readonly string[]; timeoutMs?: number }[] = [];
    const remote = refsRemoteGit(ctx, async (_c, args, options) => {
      seen.push({ args, timeoutMs: options.timeoutMs });
      return { code: 0, stdout: 'abc\trefs/heads/x\n', stderr: '' };
    });
    expect(await remote.remoteTip('x', 'abc')).toEqual({ ok: true, value: 'pushed' });
    expect(seen).toEqual([{ args: ['ls-remote', 'origin', 'refs/heads/x'], timeoutMs: 10_000 }]);
  });

  it('reads a different tip as other', async () => {
    const remote = refsRemoteGit(ctx, stub(0, 'def\trefs/heads/x\n'));
    expect(await remote.remoteTip('x', 'abc')).toEqual({ ok: true, value: 'other' });
  });

  it('reads only the line for the full ref, never a branch whose name ends the same', async () => {
    const remote = refsRemoteGit(ctx, stub(0, 'def\trefs/heads/feature/x\nabc\trefs/heads/x\n'));
    expect(await remote.remoteTip('x', 'abc')).toEqual({ ok: true, value: 'pushed' });
    const onlyOther = refsRemoteGit(ctx, stub(0, 'abc\trefs/heads/feature/x\n'));
    expect(await onlyOther.remoteTip('x', 'abc')).toEqual({ ok: true, value: 'unknown' });
  });

  it('reads a non-zero exit or an empty reply as unknown', async () => {
    expect(await refsRemoteGit(ctx, stub(128, '')).remoteTip('x', 'abc')).toEqual({ ok: true, value: 'unknown' });
    expect(await refsRemoteGit(ctx, stub(0, '')).remoteTip('x', 'abc')).toEqual({ ok: true, value: 'unknown' });
  });
});

describe('refsRemoteGit.fetchRemoteHead', () => {
  it('answers present for a branch origin holds, and updates its remote-tracking ref', async () => {
    expect(await refs().fetchRemoteHead('main')).toEqual({ ok: true, value: 'present' });
    expect(git(clone, ['rev-parse', 'refs/remotes/origin/main']).trim()).toBe(git(origin, ['rev-parse', 'main']).trim());
  });

  it('answers absent for a branch origin does not hold', async () => {
    expect(await refs().fetchRemoteHead('feature/never-pushed')).toEqual({ ok: true, value: 'absent' });
  });

  it('answers unknown when origin cannot be reached', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-remote-head-unreachable-'));
    try {
      const unreachable = refsRemoteGit({ repoRoot: dir, scriptDir: '/nonexistent/scripts' });
      expect(await unreachable.fetchRemoteHead('main')).toEqual({ ok: true, value: 'unknown' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('asks ls-remote only after the fetch failed, and reads a listed ref as unknown', async () => {
    const seen: (readonly string[])[] = [];
    const remote = refsRemoteGit({ repoRoot: '/nowhere', scriptDir: '/nowhere/scripts' }, async (_c, args) => {
      seen.push(args);
      return args[0] === 'fetch' ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: 'abc\trefs/heads/x\n', stderr: '' };
    });
    expect(await remote.fetchRemoteHead('x')).toEqual({ ok: true, value: 'unknown' });
    expect(seen).toEqual([
      ['fetch', '-q', 'origin', 'x'],
      ['ls-remote', '--heads', 'origin', 'refs/heads/x'],
    ]);
  });
});

describe('the board refs adapter carries no network-backed remoteTip', () => {
  it('answers unaskable and the file names no ls-remote', async () => {
    const board = refsGit({ repoRoot: clone, scriptDir: path.join(clone, 'scripts') });
    expect(await board.remoteTip('main', pushedSha)).toEqual({ ok: false, why: 'unaskable' });
    expect(await board.fetchRemoteHead('main')).toEqual({ ok: false, why: 'unaskable' });
    const source = fs.readFileSync(new URL('../src/adapters/refs/refs-git.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/ls-remote/);
  });
});
