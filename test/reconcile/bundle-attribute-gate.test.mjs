// Contract test for scripts/check-bundle-attributes.sh — the ratchet that stops
// the next unmarked bundle.
//
// A ratchet nobody can trip is a comment. The gate's whole claim is that a NEW
// `build.mjs` output added without its `-merge` line FAILS CI, so the assertion
// that matters is the one that adds one and watches it go red. That is this
// defect's own history replayed: `build.mjs` gained eight outputs after the
// attribute was written, and nothing anywhere asked about a single one.
//
// These tests pin the derivation (the build declares the set, never this
// script), the refusal, the deliberate absence of `plot-monitor.mjs`, and the
// two shapes a naive gate would get wrong — a marked-then-unmarked path, and a
// build whose declarations it can no longer find.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const rmTree = (dir) => rmSync(dir, { recursive: true, force: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-bundle-attributes.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/**
 * A shipped-bundle declaration in the shape `build.mjs` writes them.
 *
 * @param name - the `shippedX` suffix.
 * @param file - the artifact's basename.
 * @returns the declaration line.
 */
const declares = (name, file) =>
  `const shipped${name} = path.join(here, '../../skills/plot/scripts/board/${file}');`;

/**
 * A throwaway git repo holding a `build.mjs` and a `.gitattributes`.
 *
 * It is a real repo because the gate asks `git check-attr`, which reads
 * precedence and pattern syntax rather than the file's text — a fixture that
 * only wrote the file would prove nothing about what git actually resolves.
 *
 * @param outputs - `[shippedName, basename]` pairs the build declares.
 * @param attributes - the `.gitattributes` contents.
 * @returns the fixture root.
 */
function treeWith(outputs, attributes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-bundle-attr-'));
  spawnSync('git', ['init', '-q', dir]);
  mkdirSync(path.join(dir, 'packages', 'board'), { recursive: true });
  writeFileSync(
    path.join(dir, 'packages', 'board', 'build.mjs'),
    ["import path from 'node:path';", '', ...outputs.map(([n, f]) => declares(n, f)), ''].join('\n'),
  );
  writeFileSync(path.join(dir, '.gitattributes'), attributes);
  return dir;
}

/** Every output marked — the state this slice puts the repo in. */
const ALL = [
  ['Artifact', 'board-server.mjs'],
  ['Ask', 'plot-ask.mjs'],
];
const ALL_MARKED = ALL.map(([, f]) => `skills/plot/scripts/board/${f} -merge\n`).join('');

