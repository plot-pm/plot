// Contract test for the one-sample `idle` finding over a REAL desk.
//
// REPOINTED AT THE LOOP'S OWN READING (`bug/the-loop-reports-idle`). The
// WorkerMonitor process is gone; `plot_worker_idle_watch_pass` in
// `plot-worker-state.sh` is what the loop's watcher subshell calls instead,
// every `PLOT_MONITOR_INTERVAL`. The cases below are unchanged in intent —
// each still guards a measurement in the plan's Open Points — only the entry
// point moved.
//
// WHAT THE MOCKS CANNOT PROVE IS THE TREE READING ITSELF, and that is the seam
// this file exists to cover: a stubbed `plot_worker_tree_quiet_seconds` returns
// whatever number a test names, so it says nothing about whether mtimes are
// read correctly. So this builds a desk: a real repository with a real
// `origin/main` ref, a commit that touched a file, files aged with
// `touch -t`, and a transcript directory laid out the way the runtime lays one
// out. Only the pid and the CPU are stubbed, because those are the two
// readings a test cannot schedule.
//
// THE FOUR SCRATCH-DESK CASES ARE THE PLAN'S, and the third is the one that
// matters most: a desk where only `.plot-worker.*` files changed inside the
// window must still publish `idle`, because that is every desk the loop has
// ever written to.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const stateLib = path.join(scripts, 'plot-worker-state.sh');
const transcriptLib = path.join(scripts, 'plot-transcript-quiet.sh');
const manifestLib = path.join(scripts, 'plot-agent-manifest.sh');

/** The window every case is judged against — the shipped default. */
const WINDOW = 900;
/** Comfortably past the window, so no case sits on the boundary by accident. */
const OLD = 4000;

