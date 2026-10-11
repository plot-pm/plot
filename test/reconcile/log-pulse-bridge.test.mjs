// Contract test for the bridge write of `plot-fleet-scan.sh --log-pulse`.
//
// The fleet's `writeScan` is the bridge's one writer while a fleet runs
// (`ports/fleet-state.ts`). `--log-pulse` asks `plot-delta.mjs --held`, which
// calls `fleetHoldsBridge`, and leaves a fresh bridge that carries timer facts
// to the fleet. A missing, thin or stale bridge has no live writer, so a
// repository with no board and no fleet still records its pulse history
// (DESIGN-process.md §1). Answers #1445 L6.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

/** Two minutes: inside `OWNED_BRIDGE_MAX_AGE_MS` (180 s) and inside the delta's 15-minute window. */
const FRESH_AGE_MS = 120_000;
/** Five minutes: past `OWNED_BRIDGE_MAX_AGE_MS` and still inside the delta's window. */
const STALE_AGE_MS = 300_000;

let tmp;
let repo;
let plan;
let planText;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });

const bridgeFile = () => path.join(repo, '.plot', 'state', 'last-pulse.json');

const pulse = () => {
  const env = { ...process.env };
  delete env.PLOT_REPO_ROOT;
  delete env.PLOT_SCAN_RECORD;
  return execFileSync('bash', [scan, '--offline', '--log-pulse'], { encoding: 'utf8', cwd: repo, env });
};

/** A bridge as the scan writes it: the pulse and no timer facts. */
const thinBridge = () => {
  fs.rmSync(path.join(repo, '.plot'), { recursive: true, force: true });
  fs.writeFileSync(plan, planText);
  pulse();
  return JSON.parse(fs.readFileSync(bridgeFile(), 'utf8'));
};

/** The same pulse as the fleet's `writeScan` writes it: with timer facts, at `ageMs` old. */
const fleetBridge = (ageMs) => {
  const doc = thinBridge();
  doc.at = Date.now() - ageMs;
  doc.ages = [['feature/only', 5]];
  doc.branchUrlBase = 'https://example.invalid/tree/';
  const text = JSON.stringify(doc);
  fs.writeFileSync(bridgeFile(), text);
  return text;
};

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-log-pulse-bridge-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repo, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Branch prefixes:** feature/\n');
  plan = path.join(repo, 'plans', '2026-01-01-only.md');
  planText = ['# Only', '', '## Status', '', '- **Phase:** Approved', '- **Type:** feature', '',
    '## Branches', '', '### Only (Branch: feature/only)', '', '## Notes', ''].join('\n');
  fs.writeFileSync(plan, planText);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'one plan');
  git(repo, 'push', '-q', 'origin', 'main');
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('log-pulse bridge: a fresh bridge from the fleet stays byte-identical, and the delta still reads it', () => {
  const before = fleetBridge(FRESH_AGE_MS);
  const out = pulse();
  assert.equal(fs.readFileSync(bridgeFile(), 'utf8'), before, 'the fleet holds the bridge');
  assert.match(out, /Nothing changed since your last pulse \(2 minutes ago\)/);
  assert.match(out, /Pulse complete/);
});

test('log-pulse bridge: a fresh thin bridge is replaced, so pulses without a fleet keep their history', () => {
  const doc = thinBridge();
  doc.at = Date.now() - FRESH_AGE_MS;
  fs.writeFileSync(bridgeFile(), JSON.stringify(doc));
  const out = pulse();
  const after = JSON.parse(fs.readFileSync(bridgeFile(), 'utf8'));
  assert.ok(after.at > doc.at, 'the pulse wrote a new bridge');
  assert.match(out, /Nothing changed since your last pulse \(2 minutes ago\)/);
});

test('log-pulse bridge: a stale bridge from a stopped fleet is replaced', () => {
  const before = fleetBridge(STALE_AGE_MS);
  pulse();
  const after = JSON.parse(fs.readFileSync(bridgeFile(), 'utf8'));
  assert.ok(after.at > JSON.parse(before).at, 'the pulse wrote a new bridge');
  assert.deepEqual(after.ages, [], 'the new bridge is the scan\'s own');
});

test('log-pulse bridge: no bridge is written as the first one', () => {
  fs.rmSync(path.join(repo, '.plot'), { recursive: true, force: true });
  const out = pulse();
  assert.ok(fs.existsSync(bridgeFile()), 'the pulse wrote the bridge');
  assert.match(out, /No previous pulse on this machine/);
});
