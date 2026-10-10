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
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { record, signalOwn } from './own-process.mjs';

// Every directory this file creates, removed after its last test by the exact
// path mkdtempSync returned — never by a glob over the shared temp directory.
const made = [];
const scratch = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const scripts = path.join(repo, 'skills', 'plot', 'scripts');
const units = path.join(repo, 'skills', 'plot', 'units');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * `ps`, `lsof` and `id` stubs that answer from fixture files, for the second
 * `--status` block, and pass every other call through to the real binary.
 *
 * THEY GO INTO EVERY STUB DIRECTORY, not only the cases about the block.
 * `--status` now reads the machine's process table, and a case that ran the
 * real `ps` would read the developer's own boards and scans and print a block
 * nobody asked about. With no `PLOT_TEST_PROCS` the snapshot is empty, which is
 * the machine with no Plot process on it.
 *
 * Only the exact snapshot call is answered from the fixture: the worker-state
 * probes call `ps -o lstart= -p <pid>` and `ps -o pid=,ppid=,time= -ax`, and
 * those still reach the real `ps`. `lsof` answers `-p <pid>` from
 * `<procs>/cwd/<pid>` and otherwise prints nothing and exits 1, which is the
 * shape measured for another user's process. `id -un <uid>` answers from
 * `<procs>/users/<uid>`.
 *
 * @param bin - the stub directory to write into
 */
const writeProcStubs = (bin) => {
  const write = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  write('ps', [
    'if [ "$*" = "axww -o pid=,ppid=,uid=,args=" ]; then',
    '  [ -n "${PLOT_TEST_PROCS:-}" ] && cat "$PLOT_TEST_PROCS/ps" 2>/dev/null',
    '  exit 0',
    'fi',
    'for p in /bin/ps /usr/bin/ps; do [ -x "$p" ] && exec "$p" "$@"; done',
    'exit 127',
  ].join('\n'));
  write('lsof', [
    'f="${PLOT_TEST_PROCS:-/nonexistent}/cwd/$3"',
    '[ -f "$f" ] || exit 1',
    'printf \'p%s\\nfcwd\\nn%s\\n\' "$3" "$(cat "$f")"',
  ].join('\n'));
  write('id', [
    'if [ "${1:-}" = -un ] && [ -n "${2:-}" ] && [ -f "${PLOT_TEST_PROCS:-/nonexistent}/users/$2" ]; then',
    '  cat "$PLOT_TEST_PROCS/users/$2"; exit 0',
    'fi',
    'for p in /usr/bin/id /bin/id; do [ -x "$p" ] && exec "$p" "$@"; done',
    'exit 127',
  ].join('\n'));
};

/**
 * A repository shaped like an adopting project: a git root, a `.nvmrc`, and
 * `skills/plot/scripts/` holding copies of the scripts under test.
 *
 * REAL COPIES rather than a symlink to the repo, because `--start` composes
 * `$repo_root/skills/plot/scripts/board/plot-fleetd.mjs` and the whole point
 * of refusal 1 is that this file may be absent.
 *
 * @param opts.nvmrc - the pinned major written to `.nvmrc` ('' writes no file)
 * @param opts.registryd - whether to place a stand-in supervisor artifact.
 *   `--start`/`--once` resolve `board/plot-fleetd.mjs` unconditionally,
 *   regardless of LABEL, so this writes the stand-in there; `plot-registryd.mjs`
 *   is a separate name the process-classifier tests stub directly, never a
 *   file the real resolution looks for.
 */
function sandbox(label, { nvmrc = '24', registryd = true } = {}) {
  // NESTED ONE LEVEL, and that is not tidiness. The default `Worktree root` is
  // `repo_root/..`, so a sandbox sitting directly in $TMPDIR enumerates every
  // OTHER sandbox as its own fleet — measured here on the first run, where an
  // empty repository reported eleven desks belonging to other test cases.
  const box = fs.realpathSync(scratch(`plot-fleetctl-${label}-`));
  const root = path.join(box, 'repo');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Plot Test');
  git(root, 'config', 'commit.gpgsign', 'false');

  const dst = path.join(root, 'skills', 'plot', 'scripts');
  fs.mkdirSync(path.join(dst, 'board'), { recursive: true });
  for (const f of ['plot-fleetctl.sh', 'plot-worker-state.sh', 'plot-config.sh', 'plot-monitor-subject.sh', 'plot-desk-root.sh', 'board/plot-desk-root.mjs']) {
    const src = path.join(scripts, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dst, f));
  }
  fs.chmodSync(path.join(dst, 'plot-fleetctl.sh'), 0o755);
  fs.cpSync(units, path.join(root, 'skills', 'plot', 'units'), { recursive: true });

  if (registryd) fs.writeFileSync(path.join(dst, 'board', 'plot-fleetd.mjs'), 'process.exit(0);\n');
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
  writeProcStubs(guardBin);

  // A DEFAULT HARNESS, IN ITS OWN DIRECTORY AND NOT IN `guardBin`.
  //
  // `--start` resolves the agent harness on PATH and refuses when it cannot,
  // so every case that fills a unit needs one. Until this existed the suite
  // took it from the DEVELOPER'S OWN PATH: nine cases that never mention a
  // harness passed on a machine with `claude` installed and failed on CI with
  // `cannot resolve the agent harness 'claude'`.
  //
  // IT IS A SEPARATE DIRECTORY BECAUSE `guardBin` GOES FIRST. `startWith`
  // builds its own PATH and puts a case's stub dir after `guardBin`, so a
  // `claude` in `guardBin` would outrank the stub the case named and
  // `--start puts the resolved harness first` would assert against the wrong
  // binary. This dir is appended by `run()` instead, and `startWith`'s
  // explicit PATH leaves it out entirely — a case about the harness gets no
  // default, which is what those cases are for.
  const harnessBin = path.join(box, 'harness-default-bin');
  fs.mkdirSync(harnessBin, { recursive: true });
  const defaultHarness = path.join(harnessBin, 'claude');
  fs.writeFileSync(defaultHarness, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(defaultHarness, 0o755);

  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# t\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return { root, box, fleetLabel, guardBin, harnessBin, ctl: path.join(dst, 'plot-fleetctl.sh') };
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
// THE PATH A CASE BUILDS, plus the sandbox's default harness at the END.
//
// Thirteen cases override PATH to put a platform stub first, which discards
// the harness dir `run()` appends. Each still needs a resolvable harness for
// `--start` to fill a unit at all, and none of them is about the harness — so
// the default goes last, where a case's own stub always outranks it.
const withHarness = (box, ...dirs) => [...dirs, path.join(box, 'harness-default-bin')].join(':');

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
          // The sandbox's default harness sits AFTER `guardBin` and after the
          // machine's PATH, so it answers only when nothing else does. A case
          // that names its own harness dir overrides PATH entirely.
          PATH: `${guardBin}:${process.env.PATH}:${path.join(path.dirname(guardBin), 'harness-default-bin')}`,
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
  assert.match(r.out, /Plot pins 99/);
  assert.match(r.out, /bakes/);
  assert.match(r.out, /nvm use/);
});

