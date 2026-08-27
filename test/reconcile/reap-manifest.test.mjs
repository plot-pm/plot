// Contract test for the reaper's registry half: a reaped worktree takes its
// manifest with it.
//
// THE DEFECT THIS FILE PINS. `plot-reap.sh` removed checkouts and contained
// zero references to the registry, so every reap converted a finished agent
// into a row the board could neither verify nor clear. Measured 2026-08-26:
// twelve worktrees removed, seven `unknown` rows appearing at once, each
// naming a directory that no longer existed.
//
// `readAgentRegistry` renders one row per manifest AND synthesizes a row for
// any dispatch worktree without one — so the two failures are mirror images,
// and a fix can trade one for the other. That is why ORDER is asserted here
// (item 4) rather than left to reading: worktree first, manifest second. The
// reverse leaves a live worktree unregistered, which synthesizes the same bad
// row a different way.
//
// The merged gate is satisfied by ANCESTRY, never by stubbing `gh`: a branch
// merged into main clears `origin/main..branch` with no network, so these
// tests are hermetic and run on a machine with no host CLI at all.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const reap = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reap.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

const ctx = [];
after(() => { for (const t of ctx) fs.rmSync(t, { recursive: true, force: true }); });

// A repo with an origin, a `main` with one commit, and an `Agent registry` key
// pointing at a directory that is NOT the default — so a reaper that hard-coded
// `.plot/agents` would look in the wrong place and these tests would catch it.
function makeRepo({ registry = 'shared-registry' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-reapman-'));
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
    `# Repo\n\n## Plot Config\n\n- **Agent registry:** \`${registry}\`\n`,
  );
  fs.mkdirSync(path.join(repo, registry), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo, registryDir: path.join(repo, registry) };
}

// A dispatch worktree — named `plot-wt-*`, which is the only shape the reaper
// will touch. `merged: true` merges the branch into main and pushes, so the
// ancestry gate clears it.
function worktree(repo, branch, { merged = true } = {}) {
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
}

// A manifest naming a session and the worktree it was dispatched into. Keyed by
// SESSION, like the dispatcher writes them — never derivable from the branch.
function manifest(registryDir, session, wt, extra = {}) {
  const file = path.join(registryDir, `${session}.json`);
  fs.writeFileSync(file, JSON.stringify({
    session,
    branch: 'feature/x',
    worktree: wt,
    startedAt: '2026-08-26T10:00:00Z',
    ...extra,
  }, null, 2));
  return file;
}

function run(repo, ...args) {
  return execFileSync('bash', [reap, ...args], { encoding: 'utf8', cwd: repo });
}

test('item 1: reaping a worktree removes its manifest', () => {
  const { repo, registryDir } = makeRepo();
  const wt = worktree(repo, 'feature/landed');
  const file = manifest(registryDir, 'sess-landed', wt);

  const out = run(repo, '--yes');

  assert.match(out, /reaped\s+feature\/landed/, `expected a reap:\n${out}`);
  assert.ok(!fs.existsSync(wt), 'the worktree is gone');
  assert.ok(!fs.existsSync(file), 'the manifest is gone with it');
});

test('item 1: the manifest is found by its worktree field, not by the branch name', () => {
  // Manifests are keyed by session id. A reaper that rebuilt the filename from
  // the branch would miss every real one.
  const { repo, registryDir } = makeRepo();
  const wt = worktree(repo, 'feature/keyed');
  const file = manifest(registryDir, '9f8e7d6c-0000-4444-8888-aaaabbbbcccc', wt);

  run(repo, '--yes');

  assert.ok(!fs.existsSync(file), 'a session-keyed manifest is still matched');
});

test('item 1: a manifest naming a DIFFERENT worktree is left alone', () => {
  // The match is on the exact recorded path. A prefix match would let
  // `plot-wt-feature-a` claim `plot-wt-feature-a-longer`'s manifest — and this
  // estate genuinely nests branch names that way.
  const { repo, registryDir } = makeRepo();
  const wt = worktree(repo, 'feature/nest');
  const mine = manifest(registryDir, 'sess-nest', wt);
  const sibling = manifest(registryDir, 'sess-nest-longer', `${wt}-longer`);
  // The sibling's directory EXISTS, so the orphan sweep must not take it either.
  fs.mkdirSync(`${wt}-longer`, { recursive: true });

  run(repo, '--yes');

  assert.ok(!fs.existsSync(mine), 'the exact match is removed');
  assert.ok(fs.existsSync(sibling), 'a longer path sharing the prefix survives');
});