/** `touch -t` form (local time, `CCYYMMDDhhmm.SS`) for `age` seconds ago. */
const touchStamp = (age) => {
  const d = new Date(Date.now() - age * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
    `${p2(d.getHours())}${p2(d.getMinutes())}.${p2(d.getSeconds())}`;
};

/**
 * A desk the rule can be asked about: a repository with an `origin/main` ref, a
 * branch carrying one commit that touched a file, and a transcript.
 *
 * THE `origin/main` REF IS REAL because `plot_worker_has_commits` counts
 * against it and answers `unanswerable` where there is none — which withholds
 * `idle`, so a fixture without one would exercise nothing at all.
 *
 * THE COMMIT IS AGED THROUGH `GIT_COMMITTER_DATE`, not `--date`. The reading is
 * `git log -1 --format=%ct`, which is the COMMITTER's time; `--date` sets only
 * the author's, and a desk whose commit looks old to a reader and new to the
 * script reads busy forever.
 */
const buildDesk = (label, { commitAge = OLD, silence = OLD } = {}) => {
  const root = scratch(`plot-idle-${label}-`);
  const home = path.join(root, 'home');
  const desk = path.join(root, 'desk');
  fs.mkdirSync(desk, { recursive: true });

  const git = (...args) => execFileSync('git', ['-C', desk, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'idle@example.invalid');
  git('config', 'user.name', 'Plot Idle');
  git('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(desk, 'src'), { recursive: true });
  fs.writeFileSync(path.join(desk, 'src', 'seed.ts'), 'export const seed = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  // A local ref standing in for `origin/main`, which is what the real desk has
  // and what `plot_worker_has_commits` accepts.
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'bug/watched');
  // The agent's own work: a commit that TOUCHED A FILE, which is what the
  // commit condition counts. An empty claim commit does not count, by design.
  fs.writeFileSync(path.join(desk, 'src', 'work.ts'), 'export const work = 2;\n');
  git('add', '-A');
  git('commit', '-qm', 'work the agent did');

  const stamp = `@${Math.floor(Date.now() / 1000) - commitAge} +0000`;
  execFileSync('git', ['-C', desk, 'commit', '-q', '--amend', '--no-edit', '--date', stamp],
    { env: { ...process.env, GIT_COMMITTER_DATE: stamp }, stdio: 'pipe' });

  // The transcript, laid out the way the runtime lays one out: the worktree
  // path with `/` and `.` replaced by `-`, under `~/.claude/projects/`.
  const dir = path.join(home, '.claude', 'projects', desk.replace(/[/.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, 'the-slice.jsonl');
  fs.writeFileSync(transcript, '{}\n');
  execFileSync('touch', ['-t', touchStamp(silence), transcript]);

  const manifestFile = path.join(root, 'agent.json');
  fs.writeFileSync(manifestFile, JSON.stringify({
    session: 'the-slice', branch: 'bug/watched', worktree: desk, resumeId: 'the-slice',
  }, null, 2) + '\n');

  return {
    root, desk, dir, transcript, manifestFile, git,
    /** Age a path so the tree reading sees it as `age` seconds old. */
    age: (rel, age) => execFileSync('touch', ['-t', touchStamp(age), path.join(desk, rel)]),
    env: {
      PLOT_TRANSCRIPT_HOME: home,
      PLOT_WORKTREE: desk,
      PLOT_BRANCH: 'bug/watched',
      PLOT_SESSION_ID: 'the-slice',
      PLOT_MANIFEST_FILE: manifestFile,
    },
  };
};

/**
 * `plot_worker_tree_quiet_seconds` as the shipped reading answers it over this
 * desk.
 */
const treeQuiet = (desk) => execFileSync('bash', ['-c', `
  . ${JSON.stringify(stateLib)}
  plot_worker_tree_quiet_seconds "$PLOT_WORKTREE"
`], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, ...desk.env } });

/**
 * What N calls to `plot_worker_idle_watch_pass` publish over this desk. Only
 * the pid and the CPU are stubbed — those are the two readings a test cannot
 * schedule.
 *
 * `passes` defaults to 1 — the whole point of the slice is that one is enough,
 * so a fixture needing more would be hiding the property under test.
 */
const publishedOver = (desk, { passes = 1, ports = '', startedAt = '', pid = '4242' } = {}) => {
  const file = path.join(desk.root, `findings-${passes}-${Math.random().toString(36).slice(2)}.jsonl`);
  execFileSync('bash', ['-c', `
    set -u
    . ${JSON.stringify(transcriptLib)}
    . ${JSON.stringify(manifestLib)}
    . ${JSON.stringify(stateLib)}
    plot_worker_activity() { printf ''; }
    ${ports}
    for _i in $(seq 1 ${passes}); do
      plot_worker_idle_watch_pass "$PLOT_WORKTREE" "$PLOT_BRANCH" "$FINDINGS" "$WINDOW" "$STARTED_AT" "$PID" || true
    done
  `], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env, ...desk.env,
      FINDINGS: file, WINDOW: String(WINDOW), STARTED_AT: String(startedAt), PID: String(pid),
    },
  });
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
};

test('idle: a quiet tree with commits and a silent transcript publishes on the FIRST pass', () => {
  // THE SLICE, against a real desk. Every condition holds and nothing holds a
  // previous sample, so the finding arrives on pass one — which is what lets
  // the WorkerMonitor process be removed entirely.
  const desk = buildDesk('first-pass');
  const quiet = Number(treeQuiet(desk));
  assert.ok(quiet >= WINDOW,
    `the desk's own tree read ${quiet}s quiet, inside the ${WINDOW}s window — the fixture proves nothing`);

  const published = publishedOver(desk);
  assert.equal(published.length, 1,
    `one pass over a quiet desk published ${JSON.stringify(published)}`);
  assert.equal(published[0].finding, 'idle');
  assert.equal(published[0].branch, 'bug/watched');
  assert.match(published[0].evidence, /tree/,
    'the evidence does not mention the tree — an operator cannot tell which condition held');
});

test('idle: a file renamed inside the window publishes nothing', () => {
  // A RENAME IS THE CASE THE MTIME OF A FILE CANNOT SEE. `git mv` preserves the
  // file's own mtime, so a reading over the dirty paths alone would call a
  // just-renamed tree quiet. What moves is the new parent DIRECTORY's mtime,
  // which is why parents are read at all.
  const desk = buildDesk('renamed');
  desk.git('mv', 'src/work.ts', 'src/renamed.ts');
  // The file keeps its old mtime through the rename — assert it, or this test
  // could be passing because the rename happened to touch the file.
  desk.age('src/renamed.ts', OLD);

  const quiet = Number(treeQuiet(desk));
  assert.ok(quiet < WINDOW,
    `a tree with a file renamed seconds ago read ${quiet}s quiet — the parent directory's mtime is not being read`);
  assert.deepEqual(publishedOver(desk, { passes: 3 }), [],
    'a desk whose file was just renamed was published idle');
});

test('idle: a desk where only .plot-worker.* files changed publishes on the first pass', () => {
  // THE DESK ROOT'S MTIME IS NEVER READ, and this is the case that proves it.
  // The loop writes `.plot-worker.*` records into the desk root and REPLACES
  // them — the manifest's `mv` in `plot-dispatch.sh` — which moves the root
  // directory's mtime every time. `plot_worker_dirty_filter` drops the records
  // from the dirty list, but if a root-level dirty path contributed its PARENT,
  // the loop's own bookkeeping would read as tree activity and `idle` would
  // never fire on any real desk.
  const desk = buildDesk('records-only');
  fs.writeFileSync(path.join(desk.desk, '.plot-worker.log'), 'a line the fleet wrote\n');
  fs.writeFileSync(path.join(desk.desk, '.plot-worker.pid'), '4242\n');
  fs.writeFileSync(path.join(desk.desk, '.plot-worker.monitor.worker.jsonl'),
    '{"finding":"clear"}\n');
  // The root directory's mtime is NOW, because entries were just added. The
  // reading must not see it.
  const rootAge = Math.floor(Date.now() / 1000) - fs.statSync(desk.desk).mtimeMs / 1000;
  assert.ok(rootAge < 60,
    `the fixture failed to move the desk root's mtime (${rootAge}s) — this test proves nothing`);

  const quiet = Number(treeQuiet(desk));
  assert.ok(quiet >= WINDOW,
    `a desk holding only fresh .plot-worker.* records read ${quiet}s quiet — the root directory's mtime is being read, and idle can never fire`);

  const published = publishedOver(desk);
  assert.equal(published.length, 1,
    `a desk whose only changes were the loop's own records published ${JSON.stringify(published)}`);
  assert.equal(published[0].finding, 'idle');
});

test('idle: a file edited inside a wholly new untracked directory publishes nothing', () => {
  // DEFAULT PORCELAIN COLLAPSES THIS TO ONE LINE, `?? brandnew/`, because once
  // git knows a whole directory is untracked it stops descending. That is fine
  // for a display and fatal for an mtime: a directory's mtime moves when an
  // ENTRY is added or removed and NOT when a file inside it is written.
  //
  // Measured 2026-10-02 while writing this: a directory aged 2 000 s holding a
  // file 1 s old read `tree quiet: 2001` — a false `idle` on an agent mid-edit.
  // `plot_worker_tree_quiet_seconds` uses `-uall` for this reading only, so the
  // file is listed in its own right. Recorded in the plan's Open Points.
  const desk = buildDesk('untracked-dir');
  fs.mkdirSync(path.join(desk.desk, 'brandnew'), { recursive: true });
  fs.writeFileSync(path.join(desk.desk, 'brandnew', 'fresh.ts'), 'export const x = 1;\n');
  // The DIRECTORY is old; the FILE inside it is new. Exactly the shape an agent
  // leaves when it created a directory a while ago and is editing in it now.
  desk.age('brandnew', OLD);

  const collapsed = execFileSync('git', ['-C', desk.desk, 'status', '--porcelain'],
    { encoding: 'utf8' });
  assert.match(collapsed, /\?\? brandnew\/$/m,
    'git no longer collapses a new untracked directory — this test\'s premise is gone, re-measure before trusting the reading');

  const quiet = Number(treeQuiet(desk));
  assert.ok(quiet < WINDOW,
    `a file written seconds ago inside an old untracked directory read ${quiet}s quiet — the reading is not descending into it`);
  assert.deepEqual(publishedOver(desk, { passes: 3 }), [],
    'a desk with a freshly written file in a new directory was published idle');
});

test('idle: a transcript inside the window publishes nothing, however quiet the tree', () => {
  // THE TWO DURATIONS ARE INDEPENDENT, and this is the case that says so over a
  // real desk: the tree has not moved for an hour and the agent wrote a line a
  // minute ago. An agent thinking hard between edits is exactly this shape.
  const desk = buildDesk('fresh-transcript', { silence: 60 });
  const quiet = Number(treeQuiet(desk));
  assert.ok(quiet >= WINDOW, `the fixture's tree read ${quiet}s — it must be quiet for this test to mean anything`);
  assert.deepEqual(publishedOver(desk, { passes: 3 }), [],
    'an agent that wrote a line a minute ago was published idle because its tree was quiet');
});

test('idle: a working child vetoes the finding over a real desk', () => {
  // THE CPU IS A VETO, asserted where every other condition genuinely holds. An
  // agent waiting on its own 20-minute test suite has a silent transcript and a
  // quiet tree, and only the CPU separates it from one that has stopped — 28 of
  // the 37 over-window stretches wave 1 measured were this case.
  const desk = buildDesk('building');
  assert.deepEqual(
    publishedOver(desk, { passes: 3, ports: "plot_worker_activity() { printf 'working'; }" }),
    [],
    'an agent whose build was running was published idle over a quiet desk');
});

test('idle: a branch with no commits of its own publishes nothing', () => {
  // THE MIDDLE ROW, over a real repository. An agent given a hard first slice
  // is quiet for a long time with nothing to show, and calling that a stall is
  // the cry-wolf that costs the finding its readers. Here the branch is level
  // with `origin/main`, so the commit condition refuses.
  const desk = buildDesk('no-commits');
  desk.git('reset', '-q', '--hard', 'refs/remotes/origin/main');
  // The reset leaves the tree clean and HEAD at the seed commit, whose own date
  // is recent — so age it, or the tree reading refuses first and this test
  // would pass for the wrong reason.
  const stamp = `@${Math.floor(Date.now() / 1000) - OLD} +0000`;
  execFileSync('git', ['-C', desk.desk, 'commit', '-q', '--amend', '--no-edit', '--date', stamp],
    { env: { ...process.env, GIT_COMMITTER_DATE: stamp }, stdio: 'pipe' });
  execFileSync('git', ['-C', desk.desk, 'update-ref', 'refs/remotes/origin/main', 'HEAD']);

  const quiet = Number(treeQuiet(desk));
  assert.ok(quiet >= WINDOW,
    `the fixture's tree read ${quiet}s quiet — the commit condition is not what is being tested`);
  assert.deepEqual(publishedOver(desk, { passes: 3 }), [],
    'a branch carrying no work of its own was published idle');
});

test('idle: a desk with no git repository at all reads unreadable, not a long silence', () => {
  // A FAILURE TO OBSERVE IS NOT EVIDENCE OF SOMETHING TO SEE. Read as zero this
  // would say *everything just moved*; read as a huge number it would say
  // *nothing has moved in years*. Both are inventions, so the word travels.
  const bare = scratch('plot-idle-bare-');
  const out = execFileSync('bash', ['-c', `
    . ${JSON.stringify(stateLib)}
    plot_worker_tree_quiet_seconds "$PLOT_WORKTREE"
  `], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PLOT_WORKTREE: bare } });
  assert.equal(out, 'unreadable',
    'a directory that is not a git repository answered a number — the reading invented one');
});

