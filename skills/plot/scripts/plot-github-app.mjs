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
import os from 'node:os';
import path from 'node:path';

const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');

const run = (cmd, args) => {
  try {
    return { out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), ok: true };
  } catch {
    return { out: '', ok: false };
  }
};

/** The role a `## Plot Config` App key names, as it appears in env variables and key file names. */
export const roleOf = (configKey) => configKey.replace(/\s+app$/i, '').toLowerCase();

/** True where `appId` is safe to use inside a file name: non-empty, no `/`, no `..`. */
export const validAppId = (appId) => Boolean(appId) && !appId.includes('/') && !appId.includes('..');

/**
 * Where an App's private key is expected, as the first step that applies:
 * `PLOT_<ROLE>_APP_KEY` in `env`; the path on the config line (`declaredPath`,
 * relative to `root`); `<config home>/plot/plot-<role>.<appId>.private-key.pem`,
 * where the config home is `env.XDG_CONFIG_HOME` or `<home>/.config`. Touches
 * no file. `appId` must pass `validAppId`.
 */
export const appKeyPath = (role, appId, declaredPath, env, home, root) => {
  const fromEnv = env[`PLOT_${role.toUpperCase()}_APP_KEY`];
  if (fromEnv) return fromEnv;
  if (declaredPath) return path.isAbsolute(declaredPath) ? declaredPath : path.join(root, declaredPath);
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'plot', `plot-${role}.${appId}.private-key.pem`);
};

/**
 * The App named by a `## Plot Config` key, as `{ appId, keyPath }`. The line
 * is `<app id>` or `<app id> <key path>`; `appKeyPath` finds the key.
 * `here` is the directory `plot-config.sh` lives in (callers pass their own
 * `import.meta.url` dirname, since this module ships beside `plot-config.sh`
 * only by convention, not by import). Returns `app: null` where the key is
 * absent, names an unusable id, or resolves to a file that cannot be read, with
 * `reason` set to why and `absent: true` only where `plot-config.sh` exited 0
 * and printed nothing — a crashed config read must refuse by name rather than
 * fall back, so it reports `absent: false` like a malformed key does. The
 * caller decides the exit code, since `commit-status` refuses an absent key
 * while the Writer and Merger identities fall back to the ambient one.
 */
export const resolveApp = (configKey, here) => {
  const declared = run('bash', [path.join(here, 'plot-config.sh'), 'get', configKey, '']);
  const [appId, key] = declared.out.split(/\s+/);
  if (!appId) {
    return {
      app: null,
      absent: declared.ok && !declared.out,
      reason: `needs a '${configKey}' key in ## Plot Config (format: ${configKey}: <app id> [<key path>])`,
    };
  }
  if (!validAppId(appId)) {
    return { app: null, absent: false, reason: `'${configKey}' names an app id that is not usable in a file name: ${appId}` };
  }
  const root = run('git', ['rev-parse', '--show-toplevel']).out || '.';
  const keyPath = appKeyPath(roleOf(configKey), appId, key, process.env, os.homedir(), root);
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
