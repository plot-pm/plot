// `plot-merger-token.mjs --check` — the validation-only mode the domain
// adapter shells to, so `mergeIdentity` can answer without a live merge in
// flight. It must mint no token and make no network call: exit 0 for a
// usable key, 4 for an invalid one (naming the reason on stderr), 5 for an
// absent one. These are the same five cases `host.test.mjs` proves for the
// minting path, read here against `--check` directly rather than through
// `plot-host.sh pr-merge`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const script = path.join(scriptsDir, 'plot-merger-token.mjs');

const made = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A scratch repo root carrying one `## Plot Config` body, for `plot-config.sh` to read via `PLOT_REPO_ROOT`. */
const sandbox = (configBody) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-merger-check-'));
  made.push(dir);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `## Plot Config\n\n${configBody}`);
  return dir;
};

const check = (repoRoot) => {
  try {
    const out = execFileSync(process.execPath, [script, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, PLOT_REPO_ROOT: repoRoot },
    });
    return { code: 0, stdout: out, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
};

test('--check exits 5 with no Merger app key declared, and prints nothing on stdout', () => {
  const dir = sandbox('');
  const res = check(dir);
  assert.equal(res.code, 5);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /Merger app not configured/);
});

test('--check exits 4 for an id-only Merger app line with no key in the config folder, naming that path', () => {
  const dir = sandbox('- **Merger app:** 999000\n');
  const xdg = path.join(dir, 'no-such-xdg');
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  const res = check(dir);
  if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prev;
  assert.equal(res.code, 4);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /plot-merger\.999000\.private-key\.pem/);
});

test('--check exits 4 for a Merger app key naming a file that cannot be read', () => {
  const dir = sandbox(`- **Merger app:** 999000 ${path.join(os.tmpdir(), 'plot-merger-check-no-such-key.pem')}\n`);
  const res = check(dir);
  assert.equal(res.code, 4);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /names a key file that cannot be read/);
});

test('--check exits 4 where Merger app and Writer app name the same App id', () => {
  const dir = sandbox('');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const keyPath = path.join(dir, 'app-key.pem');
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    `## Plot Config\n\n- **Merger app:** 999000 ${keyPath}\n- **Writer app:** 999000 ${keyPath}\n`,
  );
  const res = check(dir);
  assert.equal(res.code, 4);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /name the same App id/);
});

test('--check exits 0 with no stdout and no network call for a usable key', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const dir = sandbox('');
  const keyPath = path.join(dir, 'merger-key.pem');
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `## Plot Config\n\n- **Merger app:** 999000 ${keyPath}\n`);
  // No `fetch` stub, no network stand-in at all: a usable key must resolve
  // and validate without ever reaching `installationToken`, since that is
  // the one call that would need a network.
  const res = execFileSync(process.execPath, [script, '--check'], {
    encoding: 'utf8',
    env: { ...process.env, PLOT_REPO_ROOT: dir },
  });
  assert.equal(res, '');
});
