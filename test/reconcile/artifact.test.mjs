// Contract test for the board artifact's merge strategy: .gitattributes
//
// `skills/plot/scripts/board/board-server.mjs` is generated output — 177 lines
// of roughly 4,500 characters each. Git merges line by line, so every board
// change, whatever source it came from, lands in the same handful of enormous
// lines. Two branches touching entirely disjoint sources still collide there.
//
// The strategy: mark the file `-merge` so git refuses to blend the two
// versions. It keeps one side WHOLE and reports the conflict without writing
// conflict markers into the file, so the artifact stays valid JavaScript and
// `pnpm build:board` settles it.
//
// These tests use the REAL artifact, copied from the repo. A small synthetic
// file would not reproduce the failure: the 177-line shape is what causes it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const ARTIFACT = path.join(REPO_ROOT, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs');
const ATTRIBUTES = path.join(REPO_ROOT, '.gitattributes');

// The path as it appears inside the sandbox repos, mirroring the real layout so
// the shipped .gitattributes pattern is what gets exercised.
const ART_REL = 'skills/plot/scripts/board/board-server.mjs';

let tmp;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

/** Run git, tolerating a non-zero exit (conflicts are expected outcomes here). */
function gitSoft(cwd, ...args) {
  try {
    return { code: 0, out: git(cwd, ...args) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/**
 * A sandbox repo shaped like plot: the real board artifact at its real path,
 * two disjoint source files, and — unless `withAttributes` is false — the
 * repo's own .gitattributes, copied rather than retyped so the test cannot
 * drift from what actually ships.
 */
function makeRepo({ withAttributes = true } = {}) {
  const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
  git(tmp, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.mkdirSync(path.join(repo, path.dirname(ART_REL)), { recursive: true });
  fs.copyFileSync(ARTIFACT, path.join(repo, ART_REL));
  fs.writeFileSync(path.join(repo, 'AgentList.tsx'), 'base\n');
  fs.writeFileSync(path.join(repo, 'index.ts'), 'base\n');
  if (withAttributes) fs.copyFileSync(ATTRIBUTES, path.join(repo, '.gitattributes'));

  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  return repo;
}

/**
 * Simulate what a board branch does: edit its own source, then REBUILD the
 * artifact. A rebuild changes the giant lines, which is precisely why two
 * branches collide there. Marking each side distinctly lets a test see which
 * side git kept.
 */
function boardBranch(repo, { branch, source, marker }) {
  git(repo, 'checkout', '-q', '-B', branch, 'main');
  fs.writeFileSync(path.join(repo, source), `${marker}\n`);
  const lines = fs.readFileSync(path.join(repo, ART_REL), 'utf8').split('\n');
  lines[4] = `/*${marker}*/${lines[4]}`;
  fs.writeFileSync(path.join(repo, ART_REL), lines.join('\n'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `${branch}: ${source} + rebuilt artifact`);
}

function artifactOf(repo) {
  return fs.readFileSync(path.join(repo, ART_REL), 'utf8');
}

/** Which branch's rebuild survived in the working tree — 'alpha', 'beta', or null. */
function sideKept(repo) {
  const line = artifactOf(repo).split('\n')[4];
  const m = line.match(/^\/\*(alpha|beta)\*\//);
  return m ? m[1] : null;
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-artifact-'));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ── The shape that causes the problem ────────────────────────────────────────

test('the artifact really is the pathological shape this strategy exists for', () => {
  const text = fs.readFileSync(ARTIFACT, 'utf8');
  const lines = text.split('\n');
  const avg = text.length / lines.length;

  assert.ok(
    avg > 1000,
    `board-server.mjs averages ${Math.round(avg)} chars/line; a line-based merge only ` +
      `misbehaves this way on very long lines. If this dropped, re-justify .gitattributes.`,
  );
});

// ── Done when: two board branches with disjoint sources merge cleanly ────────

test('two board branches touching disjoint sources leave the artifact whole and buildable', () => {
  const repo = makeRepo();
  boardBranch(repo, { branch: 'alpha', source: 'AgentList.tsx', marker: 'alpha' });
  boardBranch(repo, { branch: 'beta', source: 'index.ts', marker: 'beta' });

  git(repo, 'checkout', '-q', 'alpha');
  gitSoft(repo, 'merge', '--no-edit', 'beta');

  // The disjoint sources merge cleanly — they were never the problem.
  assert.equal(fs.readFileSync(path.join(repo, 'AgentList.tsx'), 'utf8'), 'alpha\n');
  assert.equal(fs.readFileSync(path.join(repo, 'index.ts'), 'utf8'), 'beta\n');

  // The artifact is the point: git kept ONE side whole rather than interleaving
  // the two. No markers means it is still valid JavaScript, so `pnpm
  // build:board` can run against it and overwrite it.
  const art = artifactOf(repo);
  assert.ok(!art.includes('<<<<<<<'), 'artifact must not contain conflict markers');
  assert.ok(!art.includes('>>>>>>>'), 'artifact must not contain conflict markers');
  assert.ok(sideKept(repo), 'artifact must be one side kept whole, not a blend');
  assert.equal(
    art.split('\n').length,
    fs.readFileSync(ARTIFACT, 'utf8').split('\n').length,
    'artifact keeps its original line count — nothing was spliced in',
  );
});

test('without the attribute the same merge corrupts the artifact — the failure being fixed', () => {
  const repo = makeRepo({ withAttributes: false });
  boardBranch(repo, { branch: 'alpha', source: 'AgentList.tsx', marker: 'alpha' });
  boardBranch(repo, { branch: 'beta', source: 'index.ts', marker: 'beta' });

  git(repo, 'checkout', '-q', 'alpha');
  gitSoft(repo, 'merge', '--no-edit', 'beta');

  // This is the control. It documents WHY .gitattributes earns its place: git
  // splices markers into the bundle, and 796 KB of unparseable JavaScript
  // cannot be rebuilt from or read.
  assert.ok(
    artifactOf(repo).includes('<<<<<<<'),
    'control: without -merge git writes conflict markers into the artifact',
  );
});

// ── Done when: the resolution never names a side ─────────────────────────────

test('a rebase and a merge produce the same committed artifact', () => {
  // "ours" inverts between merge and rebase, so a resolution phrased as "take
  // ours" means different things depending on how the branch was brought up to
  // date. Since the rebuild overwrites whatever was kept, the committed result
  // must be identical either way.
  const rebuilt = '/*rebuilt by pnpm build:board*/\n';

  const resolveByRebuilding = (repo) => {
    // Deliberately does NOT run `git checkout --ours/--theirs`: the resolution
    // is to overwrite with a rebuild, whichever side git happened to keep.
    fs.writeFileSync(path.join(repo, ART_REL), rebuilt);
    git(repo, 'add', ART_REL);
  };

  const merged = makeRepo();
  boardBranch(merged, { branch: 'alpha', source: 'AgentList.tsx', marker: 'alpha' });
  boardBranch(merged, { branch: 'beta', source: 'index.ts', marker: 'beta' });
  git(merged, 'checkout', '-q', 'alpha');
  gitSoft(merged, 'merge', '--no-edit', 'beta');
  const mergeSide = sideKept(merged);
  resolveByRebuilding(merged);
  git(merged, 'commit', '-qm', 'merge beta, artifact rebuilt');

  const rebased = makeRepo();
  boardBranch(rebased, { branch: 'alpha', source: 'AgentList.tsx', marker: 'alpha' });
  boardBranch(rebased, { branch: 'beta', source: 'index.ts', marker: 'beta' });
  git(rebased, 'checkout', '-q', 'alpha');
  gitSoft(rebased, 'rebase', 'beta');
  const rebaseSide = sideKept(rebased);
  resolveByRebuilding(rebased);
  gitSoft(rebased, '-c', 'core.editor=true', 'rebase', '--continue');

  // The premise: git kept DIFFERENT sides in the two flows. If this ever stops
  // holding, the side-neutrality requirement is no longer being tested.
  assert.equal(mergeSide, 'alpha', 'merge keeps the branch being merged into');
  assert.equal(rebaseSide, 'beta', 'rebase keeps the upstream — the inversion');
  assert.notEqual(mergeSide, rebaseSide, '"ours" must be shown to invert');

  // The requirement: despite that, the committed artifact is identical, because
  // the resolution rebuilds rather than picking a side.
  assert.equal(artifactOf(merged), rebuilt);
  assert.equal(artifactOf(rebased), rebuilt);
  assert.equal(
    git(merged, 'rev-parse', `HEAD:${ART_REL}`).trim(),
    git(rebased, 'rev-parse', `HEAD:${ART_REL}`).trim(),
    'merge and rebase must commit byte-identical artifacts',
  );
});

// ── Done when: works in a clone that configured nothing ──────────────────────

test('the strategy needs no local git config — it works in a bare fresh clone', () => {
  // A custom merge driver (`merge=rebuild`) passes on the author's machine and
  // silently does nothing on CI and fresh clones, because the driver DEFINITION
  // lives in each clone's git config while only .gitattributes is versioned.
  // This asserts the mechanism travels with the repo.
  const origin = makeRepo();
  boardBranch(origin, { branch: 'alpha', source: 'AgentList.tsx', marker: 'alpha' });
  boardBranch(origin, { branch: 'beta', source: 'index.ts', marker: 'beta' });
  git(origin, 'checkout', '-q', 'main');

  const clone = fs.mkdtempSync(path.join(tmp, 'clone-'));
  git(tmp, 'clone', '-q', origin, clone);
  git(clone, 'config', 'user.email', 'fresh@example.invalid');
  git(clone, 'config', 'user.name', 'Fresh Clone');
  git(clone, 'config', 'commit.gpgsign', 'false');

  // Nothing was configured here beyond identity. In particular, no merge driver.
  const drivers = gitSoft(clone, 'config', '--get-regexp', '^merge\\..*\\.driver');
  assert.equal(drivers.code, 1, `fresh clone must have no merge driver, got: ${drivers.out}`);

  git(clone, 'checkout', '-q', '-b', 'alpha', 'origin/alpha');
  gitSoft(clone, 'merge', '--no-edit', 'origin/beta');

  const art = artifactOf(clone);
  assert.ok(!art.includes('<<<<<<<'), 'attribute must take effect with no local config');
  assert.ok(sideKept(clone), 'artifact must be one side kept whole in a fresh clone');
});

// ── Done when: the CI gate survives the strategy ─────────────────────────────

test('the artifact stays in git and CI still gates its freshness', () => {
  // The strategy removes the CONFLICT; the gate still enforces CORRECTNESS.
  // Resolve by keeping a stale artifact and forget to rebuild, and CI must
  // fail — otherwise this trades a loud conflict for a silent regression.
  const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /pnpm run build:board/, 'CI must rebuild the artifact itself');
  assert.match(
    workflow,
    /git diff --quiet -- skills\/plot\/scripts\/board\/board-server\.mjs/,
    'CI must byte-diff the rebuilt artifact against the committed one',
  );

  // And the file must still be tracked: `pnpm board` starts it with no build
  // step and the plugin ships it. `-merge` changes how it merges, not whether
  // it exists.
  const tracked = git(REPO_ROOT, 'ls-files', '--', ART_REL).trim();
  assert.equal(tracked, ART_REL, 'the artifact must remain checked in');
});

test('a stale artifact is detectable exactly as CI detects it', () => {
  // Reproduce the gate's mechanism against a resolution that kept a stale
  // artifact: a rebuild produces a diff, and `git diff --quiet` reports it.
  const repo = makeRepo();
  boardBranch(repo, { branch: 'alpha', source: 'AgentList.tsx', marker: 'alpha' });

  // Stand in for `pnpm build:board`: the rebuild disagrees with what is committed.
  fs.writeFileSync(path.join(repo, ART_REL), '/*freshly rebuilt*/\n');

  const clean = gitSoft(repo, 'diff', '--quiet', '--', ART_REL);
  assert.equal(clean.code, 1, 'a stale committed artifact must make the CI no-diff check fail');
});

// ── What the strategy does NOT change ────────────────────────────────────────

test('merge-tree still predicts the artifact conflict — the strategy makes it harmless, not invisible', () => {
  // Worth pinning down, because it is easy to assume otherwise. `-merge`
  // changes how git RESOLVES the file, not whether it reports a conflict, so
  // `git merge-tree --write-tree` still exits non-zero for two board branches.
  //
  // plot-merge-queue.sh treats any non-zero exit as a collision, so it will go
  // on flagging every board pair even though the conflict is now settled by a
  // rebuild. That is a prediction-side concern, deliberately left to this
  // plan's second wave; this test exists so the behaviour is recorded rather
  // than rediscovered.
  const repo = makeRepo();
  boardBranch(repo, { branch: 'alpha', source: 'AgentList.tsx', marker: 'alpha' });
  boardBranch(repo, { branch: 'beta', source: 'index.ts', marker: 'beta' });

  const predicted = gitSoft(repo, 'merge-tree', '--write-tree', 'alpha', 'beta');
  assert.equal(predicted.code, 1, 'merge-tree still reports the artifact as conflicting');
  assert.match(predicted.out, /CONFLICT[\s\S]*board-server\.mjs/);
});

// ── The attribute itself ─────────────────────────────────────────────────────

test('.gitattributes marks the artifact -merge and names no side', () => {
  const attrs = fs.readFileSync(ATTRIBUTES, 'utf8');
  const rule = attrs
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .find((l) => l.includes('board-server.mjs'));

  assert.ok(rule, '.gitattributes must carry a rule for board-server.mjs');
  assert.match(rule, /(^|\s)-merge(\s|$)/, 'the rule must be -merge');

  // A `merge=<driver>` rule would name a driver that does not exist on CI or in
  // a fresh clone, and git would silently fall back to a normal merge.
  assert.doesNotMatch(rule, /\smerge=/, 'must not name a custom merge driver');

  // "ours"/"theirs" invert between merge and rebase, so any side-named strategy
  // is a bug waiting for a rebase.
  assert.doesNotMatch(rule, /merge=(ours|theirs)/, 'the strategy must not name a side');

  // git must actually resolve the attribute for that path — a typo'd pattern
  // is silent, and this test would otherwise pass on the literal text alone.
  const resolved = git(REPO_ROOT, 'check-attr', 'merge', '--', ART_REL).trim();
  assert.match(resolved, /merge: unset$/, `git must report merge unset, got: ${resolved}`);
});
