// Contract test for the ten agent-runner call sites and the settings file they
// must inherit.
//
// THE MECHANISM IS INHERITANCE, NOT AN EDIT. `index.ts` resolves
// `Agent settings` once at startup and assigns `process.env.PLOT_AGENT_SETTINGS`;
// every site inherits it, so none of them is edited to carry it explicitly.
// That is what makes the change one line instead of ten, and it is also what
// makes it FRAGILE in one specific way: a site that grows an explicit
// `env: { … }` without `...process.env` stops inheriting, silently, and the
// agent it starts loses the settings file while every test about that route
// still passes.
//
// `the-board-commands-run-through-the-port` (2026-10) moved six of the ten
// sites off a raw `spawn` onto `agentRunFor`/`agentRun.run(...)` — the SHAPE
// that carries the variable changed from a `spawn(...)` call to the `env`
// object handed to `agentRun.run`, but the INHERITANCE RULE is unchanged:
// `agentRunCommand` forwards `request.env` to its child verbatim, with no
// merge against `process.env` of its own, so a converted route that drops
// `...process.env` from that object loses the settings file exactly as a
// `spawn` site would.
//
// So these tests assert the three SHAPES that carry the variable:
//
//   - four sites still spawn directly and spread `...process.env` into `env`
//   - five sites run through `agentRunFor` and spread `...process.env` into
//     the `env` object passed to `agentRun.run`
//   - one site (`brief-ask.ts`) spawns directly and passes NO `env` at all,
//     which in Node means inherit-everything
//
// THE NO-`env` SITE IS THE ONE A REFACTOR BREAKS SILENTLY. It works for a
// different reason from the rest, and "add `env` for cwd/logging" is an
// ordinary-looking change that would break exactly it.
//
// A RUNTIME TEST OF ALL TEN WAS CONSIDERED AND IS NOT WHAT THIS IS. Each site
// starts a project-configured agent command, several of them detached, and
// driving ten of them through a real board means ten children per run. The
// property that matters is structural — does this call site inherit the
// environment — and a source assertion states it without starting anything.
// One runtime proof that a spawned command SEES the variable is below,
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

/** The three sites that still spawn directly and spread `process.env` into an explicit `env`. */
const SPAWN_SPREADING = ['implement', 'auto-deliver'];

/** The six sites that run through `agentRunFor` and spread `process.env` into `agentRun.run`'s `env`. */
const PORT_SPREADING = ['idea', 'story', 'commission', 'deliver', 'reslice', 'approve', 'interrogate'];

/** The one site that passes no `env` and inherits the whole environment. */
const INHERITING = ['brief-ask'];

for (const file of SPAWN_SPREADING) {
  test(`${file}.ts spreads process.env into its agent spawn`, () => {
    const text = source(file);
    assert.ok(text.includes('spawn('), `${file}.ts should spawn an agent command`);
    assert.ok(
      text.includes('...process.env'),
      `${file}.ts must spread ...process.env, or the agent it starts loses PLOT_AGENT_SETTINGS`,
    );
  });
}

for (const file of PORT_SPREADING) {
  test(`${file}.ts spreads process.env into its agentRun.run env`, () => {
    const text = source(file);
    assert.ok(
      text.includes('agentRunFor('),
      `${file}.ts should run its agent through agentRunFor, not a raw spawn`,
    );
    assert.ok(
      text.includes('...process.env'),
      `${file}.ts must spread ...process.env into the env object it hands agentRun.run, or the agent it starts loses PLOT_AGENT_SETTINGS`,
    );
  });
}

for (const file of INHERITING) {
  test(`${file}.ts passes no env to its agent spawn, so it inherits`, () => {
    const text = source(file);
    assert.ok(text.includes('spawn('), `${file}.ts should spawn an agent command`);
    // A site here that GAINS an `env` must gain the spread with it. Testing for
    // the absence of `env:` is what catches the silent case: an added
    // `env: { PLOT_X: '1' }` replaces the environment rather than extending it.
    if (text.includes('env:')) {
      assert.ok(
        text.includes('...process.env'),
        `${file}.ts gained an env: block — it must spread ...process.env, or it stops inheriting PLOT_AGENT_SETTINGS`,
      );
    }
  });
}

test('the board resolves the settings file once, through the shared prime', () => {
  const index = source('index');
  assert.ok(
    index.includes('primeAgentSettings'),
    'index.ts must prime PLOT_AGENT_SETTINGS at startup, or no spawn site can inherit it',
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

// THE ONE RUNTIME PROOF. `spawn` with no `env`, and `spawn` spreading
// `process.env`, both hand a child the variable — asserted against a real
// process rather than trusted, because the whole design rests on it.
test('a spawned command sees PLOT_AGENT_SETTINGS through both shapes', () => {
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

    // Shape 1: no `env` at all — brief-ask.ts and approve.ts.
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
