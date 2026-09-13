// Contract test for the correction path in
// skills/plot/scripts/plot-worker-loop.sh — a failing build handed back to the
// agent that pushed it.
//
// This is the `A failed build becomes a correction` wave of
// docs/plans/2026-09-12-a-failed-gate-becomes-a-correction.md.
//
// THE DEFECT THIS SLICE CLOSES: `plot-build-monitor.sh` detects a failing run
// and publishes `build failed` with the run URL, the head sha and the
// conclusion. Consumers of that finding on the estate were NONE — CI's verdict
// was measured, published, and dropped, and the only correction path was a
// person reading a marker.
//
// THE FUNCTIONS ARE EXERCISED DIRECTLY, sourced out of the loop under
// `PLOT_WORKER_LOOP_SOURCED` — `marker-writer.test.mjs` and `deskreset.test.mjs`
// state the idiom. Spawning a loop to observe a `grep` and a `printf` would
// spend a multi-second fixture on two pure functions, and the loop's own
// end-to-end behaviour is `workerloop.test.mjs`'s subject.
//
// THE MONITOR'S REAL LINES ARE USED WHEREVER THE SHAPE MATTERS, driven out of
// `plot-build-monitor.sh` itself with `PLOT_MONITOR_NO_MAIN=1`. The reader
// parses the sha out of the finding's `evidence` sentence, because `publish`
// writes seven fields and none of them is the commit — so a test against a
// hand-written fixture would keep passing if that sentence changed and the
// superseded-sha discard silently stopped working. Driving both halves makes
// the pair a contract instead of two independent guesses.
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
const loop = path.join(scripts, 'plot-worker-loop.sh');
const monitor = path.join(scripts, 'plot-build-monitor.sh');

/** A desk: a real git repo, because the reader asks git for the branch head. */
const desk = (commits = 1) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-corr-'));
  const git = (...args) => execFileSync('git', ['-C', wt, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  for (let i = 0; i < commits; i += 1) {
    fs.writeFileSync(path.join(wt, `f${i}`), `${i}`);
    git('add', '-A');
    git('commit', '-q', '-m', `c${i}`);
  }
  return wt;
};

const headSha = (wt) =>
  execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

/**
 * Ask the loop's reader what it makes of a desk's findings file.
 *
 * Returns `{ owed, evidence }` — the exit status as a boolean and whatever the
 * function printed. The two channels are the function's own contract:
 * `session_handle` next door uses the same shape, and the caller writes
 * `if text=$(build_says_failed)`.
 */
const ask = (wt, lines) => {
  const file = path.join(wt, '.plot-worker.monitor.build.jsonl');
  if (lines !== null) fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
  //
  // THE FUNCTION'S EXISTENCE IS ASSERTED BEFORE ITS ANSWER IS READ, and that is
  // not defensive noise. `build_says_failed` sits above the
  // `PLOT_WORKER_LOOP_SOURCED` guard precisely so it can be driven here — but
  // an undefined function exits 127, which is non-zero, which this helper would
  // otherwise report as *no correction owed*. Measured while building this
  // slice: with the function below the guard, eight discard tests passed
  // against an implementation that had never been defined. A discard test that
  // cannot tell a refusal from an absence asserts nothing.
  const script = `
    PLOT_WORKER_LOOP_SOURCED=1
    . ${JSON.stringify(loop)}
    PLOT_WORKTREE=${JSON.stringify(wt)}
    command -v build_says_failed >/dev/null 2>&1 || { printf 'UNDEFINED\\n'; exit 0; }
    if out=$(build_says_failed); then printf 'OWED\\n%s' "$out"; else printf 'NOTHING\\n%s' "$out"; fi
  `;
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', timeout: 60_000 });
  const [verdict, ...rest] = out.split('\n');
  assert.notEqual(verdict, 'UNDEFINED', 'build_says_failed must be sourceable, or every discard below is vacuous');
  return { owed: verdict === 'OWED', evidence: rest.join('\n') };
};

/**
 * The BuildMonitor's OWN lines for a given run, driven out of the real monitor.
 *
 * One pass per entry in `runs`; each is the JSON the host port hands back. The
 * monitor publishes on a change of answer-about-a-commit, so a failed run
 * followed by a passed one for a NEW sha produces both lines — which is the
 * two-line file the last-matching-line rule exists for.
 */
const publishedBy = (runs) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-corr-mon-'));
  const file = path.join(dir, 'findings.jsonl');
  const arms = runs
    .map((r, i) => `  ${i}) printf '%s' ${JSON.stringify(JSON.stringify(r))} ;;`)
    .join('\n');
  const script = `
    PLOT_MONITOR_NO_MAIN=1
    PLOT_MONITOR_FILE=${JSON.stringify(file)}
    PLOT_BRANCH=feature/x
    . ${JSON.stringify(monitor)}
    findings=${JSON.stringify(file)}
    branch=feature/x
    _pass=0
    monitor_head_sha() { printf '%s' "$_head"; }
    monitor_run_for_sha() {
      case "$_pass" in
${arms}
      esac
    }
    ${runs.map((r, i) => `_pass=${i}; _head=${JSON.stringify(r.sha)}; monitor_pass`).join('\n    ')}
  `;
  execFileSync('bash', ['-c', script], { encoding: 'utf8', timeout: 60_000 });
  const lines = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '')
    : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return lines;
};

