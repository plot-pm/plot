// `plot-host.sh commit-status` — write a GitHub commit status as a GitHub App
// installation, never as the signed-in `gh` user.
//
// Tracer slice of docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md. Each
// test names the implementation it catches.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every directory this file creates, removed after its last test by the exact
// path mkdtempSync returned — never by a glob over the shared temp directory.
const made = [];
const scratch = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');

/**
 * A scratch repo with an origin remote, an RSA test key, and a PATH stub dir
 * holding `gh` (answers repo view) and `curl` (answers the GitHub App API
 * calls this op makes, logging every invocation to `calls`).
 */
const sandbox = ({ withKey = true, withConfig = true } = {}) => {
  const root = scratch('plot-host-commit-status-');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'git@github.com:octo/repo.git']);

  const keyPath = path.join(root, 'review-app-key.pem');
  if (withKey) execFileSync('openssl', ['genrsa', '-out', keyPath, '2048'], { stdio: 'ignore' });

  if (withConfig) {
    const configLine = withKey ? `- **Review app:** 123456 ${keyPath}\n` : '';
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `## Plot Config\n\n${configLine}`);
  } else {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `## Plot Config\n`);
  }

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const calls = path.join(root, 'calls');

  // `gh repo view` is the only `gh` call this op makes — resolving owner/repo.
  // The op reads `--jq`'s output, so the stub honours it rather than echoing
  // raw JSON, the same way a real `gh` would.
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho "gh $*" >> "${calls}"\necho "octo/repo"\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);

  // A `curl` stub answering each GitHub App endpoint this op calls, in order:
  // the installation lookup (returns an id), the token exchange (returns an
  // installation token, distinct from the bearer JWT it was called with), and
  // the statuses POST (returns 201 and logs the bearer token it was given).
  const curlStub = `#!/bin/sh
echo "curl $*" >> "${calls}"
url=""
for a in "$@"; do
  case "$a" in
    https://*) url="$a" ;;
  esac
done
case "$url" in
  */installation)
    echo '{"id":999}'
    ;;
  */access_tokens)
    echo '{"token":"installation-token-abc"}'
    ;;
  */statuses/*)
    echo ""
    echo "201"
    ;;
  *)
    echo "unexpected url: $url" >&2
    exit 1
    ;;
esac
`;
  fs.writeFileSync(path.join(bin, 'curl'), curlStub);
  fs.chmodSync(path.join(bin, 'curl'), 0o755);

  return { root, bin, calls, keyPath };
};

const commitStatus = (box, args, extra = {}) => {
  const env = {
    ...process.env,
    PATH: `${box.bin}:${process.env.PATH}`,
    PLOT_HOST: 'github',
    ...extra,
  };
  const res = spawnSync('bash', [adapter, 'commit-status', ...args], {
    cwd: box.root,
    encoding: 'utf8',
    env,
  });
  return { code: res.status, out: res.stdout.trim(), err: res.stderr };
};

const callLog = (box) => (fs.existsSync(box.calls) ? fs.readFileSync(box.calls, 'utf8') : '');

const ARGS = ['deadbeef', 'success', 'plot/review', 'build is green', 'https://example.com/run/1'];

test('commit-status: no Review app key exits 4 and names the key', () => {
  // CATCHES a default App or a silent success where the config is absent —
  // the brief's refusal requirement.
  const box = sandbox({ withKey: false, withConfig: true });
  const got = commitStatus(box, ARGS);
  assert.equal(got.code, 4);
  assert.match(got.err, /Review app/);
  assert.equal(callLog(box), '', 'no gh or curl call before the refusal');
});

test('commit-status: a Review app key file that cannot be read exits 4 and names the path', () => {
  // CATCHES treating "key configured" and "key resolves" as the same check —
  // the brief calls this out explicitly as a shortcut a naive implementation
  // would miss.
  const box = scratch('plot-host-commit-status-badkey-');
  execFileSync('git', ['init', '-q', box]);
  execFileSync('git', ['-C', box, 'remote', 'add', 'origin', 'git@github.com:octo/repo.git']);
  fs.writeFileSync(
    path.join(box, 'CLAUDE.md'),
    '## Plot Config\n\n- **Review app:** 123456 .secrets/does-not-exist.pem\n',
  );
  const got = spawnSync('bash', [adapter, 'commit-status', ...ARGS], {
    cwd: box,
    encoding: 'utf8',
    env: { ...process.env, PLOT_HOST: 'github' },
  });
  assert.equal(got.status, 4);
  assert.match(got.stderr, /does-not-exist\.pem/);
});

test('commit-status: reads the App id/key from ## Plot Config, not the environment', () => {
  // CATCHES a shortcut that reads an env var or a hardcoded App instead —
  // works on one machine, fails everywhere else, per the brief.
  const box = sandbox();
  // An env var of a plausible name must be IGNORED: the config file is the
  // only source, and if this passed by reading env the config's app id
  // (123456) would not be the one that mattered either way, so assert the op
  // still succeeds using the CLAUDE.md-declared id/key despite a conflicting
  // (and non-existent) env-named override.
  const got = commitStatus(box, ARGS, {
    PLOT_REVIEW_APP_ID: '999999',
    PLOT_REVIEW_APP_KEY: '/nonexistent/path.pem',
  });
  assert.equal(got.code, 0, got.err);
});

test('commit-status: writes the status using the installation token, never the bearer JWT', () => {
  // CATCHES the minting bug the brief calls out: GitHub's statuses API
  // rejects a bare App JWT, so a caller that reuses the JWT for the write
  // would only fail against the real API — this fixture catches it locally by
  // asserting the statuses call's Authorization header carries the stub's
  // fixed installation token, not a three-dot JWT.
  const box = sandbox();
  const got = commitStatus(box, ARGS);
  assert.equal(got.code, 0, got.err);

  // The three calls are separated by their own `curl ` prefix; the statuses
  // call's own payload and `-w` flag both embed real newlines, so the
  // commands are split there rather than on every line break.
  const log = callLog(box);
  const calls = log.split(/(?=^curl )/m);
  const statusesCall = calls.find((c) => c.includes('/statuses/'));
  assert.ok(statusesCall, 'no call reached the statuses endpoint');
  assert.match(statusesCall, /installation-token-abc/, 'the statuses write did not carry the installation token');
  assert.ok(!statusesCall.includes('.ey'), 'the statuses write carried a JWT-shaped bearer token');
});

test('commit-status: GitHub only — a non-GitHub backend exits 4', () => {
  const box = sandbox();
  const got = commitStatus(box, ARGS, { PLOT_HOST: 'bitbucket' });
  assert.equal(got.code, 4);
  assert.equal(callLog(box), '', 'no gh or curl call on an unaskable backend');
});

test('commit-status: posts state, context, description and target_url on the given sha', () => {
  const box = sandbox();
  const got = commitStatus(box, ARGS);
  assert.equal(got.code, 0, got.err);

  const log = callLog(box);
  const calls = log.split(/(?=^curl )/m);
  const statusesCall = calls.find((c) => c.includes('/statuses/'));
  assert.match(statusesCall, /statuses\/deadbeef/);
  assert.match(statusesCall, /"state":\s*"success"/);
  assert.match(statusesCall, /"context":\s*"plot\/review"/);
  assert.match(statusesCall, /"description":\s*"build is green"/);
  assert.match(statusesCall, /"target_url":\s*"https:\/\/example\.com\/run\/1"/);
});
