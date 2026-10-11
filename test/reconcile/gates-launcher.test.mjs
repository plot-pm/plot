// Contract test for the one-hook launcher: it resolves its bundle and execs it
// with `--all`, passes stdin and the exit code through, and — unlike every
// other launcher — ALLOWS the call when the bundle is absent, saying the gates
// went UNVERIFIED. Exiting 2 on a missing bundle would block every Bash call,
// including the one that repairs the install.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.resolve(here, '../../skills/plot/scripts/plot-gates.sh');

const made = [];
after(() => {
  for (const p of made) fs.rmSync(p, { recursive: true, force: true });
});

/** A copy of the launcher in a directory of its own, with or without a bundle beside it. */
const launcherCopy = (bundleBody) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gates-launcher-'));
  made.push(dir);
  fs.copyFileSync(launcher, path.join(dir, 'plot-gates.sh'));
  if (bundleBody !== undefined) {
    fs.mkdirSync(path.join(dir, 'board'));
    fs.writeFileSync(path.join(dir, 'board', 'plot-gate.mjs'), bundleBody);
  }
  return dir;
};

test('a missing bundle allows the call and says the gates went UNVERIFIED', () => {
  const dir = launcherCopy(undefined);
  const r = spawnSync('bash', [path.join(dir, 'plot-gates.sh')], { cwd: dir, input: '{}', encoding: 'utf8' });
  assert.equal(r.status, 0, `must allow (stderr: ${r.stderr})`);
  assert.match(r.stderr, /board\/plot-gate\.mjs is missing/);
  assert.match(r.stderr, /UNVERIFIED/);
  assert.match(r.stderr, /pnpm build:board/, 'names the local-build remedy');
});

test('a present bundle receives --all and stdin, and its exit code passes through', () => {
  const dir = launcherCopy(
    `import fs from 'node:fs'; process.stderr.write(process.argv.slice(2).join(' ') + '|' + fs.readFileSync(0, 'utf8')); process.exit(2);`,
  );
  const r = spawnSync('bash', [path.join(dir, 'plot-gates.sh')], { cwd: dir, input: 'HOOK', encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.equal(r.stderr, '--all|HOOK');
});

test('no node on PATH allows the call and says the gates went UNVERIFIED', () => {
  const dir = launcherCopy(`process.exit(2);`);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gates-nonode-'));
  made.push(bin);
  fs.symlinkSync(spawnSync('/bin/sh', ['-c', 'command -v dirname'], { encoding: 'utf8' }).stdout.trim(), path.join(bin, 'dirname'));
  const r = spawnSync('/bin/bash', [path.join(dir, 'plot-gates.sh')], { cwd: dir, input: '{}', encoding: 'utf8', env: { PATH: bin } });
  assert.equal(r.status, 0, `must allow (stderr: ${r.stderr})`);
  assert.match(r.stderr, /node is not on PATH/);
  assert.match(r.stderr, /UNVERIFIED/);
});

const ONE_HOOK = '"$CLAUDE_PROJECT_DIR"/skills/plot/scripts/plot-gates.sh';
const own = (gate) => `"$CLAUDE_PROJECT_DIR"/skills/plot/scripts/${gate}`;
const bashHooks = (...commands) => ({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: commands.map((command) => ({ type: 'command', command })) }] } });

/**
 * A vendored repository: every shipped `.sh` copied, `hooks.json` naming
 * `shipped`, `settings` registering what the case starts from, and a stub
 * `board/plot-gate.mjs` that prints `listed` for `--list` and otherwise
 * answers `answer` directly — `'allow'` exits 0, `'delegate'` refuses (exit 2)
 * the way the real bundle's gate logic would. `listed === null` leaves the
 * bundle out.
 *
 * `'delegate'` does NOT shell back out to the listed gate's own `.sh` file:
 * since `the-bundle-gate-is-a-launcher`, `plot-bundle-commit-gate.sh` itself
 * resolves and execs this same `board/plot-gate.mjs` — a stub that shelled to
 * it would recurse into itself forever.
 */
