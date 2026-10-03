import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { additionsOf, commitSubjectsOf, mergesOf, refsGit } from '../src/adapters/refs/refs-git.js';
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

describe('refsGit: remoteHead — a hand-over reads the last-fetched ref, not the network', () => {
  it('answers present for a branch the last fetch recorded under origin', async () => {
    const answer = await refs().remoteHead('feature/ahead');
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.value).toBe('present');
  });

  it('answers absent for a branch the last fetch did not record', async () => {
    const answer = await refs().remoteHead('no-such-branch');
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.value).toBe('absent');
  });

  it('answers absent for a local branch with no remote-tracking ref', async () => {
    // A local `refs/heads/<branch>` is not the remote's ref: the read names
    // `refs/remotes/origin/<branch>` in full, so a short-name match cannot
    // answer for it.
    git(repo, ['branch', 'local/only']);
    try {
      const answer = await refs().remoteHead('local/only');
      expect(answer.ok).toBe(true);
      if (answer.ok) expect(answer.value).toBe('absent');
    } finally {
      git(repo, ['branch', '-D', 'local/only']);
    }
  });

  it('answers unknown where git fails outside a repository', async () => {
    // Exit 128, not 1: a failure a hand-over must not read as "the ref is gone".
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-refs-git-no-repo-'));
    try {
      const answer = await refsGit({
        repoRoot: outside,
        scriptDir: path.join(outside, 'scripts'),
      }).remoteHead('main');
      expect(answer.ok).toBe(true);
      if (answer.ok) expect(answer.value).toBe('unknown');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('answers unknown where git cannot start, not absent', async () => {
    // A process that cannot start reports exit 1, the same code `--verify
    // --quiet` gives a missing ref; the second reading tells them apart.
    const gone = path.join(os.tmpdir(), 'plot-refs-git-missing-dir-does-not-exist');
    const answer = await refsGit({ repoRoot: gone, scriptDir: path.join(gone, 'scripts') })
      .remoteHead('main');
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
    //
    // THIS ASSERTION CANNOT SEE THE HANDLER RUN, and that is a measured cost
    // rather than an oversight. `run.code` is 0 whether EPIPE fired or the
    // write simply landed first, so the race decides only whether the empty
    // `stdin.on('error')` arrow EXECUTES — and v8 counts it as a function
    // either way. Measured 2026-09-01 on identical source: macOS reported 100 %
    // functions on two consecutive runs, the Linux runner reported 94.44 %,
    // which is exactly 17 of 18. The coverage gate on this file therefore flaps
    // by platform with nothing in the diff to explain it.
    //
    // Asserting the handler ran would need the adapter to report it, and that
    // is a change to production shape for a test's benefit. Left as it is, with
    // the cause written down.
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
    // POSIX, NOT BASH. `{1..4000}` is brace expansion: macOS `/bin/sh` is bash
    // in POSIX mode and expands it to 4000 bytes, while a Linux runner's `sh`
    // is dash and does not — it printed the literal, 9 bytes, comfortably under
    // the cap, so `run.code` was 0 and this failed on CI while passing on every
    // developer machine. `%01000d` is POSIX and pads without a shell feature.
    const run = await runProcess('sh', ['-c', 'printf "%01000d" 0'], { maxBuffer: 64 });
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

/**
 * The nine readings the fingerprint and the sweeps need, against the same real
 * repository. Several have a synchronous twin because a startup path cannot
 * await; each pair is asserted to agree, since a caller choosing the sync form
 * for that reason must not get a different answer.
 */
describe('refsGit: the fingerprint and sweep readings', () => {
  it('knows a repository from a directory that is not one', async () => {
    expect(await refs().isRepository()).toEqual({ ok: true, value: true });
    const outside = refsGit({ repoRoot: os.tmpdir(), scriptDir: os.tmpdir() });
    // FALSE, not a failure: "this is not a repository" is the answer the
    // adoption probe asks for, and reporting it as unaskable would make an
    // un-adopted directory indistinguishable from a broken git.
    expect(await outside.isRepository()).toEqual({ ok: true, value: false });
  });

  it('reads local, remote and both scopes, and the sync twin agrees', async () => {
    const local = await refs().refState('local');
    const remote = await refs().refState('remote');
    const both = await refs().refState('both');
    expect(local.ok && remote.ok && both.ok).toBe(true);
    if (!local.ok || !remote.ok || !both.ok) return;

    expect(local.value.every((r) => r.ref.startsWith('refs/heads/'))).toBe(true);
    expect(remote.value.every((r) => r.ref.startsWith('refs/remotes/'))).toBe(true);
    // `both` is the union, so it holds at least what either scope holds alone.
    expect(both.value.length).toBeGreaterThanOrEqual(local.value.length);
    expect(both.value.length).toBeGreaterThanOrEqual(remote.value.length);

    // EVERY ENTRY CARRIES A SHA. The estate fingerprint hashes these, so a ref
    // with an empty sha would make two different estates hash the same.
    expect(local.value.every((r) => /^[0-9a-f]{40}$/.test(r.sha))).toBe(true);

    const sync = refs().refStateSync('local');
    expect(sync.ok && sync.value).toEqual(local.value);
  });

  it('counts a branch against ITS OWN remote ref, not against the default', () => {
    // `refs/remotes/origin/<branch>..refs/heads/<branch>` — the question is
    // *what has this branch not pushed*, which is why a branch level with its
    // own remote answers 0 however far ahead of main it sits. The fixture
    // fetched after creating `feature/ahead`, so origin already holds it.
    expect(refs().countAheadSync('feature/ahead')).toEqual({ ok: true, value: 0 });

    // One local commit that origin does not have, and now it counts.
    git(repo, ['checkout', '--quiet', 'feature/ahead']);
    fs.writeFileSync(path.join(repo, 'docs/plans/c.md'), '# c plan\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '--quiet', '-m', 'unpushed']);
    git(repo, ['checkout', '--quiet', 'main']);
    expect(refs().countAheadSync('feature/ahead')).toEqual({ ok: true, value: 1 });

    // A FAILED READING, not a zero one: a branch with no remote ref has
    // nothing to measure against, and zero would read as *nothing to push*.
    expect(refs().countAheadSync('feature/no-such-branch').ok).toBe(false);
  });

  it('hashes every path it is given, in the order it was given them', () => {
    // THE WORKING TREE, not a ref. `git hash-object` reads files from disk, so
    // the paths must exist in the CHECKOUT — `docs/plans/b.md` is committed on
    // `feature/ahead` and HEAD is on `main`, which makes it absent here.
    const second = path.join(repo, 'docs/plans/on-disk.md');
    fs.writeFileSync(second, '# on disk\n');
    try {
      const answer = refs().hashFilesSync(['docs/plans/a.md', 'docs/plans/on-disk.md']);
      expect(answer.ok).toBe(true);
      if (!answer.ok) return;
      expect(answer.value.size).toBe(2);
      for (const at of ['docs/plans/a.md', 'docs/plans/on-disk.md']) {
        expect(answer.value.get(at)).toMatch(/^[0-9a-f]{40}$/);
      }
      // Two different files, two different oids — the map is keyed by path and
      // not by position, so a transposition would show up here.
      expect(answer.value.get('docs/plans/a.md'))
        .not.toBe(answer.value.get('docs/plans/on-disk.md'));
    } finally {
      fs.rmSync(second, { force: true });
    }
  });

  it('fails the whole call when a path is missing, rather than skipping it', () => {
    // ONE MISSING PATH FAILS EVERYTHING, and that is the design rather than a
    // rough edge: `--stdin-paths` prints one oid per readable path, so a
    // missing file makes the answer SHORTER than the question and the map can
    // no longer be built by position. Skipping it would let a deleted plan
    // silently stop contributing to the estate fingerprint, which is the one
    // failure the fingerprint exists to catch.
    expect(refs().hashFilesSync(['docs/plans/a.md', 'no-such-file.md']).ok).toBe(false);
  });

  it('answers an empty map for no paths, and asks git nothing', () => {
    const answer = refs().hashFilesSync([]);
    expect(answer.ok).toBe(true);
    expect(answer.ok && answer.value.size).toBe(0);
  });

  it('says whether a path exists at a ref', () => {
    expect(refs().fileExistsSync('main', 'docs/plans/a.md')).toEqual({ ok: true, value: true });
    expect(refs().fileExistsSync('main', 'docs/plans/no-such.md'))
      .toEqual({ ok: true, value: false });
  });

  it('reports branch tips with their commit dates', async () => {
    const answer = await refs().branchDates(['refs/heads/feature/*']);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.map((b) => b.branch).sort())
      .toEqual(['feature/ahead', 'feature/merged']);
    // Epoch SECONDS, and recent: a date read at the wrong offset or in
    // milliseconds is the failure this catches, and both are far from now.
    for (const b of answer.value) {
      expect(b.committedAt).toBeGreaterThan(1_600_000_000);
      expect(b.committedAt).toBeLessThan(Date.now() / 1000 + 60);
    }
  });

  it('names the branches an ancestor has not absorbed', async () => {
    const answer = await refs().unmergedBranches('main');
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    // `feature/ahead` carries a commit main lacks; `feature/merged` does not.
    expect(answer.value).toContain('feature/ahead');
    expect(answer.value).not.toContain('feature/merged');
  });

  it('reads a remote URL, and fails for a remote that was never added', async () => {
    const answer = await refs().remoteUrl('origin');
    expect(answer.ok).toBe(true);
    // The fixture's `origin` points at the repository itself.
    expect(answer.ok && answer.value).toBe(repo);
    expect((await refs().remoteUrl('no-such-remote')).ok).toBe(false);
  });
});

describe('refsGit: the merge-subject readings', () => {
  let estate = '';

  /** The full hash `ref` resolves to in the estate. */
  const sha = (ref: string): string =>
    execFileSync('git', ['rev-parse', ref], { cwd: estate }).toString().trim();

  beforeAll(() => {
    // A plan added, then renamed; a branch merged after the plan with a
    // Bitbucket subject. `origin` points at the repository itself.
    estate = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-refs-subjects-'));
    git(estate, ['init', '--quiet', '--initial-branch=main']);
    git(estate, ['config', 'user.email', 'test@example.com']);
    git(estate, ['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(estate, 'docs/plans'), { recursive: true });
    fs.writeFileSync(path.join(estate, 'README.md'), 'readme\n');
    git(estate, ['add', '-A']);
    git(estate, ['commit', '--quiet', '-m', 'root']);
    fs.writeFileSync(path.join(estate, 'docs/plans/2026-01-01-old.md'), '# a plan\n\nbody that survives a rename\n');
    git(estate, ['add', '-A']);
    git(estate, ['commit', '--quiet', '-m', 'add plan']);
    git(estate, ['tag', 'added']);
    git(estate, ['mv', 'docs/plans/2026-01-01-old.md', 'docs/plans/2026-01-01-new.md']);
    git(estate, ['commit', '--quiet', '-m', 'retitle plan']);
    git(estate, ['checkout', '--quiet', '-b', 'feature/one']);
    fs.writeFileSync(path.join(estate, 'work.txt'), 'work\n');
    git(estate, ['add', '-A']);
    git(estate, ['commit', '--quiet', '-m', 'work']);
    git(estate, ['checkout', '--quiet', 'main']);
    git(estate, ['merge', '--no-ff', '--quiet', '-m', 'Merged in feature/one (pull request #5)', 'feature/one']);
    git(estate, ['remote', 'add', 'origin', estate]);
    git(estate, ['fetch', '--quiet', 'origin']);
  });

  afterAll(() => {
    if (estate) fs.rmSync(estate, { recursive: true, force: true });
  });

  const subjects = () => refsGit({ repoRoot: estate, scriptDir: path.join(estate, 'scripts') });

  it('maps a renamed plan to the commit that first added it', async () => {
    const answer = await subjects().planAdditions('origin/main', 'docs/plans');
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.get('docs/plans/2026-01-01-new.md')).toBe(sha('added'));
  });

  it('fails the additions walk for a ref that does not exist', async () => {
    expect((await subjects().planAdditions('origin/nope', 'docs/plans')).ok).toBe(false);
  });

  it('reads the merges with their full hashes and subjects', async () => {
    const answer = await subjects().mergeSubjects('origin/main', 10);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value).toEqual([
      { sha: sha('origin/main'), subject: 'Merged in feature/one (pull request #5)' },
    ]);
  });

  it('answers containment yes, no and unknown', async () => {
    const merge = sha('origin/main');
    const added = sha('added');
    expect(await subjects().contains(merge, added)).toEqual({ ok: true, value: 'no' });
    expect(await subjects().contains(added, merge)).toEqual({ ok: true, value: 'yes' });
    expect(await subjects().contains('no-such-commit', merge)).toEqual({ ok: true, value: 'unknown' });
  });
});

describe('refsGit: commitSubjects — a reading, and no classification', () => {
  let estate = '';

  /** The tree id `ref` resolves to. */
  const tree = (ref: string): string =>
    execFileSync('git', ['rev-parse', `${ref}^{tree}`], { cwd: estate }).toString().trim();

  beforeAll(() => {
    estate = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-commit-subjects-'));
    git(estate, ['init', '--quiet', '--initial-branch=main']);
    git(estate, ['config', 'user.email', 'test@example.com']);
    git(estate, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(estate, 'README.md'), 'readme\n');
    git(estate, ['add', '-A']);
    git(estate, ['commit', '--quiet', '-m', 'root']);
    git(estate, ['checkout', '--quiet', '-b', 'feature/claimed']);
    // AN EMPTY CLAIM MARKER: same tree as its parent, titled `plot: claim `.
    git(estate, ['commit', '--quiet', '--allow-empty', '-m', 'plot: claim feature/claimed']);
    // A REAL COMMIT ON TOP, so the branch carries one claim marker and one
    // commit that changed a file — `claimTip`'s `work` case through a real walk.
    fs.writeFileSync(path.join(estate, 'work.txt'), 'work\n');
    git(estate, ['add', '-A']);
    git(estate, ['commit', '--quiet', '-m', 'do the work']);
    git(estate, ['checkout', '--quiet', 'main']);
    git(estate, ['remote', 'add', 'origin', estate]);
    git(estate, ['fetch', '--quiet', 'origin']);
  });

  afterAll(() => {
    if (estate) fs.rmSync(estate, { recursive: true, force: true });
  });

  const subjects = () => refsGit({ repoRoot: estate, scriptDir: path.join(estate, 'scripts') });

  it('reads a range with commits: newest first, with time, subject, tree and parent tree', async () => {
    const answer = await subjects().commitSubjects('origin/main..origin/feature/claimed');
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.map((c) => c.subject)).toEqual(['do the work', 'plot: claim feature/claimed']);
    const [workCommit, claimCommit] = answer.value;
    // THE CLAIM MARKER'S TREE EQUALS ITS PARENT'S — the boundary commit on
    // `origin/main`, resolved from the SAME walk rather than a second call.
    expect(claimCommit.tree).toBe(tree('origin/main'));
    expect(claimCommit.parentTree).toBe(tree('origin/main'));
    // THE WORK COMMIT'S TREE DIFFERS FROM ITS PARENT'S (the claim marker).
    expect(workCommit.tree).not.toBe(claimCommit.tree);
    expect(workCommit.parentTree).toBe(claimCommit.tree);
    // A TIME FOR EVERY COMMIT, AND NO CLASSIFICATION — this reads facts, and
    // `isEmptyClaim`/`claimTip` are what a caller applies to them.
    for (const commit of answer.value) expect(typeof commit.at).toBe('number');
  });

  it('answers an empty list for a range with no commits', async () => {
    const answer = await subjects().commitSubjects('origin/main..origin/main');
    expect(answer).toEqual({ ok: true, value: [] });
  });

  it('fails for a range naming a ref that does not exist', async () => {
    expect((await subjects().commitSubjects('origin/main..origin/no-such-branch')).ok).toBe(false);
  });

  it("answers `null` for a root commit's parent tree — no parent to read", async () => {
    const answer = await subjects().commitSubjects('origin/feature/claimed');
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const root = answer.value.find((c) => c.subject === 'root');
    expect(root?.parentTree).toBeNull();
  });
});

describe('additionsOf', () => {
  it('keeps the oldest add of a path the walk lists twice', () => {
    expect(additionsOf('@new\n\nA\tp.md\n@old\n\nA\tp.md\n')).toEqual(new Map([['p.md', 'old']]));
  });

  it('follows a rename chain back to its add', () => {
    const walk = '@c3\n\nR100\tb.md\tc.md\n@c2\n\nR090\ta.md\tb.md\n@c1\n\nA\ta.md\n';
    expect(additionsOf(walk).get('c.md')).toBe('c1');
  });

  it('leaves out a chain that ends in no add, and survives a cycle', () => {
    const walk = '@c2\n\nR100\ta.md\tb.md\n@c1\n\nR100\tb.md\ta.md\n';
    expect(additionsOf(walk)).toEqual(new Map());
  });
});

describe('mergesOf', () => {
  it('drops a line with no subject', () => {
    expect(mergesOf('abc Merged in x (pull request #1)\nlonely\n')).toEqual([
      { sha: 'abc', subject: 'Merged in x (pull request #1)' },
    ]);
  });
});

describe('commitSubjectsOf — the %m boundary walk, parsed without a second call per commit', () => {
  it('excludes the boundary commit and resolves its parent tree from the same stream', () => {
    const stdout = [
      '>|aaa|bbbb2|bbb|200|second',
      '-|bbb|aaaa1||100|first',
      '',
    ].join('\n');
    expect(commitSubjectsOf(stdout)).toEqual([
      { at: 200_000, subject: 'second', tree: 'bbbb2', parentTree: 'aaaa1' },
    ]);
  });

  it('reads only the first parent of a multi-parent line', () => {
    const stdout = ['>|aaa|bbbb2|bbb ccc|200|merge-ish', '-|bbb|aaaa1||100|left', ''].join('\n');
    expect(commitSubjectsOf(stdout)[0]?.parentTree).toBe('aaaa1');
  });

  it('answers `null` for a parent not present in the stream', () => {
    const stdout = ['>|aaa|bbbb2|deadbeef|200|second', ''].join('\n');
    expect(commitSubjectsOf(stdout)[0]?.parentTree).toBeNull();
  });

  it('answers `null` for a root commit with no parent at all', () => {
    const stdout = ['>|aaa|aaaa1||100|root', ''].join('\n');
    expect(commitSubjectsOf(stdout)[0]?.parentTree).toBeNull();
  });

  it('drops a line that does not match the format', () => {
    expect(commitSubjectsOf('not a commit line\n')).toEqual([]);
  });

  it('answers an empty list for empty output', () => {
    expect(commitSubjectsOf('')).toEqual([]);
  });
});
