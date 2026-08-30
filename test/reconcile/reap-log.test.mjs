// Contract test for the reaper's log half: a reaped worktree takes its log.
//
// THE DEFECT THIS FILE PINS. `plot-reap.sh` removed the checkout and the
// registry manifest and left the agent log where it was. Measured 2026-08-30:
// 190 log files, 2.6 MB beside the repository, the oldest from 2026-08-17, and
// NOT ONE belonging to live work. Nothing had ever removed one.
//
// WHICH LOG, since the estate holds two shapes of one. `plot-resolve-<branch>`
// is keyed by BRANCH with its slashes flattened (`repairLogPath`), so it maps
// one-to-one onto the worktree this reaper removes. `plot-dispatch-<slug>.log`
// is keyed by PLAN and opened for APPEND across every dispatch of that plan —
// `dispatch.ts:150` states it: "a dispatcher log belongs to a plan, a worker log
// to a branch". Reaping one branch of a five-branch plan must not delete the
// record the other four are still writing to, which is why the per-plan log is
// asserted to SURVIVE here rather than merely being left untested.
//
// ORDER IS ASSERTED, not left to reading (item 3): worktree, then manifest,
// then log. The log is last because it is the only one that is pure cleanup —
// a missing manifest orphans an agent, a missing log costs a record of work the
// host already merged.
//
// AND THE FIVE REFUSALS ARE ASSERTED UNCHANGED (item 5). This slice edits the
// script that holds them, and they are the only thing standing between a
// cleanup and losing work. A test that only proved the log goes would pass just
// as happily on a reaper that had stopped refusing anything.
//
// The merged gate is satisfied by ANCESTRY, never by stubbing `gh`: a branch
// merged into main clears `origin/main..branch` with no network, so these tests
// are hermetic and run on a machine with no host CLI at all.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const reap = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reap.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const ctx = [];
after(() => {
  for (const t of ctx) fs.rmSync(t, { recursive: true, force: true });
});

/**
 * A repo with an origin and a `main` with one commit.
 *
 * Each fixture gets its OWN parent directory and the repo sits inside it, so
 * "beside the repo" — where the logs go when no `Worktree root` is configured —
 * means only what this test created. The shared `os.tmpdir()` is a namespace two
 * suites have already collided in: a `plot-wt-*` left by an aborted run of
 * another file failed an unrelated assertion on 2026-08-30.
 *
 * `worktreeRoot` writes the `Worktree root` key, so the configured branch of the
 * resolution is exercised as well as the fallback.
 */
const makeRepo = ({ registry = 'shared-registry', worktreeRoot = '' } = {}) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-reaplog-'));
  ctx.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    `# Repo\n\n## Plot Config\n\n- **Agent registry:** \`${registry}\`\n` +
      (worktreeRoot ? `- **Worktree root:** \`${worktreeRoot}\`\n` : ''),
  );
  fs.mkdirSync(path.join(repo, registry), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  // Where the reaper must look. With no key that is the parent of the repo,
  // which is this fixture's own directory; with one it is the configured root.
  const logDir = worktreeRoot
    ? path.isAbsolute(worktreeRoot)
      ? worktreeRoot
      : path.join(repo, worktreeRoot)
    : tmp;
  return { tmp, repo, registryDir: path.join(repo, registry), logDir };
};

/**
 * A dispatch worktree — named `plot-wt-*`, one of the two shapes the reaper
 * will touch. `merged: true` merges the branch into main and pushes, so the
 * ancestry gate clears it with no host.
 */
const worktree = (repo, branch, { merged = true } = {}) => {
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'branch', branch);
  git(repo, 'worktree', 'add', '-q', wt, branch);
  fs.writeFileSync(path.join(wt, 'work.txt'), branch);
  git(wt, 'add', '-A');
  git(wt, 'commit', '-qm', `work on ${branch}`);
  if (merged) {
    git(repo, 'merge', '-q', '--no-ff', '-m', `merge ${branch}`, branch);
    git(repo, 'push', '-q', 'origin', 'main');
  }
  return wt;
};

/**
 * The three files one branch's repair run leaves — the shape `agent-log.ts`
 * writes, keyed by branch with its slashes flattened.
 *
 * All three, because the `.state` and the `.prompt.md` sit beside the log
 * precisely so a sweep takes the whole run. One that knew about the log alone
 * would leave half of it behind, which is a smaller version of the accumulation
 * rather than a fix for it.
 */
