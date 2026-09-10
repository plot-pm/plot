// Contract test for skills/plot/scripts/plot-install-hooks.sh — the installer
// that registers Plot's gates in an adopting repository's own
// `.claude/settings.json`, because `hooks/hooks.json` is
// `${CLAUDE_PLUGIN_ROOT}`-relative and resolves to nothing outside a plugin
// install.
//
// THREE OF THESE EXIST BECAUSE A NAIVE IMPLEMENTATION WOULD PASS WITHOUT THEM.
//
//   - `--check` writes nothing. An installer whose check mode has a write path
//     reports the right word either way and the file ends up correct, so the
//     assertion is on the FILESYSTEM being unchanged rather than on the output.
//   - a plugin-registered gate reports `current`. A naive installer appends its
//     entry and both registrations "work" until a receipt is spent twice, which
//     surfaces as a refused LEGITIMATE approval much later. The fixture uses the
//     plugin's own `${CLAUDE_PLUGIN_ROOT}` spelling, so an implementation
//     matching on the command string fails here and one matching on the script
//     basename passes.
//   - the gate set is read from `hooks/hooks.json`. A hardcoded pair ships a
//     repository missing whichever gate landed last — measured: the file carried
//     two gates when this was planned and three when it was built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, chmodSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const installer = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-install-hooks.sh');
const shippedHooks = path.join(repoRoot, 'hooks', 'hooks.json');

// The gates the shipped file actually registers — read, never named here, for
// the same reason the script reads them.
const shippedGates = (() => {
  const parsed = JSON.parse(readFileSync(shippedHooks, 'utf8'));
  return (parsed.hooks?.PreToolUse ?? [])
    .filter((e) => e.matcher === 'Bash')
    .flatMap((e) => e.hooks ?? [])
    .map((h) => h.command.replace(/.*\//, '').replace(/"$/, ''))
    .sort();
})();

// A throwaway repository carrying the shipped hooks.json and the installer,
// plus whatever settings the case starts from.
function repo({ settings } = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plot-install-hooks-'));
  const dir = path.join(tmp, 'repo');
  mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  mkdirSync(path.join(dir, 'skills', 'plot', 'scripts'), { recursive: true });
  execSync('git init -q -b main && git config user.email t@t && git config user.name t', { cwd: dir, stdio: 'pipe' });

  copyFileSync(shippedHooks, path.join(dir, 'hooks', 'hooks.json'));
  const localInstaller = path.join(dir, 'skills', 'plot', 'scripts', 'plot-install-hooks.sh');
  copyFileSync(installer, localInstaller);
  chmodSync(localInstaller, 0o755);

  if (settings !== undefined) {
    mkdirSync(path.join(dir, '.claude'), { recursive: true });
    writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2),
    );
  }
  return dir;
}

const run = (dir, args = []) => {
  const r = spawnSync('bash', [path.join(dir, 'skills', 'plot', 'scripts', 'plot-install-hooks.sh'), ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const settingsPath = (dir) => path.join(dir, '.claude', 'settings.json');
const readSettings = (dir) => JSON.parse(readFileSync(settingsPath(dir), 'utf8'));

const registeredGates = (dir) =>
  (readSettings(dir).hooks?.PreToolUse ?? [])
    .filter((e) => e.matcher === 'Bash')
    .flatMap((e) => e.hooks ?? [])
    .map((h) => h.command.replace(/.*\//, '').replace(/"$/, ''))
    .sort();

test('a repository with no settings gets every gate the shipped file registers', () => {
  const dir = repo();
  const { code, out } = run(dir);
  assert.equal(code, 0);
  assert.match(out, /^written —/);
  assert.deepEqual(registeredGates(dir), shippedGates);
});

test('the gate set is read from hooks.json rather than hardcoded', () => {
  // A shipped file naming one gate installs exactly that one. An installer
  // carrying its own list would install its list instead.
  const dir = repo();
  writeFileSync(
    path.join(dir, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/plot-invented-gate.sh"' }] },
        ],
      },
    }),
  );
  const { code } = run(dir);
  assert.equal(code, 0);
  assert.deepEqual(registeredGates(dir), ['plot-invented-gate.sh']);
});

test('--check writes nothing', () => {
  const dir = repo();
  const { code, out } = run(dir, ['--check']);
  assert.equal(code, 3);
  assert.match(out, /^absent —/);
  // The assertion is the filesystem, not the word: a check mode with a write
  // path reports `absent` correctly and still leaves the file behind.
  assert.equal(existsSync(settingsPath(dir)), false, '--check must not create the settings file');
  assert.equal(existsSync(path.join(dir, '.claude')), false, '--check must not create the .claude directory');
});

test('--check on an installed repo reports current and still writes nothing', () => {
  const dir = repo();
  run(dir);
  const before = readFileSync(settingsPath(dir), 'utf8');
  const { code, out } = run(dir, ['--check']);
  assert.equal(code, 0);
  assert.match(out, /^current —/);
  assert.equal(readFileSync(settingsPath(dir), 'utf8'), before);
});

test('a plugin-registered gate reports current and adds no duplicate', () => {
  // The entry is spelled the way the PLUGIN spells it. Matching on the command
  // string misses this; matching on the script basename catches it.
  //
  // This is correctness, not tidiness: plot-state-receipt.sh spends the receipt
  // when it clears, so two registrations of the state gate mean the second
  // reader finds it spent and refuses a properly owned write.
  const pluginEntries = shippedGates.map((g) => ({
    type: 'command',
    command: `"\${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/${g}"`,
  }));
  const dir = repo({ settings: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: pluginEntries }] } } });

  const { code, out } = run(dir);
  assert.equal(code, 0);
  assert.match(out, /^current —/);
  assert.deepEqual(registeredGates(dir), shippedGates, 'no gate may be registered twice');
});

