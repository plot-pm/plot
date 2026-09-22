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
// AND EVERY CASE RUNS UNDER ITS OWN LABEL, which is the other half of that.
// `launchctl` keys by LABEL and answers about the whole machine — no `HOME`
// override reaches it — so a sandbox using the real label reads the operator's
// live fleet as its own. Measured here: `--status` reported `running` where
// the test had installed nothing, and `--start` refused with *already loaded*
// about a unit no test wrote. `sandbox()` mints a label per case and the runs
// pass it as `PLOT_FLEET_LABEL`; the suite never unloads anything, because
// `--stop` ends work in flight and is a person's call.
//
// CORRECTED 2026-09-22: BOTH SENTENCES WERE FALSE FOR THE FILE'S WHOLE LIFE.
// 9 of 21 call sites passed the label and none of the three `--stop` sites did,
// so those runs reached launchd under the production label and unloaded this
// machine's own supervisor — proven by loading a decoy under
// `com.plot-pm.registryd` and watching the suite boot it out. The claim is now
// enforced rather than asserted: `sandbox()` mints a `guardBin` with stub
// `launchctl` and `systemctl`, `run()` REFUSES a call that does not pass it,
// and the decoy survives.
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

  // A LABEL THIS MACHINE DOES NOT HOLD, and a distinct one per sandbox.
  //
  // `supervisor_loaded` asks launchd, which keys by LABEL and is MACHINE-GLOBAL
  // — no `HOME` override reaches it. Measured here: this machine supervises a
  // live fleet, so every sandbox using the real label read that fleet as its
  // own and `--status` reported `running` where the test had installed nothing.
  //
  // THE BRIEF PRESCRIBES EXACTLY THIS: test "under a different label, never by
  // unloading the running one" — `--stop` ends work in flight and is a person's
  // call, so a suite may never take that route.
  //
  // PER-SANDBOX rather than one spare label, because `node --test` runs files
  // concurrently: a shared label would let two sandboxes see each other's
  // plist, the same cross-talk this function's own worktree-root comment
  // describes. The pid keeps concurrent runs of the suite apart too.
  const fleetLabel = `com.plot-pm.registryd.test-${label}-${process.pid}`;

  // A `launchctl` THIS SUITE CANNOT REACH PAST, and it is the guard rather
  // than the label.
  //
  // The label above is necessary and was not sufficient: `run()` defaulted its
  // env, so a call that forgot `PLOT_FLEET_LABEL` inherited the OPERATOR'S
  // environment where it is unset, `plot-fleetctl.sh:84` fell back to
  // `com.plot-pm.registryd`, and `:672` ran `launchctl bootout` on it.
  // Measured 2026-09-22: **9 of 21 call sites passed a label and none of the
  // three `--stop` sites did**; this machine's supervisor went down three
  // times in one morning, each within two minutes of a suite run.
  //
  // WHY THE PATH AND NOT THE ARGUMENT. A required label closes ONE direction —
  // a call that unloads the operator's unit. It cannot close the other: a
  // sandbox whose plist is BOOTSTRAPPED under the production label occupies it,
  // and an operator cannot tell the two apart because both present as a
  // supervisor that is not there. A stub on `PATH` cannot `bootout` a real unit
  // and cannot `bootstrap` a leaked one, so one seam closes both. It also sees
  // a wrong-but-present label, which an unset-check never can.
  //
  // AND IT MAKES THE LAUNCHD ARM RUN ON CI, which has no launchd at all — the
  // reason `stubPlatform` already gives for existing, applied to every case
  // rather than two.
  const guardBin = path.join(box, 'guard-bin');
  fs.mkdirSync(guardBin, { recursive: true });
  for (const [name, body] of [
    // THE REAL EXIT CODES, so the arms under test see what they would see.
    // `113` is what launchctl answers for an absent label and is the code that
    // once reached the board; `supervisor_loaded` normalises it.
    ['launchctl', 'exit 113'],
    ['systemctl', 'exit 3'],
  ]) {
    const f = path.join(guardBin, name);
    fs.writeFileSync(f, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(f, 0o755);
  }

  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# t\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return { root, box, fleetLabel, guardBin, ctl: path.join(dst, 'plot-fleetctl.sh') };
}