test('item 2: a manifest whose worktree is already gone is cleared', () => {
  // The population every reap before this fix stranded — cleared by the same
  // run, because a fix that only prevents new ones leaves today's rows forever.
  const { repo, registryDir } = makeRepo();
  const orphan = manifest(registryDir, 'sess-orphan', path.join(path.dirname(repo), 'plot-wt-feature-long-reaped'));

  const out = run(repo, '--yes');

  assert.ok(!fs.existsSync(orphan), `the orphaned manifest is cleared:\n${out}`);
  assert.match(out, /cleared/, 'the run says so');
  assert.match(out.trim().split('\n').at(-1), /cleared=1/, 'and counts it in the footer');
});

test('item 2: the sweep needs no worktree of its own to run', () => {
  // The orphan population outlives the reap that made it, so the sweep must run
  // even when there is nothing reapable this pass.
  const { repo, registryDir } = makeRepo();
  const orphan = manifest(registryDir, 'sess-alone', '/nonexistent/plot-wt-feature-vanished');

  run(repo, '--yes');

  assert.ok(!fs.existsSync(orphan), 'cleared with zero worktrees in play');
});

test('item 2: a manifest recording NO worktree path survives the sweep', () => {
  // An agent between checkouts. Absence of a path is not absence of an agent,
  // and the registry's own reader treats the two differently.
  const { repo, registryDir } = makeRepo();
  const nopath = manifest(registryDir, 'sess-nopath', '');

  run(repo, '--yes');

  assert.ok(fs.existsSync(nopath), 'no path recorded is not an orphan');
});

test('item 2: a manifest whose worktree EXISTS survives the sweep', () => {
  // The live estate. Every manifest naming a real directory must be untouched,
  // or a reap would clear the whole registry.
  const { repo, registryDir } = makeRepo();
  const wt = worktree(repo, 'feature/unlanded', { merged: false });
  const live = manifest(registryDir, 'sess-live', wt);

  run(repo, '--yes');

  assert.ok(fs.existsSync(live), 'a manifest with a real worktree survives');
});

test('item 3: a REFUSED reap leaves the manifest alone', () => {
  // A worktree that stays must keep its registration — otherwise
  // `readAgentRegistry` synthesizes it back as `unknown` and the fix has
  // produced the bug it was written to remove.
  const { repo, registryDir } = makeRepo();
  const wt = worktree(repo, 'feature/unmerged', { merged: false });
  const file = manifest(registryDir, 'sess-unmerged', wt);

  const out = run(repo, '--yes');

  assert.match(out, /keep\s+feature\/unmerged/, `expected a refusal:\n${out}`);
  assert.ok(fs.existsSync(wt), 'the worktree stays');
  assert.ok(fs.existsSync(file), 'and keeps its registration');
});

