// `appKeyPath` and `resolveApp`: where an App's private key is found.
// Each test names the implementation it catches.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appKeyPath, roleOf, validAppId } from '../../skills/plot/scripts/plot-github-app.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const HOME = '/home/op';
const ROOT = '/repo';

test('precedence: env beats the config line beats the folder', () => {
  const env = { PLOT_MERGER_APP_KEY: '/env.pem', XDG_CONFIG_HOME: '/xdg' };
  assert.equal(appKeyPath('merger', '42', '/line.pem', env, HOME, ROOT), '/env.pem');
  assert.equal(appKeyPath('merger', '42', '/line.pem', { XDG_CONFIG_HOME: '/xdg' }, HOME, ROOT), '/line.pem');
  assert.equal(appKeyPath('merger', '42', undefined, { XDG_CONFIG_HOME: '/xdg' }, HOME, ROOT), '/xdg/plot/plot-merger.42.private-key.pem');
});

test('a relative line path resolves against the repository root', () => {
  assert.equal(appKeyPath('review', '1', '.secrets/k.pem', {}, HOME, ROOT), '/repo/.secrets/k.pem');
});

test('XDG_CONFIG_HOME set and unset', () => {
  assert.equal(appKeyPath('writer', '7', undefined, { XDG_CONFIG_HOME: '/xdg' }, HOME, ROOT), '/xdg/plot/plot-writer.7.private-key.pem');
  assert.equal(appKeyPath('writer', '7', undefined, {}, HOME, ROOT), '/home/op/.config/plot/plot-writer.7.private-key.pem');
});

test('the role follows the config key, and each role reads its own variable', () => {
  assert.equal(roleOf('Merger app'), 'merger');
  assert.equal(roleOf('Review app'), 'review');
  assert.equal(roleOf('Writer app'), 'writer');
  assert.equal(appKeyPath('review', '1', undefined, { PLOT_MERGER_APP_KEY: '/m.pem' }, HOME, ROOT), '/home/op/.config/plot/plot-review.1.private-key.pem');
});

test('an app id with a slash or .. is refused', () => {
  for (const bad of ['../x', 'a/b', '..', '']) assert.equal(validAppId(bad), false, bad);
  assert.equal(validAppId('123456'), true);
});

// resolveApp end to end, through a throwaway repository and config home.
const made = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});
const resolve = (line, env = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-app-key-'));
  made.push(root);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `## Plot Config\n\n- **Merger app:** ${line}\n`);
  const code = `import { resolveApp } from ${JSON.stringify(path.join(scripts, 'plot-github-app.mjs'))};
    process.stdout.write(JSON.stringify(resolveApp('Merger app', ${JSON.stringify(scripts)})));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: root, ...env },
  });
  return { root, got: JSON.parse(out.stdout) };
};
test('resolveApp: an id-only line finds the key in the folder', () => {
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-app-xdg-'));
  made.push(xdg);
  fs.mkdirSync(path.join(xdg, 'plot'));
  const key = path.join(xdg, 'plot', 'plot-merger.55.private-key.pem');
  fs.writeFileSync(key, 'k');
  const { got } = resolve('55', { XDG_CONFIG_HOME: xdg });
  assert.deepEqual(got.app, { appId: '55', keyPath: key });
});

test('resolveApp: the refusal names the folder path for an id-only line, the line path for a bad one', () => {
  const a = resolve('55', { XDG_CONFIG_HOME: '/nonexistent-xdg' }).got;
  assert.equal(a.absent, false);
  assert.match(a.reason, /\/nonexistent-xdg\/plot\/plot-merger\.55\.private-key\.pem/);
  const b = resolve('55 /nonexistent/line.pem', { XDG_CONFIG_HOME: '/nonexistent-xdg' }).got;
  assert.match(b.reason, /\/nonexistent\/line\.pem/);
});

test('resolveApp: an id with a slash is refused before any path is built', () => {
  const got = resolve('../evil').got;
  assert.equal(got.app, null);
  assert.equal(got.absent, false);
  assert.match(got.reason, /not usable in a file name/);
});
