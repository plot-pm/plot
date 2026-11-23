// Contract test for scripts/check-estate-readers.sh — a test/reconcile file
// that lists the repository's plan or sprint directory declares it with a
// `// plot-reads: <dir>` line, so a plan PR selects it.
// Part of docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-estate-readers.sh');

/** A directory holding `test/reconcile/<name>` files and, when given, a CLAUDE.md. */
const rootWith = (files, claude = null) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-estate-gate-'));
  mkdirSync(path.join(dir, 'test', 'reconcile'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, 'test', 'reconcile', name), text);
  if (claude !== null) writeFileSync(path.join(dir, 'CLAUDE.md'), claude);
  return dir;
};

const run = (dir) => {
  try {
    return spawnSync('bash', [gate, dir], { encoding: 'utf8', env: { ...process.env, PLOT_REPO_ROOT: '' } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// The fixtures build each directory from its parts, so this file holds no path
// the gate reads as the repository's own directory.
const seg = (...parts) => parts.map((part) => `'${part}'`).join(', ');
const PLANS = seg('docs', 'plans');
const SPRINTS = seg('docs', 'sprints');
const UP = seg('..', '..');

const HEAD = `const here = path.dirname(fileURLToPath(import.meta.url));\nconst repoRoot = path.join(here, ${UP});\n`;
const WALK_PLANS = `${HEAD}const files = readdirSync(path.join(repoRoot, ${PLANS}));\n`;

test('a file that walks the plan directory with no marker fails, by name and directory', () => {
  const r = run(rootWith({ 'walk.test.mjs': WALK_PLANS }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}test\/reconcile\/walk\.test\.mjs {2}reads docs\/plans$/m);
  assert.match(r.stdout, /plot-reads: <dir>/);
});

test('the same file passes with the marker', () => {
  const r = run(rootWith({ 'walk.test.mjs': `// plot-reads: docs/plans\n${WALK_PLANS}` }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("a path built from '..' segments or a 'docs/plans' string counts too", () => {
  for (const text of [
    `const plansDir = path.join(here, ${UP}, ${PLANS});\nreaddirSync(plansDir);\n`,
    `${HEAD}readdirSync(path.join(repoRoot, '${['docs', 'plans'].join('/')}'));\n`,
    `${HEAD}readdirSync(\`\${repoRoot}/${['docs', 'plans'].join('/')}\`);\n`,
  ]) {
    const r = run(rootWith({ 'walk.test.mjs': text }));
    assert.equal(r.status, 1, `${text}\n${r.stdout}`);
  }
});

test('a marker for the plan directory does not cover the sprint directory', () => {
  const text = `// plot-reads: docs/plans\n${HEAD}readdirSync(path.join(repoRoot, ${SPRINTS}));\n`;
  const r = run(rootWith({ 'sprints.test.mjs': text }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /sprints\.test\.mjs {2}reads docs\/sprints/);
});

test("a sandbox's plan directory does not count", () => {
  const text = "const repo = mkdtempSync('x');\nreaddirSync(path.join(repo, 'docs', 'plans', 'active'));\n";
  const r = run(rootWith({ 'sandbox.test.mjs': text }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a file with no readdirSync call does not count', () => {
  const r = run(rootWith({ 'read.test.mjs': `${HEAD}readFileSync(path.join(repoRoot, ${PLANS}, 'x.md'));\n` }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the configured Plan directory is the one the gate reads', () => {
  const claude = '# X\n\n## Plot Config\n\n- **Plan directory:** plans/\n';
  const text = `${HEAD}readdirSync(path.join(repoRoot, 'plans'));\n`;
  const r = run(rootWith({ 'walk.test.mjs': text }, claude));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /reads plans$/m);
  assert.equal(run(rootWith({ 'walk.test.mjs': `// plot-reads: plans/\n${text}` }, claude)).status, 0);
});

test('this repository passes', () => {
  const r = spawnSync('bash', [gate], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
