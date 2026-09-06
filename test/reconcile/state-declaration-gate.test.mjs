// Contract test for scripts/check-state-declarations.sh — the ratchet that
// stops the next hidden lifecycle.
//
// A ratchet nobody can trip is a comment. The gate's whole claim is that an
// enum added without a declaration FAILS CI, so the assertion that matters is
// the one that adds one and watches it go red.
//
// The other half is the pair: a `lifecycle` marker with no `transitions/*.ts`
// behind it is a lifecycle declared and never written, and the file check alone
// cannot see which enum it covers. These tests pin both halves, the three
// marker kinds, the window, and the two shapes a naive gate would skip — an
// inline field enum with no exported name, and a file grep calls binary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const rmTree = (dir) => rmSync(dir, { recursive: true, force: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-state-declarations.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/**
 * A throwaway tree holding one domain entity file, and any transitions rules named.
 *
 * The gate walks `packages/domain/src`, so the fixture puts its file where the
 * domain's state lives — a fixture in a directory the gate ignores would prove
 * nothing about the gate.
 *
 * @param body - the entity file's contents.
 * @param rules - transitions rules to create, by entity name.
 * @returns the fixture root.
 */
function treeWith(body, rules = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-state-decl-'));
  const src = path.join(dir, 'packages', 'domain', 'src');
  mkdirSync(path.join(src, 'entities'), { recursive: true });
  mkdirSync(path.join(src, 'transitions'), { recursive: true });
  writeFileSync(path.join(src, 'entities', 'demo.ts'), body);
  for (const rule of rules) {
    writeFileSync(path.join(src, 'transitions', `${rule}.ts`), 'export const NEXT = {};\n');
  }
  return dir;
}

