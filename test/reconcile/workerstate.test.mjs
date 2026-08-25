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
import { execFileSync, spawn } from 'node:child_process';
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
    /** Put a file in the worktree, or remove it when content is null. */
    file(name, content) {
      const f = path.join(this.wt, name);
      if (content === null) fs.rmSync(f, { force: true });
      else fs.writeFileSync(f, content);
    },
    /** Commit everything in the worktree without pushing it. */
    commitLocally(message) {
      git(this.wt, 'add', '-A');
      git(this.wt, 'commit', '-qm', message);
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

// THE FUNCTION ITSELF, sourced rather than driven through a consumer. The
// table test above goes through `plot-dispatch --status` and the scan, and
// both hold the PR fact at arm's length — the scan runs `--offline` here by
// design, so neither can ever pass `pr`. This calls the classifier directly,
// which is the only way to vary the one input the consumers supply for you.
const wstate = path.join(scripts, 'plot-worker-state.sh');

/** The raw "state\tpid\tcode" triple for a worktree and a PR fact. */
function rawTriple(wt, hasPr) {
  return execFileSync('bash', ['-c',
    `source ${JSON.stringify(wstate)}; plot_worker_state ${JSON.stringify(wt)} ${JSON.stringify(hasPr)}`,
  ], { encoding: 'utf8', timeout: 30_000 });
}

/** Just the state word. */
function rawState(wt, hasPr) {
  return rawTriple(wt, hasPr).split('\t')[0].trim();
}

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


// ---------------------------------------------------------------------------
// Wave 2: the task states — `waiting` and `stalled`
// ---------------------------------------------------------------------------
//
// The six states above answer "how did the PROCESS end?". These two answer
// "did the TASK finish?", and the whole defect is that the first cannot stand
// in for the second: measured across seven worktrees in a four-agent fleet run,
// EVERY worker exited 0 — including two that stopped mid-task. All three landed
// on `finished`, whose move is *review it*, and two of them needed an answer.
//
// So every case below plants a CLEAN EXIT (`exit 0`) and varies only the TREE.
// That is the point: the process record is identical throughout, and any
// difference in the verdict comes from the worktree or from nowhere.

test('worker-state: a clean exit is refined by the tree, from one fixture', () => {
  const f = fixture('tasks');
  f.worker({ pid: DEAD, exit: 0 });

  // BOTH CONSUMERS AT EVERY STEP, exactly as the six-state test does. The PR
  // fact is a new PARAMETER to the shared classifier, and a parameter one
  // consumer passes and the other forgets is the same one-fact-two-verdicts
  // drift wave 1 removed — re-entering through the very seam that fixed it.
  const agree = (expected, dispatchWord, label) => {
    const s = f.scanState();
    const d = f.dispatchState();
    assert.equal(s.state, expected, `scan on ${label}:\n${JSON.stringify(s)}`);
    assert.equal(d.word, dispatchWord, `plot-dispatch on ${label}:\n${d.line}`);
  };

  // A tidy worktree: nothing on the floor, so the clean exit stands. THIS IS
  // ALSO THE DEFECT, because the fixture's own tree documents the marker: its
  // CLAUDE.md carries a `## Plot Config` and — like every real checkout of this
  // repo — the fixture repo is where the marker is described. A contents grep
  // read `waiting` here off a clean exit; a file-existence check reads
  // `finished`, because no PLOT-BLOCKED* file stands. The direct, no-ambiguity
  // form of this assertion is the `plot_worker_blocked` unit test below.
  agree('finished', 'finished', 'a clean exit over a clean tree');

  // UNCOMMITTED WORK AND NO PR — the state this wave exists to name. Note the
  // process record has not changed: same pid, same `exit 0`, different verdict.
  f.file('feature.ts', 'export const x = 1;\n');
  agree('stalled', 'stalled', 'an uncommitted source file');

  // ONLY AN EDITOR LEFTOVER IS NOT WORK. Measured 2026-08-18: a guard restarted
  // a branch over an orphaned `plot-dispatch.sh.tmp1`, 10 KB belonging to no
  // commit and no task, while the worker was making progress and had just
  // committed.
  f.file('feature.ts', null);
  f.file('plot-dispatch.sh.tmp1', 'x'.repeat(64));
  agree('finished', 'finished', 'only a .tmp1');
  f.file('plot-dispatch.sh.tmp1', null);

  // A MARKER FILE OUTRANKS WORK ON THE FLOOR, and the file is dirty here on
  // purpose: a worker that stops to ask a question has almost always left the
  // work it was doing uncommitted beside the question. Checking dirtiness first
  // would report every waiting branch `stalled` and invite a restart into the
  // same wait — measured happening twice to one branch, the second restart
  // re-running work the first had finished.
  //
  // THE MARKER IS A FILE the worker writes, not a string inside its work. The
  // dirty source file below stays, so the tree is on the floor AND carrying a
  // marker; the PLOT-BLOCKED.md file is what makes it `waiting`.
  f.file('feature.ts', 'export const x = 1;\n');
  f.file('PLOT-BLOCKED.md', 'PLOT-BLOCKED: which retry semantics did you want?\n');
  agree('waiting', 'waiting', 'a PLOT-BLOCKED file beside dirty work');

  // A DIFFERENT PLOT-BLOCKED* NAME IS STILL A MARKER. The `Worker command` does
  // not name the file, and a prefix match accepts what workers produce.
  f.file('PLOT-BLOCKED.md', null);
  f.file('PLOT-BLOCKED', 'PLOT-BLOCKED: which retry semantics did you want?\n');
  agree('waiting', 'waiting', 'a PLOT-BLOCKED file with a different extension');
  f.file('PLOT-BLOCKED', null);

  // A FILE MERELY CONTAINING THE STRING IS NOT A MARKER — the exact regression
  // this whole change exists to prevent. A brief or a doc that documents the
  // marker used to read `waiting` off a pristine checkout; now it does not,
  // because it is not a PLOT-BLOCKED* file. The source file is still dirty, so
  // the honest verdict here is `stalled`, not `waiting`.
  f.file('feature.ts', '// we write PLOT-BLOCKED: to signal a stop; TODO(you) too\n');
  agree('stalled', 'stalled', 'a file that only mentions the marker string');
  f.file('feature.ts', null);

  // COMMITTED BUT UNPUSHED IS STILL WORK ONLY THIS MACHINE HOLDS. Committing
  // clears dirtiness, so a worker that tidied up and stopped before pushing
  // would otherwise read `finished` with nobody able to see its commits.
  // Measured on the branch that fixed the other half of this: 3 commits ahead,
  // 0 dirty files, no PR.
  f.file('feature.ts', 'export const x = 1;\n');
  f.commitLocally('the work nobody else can see');
  agree('stalled', 'stalled', 'a local commit with no upstream copy');

  f.cleanup();
});

test('worker-state: the log records the question, the marker FILE records that it stands', () => {
  // THE MARKER IS A FILE, NOT A LINE IN THE LOG, and this is the assertion that
  // pins it. The log is the ONE file guaranteed to contain the marker token
  // whenever the worker mentioned writing one — a worker's final report says
  // what it left behind — so a CONTENTS search over the worktree would answer
  // `waiting` from the report of a question that was since ANSWERED.
  //
  // Measured: a restarted worker found its own question already answered in the
  // commit above it and carried on without asking again. The log still held the
  // question, and always will; only the marker FILE was deleted.
  //
  // A file-existence check makes the log-versus-tree split automatic: the log is
  // named `.plot-worker.log`, which is not a `PLOT-BLOCKED*` file, so it is
  // never mistaken for the marker. The old contents grep had to exclude it by
  // name and could regress silently if that exclusion leaned on `.gitignore`;
  // there is no such flag to forget any more.
  const f = fixture('logvtree');
  f.worker({ pid: DEAD, exit: 0 });

  f.file('.plot-worker.log',
    'I stopped and wrote a PLOT-BLOCKED: marker asking about retry semantics.\n');
  assert.equal(f.scanState().state, 'finished',
    'a question in the LOG is history — no marker file stands');

  // A rotated `.plot-worker.log.1` is not a marker either: it does not start
  // with `PLOT-BLOCKED`. The realistic case, kept.
  f.file('.plot-worker.log.1', 'PLOT-BLOCKED: an older run asked this\n');
  assert.equal(f.scanState().state, 'finished',
    "Plot's own records are never marker files");
  f.file('.plot-worker.log.1', null);

  // The same sentence, written into a PLOT-BLOCKED* FILE, IS the question.
  f.file('PLOT-BLOCKED.md', 'PLOT-BLOCKED: which retry semantics did you want?\n');
  assert.equal(f.scanState().state, 'waiting',
    'a PLOT-BLOCKED file in the tree is a question still open');

  // A file that merely NAMES the marker in its contents is not one — the exact
  // false positive this change removes. `question.md` is a document, not a
  // PLOT-BLOCKED* file, so it is NOT `waiting`. It is an untracked file, which
  // is work on the floor, so the honest verdict is `stalled` — anything but
  // `waiting`, which is the whole point: a mention no longer stops the branch.
  f.file('PLOT-BLOCKED.md', null);
  f.file('question.md', 'PLOT-BLOCKED: which retry semantics did you want?\n');
  const mention = f.scanState().state;
  assert.notEqual(mention, 'waiting',
    'a document that merely mentions the marker does not read waiting');
  assert.equal(mention, 'stalled',
    'the mention is not a marker; the untracked doc is work on the floor');

  f.cleanup();
});

test('worker-state: an open PR outranks everything the worktree still holds', () => {
  // THE PR FACT IS A PARAMETER, supplied by the caller — the scan caches one
  // host reply per branch per run behind its `--offline` gate, plot-dispatch
  // asks per branch when a person types `--status`. Neither can be driven from
  // this fixture, whose origin is a bare local repo with no host behind it, so
  // the override is asserted where it actually lives: at the classifier.
  //
  // WORTH ASSERTING SEPARATELY rather than skipping. Work that reached review
  // has left the worker's hands, so leftover local edits mean nothing there —
  // and without this arm every branch under review with a scratch file in its
  // worktree reads `stalled`, which is most of them.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wstate-pr-'));
  git(d, 'init', '-q', '-b', 'main', '.');
  git(d, 'config', 'user.email', 'test@example.invalid');
  git(d, 'config', 'user.name', 'Plot Test');
  git(d, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(d, 'a.txt'), 'hi\n');
  git(d, 'add', '-A');
  git(d, 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(d, '.plot-worker.pid'), `${DEAD}\n`);
  fs.writeFileSync(path.join(d, '.plot-worker.exit'), '0\n');

  const classify = (prFact) => execFileSync('bash', ['-c',
    `. ${JSON.stringify(shared)}; plot_worker_state ${JSON.stringify(d)} ${JSON.stringify(prFact)}`],
    { encoding: 'utf8' }).split('\t')[0];

  // Dirty AND carrying an open question — the two things that would otherwise
  // answer `stalled` and `waiting`. The PR outranks both. The marker is a FILE;
  // the dirty source file sits beside it.
  fs.writeFileSync(path.join(d, 'feature.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(d, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: still wondering\n');
  assert.equal(classify(''), 'waiting', 'without the PR fact, the tree answers');
  assert.equal(classify('pr'), 'finished', 'with an open PR, the tree is moot');

  // UNANSWERABLE IS NOT A YES, and the direction is the safe one. Offline, no
  // backend, or a host returning 503 all afternoon must not manufacture the one
  // state that tells a reader to stop looking. Anything that is not the fact
  // falls through to the local signals.
  for (const notAYes of ['', '-', 'CLOSED', 'NONE', 'maybe']) {
    assert.equal(classify(notAYes), 'waiting',
      `"${notAYes}" is not an open PR and must not read as one`);
  }

  fs.rmSync(d, { recursive: true, force: true });
});

test('worker-state: the task states are added once, not once per consumer', () => {
  // WAVE 1'S STRUCTURAL ASSERTION, EXTENDED TO WAVE 2. The states could agree
  // today while the marker match or the leftover exclusion sat in two places
  // waiting to drift — which is exactly the position wave 1 started from, and
  // the reason it went first. The marker is now a FILENAME the classifier globs
  // for rather than a token it greps; the assertion is the same in spirit — the
  // match lives with the classification, and only there.
  const bodies = {
    'plot-dispatch.sh': fs.readFileSync(dispatch, 'utf8'),
    'plot-fleet-scan.sh': fs.readFileSync(scan, 'utf8'),
  };
  const code = (s) => s.replace(/^\s*#.*$/gm, '');
  const sharedCode = code(fs.readFileSync(shared, 'utf8'));

  assert.match(sharedCode, /PLOT-BLOCKED/,
    'the marker filename Plot globs for lives with the classification');
  assert.match(sharedCode, /tmp\[0-9\]\*/,
    'so does the editor-leftover exclusion');

  for (const [name, body] of Object.entries(bodies)) {
    assert.doesNotMatch(code(body), /PLOT-BLOCKED|TODO\\\(\(you\|human\)\\\)/,
      `${name} must ask the shared classifier for the marker, not re-derive it`);
    assert.doesNotMatch(code(body), /tmp\[0-9\]\*/,
      `${name} must not carry its own copy of the leftover exclusion`);
  }

  // The scan stays READ-ONLY over the worktree record, as wave 1 pinned. The
  // new states read the tree, and reading is all they do — a `stalled` row
  // names what is on the floor and restarts nothing. Relaunching is
  // `/plot-dispatch`'s, and Manifesto Principle 1 keeps the pulse derived.
  assert.doesNotMatch(code(bodies['plot-fleet-scan.sh']), /\.plot-worker\./,
    'the read-only scan must not touch the worker record itself');
});

test('worker-state: plot_worker_blocked answers a marker FILE, not a mention', () => {
  // THE DEFECT, ASSERTED AT THE PREDICATE ITSELF, with no PR, no upstream, and
  // no dirty-work ordering in the way. Every other assertion in this file passed
  // with the bug in place; this is the one that did not. The old classifier
  // grepped file CONTENTS for the marker token and matched the 28 tracked files
  // on `main` that document the feature, so a pristine checkout read blocked
  // before any worker ran.
  //
  // Sourced and called directly under bash — the shell both callers declare.
  const blocked = (wt) => {
    try {
      execFileSync('bash', ['-c',
        `. ${JSON.stringify(shared)}; plot_worker_blocked ${JSON.stringify(wt)}`]);
      return true; // exit 0 → a person is owed an answer
    } catch {
      return false; // non-zero → not blocked
    }
  };

  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-blocked-'));

  // A tree that DOCUMENTS the marker is not blocked — the exact false positive.
  fs.writeFileSync(path.join(d, 'CLAUDE.md'),
    '- **Worker command:** ... write PLOT-BLOCKED: into a file ... TODO(you) ...\n');
  fs.writeFileSync(path.join(d, 'a-brief.md'),
    'the worker writes PLOT-BLOCKED: followed by the question\n');
  assert.equal(blocked(d), false,
    'a tree that only MENTIONS the marker is not waiting on anybody');

  // A real PLOT-BLOCKED* file at the root IS blocked, and the assertion is that
  // it is FOUND — not merely that a clean tree is not blocked, which a function
  // that always returned false would also satisfy.
  fs.writeFileSync(path.join(d, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which adapter?\n');
  assert.equal(blocked(d), true, 'a PLOT-BLOCKED file is found');

  // Any PLOT-BLOCKED* name, since the instruction does not fix one.
  fs.rmSync(path.join(d, 'PLOT-BLOCKED.md'));
  fs.writeFileSync(path.join(d, 'PLOT-BLOCKED'), 'PLOT-BLOCKED: which adapter?\n');
  assert.equal(blocked(d), true, 'a bare PLOT-BLOCKED file is found');
  fs.rmSync(path.join(d, 'PLOT-BLOCKED'));

  // Root only: a marker buried in a subdirectory is not found, mirroring the
  // decision the plan settled (prefer root over any-depth).
  fs.mkdirSync(path.join(d, 'sub'));
  fs.writeFileSync(path.join(d, 'sub', 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: buried\n');
  assert.equal(blocked(d), false, 'a marker under a subdirectory is not a root marker');

  // A missing or empty worktree path is not blocked and never errors.
  assert.equal(blocked(path.join(d, 'gone')), false, 'a missing worktree is not blocked');
  assert.equal(blocked(''), false, 'an empty worktree argument is not blocked');

  fs.rmSync(d, { recursive: true, force: true });
});

test('worker-state: a PR outranks a non-zero exit, but only about the TASK', () => {
  // THE ROW SAID "someone is on it" OVER A DELIVERED BRANCH. Measured
  // 2026-08-24 on `bug/the-agents-tab-filters-on-membership`: a worker was
  // killed (SIGTERM, exit 143) AFTER its work was complete and pushed, and PR
  // #393 was open. The board rendered `worker crashed · someone is on it` and
  // could never stop — nothing about that branch would change the exit code,
  // so the row was frozen on a claim that was false when it was written.
  //
  // The cause is structural, not a bad code: `has_pr` was consulted ONLY in
  // the `0)` arm. Every other exit code returned `failed` without ever asking
  // whether the branch had shipped. But the exit code answers a question about
  // the PROCESS, and "someone is on it" is a claim about the TASK — and those
  // two come apart exactly when a finished worker is killed.
  //
  // The fix does NOT hide the failure. `failed` is still the answer when
  // nobody can say the work landed; the PR is the one fact that outranks it,
  // and only because a PR means the work reached a reviewer.
  const f = fixture('pr-outranks');

  // Without the PR fact, a non-zero exit is `failed` — UNCHANGED. This is the
  // guard: if the fix leaked into the no-PR case it would report `finished`
  // over a genuine crash, which is the failure in the other direction.
  f.worker({ pid: DEAD, exit: 143 });
  assert.equal(rawState(f.wt, ''), 'failed',
    'with no PR, a killed worker is still a failure');
  assert.equal(rawState(f.wt, 'no'), 'failed',
    'an explicit "no PR" is still a failure');

  // With the PR fact, the TASK is finished even though the PROCESS was killed.
  assert.equal(rawState(f.wt, 'pr'), 'finished',
    'a killed worker whose branch has a PR has delivered; nobody is on it');

  // A clean exit is unaffected — the arm that already consulted the PR.
  f.worker({ pid: DEAD, exit: 0 });
  assert.equal(rawState(f.wt, 'pr'), 'finished', 'exit 0 with a PR is unchanged');

  // AND THE EXIT CODE SURVIVES. The state changes; the record does not. A
  // reader must still be able to see that this worker was killed — reporting
  // `finished` while erasing 143 would trade one false row for a silent one.
  const triple = rawTriple(f.wt, 'pr');
  f.worker({ pid: DEAD, exit: 143 });
  assert.match(rawTriple(f.wt, 'pr'), /143/,
    `the exit code is still reported alongside the state:\n${triple}`);

  f.cleanup();
});

test('worker-state: a running worker whose child works reads apart from one whose child is idle', () => {
  // ITEM 5 OF THE PLAN, and the assertion a naive implementation fails. A cue
  // that never fires and one that always fires are equally useless, so BOTH
  // arms are asserted — and the trap is the discriminator: the loop SHELL is
  // near-zero CPU in every case (it waits on its child), so an implementation
  // reading the shell's own CPU reads identical in both and passes neither.
  //
  // `plot_worker_activity` is driven directly, the one input a consumer cannot
  // vary for you — the scan only calls it beside a `running` verdict, which
  // needs a live pid this test would otherwise have to fake with `process.pid`.
  //
  // A SHORT INTERVAL keeps the test honest and quick: `PLOT_ACTIVITY_INTERVAL`
  // overrides the sample gap. A child burning a busy loop moves its CPU clock
  // within it; a sleeping child does not.
  const activity = (pid) => execFileSync('bash', ['-c',
    `. ${JSON.stringify(shared)}; PLOT_ACTIVITY_INTERVAL=0.3 plot_worker_activity ${pid}`,
    ], { encoding: 'utf8', timeout: 30_000 }).trim();

  // A shell with a BUSY grandchild — the child's clock advances across the
  // sample. Spawned detached so we hold its pid and reap it afterwards.
  const busy = spawn('sh', ['-c', 'sh -c "while :; do :; done"'], { stdio: 'ignore' });
  // A shell with an IDLE child — it sleeps, so its clock is frozen.
  const idle = spawn('sh', ['-c', 'sleep 30'], { stdio: 'ignore' });
  try {
    assert.equal(activity(busy.pid), 'working',
      'a worker whose descendant burns CPU across the interval reads `working`');
    assert.equal(activity(idle.pid), 'idle',
      'a worker whose descendants hold a frozen clock reads `idle`');
    // THE TWO DIFFER — the property item 5 pins, stated as a property so a
    // future edit that makes both read the same word fails here directly.
    assert.notEqual(activity(busy.pid), activity(idle.pid),
      'the cue MUST fire differently for a working child than for an idle one');
  } finally {
    busy.kill('SIGKILL');
    idle.kill('SIGKILL');
  }
});

test('worker-state: a pid with nothing to measure gets no cue, not a false idle', () => {
  // ITEM 7's companion. A cue is only ever read beside a `running` verdict,
  // where a live pid is already established — but a pid that names no process
  // with a CPU clock at all (a dead pid, or a bare pid with no descendants)
  // must say NOTHING rather than invent `idle`. The absence of a child is not
  // the presence of an idle one.
  const activity = (pid) => execFileSync('bash', ['-c',
    `. ${JSON.stringify(shared)}; PLOT_ACTIVITY_INTERVAL=0.1 plot_worker_activity ${pid}`,
    ], { encoding: 'utf8', timeout: 30_000 });

  assert.equal(activity(DEAD), '', 'a dead pid yields no cue');
  assert.equal(activity('x1'), '', 'a non-numeric pid yields no cue');
  assert.equal(activity(''), '', 'an empty pid yields no cue');
});
