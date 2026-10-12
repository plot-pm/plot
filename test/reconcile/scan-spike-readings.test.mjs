// The scan carries the spike readings: `plot-fleet-scan.sh` reads `tracer`,
// `spike_approved_raw` and each branch's `spike` flag from plot-plan-meta.sh
// into its widened `P` row, puts `tracer` on the pulse plan, and appends three
// columns to each slice's verdict line: the slice's annotated branches, the
// `Spike approved:` record (1/0) and the plan's annotated branches. The verdict
// lines go to `plot-verdicts.mjs` on stdin and nowhere else, so a `node` shim
// on PATH records that stdin and hands it on unchanged. `--list-eligible` then
// shows what a Design plan with an approved spike offers: the spike alone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

let tmp, repo, json, calls, env;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });
const write = (rel, content) => {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-spike-'));
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

  write('plans/2026-01-03-tracer-plan.md', `# A tracer plan

## Status

- **Phase:** Approved
- **Type:** feature
- **Tracer:** yes
- **Spike approved:** 2026-10-12, jwloka

## Branches

### First
- \`feature/tracer-first\` — the first slice

### Second
- \`feature/tracer-spike\` — the spike <!-- spike -->

### Third
- \`feature/tracer-third\` — the last slice
`);

  write('plans/2026-01-04-plain-plan.md', `# A plain plan

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

### Only
- \`bug/plain-only\` — no marker
`);
  const design = (slug, slices) => write(`plans/2026-01-05-${slug}.md`, `# A design plan

## Status

- **Phase:** Design
- **Type:** feature
- **Spike approved:** 2026-10-12, jwloka

## Branches

${slices}
`);
  design('spike-alone', `### First
- \`feature/alone-spike\` — the spike <!-- spike -->

### Second
- \`feature/alone-rest\` — the rest
`);
  design('spike-sibling', `### First
- \`feature/shared-spike\` — the spike <!-- spike -->
- \`feature/shared-sibling\` — a sibling added after the approval
`);
  design('two-spikes', `### First
- \`feature/twin-one\` — one <!-- spike -->

### Second
- \`feature/twin-two\` — two <!-- spike -->
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');

  const bin = path.join(tmp, 'bin');
  const log = path.join(tmp, 'verdict-input.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'node'), `#!/bin/bash
case "$1" in
  */plot-verdicts.mjs)
    if [ $# -eq 1 ]; then
      printf '%s\\n' '--' >> '${log}'
      tee -a '${log}' | '${process.execPath}' "$@"
      exit
    fi ;;
esac
exec '${process.execPath}' "$@"
`, { mode: 0o755 });

  env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  delete env.PLOT_REPO_ROOT;
  delete env.PLOT_UNATTENDED;
  json = JSON.parse(execFileSync('bash', [scan, '--offline', '--json'], { encoding: 'utf8', cwd: repo, env }));
  calls = fs.readFileSync(log, 'utf8').split('--\n').filter(Boolean)
    .map((call) => call.split('\n').filter(Boolean).map((line) => line.split('\t')));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const planOf = (slug) => json.plans.find((p) => p.file.includes(slug));

test('scan: the pulse plan carries tracer for a Tracer: yes plan and omits it otherwise', () => {
  assert.equal(planOf('tracer-plan').tracer, true);
  assert.equal('tracer' in planOf('plain-plan'), false);
});

test('scan: the widened P row still reads the phase', () => {
  assert.equal(planOf('tracer-plan').phase, 'approved');
  assert.equal(planOf('plain-plan').phase, 'approved');
});

test('scan: spike reads 1 only on the slice holding the annotated branch', () => {
  const tracer = calls.find((lines) => lines.length === 3);
  assert.ok(tracer, `no three-slice verdict call in ${JSON.stringify(calls)}`);
  assert.deepEqual(tracer.map((cols) => cols.length), [6, 6, 6]);
  assert.deepEqual(tracer.map((cols) => cols[1]), ['approved', 'approved', 'approved']);
  assert.deepEqual(tracer.map((cols) => cols[3]), ['0', '1', '0']);
  assert.deepEqual(tracer.map((cols) => cols[5]), ['1', '1', '1']);
});

test('scan: spike_approved reads 1 for a plan with the record and 0 without', () => {
  const tracer = calls.find((lines) => lines.length === 3);
  const plain = calls.find((lines) => lines.length === 1 && lines[0][1] === 'approved');
  assert.deepEqual(tracer.map((cols) => cols[4]), ['1', '1', '1']);
  assert.deepEqual(plain.map((cols) => cols.slice(3)), [['0', '0', '0']]);
});

const offered = (slug) => {
  const r = spawnSync('bash', [scan, '--offline', '--list-eligible', slug], { encoding: 'utf8', cwd: repo, env });
  return r.stdout.split('\n').filter(Boolean);
};

test('scan: --list-eligible offers the approved spike of a Design plan and no other branch', () => {
  assert.deepEqual(offered('spike-alone'), ['feature/alone-spike']);
});

test('scan: --list-eligible offers neither branch of a spike slice that also names a sibling', () => {
  assert.deepEqual(offered('spike-sibling'), []);
});

test('scan: --list-eligible offers nothing for a Design plan with two spike annotations', () => {
  assert.deepEqual(offered('two-spikes'), []);
});
