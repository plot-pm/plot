// Contract test for scripts/check-bundle-resolution.sh — the gate that keeps a
// shipped bundle resolved from its caller's own directory.
//
// `plot-fleetctl.sh` built `plot-registryd.mjs` from `$repo_root`, the
// consumer's checkout, and refused in every repository that consumes Plot as a
// plugin (#969). These tests pin both directions: the gate refuses that shape,
// it passes the script-relative forms the estate uses (including the inlined
// `BASH_SOURCE` one), and it passes `plot-board-probe.sh` only because that
// file is exempted by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-bundle-resolution.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/**
 * A throwaway tree holding one shell file at a chosen path under `skills/`,
 * where shipped shell lives — a file the gate does not walk proves nothing.
 */
const treeWith = (body, rel = 'skills/plot/scripts/demo.sh') => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-bundle-gate-'));
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  return dir;
};

test('bundle gate: refuses a bundle resolved against $repo_root', () => {
  // THE SHAPE #969 SHIPPED, planted verbatim.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'repo_root=$(git rev-parse --show-toplevel)',
    'registryd="$repo_root/skills/plot/scripts/board/plot-registryd.mjs"',
    '',
  ].join('\n'));
  const got = run(dir);
  assert.equal(got.status, 1, `a $repo_root bundle path must fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:3/, `and name the line:\n${got.stdout}`);
  assert.match(got.stdout, /script_dir=/, `and say how to resolve it instead:\n${got.stdout}`);
  rmSync(dir, { recursive: true, force: true });
});

test('bundle gate: refuses an inline git rev-parse root, and any other variable name', () => {
  for (const line of [
    'x="$(git rev-parse --show-toplevel)/skills/plot/scripts/board/plot-x.mjs"',
    'x="${top}/skills/plot/scripts/board/plot-x.mjs"',
  ]) {
    const dir = treeWith(`#!/usr/bin/env bash\n${line}\n`);
    const got = run(dir);
    assert.equal(got.status, 1, `must refuse: ${line}\n${got.stdout}`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bundle gate: passes the script-relative forms, including the inlined BASH_SOURCE one', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'bundle="$script_dir/board/plot-slice-pr.mjs"',
    'STANDING="$HERE/board/plot-standing.mjs"',
    '  | node "$here/board/plot-task.mjs"',
    // `plot-pr-merged.sh:105`, verbatim — correct, and the one form a
    // variable-name allowlist alone would misfire on.
    '_plot_landed_mjs="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/board/plot-landed.mjs"',
    '',
  ].join('\n'));
  const got = run(dir);
  assert.equal(got.status, 0, `script-relative forms must pass:\n${got.stdout}`);
  assert.match(got.stdout, /resolved beside their script: 4/);
  rmSync(dir, { recursive: true, force: true });
});

test('bundle gate: a comment or a message naming a bundle is not a composition', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    '# registryd="$repo_root/skills/plot/scripts/board/plot-registryd.mjs" was the bug',
    "printf 'is board/plot-sprint-score.mjs built?\\n' >&2",
    '',
  ].join('\n'));
  const got = run(dir);
  assert.equal(got.status, 0, got.stdout);
  rmSync(dir, { recursive: true, force: true });
});

test('bundle gate: plot-board-probe.sh passes only because it is exempted by name', () => {
  const probeLine = 'artifact="$git_root/skills/plot/scripts/board/board-server.mjs"';
  const exempt = treeWith(`#!/usr/bin/env bash\n${probeLine}\n`, 'skills/plot/scripts/plot-board-probe.sh');
  assert.equal(run(exempt).status, 0, 'the named exemption must hold');
  rmSync(exempt, { recursive: true, force: true });

  // THE SAME LINE UNDER ANY OTHER NAME FAILS, so the pass above is the
  // exemption and not a blind spot in the pattern.
  const other = treeWith(`#!/usr/bin/env bash\n${probeLine}\n`, 'skills/plot/scripts/plot-other.sh');
  assert.equal(run(other).status, 1, 'the probe line must fail outside the exempted file');
  rmSync(other, { recursive: true, force: true });

  const src = readFileSync(path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-board-probe.sh'), 'utf8');
  assert.match(src, /\$git_root\/skills\/plot\/scripts\/board\/board-server\.mjs/,
    'the exemption names a line that no longer exists — delete the exemption');
});

test("bundle gate: passes on the repository's own tree", () => {
  const got = run(repoRoot);
  assert.equal(got.status, 0, got.stdout);
  assert.match(got.stdout, /Bundle resolution: clean\./);
});
