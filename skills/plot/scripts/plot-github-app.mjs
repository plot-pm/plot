// The GitHub App exchange, shared by every Plot identity that authenticates as
// an App installation rather than as a person. `plot-commit-status.mjs` had
// this flow built in for the `Review app`; this module is that flow, taken out
// so a Writer App and a Merger App can call it too instead of copying it.
//
// The exchange GitHub documents for an App: an RS256 JWT with `iss` = the App
// id authenticates GET /repos/{owner}/{repo}/installation and POST
// /app/installations/{id}/access_tokens; the installation token from the
// second call authenticates the actual write. A bare App JWT is rejected by
// every write endpoint that isn't the two above.
//
// NO CREDENTIAL LEAVES THIS PROCESS except in a request header. The JWT and
// the installation token travel through `fetch`, never through a child's argv
// (which `ps` shows every local user), a file, stderr or a log.
//
// `GITHUB_API_URL` sets the API base, as it does on Actions and for GitHub
// Enterprise Server; it defaults to https://api.github.com.
import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');

const run = (cmd, args) => {
  try {
    return { out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), ok: true };
  } catch {
    return { out: '', ok: false };
  }
};

/**
 * The App named by a `## Plot Config` key, as `{ appId, keyPath }`.
 * `here` is the directory `plot-config.sh` lives in (callers pass their own
 * `import.meta.url` dirname, since this module ships beside `plot-config.sh`
 * only by convention, not by import). Returns `app: null` where the key is
 * absent, malformed, or names a file that cannot be read, with `reason` set to
 * why and `absent: true` only where `plot-config.sh` exited 0 and printed
 * nothing — a crashed config read must refuse by name rather than fall back,
 * so it reports `absent: false` like a malformed key does. The caller decides
 * the exit code, since `commit-status` refuses an absent key while the Writer
 * and Merger identities fall back to the ambient one.
 */
export const resolveApp = (configKey, here) => {
  const declared = run('bash', [path.join(here, 'plot-config.sh'), 'get', configKey, '']);
  const [appId, key] = declared.out.split(/\s+/);
  if (!appId || !key) {
    return {
      app: null,
      absent: declared.ok && !declared.out,
      reason: `needs a '${configKey}' key in ## Plot Config (format: ${configKey}: <app id> <key path>)`,
    };
  }
  const keyPath = path.isAbsolute(key) ? key : path.join(run('git', ['rev-parse', '--show-toplevel']).out || '.', key);
  try {
    fs.accessSync(keyPath, fs.constants.R_OK);
  } catch {
    return { app: null, absent: false, reason: `'${configKey}' names a key file that cannot be read: ${keyPath}` };
  }
  return { app: { appId, keyPath }, absent: false, reason: null };
};

const b64url = (text) => Buffer.from(text).toString('base64url');

/** An App JWT: `iat` 60 s back for clock drift, `exp` under GitHub's 10-minute ceiling. */
export const appJwt = ({ appId, keyPath }) => {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url('{"alg":"RS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }))}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(fs.readFileSync(keyPath)).toString('base64url')}`;
};

/** One GitHub API call; resolves to `{ status, body }`, status 0 where the request never completed. */
export const call = async (credential, method, route, body) => {
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

/**
 * The two-call mint: App JWT → installation id → installation token. Resolves
 * to `{ token, error }`, `token` undefined and `error` naming the failed step
 * where either call fails — the caller decides the exit code and message
 * prefix, since each of the three identities refuses differently.
 */
export const installationToken = async (app, repo) => {
  let jwt;
  try {
    jwt = appJwt(app);
  } catch {
    return { token: undefined, error: `App ${app.appId}'s key failed to sign a JWT` };
  }
  const installation = await call(jwt, 'GET', `repos/${repo}/installation`);
  if (!installation.body.id) {
    return { token: undefined, error: `App ${app.appId} has no installation on ${repo} (HTTP ${installation.status})` };
  }
  const minted = await call(jwt, 'POST', `app/installations/${installation.body.id}/access_tokens`);
  if (!minted.body.token) {
    return { token: undefined, error: `could not mint an installation token for App ${app.appId} (HTTP ${minted.status})` };
  }
  return { token: minted.body.token, error: null };
};
