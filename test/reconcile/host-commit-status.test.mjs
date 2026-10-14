// `plot-host.sh commit-status` — write a GitHub commit status as a GitHub App
// installation, never as the signed-in `gh` user; write a Bitbucket build
// status as a dedicated account's App password, never as the signed-in `bb`
// identity.
//
// Tracer slice of docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md. Each
// test names the implementation it catches.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every directory this file creates, removed after its last test by the exact
// path mkdtempSync returned — never by a glob over the shared temp directory.
const made = [];
const servers = [];
const scratch = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const server of servers) server.close();
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');
const INSTALLATION_TOKEN = 'installation-token-abc';

/**
 * A stand-in for the GitHub API. Records every request and answers the three
 * routes the op calls; `statusCode` sets the statuses write's answer.
 */
const fakeGitHub = async ({ statusCode = 201 } = {}) => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body });
      const reply = (code, json) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.method === 'GET' && req.url === '/repos/octo/repo/installation') return reply(200, { id: 999 });
      if (req.method === 'POST' && req.url === '/app/installations/999/access_tokens') {
        return reply(201, { token: INSTALLATION_TOKEN });
      }
      if (req.method === 'POST' && req.url.startsWith('/repos/octo/repo/statuses/')) return reply(statusCode, {});
      return reply(404, { message: 'unexpected route' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
};

/**
 * A scratch repo with an origin remote, an RSA test key, and a PATH stub dir.
 * `gh` answers repo view; `node` and `curl` log their argv to `calls` — `node`
 * then runs the real interpreter — so a test can read every argv a child got.
 */
const sandbox = ({ withKey = true } = {}) => {
  const root = scratch('plot-host-commit-status-');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'git@github.com:octo/repo.git']);

  const keyPath = path.join(root, 'review-app-key.pem');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  if (withKey) fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  const configLine = withKey ? `- **Review app:** 123456 ${keyPath}\n` : '';
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `## Plot Config\n\n${configLine}`);

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const calls = path.join(root, 'calls');
  const stub = (name, tail) => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${tail}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  };
  stub('gh', 'echo "octo/repo"');
  stub('node', `exec "${process.execPath}" "$@"`);
  stub('curl', 'exit 1');

  return { root, bin, calls, publicKey };
};

const commitStatus = (box, args, api, extra = {}) =>
  new Promise((resolve) => {
    const child = spawn('bash', [adapter, 'commit-status', ...args], {
      cwd: box.root,
      env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, PLOT_HOST: 'github', GITHUB_API_URL: api, ...extra },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => resolve({ code, out: out.trim(), err }));
  });

const callLog = (box) => (fs.existsSync(box.calls) ? fs.readFileSync(box.calls, 'utf8') : '');

const ARGS = ['deadbeef', 'success', 'plot/review', 'build is green', 'https://example.com/run/1'];

test('commit-status: no Review app key exits 4 and names the key', async () => {
  // CATCHES a default App or a silent success where the config is absent —
  // the brief's refusal requirement.
  const box = sandbox({ withKey: false });
  const api = await fakeGitHub();
  const got = await commitStatus(box, ARGS, api.url);
  assert.equal(got.code, 4);
  assert.match(got.err, /Review app/);
  assert.doesNotMatch(callLog(box), /^gh /m, 'no gh call before the refusal');
  assert.equal(api.requests.length, 0, 'no API call before the refusal');
});

test('commit-status: a Review app key file that cannot be read exits 4 and names the path', async () => {
  // CATCHES treating "key configured" and "key resolves" as the same check —
  // the brief calls this out explicitly as a shortcut a naive implementation
  // would miss. The relative path resolves against the repository root.
  const box = sandbox();
  fs.writeFileSync(
    path.join(box.root, 'CLAUDE.md'),
    '## Plot Config\n\n- **Review app:** 123456 .secrets/does-not-exist.pem\n',
  );
  const api = await fakeGitHub();
  const got = await commitStatus(box, ARGS, api.url);
  assert.equal(got.code, 4);
  assert.match(got.err, /\.secrets\/does-not-exist\.pem/);
  assert.equal(api.requests.length, 0);
});

