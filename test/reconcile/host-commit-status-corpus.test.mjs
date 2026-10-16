// Feeds ONE input set to the GitHub and Bitbucket arms of
// `plot-host.sh commit-status` and compares which states each accepts and
// refuses. This is NOT the domain's corpus tier (`packages/domain/corpus/`):
// neither arm is a domain rule duplicated in shell, nor an adapter read
// against production — they are two Node helpers outside the domain package,
// so this file sits beside `test/reconcile/host-commit-status.test.mjs`
// instead, per the plan's own instruction for that case.
//
// GitHub's `plot-commit-status.mjs` has no local state vocabulary check — it
// forwards `state` to the API untouched, so its "accept" here means "passes
// this helper's own gates and reaches the API", not "GitHub's API accepts it".
// Bitbucket's `plot-bitbucket-commit-status.mjs` maps three of GitHub's four
// states and refuses the rest (including `error`, a deliberate decision — see
// its header comment) before any network call.
//
// ON A DISAGREEMENT THE BRANCH STOPS. Adjusting either side to make the
// comparison pass is the one forbidden move (docs/shell-and-domain.md). Where
// the two arms answer differently on purpose, the state is named in
// KNOWN_DIVERGENCES with the reason, and the test asserts that set exactly —
// so an unnamed, new disagreement still fails, and the set shrinks only when
// the plan that closes it lands.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

const ARGS_TAIL = ['plot/review', 'a status', 'https://example.com/run/1'];

const fakeGitHub = async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const reply = (code, json) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.method === 'GET' && req.url === '/repos/octo/repo/installation') return reply(200, { id: 999 });
      if (req.method === 'POST' && req.url === '/app/installations/999/access_tokens') {
        return reply(201, { token: 'installation-token' });
      }
      if (req.method === 'POST' && req.url.startsWith('/repos/octo/repo/statuses/')) return reply(201, {});
      return reply(404, { message: 'unexpected route' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

const fakeBitbucket = async () => {
  const server = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

const ghSandbox = () => {
  const root = scratch('plot-host-corpus-gh-');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'git@github.com:octo/repo.git']);
  const keyPath = path.join(root, 'review-app-key.pem');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `## Plot Config\n\n- **Review app:** 123456 ${keyPath}\n`);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "octo/repo"\n');
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  return { root, bin };
};

const bbSandbox = () => {
  const root = scratch('plot-host-corpus-bb-');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'git@bitbucket.org:myws/myrepo.git']);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Plot Config\n\n');
  return { root };
};

const run = (box, args, api, extra) =>
  new Promise((resolve) => {
    const child = spawn('bash', [adapter, 'commit-status', ...args], {
      cwd: box.root,
      env: { ...process.env, PATH: `${box.bin || ''}:${process.env.PATH}`, ...extra, GITHUB_API_URL: api, BITBUCKET_API_BASE: api },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });

const githubAnswer = async (state) => {
  const box = ghSandbox();
  const api = await fakeGitHub();
  const got = await run(box, ['deadbeef', state, ...ARGS_TAIL], api, { PLOT_HOST: 'github' });
  return got.code === 0 ? 'accepted' : 'refused';
};

const bitbucketAnswer = async (state) => {
  const box = bbSandbox();
  const api = await fakeBitbucket();
  const got = await run(box, ['deadbeef', state, ...ARGS_TAIL], api, {
    PLOT_HOST: 'bitbucket',
    BITBUCKET_REVIEW_USER: 'review-bot',
    BITBUCKET_REVIEW_APP_PASSWORD: 'app-pw-secret',
  });
  return got.code === 0 ? 'accepted' : 'refused';
};

// GitHub's native vocabulary — the one input set both arms are called with.
const STATES = ['success', 'failure', 'pending', 'error'];

// `error` is the plan's own open question, closed as a deliberate refusal:
// Bitbucket's nearest words (FAILED, STOPPED) both mean something else, and no
// caller in this repository ever writes `error`. See
// plot-bitbucket-commit-status.mjs's header comment for the full reasoning.
const KNOWN_DIVERGENCES = { error: 'github forwards any state untouched; bitbucket refuses it — no 1:1 mapping, no caller' };

test('commit-status: GitHub and Bitbucket disagree on exactly the named states, no more and no fewer', async () => {
  const unnamed = [];
  const found = [];
  for (const state of STATES) {
    const [gh, bb] = await Promise.all([githubAnswer(state), bitbucketAnswer(state)]);
    if (gh === bb) continue;
    found.push(state);
    if (!(state in KNOWN_DIVERGENCES)) unnamed.push(`${state} :: github=${gh} bitbucket=${bb}`);
  }
  assert.deepEqual(unnamed, [], unnamed.join('\n'));
  assert.deepEqual(found.sort(), Object.keys(KNOWN_DIVERGENCES).sort(), 'a known divergence stopped disagreeing — shrink KNOWN_DIVERGENCES');
});
