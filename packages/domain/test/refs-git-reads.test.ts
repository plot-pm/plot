import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { refsGit } from '../src/adapters/refs/refs-git.js';
import { runBytes, runProcess, asText } from '../src/adapters/run-script.js';

/**
 * The git adapter against a REAL repository, because that is the only thing it
 * can be asserted against.
 *
 * A mock of `git` would assert that this file passes the arguments a mock was
 * written to expect, which is a tautology — the questions here are single `git`
 * invocations, so the implementation IS the argument list. What can go wrong is
 * a wrong flag, a format string that strips the wrong number of path
 * components, or an exit code read as the wrong answer, and every one of those
 * survives a mock and fails against git.
 *
 * The repository is tiny and local: no network, no remote, one commit per
 * branch. `git init` plus two commits runs in well under a second.
 */
const git = (cwd: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd, stdio: 'ignore' });
};

let repo = '';

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-refs-git-'));
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs/plans/a.md'), '# a plan\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'first']);

  // A branch that is an ancestor of main (merged) and one that is not.
  git(repo, ['branch', 'feature/merged']);
  git(repo, ['checkout', '--quiet', '-b', 'feature/ahead']);
  fs.writeFileSync(path.join(repo, 'docs/plans/b.md'), '# b plan\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'second']);
  git(repo, ['checkout', '--quiet', 'main']);

  // `origin` pointing at itself: the adapter asks about `origin/<main>`, and a
  // self-remote gives it real remote refs with no network.
  git(repo, ['remote', 'add', 'origin', repo]);
  git(repo, ['fetch', '--quiet', 'origin']);
});

afterAll(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

const refs = () => refsGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });

describe('refsGit: the branch and ref readings', () => {
  it('reports the default branch', async () => {
    const answer = await refs().defaultBranch();
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.value).toBe('main');
  });

  it('lists local branches without HEAD', async () => {
    const answer = await refs().listBranches(false);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value).toContain('main');
    expect(answer.value).toContain('feature/ahead');
    // HEAD is filtered: it is a symbolic ref, not a branch, and a caller
    // dispatching work would treat it as one.
    expect(answer.value).not.toContain('HEAD');
  });

  it('lists remote branches with the origin/ prefix stripped', async () => {
    const answer = await refs().listBranches(true);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    // `strip=3` is what removes `refs/remotes/origin/`; a wrong count leaves
    // `origin/main` or bare `main` where the other was meant.
    expect(answer.value).toContain('main');
    expect(answer.value.every((b) => !b.startsWith('origin/'))).toBe(true);
  });

  it('resolves a ref to a sha, and refuses one that does not exist', async () => {
    const hit = await refs().resolve('main');
    expect(hit.ok).toBe(true);
    if (hit.ok) expect(hit.value).toMatch(/^[0-9a-f]{40}$/);
    expect((await refs().resolve('refs/heads/no-such-branch')).ok).toBe(false);
  });
});

describe('refsGit: merge status reads the exit code, and three answers stay apart', () => {
  it('reads an ancestor as merged', async () => {
    const answer = await refs().isMergedByAncestry('feature/merged');
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.value).toBe('merged');
  });

  it('reads a branch ahead of main as not-merged', async () => {
    const answer = await refs().isMergedByAncestry('feature/ahead');
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.value).toBe('not-merged');
  });

  it('reads a branch it cannot resolve as unknown, not as not-merged', async () => {
    // exit 0 is merged, exit 1 is not-merged, and ANY other code is unknown.
    // Collapsing the third into the second would report a claim about a branch
    // git could not even name.
    const answer = await refs().isMergedByAncestry('no-such-branch');
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.value).toBe('unknown');
  });
});

describe('refsGit: the tree and file readings the board renders from', () => {
  it('lists the blobs under a directory at a ref', async () => {
    const answer = await refs().listBlobs('origin/main', 'docs/plans/');
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.map((b) => b.path)).toEqual(['docs/plans/a.md']);
    expect(answer.value[0]?.mode).toBe('100644');
    expect(answer.value[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reads a blob body by sha', async () => {
    const listed = await refs().listBlobs('origin/main', 'docs/plans/');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const sha = listed.value[0]?.sha ?? '';
    const read = await refs().readBlobs([sha]);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.get(sha)).toBe('# a plan\n');
  });

  it('answers an empty map for no shas without asking git', async () => {
    const read = await refs().readBlobs([]);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.size).toBe(0);
  });

  it('shows a file at a ref', async () => {
    const shown = await refs().showFile('origin/main', 'docs/plans/a.md');
    expect(shown.ok).toBe(true);
    if (shown.ok) expect(shown.value).toBe('# a plan\n');
  });

  it('reports the files a branch changed against the default branch', async () => {
    const changed = await refs().changedFiles('feature/ahead');
    expect(changed.ok).toBe(true);
    if (changed.ok) expect(changed.value).toContain('docs/plans/b.md');
  });

  it('names the repository root', async () => {
    const root = await refs().repoRoot();
    expect(root.ok).toBe(true);
    // macOS reports /private/var for /var, so compare the resolved paths.
    if (root.ok) expect(fs.realpathSync(root.value)).toBe(fs.realpathSync(repo));
  });

  it('counts how far the checkout sits behind a ref', async () => {
    const behind = await refs().countBehind('origin/main');
    expect(behind.ok).toBe(true);
    if (behind.ok) expect(behind.value).toBe(0);
  });

  it('reports branch tips for a pattern', async () => {
    const tips = await refs().branchTips(['refs/remotes/origin/feature/*']);
    expect(tips.ok).toBe(true);
    if (!tips.ok) return;
    expect(tips.value.map((t) => t.branch).sort()).toEqual(['feature/ahead', 'feature/merged']);
    expect(tips.value.every((t) => /^[0-9a-f]{40}$/.test(t.sha))).toBe(true);
  });
});

