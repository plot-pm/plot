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
//
// The JWT → installation-token exchange itself lives in `plot-github-app.mjs`,
// shared with the Writer App (`plot-push-main.sh`) and the Merger App
// (`plot-host.sh pr-merge`) rather than copied for each.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, installationToken, resolveApp } from './plot-github-app.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const refuse = (code, message) => {
  process.stderr.write(`plot-host: commit-status — ${message}\n`);
  process.exit(code);
};

/** The `Review app` key as `{ appId, keyPath }`, or exit 4 naming what is missing. */
const reviewApp = () => {
  const { app, reason } = resolveApp('Review app', here);
  if (!app) refuse(4, reason);
  return app;
};

const [mode, ...rest] = process.argv.slice(2);
const repo = mode === '--repo' ? rest.shift() : undefined;
const [sha, state, context, description, targetUrl] = rest;
if ((mode !== '--check' && mode !== '--repo') || rest.length !== 5 || rest.some((a) => !a)) {
  refuse(1, 'usage: commit-status <sha> <state> <context> <description> <url>, none empty');
}
const app = reviewApp();
if (mode === '--check') process.exit(0);
if (repo === 'GH_REPO_VIEW_FAILED') refuse(3, 'gh repo view could not resolve owner/repo from the current checkout');
if (!repo) refuse(3, 'could not resolve owner/repo from the current checkout');

const { token, error } = await installationToken(app, repo);
if (!token) refuse(3, error);

const write = await call(token, 'POST', `repos/${repo}/statuses/${sha}`, {
  state,
  context,
  description,
  target_url: targetUrl,
});
if (write.status < 200 || write.status >= 300) refuse(3, `HTTP ${write.status} writing ${context} on ${sha}`);
