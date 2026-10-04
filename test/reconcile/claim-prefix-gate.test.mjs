// Contract test for scripts/check-claim-prefix-comparison.sh — the gate that
// keeps the claim-prefix comparison in rules/empty-claim.ts and nowhere else.
//
// A claim marker is a commit titled `plot: claim ` AND empty (its tree equals
// its first parent's). The plan's first draft tested the subject alone, and a
// commit titled "plot: claim handling refactor" that changes a file would then
// read as an empty claim marker — the reason the comparison has one home. This
// gate refuses a second TypeScript comparison of the prefix; it does not touch
// the shell's own, separately declared duplicate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-claim-prefix-comparison.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/** A throwaway tree holding one TypeScript file with one claim-prefix comparison. */
function treeWith(body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-claim-gate-'));
  mkdirSync(path.join(dir, 'packages', 'domain', 'src', 'rules'), { recursive: true });
  writeFileSync(path.join(dir, 'packages', 'domain', 'src', 'rules', 'fake.ts'), body);
  return dir;
}

test('claim-prefix gate: refuses a startsWith comparison outside empty-claim.ts', () => {
  const dir = treeWith(
    [
      "export const isClaimLike = (subject: string): boolean =>",
      "  subject.startsWith('plot: claim ');",
      '',
    ].join('\n'),
  );

  const got = run(dir);
  assert.equal(got.status, 1, `an undeclared site must fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /fake\.ts:2/, `and the failure must name the line:\n${got.stdout}`);
  assert.match(
    got.stdout,
    /empty-claim\.ts/,
    `and say where the right answer lives:\n${got.stdout}`,
  );

  rmSync(dir, { recursive: true, force: true });
});

test('claim-prefix gate: refuses a case comparison outside empty-claim.ts', () => {
  const dir = treeWith(
    [
      'export const classify = (subject: string) => {',
      "  switch (subject) {",
      "    case 'plot: claim x': return 'claim';",
      "    default: return 'work';",
      '  }',
      '};',
      '',
    ].join('\n'),
  );

  const got = run(dir);
  assert.equal(got.status, 1, `a switch/case comparison must fail the build:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('claim-prefix gate: a mention with no comparison shape passes', () => {
  // The vocabulary is explained in prose throughout this repo's domain code —
  // a gate flagging every mention would be reverted on its first run.
  const dir = treeWith(
    [
      '/**',
      ' * A claim marker is titled `plot: claim ` and carries no file change.',
      ' */',
      "export const CLAIM_PREFIX_NOTE = 'see rules/empty-claim.ts';",
      '',
    ].join('\n'),
  );

  const got = run(dir);
  assert.equal(got.status, 0, `a plain mention must not fail the build:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('claim-prefix gate: a write (not a comparison) passes', () => {
  // `plot-worker-loop.sh`'s `git commit -m "plot: claim $next_branch"` WRITES
  // the subject; it is not a comparison, and this gate must not refuse it.
  const dir = treeWith(
    [
      "export const claimCommand = (branch: string): string =>",
      "  `git commit --allow-empty -m \"plot: claim ${branch}\"`;",
      '',
    ].join('\n'),
  );

  const got = run(dir);
  assert.equal(got.status, 0, `a write must not fail the build:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('claim-prefix gate: accepts a comparison inside empty-claim.ts itself', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-claim-gate-'));
  mkdirSync(path.join(dir, 'packages', 'domain', 'src', 'rules'), { recursive: true });
  writeFileSync(
    path.join(dir, 'packages', 'domain', 'src', 'rules', 'empty-claim.ts'),
    [
      "export const isEmptyClaim = ({ subject, tree, parentTree }) =>",
      "  subject.startsWith('plot: claim ') && tree !== '' && tree === parentTree;",
      '',
    ].join('\n'),
  );

  const got = run(dir);
  assert.equal(got.status, 0, `the home file's own comparison must pass:\n${got.stdout}`);
  assert.match(got.stdout, /checked 1 site/, `and be counted:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('claim-prefix gate: this repo passes it', () => {
  // The gate runs in CI against this tree. A test that only exercised
  // fixtures would let the repo drift while every fixture still passed.
  const got = run(repoRoot);
  assert.equal(got.status, 0, `plot's own tree must be clean:\n${got.stdout}`);
});