// THE GUARD IS THE FIRST ARGUMENT AFTER THE CWD, AND IT IS REFUSED WHEN ABSENT.
//
// See `sandbox()`'s `guardBin` for what this closes and why the PATH rather
// than the label. The refusal is the gate per CLAUDE.md's *Gates Over Rules*:
// this file's header claimed *"the suite never unloads anything"* for its whole
// life and nothing enforced it, which is exactly a rule. A throw cannot be
// talked past.
//
// A CALLER MAY STILL OVERRIDE `PATH` through `env` — `stubPlatform`'s two cases
// do, deliberately, to drive a LOADED launchd. That is a stub too, so the
// guarantee holds: what this refuses is reaching the machine's own binary.
function run(ctl, args, cwd, guardBin, env = {}) {
  if (typeof guardBin !== 'string' || guardBin === '') {
    throw new Error(
      'fleetctl.test: run() needs the sandbox guard bin — an unguarded run '
      + "reaches this machine's launchctl and can unload the operator's own "
      + 'supervisor',
    );
  }
  try {
    return {
      status: 0,
      out: execFileSync('bash', [ctl, ...args], {
        encoding: 'utf8',
        cwd,
        timeout: 60000,
        env: {
          ...process.env,
          PLOT_FLEET_LABEL: undefined,
          PATH: `${guardBin}:${process.env.PATH}`,
          ...env,
        },
      }),
    };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

// ── The verbs refuse to be guessed ────────────────────────────────────────────

test('fleetctl: no verb is a refusal, not a default', () => {
  const { root, ctl, guardBin } = sandbox('noverb');
  const r = run(ctl, [], root, guardBin);
  assert.equal(r.status, 1);
  assert.match(r.out, /one of --status, --once, --start, --stop/);
});

test('fleetctl: an unknown argument is named rather than ignored', () => {
  const { root, ctl, guardBin } = sandbox('unknown');
  const r = run(ctl, ['--restart'], root, guardBin);
  assert.equal(r.status, 1);
  assert.match(r.out, /unknown argument '--restart'/);
});

test('fleetctl: --wait takes a number', () => {
  const { root, ctl, guardBin } = sandbox('waitarg');
  const r = run(ctl, ['--stop', '--wait', 'soon'], root, guardBin);
  assert.equal(r.status, 1);
  assert.match(r.out, /--wait needs a number, got 'soon'/);
});

// ── Refusal 1: nothing to start ───────────────────────────────────────────────

test('refusal: no supervisor artifact names the build that makes one', () => {
  const { root, ctl, guardBin } = sandbox('noartifact', { registryd: false });
  const r = run(ctl, ['--start'], root, guardBin);
  assert.equal(r.status, 1);
  assert.match(r.out, /no supervisor artifact/);
  assert.match(r.out, /pnpm build:board/);
});

test('refusal: --once refuses the same absence, and says the same repair', () => {
  const { root, ctl, guardBin } = sandbox('noartifact-once', { registryd: false });
  const r = run(ctl, ['--once'], root, guardBin);
  assert.equal(r.status, 1);
  assert.match(r.out, /no supervisor artifact/);
  assert.match(r.out, /pnpm build:board/);
});

// ── Refusal 2: the wrong node, which is the one that fails silently later ─────

test('refusal: a node that is not the pinned major, before anything is written', () => {
  const { root, ctl, guardBin } = sandbox('wrongnode', { nvmrc: '99' });
  const r = run(ctl, ['--start'], root, guardBin);
  assert.equal(r.status, 1);
  assert.match(r.out, /this repository pins 99/);
  assert.match(r.out, /bakes/);
  assert.match(r.out, /nvm use/);
});

test('refusal: the wrong node refuses --dry-run too — a probe is not a preview', () => {
  const { root, ctl, guardBin } = sandbox('wrongnode-dry', { nvmrc: '99' });
  const r = run(ctl, ['--start', '--dry-run'], root, guardBin);
  assert.equal(r.status, 1);
  assert.match(r.out, /this repository pins 99/);
});

test('refusal: the wrong node leaves no unit behind', () => {
  const { root, ctl, guardBin } = sandbox('wrongnode-clean', { nvmrc: '99' });
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  run(ctl, ['--start'], root, guardBin, { HOME: home });
  // Nothing was filled: the probe runs before the first write.
  assert.equal(fs.existsSync(path.join(home, 'Library', 'LaunchAgents')), false);
  assert.equal(fs.existsSync(path.join(home, '.config', 'systemd')), false);
});

// ── The pin is read from .nvmrc, not from `engines` ───────────────────────────

test('the pin is .nvmrc — engines says >=24, which is a floor', () => {
  const { root, ctl, guardBin } = sandbox('pin');
  const probe = `PLOT_FLEETCTL_SOURCED=1 . '${ctl}'; printf '%s' "$(pinned_major)"`;
  const out = execFileSync('bash', ['-c', probe], { encoding: 'utf8', cwd: root });
  assert.equal(out, '24');
});

test('no .nvmrc means no pin to compare against, so the node probe does not refuse', () => {
  const { root, ctl, guardBin } = sandbox('nopin', { nvmrc: '' });
  const probe = `PLOT_FLEETCTL_SOURCED=1 . '${ctl}'; printf '[%s]' "$(pinned_major)"`;
  const out = execFileSync('bash', ['-c', probe], { encoding: 'utf8', cwd: root });
  assert.equal(out, '[]');
});

// ── --status starts nothing, and says so by its exit code ─────────────────────

test('--status starts nothing and reports the platform', () => {
  const { root, ctl, guardBin } = sandbox('status');
  const r = run(ctl, ['--status'], root, guardBin);
  assert.match(r.out, /^platform: /m);
  assert.match(r.out, /^summary: agents_running=\d+ /m);
  // No unit was filled by asking.
  assert.equal(fs.existsSync(path.join(root, '.plot', 'logs')), false);
});

test('--status names the fleet root when there are no worktrees', () => {
  const { root, ctl, guardBin } = sandbox('statusempty');
  const r = run(ctl, ['--status'], root, guardBin);
  assert.match(r.out, /no fleet worktrees under/);
});

// ── --stop orchestrates the one stop rule, and takes the supervisor last ──────

test('--stop with nothing running still reports, and does not invent an agent', () => {
  const { root, ctl, guardBin } = sandbox('stopempty');
  const r = run(ctl, ['--stop'], root, guardBin);
  assert.match(r.out, /no agents on a branch/);
  assert.match(r.out, /supervisor/);
});

test('--stop calls plot-dispatch --stop once per branch, and the supervisor last', () => {
  const { root, box, ctl, guardBin } = sandbox('stoporder');
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

  const r = run(ctl, ['--stop', '--wait', '10'], root, guardBin);
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
  assert.match(filled, /^ExecStart=\/tmp\/node \/tmp\/registryd\.mjs --start-agents$/m);
  assert.match(filled, /^Restart=always$/m);
  assert.match(filled, /^WantedBy=default\.target$/m);
  // Every non-comment, non-blank, non-section line is `Key=Value`.
  for (const line of filled.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('[')) continue;
    assert.match(t, /^[A-Za-z][A-Za-z0-9]*=/, `not a systemd directive: ${t}`);
  }
});

// THE TEMPLATE IS THE SUBJECT HERE, NOT THE PARSER. `argsFrom` has parsed
// `--start-agents` correctly since the flag existed — that is not where this
// broke. What went unread for the life of the feature is the unit file: both
// shipped templates named `__NODE__ __REGISTRYD__` and nothing else, so every
// installation that followed `/plot-fleet --start` got a supervisor that
// computed every hand-over and performed none. Measured 2026-09-07: `handed=2`
// for three consecutive ticks against two free agents whose manifests read
// `branch: ""` and had been quiet 3,067 seconds.
//
// BOTH UNITS, because a fleet that assigns on macOS and not on Linux is a
// defect reproducing on half the installations.

test('both units start the daemon with --start-agents', () => {
  const plist = fs.readFileSync(path.join(units, 'com.plot-pm.registryd.plist'), 'utf8');
  const service = fs.readFileSync(path.join(units, 'plot-registryd.service'), 'utf8');

  // The plist names it as its own `ProgramArguments` entry — a flag appended to
  // the `__REGISTRYD__` string would reach the daemon as part of a path.
  assert.match(plist, /<string>--start-agents<\/string>/,
    'the launchd unit does not pass --start-agents, so its supervisor hands nothing over');
  assert.match(service, /^ExecStart=.* --start-agents$/m,
    'the systemd unit does not pass --start-agents, so its supervisor hands nothing over');
});

test('the launchd unit does not declare ProcessType: Background', () => {
  const plist = fs.readFileSync(path.join(units, 'com.plot-pm.registryd.plist'), 'utf8');

  // `Background` is the class macOS deprioritises AND evicts first. Measured
  // 2026-09-07: six evictions in one session, every one under load, caught at
  // load 43.68 — `runs = 1`, `never exited`, `registryd.err` 0 bytes each time.
  // `node --watch board-server.mjs` survived all six on the same machine under
  // the same load, and this key is the only difference between them.
  assert.doesNotMatch(plist, /<key>ProcessType<\/key>\s*<string>Background<\/string>/,
    'ProcessType: Background makes the supervisor evictable at exactly the load a working fleet produces');

  // The politeness the removed class carried is kept, by a key that is priority
  // alone: the daemon still must never be what makes a worker slow.
  assert.match(plist, /<key>Nice<\/key>\s*<integer>-?\d+<\/integer>/,
    'the launchd unit dropped Background without keeping any scheduling politeness');
});

test('the systemd unit keeps its Nice, which is priority without eviction', () => {
  const service = fs.readFileSync(path.join(units, 'plot-registryd.service'), 'utf8');

  // NOTHING TO FIX HERE, and that is the argument rather than an exception.
  // `Nice` and `IOSchedulingClass` evict nothing, so the Linux supervisor was
  // never taken; the two platforms disagreed only in the field that matters.
  assert.match(service, /^Nice=-?\d+$/m,
    'the systemd unit lost its scheduling politeness');
  assert.match(service, /^IOSchedulingClass=idle$/m,
    'the systemd unit lost its IO politeness');
});

// ── The completion marker: did the LAST --start finish? ───────────────────────
//
// THE MEASURED FAILURE, 2026-09-09: the fleet was stopped for hours and nothing
// said so. `launchctl list` showed no `com.plot-pm.registryd` while the plist
// sat on disk, correct and 5344 bytes, and one `launchctl bootstrap` restored
// it. `--start` fills the unit, bootstraps, THEN cuts agent desks — one
// `git worktree add` each, which is the slow part — so a run interrupted there
// left a state with no name and `--status` collapsed it into *not installed*.
//
// THE TWO READINGS ARE ASSERTED TOGETHER, because neither settles it alone.
// `.plot/state/` is machine-local and gitignored, so a fresh clone has no
// marker either; only the unit file separates *never installed* from
// *interrupted*. These drive `fleet_install_state` through the sourced seam
// with `platform` and `supervisor_loaded` stubbed, which is what makes the
// launchd arm reachable on CI's `ubuntu-latest`.

/**
 * Asks `fleet_install_state` with the platform and liveness pinned.
 *
 * The real probes are stubbed AFTER sourcing so the launchd branch of
 * `unit_target` is exercised on Linux too — the arm a macOS operator uses, and
 * the one CI could otherwise never run.
 */
function installState(root, ctl, home, { loaded = false, plat = 'launchd' } = {}) {
  const probe = `PLOT_FLEETCTL_SOURCED=1 . '${ctl}'
platform() { echo ${plat}; }
supervisor_loaded() { return ${loaded ? 0 : 1}; }
printf '%s' "$(fleet_install_state)"`;
  return execFileSync('bash', ['-c', probe], {
    encoding: 'utf8', cwd: root, env: { ...process.env, HOME: home },
  });
}

/**
 * A fake HOME with the launchd unit directory, and optionally the unit in it.
 *
 * THE UNIT IS NAMED FOR THE SANDBOX'S LABEL, not the real one. `unit_target`
 * composes `$HOME/Library/LaunchAgents/$LABEL.plist`, so a plist written under
 * the default name is invisible to a run that overrides the label — the
 * reading would be `not-installed` for a test that just installed a unit.
 *
 * @param label - the sandbox's `fleetLabel`; omitted only where no unit is written
 */
function fakeHome(box, { unit = false, label = 'com.plot-pm.registryd' } = {}) {
  const home = path.join(box, 'home');
  const agents = path.join(home, 'Library', 'LaunchAgents');
  fs.mkdirSync(agents, { recursive: true });
  if (unit) fs.writeFileSync(path.join(agents, `${label}.plist`), '<plist/>\n');
  return home;
}

test('marker: no unit and no marker is NOT INSTALLED, not interrupted', () => {
  // THE FRESH-CLONE CASE. `.plot/state/` is gitignored, so a machine that never
  // ran `--start` has no marker — reading the marker alone would send every new
  // checkout to a `launchctl bootstrap` for a unit that does not exist.
  const { root, box, ctl, guardBin } = sandbox('state-fresh');
  assert.equal(installState(root, ctl, fakeHome(box)), 'not-installed');
});

test('marker: a unit with no marker is INTERRUPTED — the state that read as absent', () => {
  const { root, box, ctl, guardBin } = sandbox('state-interrupted');
  assert.equal(installState(root, ctl, fakeHome(box, { unit: true })), 'interrupted');
});

test('marker: a unit with a marker is INSTALLED', () => {
  const { root, box, ctl, guardBin } = sandbox('state-installed');
  fs.mkdirSync(path.join(root, '.plot', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.plot', 'state', 'fleet-start.done'), '2026-09-09T00:00:00Z\n');
  assert.equal(installState(root, ctl, fakeHome(box, { unit: true })), 'installed');
});

test('marker: a LOADED supervisor is running whatever the marker says', () => {
  // LOADED IS TESTED FIRST AND THE MARKER IS NOT CONSULTED. Measured on this
  // machine 2026-09-09: a supervisor loaded at pid 81406 with no marker beside
  // it, because the marker post-dates the run that started it. A reading that
  // took the marker as authoritative would call a healthy fleet interrupted.
  const { root, box, ctl, guardBin } = sandbox('state-running');
  assert.equal(installState(root, ctl, fakeHome(box, { unit: true }), { loaded: true }), 'running');
});

// ── --status names the third state, and prints its repair ─────────────────────

test('supervisor_loaded answers 1 for an absent label, never the init system code', () => {
  // THE REGRESSION LOCK FOR THE 113, and it runs on Linux too.
  //
  // `launchctl print` exits 113 for a label it does not hold. `supervisor_loaded`
  // ended with its `case`, so the function's status WAS launchctl's — and
  // `--status`, whose last two lines are `supervisor_loaded; exit $?`, handed
  // 113 to a board that reads 0 loaded and 1 not
  // (`rules/supervisor-reading.ts`). Anything else renders as a run it could
  // not interpret.
  //
  // THE STUB RETURNS 113 DIRECTLY rather than calling launchctl, so the
  // assertion is about the function's own normalisation and holds on a machine
  // with no launchd at all. The default label masked the defect — launchctl
  // answers 1 for some absences and 113 for others — so a case pinned to the
  // real label could never have found it.
  const { root, ctl, guardBin } = sandbox('loaded-rc');
  const probe = `PLOT_FLEETCTL_SOURCED=1 . '${ctl}'
platform() { echo launchd; }
launchctl() { return 113; }
supervisor_loaded; printf '%s' "$?"`;
  const out = execFileSync('bash', ['-c', probe], { encoding: 'utf8', cwd: root });
  assert.equal(out, '1', 'the init system exit code reached the caller');
});

test('--status says NOT LOADED and prints the one-line bootstrap for an installed unit', () => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('status-interrupted');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const r = run(ctl, ['--status'], root, guardBin, { HOME: home, PLOT_FLEET_LABEL: fleetLabel });

  // Only meaningful where the platform probe answers launchd; on CI it does
  // not, and the state machine itself is asserted above.
  if (!/^platform: launchd$/m.test(r.out)) return;

  assert.match(r.out, /NOT LOADED/,
    'the state that read as *not installed* for hours is not named');
  // THE REPAIR NAMES THIS RUN'S UNIT, so the label is matched rather than
  // hardcoded: a printed path that is not the one `unit_target` composed sends
  // the reader to bootstrap somebody else's plist.
  assert.match(r.out, new RegExp(`launchctl bootstrap gui/\\$\\(id -u\\) \\S*${fleetLabel}\\.plist`),
    'the repair is not printed, so a reader pays for the wrong one');
  assert.doesNotMatch(r.out, /supervisor: not installed/,
    'the two failures are still collapsed into one word');
});

test('--status says NOT INSTALLED where there is no unit at all', () => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('status-fresh');
  const r = run(ctl, ['--status'], root, guardBin, { HOME: fakeHome(box), PLOT_FLEET_LABEL: fleetLabel });
  if (!/^platform: launchd$/m.test(r.out)) return;
  assert.match(r.out, /not installed/);
  assert.match(r.out, /start it: \/plot-fleet --start/);
  assert.doesNotMatch(r.out, /launchctl bootstrap/,
    'a fresh clone was told to bootstrap a unit that does not exist');
});

test('--status says a supervisor DIED where a start finished and nothing unloaded it', () => {
  // THE STATE THAT LIED. `installed` means the unit is on disk and the last
  // `--start` recorded that it finished — and `--stop` clears that record only
  // after a clean unload, so reaching it means the supervisor went away on its
  // own. It printed *not installed — no unit on this machine*, false about the
  // machine and silent about the death.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('status-died');
  fs.mkdirSync(path.join(root, '.plot', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.plot', 'state', 'fleet-start.done'), '2026-09-18T00:00:00Z\n');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const r = run(ctl, ['--status'], root, guardBin, { HOME: home, PLOT_FLEET_LABEL: fleetLabel });
  if (!/^platform: launchd$/m.test(r.out)) return;

  // THE NEGATIVE IS THE ASSERTION THAT CATCHES IT. Asserting only the new
  // prose passes while the old line is still printed beside it — which is
  // exactly what a naive arm that echoes before falling through would do.
  assert.doesNotMatch(r.out, /not installed/,
    'the machine is still told it has no unit, which is the defect');
  assert.match(r.out, /STOPPED/, 'the death is not named');
  // THE LOG IS THE POINT, not the restart. `--start` works here; what an
  // operator skips when told *not installed* is reading why it died, and a
  // supervisor that crashed once crashes again after a start.
  assert.match(r.out, /registryd\.log/,
    'the reader is sent to restart without being sent to the log first');
});

test('--status reports its install state ON the summary line, in every state', () => {
  // ON THE LINE AND NOT BESIDE IT. The board decides `summarised` by testing
  // that line's PRESENCE, and that is what separates a finished run from one
  // killed at a bounded wait. A field on its own line is absent from exactly
  // the killed runs that most need explaining — and a naive implementation
  // that prints it separately passes every OTHER test in this file, because
  // `summarised` only needs the prefix present.
  //
  // So the assertion is anchored: the state must appear on the same line as
  // `agents_running=`, matched in one regex that cannot span a newline.
  for (const [name, marker, unit] of [
    ['fresh', false, false],
    ['interrupted', false, true],
    ['died', true, true],
  ]) {
    const { root, box, ctl, fleetLabel, guardBin } = sandbox(`summary-${name}`);
    if (marker) {
      fs.mkdirSync(path.join(root, '.plot', 'state'), { recursive: true });
      fs.writeFileSync(path.join(root, '.plot', 'state', 'fleet-start.done'), 'ts\n');
    }
    const home = fakeHome(box, { unit, label: fleetLabel });
    const r = run(ctl, ['--status'], root, guardBin, { HOME: home, PLOT_FLEET_LABEL: fleetLabel });
    assert.match(r.out, /^summary: agents_running=\d+ agents_other=\d+ supervisor=\S+ install=\S+$/m,
      `${name}: the install state is not on the summary line the board reads`);
  }
});

/**
 * A `PATH` directory that makes any machine answer as a chosen platform.
 *
 * THE SEAM IS `PATH`, NOT THE SOURCED FORM. `PLOT_FLEETCTL_SOURCED` returns
 * before the argument parsing, so a sourced script has no `--status` arm to
 * run at all — a probe that sources it can only call the functions it then
 * stubs, which asserts that a stub returns what the stub returns. Measured
 * here on 2026-09-18: with `exit $?` mutated to answer 7 for every not-loaded
 * state, the sourced probe still passed and only the launchd-guarded case
 * below caught it — on CI, where that case returns early, the mutant shipped.
 *
 * `platform` keys off `uname -s` and `command -v launchctl`, and both resolve
 * through `PATH`. Stubbing them drives the REAL arm — the state machine, the
 * summary line, and `exit $?` — on Linux and macOS alike.
 *
 * THE KERNEL IS WHAT MAKES `none` REACHABLE, not a missing binary. Prepending
 * to `PATH` can only ADD a command — the machine's real `launchctl` still sits
 * behind the stub — so `platform: none` cannot be produced by withholding one.
 * `platform`'s `case` recognises only `Darwin` and `Linux` and falls through to
 * `echo none` for anything else, and that arm runs before any `command -v`.
 *
 * @param box - the sandbox directory to place the stubs in
 * @param opts.kernel - what `uname -s` answers; anything but Darwin/Linux is `none`
 * @param opts.loaded - whether the stubbed init system holds the label
 * @returns the directory to prepend to `PATH`
 */
function stubPlatform(box, { kernel = 'Darwin', loaded = false } = {}) {
  const bin = path.join(box, 'stub-bin');
  fs.mkdirSync(bin, { recursive: true });
  const write = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  write('uname', `[ "$1" = "-s" ] && echo ${kernel} || exec /usr/bin/uname "$@"`);
  // EXIT 113 FOR AN ABSENT LABEL, which is what launchctl really answers and is
  // the code that once reached the board. The normalisation is
  // `supervisor_loaded`'s; this only reproduces the input.
  write('launchctl', loaded ? 'exit 0' : 'exit 113');
  write('systemctl', loaded ? 'exit 0' : 'exit 3');
  return bin;
}

test('--status exits exactly 1 for every not-loaded state, on any platform', () => {
  // PLATFORM-INDEPENDENT, so CI runs it. The launchd-guarded case below returns
  // early on `ubuntu-latest`, which is every CI run — so the contract that
  // matters most would otherwise be asserted nowhere CI can see.
  //
  // THE CODE MUST NOT CARRY THE STATE. A naive implementation encodes which
  // stop this is in the exit code; `supervisorState` gates on exactly 0 and 1
  // and answers `unknown` for everything else, so that would render `unknown`
  // from every machine in the new state — the alarm nobody can act on, from
  // the machines that most need one.
  //
  // ALL FOUR NOT-LOADED STATES, each built from the facts that produce it
  // rather than from a stub of the function that reports it: no unit at all,
  // a unit launchd was never told about, a unit whose start marker survives,
  // and a machine with no init system on PATH.
  for (const [state, { unit, marker, kernel }] of Object.entries({
    'not-installed': { unit: false, marker: false },
    interrupted: { unit: true, marker: false },
    installed: { unit: true, marker: true },
    none: { unit: false, marker: false, kernel: 'PlotTestKernel' },
  })) {
    const { root, box, ctl, fleetLabel, guardBin } = sandbox(`exit-${state}`);
    if (marker) {
      fs.mkdirSync(path.join(root, '.plot', 'state'), { recursive: true });
      fs.writeFileSync(path.join(root, '.plot', 'state', 'fleet-start.done'), 'ts\n');
    }
    const home = fakeHome(box, { unit, label: fleetLabel });
    const bin = stubPlatform(box, kernel ? { kernel } : {});
    const r = run(ctl, ['--status'], root, guardBin, {
      HOME: home,
      PLOT_FLEET_LABEL: fleetLabel,
      PATH: `${bin}:${process.env.PATH}`,
    });
    assert.equal(r.status, 1,
      `${state}: the state reached the exit code the board branches on`);
    assert.match(r.out, new RegExp(`^summary:.*install=${state}$`, 'm'),
      `${state}: the summary line does not name this state`);
  }
});

test('--status exits 0 and says up where the init system holds the label', () => {
  // THE OTHER HALF OF THE CONTRACT, and it runs on CI too. Without it the
  // case above is satisfied by a script that answers 1 unconditionally.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('exit-loaded');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const bin = stubPlatform(box, { loaded: true });
  const r = run(ctl, ['--status'], root, guardBin, {
    HOME: home,
    PLOT_FLEET_LABEL: fleetLabel,
    PATH: `${bin}:${process.env.PATH}`,
  });
  assert.equal(r.status, 0, 'a loaded supervisor did not answer 0');
  assert.match(r.out, /^summary:.*supervisor=up install=running$/m,
    'a loaded supervisor is not reported as running on the summary line');
});

test('--status starts nothing in any state, and keeps the board contract', () => {
  // TWO CONTRACTS AT ONCE. `rules/supervisor-reading.ts` reads the exit code
  // (0 loaded, 1 not) and the `summary:` line that proves the code was the
  // script's; widening the prose must change neither, or the board renders
  // `down` from a run it could not interpret.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('status-inert');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const r = run(ctl, ['--status'], root, guardBin, { HOME: home, PLOT_FLEET_LABEL: fleetLabel });

  assert.match(r.out, /^summary: agents_running=\d+ /m, 'the summary line the board reads is gone');
  if (/^platform: launchd$/m.test(r.out)) {
    // EXACTLY 1, NEVER MERELY NON-ZERO. `launchctl print` answers 113 for a
    // label it does not hold, and `supervisor_loaded` passed that straight
    // through `exit $?` — so this read 113 where the board reads 1, and
    // `rules/supervisor-reading.ts` renders anything else as a run it could
    // not interpret. A `notEqual(0)` here would have accepted the defect.
    assert.equal(r.status, 1, 'an unloaded supervisor must still exit 1');
  }
  // NOTHING WAS INSTALLED BY ASKING. A status that started what it was asked
  // about could never report an absence.
  assert.equal(fs.existsSync(path.join(root, '.plot', 'state', 'fleet-start.done')), false,
    '--status wrote the completion marker');
  assert.equal(fs.existsSync(path.join(root, '.plot', 'logs')), false, '--status made the log directory');
});

// ── --start records that it finished ──────────────────────────────────────────

test('--start writes no completion marker when it is interrupted cutting desks', () => {
  // THE MEASURED FAILURE, REPRODUCED. `plot-dispatch.sh --start` is where a run
  // spends its time and where both interruptions happened; a stand-in that
  // fails stands for one. The marker's ABSENCE is the assertion.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('start-interrupted');
  const home = fakeHome(box);
  fs.writeFileSync(path.join(root, 'skills', 'plot', 'scripts', 'plot-dispatch.sh'),
    '#!/usr/bin/env bash\necho "cutting desks" >&2\nexit 1\n');
  fs.chmodSync(path.join(root, 'skills', 'plot', 'scripts', 'plot-dispatch.sh'), 0o755);

  const r = run(ctl, ['--start'], root, guardBin, { HOME: home, PLOT_FLEET_LABEL: fleetLabel });
  // The launchd/systemd load is never reached under a fake HOME on CI; where it
  // refuses earlier there is nothing to assert beyond the marker's absence,
  // which holds in both cases and is the point.
  assert.equal(fs.existsSync(path.join(root, '.plot', 'state', 'fleet-start.done')), false,
    'an interrupted --start left a marker saying it finished');
  assert.notEqual(r.status, 0);
});

test('--dry-run reports the state it would act on, and writes nothing', () => {
  // THE LABEL IS THE SANDBOX'S, or refusal 4 fires on the operator's own fleet.
  // `--start` refuses a label that is already loaded, launchd keys by label,
  // and this machine holds `com.plot-pm.registryd` — so the default made every
  // `--start` case here exit 1 on a refusal about a unit the test never wrote.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('start-dry');
  const home = fakeHome(box);
  const r = run(ctl, ['--start', '--dry-run'], root, guardBin, { HOME: home, PLOT_FLEET_LABEL: fleetLabel });
  assert.equal(r.status, 0);
  assert.match(r.out, /^state: (not-installed|interrupted|installed|running)$/m);
  assert.equal(fs.existsSync(path.join(root, '.plot', 'state', 'fleet-start.done')), false,
    '--dry-run wrote the completion marker');
});
