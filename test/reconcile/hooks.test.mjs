// Contract test for hooks/hooks.json — the PreToolUse gate wiring.
// The command string carries escaped inner quotes:
//   "\"${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/plot-phase-gate.sh\""
// Those quotes are load-bearing: the gate is fail-open by design, so an
// unquoted expansion under a plugin root containing a space would not
// error — it would silently never fire. This pins (a) the JSON decodes to
// a shell line that survives a space in CLAUDE_PLUGIN_ROOT and still
// blocks, and (b) the unquoted form degrades to exactly that silent miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');

const hooksJson = JSON.parse(readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
const hookCommand = hooksJson.hooks.PreToolUse[0].hooks[0].command;

// A plugin root whose path contains a space, holding the real scripts.
function pluginRootWithSpace() {
  const base = mkdtempSync(path.join(tmpdir(), 'plot-hooks-'));
  const root = path.join(base, 'plot plugin');
  mkdirSync(path.join(root, 'skills', 'plot'), { recursive: true });
  cpSync(path.join(repoRoot, 'skills', 'plot', 'scripts'), path.join(root, 'skills', 'plot', 'scripts'), {
    recursive: true,
  });
  return root;
}

// Minimal blocking fixture: Draft plan + staged impl file on its branch.
function blockingRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-hooks-repo-'));
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  writeFileSync(path.join(dir, 'README.md'), 'x');
  sh('git add . && git commit -qm init');
  sh('git checkout -qb feature/x');
  mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    path.join(dir, 'docs', 'plans', '2026-01-01-x.md'),
    '# P\n\n## Status\n\n- **Phase:** Draft\n- **Type:** feature\n',
  );
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'a.js'), 'y');
  sh('git add -A');
  return dir;
}

function runHookCommand(command, cwd, pluginRoot) {
  return spawnSync('sh', ['-c', command], {
    cwd,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    input: JSON.stringify({ tool_input: { command: 'git commit -m x' } }),
    encoding: 'utf8',
  });
}

test('hooks.json: quoted command survives a space in CLAUDE_PLUGIN_ROOT and blocks', () => {
  const root = pluginRootWithSpace();
  const repo = blockingRepo();
  const r = runHookCommand(hookCommand, repo, root);
  assert.equal(r.status, 2, `gate must fire and block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /still Draft/);
});

test('hooks.json: the unquoted form would fail open silently (why the quotes exist)', () => {
  const root = pluginRootWithSpace();
  const repo = blockingRepo();
  const unquoted = hookCommand.replaceAll('"', '');
  const r = runHookCommand(unquoted, repo, root);
  assert.notEqual(r.status, 2, 'unquoted expansion must not reach the gate');
  assert.equal(r.status, 127, 'sh reports command-not-found — which hook runners treat as allow');
});
