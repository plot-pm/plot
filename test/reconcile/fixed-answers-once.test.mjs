// Contract test: a script that needs the common git directory reads an
// exported answer when it is correct for the script's cwd, and asks git
// otherwise (plan `fixed-answers-once`, slice *Answers in scripts*).
//
// The subject is `plot-worker-state.sh`, which every per-desk probe sources:
// on the first Linux census (2026-11-08) its source-time lookup was the script
// share of P4, one `git rev-parse --git-common-dir` per sourcing process.
//
// A `git` stub on PATH records every `rev-parse` that names `--show-toplevel`
// or `--git-common-dir`, then runs the real git, so each row counts the asks
// and still reads the real answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const shared = path.join(scripts, 'plot-worker-state.sh');
const realGit = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

const git = (cwd, ...args) => execFileSync(realGit, args, { encoding: 'utf8', cwd });

/** A repository with a commit, a desk under `.worktrees/`, and a recording `git` stub. */
const fixture = () => {
  const t = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fixed-answers-')));
  const repo = path.join(t, 'repo');
  const other = path.join(t, 'other');
  for (const r of [repo, other]) {
    git(t, 'init', '-q', '-b', 'main', r);
    git(r, 'config', 'user.email', 'test@example.invalid');
    git(r, 'config', 'user.name', 'Plot Test');
    git(r, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(r, 'CLAUDE.md'), '# fixture\n');
    git(r, 'add', '-A');
    git(r, 'commit', '-qm', 'init');
  }
  const desk = path.join(repo, '.worktrees', 'desk');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/desk', desk);
  const outside = path.join(t, 'outside-desk');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/outside', outside);
  const bin = path.join(t, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(t, 'asks.log');
  fs.writeFileSync(path.join(bin, 'git'),
    '#!/usr/bin/env bash\n'
    + 'case " $* " in *" rev-parse "*) case " $* " in *--show-toplevel*|*--git-common-dir*) '
    + `printf '%s\\n' "$*" >> ${JSON.stringify(log)} ;; esac ;; esac\n`
    + `exec ${JSON.stringify(realGit)} "$@"\n`, { mode: 0o755 });
  const asks = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : []);
  return { t, repo, other, desk, outside, bin, asks, cleanup: () => fs.rmSync(t, { recursive: true, force: true }) };
};

/**
 * Sources `plot-worker-state.sh` in `cwd` and runs `script` after it. The
 * caller's three variables are scrubbed first and only `env` sets them, so a
 * run inside a fleet worker reads the same as one on a clean shell.
 */
const sourced = (f, cwd, script, env = {}) => {
  const base = { ...process.env, PATH: `${f.bin}${path.delimiter}${process.env.PATH}` };
  delete base.PLOT_MANIFEST_DIR;
  delete base.PLOT_REPO_ROOT;
  delete base.PLOT_GIT_COMMON_DIR;
  return execFileSync('bash', ['-c', `. "$1" || exit 9\n${script}`, 'bash', shared],
    { encoding: 'utf8', cwd, env: { ...base, ...env }, timeout: 60_000 }).trim();
};

const DIR = 'printf "%s|%s" "$PLOT_MANIFEST_DIR" "${PLOT_GIT_COMMON_DIR:-}"';

test('fixed answers: with nothing exported, the first sourcing asks git once and exports the common dir', () => {
  const f = fixture();
  try {
    const out = sourced(f, f.repo, DIR);
    assert.equal(out, `${f.repo}/.plot/agents|${f.repo}/.git`);
    assert.equal(f.asks().length, 1, `one ask, got:\n${f.asks().join('\n')}`);
  } finally { f.cleanup(); }
});

test('fixed answers: a second sourcing in the same process tree starts no git rev-parse for it', () => {
  const f = fixture();
  try {
    // The child is a fresh bash that sources the file again, the shape every
    // per-desk probe has. It inherits the parent's export and asks nothing.
    const out = sourced(f, f.repo, `bash -c '. "$1" && ${DIR}' bash "$1"`);
    assert.equal(out, `${f.repo}/.plot/agents|${f.repo}/.git`);
    assert.equal(f.asks().length, 1, `the child must reuse the parent's answer, got:\n${f.asks().join('\n')}`);
  } finally { f.cleanup(); }
});

test('fixed answers: an exported common dir is read from the main checkout and from a desk, with no ask', () => {
  const f = fixture();
  try {
    for (const cwd of [f.repo, f.desk, f.outside, path.join(f.repo, '.worktrees')]) {
      const out = sourced(f, cwd, DIR, { PLOT_GIT_COMMON_DIR: path.join(f.repo, '.git') });
      assert.equal(out.split('|')[0], `${f.repo}/.plot/agents`, `the main checkout's registry, asked from ${cwd}`);
    }
    assert.deepEqual(f.asks(), [], 'a correct exported answer starts no git rev-parse');
  } finally { f.cleanup(); }
});

test('fixed answers: the caller\'s PLOT_REPO_ROOT names the main checkout, with no ask', () => {
  const f = fixture();
  try {
    // fleetd's environment carries `PLOT_REPO_ROOT`; its per-desk probes run
    // with the main checkout as cwd.
    const out = sourced(f, f.repo, DIR, { PLOT_REPO_ROOT: f.repo });
    assert.equal(out, `${f.repo}/.plot/agents|${f.repo}/.git`);
    assert.deepEqual(f.asks(), []);
  } finally { f.cleanup(); }
});

test('fixed answers: another repository\'s exported answer is not reused; git answers', () => {
  const f = fixture();
  try {
    // The exported variables name `repo`, and the cwd is `other`: a different
    // repository, so the walk to `other/.git` refuses the answer.
    const out = sourced(f, f.other, DIR,
      { PLOT_GIT_COMMON_DIR: path.join(f.repo, '.git'), PLOT_REPO_ROOT: f.repo });
    assert.equal(out, `${f.other}/.plot/agents|${f.other}/.git`);
    assert.equal(f.asks().length, 1, `the other repository asks for itself:\n${f.asks().join('\n')}`);
  } finally { f.cleanup(); }
});

test('fixed answers: a desk of another repository does not reuse it either', () => {
  const f = fixture();
  try {
    const otherDesk = path.join(f.t, 'other-desk');
    git(f.other, 'worktree', 'add', '-q', '-b', 'feature/o', otherDesk);
    const out = sourced(f, otherDesk, DIR, { PLOT_GIT_COMMON_DIR: path.join(f.repo, '.git') });
    assert.equal(out.split('|')[0], `${f.other}/.plot/agents`);
    assert.equal(f.asks().length, 1);
  } finally { f.cleanup(); }
});

test('fixed answers: a wrong variable falls back to git and answers as before', () => {
  const f = fixture();
  try {
    const out = sourced(f, f.desk, DIR,
      { PLOT_GIT_COMMON_DIR: '/nonexistent', PLOT_REPO_ROOT: '/nonexistent' });
    assert.equal(out, `${f.repo}/.plot/agents|${f.repo}/.git`);
    assert.equal(f.asks().length, 1);
  } finally { f.cleanup(); }
});

test('fixed answers: a caller-set PLOT_MANIFEST_DIR still wins and asks nothing', () => {
  const f = fixture();
  try {
    const out = sourced(f, f.repo, 'printf "%s" "$PLOT_MANIFEST_DIR"', { PLOT_MANIFEST_DIR: '/given' });
    assert.equal(out, '/given');
    assert.deepEqual(f.asks(), []);
  } finally { f.cleanup(); }
});
