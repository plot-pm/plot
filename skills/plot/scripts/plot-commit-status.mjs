#!/usr/bin/env node
// The GitHub App half of `plot-host.sh commit-status`. plot-host.sh checks the
// backend, resolves owner/repo through `gh`, and runs this file twice:
//
//   plot-commit-status.mjs --check <sha> <state> <context> <description> <url>
//       Exits 1 where an argument is missing or empty, 4, naming the key,
//       where `Review app` is absent from `## Plot Config` or its key file
//       cannot be read, and 0 otherwise. It makes no network call.
//   plot-commit-status.mjs --repo <owner/repo> <sha> <state> <context> <description> <url>
//       Checks as `--check` does, then writes one commit status as the App's
//       installation. Exits 3 where owner/repo is empty or a GitHub call
//       fails, 0 on a 2xx write.
//
// `Review app` is `<app id> <key path>`. A relative key path resolves against
// the repository root, so an agent in a worktree reads the operator's key. It
// names a SECOND App, with no branch-protection bypass: the build App's key
// lives only in Actions secrets.
//
// The exchange GitHub documents for an App: an RS256 JWT with `iss` = the App
// id authenticates GET /repos/{owner}/{repo}/installation and POST
// /app/installations/{id}/access_tokens; the installation token from the
// second call authenticates POST /repos/{owner}/{repo}/statuses/{sha}. The
// statuses API rejects a bare App JWT.
//
// NO CREDENTIAL LEAVES THIS PROCESS except in a request header. The JWT and the
// installation token travel through `fetch`, never through a child's argv
// (which `ps` shows every local user), a file, stderr or a log.
//
// `GITHUB_API_URL` sets the API base, as it does on Actions and for GitHub
// Enterprise Server; it defaults to https://api.github.com.
import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');

const refuse = (code, message) => {
  process.stderr.write(`plot-host: commit-status — ${message}\n`);
  process.exit(code);
};

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/** The `Review app` key as `{ appId, keyPath }`, or exit 4 naming what is missing. */
const reviewApp = () => {
  const [appId, key] = run('bash', [path.join(here, 'plot-config.sh'), 'get', 'Review app', '']).split(/\s+/);
  if (!appId || !key) {
    refuse(4, "needs a 'Review app' key in ## Plot Config (format: Review app: <app id> <key path>)");
  }
  const keyPath = path.isAbsolute(key) ? key : path.join(run('git', ['rev-parse', '--show-toplevel']) || '.', key);
  try {
    fs.accessSync(keyPath, fs.constants.R_OK);
  } catch {
    refuse(4, `'Review app' names a key file that cannot be read: ${keyPath}`);
  }
  return { appId, keyPath };
};

const b64url = (text) => Buffer.from(text).toString('base64url');

/** An App JWT: `iat` 60 s back for clock drift, `exp` under GitHub's 10-minute ceiling. */
const appJwt = ({ appId, keyPath }) => {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url('{"alg":"RS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }))}`;
  try {
    return `${input}.${createSign('RSA-SHA256').update(input).sign(fs.readFileSync(keyPath)).toString('base64url')}`;
  } catch {
    return refuse(3, `could not sign a JWT for App ${appId}`);
  }
};

/** One GitHub API call; resolves to `{ status, body }`, status 0 where the request never completed. */
const call = async (credential, method, route, body) => {
  try {
    const res = await fetch(`${api}/${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${credential}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: {} };
  }
};

const [mode, ...rest] = process.argv.slice(2);
const repo = mode === '--repo' ? rest.shift() : undefined;
const [sha, state, context, description, targetUrl] = rest;
if ((mode !== '--check' && mode !== '--repo') || rest.length !== 5 || rest.some((a) => !a)) {
  refuse(1, 'usage: commit-status <sha> <state> <context> <description> <url>, none empty');
}
const app = reviewApp();
if (mode === '--check') process.exit(0);
if (!repo) refuse(3, 'could not resolve owner/repo from the current checkout');

const jwt = appJwt(app);
const installation = await call(jwt, 'GET', `repos/${repo}/installation`);
if (!installation.body.id) refuse(3, `App ${app.appId} has no installation on ${repo} (HTTP ${installation.status})`);

const minted = await call(jwt, 'POST', `app/installations/${installation.body.id}/access_tokens`);
if (!minted.body.token) refuse(3, `could not mint an installation token for App ${app.appId} (HTTP ${minted.status})`);

const write = await call(minted.body.token, 'POST', `repos/${repo}/statuses/${sha}`, {
  state,
  context,
  description,
  target_url: targetUrl,
});
if (write.status < 200 || write.status >= 300) refuse(3, `HTTP ${write.status} writing ${context} on ${sha}`);