test('refusal: the wrong node refuses --dry-run too — a probe is not a preview', () => {
  const { root, ctl, guardBin } = sandbox('wrongnode-dry', { nvmrc: '99' });
  const r = run(ctl, ['--start', '--dry-run'], root, guardBin);
  assert.equal(r.status, 1);
  assert.match(r.out, /Plot pins 99/);
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

test('no Plot .nvmrc reads as an empty pin, and --start refuses on it rather than skipping', () => {
  // THE EMPTY PIN WAS THE BUG. `[ -n "$want" ]` skipped refusal 2 on it, so
  // every consumer without a `.nvmrc` installed whatever node was on PATH.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('nopin', { nvmrc: '' });
  const probe = `PLOT_FLEETCTL_SOURCED=1 . '${ctl}'; printf '[%s]' "$(pinned_major)"`;
  const out = execFileSync('bash', ['-c', probe], { encoding: 'utf8', cwd: root });
  assert.equal(out, '[]');

  const home = fakeHome(box);
  const r = run(ctl, ['--start', '--dry-run'], root, guardBin, { HOME: home, PLOT_FLEET_LABEL: fleetLabel });
  assert.equal(r.status, 1);
  assert.match(r.out, /cannot read Plot's node pin/);
  assert.match(r.out, /broken or partial installation/);
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
  const desk = path.join(root, '.worktrees', 'feature-a');
  git(root, 'worktree', 'add', '-q', '-b', 'feature/a', desk);

  // A live process the state reader will find, and the pid file it reads.
  const sleeper = record(execFileSync('bash', ['-c', 'sleep 30 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).trim());
  fs.writeFileSync(path.join(desk, '.plot-worker.pid'), `${sleeper}\n`);

  const log = path.join(root, 'calls.log');
  fs.writeFileSync(path.join(root, 'skills', 'plot', 'scripts', 'plot-dispatch.sh'),
    `#!/usr/bin/env bash\necho "dispatch $*" >> "${log}"\nps -o command= -p ${sleeper} | grep -qx 'sleep 30' && kill ${sleeper} 2>/dev/null\nexit 0\n`);
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
    signalOwn(sleeper, 'SIGTERM', { command: 'sleep 30' });
    fs.rmSync(desk, { recursive: true, force: true });
  }
});

// ── The unload is VERIFIED to a bound, and a reported failure exits non-zero ──
//
// EXIT CODES ARE ASSERTED EXACTLY, never merely zero/non-zero, for the reason
// the `--status` cases above give: a caller gates on the number.

/** Arm a sandbox with a start marker, and answer where it is. */
function armedMarker(root) {
  const marker = path.join(root, '.plot', 'state', 'fleet-start.done');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, 'ts\n');
  return marker;
}

test('--stop polls the unload past a still-loaded first answer, clears the marker, exits 0', () => {
  // THE MEASURED FAILURE, REPRODUCED. `sticky: 2` makes the first two questions
  // after `bootout` answer *still loaded* — which is what the machine answered
  // on 2026-09-24 — so the confirmed arm is reachable only by asking again.
  // A single-sample implementation prints `did NOT unload` here and fails.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('stopunloadok');
  const marker = armedMarker(root);
  const bin = stubUnload(box, { sticky: 2 });
  const r = run(ctl, ['--stop', '--wait', '10'], root, guardBin, {
    HOME: fakeHome(box, { unit: true, label: fleetLabel }),
    PLOT_FLEET_LABEL: fleetLabel,
    PATH: withHarness(box, bin, process.env.PATH),
  });
  assert.equal(r.status, 0, 'a confirmed unload is a clean stop');
  assert.match(r.out, /supervisor unloaded/);
  assert.doesNotMatch(r.out, /did NOT unload/,
    'the first still-loaded answer was reported as a failure');
  // THE MARKER IS ASSERTED, NOT ONLY THE TEXT. It is what the next `--status`
  // reads, and leaving it is how a deliberate stop came to render as a crash.
  assert.equal(fs.existsSync(marker), false, 'a confirmed unload clears the start marker');
});

test('--stop keeps the marker and exits 1 when the unload is never confirmed', () => {
  // `sticky: 'forever'` is the supervisor that does not go away — a stuck
  // teardown, or launchd restarting it under `KeepAlive`. `--wait 1` keeps the
  // case fast; the bound is the contract, not its value.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('stopunloadfail');
  const marker = armedMarker(root);
  const bin = stubUnload(box, { sticky: 'forever' });
  const r = run(ctl, ['--stop', '--wait', '1'], root, guardBin, {
    HOME: fakeHome(box, { unit: true, label: fleetLabel }),
    PLOT_FLEET_LABEL: fleetLabel,
    PATH: withHarness(box, bin, process.env.PATH),
  });
  assert.equal(r.status, 1, 'a stop that printed a failure may not exit 0');
  assert.match(r.out, /did NOT unload within 1s/);
  assert.match(r.out, /pid 4242/,
    'the pid at the bound is the reading that distinguishes a restart from a stuck teardown');
  assert.equal(fs.existsSync(marker), true,
    'an unconfirmed unload keeps the marker: the run it records is still the live one');
});

test('--stop reports BOTH a stuck agent and an unconfirmed unload, then exits 1', () => {
  // THE EARLY-EXIT TRAP. The agent summary prints after the supervisor block,
  // so an `exit 1` inside that block swallows it — and this is exactly the run
  // where an operator needs both halves. The flag-and-one-exit shape is what
  // this asserts.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('stopboth');
  const desk = path.join(root, '.worktrees', 'feature-b');
  git(root, 'worktree', 'add', '-q', '-b', 'feature/b', desk);
  const sleeper = record(execFileSync('bash', ['-c', 'sleep 30 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).trim());
  fs.writeFileSync(path.join(desk, '.plot-worker.pid'), `${sleeper}\n`);
  // A dispatch stop that is accepted and kills nothing: the agent stays running
  // past the bound, which is the `n_still` arm.
  const dispatch = path.join(root, 'skills', 'plot', 'scripts', 'plot-dispatch.sh');
  fs.writeFileSync(dispatch, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(dispatch, 0o755);

  const bin = stubUnload(box, { sticky: 'forever' });
  try {
    const r = run(ctl, ['--stop', '--wait', '1'], root, guardBin, {
      HOME: fakeHome(box, { unit: true, label: fleetLabel }),
      PLOT_FLEET_LABEL: fleetLabel,
      PATH: withHarness(box, bin, process.env.PATH),
    });
    assert.equal(r.status, 1, 'both failures reach one non-zero exit');
    assert.match(r.out, /did NOT unload within 1s/, 'the supervisor failure is reported');
    assert.match(r.out, /1 agent\(s\) did not exit within 1s/,
      'the agent summary survives the supervisor failure — it prints after that block');
  } finally {
    signalOwn(sleeper, 'SIGTERM', { command: 'sleep 30' });
    fs.rmSync(desk, { recursive: true, force: true });
  }
});

test('--stop of an unloaded supervisor still exits 0 and says so', () => {
  // THE REGRESSION THE POLL MUST NOT CAUSE. Nothing was loaded, so nothing is
  // waited for and nothing failed. `stubPlatform` with no `loaded` answers 113
  // from the first call, which is a machine that never held the label.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('stopnotloaded');
  const bin = stubPlatform(box, {});
  const r = run(ctl, ['--stop'], root, guardBin, {
    HOME: fakeHome(box, { unit: true, label: fleetLabel }),
    PLOT_FLEET_LABEL: fleetLabel,
    PATH: withHarness(box, bin, process.env.PATH),
  });
  assert.equal(r.status, 0, 'nothing was loaded, so nothing failed');
  assert.match(r.out, /supervisor was not loaded/);
});

// ── The unit finds the harness the operator's shell finds ─────────────────────

// THE SUBJECT IS WHAT THE WORKER RESOLVES, NOT WHAT THE UNIT FILE SAYS.
// `plot-dispatch.sh:1447` exports `PLOT_HARNESS` on every launch, empty unless a
// charter names a harness, so a value baked into that variable would be
// overwritten and a grep for it would pass while proving nothing. These cases
// read the filled unit's `PATH` and ask a clean shell what `command -v` answers.
//
// A REAL `--start`, stopped by the guard. The guard's `launchctl` answers 113
// and its `systemctl` answers 3, so the unit is filled and then the load fails:
// the file is left behind for the test to read, and nothing reaches launchd.

const onLaunchd = os.platform() === 'darwin';

const unitTemplate = () =>
  path.join(units, onLaunchd ? 'com.plot-pm.fleetd.plist' : 'plot-fleetd.service');

// THE UNIT NAME FOLLOWS THE LABEL ON BOTH PLATFORMS since #1053. This
// hardcoded `plot-registryd.service` while a labelled `--start` writes
// `plot-registryd-<name>.service`, so on Linux it looked for a file that is
// never written and reported `no unit was filled` about a unit that was.
const unitFile = (home, fleetLabel, ctl) =>
  onLaunchd
    ? path.join(home, 'Library', 'LaunchAgents', `${fleetLabel}.plist`)
    : path.join(home, '.config', 'systemd', 'user', `${unitNameFor(ctl, fleetLabel)}.service`);

const unitPath = (body) => {
  const m = onLaunchd
    ? body.match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/)
    : body.match(/^Environment=PATH=(.*)$/m);
  assert.ok(m, 'the unit carries no PATH');
  return m[1];
};

// The unit's own PATH with the node and harness entries removed: the template's
// fixed list.
const defaultUnitPath = () =>
  unitPath(fs.readFileSync(unitTemplate(), 'utf8')).replace('__NODE_DIR__:__HARNESS_DIR__:', '');

const resolvedBy = (searchPath, name) =>
  execFileSync('/usr/bin/env', ['-i', `PATH=${searchPath}`, '/bin/sh', '-c', `command -v ${name}`],
    { encoding: 'utf8' }).trim();

const stubHarness = (box, name) => {
  const dir = path.join(box, 'harness-bin');
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(bin, 0o755);
  return { dir, bin };
};

// ONLY THE DIRECTORIES THE CASE NAMES, plus node's own, so a `claude` this
// machine has installed cannot answer in the stub's place.
const startWith = (label, { searchDirs = [], harness } = {}) => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox(label);
  const home = path.join(box, 'home');
  fs.mkdirSync(home);
  // ON LINUX ONLY, A SYSTEMD THAT ACCEPTS `daemon-reload`. `guardBin`'s stub
  // exits 3 for every call, which is right for the launchd arm these cases
  // were written for and fatal on Linux: `--start` fills the unit and then
  // refuses, so the case reads `no unit was filled` about a file on disk.
  //
  // IT IS NOT ADDED ON macOS, and that is the whole reason for the guard:
  // `stubSystemd` also fakes `uname -s` as Linux, so adding it here would
  // drive the systemd arm on a Darwin host while `onLaunchd` still says
  // launchd, and the two would disagree about where the unit lands.
  const sd = onLaunchd ? null : stubSystemd(box);
  const r = run(ctl, ['--start'], root, guardBin, {
    HOME: home,
    PLOT_FLEET_LABEL: fleetLabel,
    PLOT_HARNESS: harness,
    PATH: [...(sd ? [sd.bin] : []), guardBin, ...searchDirs,
      path.dirname(process.execPath), defaultUnitPath()].join(':'),
  });
  return { r, box, home, file: unitFile(home, fleetLabel, ctl) };
};

test('--start puts the resolved harness first, and a clean shell on the unit PATH finds it', () => {
  const stubBox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-harness-stub-')));
  try {
    const { dir, bin } = stubHarness(stubBox, 'claude');
    const { r, file } = startWith('harness-default', { searchDirs: [dir] });
    assert.ok(fs.existsSync(file), `no unit was filled:\n${r.out}`);
    const searched = unitPath(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(searched.split(':').slice(0, 2), [path.dirname(process.execPath), dir]);
    assert.equal(resolvedBy(searched, 'claude'), bin,
      'a worker on the unit PATH does not run the harness --start resolved');
  } finally {
    fs.rmSync(stubBox, { recursive: true, force: true });
  }
});

test('--start honours PLOT_HARNESS when it resolves the harness', () => {
  const stubBox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-harness-named-')));
  try {
    const { dir, bin } = stubHarness(stubBox, 'my-harness');
    const { r, file } = startWith('harness-named', { searchDirs: [dir], harness: 'my-harness' });
    assert.ok(fs.existsSync(file), `no unit was filled:\n${r.out}`);
    const searched = unitPath(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(searched.split(':').slice(0, 2), [path.dirname(process.execPath), dir]);
    assert.equal(resolvedBy(searched, 'my-harness'), bin);
  } finally {
    fs.rmSync(stubBox, { recursive: true, force: true });
  }
});

test('refusal: a PLOT_HARNESS that names nothing on PATH refuses and writes no unit', () => {
  const { r, home, file } = startWith('harness-missing', { harness: 'my-harness' });
  assert.equal(r.status, 1);
  assert.match(r.out, /cannot resolve the agent harness 'my-harness'/);
  assert.match(r.out, /PLOT_HARNESS is set to 'my-harness'/);
  assert.match(r.out, /bakes/);
  assert.equal(fs.existsSync(file), false, 'a refused start left a unit behind');
  assert.equal(fs.existsSync(path.join(home, 'Library', 'LaunchAgents')), false);
  assert.equal(fs.existsSync(path.join(home, '.config', 'systemd')), false);
});

test('refusal: an unresolvable harness refuses --dry-run too', () => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('harness-missing-dry');
  const r = run(ctl, ['--start', '--dry-run'], root, guardBin, {
    HOME: fakeHome(box),
    PLOT_FLEET_LABEL: fleetLabel,
    PLOT_HARNESS: 'my-harness',
    PATH: [guardBin, path.dirname(process.execPath), defaultUnitPath()].join(':'),
  });
  assert.equal(r.status, 1);
  assert.match(r.out, /my-harness/);
});

test('a harness already on the default unit PATH resolves to the same binary', () => {
  // THE UNCHANGED CASE. `sh` stands in for a harness installed where the unit
  // already looked: prepending its directory repeats an entry and must not
  // change which file answers.
  const before = resolvedBy(defaultUnitPath(), 'sh');
  const { r, file } = startWith('harness-already', { harness: 'sh' });
  assert.ok(fs.existsSync(file), `no unit was filled:\n${r.out}`);
  const searched = unitPath(fs.readFileSync(file, 'utf8'));
  assert.equal(resolvedBy(searched, 'sh'), before);
});

// ── The unit's children run the pinned node ──────────────────────────────────

// THE SUBJECT IS WHICH `node` A CHILD OF THE DAEMON RESOLVES. The daemon runs the
// absolute `__NODE__`, but the worker loop, `pnpm` and `node --test` look `node`
// up on the unit's PATH. A harness directory that also holds another node major
// (a shim directory, /opt/homebrew/bin) answers that lookup unless the pinned
// node's directory comes first.

// A `node` that IS the running node, so `--start`'s major check passes on it.
const pinnedNodeDir = (box) => {
  const dir = path.join(box, 'pinned-node-bin');
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'node');
  fs.writeFileSync(bin, `#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
  fs.chmodSync(bin, 0o755);
  return { dir, bin };
};

test('--start puts the pinned node first, ahead of a harness directory holding another major', () => {
  const stubBox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-node-first-')));
  try {
    const pinned = pinnedNodeDir(stubBox);
    const { dir } = stubHarness(stubBox, 'claude');
    const other = path.join(dir, 'node');
    fs.writeFileSync(other, '#!/bin/sh\necho v26.7.0\n');
    fs.chmodSync(other, 0o755);
    const { r, file } = startWith('node-first', { searchDirs: [pinned.dir, dir] });
    assert.ok(fs.existsSync(file), `no unit was filled:\n${r.out}`);
    const searched = unitPath(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(searched.split(':').slice(0, 2), [pinned.dir, dir]);
    assert.equal(resolvedBy(searched, 'node'), pinned.bin,
      'a child on the unit PATH runs a node other than the one --start pinned');
  } finally {
    fs.rmSync(stubBox, { recursive: true, force: true });
  }
});

test('--start names the pinned node directory once when the harness lives in it', () => {
  const stubBox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-node-once-')));
  try {
    const pinned = pinnedNodeDir(stubBox);
    const harness = path.join(pinned.dir, 'claude');
    fs.writeFileSync(harness, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(harness, 0o755);
    const { r, file } = startWith('node-once', { searchDirs: [pinned.dir] });
    assert.ok(fs.existsSync(file), `no unit was filled:\n${r.out}`);
    const searched = unitPath(fs.readFileSync(file, 'utf8')).split(':');
    assert.equal(searched[0], pinned.dir);
    assert.equal(searched.filter((d) => d === pinned.dir).length, 1);
    assert.equal(searched.slice(1).join(':'), defaultUnitPath());
  } finally {
    fs.rmSync(stubBox, { recursive: true, force: true });
  }
});

// ── The units fill and parse — the check CI can actually run on Linux ─────────

// EACH TEMPLATE HAS ITS OWN SET. The plist carries `__LABEL__` because launchd
// keys a job by the `Label` inside it (#1051); a systemd unit has no label
// field, so the service keeps three and its identity problem is #1053's.
const PLACEHOLDERS = {
  'com.plot-pm.fleetd.plist': ['__FLEETD__', '__HARNESS_DIR__', '__LABEL__', '__NODE_DIR__', '__NODE__', '__REPO_ROOT__'],
  'plot-fleetd.service': ['__FLEETD__', '__HARNESS_DIR__', '__NODE_DIR__', '__NODE__', '__REPO_ROOT__'],
};

test('each unit template carries exactly its documented placeholders', () => {
  for (const [f, expected] of Object.entries(PLACEHOLDERS)) {
    const body = fs.readFileSync(path.join(units, f), 'utf8');
    const found = new Set(body.match(/__[A-Z_]+__/g) ?? []);
    assert.deepEqual([...found].sort(), expected,
      `${f} names a placeholder the fill does not replace`);
  }
});

test('the fill leaves no placeholder in either unit', () => {
  for (const f of Object.keys(PLACEHOLDERS)) {
    const body = fs.readFileSync(path.join(units, f), 'utf8')
      .replaceAll('__LABEL__', 'com.example.fill')
      .replaceAll('__REPO_ROOT__', '/tmp/repo')
      .replaceAll('__NODE__', '/tmp/node')
      .replaceAll('__NODE_DIR__', '/tmp')
    .replaceAll('__HARNESS_DIR__', '/tmp/harness')
      .replaceAll('__FLEETD__', '/tmp/fleetd.mjs');
    assert.equal(body.match(/__[A-Z_]+__/g), null, `${f} still holds a placeholder after the fill`);
  }
});

test('the filled plist is valid XML', () => {
  const filled = fs.readFileSync(path.join(units, 'com.plot-pm.fleetd.plist'), 'utf8')
    .replaceAll('__LABEL__', 'com.example.supplied')
    .replaceAll('__REPO_ROOT__', '/tmp/repo')
    .replaceAll('__NODE__', '/tmp/node')
    .replaceAll('__NODE_DIR__', '/tmp')
    .replaceAll('__HARNESS_DIR__', '/tmp/harness')
    .replaceAll('__FLEETD__', '/tmp/fleetd.mjs');
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
    assert.match(filled, /<key>Label<\/key>\s*<string>com\.example\.supplied<\/string>/,
      'the filled Label is not the one the fill supplied');
    assert.match(filled, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.match(filled, /<key>StandardOutPath<\/key>\s*<string>\/tmp\/repo\/\.plot\/logs\/fleetd\.log<\/string>/,
      'the launchd unit does not send stdout to fleetd.log');
    assert.match(filled, /<key>StandardErrorPath<\/key>\s*<string>\/tmp\/repo\/\.plot\/logs\/fleetd\.err<\/string>/,
      'the launchd unit does not send stderr to fleetd.err');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('the filled systemd unit is well-formed', () => {
  const filled = fs.readFileSync(path.join(units, 'plot-fleetd.service'), 'utf8')
    .replaceAll('__REPO_ROOT__', '/tmp/repo')
    .replaceAll('__NODE__', '/tmp/node')
    .replaceAll('__NODE_DIR__', '/tmp')
    .replaceAll('__HARNESS_DIR__', '/tmp/harness')
    .replaceAll('__FLEETD__', '/tmp/fleetd.mjs');
  for (const section of ['[Unit]', '[Service]', '[Install]']) {
    assert.ok(filled.includes(section), `the unit has no ${section} section`);
  }
  assert.match(filled, /^ExecStart=\/tmp\/node \/tmp\/fleetd\.mjs --start-agents --sweep-temp$/m);
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
// shipped templates named `__NODE__ __FLEETD__` and nothing else, so every
// installation that followed `/plot-fleet --start` got a supervisor that
// computed every hand-over and performed none. Measured 2026-09-07: `handed=2`
// for three consecutive ticks against two free agents whose manifests read
// `branch: ""` and had been quiet 3,067 seconds.
//
// BOTH UNITS, because a fleet that assigns on macOS and not on Linux is a
// defect reproducing on half the installations.

test('both units start the daemon with --start-agents', () => {
  const plist = fs.readFileSync(path.join(units, 'com.plot-pm.fleetd.plist'), 'utf8');
  const service = fs.readFileSync(path.join(units, 'plot-fleetd.service'), 'utf8');

  // The plist names it as its own `ProgramArguments` entry — a flag appended to
  // the `__FLEETD__` string would reach the daemon as part of a path.
  assert.match(plist, /<string>--start-agents<\/string>/,
    'the launchd unit does not pass --start-agents, so its supervisor hands nothing over');
  assert.match(service, /^ExecStart=.* --start-agents(\s|$)/m,
    'the systemd unit does not pass --start-agents, so its supervisor hands nothing over');
});

test('the launchd unit does not declare ProcessType: Background', () => {
  const plist = fs.readFileSync(path.join(units, 'com.plot-pm.fleetd.plist'), 'utf8');

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
  const service = fs.readFileSync(path.join(units, 'plot-fleetd.service'), 'utf8');

  // NOTHING TO FIX HERE, and that is the argument rather than an exception.
  // `Nice` and `IOSchedulingClass` evict nothing, so the Linux supervisor was
  // never taken; the two platforms disagreed only in the field that matters.
  assert.match(service, /^Nice=-?\d+$/m,
    'the systemd unit lost its scheduling politeness');
  assert.match(service, /^IOSchedulingClass=idle$/m,
    'the systemd unit lost its IO politeness');
});

test('the systemd unit stops only its daemon', () => {
  const service = fs.readFileSync(path.join(units, 'plot-fleetd.service'), 'utf8');

  // THE DEFAULT IS THE DEFECT, so the assertion is on the directive's presence
  // and not on its absence. systemd's `KillMode=control-group` signals every
  // process in the cgroup, and `--start-agents` puts each agent there: a stop,
  // a restart or a crash ended work no operator asked to end. There is no
  // systemd on a macOS runner, so this holds the one line that fixes it where
  // `systemd-analyze verify` cannot run.
  assert.match(service, /^KillMode=process$/m,
    'the systemd unit stops its agents along with its daemon');
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
 * Asks `fleet_install_state` with the platform and BOTH readings pinned.
 *
 * The real probes are stubbed AFTER sourcing so the launchd branch of
 * `unit_target` is exercised on Linux too — the arm a macOS operator uses, and
 * the one CI could otherwise never run.
 *
 * `supervisor_pid` IS PINNED TOO, AND IT IS THE SECOND READING. The label and
 * the process are different facts since 2026-09-22, so a seam that pinned only
 * the label left the other probe reaching the real machine: `loaded: true`
 * then answered `running` on a developer's macOS and `loaded-not-running` on
 * CI, where `systemctl` reports nothing for a label nothing holds. Measured on
 * the branch that introduced the split — the suite passed locally and failed
 * on `ubuntu-latest`, which is the direction this seam exists to prevent.
 *
 * @param opts.loaded - whether the init system holds the label
 * @param opts.pid - the process behind it; defaults to one when loaded, none otherwise
 */
function installState(root, ctl, home, { loaded = false, plat = 'launchd', pid } = {}) {
  const pinnedPid = pid ?? (loaded ? '4242' : '');
  const probe = `PLOT_FLEETCTL_SOURCED=1 . '${ctl}'
platform() { echo ${plat}; }
supervisor_loaded() { return ${loaded ? 0 : 1}; }
supervisor_pid() { printf '%s' '${pinnedPid}'; }
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
 * THE DEFAULT IS THE NEW BARE DEFAULT, `com.plot-pm.fleetd` — the label a run
 * with no `PLOT_FLEET_LABEL` override resolves to (`plot-fleetctl.sh:90`).
 * `installState()`'s callers pass no override, so a unit written under the
 * OLD default was invisible to them: `unit_target` composed a path this
 * default never matched, and two marker tests read `not-installed` for a
 * unit this call had just written.
 *
 * @param label - the sandbox's `fleetLabel`; omitted only where no unit is written
 */
function fakeHome(box, { unit = false, label = 'com.plot-pm.fleetd' } = {}) {
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

test('marker: a loaded label with no process behind it is not running', () => {
  // THE LABEL IS NOT THE PROCESS, and the marker is not consulted for either.
  // A held label with nothing behind it is the state measured twice in ninety
  // minutes on 2026-09-22, and `fleet_install_state` must name it rather than
  // answering `running` for any held label.
  const { root, box, ctl, guardBin } = sandbox('state-loaded-no-pid');
  fs.mkdirSync(path.join(root, '.plot', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.plot', 'state', 'fleet-start.done'), '2026-09-22T00:00:00Z\n');
  assert.equal(
    installState(root, ctl, fakeHome(box, { unit: true }), { loaded: true, pid: '' }),
    'loaded-not-running');
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
  assert.match(r.out, /fleetd\.log/,
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
 * THE PID IS A SEPARATE READING FROM THE LABEL, and a stub that emits none
 * IS the loaded-but-dead machine rather than a simplification of a healthy
 * one. `supervisor_pid` parses `pid = N` out of `launchctl print`, so a bare
 * `exit 0` answers *the label is held and nothing is behind it* — which is
 * precisely the state measured on this estate on 2026-09-22 and precisely
 * what `--status` used to call `running`.
 *
 * So `loaded: true` emits a pid and means a healthy supervisor, and
 * `loaded: 'no-pid'` holds the label while naming no process. Passing the pid
 * through the stub rather than through `supervisor_pid` keeps the real
 * function under test: the parse is the part that reads launchd's output.
 *
 * @param box - the sandbox directory to place the stubs in
 * @param opts.kernel - what `uname -s` answers; anything but Darwin/Linux is `none`
 * @param opts.loaded - `false` not loaded, `true` loaded with a live pid, `'no-pid'` loaded with none
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
  //
  // THE PID GOES TO `print` ONLY. `supervisor_loaded` and `supervisor_pid`
  // both shell to `launchctl print`; the first discards its output and the
  // second parses `pid = N` out of it, so one stub serves both and the
  // pid-bearing case has to name the subcommand to stay honest about which
  // call sees what.
  // `list` ANSWERS FROM THE FIXTURE, for the second block's label reading,
  // which finds a supervisor's row by its pid. Every other subcommand is
  // unchanged.
  write('launchctl', `[ "$1" = list ] && { cat "\${PLOT_TEST_PROCS:-/nonexistent}/launchctl-list" 2>/dev/null; exit 0; }\n${loaded
    ? `[ "$1" = print ] && [ "${loaded === 'no-pid' ? 'no' : 'yes'}" = yes ] && echo "	pid = 4242"\nexit 0`
    : 'exit 113'}`);
  // `systemctl show -p MainPID --value` answers 0 for a unit with no process,
  // and `supervisor_pid` greps that zero out. So the dead-but-loaded case is
  // the init system's own way of saying the same thing launchd's `-` does.
  write('systemctl', loaded
    ? `[ "$1" = show ] && echo ${loaded === 'no-pid' ? 0 : 4242}\nexit 0`
    : 'exit 3');
  writeProcStubs(bin);
  return bin;
}

/**
 * A `launchctl`/`systemctl` stub that CHANGES ITS ANSWER, which the static one
 * above cannot express.
 *
 * `stubPlatform` answers one fixed state, so it can say *loaded* or *not
 * loaded* but never *loaded, then unloaded after `bootout`* — and that
 * sequence is the whole subject of the bounded unload poll. A test built on the
 * static stub passes against the single-sample code, which is the code the
 * poll replaces.
 *
 * THE COUNTER IS A FILE, because each `launchctl` call is a fresh process and
 * a shell variable cannot outlive one. `bootout` (or `disable`) arms it; every
 * `print` after that spends one tick, answering *loaded* while `sticky` ticks
 * remain and `113` afterwards.
 *
 * WITH `sticky >= 1` THE CONFIRMED ARM IS ONLY REACHABLE BY POLLING. The first
 * question after `bootout` answers *still loaded*, exactly as the machine
 * answered on 2026-09-24 — so a single-sample implementation reports a failure
 * here and the test fails against it.
 *
 * @param box - the sandbox directory to place the stubs in
 * @param opts.sticky - how many `print` calls after `bootout` still answer loaded; `'forever'` never unloads
 * @returns the directory to prepend to `PATH`
 */
function stubUnload(box, { sticky = 1 } = {}) {
  const bin = path.join(box, 'stub-bin');
  fs.mkdirSync(bin, { recursive: true });
  const ticks = path.join(box, 'unload-ticks');
  const write = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  write('uname', '[ "$1" = "-s" ] && echo Darwin || exec /usr/bin/uname "$@"');
  // THE PID IS EMITTED ON EVERY LOADED ANSWER, so the unconfirmed report can
  // name it. `supervisor_pid` parses `pid = N` out of this same output.
  const body = (bootoutVerb) => `
TICKS="${ticks}"
if [ "$1" = ${bootoutVerb} ]; then echo ${sticky === 'forever' ? -1 : sticky} > "$TICKS"; exit 0; fi
if [ "$1" = print ] || [ "$1" = is-active ] || [ "$1" = show ]; then
  if [ ! -f "$TICKS" ]; then EMIT=yes; else
    n=$(cat "$TICKS")
    if [ "$n" -lt 0 ]; then EMIT=yes
    elif [ "$n" -gt 0 ]; then echo $((n - 1)) > "$TICKS"; EMIT=yes
    else EMIT=no; fi
  fi
  if [ "$EMIT" = yes ]; then
    [ "$1" = print ] && echo "	pid = 4242"
    [ "$1" = show ] && echo 4242
    exit 0
  fi
  exit ${bootoutVerb === 'bootout' ? 113 : 3}
fi
exit 0`;
  write('launchctl', body('bootout'));
  // `systemctl --user disable --now` arms the same counter; `is-active` and
  // `show -p MainPID` are the two reads the systemd arm makes.
  write('systemctl', body('disable'));
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
      PATH: withHarness(box, bin, process.env.PATH),
    });
    assert.equal(r.status, 1,
      `${state}: the state reached the exit code the board branches on`);
    assert.match(r.out, new RegExp(`^summary:.*install=${state}$`, 'm'),
      `${state}: the summary line does not name this state`);
  }
});

test('--status exits 0 and says up where the init system holds the label', () => {
  // THE OTHER HALF OF THE CONTRACT, and it runs on CI too. Without it the
  // case above is satisfied by a script that answers 1 unconditionally — and
  // since 2026-09-22 it is also what keeps the new middle row from swallowing
  // the healthy one: a script that answered `loaded, not running` for every
  // held label would satisfy that row and fail here.
  //
  // THE STUB EMITS A PID, and that is the contract moving rather than a
  // regression. `loaded: true` used to be a bare `exit 0` with no stdout, so
  // `supervisor_pid` parsed empty and this sandbox WAS the loaded-but-dead
  // machine — the state now under test one case below.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('exit-loaded');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const bin = stubPlatform(box, { loaded: true });
  const r = run(ctl, ['--status'], root, guardBin, {
    HOME: home,
    PLOT_FLEET_LABEL: fleetLabel,
    PATH: withHarness(box, bin, process.env.PATH),
  });
  assert.equal(r.status, 0, 'a loaded supervisor did not answer 0');
  assert.match(r.out, /^supervisor: running \(pid 4242\)/m,
    'a loaded supervisor with a live process is not reported as running with its pid');
  assert.match(r.out, /^summary:.*supervisor=up install=running$/m,
    'a loaded supervisor is not reported as running on the summary line');
});

test('--status carries the tick age on the running summary line, and only with a log', () => {
  // 2026-09-23: `--status` said running while the supervisor's log was 25 hours
  // old. The field is evidence for the board's rule; the shell judges nothing.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('tick-age-stale');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const bin = stubPlatform(box, { loaded: true });
  const env = { HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, bin, process.env.PATH) };

  // No log: the field is absent, never 0.
  const bare = run(ctl, ['--status'], root, guardBin, env);
  assert.equal(bare.status, 0);
  assert.match(bare.out, /^summary:.*supervisor=up install=running$/m,
    'with no log the summary line gained a field');
  assert.doesNotMatch(bare.out, /tick_age=/, 'a missing log produced a tick age');
  assert.doesNotMatch(bare.out, /last tick:/, 'a missing log printed a last tick line');

  const log = path.join(root, '.plot', 'logs', 'fleetd.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, 'tick\n');
  const past = new Date(Date.now() - 90_061_000);
  fs.utimesSync(log, past, past);
  const r = run(ctl, ['--status'], root, guardBin, env);
  assert.equal(r.status, 0, 'a stale tick changed the exit code');
  assert.match(r.out, /^summary:.*supervisor=up install=running tick_age=\d+$/m,
    'the running summary line does not carry tick_age=');
  const age = Number(/^summary:.* tick_age=(\d+)$/m.exec(r.out)[1]);
  assert.ok(age >= 90_000, `tick_age=${age} does not reflect the backdated log`);
  // The person reads the same number the machine does, on its own line.
  const line = /^\s+last tick: (\d+)s ago/m.exec(r.out);
  assert.ok(line, 'the running arm printed no last tick line for a person');
  assert.ok(Number(line[1]) >= 90_000, `last tick: ${line[1]}s does not reflect the backdated log`);
});

test('--status reads the tick age from registryd.log while fleetd.log is absent', () => {
  // A unit filled before the rename keeps writing registryd.log until
  // `--stop` then `--start` fills it again.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('tick-age-old-log');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const bin = stubPlatform(box, { loaded: true });
  const env = { HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, bin, process.env.PATH) };
  const logs = path.join(root, '.plot', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const old = path.join(logs, 'registryd.log');
  fs.writeFileSync(old, 'tick\n');
  const past = new Date(Date.now() - 90_061_000);
  fs.utimesSync(old, past, past);

  const r = run(ctl, ['--status'], root, guardBin, env);
  assert.equal(r.status, 0);
  const age = Number((/^summary:.* tick_age=(\d+)$/m.exec(r.out) ?? [])[1]);
  assert.ok(age >= 90_000, `registryd.log alone gave no tick age: ${r.out}`);

  // Once fleetd.log exists it is the reading, and the old file is left alone.
  fs.writeFileSync(path.join(logs, 'fleetd.log'), 'tick\n');
  const fresh = run(ctl, ['--status'], root, guardBin, env);
  const freshAge = Number((/^summary:.* tick_age=(\d+)$/m.exec(fresh.out) ?? [])[1]);
  assert.ok(freshAge < 90_000, `tick_age=${freshAge} still reads registryd.log beside fleetd.log`);
  assert.ok(fs.existsSync(old), '--status moved or removed registryd.log');
});

test('--status prints no tick age outside the running arm', () => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('tick-age-dead');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const bin = stubPlatform(box, { loaded: 'no-pid' });
  const log = path.join(root, '.plot', 'logs', 'fleetd.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, 'tick\n');
  const r = run(ctl, ['--status'], root, guardBin, {
    HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, bin, process.env.PATH),
  });
  assert.equal(r.status, 1);
  assert.match(r.out, /^\s+last tick: \d+s ago/m, 'the loaded-not-running arm lost its tick line');
  assert.doesNotMatch(r.out, /^summary:.*tick_age=/m, 'a non-running arm carried tick_age=');

  // Both arms print one line, apart from the number.
  const upBin = stubPlatform(fs.mkdtempSync(path.join(box, 'up-')), { loaded: true });
  const up = run(ctl, ['--status'], root, guardBin, {
    HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, upBin, process.env.PATH),
  });
  assert.equal(up.status, 0);
  const tickLine = (out) => (/^\s+last tick: .*$/m.exec(out) ?? [''])[0].replace(/\d+s ago/, 'Ns ago');
  const caveat = '  last tick: Ns ago (evidence, not the verdict — a busy tick writes at most every 60s)';
  assert.equal(tickLine(r.out), caveat, 'the loaded-not-running arm changed its wording');
  assert.equal(tickLine(up.out), caveat, 'the running arm words its tick line differently');
});

// ── --status names a bundle the loaded unit still points at, but is gone ──────
//
// `supervisor_bundle_path` reads the bundle path from the LOADED job's own
// argv (`plot-fleetctl.sh:239-247`) — never a unit file on disk, because the
// RUNNING process already holds the old file open and a bundle removed out
// from under it is invisible to the pid check alone. The call site is the
// running arm only (`:734-742`), after the tick-age line and before the
// shared `summary:` line, so neither the summary's own regex nor the
// loaded-not-running arm is touched by this feature.
//
// `stubPlatform` ABOVE NEVER EMITS `arguments = { ... }`, only a bare
// `pid = 4242` line, so a dedicated stub is needed here rather than reusing
// it or `holdLabel` — neither prints the block this probe parses.

/**
 * Arm the sandbox's guard bin as a Darwin machine holding the label with a
 * live pid, whose `launchctl print` also names the given bundle path in an
 * `arguments = { ... }` block — the shape `supervisor_bundle_path` parses.
 *
 * @param bundlePath - the `.mjs` path the loaded job's argv names; omitted
 *   prints no `arguments` block at all, so the reading is empty
 */
function stubLoadedWithBundle(box, bundlePath) {
  const bin = path.join(box, 'bundle-stub-bin');
  fs.mkdirSync(bin, { recursive: true });
  const write = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  write('uname', '[ "$1" = "-s" ] && echo Darwin || exec /usr/bin/uname "$@"');
  const lines = [
    'gui/501/x = {',
    '\tactive count = 1',
    '\tpid = 4242',
    ...(bundlePath
      ? ['\targuments = {', `\t\t/usr/bin/node`, `\t\t${bundlePath}`, '\t}']
      : []),
    '}',
  ].map((l) => `printf '%s\\n' '${l}'`).join('\n');
  write('launchctl', `[ "$1" = print ] && { ${lines}; exit 0; }\nexit 113`);
  write('systemctl', `[ "$1" = show ] && { [ "$4" = MainPID ] && echo 4242; [ "$4" = ExecStart ] && printf '%s' "/usr/bin/node ${bundlePath ?? ''}"; exit 0; }\nexit 3`);
  return bin;
}

test('--status: a bundle the loaded unit names but that no longer exists is reported MISSING', () => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('bundle-missing');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const missing = path.join(root, 'skills', 'plot', 'scripts', 'board', 'plot-fleetd-old.mjs');
  const bin = stubLoadedWithBundle(box, missing);
  const r = run(ctl, ['--status'], root, guardBin, {
    HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, bin, process.env.PATH),
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^supervisor: running \(pid 4242\)/m, r.out);
  assert.match(r.out, new RegExp(`^  BUNDLE MISSING: ${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} no longer exists — the loaded unit still names it$`, 'm'),
    r.out);
  assert.match(r.out, /^    Rebuild it, or reinstall: \/plot-fleet --stop, then \/plot-fleet --start$/m, r.out);
});

test('--status: a bundle that still exists prints no BUNDLE MISSING line', () => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('bundle-present');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const present = path.join(root, 'skills', 'plot', 'scripts', 'board', 'plot-fleetd.mjs');
  assert.ok(fs.existsSync(present), 'the sandbox default bundle is gone; the fixture changed');
  const bin = stubLoadedWithBundle(box, present);
  const r = run(ctl, ['--status'], root, guardBin, {
    HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, bin, process.env.PATH),
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^supervisor: running \(pid 4242\)/m, r.out);
  assert.doesNotMatch(r.out, /BUNDLE MISSING/, r.out);
});

test('--status: a loaded job naming no argv at all is read as no bundle, not a missing one', () => {
  // EMPTY MEANS *do not report*, never *report a missing bundle at an empty
  // path*. `supervisor_bundle_path` always exits 0 (`:246`), so an empty
  // reading is indistinguishable from "the probe found nothing", and the call
  // site's own guard is `[ -n "$bundle" ] && [ ! -f "$bundle" ]` — the first
  // half refuses exactly this case.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('bundle-none');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const bin = stubLoadedWithBundle(box, null);
  const r = run(ctl, ['--status'], root, guardBin, {
    HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, bin, process.env.PATH),
  });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /BUNDLE MISSING/, r.out);
});

test('--status: BUNDLE MISSING never appears in the loaded-not-running arm', () => {
  // THE CALL SITE IS THE RUNNING ARM ONLY. A label held with no pid behind it
  // never reaches `supervisor_bundle_path` at all — proving the arm, not just
  // the text, stays out of the other states this command already narrates.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('bundle-not-running');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const bin = stubPlatform(box, { loaded: 'no-pid' });
  const r = run(ctl, ['--status'], root, guardBin, {
    HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, bin, process.env.PATH),
  });
  assert.equal(r.status, 1, r.out);
  assert.doesNotMatch(r.out, /BUNDLE MISSING/, r.out);
});

test('--status says loaded, not running when the label is held and no process is behind it', () => {
  // THE MIDDLE ROW, AND THE WHOLE SLICE. Measured twice in ninety minutes on
  // 2026-09-22: `--status` said `supervisor: running`, no `registryd.mjs`
  // process existed, and `launchctl list` showed the label with `-` in its
  // FIRST column — launchd saying *no pid*. An operator was told the fleet was
  // healthy while dispatched slices sat unserved.
  //
  // ON CI TOO, through the `PATH` seam the cases above use. The launchd arm is
  // reachable on `ubuntu-latest` because `uname` and `launchctl` both resolve
  // through `PATH` — an earlier draft claimed otherwise and was measured wrong.
  for (const plat of ['launchd', 'systemd']) {
    const kernel = plat === 'launchd' ? 'Darwin' : 'Linux';
    const { root, box, ctl, fleetLabel, guardBin } = sandbox(`loaded-no-pid-${plat}`);
    const home = fakeHome(box, { unit: true, label: fleetLabel });
    const bin = stubPlatform(box, { kernel, loaded: 'no-pid' });
    const r = run(ctl, ['--status'], root, guardBin, {
      HOME: home,
      PLOT_FLEET_LABEL: fleetLabel,
      PATH: withHarness(box, bin, process.env.PATH),
    });

    // THE EXIT CODE IS THE HALF A NAIVE FIX MISSES. `supervisor_loaded` was
    // called four times in this arm and the LAST one composed the exit code
    // from the label alone, after the message was printed — so a change to the
    // prose alone prints this row correctly and still exits 0. The question a
    // caller asks is *can I rely on it*, and here the answer is no.
    assert.equal(r.status, 1, `${plat}: a loaded label with no process behind it did not exit 1`);

    // THE FIELD GAINS A THIRD VALUE RATHER THAN REUSING `running`. Accepting
    // `install=running` beside `exit 1` would put the same contradiction one
    // field deeper — a caller reading the field while reading the code has to
    // know which to believe, and that is the defect being removed.
    assert.match(r.out, /^summary:.*supervisor=down install=loaded-not-running$/m,
      `${plat}: the summary line does not carry the third state`);

    // BOTH READINGS ON SEPARATE LINES, which is all that survives of the
    // `plot-boardctl.sh` precedent — its two-facts-must-agree rule belongs to
    // `--stop`, where a wrong guess kills a process.
    assert.match(r.out, /^\s+label:\s+loaded$/m, `${plat}: the label reading is not reported`);
    assert.match(r.out, /^\s+process:\s+absent$/m, `${plat}: the process reading is not reported`);

    // THE REPAIR IS IN THE MESSAGE, NEVER IN THE COMMAND — the rule this arm
    // already holds: a status that started what it was asked about could never
    // report an absence.
    assert.match(r.out, /--stop.*--start/s, `${plat}: the two-command repair is not named`);
    assert.equal(fs.existsSync(path.join(root, '.plot', 'state', 'fleet-start.done')), false,
      `${plat}: --status wrote the completion marker`);
  }
});

test('--status keeps the summary line shape in the loaded-but-dead state', () => {
  // THE BOARD'S CONTRACT, asserted for the new state as it is for the other
  // three. `rules/supervisor-reading.ts` finds the state on the `summary:`
  // line, and a field printed on its own line would be absent from exactly the
  // killed runs that most need explaining.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('summary-loaded-no-pid');
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const bin = stubPlatform(box, { loaded: 'no-pid' });
  const r = run(ctl, ['--status'], root, guardBin, {
    HOME: home,
    PLOT_FLEET_LABEL: fleetLabel,
    PATH: withHarness(box, bin, process.env.PATH),
  });
  assert.match(r.out, /^summary: agents_running=\d+ agents_other=\d+ supervisor=\S+ install=\S+$/m,
    'the loaded-but-dead state is not on the summary line the board reads');
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

// ── The label reaches the unit, not only its filename (#1051) ─────────────────
//
// THE FILENAME WAS ALWAYS RIGHT, which is why every case below reads the
// WRITTEN plist. launchd keys a job by the `Label` inside it, so an override
// that renamed the file and kept the template's literal loaded under the
// default. A test asserting `x.plist` exists passes against that defect.
//
// `stubPlatform` answers Darwin, so the launchd arm runs on CI's Linux too, and
// its `launchctl` refuses the bootstrap: the run exits after the fill and
// before anything reaches an init system.

/** Runs `--start` under a Darwin stub and returns the filled plist's `Label`. */
const startAndReadLabel = (label, env) => {
  const { root, box, ctl, guardBin } = sandbox(label);
  const home = fakeHome(box);
  const bin = stubPlatform(box, {});
  const r = run(ctl, ['--start'], root, guardBin, { HOME: home, PATH: withHarness(box, bin, process.env.PATH), ...env });
  const unitName = `${env.PLOT_FLEET_LABEL ?? 'com.plot-pm.fleetd'}.plist`;
  const target = path.join(home, 'Library', 'LaunchAgents', unitName);
  assert.ok(fs.existsSync(target), `no unit was filled at ${target}:\n${r.out}`);
  const unit = fs.readFileSync(target, 'utf8');
  assert.equal(unit.match(/__[A-Z_]+__/g), null, 'a placeholder survived the fill');
  return { r, unit, label: unit.match(/<key>Label<\/key>\s*<string>([^<]*)<\/string>/)?.[1] };
};

test('label: an override is the Label inside the written plist', () => {
  const { unit, label } = startAndReadLabel('label-override', { PLOT_FLEET_LABEL: 'com.example.x' });
  assert.equal(label, 'com.example.x', `the written plist loads under another label:\n${unit}`);
});

test('label: an unset override writes the default Label, never an empty one', () => {
  // A FILL THAT SUBSTITUTES AN EMPTY STRING passes the placeholder gate — no
  // `__LABEL__` survives it — and installs a job launchd cannot key.
  const { unit, label } = startAndReadLabel('label-default', {});
  assert.equal(label, 'com.plot-pm.fleetd', `the default label did not reach the unit:\n${unit}`);
});

test('label: --dry-run names the label that --start then writes', () => {
  // THE OPERATOR-VISIBLE HALF. `--dry-run` always printed the override; the
  // defect was that the written unit disagreed with it. One value, both ends.
  const override = 'com.example.dry';
  const { root, box, ctl, guardBin } = sandbox('label-dry');
  const bin = stubPlatform(box, {});
  const dry = run(ctl, ['--start', '--dry-run'], root, guardBin, {
    HOME: fakeHome(box), PATH: withHarness(box, bin, process.env.PATH), PLOT_FLEET_LABEL: override,
  });
  assert.equal(dry.status, 0, dry.out);
  const reported = dry.out.match(/^would fill and load (\S+) \(launchd\)$/m)?.[1];
  assert.equal(reported, override, `--dry-run reported another label:\n${dry.out}`);

  const { label } = startAndReadLabel('label-dry-written', { PLOT_FLEET_LABEL: override });
  assert.equal(label, reported, 'the written Label is not the one --dry-run reported');
});

// ── A consumer repository: Plot installed somewhere else (#969) ───────────────
//
// EVERY SANDBOX ABOVE HOLDS PLOT INSIDE THE REPOSITORY, so `$repo_root` and the
// script's own directory coincide and a path built from either passes. In a
// repository that consumes Plot as a plugin they do not: the consumer has no
// `skills/` and no `.nvmrc`, and the bundle and the pin live in the plugin.
// These cases separate the two roots, which is the only shape in which the
// defect reproduces.

/**
 * A consumer checkout and a separate Plot installation, the plugin shape.
 *
 * The consumer is a git repository with NO `skills/` directory and NO
 * `.nvmrc`. Plot is a plain directory elsewhere — the plugin cache is not a
 * git checkout — holding the scripts, the units, the bundle and Plot's pin.
 *
 * @param opts.nvmrc - Plot's pinned major ('' writes no file); defaults to the running node's
 * @param opts.registryd - whether the plugin carries the supervisor bundle
 */
function consumerSandbox(label, { nvmrc = process.versions.node.split('.')[0], registryd = true } = {}) {
  const { box, fleetLabel, guardBin } = sandbox(label, { nvmrc: '', registryd: false });
  const plugin = path.join(box, 'plugin-cache', 'plot', '9.9.9');
  const dst = path.join(plugin, 'skills', 'plot', 'scripts');
  fs.mkdirSync(path.join(dst, 'board'), { recursive: true });
  for (const f of ['plot-fleetctl.sh', 'plot-worker-state.sh', 'plot-config.sh', 'plot-monitor-subject.sh', 'plot-desk-root.sh', 'board/plot-desk-root.mjs']) {
    const src = path.join(scripts, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dst, f));
  }
  fs.chmodSync(path.join(dst, 'plot-fleetctl.sh'), 0o755);
  fs.cpSync(units, path.join(plugin, 'skills', 'plot', 'units'), { recursive: true });
  const bundle = path.join(dst, 'board', 'plot-fleetd.mjs');
  if (registryd) {
    fs.writeFileSync(bundle, 'console.log("fleetd ran:", process.argv.slice(2).join(" "));\n');
  }
  if (nvmrc) fs.writeFileSync(path.join(plugin, '.nvmrc'), `${nvmrc}\n`);

  const consumer = path.join(box, 'consumer');
  fs.mkdirSync(consumer);
  git(consumer, 'init', '-q', '-b', 'main');
  git(consumer, 'config', 'user.email', 'test@example.invalid');
  git(consumer, 'config', 'user.name', 'Plot Test');
  git(consumer, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(consumer, 'CLAUDE.md'), '# t\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '-qm', 'init');
  assert.equal(fs.existsSync(path.join(consumer, 'skills')), false);
  assert.equal(fs.existsSync(path.join(consumer, '.nvmrc')), false);

  return { box, consumer, plugin, bundle, fleetLabel, guardBin, ctl: path.join(dst, 'plot-fleetctl.sh') };
}

test('consumer: --once runs the bundle that ships beside the script', () => {
  const { consumer, ctl, fleetLabel, guardBin } = consumerSandbox('consumer-once');
  const r = run(ctl, ['--once'], consumer, guardBin, { PLOT_FLEET_LABEL: fleetLabel });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /fleetd ran: --once/);
  assert.doesNotMatch(r.out, /no supervisor artifact/);
});

test('consumer: the filled unit names the plugin bundle, never the consumer checkout', () => {
  // THE PERMANENT HALF. `--once` is re-resolved on every run; the unit is
  // written once and read by the init system for as long as it stays loaded.
  const { box, consumer, bundle, ctl, fleetLabel, guardBin } = consumerSandbox('consumer-fill');
  const home = fakeHome(box);
  // The stubbed launchctl/systemctl refuse the LOAD, so the run exits after
  // the fill and before anything reaches the init system or starts an agent.
  run(ctl, ['--start'], consumer, guardBin, { HOME: home, PLOT_FLEET_LABEL: fleetLabel });

  // THE SCRIPT'S OWN ANSWER, never a second copy of the naming rule: a test
  // that hardcoded the systemd name kept passing after the name stopped
  // following the label (#1053).
  const target = process.platform === 'darwin'
    ? path.join(home, 'Library', 'LaunchAgents', `${fleetLabel}.plist`)
    : path.join(home, '.config', 'systemd', 'user', `${unitNameFor(ctl, fleetLabel, consumer)}.service`);
  assert.ok(fs.existsSync(target), `no unit was filled at ${target}`);
  const unit = fs.readFileSync(target, 'utf8');
  assert.ok(unit.includes(bundle), `the unit does not name the plugin bundle ${bundle}:\n${unit}`);
  assert.equal(unit.includes(path.join(consumer, 'skills')), false,
    `the unit names a path inside the consumer checkout:\n${unit}`);
  assert.equal(unit.match(/__[A-Z_]+__/g), null, 'a placeholder survived the fill');
});

test("consumer: the node refusal fires on Plot's pin where the consumer has none", () => {
  // THE REGRESSION THE PANEL FOUND. The consumer has no `.nvmrc`, so a pin
  // read from `$repo_root` was empty and a wrong node went into the unit.
  const { box, consumer, ctl, fleetLabel, guardBin } = consumerSandbox('consumer-node', { nvmrc: '24' });
  const stubBin = path.join(box, 'node-bin');
  fs.mkdirSync(stubBin);
  fs.writeFileSync(path.join(stubBin, 'node'), '#!/bin/sh\necho v26.7.0\n');
  fs.chmodSync(path.join(stubBin, 'node'), 0o755);
  const home = fakeHome(box);

  const r = run(ctl, ['--start'], consumer, guardBin, {
    HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, stubBin, guardBin, process.env.PATH),
  });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /node on PATH is 26, Plot pins 24/);
  assert.match(r.out, /nvm install 24 && nvm use 24/);
  assert.equal(fs.readdirSync(path.join(home, 'Library', 'LaunchAgents')).length, 0,
    'the refusal wrote a unit');
});

test('consumer: a missing bundle still refuses, and names the build only for a development checkout', () => {
  const { consumer, ctl, fleetLabel, guardBin, box } = consumerSandbox('consumer-nobundle', { registryd: false });
  const home = fakeHome(box);
  for (const args of [['--once'], ['--start']]) {
    const r = run(ctl, args, consumer, guardBin, { HOME: home, PLOT_FLEET_LABEL: fleetLabel });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /no supervisor artifact at .*plugin-cache/);
    assert.match(r.out, /broken or partial installation of Plot/);
    assert.match(r.out, /Reinstall or update the Plot plugin/);
    for (const line of r.out.split('\n').filter((l) => l.includes('build:board'))) {
      assert.match(line, /In a development checkout/, `build:board offered to a consumer: ${line}`);
    }
  }
});

