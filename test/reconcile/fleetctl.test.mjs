// Contract test for skills/plot/scripts/plot-fleetctl.sh — fleet control's
// mechanics, and the four refusals that stand between a person and an installed
// unit.
//
// THE REFUSALS ARE THE SUBJECT, because each is a measurement and each fails
// silently later if it is skipped. The worst of them is the node one: the unit
// bakes `$NODE` in permanently, so a wrong interpreter is a daemon that keeps
// restarting long after anybody is watching. Measured 2026-09-05 on the
// operator's own machine — `command -v node` answered 26.7.0 against a repo
// pinned to 24.
//
// NOTHING HERE TOUCHES THE REAL INIT SYSTEM. A test that ran `launchctl
// bootstrap` would install a job on the machine running the suite, and this
// suite runs on a machine that already supervises a live fleet. So the load is
// never reached: every case either refuses before it, or exercises the fill
// through the sourced form.
//
// CI IS `ubuntu-latest` ONLY, so the launchd arm cannot run there at all — and
// that is the arm a macOS operator uses. What IS assertable everywhere is that
// both units FILL with no placeholder left and PARSE, which is what the last
// group below checks. Actually loading the plist stays a manual release step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const scripts = path.join(repo, 'skills', 'plot', 'scripts');
const units = path.join(repo, 'skills', 'plot', 'units');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A repository shaped like an adopting project: a git root, a `.nvmrc`, and
 * `skills/plot/scripts/` holding copies of the scripts under test.
 *
 * REAL COPIES rather than a symlink to the repo, because `--start` composes
 * `$repo_root/skills/plot/scripts/board/plot-registryd.mjs` and the whole point
 * of refusal 1 is that this file may be absent.
 *
 * @param opts.nvmrc - the pinned major written to `.nvmrc` ('' writes no file)
 * @param opts.registryd - whether to place a stand-in supervisor artifact
 */
function sandbox(label, { nvmrc = '24', registryd = true } = {}) {
  // NESTED ONE LEVEL, and that is not tidiness. The default `Worktree root` is
  // `repo_root/..`, so a sandbox sitting directly in $TMPDIR enumerates every
  // OTHER sandbox as its own fleet — measured here on the first run, where an
  // empty repository reported eleven desks belonging to other test cases.
  const box = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `plot-fleetctl-${label}-`)));
  const root = path.join(box, 'repo');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Plot Test');
  git(root, 'config', 'commit.gpgsign', 'false');

  const dst = path.join(root, 'skills', 'plot', 'scripts');
  fs.mkdirSync(path.join(dst, 'board'), { recursive: true });
  for (const f of ['plot-fleetctl.sh', 'plot-worker-state.sh', 'plot-config.sh', 'plot-monitor-subject.sh']) {
    const src = path.join(scripts, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dst, f));
  }
  fs.chmodSync(path.join(dst, 'plot-fleetctl.sh'), 0o755);
  fs.cpSync(units, path.join(root, 'skills', 'plot', 'units'), { recursive: true });

  if (registryd) fs.writeFileSync(path.join(dst, 'board', 'plot-registryd.mjs'), 'process.exit(0);\n');
  if (nvmrc) fs.writeFileSync(path.join(root, '.nvmrc'), `${nvmrc}\n`);

  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# t\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return { root, box, ctl: path.join(dst, 'plot-fleetctl.sh') };
}

