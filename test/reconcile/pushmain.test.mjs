// Contract test for skills/plot/scripts/plot-push-main.sh — the direct-to-
// default-branch push and its outcome classification.
//
// Two halves, tested two ways, because one of the four outcomes cannot be
// produced locally at all:
//
//   clean / rejected  — real pushes against a local bare repo. A push behind
//                       its remote counterpart is a genuine non-fast-forward
//                       rejection, not a simulation.
//   bypassed / unknown — through `--classify`, fed the REAL recorded stderr.
//                       A true bypass needs a protected GitHub remote plus an
//                       actor entitled to step over it; CI has neither.
//
// The bypass fixture below is the verbatim output of a real push to this
// repository's main on 2026-08-16 — not a paraphrase. A fixture written from
// memory of what the message looks like would only test the matcher against
// its own author's recollection.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Every directory this file creates, removed after its last test by the exact
// path mkdtempSync returned — never by a glob over the shared temp directory.
const made = [];
const scratch = (prefix) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-push-main.sh');
const writerHelper = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-push-writer-app.mjs');

/** Verbatim: GitHub's reply to a protected-but-not-enforced push (2026-08-16). */
const REAL_BYPASS_STDERR = [
  'remote: Bypassed rule violations for refs/heads/main:        ',
  'remote: ',
  'remote: - Changes must be made through a pull request.        ',
  'remote: ',
  'remote: - Required status check "validate" is expected.        ',
  'remote: ',
].join('\n');

const classify = (code, stderr) =>
  execFileSync('bash', [helper, '--classify', String(code)], {
    encoding: 'utf8',
    input: stderr,
  }).trim();

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** A bare remote plus a working clone, both with `main` in place. */
function makeRepo() {
  const dir = scratch('plot-pushmain-');
  const bare = path.join(dir, 'b.git');
  const work = path.join(dir, 'w');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  execFileSync('git', ['init', '-q', work]);
  git(work, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(work, 'branch', '-M', 'main');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-q', 'origin', 'main');
  return { dir, bare, work };
}

function push(work, branch, target) {
  try {
    return {
      code: 0,
      out: execFileSync('bash', [helper, branch, target], { cwd: work, encoding: 'utf8' }),
    };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('push-main: classify reads the real bypass notice', () => {
  assert.equal(classify(0, REAL_BYPASS_STDERR), 'bypassed');
});

test('push-main: classify calls silence clean', () => {
  assert.equal(classify(0, ''), 'clean');
});

// The outcome that keeps the helper honest when GitHub rewords its notice: any
// remote commentary we cannot read must be its own answer. Filing it under
// `clean` would make the check go quiet exactly when it stops working.
test('push-main: classify calls unrecognised remote output unknown, never clean', () => {
  assert.equal(classify(0, 'remote: Some future wording nobody anticipated'), 'unknown');
});

test('push-main: classify calls a non-zero exit rejected', () => {
  assert.equal(classify(1, 'remote: anything at all'), 'rejected');
});

// A loose pattern would file ordinary remote chatter as a protection bypass,
// and a false alarm trains people to ignore the real one.
test('push-main: the word "bypass" alone is not a bypass', () => {
  assert.equal(classify(0, 'remote: running bypass-cache hook'), 'unknown');
});

test('push-main: a clean push reports clean and exits 0', () => {
  const { work } = makeRepo();
  git(work, 'checkout', '-q', '-b', 'plot/tmp');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'bookkeeping');

  const r = push(work, 'plot/tmp', 'main');
  assert.equal(r.code, 0);
  assert.match(r.out, /^push: clean/);
});

// THE point of the exit code: it answers "did the commit land?", nothing else.
// A push that landed must never read as failure at a call site.
test('push-main: a landed push leaves the commit on the default branch', () => {
  const { work, bare } = makeRepo();
  git(work, 'checkout', '-q', '-b', 'plot/tmp');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'bookkeeping');
  push(work, 'plot/tmp', 'main');

  const log = execFileSync('git', ['log', '--oneline', 'main'], { cwd: bare, encoding: 'utf8' });
  assert.match(log, /bookkeeping/);
});

test('push-main: a real non-fast-forward is rejected and exits 1', () => {
  const { work } = makeRepo();
  // Advance the remote so the stale branch is genuinely behind.
  git(work, 'checkout', '-q', '-b', 'ahead');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'remote moved on');
  git(work, 'push', '-q', 'origin', 'ahead:main');
  git(work, 'checkout', '-q', '-B', 'stale', 'main');

  const r = push(work, 'stale', 'main');
  assert.equal(r.code, 1);
  assert.match(r.out, /^push: rejected/m);
});

// `git push <branch>:<default>` never creates <branch> on the remote, which is
// why /plot-approve's `push --delete` line had been removing nothing for its
// whole existence. Pinned so nobody re-adds the cleanup.
test('push-main: pushing branch:default creates no remote branch', () => {
  const { work, bare } = makeRepo();
  git(work, 'checkout', '-q', '-b', 'plot/tmp');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'bookkeeping');
  push(work, 'plot/tmp', 'main');

  const refs = execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/heads/'], {
    cwd: bare,
    encoding: 'utf8',
  }).trim();
  assert.equal(refs, 'refs/heads/main');
});