// ── Which checkout the loaded supervisor serves ───────────────────────────────
//
// REFUSAL 4 said `'<label>' is already loaded` and nothing more, so an operator
// ran `launchctl print` by hand to learn whose supervisor held the label. The
// reading is the loaded job's `working directory`, compared with this checkout.
//
// THE STUB PRINTS WHAT `launchctl print` PRINTS: `working directory = <path>`
// under a tab, lowercase with a space. The plist's `WorkingDirectory` key never
// appears in that output, so a stub fed the plist shape would pass against the
// template and find nothing on a live machine.
//
// THE STUB REPLACES THE SANDBOX'S OWN GUARD. Every call lands in the sandbox's
// `guardBin`; `print` answers the case, and every other subcommand is recorded
// so a test can assert that nothing was booted out or bootstrapped.

/**
 * Arm the sandbox's guard bin as a Darwin machine holding the label.
 *
 * @param workdir - the job's working directory; null prints no such line
 * @returns the file every non-`print` launchctl call is appended to
 */
function holdLabel(box, guardBin, workdir) {
  const calls = path.join(box, 'launchctl.calls');
  const write = (name, body) => {
    const p = path.join(guardBin, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  write('uname', '[ "$1" = "-s" ] && echo Darwin || exec /usr/bin/uname "$@"');
  const printed = [
    `gui/501/x = {`,
    `\tactive count = 1`,
    ...(workdir === null ? [] : [`\tworking directory = ${workdir}`]),
    `\tpid = 4242`,
    `}`,
  ].map((l) => `printf '%s\\n' '${l}'`).join('\n');
  write('launchctl', `if [ "$1" = print ]; then\n${printed}\nexit 0\nfi\necho "$*" >> '${calls}'\nexit 0`);
  return calls;
}

const launchctlCalls = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);

/** Run `--start` against a held label and return the run plus what it touched. */
function startAgainst(label, workdir) {
  const s = sandbox(label);
  const calls = holdLabel(s.box, s.guardBin, typeof workdir === 'function' ? workdir(s) : workdir);
  const home = fakeHome(s.box);
  const r = run(s.ctl, ['--start'], s.root, s.guardBin, { HOME: home, PLOT_FLEET_LABEL: s.fleetLabel });
  return { ...s, r, calls: launchctlCalls(calls), units: fs.readdirSync(path.join(home, 'Library', 'LaunchAgents')) };
}

test('refusal 4: a label held by another checkout names that checkout', () => {
  const other = fs.realpathSync(scratch('plot-fleetctl-other-'));
  const { r, calls, units, root } = startAgainst('held-other', other);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, new RegExp(`serving ANOTHER checkout \\(${other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`),
    'the refusal names the other checkout by path');
  assert.match(r.out, new RegExp(`This repository is ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.deepEqual(calls, [], 'nothing was booted out or bootstrapped');
  assert.deepEqual(units, [], 'no unit was written');
});

test('refusal 4: a label held by THIS checkout says so, and still refuses', () => {
  const { r, calls, units } = startAgainst('held-this', (s) => s.root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /serving THIS repository/);
  assert.deepEqual(calls, []);
  assert.deepEqual(units, []);
});

test('refusal 4: this checkout through a symlink is still this checkout', () => {
  const { r } = startAgainst('held-link', (s) => {
    const link = path.join(s.box, 'linked-repo');
    fs.symlinkSync(s.root, link);
    return link;
  });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /serving THIS repository/, 'physical paths are compared');
});

test('refusal 4: no working directory answers cannot determine, and still refuses', () => {
  // THE DANGEROUS MISREADING. An implementation that reads empty as *this
  // repository* passes the two cases above and invites an overwrite of a
  // supervisor that is not this checkout's.
  const { r, calls, units } = startAgainst('held-unknown', null);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /cannot be determined/);
  assert.doesNotMatch(r.out, /THIS repository/, 'an unreadable job is never read as this checkout');
  assert.deepEqual(calls, []);
  assert.deepEqual(units, []);
});

test('--status names the checkout the running supervisor serves', () => {
  const other = fs.realpathSync(scratch('plot-fleetctl-other-'));
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('status-serves');
  const calls = holdLabel(box, guardBin, other);
  const r = run(ctl, ['--status'], root, guardBin, { HOME: fakeHome(box), PLOT_FLEET_LABEL: fleetLabel });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /supervisor: running \(pid 4242\)/);
  assert.match(r.out, new RegExp(`serves:  ANOTHER checkout \\(${other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  assert.match(r.out, /^summary: /m, 'the summary line the board reads is still there');
  assert.deepEqual(launchctlCalls(calls), []);
});

test('--status says cannot determine where the job names no working directory', () => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('status-serves-unknown');
  holdLabel(box, guardBin, null);
  const r = run(ctl, ['--status'], root, guardBin, { HOME: fakeHome(box), PLOT_FLEET_LABEL: fleetLabel });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /serves:  cannot determine/);
});

test('supervisor_workdir returns 0 when launchctl answers 113', () => {
  // A reader ending in a launchctl pipeline must not leak the init system's code.
  const { root, ctl } = sandbox('workdir-rc');
  const probe = `PLOT_FLEETCTL_SOURCED=1 . '${ctl}'
platform() { echo launchd; }
launchctl() { return 113; }
out=$(supervisor_workdir); rc=$?; printf '%s|%s|%s' "$rc" "$out" "$(supervisor_checkout)"`;
  const out = execFileSync('bash', ['-c', probe], { encoding: 'utf8', cwd: root });
  assert.equal(out, '0||unknown');
});

// ── --start migrates an old-label unit serving this checkout (the rename) ─────
//
// THE LABEL CHANGED DEFAULT from `com.plot-pm.registryd` to `com.plot-pm.fleetd`
// (`plot-fleetctl.sh:90`), and `--start` under the bare NEW default migrates an
// old-label unit that belongs to THIS checkout rather than leaving it orphaned
// — `plot-fleetctl.sh:1013-1040`. Nothing here used `PLOT_FLEET_LABEL` to name
// the sandbox's own per-test label, because the migration branch only runs
// `if [ "$LABEL" = com.plot-pm.fleetd ]` — the bare default, unset. Every case
// below runs with no override, so the suite's own mutual-exclusion concern
// (why `sandbox()` mints a label this machine does not hold) does not apply to
// `com.plot-pm.fleetd` itself: this machine's real fleet, if any, runs under
// its own developer-chosen label or the legacy default, never under a
// `.test-<label>-<pid>` suffix, so the bare new default is itself as safe to
// probe as a minted one — and the bare OLD default is exactly what this block
// exists to detect and migrate, never to stub around.
//
// THE STUB ANSWERS BY LABEL, which `holdLabel` above does not: the migration
// block probes the OLD label specifically (`gui/$(id -u)/com.plot-pm.registryd`)
// after switching `$LABEL`/`$UNIT_NAME`, so a stub that answers every `print`
// identically cannot distinguish "the new default is not loaded" (needed for
// the migration branch and refusal 4 to both read false) from "the old default
// is loaded, serving some workdir" (needed to drive the three cases below).

/**
 * Arm the sandbox's guard bin as a Darwin machine that answers `launchctl
 * print` differently depending on which label is asked about: the bare OLD
 * default (`com.plot-pm.registryd`) is loaded with the given working
 * directory; every other label — including the bare NEW default this suite
 * runs `--start` under — answers absent, launchd's real 113.
 *
 * @param oldWorkdir - the old-label job's working directory; null prints no
 *   such line (the "cannot determine" case)
 * @returns the file every non-`print` launchctl call is appended to
 */
function holdOldLabelOnly(box, guardBin, oldWorkdir, { unloads = false } = {}) {
  const calls = path.join(box, 'launchctl.calls');
  const gone = path.join(box, 'old-label.gone');
  const write = (name, body) => {
    const p = path.join(guardBin, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  write('uname', '[ "$1" = "-s" ] && echo Darwin || exec /usr/bin/uname "$@"');
  const printed = [
    `gui/501/com.plot-pm.registryd = {`,
    `\tactive count = 1`,
    ...(oldWorkdir === null ? [] : [`\tworking directory = ${oldWorkdir}`]),
    `\tpid = 4242`,
    `}`,
  ].map((l) => `printf '%s\\n' '${l}'`).join('\n');
  write('launchctl', [
    'if [ "$1" = print ]; then',
    '  case "$2" in',
    `    */com.plot-pm.registryd) [ -f '${gone}' ] && exit 113; ${printed}; exit 0 ;;`,
    '    *) exit 113 ;;',
    '  esac',
    'fi',
    `echo "$*" >> '${calls}'`,
    ...(unloads ? [`case "$*" in "bootout "*/com.plot-pm.registryd) : > '${gone}'; exit 0 ;; esac`] : []),
    'exit 113',
  ].join('\n'));
  return calls;
}

/**
 * Run fleetctl with no label override, so the old-label branch's own guard
 * fires. The fake home holds the old label's plist, so a removal is visible.
 *
 * @param args - the verb and its flags; `--wait 1` bounds an unload that never lands
 * @param opts.unloads - whether a bootout of the old label takes effect
 */
function underNewDefault(label, oldWorkdir, args = ['--start'], { unloads = false } = {}) {
  const s = sandbox(label);
  const calls = holdOldLabelOnly(s.box, s.guardBin, typeof oldWorkdir === 'function' ? oldWorkdir(s) : oldWorkdir, { unloads });
  const home = fakeHome(s.box, { unit: true, label: 'com.plot-pm.registryd' });
  const r = run(s.ctl, args, s.root, s.guardBin, { HOME: home });
  const oldPlist = path.join(home, 'Library', 'LaunchAgents', 'com.plot-pm.registryd.plist');
  return { ...s, r, calls: launchctlCalls(calls), oldPlist };
}
const startUnderNewDefault = (label, oldWorkdir, opts) => underNewDefault(label, oldWorkdir, ['--start', '--wait', '1'], opts);
const OLD_BOOTOUT = `bootout gui/${process.getuid()}/com.plot-pm.registryd`;

test('migration: an old-label unit serving this checkout is booted out and removed', () => {
  const { r, calls, oldPlist } = startUnderNewDefault('migrate-this', (s) => s.root, { unloads: true });
  assert.match(r.out, /unloading the old label 'com.plot-pm.registryd' — it serves this repository/, r.out);
  assert.match(r.out, /^  unloaded and removed$/m, r.out);
  assert.ok(calls.includes(OLD_BOOTOUT), `no bootout of the old label was recorded:\n${calls.join('\n')}`);
  assert.equal(fs.existsSync(oldPlist), false, "the old label's plist survived the migration");
  // THE RUN CONTINUES UNDER THE NEW LABEL and exits 1 later, at the
  // `launchctl bootstrap` the sandbox's guard refuses (exit 113).
  assert.match(r.out, /filled .*com\.plot-pm\.fleetd\.plist/, r.out);
});

test('migration: an old-label unit that does not unload refuses, keeps its plist and installs nothing', () => {
  // `bootout` exits 113 and the label stays loaded past the `--wait` bound.
  // Installing beside it would run two supervisors over one estate.
  const { r, calls, oldPlist } = startUnderNewDefault('migrate-stuck', (s) => s.root);
  assert.equal(r.status, 1, r.out);
  assert.ok(calls.includes(OLD_BOOTOUT), calls.join('\n'));
  assert.match(r.out, /did NOT unload within 1s/, r.out);
  assert.doesNotMatch(r.out, /unloaded and removed/, r.out);
  assert.ok(fs.existsSync(oldPlist), 'the old plist was removed although its job is still loaded');
  assert.doesNotMatch(r.out, /filled .*com\.plot-pm\.fleetd\.plist/, r.out);
});

test('migration: --dry-run names the migration and boots out nothing', () => {
  const dry = underNewDefault('migrate-dry', (s) => s.root, ['--start', '--dry-run'], { unloads: true });
  assert.equal(dry.r.status, 0, dry.r.out);
  assert.match(dry.r.out, /would migrate the old label 'com.plot-pm.registryd'/, dry.r.out);
  assert.deepEqual(dry.calls, [], 'a dry run called launchctl beyond print');
  assert.ok(fs.existsSync(dry.oldPlist), 'a dry run removed the old plist');
});

test('migration: an old-label unit naming no working directory refuses rather than installing beside it', () => {
  const { r, calls, oldPlist } = startUnderNewDefault('migrate-unknown', null, { unloads: true });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /com\.plot-pm\.registryd.*cannot be determined/, r.out);
  assert.match(r.out, /launchctl print gui\/\$\(id -u\)\/com\.plot-pm\.registryd/, r.out);
  assert.deepEqual(calls, [], 'nothing was booted out or bootstrapped');
  assert.ok(fs.existsSync(oldPlist));
});

test('old label: --status names a supervisor still running under it', () => {
  const { r, calls } = underNewDefault('old-status', (s) => s.root, ['--status']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /supervisor: running \(pid 4242\) — com\.plot-pm\.registryd/, r.out);
  assert.match(r.out, /^  under the old label; \/plot-fleet --start migrates it$/m, r.out);
  assert.doesNotMatch(r.out, /not installed/, r.out);
  assert.deepEqual(calls, []);
});

test('old label: --status leaves an old-label supervisor of another checkout out', () => {
  const other = fs.realpathSync(scratch('plot-fleetctl-other-'));
  const { r } = underNewDefault('old-status-other', other, ['--status']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /not installed \(com\.plot-pm\.fleetd\)/, r.out);
});

test('old label: --stop unloads it, confirmed, and removes its plist', () => {
  const { r, calls, oldPlist } = underNewDefault('old-stop', (s) => s.root, ['--stop', '--wait', '1'], { unloads: true });
  assert.equal(r.status, 0, r.out);
  assert.ok(calls.includes(OLD_BOOTOUT), calls.join('\n'));
  assert.match(r.out, /unloading the old label 'com\.plot-pm\.registryd'/, r.out);
  assert.match(r.out, /^  unloaded and removed$/m, r.out);
  assert.ok(!fs.existsSync(oldPlist), r.out);
});

test('old label: --stop exits 1 and keeps the plist when the unload is never confirmed', () => {
  const { r, calls, oldPlist } = underNewDefault('old-stop-stuck', (s) => s.root, ['--stop', '--wait', '1']);
  assert.equal(r.status, 1, r.out);
  assert.ok(calls.includes(OLD_BOOTOUT), calls.join('\n'));
  assert.match(r.out, /'com\.plot-pm\.registryd' did NOT unload within 1s/, r.out);
  assert.ok(fs.existsSync(oldPlist));
});

test('old label: --stop never touches an old-label supervisor of another checkout', () => {
  const other = fs.realpathSync(scratch('plot-fleetctl-other-'));
  const { r, calls, oldPlist } = underNewDefault('old-stop-other', other, ['--stop', '--wait', '1'], { unloads: true });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(calls, []);
  assert.ok(fs.existsSync(oldPlist));
});

test('migration: an old-label unit serving another checkout is never touched', () => {
  // `calls` ALSO CARRIES THE NEW LABEL'S OWN `bootstrap`, which is this run
  // continuing normally after the migration guard declines to fire — an
  // unrelated call this test must not mistake for evidence against it. What
  // must never appear is a call NAMING THE OLD LABEL.
  const other = fs.realpathSync(scratch('plot-fleetctl-other-'));
  const { r, calls, oldPlist } = startUnderNewDefault('migrate-another', other);
  assert.doesNotMatch(r.out, /unloading the old label/, r.out);
  assert.ok(!calls.some((c) => c.includes('com.plot-pm.registryd') || c.includes('plot-registryd')),
    `the old label was touched: ${calls.join('\n')}`);
  assert.ok(fs.existsSync(oldPlist), "another checkout's old plist was removed");
});

test('migration: no old-label unit loaded is silently skipped', () => {
  // THE DEFAULT GUARD ALREADY ANSWERS THIS. `sandbox()`'s `guardBin` gives every
  // label — old or new — a bare `exit 113`, launchd's real answer for a label
  // nothing holds, so no stub beyond the sandbox's own is needed here.
  const { root, box, ctl, guardBin } = sandbox('migrate-none');
  const home = fakeHome(box);
  const r = run(ctl, ['--start'], root, guardBin, { HOME: home });
  assert.doesNotMatch(r.out, /unloading the old label/, r.out);
});

test('migration: a custom label never enters the migration branch', () => {
  // THE GUARD IS `$LABEL = com.plot-pm.fleetd` EXACTLY. An operator's own
  // label — this sandbox's minted `fleetLabel`, itself under the old prefix —
  // must never probe or touch `com.plot-pm.registryd`, even when that old
  // default happens to be loaded and serving this very checkout: the migration
  // is for the rename, not for every `--start` under every label.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('migrate-custom');
  const calls = holdOldLabelOnly(box, guardBin, root);
  const home = fakeHome(box);
  const r = run(ctl, ['--start'], root, guardBin, { HOME: home, PLOT_FLEET_LABEL: fleetLabel });
  assert.doesNotMatch(r.out, /unloading the old label/, r.out);
  // The run still bootstraps the CUSTOM label itself normally — this asserts
  // only that the bare OLD DEFAULT, distinct from this sandbox's own minted
  // label, is never named in a recorded call.
  assert.ok(!launchctlCalls(calls).some((c) => c === `bootout gui/${process.getuid()}/com.plot-pm.registryd`),
    `the bare old default was booted out under a custom label: ${launchctlCalls(calls).join('\n')}`);
});

// ── The systemd unit name follows the label (#1053) ───────────────────────────
//
// launchd keys a job by the label inside the plist; systemd keys a unit by its
// FILENAME. With the name hardcoded, two checkouts wrote one file, and refusal
// 4 asked `is-active` about the default unit while naming the operator's label.
// These cases run the systemd arm on any host through a `uname` and a
// `systemctl` on `PATH`, and the `systemctl` stub RECORDS its argv: `disable`
// output is discarded by the script, so a wrong name still exits cleanly and
// only the recorded call can show which unit was asked about.

// THE CWD IS A PARAMETER, because sourcing the script resolves a repo root and
// refuses outside one. `path.dirname(ctl)` is a git repository for a `sandbox`
// ctl and NOT for a `consumerSandbox` one, whose ctl lives in a plugin cache —
// so the default masked the failure everywhere but the one call site that
// needed it, and only on a runner whose temp dir is outside any checkout.
const unitNameFor = (ctl, label, cwd = path.dirname(ctl)) => {
  const probe = `PLOT_FLEETCTL_SOURCED=1 . '${ctl}'; printf '%s' "$UNIT_NAME"`;
  const env = { ...process.env, PLOT_FLEET_LABEL: label };
  if (label === undefined) delete env.PLOT_FLEET_LABEL;
  return execFileSync('bash', ['-c', probe], { encoding: 'utf8', cwd, env });
};

// A systemd whose active units are files in a directory, so `disable --now`
// can make one inactive and the `--stop` poll sees it go. `daemon-reload`
// succeeds and `enable` fails, so a `--start` records the enable call and exits
// before it starts any agent.
const stubSystemd = (box, { active = [] } = {}) => {
  const bin = path.join(box, 'systemd-bin');
  const state = path.join(box, 'systemd-active');
  const log = path.join(box, 'systemctl.log');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  for (const name of active) fs.writeFileSync(path.join(state, name), '');
  const write = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  write('uname', '[ "$1" = "-s" ] && echo Linux || exec /usr/bin/uname "$@"');
  write('systemctl', [
    `printf '%s\\n' "$*" >> '${log}'`,
    '[ "$1" = --user ] && shift',
    'case "$1" in',
    `  is-active) [ -f '${state}'/"$3" ] && exit 0; exit 3 ;;`,
    `  show) [ -f '${state}'/"$2" ] && [ "$4" = MainPID ] && echo 4242; exit 0 ;;`,
    `  disable) rm -f '${state}'/"$3"; exit 0 ;;`,
    '  daemon-reload) exit 0 ;;',
    '  *) exit 1 ;;',
    'esac',
  ].join('\n'));
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) };
};

test('unit name: the default label is now plot-fleetd', () => {
  const { ctl } = sandbox('unitname-default');
  assert.equal(unitNameFor(ctl, undefined), 'plot-fleetd');
});

test('unit name: the old default label keeps plot-registryd, for every existing install with it', () => {
  const { ctl } = sandbox('unitname-default-old');
  assert.equal(unitNameFor(ctl, 'com.plot-pm.registryd'), 'plot-registryd');
});

test('unit name: another label strips the default prefix and keeps the rest distinct', () => {
  const { ctl } = sandbox('unitname-derived');
  // THE SHAPE `units/README.md` DOCUMENTS for a second repository, under the
  // new default prefix.
  assert.equal(unitNameFor(ctl, 'com.plot-pm.fleetd.ewz-kus-portal'), 'plot-fleetd-ewz-kus-portal');
  // The old prefix keeps its own mapping forever, for every existing install.
  assert.equal(unitNameFor(ctl, 'com.plot-pm.registryd.ewz-kus-portal'), 'plot-registryd-ewz-kus-portal');
  // Two labels sharing a last segment stay two units.
  assert.notEqual(unitNameFor(ctl, 'com.a.portal'), unitNameFor(ctl, 'com.b.portal'));
  assert.equal(unitNameFor(ctl, 'com.a.portal'), 'plot-registryd-com.a.portal');
});

test('unit name: bytes systemd refuses in a unit name are replaced', () => {
  const { ctl } = sandbox('unitname-sanitise');
  const name = unitNameFor(ctl, 'com.plot-pm.registryd.my label/x$y');
  assert.equal(name, 'plot-registryd-my-label-x-y');
  assert.match(name, /^[A-Za-z0-9:_.-]+$/);
});

test('systemd: --start under a label writes and enables the unit that label names', () => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('unitname-start');
  const home = fakeHome(box);
  const sd = stubSystemd(box);
  const r = run(ctl, ['--start'], root, guardBin, {
    HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, sd.bin, guardBin, process.env.PATH),
  });
  const name = fleetLabel.replace(/^com\.plot-pm\.registryd\./, 'plot-registryd-');
  const units = path.join(home, '.config', 'systemd', 'user');
  assert.ok(fs.existsSync(path.join(units, `${name}.service`)), `no ${name}.service:\n${r.out}`);
  assert.equal(fs.existsSync(path.join(units, 'plot-fleetd.service')), false,
    'a labelled start wrote the default unit, which another checkout owns');
  assert.ok(sd.calls().includes(`--user enable --now ${name}`), sd.calls().join('\n'));
});

