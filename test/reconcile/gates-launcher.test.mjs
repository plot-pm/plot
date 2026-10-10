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

test('--verify probes the gates plot-gate.mjs --list names, each against its own script', () => {
  // A vendored layout with the one-hook form registered: hooks.json names
  // plot-gates.sh, and the bundle lists one gate whose script refuses.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gates-verify-'));
  made.push(root);
  const scripts = path.join(root, 'skills/plot/scripts');
  fs.mkdirSync(path.join(scripts, 'board'), { recursive: true });
  fs.mkdirSync(path.join(root, 'hooks'));
  fs.mkdirSync(path.join(root, '.claude'));
  const real = path.resolve(here, '../../skills/plot/scripts');
  for (const f of fs.readdirSync(real).filter((n) => n.endsWith('.sh'))) {
    fs.copyFileSync(path.join(real, f), path.join(scripts, f));
  }
  fs.writeFileSync(path.join(scripts, 'board/plot-gate.mjs'), `console.log('state');`);
  fs.writeFileSync(
    path.join(root, 'hooks/hooks.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/plot-gates.sh' }] }] } }),
  );
  fs.writeFileSync(
    path.join(root, '.claude/settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/skills/plot/scripts/plot-gates.sh' }] }] } }),
  );
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  const r = spawnSync('bash', [path.join(scripts, 'plot-install-hooks.sh'), '--verify'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /verified\s+plot-state-gate\.sh — refused a guarded write/);
});
