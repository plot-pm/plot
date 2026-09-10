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
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, chmodSync, copyFileSync, readdirSync } from 'node:fs';
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

// --- `--verify`: the install proves itself ------------------------------------
//
// THREE OF THESE EXIST BECAUSE A NAIVE IMPLEMENTATION WOULD PASS WITHOUT THEM,
// and the first is the most important assertion in this file.
//
//   - the UNINSTALLED case reports `unverified`. Measured 2026-09-09 and again
//     while building this: plot-state-gate.sh exits 0 with empty stderr both
//     when it was never invoked and when it failed open — byte-identical,
//     because `trap 'exit 0' ERR` is deliberate. An implementation keying on a
//     commit succeeding reports green against a repository with no gates at
//     all, which is the exact state this whole plan exists to fix.
//   - the scratch tree is gone on the FAILURE path. Cleanup on the happy path
//     is what everyone writes; `trap ... EXIT` gets the assertion-failure path
//     and a trailing `rm -rf` does not — and here the failure path is the
//     EXPECTED outcome on an unverified install.
//   - a gate that cannot be proved is `unprobed`, never `verified`. Folding an
//     unknown into a pass is the disease; folding it into a failure makes a
//     perfect install report red forever, which operators learn to ignore.

// The gate scripts a prober actually drives. repo() above copies the installer
// alone, which is all the install half needs.
const gateScripts = [
  'plot-state-gate.sh',
  'plot-controller-gate.sh',
  'plot-phase-gate.sh',
  'plot-state-receipt.sh',
  'plot-config.sh',
];

function repoWithGates(opts) {
  const dir = repo(opts);
  for (const g of gateScripts) {
    const src = path.join(repoRoot, 'skills', 'plot', 'scripts', g);
    if (!existsSync(src)) continue;
    const dst = path.join(dir, 'skills', 'plot', 'scripts', g);
    copyFileSync(src, dst);
    chmodSync(dst, 0o755);
  }
  return dir;
}

test('--verify on an uninstalled repository reports unverified, never installed', () => {
  // THE ASSERTION THIS FILE EXISTS FOR. The gates are on disk and registered in
  // hooks.json; nothing is registered in .claude/settings.json, so nothing
  // would ever invoke them. That is the measured state of the repository this
  // plan was written in — and the state a verification keying on exit 0 calls
  // green.
  const dir = repoWithGates();
  const { code, out } = run(dir, ['--verify']);
  assert.equal(code, 3, `an uninstalled repo must not verify (out: ${out})`);
  assert.match(out, /^unverified/m);
  assert.doesNotMatch(out, /^verified/m, 'an uninstalled repo must never read as verified');
  // Named per gate, because "unverified" without the gate is not actionable.
  for (const g of shippedGates) assert.match(out, new RegExp(g.replace('.', '\\.')));
});

test('--verify proves a gate by its refusal, not by the file being written', () => {
  const dir = repoWithGates();
  run(dir); // install
  const { code, out } = run(dir, ['--verify']);
  assert.equal(code, 0, `an installed repo must verify (out: ${out})`);
  assert.match(out, /^verified/m);
  // The state gate is the one with a cheap self-contained condition, and it is
  // the gate that had never fired on any machine. Exit 2 is the contract; the
  // word here is this script's own report of it.
  assert.match(out, /verified\s+plot-state-gate\.sh/);
});

test('--verify distinguishes a gate that cannot be proved from one that failed', () => {
  // plot-phase-gate.sh reads the plan from origin/<main> — an approval nobody
  // else can see is not one — so a scratch repo with no remote cannot build
  // its condition. That is an honest unknown and must not read as either a
  // pass or a failure.
  const dir = repoWithGates();
  run(dir);
  const { out } = run(dir, ['--verify']);
  assert.match(out, /unprobed\s+plot-phase-gate\.sh/);
  assert.match(out, /origin\/<main>/, 'the reason is named, not just the verdict');
  assert.doesNotMatch(out, /verified\s+plot-phase-gate\.sh/);
});

test('--verify writes nothing that survives it, including on the failure path', () => {
  // Cleanup on the happy path is what everyone writes. The uninstalled case is
  // the FAILURE path and the expected outcome here, so it is the one asserted.
  const dir = repoWithGates();
  const before = new Set(readdirSync(tmpdir()));
  const { code } = run(dir, ['--verify']);
  assert.equal(code, 3);
  const leaked = readdirSync(tmpdir()).filter((e) => !before.has(e) && /^tmp\./.test(e));
  // Snapshot difference rather than "temp is empty": this machine runs several
  // worktrees and suites against one shared temp directory.
  for (const e of leaked) {
    assert.ok(
      !existsSync(path.join(tmpdir(), e, 'stderr.0')),
      `the verification left a scratch directory behind: ${e}`,
    );
  }
  // And it touched neither the settings file nor the tree it was run in.
  assert.equal(existsSync(settingsPath(dir)), false, '--verify must not install');
  const dirty = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.trim() && !l.includes('hooks/') && !l.includes('skills/'));
  assert.deepEqual(dirty, [], 'the operator tree must be as it was found');
});

test('--verify never installs, so it composes with --check', () => {
  // `--check` reports what IS, `--verify` reports what FIRES. Neither writes.
  const dir = repoWithGates();
  const v = run(dir, ['--verify']);
  assert.equal(existsSync(path.join(dir, '.claude')), false, '--verify must not create .claude');
  const c = run(dir, ['--check']);
  assert.equal(c.code, 3);
  assert.match(c.out, /^absent —/);
  assert.equal(v.code, 3);
});

test('/plot-init reports an unproved gate and continues rather than failing adoption', () => {
  // The happy path never reaches this, which is why it is asserted directly.
  // /plot-init's standing guardrail — "never fail the whole adoption on one
  // blocked step" — is the same rule wave 1 applied to a blocked settings
  // file, and it has to hold for a verification that comes back unverified.
  const skill = readFileSync(path.join(repoRoot, 'skills', 'plot-init', 'SKILL.md'), 'utf8');
  const step = skill.slice(skill.indexOf('plot-install-hooks.sh --check'));
  assert.match(step, /--verify/, 'the step runs the verification after installing');
  assert.match(
    step.slice(0, step.indexOf('## ') > 0 ? step.indexOf('## ') : step.length),
    /does not fail the adoption|never fail the whole adoption/,
    'and says a failed verification does not fail the adoption',
  );
  // `unverified` is the word, and it is stated as distinct from installed.
  assert.match(step, /`unverified` is never `installed`/);
});