test('systemd: --start with no label now writes plot-fleetd.service', () => {
  const { root, box, ctl, guardBin } = sandbox('unitname-unset');
  const home = fakeHome(box);
  const sd = stubSystemd(box);
  const r = run(ctl, ['--start'], root, guardBin, {
    HOME: home, PATH: withHarness(box, sd.bin, guardBin, process.env.PATH),
  });
  assert.ok(fs.existsSync(path.join(home, '.config', 'systemd', 'user', 'plot-fleetd.service')), r.out);
  assert.ok(sd.calls().includes('--user enable --now plot-fleetd'), sd.calls().join('\n'));
});

test('systemd: refusal 4 asks about the unit it names, so a second label is not refused', () => {
  // A's default unit is active; B starts under its own label. Asking the
  // hardcoded name refused B and told it to do what it just did.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('unitname-refusal');
  const home = fakeHome(box);
  const sd = stubSystemd(box, { active: ['plot-registryd'] });
  const r = run(ctl, ['--start'], root, guardBin, {
    HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, sd.bin, guardBin, process.env.PATH),
  });
  assert.doesNotMatch(r.out, /is already loaded/, r.out);
  const name = fleetLabel.replace(/^com\.plot-pm\.registryd\./, 'plot-registryd-');
  assert.ok(sd.calls().includes(`--user is-active --quiet ${name}`), sd.calls().join('\n'));
  assert.equal(sd.calls().some((c) => / plot-registryd$/.test(c)), false,
    `a call named the default unit:\n${sd.calls().join('\n')}`);
});