// THE WRITER APP IS OPT-IN THROUGH ITS KEY. A `github.com` origin asks
// `plot-push-writer-app.mjs` first; what it answers depends on `## Plot
// Config`. `PLOT_REPO_ROOT` points `plot-config.sh` at the sandbox, so the
// config each case reads is the one it writes. `pushInsteadOf` sends the
// ambient push to the local bare remote while `remote.origin.url` still names
// GitHub, so no case reaches the network through git.
const githubRepo = (claudeMd) => {
  const { dir, work, bare } = makeRepo();
  git(work, 'checkout', '-q', '-b', 'plot/tmp');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'bookkeeping');
  git(work, 'remote', 'set-url', 'origin', 'https://github.com/example/repo.git');
  git(work, 'config', `url.${bare}.pushInsteadOf`, 'https://github.com/example/repo.git');
  if (claudeMd != null) writeFileSync(path.join(work, 'CLAUDE.md'), claudeMd);
  return { dir, work, bare };
};

const pushGithub = (work, env = {}) => {
  const res = spawnSync('bash', [helper, 'plot/tmp', 'main'], {
    cwd: work,
    encoding: 'utf8',
    // An unreachable API base: a case that reaches the token exchange fails
    // at once instead of calling api.github.com.
    env: { ...process.env, PLOT_REPO_ROOT: work, GITHUB_API_URL: 'http://127.0.0.1:9', ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
};

const mainLog = (bare) => execFileSync('git', ['log', '--oneline', 'main'], { cwd: bare, encoding: 'utf8' });

const throwawayKey = (dir) => {
  const keyPath = path.join(dir, 'writer-app-key.pem');
  writeFileSync(keyPath, generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey, { mode: 0o600 });
  return keyPath;
};

test('push-main: a github.com origin with no Writer app key pushes as the ambient identity and says so once', () => {
  const { work, bare } = githubRepo('## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  const r = pushGithub(work);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^push: clean — plot\/tmp → main/);
  assert.match(mainLog(bare), /bookkeeping/, 'the ambient push landed on the bare remote');
  const notices = r.stderr.split('\n').filter((line) => line.includes('Writer app'));
  assert.deepEqual(notices, ['plot-push-main: Writer app not configured — pushing as the ambient git identity']);
});

test('push-main: the ambient fallback still classifies a rejected push', () => {
  const { work, bare } = githubRepo(null);
  const other = path.join(path.dirname(bare), 'other');
  execFileSync('git', ['clone', '-q', bare, other]);
  git(other, 'checkout', '-q', '-B', 'main', 'origin/main');
  git(other, 'commit', '-q', '--allow-empty', '-m', 'remote moved on');
  git(other, 'push', '-q', 'origin', 'main');
  const r = pushGithub(work);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^push: rejected/m);
  assert.match(r.stderr, /Writer app not configured/);
});

test('push-main: a declared, readable Writer app key takes the App path, never the ambient push', () => {
  const { dir, work, bare } = githubRepo(null);
  const keyPath = throwawayKey(dir);
  writeFileSync(path.join(work, 'CLAUDE.md'), `## Plot Config\n\n- **Writer app:** 999001 ${keyPath}\n`);
  const before = mainLog(bare);
  const r = pushGithub(work);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /App 999001 has no installation on example\/repo/, 'the token exchange ran');
  assert.doesNotMatch(r.stderr, /not configured/);
  assert.equal(mainLog(bare), before, 'no ambient push happened after the App path failed');
});

test('push-main: a declared but unreadable Writer app key refuses by name and pushes nothing', () => {
  const { dir, work, bare } = githubRepo(null);
  const missing = path.join(dir, 'no-such-key.pem');
  writeFileSync(path.join(work, 'CLAUDE.md'), `## Plot Config\n\n- **Writer app:** 999001 ${missing}\n`);
  const before = mainLog(bare);
  const r = pushGithub(work);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /'Writer app' names a key file that cannot be read/);
  assert.equal(mainLog(bare), before);

  const helperRes = spawnSync('node', [writerHelper, 'plot/tmp', 'main'], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, PLOT_REPO_ROOT: work },
  });
  assert.equal(helperRes.status, 4, 'the helper itself refuses with exit 4');
});

test('push-main: a malformed Writer app key refuses with exit 4 and pushes nothing', () => {
  const { work, bare } = githubRepo('## Plot Config\n\n- **Writer app:** 999001\n');
  const before = mainLog(bare);
  const helperRes = spawnSync('node', [writerHelper, 'plot/tmp', 'main'], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, PLOT_REPO_ROOT: work },
  });
  assert.equal(helperRes.status, 4);
  assert.match(helperRes.stderr, /needs a 'Writer app' key/);
  assert.notEqual(pushGithub(work).code, 0);
  assert.equal(mainLog(bare), before);
});