function run(ctl, args, cwd, env = {}) {
  try {
    return {
      status: 0,
      out: execFileSync('bash', [ctl, ...args], {
        encoding: 'utf8', cwd, timeout: 60000, env: { ...process.env, ...env },
      }),
    };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

// ── The verbs refuse to be guessed ────────────────────────────────────────────

test('fleetctl: no verb is a refusal, not a default', () => {
  const { root, ctl } = sandbox('noverb');
  const r = run(ctl, [], root);
  assert.equal(r.status, 1);
  assert.match(r.out, /one of --status, --once, --start, --stop/);
});

test('fleetctl: an unknown argument is named rather than ignored', () => {
  const { root, ctl } = sandbox('unknown');
  const r = run(ctl, ['--restart'], root);
  assert.equal(r.status, 1);
  assert.match(r.out, /unknown argument '--restart'/);
});

test('fleetctl: --wait takes a number', () => {
  const { root, ctl } = sandbox('waitarg');
  const r = run(ctl, ['--stop', '--wait', 'soon'], root);
  assert.equal(r.status, 1);
  assert.match(r.out, /--wait needs a number, got 'soon'/);
});

// ── Refusal 1: nothing to start ───────────────────────────────────────────────

test('refusal: no supervisor artifact names the build that makes one', () => {
  const { root, ctl } = sandbox('noartifact', { registryd: false });
  const r = run(ctl, ['--start'], root);
  assert.equal(r.status, 1);
  assert.match(r.out, /no supervisor artifact/);
  assert.match(r.out, /pnpm build:board/);
});

test('refusal: --once refuses the same absence, and says the same repair', () => {
  const { root, ctl } = sandbox('noartifact-once', { registryd: false });
  const r = run(ctl, ['--once'], root);
  assert.equal(r.status, 1);
  assert.match(r.out, /no supervisor artifact/);
  assert.match(r.out, /pnpm build:board/);
});

// ── Refusal 2: the wrong node, which is the one that fails silently later ─────

test('refusal: a node that is not the pinned major, before anything is written', () => {
  const { root, ctl } = sandbox('wrongnode', { nvmrc: '99' });
  const r = run(ctl, ['--start'], root);
  assert.equal(r.status, 1);
  assert.match(r.out, /this repository pins 99/);
  assert.match(r.out, /bakes/);
  assert.match(r.out, /nvm use/);
});

test('refusal: the wrong node refuses --dry-run too — a probe is not a preview', () => {
  const { root, ctl } = sandbox('wrongnode-dry', { nvmrc: '99' });
  const r = run(ctl, ['--start', '--dry-run'], root);
  assert.equal(r.status, 1);
  assert.match(r.out, /this repository pins 99/);
});

test('refusal: the wrong node leaves no unit behind', () => {
  const { root, ctl } = sandbox('wrongnode-clean', { nvmrc: '99' });
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  run(ctl, ['--start'], root, { HOME: home });
  // Nothing was filled: the probe runs before the first write.
  assert.equal(fs.existsSync(path.join(home, 'Library', 'LaunchAgents')), false);
  assert.equal(fs.existsSync(path.join(home, '.config', 'systemd')), false);
});

// ── The pin is read from .nvmrc, not from `engines` ───────────────────────────

test('the pin is .nvmrc — engines says >=24, which is a floor', () => {
  const { root, ctl } = sandbox('pin');
  const probe = `PLOT_FLEETCTL_SOURCED=1 . '${ctl}'; printf '%s' "$(pinned_major)"`;
  const out = execFileSync('bash', ['-c', probe], { encoding: 'utf8', cwd: root });
  assert.equal(out, '24');
});

test('no .nvmrc means no pin to compare against, so the node probe does not refuse', () => {
  const { root, ctl } = sandbox('nopin', { nvmrc: '' });
  const probe = `PLOT_FLEETCTL_SOURCED=1 . '${ctl}'; printf '[%s]' "$(pinned_major)"`;
  const out = execFileSync('bash', ['-c', probe], { encoding: 'utf8', cwd: root });
  assert.equal(out, '[]');
});

// ── --status starts nothing, and says so by its exit code ─────────────────────

test('--status starts nothing and reports the platform', () => {
  const { root, ctl } = sandbox('status');
  const r = run(ctl, ['--status'], root);
  assert.match(r.out, /^platform: /m);
  assert.match(r.out, /^summary: agents_running=\d+ /m);
  // No unit was filled by asking.
  assert.equal(fs.existsSync(path.join(root, '.plot', 'logs')), false);
});

test('--status names the fleet root when there are no worktrees', () => {
  const { root, ctl } = sandbox('statusempty');
  const r = run(ctl, ['--status'], root);
  assert.match(r.out, /no fleet worktrees under/);
});

// ── --stop orchestrates the one stop rule, and takes the supervisor last ──────

test('--stop with nothing running still reports, and does not invent an agent', () => {
  const { root, ctl } = sandbox('stopempty');
  const r = run(ctl, ['--stop'], root);
  assert.match(r.out, /no agents on a branch/);
  assert.match(r.out, /supervisor/);
});

test('--stop calls plot-dispatch --stop once per branch, and the supervisor last', () => {
  const { root, box, ctl } = sandbox('stoporder');
  // A desk with a live worker, and a `plot-dispatch.sh` that records the call
  // rather than signalling anything. THE ORDER IS THE ASSERTION: an agent
  // stopped after the supervisor was unloaded would have been unwatched for the
  // length of the shutdown.
  const desk = path.join(box, 'plot-wt-feature-a');
  git(root, 'worktree', 'add', '-q', '-b', 'feature/a', desk);

  // A live process the state reader will find, and the pid file it reads.
  const sleeper = execFileSync('bash', ['-c', 'sleep 30 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(desk, '.plot-worker.pid'), `${sleeper}\n`);

  const log = path.join(root, 'calls.log');
  fs.writeFileSync(path.join(root, 'skills', 'plot', 'scripts', 'plot-dispatch.sh'),
    `#!/usr/bin/env bash\necho "dispatch $*" >> "${log}"\nkill ${sleeper} 2>/dev/null\nexit 0\n`);
  fs.chmodSync(path.join(root, 'skills', 'plot', 'scripts', 'plot-dispatch.sh'), 0o755);

  const r = run(ctl, ['--stop', '--wait', '10'], root);
  try {
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    assert.match(calls, /dispatch --stop feature\/a/,
      'the one stop rule was called with the branch named');
    assert.match(r.out, /feature\/a\s+signalled/);
    // The supervisor is ACTED ON after the branch, always. The header line
    // ("stopping 1 agent, then the supervisor") names the plan and is not the
    // act, so the comparison is against the outcome line.
    const iBranch = r.out.indexOf('feature/a  signalled');
    const iSuper = r.out.search(/supervisor (unloaded|was not loaded|did NOT unload)/);
    assert.ok(iBranch >= 0, 'the branch was reported');
    assert.ok(iSuper > iBranch, 'the supervisor is acted on last');
  } finally {
    try { process.kill(Number(sleeper)); } catch { /* already gone */ }
    fs.rmSync(desk, { recursive: true, force: true });
  }
});

// ── The units fill and parse — the check CI can actually run on Linux ─────────

test('both unit templates carry exactly the three documented placeholders', () => {
  for (const f of ['com.plot-pm.registryd.plist', 'plot-registryd.service']) {
    const body = fs.readFileSync(path.join(units, f), 'utf8');
    const found = new Set(body.match(/__[A-Z_]+__/g) ?? []);
    assert.deepEqual([...found].sort(), ['__NODE__', '__REGISTRYD__', '__REPO_ROOT__'],
      `${f} names a placeholder the fill does not replace`);
  }
});

test('the fill leaves no placeholder in either unit', () => {
  for (const f of ['com.plot-pm.registryd.plist', 'plot-registryd.service']) {
    const body = fs.readFileSync(path.join(units, f), 'utf8')
      .replaceAll('__REPO_ROOT__', '/tmp/repo')
      .replaceAll('__NODE__', '/tmp/node')
      .replaceAll('__REGISTRYD__', '/tmp/registryd.mjs');
    assert.equal(body.match(/__[A-Z_]+__/g), null, `${f} still holds a placeholder after the fill`);
  }
});

test('the filled plist is valid XML', () => {
  const filled = fs.readFileSync(path.join(units, 'com.plot-pm.registryd.plist'), 'utf8')
    .replaceAll('__REPO_ROOT__', '/tmp/repo')
    .replaceAll('__NODE__', '/tmp/node')
    .replaceAll('__REGISTRYD__', '/tmp/registryd.mjs');
  const tmp = path.join(os.tmpdir(), `plot-plist-${process.pid}.plist`);
  fs.writeFileSync(tmp, filled);
  try {
    // `plutil` is macOS-only, so on Linux this asserts well-formedness the way
    // CI can: every open tag closes, and the document has one root.
    const tags = [...filled.matchAll(/<(\/?)([a-z]+)(?:\s[^<>]*?)?(\/?)>/g)];
    const stack = [];
    for (const [, close, name, self] of tags) {
      if (self) continue;
      if (close) assert.equal(stack.pop(), name, `${name} closes a tag that was not open`);
      else stack.push(name);
    }
    assert.deepEqual(stack, [], 'a tag was left open in the filled plist');
    assert.match(filled, /<key>Label<\/key>\s*<string>com\.plot-pm\.registryd<\/string>/);
    assert.match(filled, /<key>KeepAlive<\/key>\s*<true\/>/);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('the filled systemd unit is well-formed', () => {
  const filled = fs.readFileSync(path.join(units, 'plot-registryd.service'), 'utf8')
    .replaceAll('__REPO_ROOT__', '/tmp/repo')
    .replaceAll('__NODE__', '/tmp/node')
    .replaceAll('__REGISTRYD__', '/tmp/registryd.mjs');
  for (const section of ['[Unit]', '[Service]', '[Install]']) {
    assert.ok(filled.includes(section), `the unit has no ${section} section`);
  }
  assert.match(filled, /^ExecStart=\/tmp\/node \/tmp\/registryd\.mjs$/m);
  assert.match(filled, /^Restart=always$/m);
  assert.match(filled, /^WantedBy=default\.target$/m);
  // Every non-comment, non-blank, non-section line is `Key=Value`.
  for (const line of filled.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('[')) continue;
    assert.match(t, /^[A-Za-z][A-Za-z0-9]*=/, `not a systemd directive: ${t}`);
  }
});