describe('runBytes: the stdin-fed reader `cat-file --batch` needs', () => {
  it('feeds stdin and answers in bytes', async () => {
    const run = await runBytes('cat', [], 'hello');
    expect(run.code).toBe(0);
    expect(run.stdout.toString('utf8')).toBe('hello');
  });

  it('answers bytes rather than a decoded string', async () => {
    // The batch stream declares each body's length in BYTES, so decoding first
    // makes those lengths unusable the moment a plan holds a non-ASCII
    // character — which every plan in this repo does.
    const run = await runBytes('cat', [], 'é');
    expect(run.stdout.length).toBe(2);
    expect(Buffer.isBuffer(run.stdout)).toBe(true);
  });

  it('reports a non-zero exit rather than throwing', async () => {
    const run = await runBytes('git', ['--no-such-flag'], '');
    expect(run.code).not.toBe(0);
  });

  it('survives a process that exits before the write lands', async () => {
    // EPIPE on stdin: `true` exits immediately, so the write has nowhere to go.
    // An unhandled error here takes the server down rather than reporting a
    // failed read, which is why the adapter attaches a handler.
    const run = await runBytes('true', [], 'x'.repeat(1024 * 128));
    expect(run.code).toBe(0);
  });
});

describe('asText: the reader every single-value question shares', () => {
  it('trims the trailing newline git always writes', () => {
    expect(asText('main\n')).toBe('main');
  });
});

/**
 * The RunOptions branches, which no other test supplies.
 *
 * `runProcess` and `runBytes` each read four options with a fallback —
 * `cwd`, `env`, `timeoutMs`, `maxBuffer` — and every existing caller takes the
 * default for three of them. An untaken branch is a branch nobody specified,
 * and the two that matter here are not cosmetic: `env` decides whether a script
 * sees `PLOT_*` at all, and `timeoutMs` is what stops a hung git holding a
 * request open.
 *
 * Added 2026-09-01 because CI measured 94.44% function coverage on this file
 * against a 95% threshold while this machine measured 100% — v8's coverage is
 * sensitive to which callbacks actually ran, so the honest fix is to run them
 * rather than to lower the number.
 */
describe('runProcess and runBytes read their options', () => {
  it('passes env through, merged over the parent environment', async () => {
    const run = await runProcess('sh', ['-c', 'printf %s "$PLOT_TEST_TOKEN"'], {
      env: { PLOT_TEST_TOKEN: 'seen' },
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('seen');
    // Merged, not replaced: the parent's PATH is what found `sh` at all.
    expect(run.stdout).not.toBe('');
  });

  it('honours an explicit timeout by killing the child', async () => {
    const run = await runProcess('sleep', ['5'], { timeoutMs: 150 });
    // A killed child reports a non-zero code rather than throwing — the whole
    // point of this adapter is that a failure is a value.
    expect(run.code).not.toBe(0);
  });

  it('honours an explicit maxBuffer', async () => {
    const run = await runProcess('sh', ['-c', 'printf %0.sx {1..4000}'], { maxBuffer: 64 });
    // Over the cap, `execFile` errors; the adapter answers with a code rather
    // than an exception, which is what keeps a large read from taking a route down.
    expect(run.code).not.toBe(0);
  });

  it('reads a cwd it was given', async () => {
    const run = await runProcess('sh', ['-c', 'pwd'], { cwd: repo });
    expect(run.code).toBe(0);
    expect(fs.realpathSync(run.stdout.trim())).toBe(fs.realpathSync(repo));
  });

  it('passes env and a timeout through runBytes too', async () => {
    const seen = await runBytes('sh', ['-c', 'printf %s "$PLOT_TEST_TOKEN"'], '', {
      env: { PLOT_TEST_TOKEN: 'bytes' },
    });
    expect(seen.stdout.toString('utf8')).toBe('bytes');
    const killed = await runBytes('sleep', ['5'], '', { timeoutMs: 150 });
    expect(killed.code).not.toBe(0);
  });
});
