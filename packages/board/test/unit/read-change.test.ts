import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readChange, REVIEW_DIFF_MAX_BYTES } from '../../src/server/entry/review.js';
import { removeTree } from '../rm-tree.mjs';

/**
 * `readChange` against a REAL repository with its own divergent base branch,
 * because its questions are single `git` invocations — the fetch refspec,
 * the merge-base step, `--no-ext-diff`, the byte limit, and the `--name-only`
 * split — and a mock would only assert this file's own argument list back at
 * it. No `ReviewDeps` are involved: `readChange` takes none.
 */
let repo = '';
let base = '';

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd }).toString();

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-read-change-'));
  git(repo, ['init', '--quiet', '--initial-branch=release/1.0']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'maintenance.auto', 'false']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'first']);

  // The base branch moves ahead on its own, so the merge base of the head
  // branch and `origin/<base>` is the commit BEFORE either diverged, not the
  // base's own tip — proving the merge-base step runs rather than diffing
  // straight against the base.
  git(repo, ['checkout', '--quiet', '-b', 'feature/x']);
  fs.writeFileSync(path.join(repo, 'b.txt'), 'two\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'second']);

  git(repo, ['checkout', '--quiet', 'release/1.0']);
  fs.writeFileSync(path.join(repo, 'c.txt'), 'three\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'base moved on']);
  base = git(repo, ['rev-parse', 'release/1.0']).trim();

  git(repo, ['checkout', '--quiet', 'feature/x']);

  // `origin` pointing at itself: `readChange` asks about `origin/<base>`, and
  // a self-remote gives it a real remote-tracking ref with no network.
  git(repo, ['remote', 'add', 'origin', repo]);
});

afterAll(() => {
  if (repo) removeTree(repo);
});

describe('readChange', () => {
  it('fetches the named base into refs/remotes/origin/<base> before diffing', async () => {
    const sha = git(repo, ['rev-parse', 'feature/x']).trim();
    const change = await readChange(repo, 'release/1.0', sha);
    expect(change.ok).toBe(true);
    const fetched = git(repo, ['rev-parse', 'refs/remotes/origin/release/1.0']).trim();
    expect(fetched).toBe(base);
  });

  it('merge-bases origin/<base> against the head before diffing, rather than diffing the base tip', async () => {
    const sha = git(repo, ['rev-parse', 'feature/x']).trim();
    const change = await readChange(repo, 'release/1.0', sha);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    const firstCommit = git(repo, ['rev-list', '--max-parents=0', 'feature/x']).trim();
    expect(change.mergeBase).toBe(firstCommit);
    expect(change.mergeBase).not.toBe(base);
    expect(change.files).toEqual(['b.txt']);
    expect(change.diff).toContain('+two');
    expect(change.diff).not.toContain('+three');
  });

  it('splits --name-only on newlines and filters the trailing empty entry', async () => {
    git(repo, ['checkout', '--quiet', 'feature/x']);
    fs.writeFileSync(path.join(repo, 'd.txt'), 'four\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '--quiet', '-m', 'third']);
    const sha = git(repo, ['rev-parse', 'feature/x']).trim();
    const change = await readChange(repo, 'release/1.0', sha);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(change.files).toEqual(['b.txt', 'd.txt']);
    expect(change.files.every((f) => f !== '')).toBe(true);
  });

  it('passes --no-ext-diff, so a configured external diff tool is never shelled out to', async () => {
    git(repo, ['config', 'diff.external', 'false']);
    const sha = git(repo, ['rev-parse', 'feature/x']).trim();
    const change = await readChange(repo, 'release/1.0', sha);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(change.diff).toContain('diff --git');
  });

  it('fails the diff step rather than truncating silently when the diff exceeds REVIEW_DIFF_MAX_BYTES', async () => {
    git(repo, ['checkout', '--quiet', 'feature/x']);
    fs.writeFileSync(path.join(repo, 'big.txt'), `${'x'.repeat(REVIEW_DIFF_MAX_BYTES + 1)}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '--quiet', '-m', 'too big']);
    const sha = git(repo, ['rev-parse', 'feature/x']).trim();
    const change = await readChange(repo, 'release/1.0', sha);
    expect(change.ok).toBe(false);
    if (change.ok) return;
    expect(change.why).toContain(String(REVIEW_DIFF_MAX_BYTES));
  }, 20_000);

  it('refuses when the base branch does not exist on the remote', async () => {
    const sha = git(repo, ['rev-parse', 'feature/x']).trim();
    const change = await readChange(repo, 'does-not-exist', sha);
    expect(change.ok).toBe(false);
    if (change.ok) return;
    expect(change.why).toContain('does-not-exist');
  });
});
