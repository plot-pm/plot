// Contract test for the one-sample `idle` finding over a REAL desk.
//
// WHY THIS FILE EXISTS BESIDE `workermonitor.test.mjs`. That file replaces
// `monitor_tree_quiet` with a stub, so every assertion in it is about what the
// RULE does with a number — and a stub says nothing about whether the number is
// read correctly. The tree reading is mtimes over a git status, and the two ways
// it can be wrong are invisible to a mock:
//
//   1. it reads the desk ROOT's mtime, which the loop keeps touching, so `idle`
//      never fires on any real desk
//   2. it misses a change a real agent makes — a rename, or a file inside a
//      directory git collapsed to one status line
//
// So this builds a desk: a real repository with a real `origin/main` ref, a
// commit that touched a file, files aged with `touch -t`, and a transcript
// directory laid out the way `test/e2e/worker-monitor-samples.test.mjs` lays
// one out. Only the pid and the CPU are stubbed, because those are the two
// readings a test cannot schedule.
//
// THE THREE CASES ARE THE PLAN'S, and the third is the one that matters most:
// a desk where only `.plot-worker.*` files changed inside the window must still
// publish `idle`, because that is every desk the loop has ever written to.
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
const monitor = path.join(scripts, 'plot-worker-monitor.sh');

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
 * THE `origin/main` REF IS REAL because `monitor_has_commits` counts against it
 * and answers `unanswerable` where there is none — which withholds `idle`, so a
 * fixture without one would exercise nothing at all.
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
  // and what `monitor_has_commits` accepts.
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
 * `treeQuietSeconds` as the shipped reading answers it over this desk.
 *
 * Asked through the MONITOR's port rather than the library function directly,
 * because the port is what a caller reaches and a port that forgot to pass the
 * worktree would still pass a test of the function.
 */
const treeQuiet = (desk) => execFileSync('bash', ['-c', `
  PLOT_MONITOR_NO_MAIN=1
  . ${JSON.stringify(monitor)}
  monitor_tree_quiet
`], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, ...desk.env } });

/**
 * What ONE pass over this desk publishes. Only the pid and the CPU are stubbed.
 *
 * `passes` defaults to 1 — the whole point of the slice is that one is enough,
 * so a fixture needing more would be hiding the property under test.
 */
const publishedOver = (desk, { passes = 1, ports = '' } = {}) => {
  const file = path.join(desk.root, `findings-${passes}-${Math.random().toString(36).slice(2)}.jsonl`);
  execFileSync('bash', ['-c', `
    PLOT_MONITOR_NO_MAIN=1
    . ${JSON.stringify(monitor)}
    monitor_pid_alive() { return 0; }
    monitor_pid() { printf '4242'; }
    monitor_activity() { printf ''; }
    ${ports}
    for _i in $(seq 1 ${passes}); do monitor_pass; done
  `], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...desk.env, PLOT_MONITOR_FILE: file, PLOT_MONITOR_INTERVAL: '30' },
  });
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
};

test('idle: a quiet tree with commits and a silent transcript publishes on the FIRST pass', () => {
  // THE SLICE, against a real desk. Every condition holds and nothing holds a
  // previous sample, so the finding arrives on pass one — which is what lets
  // the next slice delete the process that used to hold it.
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
    publishedOver(desk, { passes: 3, ports: "monitor_activity() { printf 'working'; }" }),
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
    PLOT_MONITOR_NO_MAIN=1
    . ${JSON.stringify(monitor)}
    monitor_tree_quiet
  `], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PLOT_WORKTREE: bare } });
  assert.equal(out, 'unreadable',
    'a directory that is not a git repository answered a number — the reading invented one');
});