const vendored = ({ shipped, settings, listed, answer = 'allow' }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gates-verify-'));
  made.push(root);
  const scripts = path.join(root, 'skills/plot/scripts');
  fs.mkdirSync(path.join(scripts, 'board'), { recursive: true });
  fs.mkdirSync(path.join(root, 'hooks'));
  fs.mkdirSync(path.join(root, '.claude'));
  const real = path.resolve(here, '../../skills/plot/scripts');
  for (const f of fs.readdirSync(real).filter((n) => n.endsWith('.sh'))) fs.copyFileSync(path.join(real, f), path.join(scripts, f));
  if (listed !== null) {
    fs.writeFileSync(
      path.join(scripts, 'board/plot-gate.mjs'),
      `const listed = ${JSON.stringify(listed)};
if (process.argv.includes('--list')) { for (const g of listed) console.log(g); process.exit(0); }
process.exit(${JSON.stringify(answer)} === 'allow' ? 0 : 2);
`,
    );
  }
  fs.writeFileSync(path.join(root, 'hooks/hooks.json'), JSON.stringify(bashHooks(...shipped.map((g) => `\${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/${g}`))));
  if (settings) fs.writeFileSync(path.join(root, '.claude/settings.json'), JSON.stringify(bashHooks(...settings)));
  spawnSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
  const run = (...args) => {
    const r = spawnSync('bash', [path.join(scripts, 'plot-install-hooks.sh'), ...args], { cwd: root, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const registered = () => JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8')).hooks.PreToolUse[0].hooks.map((h) => h.command);
  return { run, registered };
};

test('--verify drives a listed gate through plot-gates.sh, the command the hook runs', () => {
  const { run } = vendored({ shipped: ['plot-gates.sh'], settings: [ONE_HOOK], listed: ['bundle-commit'], answer: 'delegate' });
  const { code, out } = run('--verify');
  assert.equal(code, 0, out);
  assert.match(out, /verified\s+plot-bundle-commit-gate\.sh — refused a guarded write \(exit 2\) through plot-gates\.sh/);
});

test('--verify: plot-gates.sh registers only the gates it lists, and a stub that allows everything does not verify', () => {
  // Case A: hooks.json names plot-gates.sh and plot-state-gate.sh, settings
  // registers only plot-gates.sh, and the bundle lists only bundle-commit.
  const { run } = vendored({ shipped: ['plot-gates.sh', 'plot-state-gate.sh'], settings: [ONE_HOOK], listed: ['bundle-commit'], answer: 'allow' });
  const { code, out } = run('--verify');
  assert.equal(code, 3, out);
  assert.match(out, /^unverified/m);
  assert.doesNotMatch(out, /^verified/m);
  assert.match(out, /unverified\s+plot-state-gate\.sh — not registered/);
  assert.match(out, /unverified\s+plot-bundle-commit-gate\.sh — did NOT refuse a guarded write through plot-gates\.sh/);
});

test('--verify: a missing bundle behind plot-gates.sh is unverified, never an empty pass', () => {
  // Case B: no board/plot-gate.mjs, so --list fails and the gates it would run vanish.
  const { run } = vendored({ shipped: ['plot-gates.sh'], settings: [ONE_HOOK], listed: null });
  const { code, out } = run('--verify');
  assert.equal(code, 3, out);
  assert.match(out, /unverified\s+plot-gates\.sh — board\/plot-gate\.mjs missing or lists no gate/);
  assert.doesNotMatch(out, /^verified/m);
});

test('per-gate entries for listed gates report present, name plot-gates.sh, and are never doubled', () => {
  const settings = [own('plot-state-gate.sh'), own('plot-bundle-commit-gate.sh'), own('plot-phase-gate.sh')];
  const { run, registered } = vendored({ shipped: ['plot-gates.sh', 'plot-phase-gate.sh'], settings, listed: ['state', 'bundle-commit'] });
  for (const args of [['--check'], []]) {
    const { code, out } = run(...args);
    assert.equal(code, 3, out);
    assert.match(out, /^present — .*plot-state-gate\.sh plot-bundle-commit-gate\.sh one by one; .*plot-gates\.sh is the one entry that replaces them/m);
    assert.deepEqual(registered(), settings, 'nothing is written');
  }
});

test('the one hook is written where no per-gate entry exists, and reads current after', () => {
  const { run, registered } = vendored({ shipped: ['plot-gates.sh', 'plot-phase-gate.sh'], settings: null, listed: ['state'] });
  assert.equal(run().code, 0);
  assert.deepEqual(registered().sort(), [ONE_HOOK, own('plot-phase-gate.sh')].sort());
  assert.match(run().out, /^current/m);
});

test('a missing bundle behind plot-gates.sh writes nothing, because the entries it replaces are unknown', () => {
  const { run } = vendored({ shipped: ['plot-gates.sh'], settings: [own('plot-state-gate.sh')], listed: null });
  const { code, out } = run();
  assert.equal(code, 1, out);
  assert.match(out, /missing or lists no gate.*nothing written/);
});
