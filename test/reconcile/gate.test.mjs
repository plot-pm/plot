// Contract test for skills/plot/scripts/plot-phase-gate.sh — the phase gate.
// Builds throwaway git repos to pin: blocks impl commits on Draft plans,
// allows plan-only commits, approved plans, unplanned branches, and
// fails open on malformed input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-phase-gate.sh');

function repoWith({ branch, planPhase, stage }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-gate-'));
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  writeFileSync(path.join(dir, 'README.md'), 'x');
  sh('git add . && git commit -qm init');
  sh(`git checkout -qb ${branch}`);
  if (planPhase) {
    mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    const slug = branch.split('/')[1];
    writeFileSync(
      path.join(dir, 'docs', 'plans', `2026-01-01-${slug}.md`),
      `# P\n\n## Status\n\n- **Phase:** ${planPhase}\n- **Type:** feature\n`,
    );
  }
  for (const f of stage) {
    const full = path.join(dir, f);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, 'y');
  }
  sh('git add -A');
  return dir;
}

function runGate(cwd, command = 'git commit -m x') {
  const input = JSON.stringify({ tool_input: { command } });
  try {
    execFileSync('bash', [gate], { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0 };
  } catch (e) {
    return { code: e.status, stderr: e.stderr?.toString() ?? '' };
  }
}

test('gate: blocks impl commit on Draft plan', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: ['src/a.js'] });
  const r = runGate(dir);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /still Draft/);
});

test('gate: allows plan-only commit on Draft plan', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: [] });
  assert.equal(runGate(dir).code, 0);
});

test('gate: allows impl commit on Approved plan', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Approved', stage: ['src/a.js'] });
  assert.equal(runGate(dir).code, 0);
});

test('gate: allows unplanned branch (no plan file)', () => {
  const dir = repoWith({ branch: 'feature/quickfix', planPhase: null, stage: ['src/a.js'] });
  assert.equal(runGate(dir).code, 0);
});

test('gate: ignores non-commit commands', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: ['src/a.js'] });
  assert.equal(runGate(dir, 'git status').code, 0);
});

test('gate: fails open on malformed input', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: ['src/a.js'] });
  const r = (() => {
    try {
      execFileSync('bash', [gate], { cwd: dir, input: 'not json', encoding: 'utf8' });
      return { code: 0 };
    } catch (e) { return { code: e.status }; }
  })();
  assert.equal(r.code, 0);
});