test('one gate registered and one missing adds only the missing gate', () => {
  const [first, ...rest] = shippedGates;
  const dir = repo({
    settings: {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: `"\${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/${first}"` }] },
        ],
      },
    },
  });
  const { code, out } = run(dir);
  assert.equal(code, 0);
  assert.match(out, /^written —/);
  for (const g of rest) assert.match(out, new RegExp(g.replace('.', '\\.')));
  assert.deepEqual(registeredGates(dir), shippedGates);
  assert.equal(registeredGates(dir).filter((g) => g === first).length, 1, 'the present gate is not duplicated');
});

test("a foreign PreToolUse hook is never overwritten", () => {
  const dir = repo({
    settings: {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './their-own-audit.sh' }] }] },
    },
  });
  const before = readFileSync(settingsPath(dir), 'utf8');
  const { code, out } = run(dir);
  assert.equal(code, 3);
  assert.match(out, /^present —/m);
  // It names the entries to add rather than adding them.
  for (const g of shippedGates) assert.match(out, new RegExp(g.replace('.', '\\.')));
  assert.equal(readFileSync(settingsPath(dir), 'utf8'), before, 'somebody else\'s hook file is untouched');
});

test('an unrelated key in the settings file survives the install', () => {
  const dir = repo({ settings: { permissions: { allow: ['Bash(ls:*)'] }, model: 'opus' } });
  const { code } = run(dir);
  assert.equal(code, 0);
  const after = readSettings(dir);
  assert.deepEqual(after.permissions, { allow: ['Bash(ls:*)'] });
  assert.equal(after.model, 'opus');
  assert.deepEqual(registeredGates(dir), shippedGates);
});

test('a non-Bash PreToolUse matcher is left alone and ours is added beside it', () => {
  const dir = repo({
    settings: {
      hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: './their-write-hook.sh' }] }] },
    },
  });
  const { code } = run(dir);
  assert.equal(code, 0);
  const entries = readSettings(dir).hooks.PreToolUse;
  const write = entries.find((e) => e.matcher === 'Write');
  assert.equal(write.hooks[0].command, './their-write-hook.sh');
  assert.deepEqual(registeredGates(dir), shippedGates);
});

test('a malformed settings file is reported and never rewritten', () => {
  const dir = repo({ settings: '{ this is not json' });
  const { code, out } = run(dir);
  assert.equal(code, 3);
  assert.match(out, /^present —/m);
  assert.equal(readFileSync(settingsPath(dir), 'utf8'), '{ this is not json');
});

test('an unwritable settings location fails the install and not the caller', () => {
  // /plot-init's rule: never fail the whole adoption on one blocked step. The
  // installer's job is to refuse clearly; the skill prints the block and
  // continues. Asserted here: it exits non-zero WITHOUT a partial write, so a
  // caller that continues is continuing over an untouched repository.
  const dir = repo();
  const claude = path.join(dir, '.claude');
  mkdirSync(claude, { recursive: true });
  chmodSync(claude, 0o500);
  try {
    const { code, out } = run(dir);
    assert.notEqual(code, 0);
    assert.match(out, /nothing written/);
    assert.equal(existsSync(settingsPath(dir)), false);
  } finally {
    chmodSync(claude, 0o700);
  }
});

test('the registered command resolves from the project root', () => {
  // Measured 2026-09-10: a hook's pwd is the project root and
  // $CLAUDE_PROJECT_DIR is set to it. A bare relative path would break for a
  // hook invoked from anywhere else, so the entry is rooted explicitly.
  const dir = repo();
  run(dir);
  for (const entry of readSettings(dir).hooks.PreToolUse.filter((e) => e.matcher === 'Bash').flatMap((e) => e.hooks)) {
    assert.match(entry.command, /^"\$CLAUDE_PROJECT_DIR"\/skills\/plot\/scripts\//);
    assert.equal(entry.type, 'command');
  }
});
