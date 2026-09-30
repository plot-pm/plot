// Contract test for plot-install-prompt.sh's `settings-unread` report.
//
// The loop exports `PLOT_AGENT_SETTINGS` and the PROMPT is where it is spent. A
// prompt that never mentions the variable silently starts every agent with the
// operator's whole plugin set — the failure measured 2026-09-30, when one
// plugin's lockless sync took the 1-minute load to 195 and stopped the supervisor
// ticking for 12 minutes.
//
// THE ORDERING IS WHAT THESE TESTS PIN. `plot-install-prompt.sh:77` answers
// `current` and EXITS 0 as soon as a prompt interpolates `PLOT_SESSION_FLAG`,
// which nearly every prompt in existence does. A new check written after that
// line is unreachable for exactly the population it is meant to inspect, so the
// settings check sits INSIDE that branch. Without the first test below, a check
// placed after the early exit passes review and never runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const installer = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-install-prompt.sh');

/**
 * A repository with a config section and a prompt file.
 *
 * `PLOT_REPO_ROOT` IS UNSET FOR THE CHILD, as in `agent-settings.test.mjs`:
 * `plot-config.sh` prefers it over `git rev-parse --show-toplevel`, and a
 * dispatched agent's environment carries it — so a test inheriting it reads the
 * real repository's CLAUDE.md and the fixture's key is never seen.
 */
function repoWith({ settingsKey, prompt }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-install-prompt-'));
  spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  const lines = ['# Fixture', '', '## Plot Config', '', '- **Plan directory:** docs/plans/'];
  if (settingsKey !== undefined) {
    lines.push(`- **Agent settings:** ${settingsKey}`);
  }
  writeFileSync(path.join(dir, 'CLAUDE.md'), `${lines.join('\n')}\n`);
  mkdirSync(path.join(dir, '.plot'), { recursive: true });
  writeFileSync(path.join(dir, '.plot', 'worker-prompt.sh'), prompt);
  return dir;
}

const check = (cwd) =>
  spawnSync('bash', [installer, '--check'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PLOT_REPO_ROOT: '' },
  });

/** A prompt that passes the session check — every prompt this report inspects does. */
const WITH_SESSION = 'claude -p "$PLOT_SESSION_FLAG" "$PLOT_SESSION_ID" x\n';

/** The same prompt, spending the settings variable through the documented guard. */
const WITH_BOTH =
  'claude -p "$PLOT_SESSION_FLAG" ${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"} x\n';

// THE TEST THAT CATCHES A CHECK PLACED AFTER THE EARLY `exit 0`.
test('install-prompt: a prompt reading the session flag but not the settings reports settings-unread', () => {
  const dir = repoWith({ settingsKey: '.plot/agent-settings.json', prompt: WITH_SESSION });
  try {
    const r = check(dir);
    assert.equal(r.status, 3, `expected exit 3, got ${r.status}: ${r.stdout}${r.stderr}`);
    const said = `${r.stdout}${r.stderr}`;
    assert.match(said, /settings-unread/);
    // It names the variable to add and the key that asked for it, because the
    // reader's next action is one edit and this is where they read it.
    assert.match(said, /PLOT_AGENT_SETTINGS/);
    assert.match(said, /agent-settings\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install-prompt: a prompt spending the variable reports current', () => {
  const dir = repoWith({ settingsKey: '.plot/agent-settings.json', prompt: WITH_BOTH });
  try {
    const r = check(dir);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /current/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A project that configures NO settings file has nothing for its prompt to
// spend, so reporting a gap would report one that does not exist.
test('install-prompt: with no Agent settings key, a session-only prompt stays current', () => {
  const dir = repoWith({ prompt: WITH_SESSION });
  try {
    const r = check(dir);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /current/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// THE REPORT IS ADDITIVE, and the two older answers must survive it. `stale` and
// `present` are reached only when the session check FAILS, which is the branch the
// new check does not sit in.
test('install-prompt: a prompt hardcoding a session flag still reports stale', () => {
  const dir = repoWith({
    settingsKey: '.plot/agent-settings.json',
    prompt: 'claude -p --session-id abc x\n',
  });
  try {
    const r = check(dir);
    assert.equal(r.status, 3);
    assert.match(`${r.stdout}${r.stderr}`, /stale/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install-prompt: a prompt passing no session arguments still reports present', () => {
  const dir = repoWith({
    settingsKey: '.plot/agent-settings.json',
    prompt: 'claude -p x\n',
  });
  try {
    const r = check(dir);
    assert.equal(r.status, 3);
    assert.match(`${r.stdout}${r.stderr}`, /present/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// THIS REPOSITORY'S OWN PROMPT. It declares `Agent settings`, so its own prompt
// must spend the variable — the estate is its own first adopter.
test("install-prompt: this repository's own prompt reads the settings variable", () => {
  const r = spawnSync('bash', [installer, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PLOT_REPO_ROOT: repoRoot },
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /current/);
});