test('commit-status: reads the App id/key from ## Plot Config, not the environment', async () => {
  // CATCHES a shortcut that reads an env var or a hardcoded App instead —
  // works on one machine, fails everywhere else, per the brief. The JWT's
  // `iss` must be the configured id, and its signature must verify against
  // the configured key.
  const box = sandbox();
  const api = await fakeGitHub();
  const got = await commitStatus(box, ARGS, api.url, {
    PLOT_REVIEW_APP_ID: '999999',
    PLOT_REVIEW_APP_KEY: '/nonexistent/path.pem',
  });
  assert.equal(got.code, 0, got.err);
  const jwt = api.requests[0].auth.replace(/^Bearer /, '');
  const [header, payload, signature] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, '123456');
  const verified = createVerify('RSA-SHA256')
    .update(`${header}.${payload}`)
    .verify(box.publicKey, Buffer.from(signature, 'base64url'));
  assert.ok(verified, 'the JWT is not signed with the configured key');
});

test('commit-status: writes the status using the installation token, never the bearer JWT', async () => {
  // CATCHES the minting bug the brief calls out: GitHub's statuses API
  // rejects a bare App JWT, so a caller that reuses the JWT for the write
  // would only fail against the real API.
  const box = sandbox();
  const api = await fakeGitHub();
  const got = await commitStatus(box, ARGS, api.url);
  assert.equal(got.code, 0, got.err);
  const write = api.requests.find((r) => r.url.includes('/statuses/'));
  assert.ok(write, 'no call reached the statuses endpoint');
  assert.equal(write.auth, `Bearer ${INSTALLATION_TOKEN}`);
  for (const r of api.requests.filter((x) => !x.url.includes('/statuses/'))) {
    assert.equal(r.auth.split('.').length, 3, `${r.url} was not authenticated with the App JWT`);
  }
});

test('commit-status: neither the JWT nor the installation token appears in any child process argv', async () => {
  // CATCHES a credential passed as a command-line argument (for example
  // `curl -H "Authorization: Bearer $token"`), which `ps` shows to every local
  // user. The stubs log the argv of every `gh`, `node` and `curl` the op runs.
  const box = sandbox();
  const api = await fakeGitHub();
  const got = await commitStatus(box, ARGS, api.url);
  assert.equal(got.code, 0, got.err);
  const log = callLog(box);
  assert.match(log, /^node .*plot-commit-status\.mjs --repo octo\/repo deadbeef/m, 'the argv log did not record the op');
  const jwt = api.requests[0].auth.replace(/^Bearer /, '');
  assert.ok(jwt.length > 0);
  assert.ok(!log.includes(jwt), 'the App JWT appeared in a child argv');
  assert.ok(!log.includes(INSTALLATION_TOKEN), 'the installation token appeared in a child argv');
  assert.ok(!got.err.includes(jwt) && !got.err.includes(INSTALLATION_TOKEN), 'a credential reached stderr');
  assert.ok(!got.out.includes(jwt) && !got.out.includes(INSTALLATION_TOKEN), 'a credential reached stdout');
});

test('commit-status: a backend with no arm (neither github nor bitbucket) exits 4', async () => {
  const box = sandbox();
  const api = await fakeGitHub();
  const got = await commitStatus(box, ARGS, api.url, { PLOT_HOST: 'gitlab' });
  assert.equal(got.code, 4);
  assert.equal(callLog(box), '', 'no gh, bb or node call on an unaskable backend');
  assert.equal(api.requests.length, 0);
});

test('commit-status: posts state, context, description and target_url on the given sha', async () => {
  const box = sandbox();
  const api = await fakeGitHub();
  const got = await commitStatus(box, ARGS, api.url);
  assert.equal(got.code, 0, got.err);
  const write = api.requests.find((r) => r.url.includes('/statuses/'));
  assert.equal(write.url, '/repos/octo/repo/statuses/deadbeef');
  assert.deepEqual(JSON.parse(write.body), {
    state: 'success',
    context: 'plot/review',
    description: 'build is green',
    target_url: 'https://example.com/run/1',
  });
});

test('commit-status: a failed statuses write exits 3 and names the context', async () => {
  const box = sandbox();
  const api = await fakeGitHub({ statusCode: 422 });
  const got = await commitStatus(box, ARGS, api.url);
  assert.equal(got.code, 3);
  assert.match(got.err, /HTTP 422 writing plot\/review on deadbeef/);
});

test('commit-status: a missing argument exits 1 before gh or the API is asked', async () => {
  const box = sandbox();
  const api = await fakeGitHub();
  const got = await commitStatus(box, ARGS.slice(0, 4), api.url);
  assert.equal(got.code, 1);
  assert.doesNotMatch(callLog(box), /^gh /m);
  assert.equal(api.requests.length, 0);
});

