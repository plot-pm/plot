// EVERY AGENT THIS REPOSITORY STARTS PASSES `--strict-mcp-config`, so it
// starts no MCP server. The seven `claude -p` keys of `## Plot Config` carry
// the flag, and `.plot/worker-prompt.sh` puts it in the argv it prints and
// launches for the `claude` harness only.
//
// Plan: docs/plans/2026-11-21-fleet-agents-start-only-the-mcp-servers-they-use.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const config = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-config.sh');
const localPrompt = path.join(repoRoot, '.plot', 'worker-prompt.sh');

const KEYS = ['Idea command', 'Story command', 'Brief command', 'Implement command',
  'Interrogate command', 'Verify command', 'Design command'];

for (const key of KEYS) {
  test(`${key} carries --strict-mcp-config`, () => {
    const got = execFileSync('bash', [config, 'get', key], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
    assert.match(got, /claude -p/, `${key} answers a claude -p command\n${got}`);
    assert.match(got, /(^|\s)--strict-mcp-config(\s|$)/, `${key} must carry the flag\n${got}`);
  });
}

/**
 * Sources the prompt file under `PLOT_PRINT_INVOCATION=1` and returns the
 * printed argv. Every harness a case names is shimmed to a recorder, and a run
 * that reached the launch fails rather than returning an empty list.
 */
const printed = (vars) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-mcp-probe-'));
  try {
    const launched = path.join(dir, 'launched');
    for (const name of ['claude', 'codex']) {
      fs.writeFileSync(path.join(dir, name),
        `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > ${JSON.stringify(launched)}\n`);
      fs.chmodSync(path.join(dir, name), 0o755);
    }
    const env = {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      PLOT_BRANCH: 'feature/x',
      PLOT_WORKTREE: dir,
      PLOT_PRINT_INVOCATION: '1',
    };
    for (const v of ['PLOT_HARNESS', 'PLOT_MODEL', 'PLOT_EFFORT', 'PLOT_CAPABILITIES',
      'PLOT_SESSION_ID', 'PLOT_SESSION_FLAG', 'PLOT_BACKGROUND_DENY', 'PLOT_AGENT_SETTINGS']) delete env[v];
    Object.assign(env, vars);
    const out = execFileSync('bash', ['-c', 'set -uo pipefail; . "$1"', '_', localPrompt],
      { encoding: 'utf8', env, timeout: 30_000 });
    assert.equal(fs.existsSync(launched), false,
      `${localPrompt} reached its invocation under PLOT_PRINT_INVOCATION=1; the argv read here never reached the launch`);
    return out.split('\n').filter((l) => l !== '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('the claude harness prints --strict-mcp-config exactly once', () => {
  const got = printed({ PLOT_HARNESS: 'claude' });
  assert.equal(got[0], 'claude', got.join(' '));
  assert.equal(got.filter((a) => a === '--strict-mcp-config').length, 1, got.join(' '));
});

test('another harness prints no --strict-mcp-config', () => {
  const got = printed({ PLOT_HARNESS: 'codex' });
  assert.equal(got[0], 'codex', got.join(' '));
  assert.equal(got.includes('--strict-mcp-config'), false, got.join(' '));
});
