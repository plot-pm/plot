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
import { existsSync as fsExistsSync, mkdtempSync, readdirSync as fsReaddirSync, rmSync, writeFileSync } from 'node:fs';
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

// Exit 3 (repo unresolvable or the App token exchange failed) and exit 4 (a
// malformed or unreadable key) are refusals a retry cannot clear — distinct
// from `rejected`, which a retry against a fresh base can.
test('push-main: classify calls exit 3 refused', () => {
  assert.equal(classify(3, 'anything'), 'refused');
});

test('push-main: classify calls exit 4 refused', () => {
  assert.equal(classify(4, 'anything'), 'refused');
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
  // Tightened from notEqual(r.code, 0): a bare non-zero check would still pass
  // if a future regression silently shifted this exit code, which is exactly
  // the App-exchange failure plot-push-writer-app.mjs:60 names as exit 3.
  assert.equal(r.code, 3);
  assert.match(r.stderr, /App 999001 has no installation on example\/repo/, 'the token exchange ran');
  assert.match(r.stderr, /^push: refused/m);
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

// A CONFIGURED CREDENTIAL HELPER MUST NOT BE A SECOND SOURCE. A helper that
// answers before GIT_ASKPASS is ever consulted would let an ambient
// credential push instead of (or alongside) the App's installation token.
// `git -c credential.helper=` on the push call overrides any helper for that
// one invocation — proved here by a helper that, if consulted, would record
// the fact and supply a bogus credential of its own.
test('push-main: a configured credential helper is not consulted during the App push', () => {
  const { dir, work, bare } = githubRepo(null);
  const keyPath = throwawayKey(dir);
  writeFileSync(path.join(work, 'CLAUDE.md'), `## Plot Config\n\n- **Writer app:** 999001 ${keyPath}\n`);

  const sentinel = path.join(dir, 'helper-was-called');
  const helperScript = path.join(dir, 'nosy-credential-helper.sh');
  writeFileSync(
    helperScript,
    `#!/bin/sh\ntouch "${sentinel}"\necho "username=bogus"\necho "password=bogus-token"\n`,
    { mode: 0o755 },
  );
  git(work, 'config', 'credential.helper', helperScript);

  pushGithub(work);
  assert.equal(fsExistsSync(sentinel), false, 'the configured credential helper must not run during the App push');
});

// FINDING #2: the token directory is removed on every exit path, including a
// refuse() after it was created. The App-path refusal here (exit 3, no
// installation) happens AFTER `dir` is created at plot-push-writer-app.mjs:62
// — this proves the `finally` still fires via the process's own exit, by
// checking no stray `plot-writer-app-*` directory from this run survives.
test('push-main: the token directory does not survive an App-path refusal', () => {
  const { work } = githubRepo(null);
  const before = new Set(fsReaddirSync(tmpdir()).filter((n) => n.startsWith('plot-writer-app-')));
  const keyPath = throwawayKey(path.dirname(work));
  writeFileSync(path.join(work, 'CLAUDE.md'), `## Plot Config\n\n- **Writer app:** 999001 ${keyPath}\n`);
  pushGithub(work);
  const after = fsReaddirSync(tmpdir()).filter((n) => n.startsWith('plot-writer-app-') && !before.has(n));
  assert.deepEqual(after, [], 'no plot-writer-app- directory survives the refusal');
});

// FINDING #4: a key file that reads fine but whose contents fail to sign
// (the POST-exchange case — resolveApp only checks the file is readable)
// resolves through installationToken to a named error, not an unhandled
// rejection. The pre-exchange case (resolveApp's own read check) is covered
// above by the unreadable-key and malformed-CLAUDE.md tests.
test('push-main: a readable but non-PEM Writer app key is caught and named, not thrown', () => {
  const { dir, work, bare } = githubRepo(null);
  const before = mainLog(bare);
  const notAPem = path.join(dir, 'not-a-pem.pem');
  writeFileSync(notAPem, 'this is not a PEM-encoded key\n');
  writeFileSync(path.join(work, 'CLAUDE.md'), `## Plot Config\n\n- **Writer app:** 999001 ${notAPem}\n`);

  const r = pushGithub(work);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /App 999001/);
  assert.match(r.stderr, /key failed to sign/);
  assert.match(r.stderr, /^push: refused/m);
  assert.equal(mainLog(bare), before);
});