test('systemd: refusal 4 still refuses when the label\'s own unit is active', () => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('unitname-taken');
  const home = fakeHome(box);
  const name = fleetLabel.replace(/^com\.plot-pm\.registryd\./, 'plot-registryd-');
  const sd = stubSystemd(box, { active: [name] });
  const r = run(ctl, ['--start'], root, guardBin, {
    HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, sd.bin, guardBin, process.env.PATH),
  });
  assert.equal(r.status, 1);
  assert.match(r.out, /is already loaded/);
  assert.match(r.out, new RegExp(`systemctl --user show ${name.replace(/[.]/g, '\\.')}`));
});

test('systemd: --status and --stop ask about the unit --start wrote', () => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('unitname-stop');
  const home = fakeHome(box);
  const name = fleetLabel.replace(/^com\.plot-pm\.registryd\./, 'plot-registryd-');
  const sd = stubSystemd(box, { active: [name, 'plot-registryd'] });
  const env = { HOME: home, PLOT_FLEET_LABEL: fleetLabel, PATH: withHarness(box, sd.bin, guardBin, process.env.PATH) };

  run(ctl, ['--status'], root, guardBin, env);
  assert.ok(sd.calls().includes(`--user is-active --quiet ${name}`), sd.calls().join('\n'));

  const r = run(ctl, ['--stop', '--wait', '5'], root, guardBin, env);
  // THE RECORDED CALL, NOT THE EXIT CODE: `disable` output is discarded.
  assert.ok(sd.calls().includes(`--user disable --now ${name}`), `${sd.calls().join('\n')}\n${r.out}`);
  assert.equal(sd.calls().includes('--user disable --now plot-registryd'), false,
    'a labelled --stop disabled the default unit, which another checkout owns');
  assert.ok(fs.existsSync(path.join(box, 'systemd-active', 'plot-registryd')),
    'the other checkout\'s unit was stopped');
});

