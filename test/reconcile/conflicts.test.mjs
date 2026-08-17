// Contract test for the conflict-prediction half of plot-fleet-scan.sh — WHICH
// files would collide merging a branch into the default branch, and whether the
// question was asked at all.
//
// The scan reports the SET and judges nothing. Which sets mean what — an
// artifact-only conflict resolves mechanically, a mixed one needs judgement —
// is decided one layer up, in packages/board/src/server/stuck.ts, and tested
// there. Principle 3: scripts collect and report.
//
// READ-ONLY. `git merge-tree --write-tree` computes the merge ENTIRELY IN
// MEMORY: no working tree, no index, no checkout. The conflict is FORESEEN, not
// present, and these tests hold that — the repo is compared byte for byte
// before and after the scan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

// The one path whose conflicts resolve mechanically. Spelled out rather than
// imported: this test asserts the SCAN reports it like any other file, and a
// shared constant would let the two drift into agreeing by accident.
const ARTIFACT = 'skills/plot/scripts/board/board-server.mjs';

let tmp, repo;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function write(rel, content) {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function scanJson() {
  const out = execFileSync('bash', [scan, '--offline', '--json'],
    { encoding: 'utf8', cwd: repo });
  return JSON.parse(out);
}
/** Every branch in the pulse, keyed by name. */
function branches(doc) {
  const map = new Map();
  for (const plan of doc.plans) {
    for (const wave of plan.waves) {
      for (const b of wave.branches) map.set(b.branch, b);
    }
  }
  return map;
}

/**
 * A branch that changes `files` off main, pushed. `main` is then moved on so the
 * two diverge — which is what makes a conflict possible at all.
 */
function branchChanging(name, files) {
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'checkout', '-qb', name);
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `work on ${name}`);
  git(repo, 'push', '-q', '-u', 'origin', name);
  git(repo, 'checkout', '-q', 'main');
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-conflicts-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  write('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`);
  write(ARTIFACT, 'export const built = 1;\n');
  write('src/app.ts', 'export const app = 1;\n');
  write('docs/notes.md', 'notes\n');

  write('plans/2026-01-01-conflicts.md', `# Conflict fixture

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Branches

### Wave
- \`feature/artifact-only\` — touches only the built artifact
- \`feature/artifact-plus\` — the artifact AND another file
- \`feature/real-conflict\` — a source file
- \`feature/clean\` — nothing anybody else touches
- \`feature/claim-only\` — claimed, no work yet <!-- claimed: 2026-01-02T09:00Z, s1 -->
- \`feature/never-pushed\` — no ref at all
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.symlinkSync('../2026-01-01-conflicts.md',
    path.join(repo, 'plans', 'active', 'conflicts.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan and sources');
  git(repo, 'push', '-q', 'origin', 'main');

  branchChanging('feature/artifact-only', { [ARTIFACT]: 'export const built = 2;\n' });
  branchChanging('feature/artifact-plus', {
    [ARTIFACT]: 'export const built = 3;\n',
    'src/app.ts': 'export const app = 3;\n',
  });
  branchChanging('feature/real-conflict', { 'src/app.ts': 'export const app = 4;\n' });
  branchChanging('feature/clean', { 'docs/only-here.md': 'untouched elsewhere\n' });

  // A claim is a PUSHED EMPTY COMMIT — nothing to merge, so nothing to predict.
  git(repo, 'checkout', '-qb', 'feature/claim-only');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/claim-only');
  git(repo, 'push', '-q', '-u', 'origin', 'feature/claim-only');
  git(repo, 'checkout', '-q', 'main');

  // MAIN MOVES, and this is what creates the conflicts: two branches editing
  // the same lines diverge only once both sides have changed.
  write(ARTIFACT, 'export const built = 99;\n');
  write('src/app.ts', 'export const app = 99;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'main moves on');
  git(repo, 'push', '-q', 'origin', 'main');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('conflicts: reports WHICH files would collide, not merely that some would', () => {
  // plot-merge-queue.sh has predicted conflicts since it was written and throws
  // the file list away — the right question for a merge ORDER and the wrong one
  // for a stuck branch. On 2026-08-17 two branches conflicted in exactly one
  // file whose resolution is mechanical while a third needed a person, and a
  // yes/no answer cannot tell those apart.
  const b = branches(scanJson());
  assert.deepEqual(b.get('feature/real-conflict').conflicts, ['src/app.ts']);
  assert.deepEqual(b.get('feature/artifact-only').conflicts, [ARTIFACT]);
});

test('conflicts: an artifact-only set is distinguishable from a mixed one', () => {
  // THE PAIRING THAT MATTERS, at the level that supplies the evidence: the two
  // sets must arrive DIFFERENT, or no classifier above can tell them apart.
  // An implementation reporting a boolean, or only the artifact when present,
  // makes both of these read alike.
  const b = branches(scanJson());
  const only = b.get('feature/artifact-only').conflicts;
  const mixed = b.get('feature/artifact-plus').conflicts;

  assert.deepEqual(only, [ARTIFACT]);
  assert.deepEqual(mixed, [ARTIFACT, 'src/app.ts'].sort());
  assert.notDeepEqual(only, mixed);
  // The distinguishing fact is the SIZE of the set, not the artifact's presence
  // in it — which is exactly what an "is the artifact among the conflicts?"
  // implementation would get wrong.
  assert.equal(only.length, 1);
  assert.ok(mixed.length > 1);
  assert.ok(mixed.includes(ARTIFACT));
});

test('conflicts: a branch that merges cleanly reports an empty, KNOWN set', () => {
  // Empty AND known is the only combination that means "merges cleanly".
  const b = branches(scanJson()).get('feature/clean');
  assert.deepEqual(b.conflicts, []);
  assert.equal(b.conflicts_known, true);
});

test('conflicts: absent is not clean — an unasked branch says so', () => {
  // The rule that is hardest to hold here, because an empty list is the shape
  // BOTH answers arrive in. Without `conflicts_known` a branch nobody could ask
  // reads exactly like one that merges cleanly.
  const b = branches(scanJson());
  // Never pushed: no ref, so nothing to merge and nothing observed.
  assert.equal(b.get('feature/never-pushed').conflicts_known, false);
  assert.deepEqual(b.get('feature/never-pushed').conflicts, []);
  // A bare claim carries no work, so the question does not arise.
  assert.equal(b.get('feature/claim-only').conflicts_known, false);
});

test('conflicts: changed paths travel as evidence', () => {
  // One of the three lines a CI failure is reported with. Nothing here maps a
  // failing step to a changed path — that table is unmaintained by
  // construction and goes silently wrong the first time a workflow is
  // restructured.
  const b = branches(scanJson()).get('feature/clean');
  assert.deepEqual(b.changed_paths, ['docs/only-here.md']);
});

test('conflicts: the scan writes NOTHING', () => {
  // merge-tree --write-tree computes in memory: no working tree, no index, no
  // checkout. The conflict is FORESEEN, not present — so the repository must be
  // byte-for-byte identical afterwards, on the very branches that conflict.
  const snapshot = () => ({
    status: git(repo, 'status', '--porcelain'),
    head: git(repo, 'rev-parse', 'HEAD'),
    refs: git(repo, 'for-each-ref', '--format=%(refname) %(objectname)'),
    branch: git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'),
    // MERGE_HEAD and friends: a real merge would leave these behind.
    merging: fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')),
    index: fs.statSync(path.join(repo, '.git', 'index')).mtimeMs,
  });
  const before = snapshot();
  scanJson();
  scanJson();
  const after = snapshot();
  assert.deepEqual(after, before);
  assert.equal(after.merging, false);
  assert.equal(after.status, '');
});

test('conflicts: stateless — a fresh run reaches identical conclusions', () => {
  // Every fact is re-derived from refs on each run. Nothing is remembered, so
  // there is no watcher state to become stale — which is exactly why the
  // watcher cannot drift from reality (Principle 1).
  const first = branches(scanJson());
  const second = branches(scanJson());
  for (const [name, b] of first) {
    assert.deepEqual(second.get(name).conflicts, b.conflicts, name);
    assert.deepEqual(second.get(name).conflicts_known, b.conflicts_known, name);
    assert.deepEqual(second.get(name).changed_paths, b.changed_paths, name);
  }
});

test('conflicts: the pulse is valid JSON with every branch carrying both fields', () => {
  // One absent-value shape for every consumer — the rule the local signals
  // already follow. A field present on some branches and missing on others
  // makes every reader write the same defensive check.
  for (const [name, b] of branches(scanJson())) {
    assert.ok(Array.isArray(b.conflicts), `${name} conflicts`);
    assert.equal(typeof b.conflicts_known, 'boolean', `${name} conflicts_known`);
    assert.ok(Array.isArray(b.changed_paths), `${name} changed_paths`);
  }
});

test('conflicts: a path containing a space is reported whole', () => {
  // The merge-tree info line is `<mode> <oid> <stage>\t<path>`, and the path is
  // everything after the TAB. Splitting on whitespace and taking the last field
  // works on every path in this repo and mangles `docs/my notes.md` into
  // `notes.md` — a wrong filename, silently, in the very report that decides
  // whether a set is "exactly the artifact".
  git(repo, 'checkout', '-q', 'main');
  write('docs/my notes.md', 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'add a spaced path');
  git(repo, 'push', '-q', 'origin', 'main');

  branchChanging('feature/spaced', { 'docs/my notes.md': 'theirs\n' });

  git(repo, 'checkout', '-q', 'main');
  write('docs/my notes.md', 'ours\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'main edits the spaced path');
  git(repo, 'push', '-q', 'origin', 'main');

  fs.appendFileSync(path.join(repo, 'plans', '2026-01-01-conflicts.md'),
    '- `feature/spaced` — a path with a space in it\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'name the spaced branch');
  git(repo, 'push', '-q', 'origin', 'main');

  const b = branches(scanJson()).get('feature/spaced');
  assert.deepEqual(b.conflicts, ['docs/my notes.md']);
});