test('item 3: a PLOT-BLOCKED marker refuses the reap and keeps the manifest', () => {
  // One of the five refusals, driven end to end: the worker stopped to ask a
  // person something, and its record must outlive the question.
  const { repo, registryDir } = makeRepo();
  const wt = worktree(repo, 'feature/blocked');
  fs.writeFileSync(path.join(wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which way?\n');
  const file = manifest(registryDir, 'sess-blocked', wt);

  const out = run(repo, '--yes');

  assert.match(out, /keep\s+feature\/blocked.*PLOT-BLOCKED/, `expected a marker refusal:\n${out}`);
  assert.ok(fs.existsSync(file), 'a blocked worker keeps its registration');
});

test('item 3: uncommitted changes refuse the reap and keep the manifest', () => {
  const { repo, registryDir } = makeRepo();
  const wt = worktree(repo, 'feature/dirty');
  fs.writeFileSync(path.join(wt, 'scratch.txt'), 'unsaved work\n');
  const file = manifest(registryDir, 'sess-dirty', wt);

  const out = run(repo, '--yes');

  assert.match(out, /keep\s+feature\/dirty.*uncommitted/, `expected a dirty refusal:\n${out}`);
  assert.ok(fs.existsSync(file), 'a dirty worktree keeps its registration');
});

test('item 4: the worktree is removed BEFORE the manifest', () => {
  // Asserted by making the worktree removal FAIL: the manifest must survive.
  //
  // The failure is forced by making the worktree's parent directory
  // unwritable, so `git worktree remove` cannot unlink the checkout. If the
  // manifest went first, this run would leave a live worktree with no
  // registration — which the registry answers by synthesizing an `unknown`
  // row, trading the fixed defect for its mirror image.
  const { repo, registryDir } = makeRepo();
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
  const file = manifest(registryDir, 'sess-stuck', wt);

  fs.chmodSync(holder, 0o500); // r-x: entries cannot be unlinked
  let out;
  try {
    out = run(repo, '--yes');
  } finally {
    fs.chmodSync(holder, 0o700);
  }

  assert.match(out, /FAILED\s+feature\/stuck/, `expected the removal to fail:\n${out}`);
  assert.ok(fs.existsSync(wt), 'the worktree is still there');
  assert.ok(fs.existsSync(file),
    'a worktree that survived must keep its manifest — otherwise the registry synthesizes an unknown row');
});

test('a manifest recording an UNRESOLVED path still matches its worktree', () => {
  // Found by measurement while writing item 4, not predicted.
  //
  // `git worktree list` reports paths with symlinks RESOLVED; a manifest records
  // whatever the dispatcher was handed. On macOS `/tmp`, `/var` and `/etc` are
  // symlinks into `/private`, so one directory arrives as two different strings
  // and an exact string compare matches nothing — stranding the very manifest
  // the reap exists to take.
  //
  // The fixture writes the manifest with the UNRESOLVED path and lets git
  // report the resolved one, which is exactly how the two disagree in life.
  const { repo, registryDir } = makeRepo();
  const wt = worktree(repo, 'feature/symlinked');
  // The two spellings of one directory. `fs.realpathSync` gives the form git
  // reports (`/private/var/...` on macOS); `wt` itself is the unresolved
  // `/var/...` form `mkdtemp` handed us.
  //
  // On Linux `/tmp` is a real directory, so the two are the SAME string and
  // there is no mismatch to reproduce — the reap must still take the manifest,
  // which is what the assertions below check either way. Only the divergent
  // platform exercises the normalisation; asserting the divergence itself
  // would fail CI on the platform where the bug cannot happen.
  const resolved = fs.realpathSync(wt);
  const file = manifest(registryDir, 'sess-symlinked', wt);

  const out = run(repo, '--yes');

  assert.ok(!fs.existsSync(resolved), 'the worktree is reaped');
  assert.ok(!fs.existsSync(file),
    'a manifest naming the same directory by an unresolved path is still matched');
  // The END STATE alone cannot prove this: the orphan sweep runs in the same
  // pass and catches a matcher miss, so the file disappears either way. What
  // distinguishes them is WHICH step took it — the reaped line says
  // "manifest cleared" when the match worked, and a separate "cleared" line
  // appears when the sweep had to rescue it.
  //
  // The difference is load-bearing, not cosmetic. The sweep cannot tell a
  // failed worktree removal from a successful one, so leaning on it would
  // clear the manifest of a worktree that SURVIVED — the item 4 defect.
  assert.match(out, /reaped\s+feature\/symlinked.*manifest cleared/,
    `the reap itself must match the manifest, not leave it to the sweep:\n${out}`);
});

test('a dry run removes nothing and says what it would do', () => {
  // The default. Both halves must be reported and neither performed.
  const { repo, registryDir } = makeRepo();
  const wt = worktree(repo, 'feature/preview');
  const file = manifest(registryDir, 'sess-preview', wt);
  const orphan = manifest(registryDir, 'sess-ghost', '/nonexistent/plot-wt-feature-ghost');

  const out = run(repo);

  assert.match(out, /would\s+feature\/preview/, `expected a preview:\n${out}`);
  assert.match(out, /would.*orphaned manifest/, 'the orphan is previewed too');
  assert.ok(fs.existsSync(wt), 'dry run removes no worktree');
  assert.ok(fs.existsSync(file), 'dry run removes no manifest');
  assert.ok(fs.existsSync(orphan), 'dry run clears no orphan');
  assert.match(out.trim().split('\n').at(-1), /dry_run=1/);
});

test('a repo with no Agent registry key still reaps, from .plot/agents', () => {
  // The single-checkout project that never set the key. The default must work,
  // or the fix only helps repos that configured a shared registry.
  const { repo } = makeRepo({ registry: '.plot/agents' });
  const wt = worktree(repo, 'feature/default');
  const file = manifest(path.join(repo, '.plot', 'agents'), 'sess-default', wt);

  run(repo, '--yes');

  assert.ok(!fs.existsSync(file), 'the default directory is resolved too');
});
