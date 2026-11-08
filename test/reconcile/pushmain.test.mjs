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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync as fsExistsSync, readFileSync, mkdirSync, mkdtempSync, readdirSync as fsReaddirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeApproveSandbox, pushPlanHead } from './approve-sandbox.mjs';

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

test('push-main: an id-only Writer app line with no key in the config folder refuses with exit 4 and pushes nothing', () => {
  const { work, bare } = githubRepo('## Plot Config\n\n- **Writer app:** 999001\n');
  const before = mainLog(bare);
  const helperRes = spawnSync('node', [writerHelper, 'plot/tmp', 'main'], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, PLOT_REPO_ROOT: work, XDG_CONFIG_HOME: path.join(work, 'no-such-xdg') },
  });
  assert.equal(helperRes.status, 4);
  assert.match(helperRes.stderr, /plot-writer\.999001\.private-key\.pem/);
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

// Serialisation (#1349). The lock is a directory under the common git dir, so
// every worktree of a repository takes the same one.
const lockDir = (work) => path.join(work, '.git', 'plot-push-main.lock');
const pushWith = (work, env, branch = 'plot/tmp') =>
  spawnSync('bash', [helper, branch, 'main'], { cwd: work, encoding: 'utf8', env: { ...process.env, ...env } });
const prepared = () => {
  const repo = makeRepo();
  git(repo.work, 'checkout', '-q', '-b', 'plot/tmp');
  git(repo.work, 'commit', '-q', '--allow-empty', '-m', 'bookkeeping');
  return repo;
};

