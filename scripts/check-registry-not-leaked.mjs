#!/usr/bin/env node
// THE GATE THAT CATCHES THE NEXT TEST THAT FORGETS.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IT REFUSES
// ═══════════════════════════════════════════════════════════════════════════
//
// A manifest in THIS repository's agent registry whose recorded `worktree`
// lies under the system temp directory. A real desk lives under the configured
// `Worktree root`; only a test fixture builds one in `mkdtemp` territory. So a
// temp-dir desk in the host's registry is a sandboxed test that wrote where
// the host reads — the defect `a-sandbox-does-not-inherit-its-host` locks.
//
// Measured 2026-09-25: 19 of 20 manifests here were fixtures, against three
// real desks, and the board rendered each one as an agent row.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS DISCRIMINATOR AND NOT "THE REGISTRY IS UNCHANGED"
// ═══════════════════════════════════════════════════════════════════════════
//
// The obvious alternative — snapshot the registry before the suite and compare
// after — IS UNIMPLEMENTABLE HERE, and would be worse than nothing. The
// supervisor runs under launchd with `KeepAlive: true` and
// `plot-registryd.mjs --start-agents` writes manifests on its own schedule. A
// snapshot gate flags those honest writes, fails a green suite, and gets
// turned off. Two such manifests were measured being written mid-session while
// this defect was being investigated.
//
// This discriminator reads a PROPERTY OF EACH MANIFEST instead, so a live
// agent starting mid-run is invisible to it: that agent's desk is under the
// `Worktree root`, which is not the temp directory. The gate tolerates a fleet
// doing its job and refuses only the shape a fixture leaves behind.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY A POST-SUITE CHECK AND NOT AN ASSERTION IN THE HELPERS
// ═══════════════════════════════════════════════════════════════════════════
//
// The slice was free to choose either. A helper assertion names the culprit
// test, which is genuinely better diagnostics — but it can only ever cover the
// helpers it is written into, and A TEST THAT FORGETS IS PRECISELY ONE THAT
// DOES NOT ROUTE THROUGH THEM. Measured on this estate: 50 of 94 files in
// `test/reconcile/` build an env over `...process.env`, and 5 scrub. A gate
// living in the three fixed helpers would be blind to the other 45.
//
// This check reads the registry once, after everything has run, and sees a
// leak from any file by any route. It pays for that with a coarser report —
// it names the manifest and its desk, not the test — so it prints the desk
// path, which is what a person greps for.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY IT IS CHAINED TO `test:contracts` AND NOT ADDED AS A CI STEP
// ═══════════════════════════════════════════════════════════════════════════
//
// CI NEVER SETS `PLOT_REPO_ROOT`, so the leak cannot happen there and a
// CI-only gate is always green. The defect appears only where a worker runs
// the suite — inside a dispatched agent's desk, which is where most of this
// repository's test runs actually happen. So the gate runs wherever
// `pnpm run test:contracts` runs, worker desks included.
//
// It is also not a `*.test.mjs` file: `node --test` runs files concurrently,
// so a gate written as one more test file has no guarantee of running after
// the tests that leak.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const config = path.join(root, 'skills', 'plot', 'scripts', 'plot-config.sh');

// THE REGISTRY IS ASKED FOR, NEVER ASSUMED. A checkout may configure `Agent
// registry` anywhere, and this repository points several worktrees at one
// shared directory — which is the whole reason a leak here is visible from
// every desk. `PLOT_REPO_ROOT` is scrubbed from the question for the same
// reason every test scrubs it: this gate asks about THIS checkout.
const ask = () => {
  const env = { ...process.env };
  delete env.PLOT_REPO_ROOT;
  try {
    return execFileSync('bash', [config, 'get', 'Agent registry', '.plot/agents'],
      { encoding: 'utf8', cwd: root, env }).trim();
  } catch {
    return '';
  }
};

const raw = ask();
if (!raw) {
  // A registry that cannot be asked for is a broken installation, not a leak.
  // Say so and permit: this gate refuses a measurement, never an absence.
  console.log('registry-leak: not evaluated — `Agent registry` could not be read');
  process.exit(0);
}
const registry = path.isAbsolute(raw) ? raw : path.join(root, raw);
if (!fs.existsSync(registry)) {
  console.log(`registry-leak: none (no registry at ${registry})`);
  process.exit(0);
}

// BOTH SIDES ARE REALPATH'D. On macOS `os.tmpdir()` answers `/var/folders/…`
// while a recorded desk path reads `/private/var/folders/…` — the same
// directory through a symlink. A raw string compare misses every fixture on
// this platform, which is the one the defect was measured on.
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

// "THE SYSTEM TEMP DIRECTORY" IS A SET HERE, NOT A PATH. On macOS `os.tmpdir()`
// is the per-user `/var/folders/…/T`, and `/tmp` is a SEPARATE temp root
// symlinked to `/private/tmp`. The plan's own measurement names both forms.
// Measured while testing this gate: a fixture desk under `/tmp` was reported
// clean by a check that knew only `os.tmpdir()` — the gate could not fail on
// half the population it exists to catch. `TMPDIR` is read too, since a runner
// that overrides it puts fixtures somewhere neither constant names.
const tmpRoots = [...new Set(
  [os.tmpdir(), process.env.TMPDIR, '/tmp', '/var/tmp']
    .filter((p) => typeof p === 'string' && p !== '')
    .filter((p) => fs.existsSync(p))
    .map(real),
)];
const under = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const inTemp = (p) => tmpRoots.some((dir) => under(p, dir));

const leaked = [];
for (const name of fs.readdirSync(registry).filter((n) => n.endsWith('.json'))) {
  const file = path.join(registry, name);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // A half-written manifest is not a leak. The writer stages through
    // `.json.plot-pid-tmp` and renames, so a torn read here is a race with an
    // honest write, and the next run reads it whole.
    continue;
  }
  const wt = manifest?.worktree;
  if (typeof wt !== 'string' || wt === '') continue;
  if (inTemp(real(wt))) leaked.push({ name, wt, branch: manifest.branch ?? '' });
}

if (leaked.length === 0) {
  console.log(`registry-leak: none (${registry})`);
  process.exit(0);
}

console.error(`registry-leak: ${leaked.length} manifest(s) in ${registry} name a desk under a system temp root`);
console.error(`  temp roots: ${tmpRoots.join(', ')}`);
console.error('');
console.error('A sandboxed test wrote into this repository\'s agent registry. Its desk is a');
console.error('temp directory, so the manifest is a fixture the board will render as an agent.');
console.error('');
for (const l of leaked) {
  console.error(`  ${l.name}`);
  console.error(`    worktree: ${l.wt}`);
  if (l.branch) console.error(`    branch:   ${l.branch}`);
}
console.error('');
console.error('The cause is an inherited `PLOT_REPO_ROOT`. A test that builds a sandbox must');
console.error('scrub it from the environment it hands to a Plot script:');
console.error('');
console.error('    const env = { ...process.env, ...(opts.env ?? {}) };');
console.error('    delete env.PLOT_REPO_ROOT;');
console.error('');
console.error('The delete follows the caller\'s spread, or a caller puts the variable back.');
console.error('See test/reconcile/sandbox-scrubs-repo-root.test.mjs for the reasoning.');
process.exit(1);