test('state gate: refuses an enum that declares nothing', () => {
  // The assertion the slice exists for. Nothing about this enum says whether
  // `retired` may become `active` again, and nothing refuses it either.
  const dir = treeWith([
    "import { z } from 'zod';",
    '',
    "export const DemoStateSchema = z.enum(['fresh', 'active', 'retired']);",
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `an undeclared enum must fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.ts:3/, `and the failure must name the line:\n${got.stdout}`);
  assert.match(got.stdout, /plot-state: lifecycle/,
    `and say what a declaration looks like:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: accepts a reading', () => {
  const dir = treeWith([
    "import { z } from 'zod';",
    '',
    '// plot-state: reading — what the host answered when asked; re-read on every',
    '//                       pulse and never advanced.',
    "export const HostAnswerSchema = z.enum(['ok', 'failed', 'unknown']);",
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a declared enum must pass:\n${got.stdout}`);
  assert.match(got.stdout, /reading=1/, `and be counted by kind:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: accepts a classification', () => {
  const dir = treeWith([
    "import { z } from 'zod';",
    '',
    '// plot-state: classification — a priority. A Could becoming a Must is a',
    '//                              re-prioritisation, not a transition.',
    "export const TierSchema = z.enum(['must', 'should', 'could']);",
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a declared enum must pass:\n${got.stdout}`);
  assert.match(got.stdout, /classification=1/, `and be counted by kind:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: a lifecycle without its rule counts against the debt', () => {
  // Marker alone would let a lifecycle be declared and never written, so the
  // debt is counted and the missing rule is NAMED — the report is what a reader
  // acts on.
  //
  // IT NOW REFUSES, AND THAT IS THE RATCHET ARRIVING. `LIFECYCLE_DEBT` shipped
  // at 6, the six the gate found the day it merged, and reached 0 on 2026-09-06
  // when each got its `transitions/*.ts`. This case asserted `status: 0` on
  // *"one owed rule is inside the ceiling"*, which was true of every ceiling
  // above zero and is the assertion the floor was lowered to break. The
  // reporting half is unchanged; what a reader gains is that the report is now
  // also a stop.
  const dir = treeWith([
    "import { z } from 'zod';",
    '',
    '// plot-state: lifecycle demo — fresh, then active, then retired, and never',
    '//                             backwards.',
    "export const DemoStateSchema = z.enum(['fresh', 'active', 'retired']);",
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `an owed rule is over a floor of zero:\n${got.stdout}`);
  assert.match(got.stdout, /lifecycles awaiting a rule: 1/,
    `and must be reported rather than hidden:\n${got.stdout}`);
  assert.match(got.stdout, /no transitions\/demo\.ts/,
    `naming the rule that is missing:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: a lifecycle WITH its rule owes nothing', () => {
  const dir = treeWith([
    "import { z } from 'zod';",
    '',
    '// plot-state: lifecycle demo — fresh, then active, then retired, and never',
    '//                             backwards.',
    "export const DemoStateSchema = z.enum(['fresh', 'active', 'retired']);",
    '',
  ].join('\n'), ['demo']);

  const got = run(dir);
  assert.equal(got.status, 0, `a declared lifecycle with a rule must pass:\n${got.stdout}`);
  assert.match(got.stdout, /lifecycle=1/, `and be counted:\n${got.stdout}`);
  assert.doesNotMatch(got.stdout, /awaiting a rule/,
    `and owe nothing:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: the rule is named by the DECLARATION, not by the file', () => {
  // `rules/phase.ts` declares the Plan's lifecycle and no path derives that.
  // A gate keying on the enum's own filename would demand `transitions/demo.ts`
  // here and never find the rule that exists.
  const dir = treeWith([
    "import { z } from 'zod';",
    '',
    '// plot-state: lifecycle plan — the phase a plan is written through.',
    "export const PlanStatusSchema = z.enum(['draft', 'approved', 'delivered']);",
    '',
  ].join('\n'), ['plan']);

  const got = run(dir);
  assert.equal(got.status, 0, `the declaration names the rule:\n${got.stdout}`);
  assert.doesNotMatch(got.stdout, /awaiting a rule/,
    `and it was found:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: a declaration must sit BESIDE the enum', () => {
  // A marker at the top of a file is a claim about a FILE, and a file cannot
  // carry this: `entities/sprint.ts` holds one lifecycle and two things that
  // must never have one.
  const dir = treeWith([
    "import { z } from 'zod';",
    '// plot-state: classification — a claim made far from anything it describes.',
    '',
    '',
    '',
    '',
    '',
    "export const DemoStateSchema = z.enum(['fresh', 'active']);",
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `a distant marker declares nothing:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: each enum in a file declares for itself', () => {
  // The unit is the enum. One declared neighbour must not license the next —
  // this is the `sprint.ts` shape, where a file-level answer would cover a
  // lifecycle and two non-lifecycles alike.
  const dir = treeWith([
    "import { z } from 'zod';",
    '',
    '// plot-state: classification — a priority, not an order.',
    "export const TierSchema = z.enum(['must', 'should']);",
    '',
    "export const DemoStateSchema = z.enum(['fresh', 'active']);",
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `the second enum declared nothing:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.ts:6/, `and it is the one named:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: an inline field enum has no name and is still counted', () => {
  // Two of this repo's occurrences are inline — `charter.ts` `atCeiling` and
  // `fleet.ts` `host`. A gate matching `export const …Schema = z.enum(` would
  // report a clean estate while skipping exactly those.
  const dir = treeWith([
    "import { z } from 'zod';",
    '',
    'export const BoundsSchema = z.object({',
    "  atCeiling: z.enum(['finish', 'end']).default('finish'),",
    '});',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `an inline enum is an occurrence:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.ts:4/, `and must be named:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: a NUL byte does not hide an enum', () => {
  // `entities/finding.ts:104` composes a key as `${monitor}\0${branch}`, so
  // grep calls the file binary and prints `Binary file … matches` instead of
  // its lines. It was hiding two real enums from every count taken for this
  // slice. Without `-a` this fixture passes, which is the whole failure.
  const dir = treeWith([
    "import { z } from 'zod';",
    '',
    'export const key = (a: string, b: string): string => `${a} ${b}`;',
    '',
    "export const DemoStateSchema = z.enum(['fresh', 'active']);",
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `a NUL byte must not blind the gate:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.ts:5/, `and the enum must still be named:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: prose ABOUT an enum is not an enum', () => {
  // This repo carries a great deal of comment explaining these enums. A gate
  // that forced it out would remove the reasoning and leave the declarations.
  const dir = treeWith([
    "import { z } from 'zod';",
    '',
    '// This used to be `z.enum([...])` and is a union now. See the plan for why',
    '// a z.enum( here would have been parsed rather than validated.',
    'export type Demo = "fresh" | "active";',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `prose must not fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /lifecycle=0 reading=0 classification=0/,
    `and nothing was counted:\n${got.stdout}`);

  rmTree(dir);
});

test('state gate: this repo passes it', () => {
  // The gate runs in CI against this tree. A test that only exercised fixtures
  // would let the estate drift while every fixture still passed.
  const got = run(repoRoot);
  assert.equal(got.status, 0, `plot's own tree must be clean:\n${got.stdout}`);
});