test('bundle gate: refuses a new output that was never marked', () => {
  // THE ASSERTION THE SLICE EXISTS FOR, and this defect's own history: a build
  // gains an output, `.gitattributes` is not touched, and nothing asks. The
  // next rebase splices conflict markers into generated JavaScript.
  const dir = treeWith([...ALL, ['Ninth', 'plot-ninth.mjs']], ALL_MARKED);

  const got = run(dir);
  assert.equal(got.status, 1, `an unmarked bundle must fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /plot-ninth\.mjs/, `and the failure must name it:\n${got.stdout}`);
  assert.match(got.stdout, /-merge/, `and say what to write:\n${got.stdout}`);

  rmTree(dir);
});

test('bundle gate: passes when every output is marked', () => {
  const dir = treeWith(ALL, ALL_MARKED);

  const got = run(dir);
  assert.equal(got.status, 0, `a fully marked set must pass:\n${got.stdout}`);
  assert.match(got.stdout, /bundles emitted .*: 2/, `and report the count:\n${got.stdout}`);

  rmTree(dir);
});

test('bundle gate: the set comes from the build, not from a list', () => {
  // If the gate carried its own list, that list would be a second place to
  // forget — the defect wearing a hat. Renaming an output in `build.mjs` alone
  // must move what the gate demands.
  const dir = treeWith([['Artifact', 'renamed.mjs']], ALL_MARKED);

  const got = run(dir);
  assert.equal(got.status, 1, `the build names the set:\n${got.stdout}`);
  assert.match(got.stdout, /renamed\.mjs/, `so the new name is demanded:\n${got.stdout}`);
  assert.doesNotMatch(got.stdout, /board-server\.mjs/,
    `and the old one is no longer asked for:\n${got.stdout}`);

  rmTree(dir);
});

test('bundle gate: a tracked file the build does not emit is not demanded', () => {
  // `plot-monitor.mjs` is committed and documented, and appears in no
  // `outfile`. Nothing rebuilds it, so it has no deterministic rebuild — which
  // is the entire licence for `-merge`. A gate that swept the directory instead
  // of reading the build would demand a mark asserting a rebuild that does not
  // exist.
  const dir = treeWith(ALL, ALL_MARKED);
  writeFileSync(path.join(dir, 'packages', 'board', 'monitor-note.txt'),
    'skills/plot/scripts/board/plot-monitor.mjs is tracked and never built\n');

  const got = run(dir);
  assert.equal(got.status, 0, `an unbuilt file is not this gate's business:\n${got.stdout}`);
  assert.doesNotMatch(got.stdout, /plot-monitor/, `and is never named:\n${got.stdout}`);

  rmTree(dir);
});

test('bundle gate: reads the attribute git resolves, not the line it is spelled on', () => {
  // `.gitattributes` has precedence and later-line override. A grep for the
  // path would call this bundle marked; git does not.
  const dir = treeWith(ALL,
    `${ALL_MARKED}skills/plot/scripts/board/plot-ask.mjs merge=text\n`);

  const got = run(dir);
  assert.equal(got.status, 1, `a later line unset the mark:\n${got.stdout}`);
  assert.match(got.stdout, /plot-ask\.mjs/, `and the bundle is unprotected:\n${got.stdout}`);

  rmTree(dir);
});

test('bundle gate: a build it cannot read is an error, never a pass', () => {
  // Finding no declarations means the build changed shape and the gate is now
  // blind. Reporting "clean" there is worse than the defect it was written for:
  // it is a green check over an unread file, forever.
  const dir = treeWith([], ALL_MARKED);

  const got = run(dir);
  assert.equal(got.status, 2, `a blind gate must not report clean:\n${got.stdout}`);
  assert.match(got.stdout, /no shipped bundles found/, `and must say so:\n${got.stdout}`);

  rmTree(dir);
});

test('bundle gate: this repo passes it', () => {
  // The gate runs in CI against this tree. A test that only exercised fixtures
  // would let the estate drift while every fixture still passed.
  const got = run(repoRoot);
  assert.equal(got.status, 0, `plot's own tree must be clean:\n${got.stdout}`);
});

// Moved from test/reconcile/resolveartifact.test.mjs by
// bug/the-artifact-repair-is-retired, which deleted the script that test was
// written for. These assertions are not about the script: they are about
// `bundles.generated.ts` staying fresh and equal to the set the build emits,
// which nothing else in this file checked.
test('build.mjs and the board contract name the same bundle set', () => {
  const root = path.join(here, '..', '..');

  // 1. THE SOURCE. The same derivation `scripts/check-bundle-attributes.sh`
  //    runs, so a third spelling of it cannot appear here either.
  const build = readFileSync(path.join(root, 'packages', 'board', 'build.mjs'), 'utf8');
  const emitted = [...build.matchAll(/shipped[A-Za-z]* = path\.join\([^)]*'\.\.\/\.\.\/([^']*)'\)/g)]
    .map((m) => m[1]).sort();
  assert.ok(emitted.length > 0, 'the derivation found no bundles — the build changed shape');

  // 2. THE CONTRACT DERIVES rather than lists, and what it derived must equal
  //    the source exactly. Equality in BOTH directions: a missing entry makes a
  //    licensed repair be refused, and an extra one claims a rebuild that does
  //    not exist.
  //
  //    The contract itself must carry NO list — that is the property this slice
  //    added, and asserting the generated file alone would pass just as well
  //    with a hand-written array beside it shadowing the re-export.
  const schema = readFileSync(
    path.join(root, 'packages', 'board', 'src', 'contract', 'schema.ts'), 'utf8');
  assert.doesNotMatch(schema, /BOARD_ARTIFACT_PATHS: readonly string\[\] = \[/,
    'the contract must derive the bundle set, never list it — that list drifted three times in one evening');
  assert.match(schema, /from '\.\/bundles\.generated\.js'/,
    'the contract must obtain the bundle set from the generated module');

  //    The generated module is what the contract re-exports, and it is
  //    COMMITTED: CI typechecks before it builds, so an ignored file would fail
  //    `tsc --noEmit` on a fresh clone. Committed, it can go stale — and a stale
  //    one is exactly what this comparison catches.
  const generated = readFileSync(
    path.join(root, 'packages', 'board', 'src', 'contract', 'bundles.generated.ts'), 'utf8');
  const declared = generated.match(/BOARD_ARTIFACT_PATHS: readonly string\[\] = \[([^\]]*)\]/);
  assert.ok(declared, 'bundles.generated.ts is not declared in the shape this test reads');
  const listed = [...declared[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, emitted,
    'bundles.generated.ts is stale — run `pnpm build:board` and commit the result');

  //    AND THE BUILD IS WHAT WRITES IT. Without this, a hand-edited generated
  //    file passes every assertion above for exactly as long as nobody adds a
  //    bundle — which is the original defect, moved one file across.
  assert.match(build, /bundles\.generated\.ts/,
    'build.mjs must write the generated module, or nothing keeps it fresh');

  // 3. EVERY DERIVED ENTRY IS A REAL FILE. The derivation reads `build.mjs` as
  //    TEXT, so any complete declaration written in a COMMENT is matched by it
  //    and lands in the set as a bundle nothing emits — and the pattern spans
  //    newlines, so a wrapped comment matches too.
  //
  //    Existence is the assertion rather than a shape match: a path that is not
  //    on disk is not a bundle, whatever it looks like.
  for (const bundle of emitted) {
    assert.ok(existsSync(path.join(root, bundle)),
      `the derivation produced ${JSON.stringify(bundle)}, which is not a file — `
      + 'a complete declaration written in a comment is matched by the derivation');
  }

  // 4. AND `.gitattributes` MARKS EVERY ONE — property 1, without which nothing
  //    here is licensed at all. `check-bundle-attributes.sh` is the gate; this
  //    asserts the same fact from the side that acts on it.
  const attrs = readFileSync(path.join(root, '.gitattributes'), 'utf8');
  for (const bundle of emitted) {
    assert.match(attrs, new RegExp(`^${bundle.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} -merge$`, 'm'),
      `${bundle} is emitted by the build and not marked -merge`);
  }

  // 5. `plot-monitor.mjs` IS NOT IN THE SET. `bug/the-loop-reports-idle`
  //    deletes the file outright, so this now holds trivially rather than
  //    guarding "tracked but unbuilt" the way it once did — kept rather than
  //    removed, because the natural mistake when widening a list is to sweep
  //    in every file in the directory, and the name still reads as the
  //    example the next author reaches for.
  assert.ok(!emitted.includes('skills/plot/scripts/board/plot-monitor.mjs'),
    'plot-monitor.mjs has no build output; including it asserts a rebuild that does not exist');
});