// ---------------------------------------------------------------------------
// THE FOUR DISCARDS
// ---------------------------------------------------------------------------

test('a build failure about the branch head is a correction, with the monitor evidence verbatim', () => {
  const wt = desk();
  const sha = headSha(wt);
  const [line] = publishedBy([
    { sha, status: 'completed', conclusion: 'failure', url: 'https://ci/run/1' },
  ]);
  assert.ok(line, 'the monitor published a finding');

  const { owed, evidence } = ask(wt, [line]);
  assert.equal(owed, true, 'a failing build for the head is owed a correction');
  assert.equal(
    evidence,
    `the run at https://ci/run/1 for ${sha} concluded failure`,
    'the monitor’s own sentence is passed through, not rebuilt',
  );
  fs.rmSync(wt, { recursive: true, force: true });
});

test('a `build failed` line followed by `build passed` produces no correction', () => {
  // THE SINGLE MOST LIKELY DEFECT. The monitor publishes only on a CHANGE of
  // answer-about-a-commit and never withdraws one, so a desk that failed and
  // then passed carries both words forever in one file. Grepping the file would
  // correct an agent whose build is already green.
  //
  // BOTH LINES ARE ABOUT THE SAME SHA — THE CURRENT HEAD — AND THAT IS WHAT
  // MAKES THE TEST DISCRIMINATING. Measured while building this slice: a first
  // fixture put the failure on `HEAD~1` and the pass on the head, and a mutant
  // reading the FIRST matching line survived it — the superseded-sha discard
  // refused that line for its own reason, so two rules produced one answer and
  // the test could not say which fired. With one sha, the last-line rule is the
  // only thing that can discard.
  //
  // THE FILE IS HAND-WRITTEN HERE, deliberately, where the fixtures above are
  // driven out of the real monitor. The monitor's `settled_shas` would not emit
  // this pair in one run — and the reader must not depend on that, because a
  // restarted monitor re-derives `settled_shas` from empty and publishes about
  // a sha it had already answered. The reader's rule has to hold on the file as
  // it can actually appear on disk.
  const wt = desk();
  const sha = headSha(wt);
  const line = (finding, url, conclusion) =>
    `{"monitor":"BuildMonitor","branch":"feature/x","worktree":"${wt}",`
    + `"finding":"${finding}","since":"2026-09-12T00:00:00Z",`
    + `"evidence":"the run at ${url} for ${sha} concluded ${conclusion}",`
    + `"measuredAt":"2026-09-12T00:00:00Z"}`;

  const failedFirst = [line('build failed', 'https://ci/run/1', 'failure'), line('build passed', 'https://ci/run/2', 'success')];
  assert.equal(ask(wt, failedFirst).owed, false, 'the LAST matching line decides, never any line');

  // AND THE ORDER IS LOAD-BEARING BOTH WAYS. The same two lines reversed — a
  // pass, then a failure on a re-run of the same commit — IS a correction, so
  // this pins that the rule reads the last line rather than just preferring
  // `build passed` wherever it appears.
  const passedFirst = [line('build passed', 'https://ci/run/2', 'success'), line('build failed', 'https://ci/run/3', 'failure')];
  assert.equal(ask(wt, passedFirst).owed, true, 'a failure published after a pass is still owed');
  fs.rmSync(wt, { recursive: true, force: true });
});

test('a finding whose sha is not the branch head produces no correction', () => {
  // A failure about a sha the agent has already replaced is answered by work
  // that is already done — the inverse of the monitor's own `head moved`.
  const wt = desk(2);
  const older = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD~1'], {
    encoding: 'utf8',
  }).trim();
  const [line] = publishedBy([
    { sha: older, status: 'completed', conclusion: 'failure', url: 'https://ci/run/1' },
  ]);

  assert.equal(ask(wt, [line]).owed, false, 'a superseded sha is discarded, not delivered');
  fs.rmSync(wt, { recursive: true, force: true });
});

