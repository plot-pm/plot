#!/usr/bin/env node
// The Bitbucket half of `plot-host.sh commit-status`. plot-host.sh checks the
// backend, resolves the workspace/repo slug from `origin`, and runs this file
// once:
//
//   plot-bitbucket-commit-status.mjs <workspace/repo|""> <sha> <state> <context> <description> <url>
//       Exits 1 where an argument is missing or empty, except workspace/repo
//       which may be empty — that is `unsupported`, not a bad argument. Exits
//       4, naming both variable names, where BITBUCKET_REVIEW_USER /
//       BITBUCKET_REVIEW_APP_PASSWORD are absent from the environment and this
//       repository's `.env`. Exits 4 naming `unsupported` where the
//       workspace/repo slug is empty, or where `state` is not one of the two
//       this op maps. Exits 3 where the write reaches the API and the API
//       refuses it. Exits 0 on a 2xx write.
//
// BITBUCKET_REVIEW_USER / BITBUCKET_REVIEW_APP_PASSWORD name a dedicated
// account's Bitbucket App password (bitbucket.org/account/settings/app-passwords/),
// modelled on plot-host.sh's JIRA_EMAIL/JIRA_API_TOKEN pair: the environment
// wins, this repository's `.env` is read only where both are unset, the
// source is named on stderr, and the value itself never reaches stdout,
// stderr, a child process's argv, or budget.tsv. This is a SEPARATE identity
// from whichever `bb` is signed in as on this machine — never read from `bb`'s
// own config or keychain — so a status written here carries its own account
// rather than the operator's.
//
// Bitbucket's build-status API:
//   POST /2.0/repositories/{workspace}/{repo_slug}/commit/{revision}/statuses/build
//   body { state, key, name, description, url }
// GitHub's state vocabulary (success|failure|error|pending) does not match
// Bitbucket's (SUCCESSFUL|FAILED|INPROGRESS|STOPPED); this maps the two this
// op is called with (success→SUCCESSFUL, failure→FAILED) and refuses any
// other value by name rather than guessing a mapping nobody asked for.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const API_BASE = (process.env.BITBUCKET_API_BASE || 'https://api.bitbucket.org/2.0').replace(/\/+$/, '');

const refuse = (code, message) => {
  process.stderr.write(`plot-host: commit-status — ${message}\n`);
  process.exit(code);
};

// GitHub's vocabulary in, Bitbucket's out. Only the two states this op is
// ever called with are mapped; anything else is refused rather than guessed —
// the brief is explicit that INPROGRESS/STOPPED have no caller to map from.
const STATE_MAP = { success: 'SUCCESSFUL', failure: 'FAILED' };

const repoRoot = () => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return '.';
  }
};

// `read_env_var`'s shape in JS: first assignment of NAME in the file, quotes
// and trailing whitespace stripped, an `export ` prefix tolerated.
const readEnvVar = (name, file) => {
  const re = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}=(.*)$`, 'm');
  const found = re.exec(file);
  if (!found) return '';
  return found[1]
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/^'(.*)'$/, '$1');
};

/** Loads BITBUCKET_REVIEW_USER/BITBUCKET_REVIEW_APP_PASSWORD from `.env` only where both are unset. */
const loadEnvFile = () => {
  if (process.env.BITBUCKET_REVIEW_USER || process.env.BITBUCKET_REVIEW_APP_PASSWORD) return;
  const envPath = path.join(repoRoot(), '.env');
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  const user = readEnvVar('BITBUCKET_REVIEW_USER', text);
  const password = readEnvVar('BITBUCKET_REVIEW_APP_PASSWORD', text);
  if (!user || !password) return; // both or neither — half a Basic credential authenticates nothing
  process.env.BITBUCKET_REVIEW_USER = user;
  process.env.BITBUCKET_REVIEW_APP_PASSWORD = password;
  process.stderr.write('plot-host: BITBUCKET_REVIEW_USER and BITBUCKET_REVIEW_APP_PASSWORD read from .env\n');
};

/** `{ user, password }`, or exit 4 naming both variables and where to create one. */
const credential = () => {
  loadEnvFile();
  const user = process.env.BITBUCKET_REVIEW_USER || '';
  const password = process.env.BITBUCKET_REVIEW_APP_PASSWORD || '';
  if (!user || !password) {
    refuse(
      4,
      'needs BITBUCKET_REVIEW_USER and BITBUCKET_REVIEW_APP_PASSWORD in the environment (or this repository\'s .env) — ' +
        'create an App password at https://bitbucket.org/account/settings/app-passwords/',
    );
  }
  return { user, password };
};

const [workspaceRepo, sha, state, context, description, targetUrl] = process.argv.slice(2);
const required = [sha, state, context, description, targetUrl];
if (process.argv.slice(2).length !== 6 || required.some((a) => !a)) {
  refuse(1, 'usage: commit-status <workspace/repo|""> <sha> <state> <context> <description> <url>, none but the first empty');
}

const cred = credential();

const mapped = STATE_MAP[state];
if (!mapped) {
  refuse(4, `unsupported — state '${state}' has no Bitbucket mapping (only success/failure are called here)`);
}

if (!workspaceRepo || !workspaceRepo.includes('/')) {
  refuse(4, 'unsupported — could not resolve a workspace/repo slug from the origin remote');
}
const [workspace, repoSlug] = workspaceRepo.split('/');

const auth = Buffer.from(`${cred.user}:${cred.password}`).toString('base64');
let response;
try {
  response = await fetch(
    `${API_BASE}/repositories/${workspace}/${repoSlug}/commit/${sha}/statuses/build`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        state: mapped,
        key: context,
        name: context,
        description,
        url: targetUrl,
      }),
    },
  );
} catch {
  refuse(3, `could not reach ${API_BASE} to write the build status`);
}
if (response.status < 200 || response.status >= 300) {
  refuse(3, `HTTP ${response.status} writing ${context} on ${sha}`);
}