test('gate: no systemctl call or systemd unit path in plot-fleetctl.sh hardcodes plot-registryd outside the migration block', () => {
  // THE SHIPPED TEMPLATE'S FILENAME IS EXCLUDED by construction: that line
  // names `$UNIT_DIR`, carries no `systemctl` and no `systemd/user`, and is the
  // file the fill reads rather than a unit anybody routes to.
  //
  // THE MIGRATION BLOCK IS EXCLUDED TOO, and deliberately — it is the one
  // place that is SUPPOSED to hardcode the old unit name: it boots out an
  // old-labelled job serving this same checkout when `--start` runs under the
  // new default label, and `systemctl --user disable --now plot-registryd`
  // plus the matching `rm -f .../plot-registryd.service` are exactly that.
  const lines = fs.readFileSync(path.join(scripts, 'plot-fleetctl.sh'), 'utf8').split('\n');
  const offenders = lines
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => !/^\s*#/.test(line))
    .filter(([, line]) => /systemctl|systemd\/user/.test(line))
    .filter(([, line]) => /plot-registryd(?![-\w]*\.mjs)/.test(line.replace(/\$UNIT_NAME/g, '')))
    .filter(([, line]) => !/disable --now plot-registryd|systemd\/user\/plot-registryd\.service/.test(line));
  assert.deepEqual(offenders, [], `hardcoded unit name:\n${offenders.map(([n, l]) => `${n}: ${l}`).join('\n')}`);
  // The template line survives and stays hardcoded — at the new default name.
  assert.ok(lines.some((line) => line.includes('template="$UNIT_DIR/plot-fleetd.service"')));
});