// --- Bitbucket -------------------------------------------------------------
//
// Same op, a different host: a build status via Basic auth as a dedicated
// account (BITBUCKET_REVIEW_USER / BITBUCKET_REVIEW_APP_PASSWORD), never as
// whichever identity `bb` is signed in as on this machine. No `bb` call is
// made at all — the write goes through `fetch` inside the Node helper.

/**
 * A stand-in for the Bitbucket API. Records every request and answers the
 * build-status route; `statusCode` sets its answer.
 */
const fakeBitbucket = async ({ statusCode = 201 } = {}) => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body });
      const reply = (code, json) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.method === 'POST' && req.url === '/repositories/myws/myrepo/commit/deadbeef/statuses/build') {
        return reply(statusCode, {});
      }
      return reply(404, { type: 'error', error: { message: 'unexpected route' } });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
};

/**
 * A scratch repo with a bitbucket.org origin remote and a PATH stub dir.
 * `bb` logs its argv and exits 1 (never called on the happy path); `node` logs
 * argv then runs the real interpreter. No `curl` stub: the write goes through
 * `fetch` inside the Node process, not a child.
 */
const bbSandbox = ({ withEnv = {} } = {}) => {
  const root = scratch('plot-host-commit-status-bb-');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'git@bitbucket.org:myws/myrepo.git']);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Plot Config\n\n');
  if (withEnv.dotenv) fs.writeFileSync(path.join(root, '.env'), withEnv.dotenv);

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const calls = path.join(root, 'calls');
  const stub = (name, tail) => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${tail}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  };
  stub('bb', 'exit 1');
  stub('node', `exec "${process.execPath}" "$@"`);

  return { root, bin, calls };
};

const bbCommitStatus = (box, args, api, extra = {}) =>
  new Promise((resolve) => {
    const child = spawn('bash', [adapter, 'commit-status', ...args], {
      cwd: box.root,
      env: {
        ...process.env,
        PATH: `${box.bin}:${process.env.PATH}`,
        PLOT_HOST: 'bitbucket',
        BITBUCKET_API_BASE: api,
        ...extra,
      },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => resolve({ code, out: out.trim(), err }));
  });

const BB_CRED = { BITBUCKET_REVIEW_USER: 'review-bot', BITBUCKET_REVIEW_APP_PASSWORD: 'app-pw-secret' };

test('commit-status (bitbucket): no credential exits 4 naming both variables, before any API call', async () => {
  // CATCHES a default/no-op success where the credential is absent — the
  // brief's refusal requirement, mirrored from the GitHub arm's "no Review
  // app key" test.
  const box = bbSandbox();
  const api = await fakeBitbucket();
  const got = await bbCommitStatus(box, ARGS, api.url, {
    BITBUCKET_REVIEW_USER: '',
    BITBUCKET_REVIEW_APP_PASSWORD: '',
  });
  assert.equal(got.code, 4);
  assert.match(got.err, /BITBUCKET_REVIEW_USER/);
  assert.match(got.err, /BITBUCKET_REVIEW_APP_PASSWORD/);
  assert.doesNotMatch(callLog(box), /^bb /m, 'no bb call before the refusal');
  assert.equal(api.requests.length, 0, 'no API call before the refusal');
});

test('commit-status (bitbucket): reads the credential from this repository\'s .env when the environment is unset', async () => {
  const box = bbSandbox({ withEnv: { dotenv: `BITBUCKET_REVIEW_USER=${BB_CRED.BITBUCKET_REVIEW_USER}\nBITBUCKET_REVIEW_APP_PASSWORD=${BB_CRED.BITBUCKET_REVIEW_APP_PASSWORD}\n` } });
  const api = await fakeBitbucket();
  const got = await bbCommitStatus(box, ARGS, api.url, {
    BITBUCKET_REVIEW_USER: '',
    BITBUCKET_REVIEW_APP_PASSWORD: '',
  });
  assert.equal(got.code, 0, got.err);
  const write = api.requests[0];
  const expected = `Basic ${Buffer.from(`${BB_CRED.BITBUCKET_REVIEW_USER}:${BB_CRED.BITBUCKET_REVIEW_APP_PASSWORD}`).toString('base64')}`;
  assert.equal(write.auth, expected);
});

test('commit-status (bitbucket): never shells out through bb — the write is a direct API call under a dedicated account', async () => {
  // CATCHES routing the write through the already-authenticated `bb` CLI,
  // which the brief explicitly forbids: that would write as whoever is
  // signed into `bb` on this machine, the exact indistinguishable-from-a-human
  // credential this op exists to avoid.
  const box = bbSandbox();
  const api = await fakeBitbucket();
  const got = await bbCommitStatus(box, ARGS, api.url, BB_CRED);
  assert.equal(got.code, 0, got.err);
  assert.doesNotMatch(callLog(box), /^bb /m, 'bb was called for the write');
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].auth, `Basic ${Buffer.from('review-bot:app-pw-secret').toString('base64')}`);
});