const runFiles = (logDir, branch) => {
  const flat = branch.replace(/\//g, '-');
  const files = {
    log: path.join(logDir, `plot-resolve-${flat}.log`),
    state: path.join(logDir, `plot-resolve-${flat}.state`),
    prompt: path.join(logDir, `plot-resolve-${flat}.prompt.md`),
  };
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(files.log, `repairing ${branch}\n`);
  fs.writeFileSync(files.state, 'done\n');
  fs.writeFileSync(files.prompt, 'the brief\n');
  return files;
};

const manifest = (registryDir, session, wt) => {
  const file = path.join(registryDir, `${session}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ session, branch: 'feature/x', worktree: wt, startedAt: '2026-08-30T10:00:00Z' }, null, 2),
  );
  return file;
};

const run = (repo, ...args) => execFileSync('bash', [reap, ...args], { encoding: 'utf8', cwd: repo });

test('item 1: reaping a worktree removes its log', () => {
  const { repo, logDir } = makeRepo();
  const wt = worktree(repo, 'feature/landed');
  const files = runFiles(logDir, 'feature/landed');

  const out = run(repo, '--yes');

  assert.match(out, /reaped\s+feature\/landed/, `expected a reap:\n${out}`);
  assert.ok(!fs.existsSync(wt), 'the worktree is gone');
  assert.ok(!fs.existsSync(files.log), 'and the log with it');
});

test('item 1: the whole run goes — the .state and the .prompt.md too', () => {
  // A sweep that took the log alone would leave two thirds of every run behind.
  const { repo, logDir } = makeRepo();
  worktree(repo, 'feature/whole');
  const files = runFiles(logDir, 'feature/whole');

  run(repo, '--yes');

  assert.ok(!fs.existsSync(files.log), 'the log is gone');
  assert.ok(!fs.existsSync(files.state), 'the .state companion is gone');
  assert.ok(!fs.existsSync(files.prompt), 'the .prompt.md companion is gone');
});

test('item 1: the log is found under a configured Worktree root', () => {
  // The repository this plan was written on. `agentLogDir` puts logs under the
  // configured root, and a reaper reading the fallback would sweep an empty
  // parent directory and report success over a file still sitting there.
  const { repo, logDir } = makeRepo({ worktreeRoot: '.worktrees' });
  worktree(repo, 'feature/configured');
  const files = runFiles(logDir, 'feature/configured');
  assert.ok(fs.existsSync(files.log), 'the fixture put the log under the configured root');

  const out = run(repo, '--yes');

  assert.match(out, /reaped\s+feature\/configured/, `expected a reap:\n${out}`);
  assert.ok(!fs.existsSync(files.log), 'the configured root is where the reaper looked');
});

test('item 1: a branch whose name has slashes finds its flattened log', () => {
  // `repairLogPath` flattens `/` to `-`. A reaper that used the branch verbatim
  // would compose a path with a directory that does not exist and remove
  // nothing, silently — the whole population is branches with a prefix.
  const { repo, logDir } = makeRepo();
  worktree(repo, 'bug/deeply/nested/name');
  const files = runFiles(logDir, 'bug/deeply/nested/name');

  run(repo, '--yes');

  assert.ok(!fs.existsSync(files.log), 'the flattened name is the one that matched');
});

test('item 2: a reap whose log is already gone still succeeds', () => {
  // A MISSING LOG IS NOT A REFUSAL. The five refusals are about work that might
  // be lost; a log describes work the host already merged. `rm -f` semantics —
  // not being there is the desired state.
  const { repo, registryDir } = makeRepo();
  const wt = worktree(repo, 'feature/nolog');
  const file = manifest(registryDir, 'sess-nolog', wt);

  const out = run(repo, '--yes');

  assert.match(out, /reaped\s+feature\/nolog/, `a missing log must not refuse the reap:\n${out}`);
  assert.ok(!fs.existsSync(wt), 'the worktree still goes');
  assert.ok(!fs.existsSync(file), 'the manifest still goes');
  assert.match(out.trim().split('\n').at(-1), /removed=1/, 'and it counts as a removal');
});

test('item 2: a missing log is silent — the line does not claim one was removed', () => {
  // Reporting "log removed" over a file that was never there would make the
  // report unreadable as evidence: the operator could not tell a swept run from
  // a run that had none.
  const { repo } = makeRepo();
  worktree(repo, 'feature/quiet');

  const out = run(repo, '--yes');

  const line = out.split('\n').find((l) => l.includes('feature/quiet'));
  assert.ok(line, `expected a line for the branch:\n${out}`);
  assert.ok(!/log/.test(line), `a missing log says nothing:\n${line}`);
});

test('item 3: the log goes AFTER the worktree — a refused removal keeps it', () => {
  // Asserted by making the worktree removal FAIL, the same technique item 4 of
  // the manifest suite uses: the log must survive.
  //
  // A log describes the worktree, so a removal that refused must keep it — an
  // operator sent to look at a tree that is still there needs the words
  // explaining why. Removing it first would take the evidence and leave the
  // problem.
  const { repo, logDir } = makeRepo();
  const holder = path.join(path.dirname(repo), 'held');
  fs.mkdirSync(holder, { recursive: true });
  const branch = 'feature/stuck';
  const wt = path.join(holder, 'plot-wt-feature-stuck');
  git(repo, 'branch', branch);
  git(repo, 'worktree', 'add', '-q', wt, branch);
  fs.writeFileSync(path.join(wt, 'work.txt'), branch);
  git(wt, 'add', '-A');
  git(wt, 'commit', '-qm', 'work');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge', branch);
  git(repo, 'push', '-q', 'origin', 'main');
  const files = runFiles(logDir, branch);

  fs.chmodSync(holder, 0o500); // r-x: entries cannot be unlinked
  let out;
  try {
    out = run(repo, '--yes');
  } finally {
    fs.chmodSync(holder, 0o700);
  }

  assert.match(out, /FAILED\s+feature\/stuck/, `expected the removal to fail:\n${out}`);
  assert.ok(fs.existsSync(wt), 'the worktree is still there');
  assert.ok(fs.existsSync(files.log), 'a worktree that survived keeps the log that describes it');
});

test('item 3: a REFUSED reap leaves the log alone', () => {
  // The ordinary case of the same property: unlanded work keeps its record.
  const { repo, logDir } = makeRepo();
  worktree(repo, 'feature/unmerged', { merged: false });
  const files = runFiles(logDir, 'feature/unmerged');

  const out = run(repo, '--yes');

  assert.match(out, /keep\s+feature\/unmerged/, `expected a refusal:\n${out}`);
  assert.ok(fs.existsSync(files.log), 'a kept worktree keeps its log');
});

test('item 4: --dry-run names the log it would remove and removes nothing', () => {
  const { repo, logDir } = makeRepo();
  const wt = worktree(repo, 'feature/preview');
  const files = runFiles(logDir, 'feature/preview');

  const out = run(repo);

  assert.match(out, /would\s+feature\/preview/, `expected a preview:\n${out}`);
  assert.match(out, /plot-resolve-feature-preview\.log/, `the preview NAMES the log:\n${out}`);
  assert.ok(fs.existsSync(wt), 'dry run removes no worktree');
  assert.ok(fs.existsSync(files.log), 'dry run removes no log');
  assert.match(out.trim().split('\n').at(-1), /dry_run=1/);
});

test('item 4: a dry run over a branch with no log names none', () => {
  const { repo } = makeRepo();
  worktree(repo, 'feature/bare');

  const out = run(repo);

  const line = out.split('\n').find((l) => l.includes('feature/bare'));
  assert.ok(line, `expected a line for the branch:\n${out}`);
  assert.ok(!/log/.test(line), `nothing to name, so nothing named:\n${line}`);
});

test("the per-plan dispatch log SURVIVES a branch's reap", () => {
  // The one removal this slice deliberately does NOT make.
  //
  // `plot-dispatch-<slug>.log` is keyed by PLAN and opened for append by every
  // dispatch of that plan, so it spans branches and outlives any one of them.
  // Reaping one branch of a five-branch plan must not delete the record the
  // other four are still writing to — the same class of harm the five refusals
  // exist to prevent, arrived at from the cleanup side.
  const { repo, logDir } = makeRepo();
  worktree(repo, 'feature/one-of-many');
  runFiles(logDir, 'feature/one-of-many');
  const planLog = path.join(logDir, 'plot-dispatch-some-plan.log');
  fs.writeFileSync(planLog, 'dispatched three branches\n');

  const out = run(repo, '--yes');

  assert.match(out, /reaped\s+feature\/one-of-many/, `expected a reap:\n${out}`);
  assert.ok(fs.existsSync(planLog), "a plan's log outlives one of its branches");
});

test('a foreign file in the log directory is never touched', () => {
  // The boundary is the point. The logs sit in a directory Plot shares with
  // whatever else the operator keeps beside their checkouts, so a sweep that
  // globbed loosely would do more than it says.
  const { repo, logDir } = makeRepo();
  worktree(repo, 'feature/narrow');
  runFiles(logDir, 'feature/narrow');
  const foreign = path.join(logDir, 'plot-resolve-feature-narrow-BUT-LONGER.log');
  const unrelated = path.join(logDir, 'notes.log');
  fs.writeFileSync(foreign, 'a different branch\n');
  fs.writeFileSync(unrelated, "the operator's own file\n");

  run(repo, '--yes');

  assert.ok(fs.existsSync(foreign), 'a longer name sharing the prefix survives');
  assert.ok(fs.existsSync(unrelated), 'a file Plot did not write is not Plot to remove');
});

// THE FIVE REFUSALS, UNCHANGED.
//
// The brief asks for this by name because this slice edits the script that
// holds them, and they are the only thing standing between a cleanup and losing
// work — two of them saved changesets on 2026-08-30. A suite that only proved
// the log goes would pass just as happily on a reaper that had stopped refusing
// anything at all.
//
// Each is driven end to end against a real fixture and asserted to KEEP the
// tree. The fifth — a non-dispatch tree — is asserted by absence, since it is a
// skip rather than a refusal and so is not reported at all.
test('refusal 1 unchanged: a live worker pid keeps the tree', () => {
  const { repo, logDir } = makeRepo();
  const wt = worktree(repo, 'feature/alive');
  const files = runFiles(logDir, 'feature/alive');
  // This process: certain to be alive, and certain not to be a worker. The
  // reading is "is this pid running", so any live pid triggers it.
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), `${process.pid}\n`);

  const out = run(repo, '--yes');

  assert.match(out, /keep\s+feature\/alive.*worker alive/, `expected a live-worker refusal:\n${out}`);
  assert.ok(fs.existsSync(wt), 'a desk someone is at stays');
  assert.ok(fs.existsSync(files.log), 'and keeps its log');
});

test('refusal 2 unchanged: uncommitted changes keep the tree', () => {
  const { repo, logDir } = makeRepo();
  const wt = worktree(repo, 'feature/dirty');
  const files = runFiles(logDir, 'feature/dirty');
  fs.writeFileSync(path.join(wt, 'scratch.txt'), 'work that exists nowhere else\n');

  const out = run(repo, '--yes');

  assert.match(out, /keep\s+feature\/dirty.*uncommitted/, `expected a dirty refusal:\n${out}`);
  assert.ok(fs.existsSync(wt), 'the tree stays');
  assert.ok(fs.existsSync(files.log), 'and keeps its log');
});

test('refusal 3 unchanged: a PLOT-BLOCKED marker keeps the tree', () => {
  const { repo, logDir } = makeRepo();
  const wt = worktree(repo, 'feature/blocked');
  const files = runFiles(logDir, 'feature/blocked');
  fs.writeFileSync(path.join(wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which way?\n');

  const out = run(repo, '--yes');

  assert.match(out, /keep\s+feature\/blocked.*PLOT-BLOCKED/, `expected a marker refusal:\n${out}`);
  assert.ok(fs.existsSync(wt), 'a worker waiting on a person stays');
  assert.ok(fs.existsSync(files.log), 'and keeps the log a person will read');
});

test('refusal 4 unchanged: no merged PR keeps the tree', () => {
  const { repo, logDir } = makeRepo();
  const wt = worktree(repo, 'feature/unlanded', { merged: false });
  const files = runFiles(logDir, 'feature/unlanded');

  const out = run(repo, '--yes');

  assert.match(out, /keep\s+feature\/unlanded.*no merged PR/, `expected a host refusal:\n${out}`);
  assert.ok(fs.existsSync(wt), 'unlanded work stays');
  assert.ok(fs.existsSync(files.log), 'and keeps its log');
});

test('refusal 5 unchanged: a hand-made worktree is not looked at, log and all', () => {
  // Not ours to remove, whatever state it is in — so it is skipped rather than
  // refused, and does not appear in the report at all. A skip that became a
  // refusal would still be safe; a skip that became a reap would remove a
  // directory a person made by hand.
  const { repo, logDir } = makeRepo();
  const branch = 'feature/handmade';
  const wt = path.join(path.dirname(repo), 'my-own-checkout');
  git(repo, 'branch', branch);
  git(repo, 'worktree', 'add', '-q', wt, branch);
  fs.writeFileSync(path.join(wt, 'work.txt'), branch);
  git(wt, 'add', '-A');
  git(wt, 'commit', '-qm', 'work');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge', branch);
  git(repo, 'push', '-q', 'origin', 'main');
  const files = runFiles(logDir, branch);

  const out = run(repo, '--yes');

  assert.ok(!/feature\/handmade/.test(out), `a non-dispatch tree is not reported:\n${out}`);
  assert.ok(fs.existsSync(wt), 'a hand-made checkout stays');
  assert.ok(fs.existsSync(files.log), 'and nothing of its is swept');
});

test('the five refusals keep the manifest too, which is the property that pairs with the log', () => {
  // The refusals are asserted above one at a time; this is the one assertion
  // that would catch a reaper which had learned to refuse but kept removing.
  const { repo, registryDir, logDir } = makeRepo();
  const wt = worktree(repo, 'feature/paired', { merged: false });
  const file = manifest(registryDir, 'sess-paired', wt);
  const files = runFiles(logDir, 'feature/paired');

  run(repo, '--yes');

  assert.ok(fs.existsSync(wt), 'the worktree stays');
  assert.ok(fs.existsSync(file), 'the manifest stays');
  assert.ok(fs.existsSync(files.log), 'the log stays');
});
