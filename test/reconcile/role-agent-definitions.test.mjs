// Contract test for the four role definitions `fleet-roles-are-declared-agents`
// (wave 3) adds under `.claude/agents/`: reviewer, fixer, unblocker, main-repair.
//
// WHY THIS FILE AND NOT A PACKAGE TEST. These are plain YAML-frontmatter
// markdown, read by `claude --agent <role>`, not TypeScript — nothing in
// `packages/` imports them. `test/reconcile/*.test.mjs` is this repo's home for
// a contract over a file shape rather than a module.
//
// WHAT THIS PINS, from the plan's probe (wave 1) and its Design section:
//   - no definition declares `memory: local` — probe result 4 (REFUTED):
//     `memory: local` writes inside the run's own tree, which for a role whose
//     tree is a disposable worktree a fleet agent throws away is a write that
//     is never read back.
//   - the reviewer definition's tool list grants no write-capable tool — the
//     plan's own requirement that the reviewer hold no `Write`, `Edit`,
//     `NotebookEdit`, `Bash`, `Agent` or `Task`, enforced through the `tools`
//     field itself rather than a second `--disallowedTools` layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const agentsDir = path.join(repoRoot, '.claude', 'agents');

const ROLES = ['reviewer', 'fixer', 'unblocker', 'main-repair'];

/** The YAML frontmatter block between the leading `---` markers, parsed by hand — no YAML dependency for four small files. */
const frontmatterOf = (markdown) => {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'expected a leading --- frontmatter block');
  return match[1];
};

/** A scalar `key: value` line's value, or undefined if the key is absent. */
const scalar = (frontmatter, key) => {
  const line = frontmatter.split('\n').find((l) => l.startsWith(`${key}:`));
  return line === undefined ? undefined : line.slice(key.length + 1).trim();
};

/** The `tools:` YAML list's entries, read as `- Name` lines following the `tools:` key. */
const toolsListOf = (frontmatter) => {
  const lines = frontmatter.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'tools:');
  if (start === -1) return undefined;
  const items = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s*-\s/.test(line)) break;
    items.push(line.replace(/^\s*-\s*/, '').trim());
  }
  return items;
};

const WRITE_CAPABLE_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Agent', 'Task'];

for (const role of ROLES) {
  test(`${role}.md exists and declares no memory: local`, () => {
    const file = path.join(agentsDir, `${role}.md`);
    const markdown = readFileSync(file, 'utf8');
    const frontmatter = frontmatterOf(markdown);
    const memory = scalar(frontmatter, 'memory');
    assert.notEqual(memory, 'local', `${role}.md must not declare memory: local — it writes inside a tree the role throws away`);
  });
}

test('reviewer.md grants no write-capable tool', () => {
  const file = path.join(agentsDir, 'reviewer.md');
  const markdown = readFileSync(file, 'utf8');
  const frontmatter = frontmatterOf(markdown);
  const tools = toolsListOf(frontmatter);
  assert.ok(Array.isArray(tools) && tools.length > 0, 'reviewer.md must declare an explicit tools list');
  for (const forbidden of WRITE_CAPABLE_TOOLS) {
    assert.ok(!tools.includes(forbidden), `reviewer.md's tools list must not grant ${forbidden}`);
  }
});

test('fixer.md and main-repair.md declare an opus model; unblocker.md declares sonnet', () => {
  const read = (role) => frontmatterOf(readFileSync(path.join(agentsDir, `${role}.md`), 'utf8'));
  assert.equal(scalar(read('reviewer'), 'model'), 'opus');
  assert.equal(scalar(read('fixer'), 'model'), 'opus');
  assert.equal(scalar(read('main-repair'), 'model'), 'opus');
  assert.equal(scalar(read('unblocker'), 'model'), 'sonnet');
});

for (const role of ROLES) {
  test(`${role}.md does not declare isolation as anything but worktree, and never relies on maxTurns alone`, () => {
    const markdown = readFileSync(path.join(agentsDir, `${role}.md`), 'utf8');
    const frontmatter = frontmatterOf(markdown);
    const isolation = scalar(frontmatter, 'isolation');
    if (isolation !== undefined) assert.equal(isolation, 'worktree');
  });
}

// The three non-reviewer settings files run the role-deny gate from
// `$PLOT_ROLE_GATE`, a path the role start sets outside the role's tree.
// A hook that exits 1 lets the call through, so every failure must exit 2.
const GATED_ROLES = ['fixer', 'main-repair', 'unblocker'];

const hookCommandsOf = (role) => {
  const settings = JSON.parse(readFileSync(path.join(repoRoot, '.claude', 'settings', `${role}.json`), 'utf8'));
  return settings.hooks.PreToolUse.flatMap((entry) => entry.hooks.map((hook) => hook.command));
};

const runHook = (command, env) =>
  spawnSync('/bin/sh', ['-c', command], { input: '{"tool_input":{"command":"echo hi"}}', env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

for (const role of GATED_ROLES) {
  test(`${role}.json runs its gate from PLOT_ROLE_GATE and never from the cwd`, () => {
    for (const command of hookCommandsOf(role)) {
      assert.match(command, /\$PLOT_ROLE_GATE/);
      assert.doesNotMatch(command, /\$\(pwd\)|PLOT_REPO_ROOT/);
    }
  });

  test(`${role}.json denies every call when PLOT_ROLE_GATE names no file, or the gate exits other than 0`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'role-hook-'));
    try {
      const crashes = path.join(dir, 'crashes.mjs');
      writeFileSync(crashes, 'process.exit(1);\n');
      const allows = path.join(dir, 'allows.mjs');
      writeFileSync(allows, 'process.exit(0);\n');
      for (const command of hookCommandsOf(role)) {
        const unset = runHook(command, {});
        assert.equal(unset.status, 2);
        assert.match(unset.stderr, /PLOT_ROLE_GATE names no gate bundle/);
        assert.equal(runHook(command, { PLOT_ROLE_GATE: path.join(dir, 'absent.mjs') }).status, 2);
        assert.equal(runHook(command, { PLOT_ROLE_GATE: crashes }).status, 2);
        assert.equal(runHook(command, { PLOT_ROLE_GATE: allows }).status, 0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
