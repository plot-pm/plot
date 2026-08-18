// Contract test for skills/plot/scripts/plot-worker-state.sh — the ONE answer
// to "is a worker running in this worktree?", shared by plot-dispatch.sh's
// `--status` and plot-fleet-scan.sh's `--json`.
//
// THIS FILE EXISTS TO HOLD THE MERGE, and it belongs to neither of the two
// suites it drives. Until 2026-08-18 the classification lived twice — once in
// each consumer — and the copies had ALREADY drifted: a non-numeric exit code
// read as `ended` in the scan and `failed (exit abc)` in plot-dispatch. Nobody
// noticed, because no test had ever asked the two the same question about the
// same worktree.
//
// So that is the question this file asks, and it asks it from ONE fixture: a
// single worktree, mutated through each of the six states, read by both
// consumers at every step. A future edit to one renderer alone fails here.
//
// The two OUTPUT SHAPES are deliberately different and must stay so — prose for
// a person (`failed 1234 (exit 3)`), tab-separated fields for a machine
// (`failed\t1234\t3`). One computation, two renderings: this test asserts the
// STATE agrees, not that the bytes match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const dispatch = path.join(scripts, 'plot-dispatch.sh');
const scan = path.join(scripts, 'plot-fleet-scan.sh');
const shared = path.join(scripts, 'plot-worker-state.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

const BRANCH = 'feature/w';

/**
 * A repo with one approved single-branch plan, fanned out to a real worktree.
 *
 * The worktree is created by plot-dispatch ITSELF rather than by `git worktree
 * add`, because the two consumers find it different ways — plot-dispatch globs
 * `plot-wt-*` beside the repo, the scan reads `git worktree list`. A worktree
 * only one of them can see would make this test pass while proving nothing.
 */
function fixture(label) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-wstate-${label}-`));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-w.md'),
    `# W\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- \`${BRANCH}\` — the work\n`);
  fs.symlinkSync('../2026-01-01-w.md', path.join(r, 'plans', 'active', 'w.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  // Fan out for real: worktree + claim, but start no worker. The worker record
  // is planted by hand below, which is how each state is reached on demand.
  execFileSync('bash', [dispatch, '--offline', '--no-start', 'w'],
    { encoding: 'utf8', cwd: r, timeout: 120_000 });
  const wt = path.join(path.dirname(r), `plot-wt-${BRANCH.replace('/', '-')}`);
  assert.ok(fs.existsSync(wt), `fan-out must have made a worktree at ${wt}`);

  return {
    repo: r,
    wt,
    /** The state word plot-dispatch --status prints for this branch. */
    dispatchState() {
      const out = execFileSync('bash', [dispatch, '--status', 'w'],
        { encoding: 'utf8', cwd: r, timeout: 120_000 });
      // The branch's OWN line: the summary footer carries every state word as a
      // counter name, so a match over the whole report finds `finished=0`.
      const line = out.split('\n').find((l) => l.includes(`${BRANCH} —`)) ?? '';
      return { line, word: (line.match(/— (\w+)/) ?? [, ''])[1] };
    },
    /** The worker triple plot-fleet-scan --json reports for this branch. */
    scanState() {
      const doc = JSON.parse(execFileSync('bash', [scan, '--offline', '--json'],
        { encoding: 'utf8', cwd: r, timeout: 120_000 }));
      const b = doc.plans[0].waves[0].branches.find((x) => x.branch === BRANCH);
      assert.ok(b, `scan must report ${BRANCH}`);
      return { state: b.worker, pid: b.worker_pid, exit: b.worker_exit };
    },
    /** Plant the worker record plot-dispatch's wrapper would have written. */
    worker({ pid, exit } = {}) {
      const pidFile = path.join(this.wt, '.plot-worker.pid');
      const exitFile = path.join(this.wt, '.plot-worker.exit');
      fs.rmSync(pidFile, { force: true });
      fs.rmSync(exitFile, { force: true });
      if (pid !== undefined) fs.writeFileSync(pidFile, `${pid}\n`);
      if (exit !== undefined) fs.writeFileSync(exitFile, `${exit}\n`);
    },
    cleanup() {
      fs.rmSync(wt, { recursive: true, force: true });
      fs.rmSync(t, { recursive: true, force: true });
    },
  };
}

// A pid that is valid, numeric, and certainly not running. The dispatch suite
// uses the same one for the same reason.
const DEAD = 2147483646;

test('worker-state: both consumers agree across every state, from one fixture', () => {
  // THE POINT OF THIS WAVE. Two readers, one worktree, one verdict each time.
  // `none` and `no worker` are the same state under two spellings — each
  // renderer names it for its own audience, and this test knows the mapping
  // rather than demanding the bytes match.
  const f = fixture('agree');

  const cases = [
    // [ label, worker record, expected shared state, expected dispatch word ]
    ['no record at all',        {},                             'none',     'no'],
    ['a live process',          { pid: process.pid },           'running',  'running'],
    ['a clean exit',            { pid: DEAD, exit: 0 },         'finished', 'finished'],
    ['a non-zero exit',         { pid: DEAD, exit: 3 },         'failed',   'failed'],
    ['no exit record',          { pid: DEAD },                  'ended',    'ended'],
    ['an empty exit record',    { pid: DEAD, exit: '' },        'ended',    'ended'],
    ['a garbled exit record',   { pid: DEAD, exit: 'abc' },     'ended',    'ended'],
    ['pid 0',                   { pid: 0 },                     'none',     'no'],
    ['a non-numeric pid',       { pid: 'x1' },                  'none',     'no'],
  ];

  for (const [label, record, expected, dispatchWord] of cases) {
    f.worker(record);
    const d = f.dispatchState();
    const s = f.scanState();
    assert.equal(s.state, expected, `scan on ${label}:\n${JSON.stringify(s)}`);
    assert.equal(d.word, dispatchWord, `plot-dispatch on ${label}:\n${d.line}`);
  }

  // THE DRIFT THIS WAVE CAUGHT, asserted on the same fixture rather than a
  // fresh one — a fan-out is the expensive part of this file, and this needs no
  // repo of its own. Before the merge the copies split here: the scan said
  // `ended`, plot-dispatch said `failed (exit abc)`. `ended` wins on the scan's
  // own stated principle — an unreadable record licenses no verdict, and
  // "failed with code abc" invents one exactly as much as "finished" would.
  f.worker({ pid: DEAD, exit: 'not-a-number' });
  assert.equal(f.scanState().state, 'ended');
  const garbled = f.dispatchState();
  assert.match(garbled.line, /ended/,
    `plot-dispatch must not invent a verdict:\n${garbled.line}`);
  assert.doesNotMatch(garbled.line, /failed/,
    'a non-numeric exit code is not a failure with that code');

  f.cleanup();
});

test('worker-state: `elsewhere` stays the scan\'s alone', () => {
  // The one state the shared classifier does not produce. It answers "this
  // machine has no worktree to look in" — a question about the worktree LIST,
  // asked before there is anything to look inside. plot-dispatch iterates
  // worktrees it globbed off disk and so can never reach it.
  const f = fixture('elsewhere');
  f.worker({ pid: DEAD, exit: 0 });
  assert.equal(f.scanState().state, 'finished', 'with a worktree, the shared answer');

  // Remove the worktree the way a teammate's machine never had one.
  execFileSync('git', ['worktree', 'remove', '--force', f.wt],
    { encoding: 'utf8', cwd: f.repo });
  assert.equal(f.scanState().state, 'elsewhere', 'without one, the scan says so');

  assert.doesNotMatch(fs.readFileSync(shared, 'utf8').replace(/^#.*$/gm, ''),
    /elsewhere/, 'the shared classifier must not learn a state only one caller has');
  f.cleanup();
});

test('worker-state: every answer carries three fields, always', () => {
  // AN INVARIANT WITH TEETH, because `cut -f` is why it matters. POSIX `cut`
  // prints a line UNCHANGED when it contains no delimiter, so `cut -f3` on a
  // bare `none` yields "none" rather than "" — the state word would land in
  // plot-dispatch's exit-code slot with no error anywhere. Every return here
  // emits two tabs, including the ones with nothing to put between them, and
  // the renderer's correctness rests on that rather than on remembering it.
  const shell = (wt) => execFileSync('bash', ['-c',
    `. ${JSON.stringify(shared)}; plot_worker_state ${JSON.stringify(wt)} | od -An -c | tr -s ' '`],
    { encoding: 'utf8' });

  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wstate-fields-'));
  const rows = [];
  const capture = () => {
    const raw = execFileSync('bash', ['-c',
      `. ${JSON.stringify(shared)}; plot_worker_state ${JSON.stringify(d)}`],
      { encoding: 'utf8' });
    rows.push(raw);
    return raw;
  };

  capture();                                                            // none
  fs.writeFileSync(path.join(d, '.plot-worker.pid'), `${DEAD}\n`);
  capture();                                                            // ended
  for (const code of ['0', '3', '', 'abc']) {
    fs.writeFileSync(path.join(d, '.plot-worker.exit'), `${code}\n`);
    capture();                                                          // the rest
  }
  fs.rmSync(path.join(d, '.plot-worker.exit'));
  fs.writeFileSync(path.join(d, '.plot-worker.pid'), '0\n');
  capture();                                                            // none again

  for (const row of rows) {
    assert.equal(row.split('\t').length, 3,
      `every row is exactly three tab-separated fields, got ${JSON.stringify(row)}`);
    assert.doesNotMatch(row, /\n/, `a row is one line, got ${JSON.stringify(row)}`);
  }
  assert.ok(shell(d).length > 0, 'and the function is reachable by sourcing alone');
  fs.rmSync(d, { recursive: true, force: true });
});

test('worker-state: the classification exists once, not once per consumer', () => {
  // The structural assertion, and the one that actually prevents the regression.
  // The states above could all agree while the logic sat in two places waiting
  // to drift again — that is precisely the position this wave started from. So
  // assert the SHAPE: exactly one `kill -0` liveness check in the fleet, and
  // both consumers sourcing the file that holds it.
  const bodies = {
    'plot-worker-state.sh': fs.readFileSync(shared, 'utf8'),
    'plot-dispatch.sh': fs.readFileSync(dispatch, 'utf8'),
    'plot-fleet-scan.sh': fs.readFileSync(scan, 'utf8'),
  };
  // Strip comments: they discuss `kill -0` at length, and rightly so.
  const code = (s) => s.replace(/^\s*#.*$/gm, '');

  assert.match(code(bodies['plot-worker-state.sh']), /kill -0/,
    'the shared classifier is where liveness is decided');
  for (const consumer of ['plot-dispatch.sh', 'plot-fleet-scan.sh']) {
    // Match `kill -0` in ANY form, not one spelling of it: a re-inlined copy
    // would use its own variable name, and a check that only knows `"$pid"`
    // waves it through. Verified by mutation — the narrow form did.
    assert.doesNotMatch(code(bodies[consumer]), /kill\s+-0/,
      `${consumer} must ask the shared classifier, not re-derive liveness`);
    assert.match(code(bodies[consumer]), /\.\s+"\$script_dir\/plot-worker-state\.sh"/,
      `${consumer} must source the shared classifier`);
  }

  // The pid file is READ by nobody but the shared classifier. plot-dispatch is
  // exempt because it WRITES it — `start_worker` records the pid it just
  // spawned, and that is the producer, not a second reader. plot-fleet-scan is
  // read-only and has no such excuse: touching the record at all would mean it
  // had started classifying again.
  assert.doesNotMatch(code(bodies['plot-fleet-scan.sh']), /\.plot-worker\./,
    'the read-only scan must not touch the worker record itself');
});