// ═══════════════════════════════════════════════════════════════════════════
// THE RACE THE PLAN DID NOT ANTICIPATE — written before the watcher existed
// ═══════════════════════════════════════════════════════════════════════════
//
// The old WorkerMonitor ran for the whole life of the wrapper, so its first
// pass could only ever see a transcript that belonged to THIS prompt. The new
// watcher starts fresh with each prompt and reads the transcript's age from
// before the prompt began — so a prompt resuming a conversation whose
// transcript is already older than the window could read `idle` on its FIRST
// pass and be ended before the model ever answers.
//
// This is deliberately NOT the usage-limit clamp's case: that clamp covers a
// limited wait and nothing else, and a desk here is not waiting on any reset.
test('idle: a prompt 5s into a resumed conversation is not judged idle on its first pass', () => {
  // A DESK WITH COMMITS, A SPOKEN CONVERSATION 2000s OLD, NO CHILD ON A CORE, A
  // TREE QUIET FOR 2000s, AND A PROMPT THAT HAS RUN FOR 5s. Every non-race
  // condition the plan names is deliberately satisfied, so the only thing that
  // can withhold `idle` is the race clamp this test exists to require.
  const desk = buildDesk('resumed-race', { silence: 2000 });
  const quiet = Number(treeQuiet(desk));
  assert.ok(quiet >= WINDOW,
    `the fixture's tree read ${quiet}s quiet — it must clear the window for this test to mean anything`);

  const now = Math.floor(Date.now() / 1000);
  const published = publishedOver(desk, { startedAt: now - 5 });
  assert.deepEqual(published, [],
    'a prompt 5s into a resumed conversation was published idle on its first pass — ' +
    'the transcript is older than the window, but it belongs to the PREVIOUS prompt, not this one');
});

test('idle: the same desk, with no prompt-start clamp given, DOES publish idle', () => {
  // THE CONTROL. Without `$5` the function has nothing to clamp against, so it
  // falls back to the raw transcript age — which is the old, race-prone
  // behaviour this test's sibling exists to rule out for the watcher's actual
  // call site. This pins that the clamp, and not some other condition, is what
  // withheld the finding above.
  const desk = buildDesk('resumed-race-control', { silence: 2000 });
  const published = publishedOver(desk, { startedAt: '' });
  assert.equal(published.length, 1,
    `the control desk (no clamp) did not publish idle: ${JSON.stringify(published)}`);
  assert.equal(published[0].finding, 'idle');
});