// ── Every Plot process on this machine ────────────────────────────────────────
//
// `--status` answered about ONE label. Measured 2026-09-29: it printed one
// healthy supervisor while 17 scan processes from five installations loaded the
// machine, every one spawned by a board. The second block finds supervisors,
// boards and top-level scans by process, and prints only when one serves
// another checkout or a scan is orphaned.
//
// EVERY macOS CASE RUNS UNDER A DARWIN KERNEL STUB. CI is `ubuntu-latest`, and
// without the stub these cases take the `readlink` arm, print `cannot
// determine`, and pass for the wrong reason.

const SCAN = 'skills/plot/scripts/plot-fleet-scan.sh';
const BOARD = 'skills/plot/scripts/board/board-server.mjs';
// Both suffixes name a supervisor process, permanently: some other
// installation on this machine keeps running the old-named bundle forever,
// so the classifier recognizes `plot-registryd.mjs` and `plot-fleetd.mjs`
// side by side rather than as a migration shim for one or the other.
const REGD = 'skills/plot/scripts/board/plot-registryd.mjs';
const FLEETD = 'skills/plot/scripts/board/plot-fleetd.mjs';

/**
 * Writes one process-table fixture for the stubs `writeProcStubs` installs.
 *
 * @param dir - a fresh directory to hold the fixture
 * @param spec.ps - rows of `[pid, ppid, uid, args]`
 * @param spec.cwd - pid → the working directory `lsof` answers
 * @param spec.users - uid → the name `id -un` answers
 * @param spec.list - rows of `[pid, label]` for `launchctl list`
 * @returns the directory, for `PLOT_TEST_PROCS`
 */
const writeProcs = (dir, { ps = [], cwd = {}, users = {}, list = [] } = {}) => {
  fs.mkdirSync(path.join(dir, 'cwd'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'users'), { recursive: true });
  const pad = (v) => String(v).padStart(5);
  fs.writeFileSync(path.join(dir, 'ps'),
    ps.map(([pid, ppid, uid, args]) => `${pad(pid)} ${pad(ppid)} ${pad(uid)} ${args}\n`).join(''));
  for (const [pid, d] of Object.entries(cwd)) fs.writeFileSync(path.join(dir, 'cwd', pid), d);
  for (const [uid, name] of Object.entries(users)) fs.writeFileSync(path.join(dir, 'users', uid), name);
  fs.writeFileSync(path.join(dir, 'launchctl-list'),
    `PID\tStatus\tLabel\n${list.map(([pid, label]) => `${pid}\t0\t${label}\n`).join('')}`);
  return dir;
};

/**
 * A sandbox whose `--status` can be run against several process tables. The
 * supervisor the first block names is loaded at pid 4242.
 *
 * @param label - the sandbox's name
 * @param opts.kernel - what `uname -s` answers
 * @returns `{ root, box, home, status(spec, env) }`, where `status` answers
 *   `{ status, out, block }` and `block` is the text after the block's heading
 */
const procSandbox = (label, { kernel = 'Darwin' } = {}) => {
  const { root, box, ctl, fleetLabel, guardBin } = sandbox(label);
  const home = fakeHome(box, { unit: true, label: fleetLabel });
  const bin = stubPlatform(box, { kernel, loaded: true });
  const status = (spec = {}, env = {}) => {
    const dir = writeProcs(fs.mkdtempSync(path.join(box, 'procs-')), spec);
    const r = run(ctl, ['--status'], root, guardBin, {
      HOME: home,
      PLOT_FLEET_LABEL: fleetLabel,
      PLOT_TEST_PROCS: dir,
      PATH: withHarness(box, bin, process.env.PATH),
      ...env,
    });
    const at = r.out.indexOf('\nplot processes on this machine:\n');
    return { ...r, block: at < 0 ? '' : r.out.slice(at) };
  };
  return { root, box, home, status };
};

// A board serving another checkout, so a case asserting what is NOT reported
// reads a block that printed rather than one that stayed silent.
const SENTINEL = [900, 1, 501, `node /inst/${BOARD}`];
const SENTINEL_CWD = { 900: '/repos/other' };

const row = (kind, pid, lines) => `  ${kind.padEnd(10)}  pid ${pid}${lines.label ? `  ${lines.label}` : ''}\n`
  + `    serves:     ${lines.serves}\n    installed:  ${lines.installed}\n`;

test('processes: two supervisors, a --watch board and a plain board are all named', () => {
  const { root, home, status } = procSandbox('procs-four');
  const cache = `${home}/.claude/plugins/cache/plot-marketplace/plot/2.21.0`;
  const r = status({
    ps: [
      [501, 1, 501, `/usr/local/bin/node /inst/a/${REGD} --start-agents`],
      [502, 1, 501, `node ${cache}/${REGD}`],
      [601, 40, 501, `node --watch ${BOARD}`],
      [602, 601, 501, `/usr/local/bin/node ${BOARD}`],
      [603, 1, 501, `node /opt/App Support/inst/${BOARD} --port 7778`],
    ],
    cwd: { 501: '/repos/a', 502: '/repos/b', 601: root, 602: root, 603: '/repos/b' },
    list: [[501, 'com.plot-pm.registryd.a'], [502, 'com.quatico.ewz.registryd']],
  });
  assert.equal(r.status, 0, 'the block changed the exit code');
  assert.ok(r.block.includes(row('supervisor', 501, { label: 'com.plot-pm.registryd.a', serves: '/repos/a', installed: '/inst/a' })), r.out);
  // A label nobody told the enumeration about is found, because it reads none.
  assert.ok(r.block.includes(row('supervisor', 502, {
    label: 'com.quatico.ewz.registryd', serves: '/repos/b', installed: '~/.claude/plugins/cache/plot-marketplace/plot/2.21.0',
  })), r.out);
  // The --watch pair is one row, and it carries the watcher's pid. The
  // relative artifact path resolves against the cwd.
  assert.ok(r.block.includes(row('board', 601, { serves: 'THIS repository', installed: 'THIS repository' })), r.out);
  assert.doesNotMatch(r.block, /pid 602/, 'the --watch child was reported beside its watcher');
  // An installation path holding a space prints whole.
  assert.ok(r.block.includes(row('board', 603, { serves: '/repos/b', installed: '/opt/App Support/inst' })), r.out);
  // The summary line stays first-of-its-kind and ahead of the block.
  assert.ok(r.out.indexOf('\nsummary:') < r.out.indexOf('plot processes on this machine:'));
  assert.doesNotMatch(r.block, /^summary:/m, 'a block line starts with summary:');
});

test('processes: the old and the new bundle suffix are both named a supervisor, permanently', () => {
  // THIS IS NOT A MIGRATION SHIM. The classifier recognizes both bundle-path
  // suffixes forever, because some other installation on this machine keeps
  // running the old-named bundle for as long as it is never restarted under
  // the new default label — restarting it is what the migration block does,
  // and nothing forces that to happen everywhere at once.
  const { status } = procSandbox('procs-dual-suffix');
  const r = status({
    ps: [
      [701, 1, 501, `node /inst/old/${REGD}`],
      [702, 1, 501, `node /inst/new/${FLEETD}`],
    ],
    cwd: { 701: '/repos/old', 702: '/repos/new' },
    list: [[701, 'com.plot-pm.registryd'], [702, 'com.plot-pm.fleetd']],
  });
  assert.ok(r.block.includes(row('supervisor', 701, { label: 'com.plot-pm.registryd', serves: '/repos/old', installed: '/inst/old' })), r.out);
  assert.ok(r.block.includes(row('supervisor', 702, { label: 'com.plot-pm.fleetd', serves: '/repos/new', installed: '/inst/new' })), r.out);
});

test('processes: a command string that names an artifact is not a Plot process', () => {
  const { status } = procSandbox('procs-decoys');
  const cwd = { ...SENTINEL_CWD };
  const decoys = [
    `bash -c 'sleep 45; : /x/${BOARD} x'`,
    `zsh -c 'sleep 45; : /x/${REGD}'`,
    `node -e "require('/x/${BOARD}')"`,
    `grep ${BOARD.split('/').pop()}`,
    `bash -c 'sleep 45; : /opt/App Support/${SCAN}'`,
    `bash -lc 'sleep 45; /x/${SCAN}'`,
    `/bin/bash -ec : /x/${SCAN}`,
    `sh -xc : /x/${SCAN}`,
    `node -pe require('/x/${BOARD}')`,
    `node --eval=require('/x/${BOARD}') x`,
    `node --print /x/${BOARD}`,
    `node /x/${BOARD}.bak`,
    `node -e require('/x/${BOARD}')`,
    `node /x/${BOARD}')`,
    `sudo bash /x/${SCAN}`,
    // Only the `-e`/`-p` rule excludes these: the artifact name ends the args.
    `node -e 1 /x/${BOARD}`,
    `node -pe 1 /x/${BOARD}`,
    `node --eval 1 /x/${BOARD}`,
  ];
  const ps = [SENTINEL, ...decoys.map((args, i) => [700 + i, 40, 501, args])];
  decoys.forEach((_, i) => { cwd[700 + i] = '/repos/x'; });
  const r = status({ ps, cwd });
  assert.match(r.block, /pid 900/, 'the sentinel board is missing, so the block proves nothing');
  assert.doesNotMatch(r.block, /pid 7\d\d/, r.out);
  assert.doesNotMatch(r.block, /scans/, `a decoy counted as a scan:\n${r.out}`);
});

