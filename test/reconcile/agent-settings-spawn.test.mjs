// Contract test for the ten agent-runner call sites and the settings file they
// must inherit.
//
// THE MECHANISM IS INHERITANCE, NOT AN EDIT. `index.ts` resolves
// `Agent settings` once at startup and assigns `process.env.PLOT_AGENT_SETTINGS`;
// every site inherits it, so none of them is edited to carry it explicitly.
//
// All ten sites start their agent through `startBoardRun` (`board-run.ts`),
// which hands the route's `env` to the `agentRun` port as EXTRA environment.
// Both adapters merge it over this process's own: `boundedRunProcess` spawns
// with `{ ...process.env, ...options.env }`, and the SDK connector builds its
// inherited environment from `process.env` and reads the settings file from
// `PLOT_AGENT_SETTINGS`. So the shapes these tests assert are:
//
//   - each of the ten files calls `startBoardRun(` and holds no `spawn(`
//   - the command adapter's spawn merges `process.env` under the request's env
//   - the SDK connector inherits `process.env` and reads `PLOT_AGENT_SETTINGS`
//
// THE MERGE IS THE ONE PLACE A REFACTOR BREAKS SILENTLY: an adapter that passed
// the request's `env` alone would start every board role without the settings
// file while every route test still passes.
//
// A RUNTIME TEST OF ALL TEN WAS CONSIDERED AND IS NOT WHAT THIS IS. The
// property that matters is structural — does this call site inherit the
// environment — and a source assertion states it without starting anything.
// One runtime proof that a started command SEES the variable is below,
// through a stub command, so the inheritance claim itself is measured once
// rather than assumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const serverDir = path.join(repoRoot, 'packages', 'board', 'src', 'server');

const source = (file) => readFileSync(path.join(serverDir, `${file}.ts`), 'utf8');

/** The ten board-role sites; each starts its agent through `startBoardRun`. */
const SITES = [
  'idea',
  'commission',
  'reslice',
  'deliver',
  'story',
  'brief-ask',
  'implement',
  'interrogate',
  'approve',
  'auto-deliver',
];

for (const file of SITES) {
  test(`${file}.ts starts its agent through startBoardRun, never a raw spawn`, () => {
    const text = source(file);
    assert.ok(text.includes('startBoardRun('), `${file}.ts should start its agent through startBoardRun`);
    assert.ok(!/\bspawn\(/.test(text), `${file}.ts must not spawn its agent itself`);
  });
}

test('the command adapter merges this process environment under the request env', () => {
  const text = readFileSync(
    path.join(repoRoot, 'packages', 'domain', 'src', 'adapters', 'bounded-run', 'bounded-run-process.ts'),
    'utf8',
  );
  assert.ok(
    text.includes('{ ...process.env, ...options.env }'),
    'boundedRunProcess must spread process.env under the request env, or every command role loses PLOT_AGENT_SETTINGS',
  );
});

test('the SDK connector inherits this process environment and reads the settings file', () => {
  const text = source('sdk-runner');
  assert.ok(text.includes('Object.entries(process.env)'), 'sdk-runner.ts must inherit process.env');
  assert.ok(
    text.includes('process.env.PLOT_AGENT_SETTINGS'),
    'sdk-runner.ts must read PLOT_AGENT_SETTINGS, or an SDK role starts with the operator plugins',
  );
});

test('the board resolves the settings file once, through the shared prime', () => {
  const index = source('index');
  assert.ok(
    index.includes('primeAgentSettings'),
    'index.ts must prime PLOT_AGENT_SETTINGS at startup, or no site can inherit it',
  );
});

// `plot-ask.mjs fleet` runs `maybeAutoDispatch` in its OWN node process, which
// the board's `process.env` never reaches. Without this the auto-dispatch path
// starts agents with no settings file while the board's own buttons do not.
test('entry/main.ts primes the settings file in its own process too', () => {
  const main = readFileSync(path.join(serverDir, 'entry', 'main.ts'), 'utf8');
  assert.ok(
    main.includes('primeAgentSettings'),
    'entry/main.ts is a second process and must prime PLOT_AGENT_SETTINGS itself',
  );
  // AWAITED, because the dispatch happens inside the `askOnce` below it: an
  // unawaited resolve would race the agents it configures.
  assert.match(
    main,
    /await primeAgentSettings\(/,
    'entry/main.ts must AWAIT the prime — the dispatch it configures runs in the same tick',
  );
  // STDOUT IS THE ANSWER. `primeAgentSettings` announces a resolved path through
  // `console.log` by default, and `plot-ask.mjs` callers parse stdout as one JSON
  // document: measured 2026-10-01, `plot-deliver.sh` read `deliverable: true`
  // as a refusal because the announcement preceded it.
  assert.match(
    main,
    /await primeAgentSettings\(\s*scriptsFor\(opts\),\s*process\.env,\s*\(s\) => console\.error\(s\)/,
    'entry/main.ts must announce the settings file on stderr — stdout carries only the JSON answer',
  );
});

// THE ONE RUNTIME PROOF. A child started with `process.env` merged in sees
// the variable — asserted against a real process rather than trusted, because
// the whole design rests on it.
test('a started command sees PLOT_AGENT_SETTINGS, and none when it is unset', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-agent-settings-spawn-'));
  try {
    const stub = path.join(dir, 'stub.sh');
    // The stub is the shape a project's command key has: it spends the variable
    // through the documented `${VAR:+…}` guard and reports what it received.
    writeFileSync(
      stub,
      '#!/usr/bin/env bash\nprintf "%s\\n" ${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"}\n',
    );
    chmodSync(stub, 0o755);

    const settings = path.join(dir, 'agent-settings.json');

    // Shape 1: the variable present in the merged environment.
    const inherited = spawnSync('sh', ['-c', `${stub} "$@"`, 'stub'], {
      encoding: 'utf8',
      env: { ...process.env, PLOT_AGENT_SETTINGS: settings },
    });
    assert.equal(inherited.stdout.trim().split('\n')[0], '--settings');
    assert.ok(inherited.stdout.includes(settings));

    // Shape 2: the variable absent — every guard must yield nothing.
    const without = { ...process.env };
    delete without.PLOT_AGENT_SETTINGS;
    const bare = spawnSync('sh', ['-c', `${stub} "$@"`, 'stub'], {
      encoding: 'utf8',
      env: without,
    });
    assert.equal(bare.stdout.trim(), '', 'an unset variable must add no argument');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