test('push-main: a second writer waits for the lock and lands after the holder releases', async () => {
  const { work, bare } = prepared();
  mkdirSync(lockDir(work));
  writeFileSync(path.join(lockDir(work), 'owner'), `${process.pid}\t${Date.now()}\tholder\n`);
  setTimeout(() => rmSync(lockDir(work), { recursive: true, force: true }), 1500);
  const started = Date.now();
  const r = await new Promise((resolve) => {
    const child = spawn('bash', [helper, 'plot/tmp', 'main'], { cwd: work });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
  assert.equal(r.code, 0);
  assert.match(r.out, /^push: clean/);
  assert.ok(Date.now() - started >= 1000, 'the push waited for the holder');
  assert.match(mainLog(bare), /bookkeeping/);
  assert.equal(fsExistsSync(lockDir(work)), false, 'the lock is released after the push');
});

test('push-main: a waiter past the bound refuses with exit 6 naming the holder pid and action', () => {
  const { work, bare } = prepared();
  mkdirSync(lockDir(work));
  writeFileSync(path.join(lockDir(work), 'owner'), `${process.pid}\t${Date.now()}\tpush plot/other\n`);
  const r = pushWith(work, { PLOT_PUSH_LOCK_WAIT: '1' });
  assert.equal(r.status, 6);
  assert.match(r.stderr, new RegExp(`push: locked — held by pid ${process.pid} running push plot/other`));
  assert.doesNotMatch(mainLog(bare), /bookkeeping/, 'nothing was pushed');
  assert.equal(fsExistsSync(lockDir(work)), true, 'a live holder keeps its lock');
});

test('push-main: a lock whose holder pid is dead is recovered, not waited on', () => {
  const { work, bare } = prepared();
  const dead = spawnSync('bash', ['-c', 'echo $$']).stdout.toString().trim();
  mkdirSync(lockDir(work));
  writeFileSync(path.join(lockDir(work), 'owner'), `${dead}\t${Date.now()}\tpush plot/gone\n`);
  const r = pushWith(work, { PLOT_PUSH_LOCK_WAIT: '30' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(mainLog(bare), /bookkeeping/);
  assert.equal(fsExistsSync(lockDir(work)), false);
});

test('push-main: a rejected push still releases the lock', () => {
  const { work, bare } = prepared();
  const other = path.join(path.dirname(bare), 'other');
  execFileSync('git', ['clone', '-q', bare, other]);
  git(other, 'checkout', '-q', '-B', 'main', 'origin/main');
  git(other, 'commit', '-q', '--allow-empty', '-m', 'remote moved on');
  git(other, 'push', '-q', 'origin', 'main');
  const r = pushWith(work, {});
  assert.equal(r.status, 1);
  assert.equal(fsExistsSync(lockDir(work)), false);
});

// PLOT_PUSH_LOCK_HOLDER (the-push-lock-spans-the-booking). A caller that
// already holds the lock — `commitAndPush` does, before the fetch and
// commit — names itself so this script does not take a second lock and
// deadlock against its own caller.
const lockHelper = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-push-lock.mjs');

test('push-main: a declared PLOT_PUSH_LOCK_HOLDER pushes at once without waiting the bound', () => {
  const { work, bare } = prepared();
  mkdirSync(lockDir(work));
  // A declared holder short-circuits `take()` before it ever reads the owner
  // file's pid for aliveness, so the recorded "owner" here can be anyone —
  // this test uses the current process's own pid so the owner line reads as
  // a genuinely live holder regardless.
  writeFileSync(path.join(lockDir(work), 'owner'), `${process.pid}\t${Date.now()}\tpush plot/other\n`);
  const started = Date.now();
  const r = pushWith(work, { PLOT_PUSH_LOCK_HOLDER: String(process.pid), PLOT_PUSH_LOCK_WAIT: '30' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^push: clean/);
  // Well under the 30s bound rather than a tight wall-clock ceiling — the
  // contract is "did not wait the bound at all", not a specific millisecond
  // count a loaded CI runner cannot promise.
  assert.ok(Date.now() - started < 15_000, 'a declared holder does not wait the bound at all');
  assert.match(mainLog(bare), /bookkeeping/);
  // The declared holder released nothing on this script's exit — the lock
  // directory this test created is still exactly as it left it.
  assert.equal(fsExistsSync(lockDir(work)), true, 'this script releases nothing it did not take');
});

test('push-main: with no declared holder, the script still waits normally and exits 6 past the bound', () => {
  const { work, bare } = prepared();
  mkdirSync(lockDir(work));
  writeFileSync(path.join(lockDir(work), 'owner'), `${process.pid}\t${Date.now()}\tpush plot/other\n`);
  const r = pushWith(work, { PLOT_PUSH_LOCK_WAIT: '1' });
  assert.equal(r.status, 6);
  assert.doesNotMatch(mainLog(bare), /bookkeeping/, 'nothing was pushed');
});

const lockTake = (work, holderId, action, env = {}) =>
  spawnSync('node', [lockHelper, 'take', holderId, action], { cwd: work, encoding: 'utf8', env: { ...process.env, ...env } });
const lockRelease = (work, holderId) =>
  spawnSync('node', [lockHelper, 'release', holderId], { cwd: work, encoding: 'utf8' });

// Rewrites the owner line in place through a rename, never removing the lock
// directory, so a waiter can never take the lock between a remove and a
// re-create.
const relabel = (work, holderId, action) => {
  const tmp = path.join(lockDir(work), 'owner.tmp');
  writeFileSync(tmp, `${holderId}\t${Date.now()}\t${action}\n`);
  renameSync(tmp, path.join(lockDir(work), 'owner'));
};

test('plot-push-lock.mjs take: a wait outlives PLOT_PUSH_LOCK_WAIT while the holder keeps changing', async () => {
  const { work } = makeRepo();
  mkdirSync(lockDir(work));
  relabel(work, `${process.pid}.1`, 'push plot/a');
  // Hands the lock to a new live holder every 400ms — well inside the 1s
  // bound — so `take`'s no-progress clock keeps resetting.
  let turn = 1;
  const handOver = setInterval(() => {
    turn += 1;
    relabel(work, `${process.pid}.${turn}`, `push plot/${turn}`);
  }, 400);
  const waiter = spawn('node', [lockHelper, 'take', String(process.pid), 'push plot/c'], {
    cwd: work,
    env: { ...process.env, PLOT_PUSH_LOCK_WAIT: '1' },
  });
  const closed = new Promise((resolve) => waiter.on('close', resolve));
  try {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(waiter.exitCode, null, 'the waiter is still waiting 2.5s into a 1s no-progress bound');
    clearInterval(handOver);
    rmSync(lockDir(work), { recursive: true, force: true });
    assert.equal(await closed, 0, 'the waiter takes the lock once it is free');
  } finally {
    clearInterval(handOver);
    if (waiter.exitCode === null) waiter.kill();
    lockRelease(work, String(process.pid));
  }
});

test('plot-push-lock.mjs take: exits 6 when one holder stays past the bound unchanged', () => {
  const { work } = makeRepo();
  mkdirSync(lockDir(work));
  writeFileSync(path.join(lockDir(work), 'owner'), `${process.pid}\t${Date.now()}\tpush plot/a\n`);
  const r = lockTake(work, String(process.pid + 1), 'push plot/b', { PLOT_PUSH_LOCK_WAIT: '1' });
  assert.equal(r.status, 6);
  assert.match(r.stderr, new RegExp(`held by pid ${process.pid} running push plot/a`));
});

// A pid no process holds, past 999999: a real Linux pid can be 7 digits
// (`kernel.pid_max` 4194304), and a dead one must read dead.
const dead7DigitPid = () => {
  for (let pid = 1234567; ; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') return pid;
    }
  }
};

test('plot-push-lock.mjs take: a dead 7-digit holder pid is broken at once, not read through pid 1', () => {
  const { work } = makeRepo();
  const dead = dead7DigitPid();
  mkdirSync(lockDir(work));
  writeFileSync(path.join(lockDir(work), 'owner'), `${dead}\t${Date.now()}\tpush plot/gone\n`);
  const r = lockTake(work, '42', 'push plot/b', { PLOT_PUSH_LOCK_WAIT: '2' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, new RegExp(`broke a stale lock held by pid ${dead}`));
  lockRelease(work, '42');
});

test('plot-push-lock.mjs take: a board holder <pid>.<seq> lives as long as its pid', () => {
  const { work } = makeRepo();
  mkdirSync(lockDir(work));
  writeFileSync(path.join(lockDir(work), 'owner'), `${process.pid}.3\t${Date.now()}\tpush plot/board\n`);
  const live = lockTake(work, '42', 'push plot/b', { PLOT_PUSH_LOCK_WAIT: '1' });
  assert.equal(live.status, 6, 'a live board process keeps its lock');
  writeFileSync(path.join(lockDir(work), 'owner'), `${dead7DigitPid()}.3\t${Date.now()}\tpush plot/board\n`);
  const gone = lockTake(work, '42', 'push plot/b', { PLOT_PUSH_LOCK_WAIT: '2' });
  assert.equal(gone.status, 0, gone.stderr);
  lockRelease(work, '42');
});

test('plot-push-lock.mjs release: removes the lock only for the holder that named it', () => {
  const { work } = makeRepo();
  assert.equal(lockTake(work, `${process.pid}.7`, 'push plot/a').status, 0);
  lockRelease(work, `${process.pid}.70`);
  assert.equal(fsExistsSync(lockDir(work)), true, 'another holder releases nothing');
  lockRelease(work, `${process.pid}.7`);
  assert.equal(fsExistsSync(lockDir(work)), false);
});

// ── State branch: a write lands on the state ref and never on the default ──

const SCRIPTS = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const stateCut = path.join(SCRIPTS, 'board', 'plot-state-cut.mjs');

/** A pre-receive hook that logs and refuses every push to refs/heads/main. */
const refuseMainHook = (bare, log) => {
  const hook = path.join(bare, 'hooks', 'pre-receive');
  writeFileSync(hook, `#!/bin/sh
while read old new ref; do
  if [ "$ref" = "refs/heads/main" ]; then echo "$ref" >> "${log}"; echo "main is protected" >&2; exit 1; fi
done
`, { mode: 0o755 });
};

const STATE_CLAUDE = (key) => '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n'
  + (key ? `- **State branch:** ${key}\n` : '');

const approvablePlan = (branch) => `# A plan

## Status

- **State:** Draft
- **Type:** bug
- **Review:** pr
- **Impl:** own branches
- **Approved:**

## Branches

### Wave one

- \`${branch}\` — do the thing
`;

const deliverablePlan = `# A delivered plan

## Status

- **State:** Approved
- **Type:** bug
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-01-01, T, in-session

## Changelog

- Did a thing.
`;

/** A `gh` stub that answers the plan PR's head and accepts the merge. */
const ghStub = (dir, headSha) => {
  const stateFile = path.join(dir, 'state.json');
  writeFileSync(stateFile, JSON.stringify({ number: 42, state: 'OPEN', headSha }));
  writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash\nexec node "${dir}/gh.mjs" "$@"\n`, { mode: 0o755 });
  writeFileSync(path.join(dir, 'gh.mjs'), `
import fs from 'node:fs';
const argv = process.argv.slice(2);
const f = ${JSON.stringify(stateFile)};
const st = JSON.parse(fs.readFileSync(f, 'utf8'));
if (argv[0] === 'pr' && argv[1] === 'view') {
  process.stdout.write(JSON.stringify({ number: st.number, state: st.state, isDraft: false,
    url: 'https://example.invalid/pr/42', mergeCommit: null, headRefOid: st.headSha }));
} else if (argv[0] === 'pr' && argv[1] === 'merge') {
  st.state = 'MERGED'; fs.writeFileSync(f, JSON.stringify(st)); process.stdout.write('merged');
} else if (argv[0] === 'pr' && argv[1] === 'list') { process.stdout.write('[]'); }
else if (argv[0] === 'repo' && argv[1] === 'view') { process.stdout.write('main'); }
else { process.stdout.write('{}'); }
`);
};

const run = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const cleanEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  delete env.PLOT_REPO_ROOT;
  delete env.PLOT_UNATTENDED;
  return env;
};

const stateSandbox = (key) => {
  const approveRel = 'docs/plans/2026-09-17-to-approve.md';
  const deliverRel = 'docs/plans/2026-09-17-to-deliver.md';
  const sbx = makeApproveSandbox({
    prefix: 'plot-state-write-',
    claudeMd: STATE_CLAUDE(key),
    planRel: approveRel,
    planBody: approvablePlan('bug/to-approve-work'),
    activeLinkName: 'to-approve.md',
    extraFiles: { [deliverRel]: deliverablePlan },
  });
  made.push(sbx.tmp);
  return { ...sbx, approveRel, deliverRel };
};

test('state branch: approve and deliver land on the state ref and the default branch takes zero pushes', () => {
  const { tmp, origin, repo, approveRel, deliverRel } = stateSandbox('plot/state');
  const headSha = pushPlanHead({ tmp, repo, planRel: approveRel, branch: 'idea/to-approve' });
  const stub = path.join(tmp, 'stub');
  mkdirSync(stub);
  ghStub(stub, headSha);
  const log = path.join(tmp, 'main-pushes.log');
  refuseMainHook(origin, log);
  const env = cleanEnv({ PATH: `${stub}:${process.env.PATH}`, PLOT_HOST: 'github' });

  const approved = run('bash', [path.join(SCRIPTS, 'plot-approve.sh'), 'to-approve'], { cwd: repo, env });
  assert.equal(approved.code, 0, `approve should succeed against a protected main:\n${approved.out}`);
  const delivered = run('bash', [path.join(SCRIPTS, 'plot-deliver.sh'), 'to-deliver'], { cwd: repo, env });
  assert.equal(delivered.code, 0, `deliver should succeed against a protected main:\n${delivered.out}`);

  assert.equal(fsExistsSync(log), false, `the default branch took a push:\n${fsExistsSync(log) ? log : ''}`);
  git(repo, 'fetch', '-q', 'origin');
  const onState = git(repo, 'show', `origin/plot/state:${approveRel}`);
  assert.match(onState, /\*\*State:\*\* Approved/, 'the approval is on the state branch');
  assert.match(git(repo, 'show', `origin/plot/state:${deliverRel}`), /\*\*State:\*\* Delivered/, 'the delivery is on the state branch');
  assert.match(git(repo, 'show', `origin/main:${approveRel}`), /\*\*State:\*\* Draft/, 'main still reads Draft');
  // origin/main is an ancestor of origin/plot/state after each write.
  git(repo, 'merge-base', '--is-ancestor', 'origin/main', 'origin/plot/state');
});

test('state branch: a second write cuts from the state tip and keeps main an ancestor', () => {
  const { tmp, origin, repo, deliverRel } = stateSandbox('plot/state');
  // A write by someone else lands on main after the state branch was created.
  const env = cleanEnv();
  const first = run('bash', [path.join(SCRIPTS, 'plot-deliver.sh'), 'to-deliver'], { cwd: repo, env });
  assert.equal(first.code, 0, first.out);
  writeFileSync(path.join(repo, 'later.txt'), 'x\n');
  git(repo, 'add', 'later.txt');
  git(repo, 'commit', '-qm', 'main moves');
  git(repo, 'push', '-q', 'origin', 'main');
  const stateBefore = git(repo, 'ls-remote', origin, 'refs/heads/plot/state').split('\t')[0];

  const land = run('node', [stateCut, '--land'], { cwd: repo, env });
  assert.equal(land.code, 0, land.out);
  git(repo, 'fetch', '-q', 'origin');
  const stateAfter = git(repo, 'rev-parse', 'origin/plot/state').trim();
  assert.notEqual(stateAfter, stateBefore, 'the land moved the state branch');
  git(repo, 'merge-base', '--is-ancestor', 'origin/main', 'origin/plot/state');
  assert.match(git(repo, 'show', `origin/plot/state:${deliverRel}`), /Delivered/);
});

test('state branch: with no key the write goes to main as today and the state branch is never created', () => {
  const { origin, repo, deliverRel } = stateSandbox('');
  const r = run('bash', [path.join(SCRIPTS, 'plot-deliver.sh'), 'to-deliver'], { cwd: repo, env: cleanEnv() });
  assert.equal(r.code, 0, r.out);
  git(repo, 'fetch', '-q', 'origin');
  assert.match(git(repo, 'show', `origin/main:${deliverRel}`), /\*\*State:\*\* Delivered/);
  assert.equal(git(repo, 'ls-remote', origin, 'refs/heads/plot/state').trim(), '', 'no state branch appears');
  const land = run('node', [stateCut, '--land'], { cwd: repo, env: cleanEnv() });
  assert.equal(land.code, 4, 'no key: --land answers NO_STATE_BRANCH');
});

test('state branch: a forward-merge conflict refuses, names the file and leaves the state branch unmoved', () => {
  const { origin, repo, deliverRel } = stateSandbox('plot/state');
  const env = cleanEnv();
  const first = run('bash', [path.join(SCRIPTS, 'plot-deliver.sh'), 'to-deliver'], { cwd: repo, env });
  assert.equal(first.code, 0, first.out);
  // Main edits the line the state branch already changed.
  git(repo, 'fetch', '-q', 'origin');
  git(repo, 'checkout', '-q', 'main');
  const body = readFileSync(path.join(repo, deliverRel), 'utf8').replace('**State:** Approved', '**State:** Rewritten on main');
  writeFileSync(path.join(repo, deliverRel), body);
  git(repo, 'commit', '-qam', 'main edits the plan');
  git(repo, 'push', '-q', 'origin', 'main');
  const before = git(repo, 'ls-remote', origin, 'refs/heads/plot/state').trim();

  const land = run('node', [stateCut, '--land'], { cwd: repo, env });
  assert.notEqual(land.code, 0, 'a conflict refuses');
  assert.match(land.out, /to-deliver\.md/, 'the refusal names the file');
  assert.equal(git(repo, 'ls-remote', origin, 'refs/heads/plot/state').trim(), before, 'origin/plot/state did not move');
});

test('state branch: a non-branch ref is written like a branch', () => {
  const { origin, repo, deliverRel } = stateSandbox('refs/plot/state');
  const r = run('bash', [path.join(SCRIPTS, 'plot-deliver.sh'), 'to-deliver'], { cwd: repo, env: cleanEnv() });
  assert.equal(r.code, 0, r.out);
  const shown = git(repo, 'ls-remote', origin, 'refs/plot/state').trim();
  assert.notEqual(shown, '', 'refs/plot/state exists on the origin');
  assert.match(git(origin, 'show', `refs/plot/state:${deliverRel}`), /Delivered/);
});

test('state branch: a github origin without a Writer app key pushes the state ref and leaves main alone', () => {
  const { work, bare } = githubRepo('## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  const before = mainLog(bare);
  const res = spawnSync('bash', [helper, 'plot/tmp', 'refs/heads/plot/state'], {
    cwd: work, encoding: 'utf8',
    env: { ...process.env, PLOT_REPO_ROOT: work, GITHUB_API_URL: 'http://127.0.0.1:9' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^push: clean/);
  assert.equal(mainLog(bare), before, 'main did not move');
  assert.match(execFileSync('git', ['log', '--oneline', 'plot/state'], { cwd: bare, encoding: 'utf8' }), /bookkeeping/);
});

test('state branch: the Writer app path takes the state ref as its destination and pushes nothing else', () => {
  // plot-push-writer-app.mjs pushes `<branch>:<destination>` with the second
  // argument verbatim, so a state ref needs no change there. The exchange fails
  // at the unreachable installation lookup, which proves the App path ran for
  // the state target and that no ambient push followed it.
  const { dir, work, bare } = githubRepo(null);
  const keyPath = throwawayKey(dir);
  writeFileSync(path.join(work, 'CLAUDE.md'), `## Plot Config\n\n- **Writer app:** 999001 ${keyPath}\n`);
  const res = spawnSync('bash', [helper, 'plot/tmp', 'refs/heads/plot/state'], {
    cwd: work, encoding: 'utf8',
    env: { ...process.env, PLOT_REPO_ROOT: work, GITHUB_API_URL: 'http://127.0.0.1:9' },
  });
  assert.equal(res.status, 3);
  assert.match(res.stderr, /App 999001 has no installation on example\/repo/);
  assert.equal(execFileSync('git', ['for-each-ref', 'refs/heads/plot/state'], { cwd: bare, encoding: 'utf8' }), '');
});