test('commit-status (bitbucket): the credential never appears in stdout, stderr, or any child process argv', async () => {
  const box = bbSandbox();
  const api = await fakeBitbucket();
  const got = await bbCommitStatus(box, ARGS, api.url, BB_CRED);
  assert.equal(got.code, 0, got.err);
  const log = callLog(box);
  assert.ok(!log.includes(BB_CRED.BITBUCKET_REVIEW_APP_PASSWORD), 'the app password appeared in a child argv');
  assert.ok(!got.err.includes(BB_CRED.BITBUCKET_REVIEW_APP_PASSWORD), 'the app password reached stderr');
  assert.ok(!got.out.includes(BB_CRED.BITBUCKET_REVIEW_APP_PASSWORD), 'the app password reached stdout');
});

test('commit-status (bitbucket): maps success/failure to SUCCESSFUL/FAILED and matches key to context', async () => {
  const box = bbSandbox();
  const api = await fakeBitbucket();
  const got = await bbCommitStatus(box, ARGS, api.url, BB_CRED);
  assert.equal(got.code, 0, got.err);
  assert.deepEqual(JSON.parse(api.requests[0].body), {
    state: 'SUCCESSFUL',
    key: 'plot/review',
    name: 'plot/review',
    description: 'build is green',
    url: 'https://example.com/run/1',
  });

  const failArgs = ['deadbeef', 'failure', 'plot/review', 'build is red', 'https://example.com/run/1'];
  const failed = await bbCommitStatus(box, failArgs, api.url, BB_CRED);
  assert.equal(failed.code, 0, failed.err);
  assert.equal(JSON.parse(api.requests[1].body).state, 'FAILED');
});

test('commit-status (bitbucket): a state this op does not expect exits naming unsupported, not a guess', async () => {
  // CATCHES guessing a mapping for pending/error, which GitHub's vocabulary
  // has and Bitbucket's INPROGRESS/STOPPED do not line up with 1:1, and which
  // no caller here invokes.
  const box = bbSandbox();
  const api = await fakeBitbucket();
  const pendingArgs = ['deadbeef', 'pending', 'plot/review', 'build is running', 'https://example.com/run/1'];
  const got = await bbCommitStatus(box, pendingArgs, api.url, BB_CRED);
  assert.equal(got.code, 4);
  assert.match(got.err, /unsupported/);
  assert.equal(api.requests.length, 0, 'no API call for a state this op cannot map');
});

test('commit-status (bitbucket): an unresolvable workspace/repo exits naming unsupported, not a 404', async () => {
  // CATCHES falling through to the API with an empty/garbage path and reading
  // its 404 as the generic write-failure path.
  const box = bbSandbox();
  execFileSync('git', ['-C', box.root, 'remote', 'set-url', 'origin', 'git@example.com:not-bitbucket.git']);
  const api = await fakeBitbucket();
  const got = await bbCommitStatus(box, ARGS, api.url, BB_CRED);
  assert.equal(got.code, 4);
  assert.match(got.err, /unsupported/);
  assert.equal(api.requests.length, 0);
});

test('commit-status (bitbucket): a failed build-status write exits 3 and names the context', async () => {
  const box = bbSandbox();
  const api = await fakeBitbucket({ statusCode: 422 });
  const got = await bbCommitStatus(box, ARGS, api.url, BB_CRED);
  assert.equal(got.code, 3);
  assert.match(got.err, /HTTP 422 writing plot\/review on deadbeef/);
});

test('commit-status (bitbucket): a missing argument exits 1 before the credential or the API is asked', async () => {
  const box = bbSandbox();
  const api = await fakeBitbucket();
  const got = await bbCommitStatus(box, ARGS.slice(0, 4), api.url, BB_CRED);
  assert.equal(got.code, 1);
  assert.equal(api.requests.length, 0);
});
