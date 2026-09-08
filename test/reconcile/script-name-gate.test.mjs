// Contract test for scripts/check-script-names.sh — the gate that counts a
// `plot-*.sh` NAME outside `adapters/`, where the spawn ratchet counts calls.
//
// The distinction is the whole point and it is easy to lose. `ci.yml`'s *One
// place reaches a process* counts syscalls; `registry.ts` spawns `sh` ONCE and
// reaches a Plot script through it, so a syscall count can fall while the
// number of boundary crossings rises. These tests pin the properties that make
// this a second measurement rather than a second spelling of the first: it
// REFUSES a new name, it counts a name reached through a helper that no spawn
// gate can see, it does not fire on prose or on a comment, it ignores
// `adapters/`, it reads a file holding a NUL, and it passes on this repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-script-names.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/**
 * A throwaway tree holding one TypeScript file at a chosen path.
 *
 * The gate walks `packages/board/src` and `packages/domain/src`, so the fixture
 * puts its file where production code lives — a file in a directory the gate
 * ignores would prove nothing about the gate.
 *
 * The fixture's allowance is the repo's nine, so a fixture holding one name
 * sits far below the ratchet. Each refusal test therefore writes TEN names: the
 * subject under test is whether a name is COUNTED, and the ratchet is what
 * turns a count into an exit code.
 */
const treeWith = (body, rel = 'packages/board/src/server/demo.ts') => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-scriptname-'));
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  return dir;
};

/** Ten distinct script-name constants — one over the allowance. */
const tenNames = Array.from(
  { length: 10 },
  (_, i) => `const S${i} = 'plot-filler-${i}.sh';`,
).join('\n');