test('a line from another monitor produces no correction', () => {
  // The AgentMonitor and the WorkerMonitor write beside this file under the same
  // `.plot-worker.monitor.` prefix with different vocabularies. Taking one
  // monitor's finding as a verdict about another's subject is the Machine/
  // Registry confusion CLAUDE.md's split exists to prevent.
  const wt = desk();
  const sha = headSha(wt);
  const foreign = (name) =>
    `{"monitor":"${name}","branch":"feature/x","worktree":"${wt}",`
    + `"finding":"build failed","since":"2026-09-12T00:00:00Z",`
    + `"evidence":"the run at https://ci/run/9 for ${sha} concluded failure",`
    + `"measuredAt":"2026-09-12T00:00:00Z"}`;

  for (const name of ['WorkerMonitor', 'AgentMonitor']) {
    assert.equal(ask(wt, [foreign(name)]).owed, false, `${name} is not the BuildMonitor`);
  }
  fs.rmSync(wt, { recursive: true, force: true });
});

test('a finding file that does not exist is not a passing build, and is not a correction', () => {
  const wt = desk();
  assert.equal(ask(wt, null).owed, false, 'no reading at all means nothing is owed');
  fs.rmSync(wt, { recursive: true, force: true });
});

test('an unreadable sha in the evidence still delivers', () => {
  // THE FAILING DIRECTION MATTERS. Discarding on an unreadable reading would
  // drop every correction the moment the monitor's sentence changed shape;
  // delivering one costs a correction against a budget that ends in a person
  // either way.
  const wt = desk();
  const line =
    `{"monitor":"BuildMonitor","branch":"feature/x","worktree":"${wt}",`
    + `"finding":"build failed","since":"2026-09-12T00:00:00Z",`
    + `"evidence":"the build broke and nobody wrote down which commit",`
    + `"measuredAt":"2026-09-12T00:00:00Z"}`;
  const { owed, evidence } = ask(wt, [line]);
  assert.equal(owed, true, 'an unparseable sha is not evidence the failure is stale');
  assert.equal(evidence, 'the build broke and nobody wrote down which commit');
  fs.rmSync(wt, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// THE BUDGET
// ---------------------------------------------------------------------------

/** Read the budget the loop resolved, with the env seam set or unset. */
const budget = (env) => {
  const script = `
    PLOT_WORKER_LOOP_SOURCED=1
    . ${JSON.stringify(loop)}
    printf '%s' "$CORRECTION_BUDGET"
  `;
  return execFileSync('bash', ['-c', script], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: repo,
    env: { ...process.env, ...env },
  });
};

test('the budget is read from config with a default of two, and a project may set another number', () => {
  assert.equal(budget({ PLOT_CORRECTION_BUDGET: '' }), '2', 'this repo declares the default');
  assert.equal(budget({ PLOT_CORRECTION_BUDGET: '5' }), '5', 'a project gets the number it set');
  assert.equal(budget({ PLOT_CORRECTION_BUDGET: 'lots' }), '2', 'a non-numeric value falls back');
  assert.equal(budget({ PLOT_CORRECTION_BUDGET: '0' }), '0', '0 is preserved — block on the first failure');
});

test('the correction counter is its own manifest field, not `attempts`', () => {
  // `attempts` already answers the supervisor's budget (`rules/supervision.ts`)
  // and the start budget, whose default is three against this one's two. A
  // shared counter would let a spent START budget pre-consume the CORRECTION
  // budget: an agent whose prompt failed twice and then ran would reach its
  // first failing build with no corrections left.
  const wt = desk();
  const manifest = path.join(wt, 'agent.json');
  fs.writeFileSync(manifest, JSON.stringify({ attempts: 2, relaunches: 7 }, null, 2));

  const read = () => {
    const script = `
      PLOT_WORKER_LOOP_SOURCED=1
      . ${JSON.stringify(loop)}
      printf '%s' "$(manifest_corrections ${JSON.stringify(manifest)})"
    `;
    return execFileSync('bash', ['-c', script], { encoding: 'utf8', timeout: 60_000 });
  };
  const raise = () => {
    const script = `
      PLOT_WORKER_LOOP_SOURCED=1
      . ${JSON.stringify(loop)}
      raise_manifest_corrections ${JSON.stringify(manifest)}
    `;
    execFileSync('bash', ['-c', script], { encoding: 'utf8', timeout: 60_000 });
  };

  assert.equal(read(), '0', 'a manifest with `attempts: 2` is owed no corrections yet');
  raise();
  const after = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  assert.equal(after.correctionAttempts, 1, 'the correction is counted in its own field');
  assert.equal(after.attempts, 2, '`attempts` is untouched — the start budget keeps its own');
  assert.equal(after.relaunches, 7, '`relaunches` stays a person’s record');
  assert.equal(read(), '1');
  fs.rmSync(wt, { recursive: true, force: true });
});

test('an absent or unreadable manifest reads zero corrections', () => {
  // ABSENT IS NOT FALSE, the permissive direction on purpose: a manifest that
  // cannot be read is not evidence a correction spin is under way. A counter
  // that cannot be read also cannot be raised, so the budget still ends the loop.
  const wt = desk();
  const broken = path.join(wt, 'broken.json');
  fs.writeFileSync(broken, '{not json');
  const read = (p) => {
    const script = `
      PLOT_WORKER_LOOP_SOURCED=1
      . ${JSON.stringify(loop)}
      printf '%s' "$(manifest_corrections ${JSON.stringify(p)})"
    `;
    return execFileSync('bash', ['-c', script], { encoding: 'utf8', timeout: 60_000 });
  };
  assert.equal(read(path.join(wt, 'nope.json')), '0', 'absent reads zero');
  assert.equal(read(broken), '0', 'unreadable reads zero');
  fs.rmSync(wt, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// THE CORRECTION FILE AND THE MARKER
// ---------------------------------------------------------------------------

test('a correction is appended, so the account of what was tried survives the second one', () => {
  // THE OPPOSITE OF `write_blocked_marker`'s no-overwrite guard, and the
  // inversion is the point: the marker protects a question a PERSON must
  // answer, and this file is the account the marker points at. A second
  // correction that replaced the first would say one attempt was made where the
  // budget spent two.
  const wt = desk();
  const write = (text, attempt, max) => {
    const script = `
      PLOT_WORKER_LOOP_SOURCED=1
      . ${JSON.stringify(loop)}
      write_correction ${JSON.stringify(wt)} feature/x "$1" ${attempt} ${max}
    `;
    execFileSync('bash', ['-c', script, 'bash', text], { encoding: 'utf8', timeout: 60_000 });
  };
  write('the run at https://ci/run/1 for abc concluded failure', 1, 2);
  write('the run at https://ci/run/2 for def concluded timed_out', 2, 2);

  const text = fs.readFileSync(path.join(wt, 'PLOT-CORRECTION.md'), 'utf8');
  assert.match(text, /Correction 1 of 2/, 'the first correction is still there');
  assert.match(text, /Correction 2 of 2/, 'the second was appended');
  assert.match(text, /https:\/\/ci\/run\/1/, 'the first failure text survives verbatim');
  assert.match(text, /concluded timed_out/, 'the second failure text is verbatim too');
  assert.ok(
    text.indexOf('Correction 1') < text.indexOf('Correction 2'),
    'newest last, as the marker tells a person to read it',
  );
  fs.rmSync(wt, { recursive: true, force: true });
});

test('the correction file does not match the `PLOT-BLOCKED*` glob the fleet reads', () => {
  // A correction owes a person NOTHING — it is the agent's to answer.
  // `plot-worker-state.sh`, `plot-reap.sh` and `plot-fleet-scan.sh` all read the
  // marker prefix as *this desk owes a person an answer*, so a correction file
  // matching that glob would make every corrected desk read as blocked, stop the
  // reaper, and stall the fleet on work being fixed automatically.
  const script = `
    PLOT_WORKER_LOOP_SOURCED=1
    . ${JSON.stringify(loop)}
    printf '%s' "$(correction_file_name)"
  `;
  const name = execFileSync('bash', ['-c', script], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(name, 'PLOT-CORRECTION.md');
  assert.ok(!name.startsWith('PLOT-BLOCKED'), 'it is not read as a marker by anything');
});

test('the spent budget writes a marker through write_blocked_marker, and never over an existing one', () => {
  // `write_blocked_marker` already refuses to overwrite: a marker in the tree is
  // an agent's own question to a person, and replacing it with Plot's would
  // answer a question nobody asked. This pins that the correction path goes
  // THROUGH it rather than writing the file itself.
  const wt = desk();
  const own = 'PLOT-BLOCKED: I need a credential nobody gave me.\n';
  fs.writeFileSync(path.join(wt, 'PLOT-BLOCKED.md'), own);
  const script = `
    PLOT_WORKER_LOOP_SOURCED=1
    . ${JSON.stringify(loop)}
    PLOT_BRANCH=feature/x
    PLOT_MANIFEST_FILE=''
    write_blocked_marker ${JSON.stringify(wt)} "$1"
  `;
  execFileSync('bash', ['-c', script, 'bash', 'PLOT-BLOCKED: the build kept failing.'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(
    fs.readFileSync(path.join(wt, 'PLOT-BLOCKED.md'), 'utf8'),
    own,
    'the agent’s own question is untouched',
  );
  fs.rmSync(wt, { recursive: true, force: true });
});
