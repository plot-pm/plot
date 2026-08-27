// Contract test for the wave verdict's APPROVAL half — `plot-fleet-scan.sh`
// must not call a wave `eligible` when its plan has not been approved.
//
// The defect this holds shut, measured 2026-08-27: every one-wave plan in
// `not-started` on the live board read `eligible`, and `plot-dispatch.sh`
// refused all six with *"plan '<slug>' is still Draft"*. The verdict answered
// wave ORDERING — *no earlier wave blocks this* — and the reader took it to
// mean *I can start this*. Those coincide only for an approved plan.
//
// THE FIX IS IN THE SCAN, not in the board. `--next` and `plot-dispatch.sh`
// consume this same verdict, so suppressing the word client-side would leave
// the dispatcher and the board disagreeing about what one word means.
//
// A SEPARATE FIXTURE from fleet.test.mjs, deliberately: that file's plans are
// Approved, and its `complete`/`eligible`/`blocked` assertions are the
// regression lock for the ordinary case (Done-when 2). Mutating them to add a
// Draft plan would delete the evidence that the ordinary case still works.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

let tmp, repo, report, json;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function write(rel, content) {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-unapproved-'));
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

  // THE MEASURED SHAPE: a one-wave Draft plan whose branch nothing blocks.
  // Wave ordering is satisfied — there is no earlier wave — so the ordering
  // computation says `eligible` and the dispatcher refuses it anyway.
  write('plans/2026-01-03-draft-plan.md', `# A drafted plan

## Status

- **Phase:** Draft
- **Type:** bug

## Branches

### Worded
- \`bug/from-a-draft\` — nothing blocks it but its own plan
`);

  // THE CONTROL, and the reason a fix that refuses everything does not pass:
  // same shape, same absence of an earlier wave, only the phase differs.
  write('plans/2026-01-04-approved-plan.md', `# An approved plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Ready
- \`feature/from-approved\` — genuinely startable
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  json = JSON.parse(execFileSync('bash', [scan, '--offline', '--json'],
    { encoding: 'utf8', cwd: repo }));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const waveOf = (slug, name) =>
  json.plans.find((p) => p.file.includes(slug)).waves.find((w) => w.name === name);

// Done-when 1 — the defect itself, on the measured shape.
test('fleet: a wave of a Draft plan does not read eligible', () => {
  assert.equal(waveOf('draft-plan', 'Worded').verdict, 'unapproved');
});

// Done-when 2 — the ordinary case must not regress. A fix that makes every
// wave unstartable passes item 1 and stops the fleet entirely.
test('fleet: a wave of an approved plan still reads eligible', () => {
  assert.equal(waveOf('approved-plan', 'Ready').verdict, 'eligible');
});

// Done-when 5 — NOT `blocked`. That word already means *an earlier wave has
// not landed*, a fact that resolves by merging work; a Draft plan resolves by
// a person approving it. Folding both into one word rebuilds the ambiguity one
// level down, and `blocked by Worded — 1 branch` is a sentence the row cannot
// truthfully complete.
test('fleet: the unapproved verdict is not the word blocked', () => {
  assert.notEqual(waveOf('draft-plan', 'Worded').verdict, 'blocked');
  assert.doesNotMatch(report, /Worded — blocked/);
});

// The human report carries the same word as the JSON. A reader looking at the
// prose and a consumer reading the field must not be told different things.
test('fleet: the human report names the wave unapproved', () => {
  assert.match(report, /Worded — unapproved/);
  assert.match(report, /Ready — eligible/);
});

// Done-when 3 — `--next` must not offer a wave whose plan is unapproved.
// If the verdict and the startability answer disagree, the board and the
// dispatcher are back to disagreeing through a different field.
test('fleet: --next does not offer a branch from an unapproved plan', () => {
  const out = execFileSync('bash', [scan, '--offline', '--next'],
    { encoding: 'utf8', cwd: repo });
  assert.equal(out.trim(), 'feature/from-approved');
});

test('fleet: --list-eligible omits every branch of an unapproved plan', () => {
  const out = execFileSync('bash', [scan, '--offline', '--list-eligible'],
    { encoding: 'utf8', cwd: repo });
  assert.deepEqual(out.trim().split('\n').filter(Boolean), ['feature/from-approved']);
});

// The footer is what callers count from; it must not count an unstartable
// branch as eligible work waiting for an agent.
test('fleet: the summary footer does not count an unapproved branch as eligible', () => {
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /^summary: /);
  assert.match(footer, /eligible=1/);
});

// Done-when 7 — no host call added. The phase is ALREADY parsed for the
// terminal grouping, so the fact is in hand where the verdict is computed;
// this asserts the fix spent no network to get it. `--offline` promises no
// network, and an empty PATH would break the scan's own git calls, so the
// assertion is that the offline run produced the verdict at all.
test('fleet: the phase reaches the verdict with no host call', () => {
  const out = execFileSync('bash', [scan, '--offline', '--json'],
    { encoding: 'utf8', cwd: repo, env: { ...process.env, GH_TOKEN: '', PATH: process.env.PATH } });
  const parsed = JSON.parse(out);
  const wave = parsed.plans.find((p) => p.file.includes("draft-plan")).waves[0];
  assert.equal(wave.verdict, 'unapproved');
});