test('script-name gate: refuses a name that pushes the count over the allowance', () => {
  // THE CASE THE GATE EXISTS FOR — the eighth file, arriving unnoticed, exactly
  // as `supervisor-reading.ts` did hours after its own plan quoted the rule.
  const dir = treeWith(`${tenNames}\n`);

  const got = run(dir);
  assert.equal(got.status, 1, `a name over the allowance must fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.ts:1/, `and the failure must name the line:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('script-name gate: counts a name the spawn ratchet cannot see', () => {
  // THE MEASUREMENT THAT SEPARATES THIS GATE FROM THE ONE ABOVE IT IN ci.yml.
  // This file makes NO spawn call at all — the name is a constant handed to a
  // port. Every spawn-shaped gate reads it as clean; this one must not.
  const dir = treeWith([
    tenNames,
    "const WORKER_STATE_SCRIPT = 'plot-worker-state.sh';",
    'export const states = (worktrees) =>',
    '  scriptsShell(ctx).sourced(WORKER_STATE_SCRIPT, program, worktrees);',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `a name reached through a helper must count:\n${got.stdout}`);
  assert.match(got.stdout, /plot-worker-state\.sh/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('script-name gate: the error names the port that answers', () => {
  // A gate that says only *you crossed a line* leaves the reader to find the
  // seam. Two of the nine have a port answering them TODAY, and the sentence
  // must name it — verified against the adapter, not guessed from the name.
  const dir = treeWith([
    tenNames,
    "const WORKER_STATE_SCRIPT = 'plot-worker-state.sh';",
    "const FLEET_SCAN = 'plot-fleet-scan.sh';",
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, got.stdout);
  assert.match(got.stdout, /`processes` port answers this/,
    `plot-worker-state.sh must route to processes:\n${got.stdout}`);
  assert.match(got.stdout, /workerState/, got.stdout);
  assert.match(got.stdout, /`refs` port answers this/,
    `plot-fleet-scan.sh must route to refs:\n${got.stdout}`);
  assert.match(got.stdout, /pulse/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('script-name gate: says plainly where no port answers yet', () => {
  // SEVEN OF THE NINE ARE LIFECYCLE COMMANDS NO PORT ANSWERS. Naming an
  // invented seam would send the reader somewhere they cannot go, and inventing
  // seven ports to clear a gate is the gate driving the design.
  const dir = treeWith([
    tenNames,
    "const APPROVE_SCRIPT = 'plot-approve.sh';",
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, got.stdout);
  assert.match(got.stdout, /no port answers this yet/, got.stdout);
  assert.match(got.stdout, /plan-store` reads only/,
    `and say what it would take:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('script-name gate: a script named in advice is not a dependency', () => {
  // THE DISTINCTION THE QUOTE BOUNDARY DRAWS. Four sites on this tree name a
  // script inside a sentence an operator reads — `workflows/supervise.ts:203`
  // says *"restart it with `plot-dispatch.sh --restart`"*. That is the same
  // case `check-host-cli-callers.sh` excludes for `inspect: gh pr view`, and a
  // gate flagging it would be reverted on its first run.
  //
  // THE ASSERTION IS THE COUNT, NOT THE MESSAGE, and that distinction is what
  // gives this test teeth. An earlier version padded the fixture with fillers to
  // force a refusal and then asserted `doesNotMatch` on stdout — which passes
  // whether or not the boundary works, because a passing run prints no sites at
  // all. Verified by mutation: dropping the quotes from the pattern makes this
  // fixture count 2 where it must count 0, and only a count assertion sees it.
  //
  // Both lines are copied in shape from the tree: a backticked span inside a
  // template literal, and one inside a single-quoted string.
  const dir = treeWith([
    'export const advise = (branch) =>',
    '  `the supervisor gave up on ${branch}. Restart it with \\`plot-dispatch.sh --restart\\`, or defer it.`;',
    "export const detail =",
    "  'The board could not ask `plot-fleetctl.sh --status`, so nothing was established.';",
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `advice text must not fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /outside adapters\/: 0/,
    `a script named inside a sentence is not a dependency:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('script-name gate: a comment naming a script is not a dependency', () => {
  // COMMENTS ARE STRIPPED, on the precedent of *The domain names no vendor*.
  // 44 KB of this tree's mentions are TSDoc, nearly all of them arguments FOR
  // the boundary — `contract/schema.ts` explains eleven times why
  // `plot-plan-meta.sh` is the one parser. Matching those would delete the
  // explanations to satisfy the gate.
  const dir = treeWith([
    '/**',
    " * The contract between Plot's plan-format helper (`plot-plan-meta.sh`) and",
    ' * the board. `plot-plan-meta.sh` is the ONE parser of plan files.',
    ' */',
    "// const OLD = 'plot-deliver.sh';",
    'export const noop = () => undefined;',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `comments must not fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /outside adapters\/: 0/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('script-name gate: an adapter may name its script', () => {
  // THE EXCLUSION IS THE LAYER BOUNDARY MADE MECHANICAL, not a hole. An
  // adapter's whole job is to name the script it wraps; what the gate asserts
  // is that every module doing so lives in one directory.
  const dir = treeWith(
    `${tenNames}\n`,
    'packages/domain/src/adapters/processes/processes-shell.ts',
  );

  const got = run(dir);
  assert.equal(got.status, 0, `an adapter must be free to name a script:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('script-name gate: reads a file holding a NUL byte', () => {
  // MEASURED WHILE WRITING THIS GATE. `entities/finding.ts:112` uses a literal
  // NUL as a key separator in `findingKey`, so grep classified the file as
  // binary and printed `Binary file ... matches` INSTEAD OF THE LINE: it
  // counted as a site, named no line number, and hid the file's real content —
  // a TSDoc mention this gate must not flag. Without `-a`, any file gaining a
  // NUL becomes a place a violation can hide.
  //
  // The NUL is built rather than typed, so this file stays plain text.
  const nul = String.fromCharCode(0);
  const dir = treeWith([
    tenNames,
    'export const key = (f) =>',
    `  \`\${f.monitor}${nul}\${f.branch}\`;`,
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, got.stdout);
  assert.doesNotMatch(got.stdout, /Binary file/,
    `a NUL must not turn the file into one unreadable match:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.ts:1/,
    `and every site must still carry its line number:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('script-name gate: the ratchet reports when it can tighten', () => {
  // A RATCHET REPORTS SLACK OR IT NEVER TIGHTENS. `ci.yml:259` prints the same
  // notice, and it is how the number walks down instead of standing as a
  // budget nobody revisits.
  const dir = treeWith('export const noop = () => undefined;\n');

  const got = run(dir);
  assert.equal(got.status, 0, got.stdout);
  assert.match(got.stdout, /the ratchet can tighten/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test("script-name gate: the repo's own tree is clean", () => {
  // The gate must pass on this repo as it stands, or it lands red and gets
  // disabled rather than obeyed.
  const got = run(repoRoot);
  assert.equal(got.status, 0, `this repo must pass its own gate:\n${got.stdout}`);
  assert.match(got.stdout, /A script is named in an adapter: clean/, got.stdout);
});

test('script-name gate: the allowance matches what the tree holds', () => {
  // THE RATCHET IS A LITERAL ON PURPOSE — deriving it from the estate would
  // make the gate agree with whatever it found. This test is the other half:
  // an allowance sitting ABOVE the real count is slack nobody declared, and it
  // is how a gate quietly stops gating. It fails in the direction that matters,
  // leaving the fix as one visible line in a diff.
  const src = readFileSync(gate, 'utf8');
  const declared = Number(/^ALLOWED=(\d+)$/m.exec(src)?.[1]);
  assert.ok(Number.isInteger(declared), 'the gate must declare a literal allowance');

  const got = run(repoRoot);
  const actual = Number(/outside adapters\/: (\d+)/.exec(got.stdout)?.[1]);
  assert.ok(Number.isInteger(actual), `the gate must report its count:\n${got.stdout}`);

  assert.equal(actual, declared,
    `the allowance is ${declared} and the tree holds ${actual}. `
    + 'Lower it — a ratchet with slack is a budget.');
});