test('processes: options are read as options, never as the artifact path', () => {
  const { status } = procSandbox('procs-options');
  const r = status({
    ps: [
      [801, 1, 501, `node --max-old-space-size 4096 /x/${BOARD}`],
      [802, 40, 501, `bash -o pipefail /y/${SCAN}`],
      [803, 40, 501, `bash --norc /z/${SCAN}`],
    ],
    cwd: { 801: '/repos/o', 802: '/repos/o', 803: '/repos/o' },
  });
  assert.ok(r.block.includes(row('board', 801, { serves: '/repos/o', installed: '/x' })), r.out);
  assert.ok(r.block.includes('  scans       1 in flight, 0 orphaned\n    serves:     /repos/o\n    installed:  /y\n'), r.out);
  // A long option does not trip the single-dash `c` rule.
  assert.ok(r.block.includes('  scans       1 in flight, 0 orphaned\n    serves:     /repos/o\n    installed:  /z\n'), r.out);
});

test('processes: an interpreter path holding a space must name an executable file', () => {
  const { box, status } = procSandbox('procs-spaced-node');
  const interp = path.join(box, 'Library', 'Application Support', 'fnm', 'node-versions', 'v24', 'installation', 'bin', 'node');
  const spec = () => ({
    ps: [SENTINEL, [810, 1, 501, `${interp} /x/${REGD} --start-agents`],
      [811, 40, 501, `/bin/zsh -c cd x; /bin/bash /x/${SCAN} --json`]],
    cwd: { ...SENTINEL_CWD, 810: '/repos/s', 811: '/repos/s' },
    list: [[810, 'com.plot-pm.registryd.fnm']],
  });
  fs.mkdirSync(path.dirname(interp), { recursive: true });
  fs.writeFileSync(interp, '#!/bin/sh\n');
  fs.chmodSync(interp, 0o755);
  const found = status(spec());
  assert.ok(found.block.includes(row('supervisor', 810, { label: 'com.plot-pm.registryd.fnm', serves: '/repos/s', installed: '/x' })), found.out);
  // The widened argv[0] match lands inside the zsh command string, which names no file.
  assert.doesNotMatch(found.block, /pid 811|scans/, found.out);

  fs.rmSync(interp);
  const gone = status(spec());
  assert.match(gone.block, /pid 900/);
  assert.doesNotMatch(gone.block, /pid 810/, 'a deleted spaced interpreter was found — the stated limit moved');

  fs.mkdirSync(interp);
  const dir = status(spec());
  assert.match(dir.block, /pid 900/);
  assert.doesNotMatch(dir.block, /pid 810/, 'a directory at the interpreter path passed the check');

  const nowhere = status({ ...spec(), ps: [SENTINEL, [810, 1, 501, `/no such/dir/bin/node /x/${REGD}`]] });
  assert.match(nowhere.block, /pid 900/);
  assert.doesNotMatch(nowhere.block, /pid 810/, 'an interpreter path naming no file was found');
});

test('processes: --status executes nothing read from another process', () => {
  const { box, status } = procSandbox('procs-safety');
  const pwned = path.join(box, 'pwned');
  const r = status({
    ps: [
      [820, 40, 501, `/bin/zsh -c x$(touch ${pwned}) /bin/bash /x/${SCAN}`],
      [821, 40, 501, `/bin/zsh -c x;touch ${pwned}; /bin/bash /x/${SCAN}`],
      [822, 40, 501, `/bin/zsh -c x\`touch ${pwned}\` /bin/bash /x/${SCAN}`],
      [823, 40, 501, `/bin/zsh -c x$(( $(touch ${pwned}) )) /bin/bash /x/${SCAN}`],
      [824, 1, 501, `node /x/${BOARD}`],
    ],
    // The cwd is read from another process too, and is data like the argv.
    cwd: { 820: '/r', 821: '/r', 822: '/r', 823: '/r', 824: `/r/$(touch ${pwned})` },
  });
  assert.equal(fs.existsSync(pwned), false, `--status ran text from another process:\n${r.out}`);
  assert.doesNotMatch(r.block, /pid 82[0-3]|scans/, r.out);
  assert.ok(r.block.includes(`    serves:     /r/$(touch ${pwned})\n`), r.out);
});

test('processes: a scan is attributed by its cwd and its resolved installation', () => {
  const { box, status } = procSandbox('procs-install');
  const scripts = path.join(box, 'inst', 'skills', 'plot', 'scripts');
  const r = status({
    ps: [
      [830, 40, 501, 'bash plot-fleet-scan.sh'],
      [831, 40, 501, 'bash plot-fleet-scan.sh --json'],
      [832, 40, 501, `bash ${SCAN} --json`],
      [833, 40, 501, `node ${BOARD}`],
    ],
    cwd: { 830: '/c', 831: scripts, 832: '/repos/other' },
    users: { 501: 'op' },
  });
  // A bare name resolves to a file, not an installation.
  assert.ok(r.block.includes('  scans       1 in flight, 0 orphaned\n    serves:     /c\n    installed:  cannot determine\n'), r.out);
  assert.ok(r.block.includes(`  scans       1 in flight, 0 orphaned\n    serves:     ${scripts}\n    installed:  ${path.join(box, 'inst')}\n`), r.out);
  assert.ok(r.block.includes('  scans       1 in flight, 0 orphaned\n    serves:     /repos/other\n    installed:  /repos/other\n'), r.out);
  // A relative path with no readable cwd names no installation.
  assert.ok(r.block.includes(row('board', 833, { serves: 'cannot determine (owner op)', installed: 'cannot determine' })), r.out);
});

test('processes: one scan is one scan, and a scan whose parent exited is orphaned', () => {
  const { root, status } = procSandbox('procs-orphans');
  const r = status({
    ps: [
      [840, 1, 501, `node /i/${BOARD}`],
      [841, 840, 501, `bash /i/${SCAN} --stream`],
      [842, 841, 501, `bash /i/${SCAN} --stream`],
      [843, 841, 501, `bash /i/${SCAN} --stream`],
      [844, 843, 501, `bash /i/${SCAN} --stream`],
      [845, 1, 501, `bash /i/${SCAN} --stream`],
      [846, 845, 501, `bash /i/${SCAN} --stream`],
    ],
    cwd: { 840: root, 841: root, 845: root },
  });
  assert.equal(r.status, 0);
  assert.ok(r.block.includes('  scans       1 in flight, 1 orphaned\n    serves:     THIS repository\n    installed:  /i\n'), r.out);
  assert.doesNotMatch(r.block, /parent|timed out|board died/i, 'the block claims why a parent exited');
});

test('processes: an unreadable cwd prints cannot determine with the owner', () => {
  const { status } = procSandbox('procs-owner');
  const r = status({
    ps: [[850, 1, 1234, `node /i/${BOARD}`]],
    users: { 1234: 'twelvecharsx' },
  });
  assert.ok(r.block.includes(row('board', 850, { serves: 'cannot determine (owner twelvecharsx)', installed: '/i' })), r.out);
});

test('processes: nothing to report leaves the output byte-identical', () => {
  const { root, home, status } = procSandbox('procs-silent');
  const baseline = status();
  const own = [4242, 1, 501, `node ${root}/${REGD}`];
  const market = `${home}/.claude/plugins/marketplaces/plot-marketplace`;
  for (const [name, spec] of Object.entries({
    'the supervisor alone': { ps: [own], cwd: { 4242: root } },
    'a board and one in-flight scan': {
      ps: [own, [860, 40, 501, `node --watch ${BOARD}`], [861, 860, 501, `node ${BOARD}`],
        [862, 861, 501, `bash ${SCAN} --stream`], [863, 862, 501, `bash ${SCAN} --stream`]],
      cwd: { 4242: root, 860: root, 861: root, 862: root, 863: root },
    },
    // THE DECIDED SILENT CASE: an adopting repository's board always runs from
    // a plugin installation, so keying silence on the installation would print
    // on every adopting machine.
    'a foreign installation serving this checkout': {
      ps: [own, [870, 1, 501, `node ${market}/${BOARD}`]],
      cwd: { 4242: root, 870: root },
    },
  })) {
    const r = status(spec);
    assert.equal(r.out, baseline.out, `${name}: the output changed`);
    assert.equal(r.status, baseline.status, `${name}: the exit code changed`);
  }
});

test('processes: the Linux arm reads a live process cwd through /proc', { skip: process.platform !== 'linux' }, async () => {
  const { box, status } = procSandbox('procs-proc', { kernel: 'Linux' });
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(box, 'cwd-')));
  const { spawn } = await import('node:child_process');
  const sleeper = spawn('sleep', ['30'], { cwd: dir, stdio: 'ignore' });
  try {
    const r = status({
      // The sleeper's parent is no Plot process: under pid 1 listed as a board,
      // the top-level rule would fold it into that board.
      ps: [[sleeper.pid, 40, 501, `node /i/${BOARD}`], [1, 0, 0, `node /j/${BOARD}`]],
    });
    assert.ok(r.block.includes(row('board', sleeper.pid, { serves: dir, installed: '/i' })), r.out);
    // Pid 1 is root's, and the runner is not root.
    assert.ok(r.block.includes(row('board', 1, { serves: 'cannot determine (owner root)', installed: '/j' })), r.out);
  } finally {
    sleeper.kill();
  }
});

/**
 * A `/proc`-shaped fixture for `PLOT_PROC_ROOT`: `<root>/<pid>/cwd` as a
 * symlink and `<root>/<pid>/cgroup` as a file.
 */
const procRoot = (box, entries) => {
  const root = fs.mkdtempSync(path.join(box, 'proc-'));
  for (const [pid, { cwd, cgroup }] of Object.entries(entries)) {
    fs.mkdirSync(path.join(root, pid));
    if (cwd) fs.symlinkSync(cwd, path.join(root, pid, 'cwd'));
    if (cgroup !== undefined) fs.writeFileSync(path.join(root, pid, 'cgroup'), cgroup);
  }
  return root;
};

test('processes: the Linux arm names a unit from the cgroup v2 line, and orphans under systemd --user', () => {
  const { box, status } = procSandbox('procs-unit', { kernel: 'Linux' });
  const proc = procRoot(box, {
    880: { cwd: '/repos/e', cgroup: '0::/user.slice/user-1001.slice/user@1001.service/app.slice/plot-registryd-ewz.service\n' },
    881: { cwd: '/repos/e', cgroup: '12:pids:/user.slice\n1:name=systemd:/user.slice/plot-registryd-v1.service\n' },
    882: { cwd: '/repos/e', cgroup: '0::/user.slice/user-1001.slice/user@1001.service/app.slice\n' },
    884: { cwd: '/repos/e' },
  });
  const r = status({
    ps: [
      [880, 1, 1001, `node /i/${REGD}`],
      [881, 1, 1001, `node /i/${REGD}`],
      [882, 1, 1001, `node /i/${REGD}`],
      [883, 1, 1001, '/usr/lib/systemd/systemd --user'],
      [884, 883, 1001, `bash /i/${SCAN}`],
    ],
  }, { PLOT_PROC_ROOT: proc });
  assert.ok(r.block.includes(row('supervisor', 880, { label: 'unit plot-registryd-ewz', serves: '/repos/e', installed: '/i' })), r.out);
  assert.ok(r.block.includes(row('supervisor', 881, { serves: '/repos/e', installed: '/i' })), 'a cgroup v1 line named a unit');
  assert.ok(r.block.includes(row('supervisor', 882, { serves: '/repos/e', installed: '/i' })), 'a non-.service segment named a unit');
  assert.ok(r.block.includes('  scans       0 in flight, 1 orphaned\n    serves:     /repos/e\n'), r.out);
});

test('processes: the arm follows uname, not platform(), so a host with no init system still prints', () => {
  // `platform()` answers `none` on a Linux host with no `systemctl`, and a
  // board runs there. A PATH is built that holds every command but the two
  // init systems, because the runner's own `/usr/bin/systemctl` would
  // otherwise answer.
  const { root, box, ctl, fleetLabel, guardBin } = sandbox('procs-uname');
  const only = path.join(box, 'only-bin');
  fs.mkdirSync(only);
  const uname = stubPlatform(box, { kernel: 'Linux' });
  for (const name of ['uname', 'ps', 'lsof', 'id']) fs.copyFileSync(path.join(uname, name), path.join(only, name));
  for (const name of ['uname', 'ps', 'lsof', 'id']) fs.chmodSync(path.join(only, name), 0o755);
  for (const d of process.env.PATH.split(':')) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      if (n === 'systemctl' || n === 'launchctl' || fs.existsSync(path.join(only, n))) continue;
      try { fs.symlinkSync(path.join(d, n), path.join(only, n)); } catch { /* a name seen twice */ }
    }
  }
  const proc = procRoot(box, { 890: { cwd: '/repos/n' } });
  const procs = writeProcs(fs.mkdtempSync(path.join(box, 'procs-')), { ps: [[890, 1, 501, `node /i/${BOARD}`]] });
  const r = run(ctl, ['--status'], root, guardBin, {
    HOME: fakeHome(box, { label: fleetLabel }),
    PLOT_FLEET_LABEL: fleetLabel,
    PLOT_TEST_PROCS: procs,
    PLOT_PROC_ROOT: proc,
    PATH: withHarness(box, only),
  });
  assert.match(r.out, /^platform: none$/m, r.out);
  assert.equal(r.status, 1, 'the block changed the exit code');
  assert.ok(r.out.includes(row('board', 890, { serves: '/repos/n', installed: '/i' })), r.out);
});
