// The scan carries the spike readings: `plot-fleet-scan.sh` puts `tracer` on
// the pulse plan, and its widened `P` row still reads the phase.
// `--list-eligible` offers the approved spike of a Design plan alone, and
// nothing where the spike shares its slice or the plan holds two annotations.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

let tmp, repo, json, env;

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
  const design = (slug, branch, slices) => write(`plans/2026-01-05-${slug}.md`, `# A design plan

## Status

- **Phase:** Design
- **Type:** feature
- **Spike approved:** 2026-10-12, jwloka, in-session, ${branch}

## Branches

${slices}
`);
  design('spike-alone', 'feature/alone-spike', `### First
- \`feature/alone-spike\` — the spike <!-- spike -->

### Second
- \`feature/alone-rest\` — the rest
`);
  design('spike-sibling', 'feature/shared-spike', `### First
- \`feature/shared-spike\` — the spike <!-- spike -->
- \`feature/shared-sibling\` — a sibling added after the approval
`);
  design('two-spikes', 'feature/twin-one', `### First
- \`feature/twin-one\` — one <!-- spike -->

### Second
- \`feature/twin-two\` — two <!-- spike -->
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');

  env = { ...process.env };
  delete env.PLOT_REPO_ROOT;
  delete env.PLOT_UNATTENDED;
  json = JSON.parse(execFileSync('bash', [scan, '--offline', '--json'], { encoding: 'utf8', cwd: repo, env }));
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
