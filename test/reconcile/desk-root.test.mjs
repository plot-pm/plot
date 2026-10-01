// Contract test for skills/plot/scripts/plot-desk-root.sh — the one place a
// shell script asks where desks and action records go.
//
// The rule is `deskRoot` and has its own unit tests in `packages/domain`. These
// assert what the shell half adds: that the root is the MAIN checkout from
// wherever a script runs, that the `Worktree root` key reaches the rule, and
// that the exclude line lands in the COMMON git directory exactly once.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const helper = path.join(scripts, 'plot-desk-root.sh');
const reap = path.join(scripts, 'plot-reap.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const temps = [];
after(() => {
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true, maxRetries: 3 });
});

/**
 * A repository with an origin, one commit, and the given `## Plot Config` lines.
 * Returns the repository's PHYSICAL path, the form git prints.
 */
const makeRepo = (label, config = '') => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `plot-deskroot-${label}-`)));
  temps.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `## Plot Config\n\n- **Plan directory:** plans/\n${config}`);
  fs.writeFileSync(path.join(repo, '.gitignore'), '.plot-worker.pid\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
};

/** Runs `snippet` with the helper sourced, in `cwd`. */
const ask = (cwd, snippet) =>
  spawnSync('bash', ['-c', `. "${helper}"; ${snippet}`], { cwd, encoding: 'utf8' });

test('desk root: no key answers <main>/.worktrees', () => {
  const { repo } = makeRepo('absent');
  const r = ask(repo, 'plot_desk_root "$(plot_repo_root)"');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), path.join(repo, '.worktrees'));
});

test('desk root: an empty value is the absent row, not a relative ""', () => {
  const { repo } = makeRepo('empty', '- **Worktree root:**\n');
  const r = ask(repo, 'plot_desk_root "$(plot_repo_root)"');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), path.join(repo, '.worktrees'));
});

test('desk root: a relative value resolves against the main checkout, with no trailing slash', () => {
  const { repo } = makeRepo('relative', '- **Worktree root:** desks/\n');
  const r = ask(repo, 'plot_desk_root "$(plot_repo_root)"');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), path.join(repo, 'desks'));
});

test('desk root: an absolute value is taken as given, with no trailing slash', () => {
  const abs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deskroot-abs-')));
  temps.push(abs);
  const { repo } = makeRepo('absolute', `- **Worktree root:** ${abs}/\n`);
  const r = ask(repo, 'plot_desk_root "$(plot_repo_root)"');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), abs);
});

test('desk root: a run from inside a desk resolves the MAIN checkout, not <desk>/.worktrees', () => {
  // `--show-toplevel` answers the desk. With `.worktrees` as the default, a
  // caller that used it would place every desk under a root nothing reads.
  const { repo } = makeRepo('inside');
  const desk = path.join(repo, '.worktrees', 'feature-x');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/x', desk, 'origin/main');
  const r = ask(desk, 'plot_repo_root; plot_desk_root "$(plot_repo_root)"');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), [repo, path.join(repo, '.worktrees')]);
});

test('desk root: an unaskable rule exits 3 and names the reason', () => {
  // NO CALLER KEEPS A FALLBACK DEFAULT, so the helper must say it failed
  // rather than print a path a caller would compose against.
  const { tmp, repo } = makeRepo('unaskable');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'node'), '#!/usr/bin/env bash\nexit 9\n');
  fs.chmodSync(path.join(fakeBin, 'node'), 0o755);
  const r = spawnSync('bash', ['-c', `. "${helper}"; plot_desk_root "$(plot_repo_root)"`], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /cannot resolve the desk root/);
});

test('exclude: the line goes into the COMMON git dir once, from inside a desk too', () => {
  const { repo } = makeRepo('exclude');
  const desk = path.join(repo, '.worktrees', 'feature-y');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/y', desk, 'origin/main');
  assert.match(git(repo, 'status', '--porcelain'), /\.worktrees/, 'the premise: the desk root shows as untracked');

  for (let i = 0; i < 2; i += 1) {
    const r = ask(desk, 'plot_exclude_desk_root "$(plot_repo_root)"');
    assert.equal(r.status, 0, r.stderr);
  }
  const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude.split('\n').filter((l) => l === '/.worktrees/').length, 1, exclude);
  assert.doesNotMatch(git(repo, 'status', '--porcelain'), /\.worktrees/);
});

test('exclude: a root outside the repository writes no line', () => {
  const abs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deskroot-out-')));
  temps.push(abs);
  const { repo } = makeRepo('outside', `- **Worktree root:** ${abs}\n`);
  const exclude = path.join(repo, '.git', 'info', 'exclude');
  const before = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  const r = ask(repo, 'plot_exclude_desk_root "$(plot_repo_root)"');
  assert.equal(r.status, 0, r.stderr);
  const now = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  assert.equal(now, before);
});

test('reaper: run from inside a desk with no key, it reads the MAIN checkout\'s .worktrees', () => {
  // A tree under the desk root that neither recognition test places is
  // reported for a person. The reaper only names it when it resolved the main
  // checkout's root: from `<desk>/.worktrees` it would sit outside and be silent.
  const { repo } = makeRepo('reapdesk');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/here', path.join(repo, '.worktrees', 'feature-here'), 'origin/main');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/stray', path.join(repo, '.worktrees', 'stray-tree'), 'origin/main');
  const r = spawnSync('bash', [reap, '--dry-run'], {
    cwd: path.join(repo, '.worktrees', 'feature-here'),
    encoding: 'utf8',
    env: { ...process.env, PLOT_UNATTENDED: '1' },
  });
  const out = r.stdout + r.stderr;
  assert.match(out, /unknown\s+feature\/stray/, out);
  assert.match(out, /under \.worktrees\/, no worker pid and no recognised name/, out);
});
