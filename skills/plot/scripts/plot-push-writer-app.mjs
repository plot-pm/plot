#!/usr/bin/env node
// The GitHub App half of a lifecycle push. `plot-push-main.sh` calls this
// instead of a bare `git push` when the push target is GitHub, so the commit
// lands authenticated as the `Writer app` installation — on the
// branch-protection bypass list with `Contents: write` only — rather than
// whichever identity `git` would otherwise find ambiently.
//
// Usage: plot-push-writer-app.mjs <branch> <default-branch>
// Output: git's own stderr on this process's stderr, nothing on stdout.
// Exit: git's own exit code on a push attempt; 4, naming the key, where
//       `Writer app` is absent from ## Plot Config or its key file cannot be
//       read — refuses before any push is attempted, so no credential-less
//       push happens first.
//
// NO CREDENTIAL LEAVES THIS PROCESS except in a request header or, for git
// itself, through GIT_ASKPASS: git invokes that program and reads the
// password from ITS stdout, never from this process's argv, environment
// variable value passed as a flag, or a URL. The askpass script holds the
// token in a FILE this process writes with mode 600 in a private temp
// directory and removes before exiting, so no token sits in `ps` or in a
// shell history.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installationToken, resolveApp } from './plot-github-app.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const refuse = (code, message) => {
  process.stderr.write(`plot-push-main: ${message}\n`);
  process.exit(code);
};

const [branch, defaultBranch] = process.argv.slice(2);
if (!branch || !defaultBranch) refuse(1, 'usage: plot-push-writer-app.mjs <branch> <default-branch>');

const { app, reason } = resolveApp('Writer app', here);
if (!app) refuse(4, reason);

const originUrl = (() => {
  try {
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
})();
const repoMatch = originUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
if (!repoMatch) refuse(3, `could not resolve an owner/repo from this checkout's origin: ${originUrl}`);
const repo = `${repoMatch[1]}/${repoMatch[2]}`;
if (!/^https:\/\//.test(originUrl)) {
  refuse(3, `the Writer app can only authenticate an HTTPS origin; this checkout's origin is ${originUrl}`);
}

const { token, error } = await installationToken(app, repo);
if (!token) refuse(3, error);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-writer-app-'));
try {
  const askpass = path.join(dir, 'askpass.sh');
  const tokenFile = path.join(dir, 'token');
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  // git invokes this once per prompt: "Username for '...'" and "Password for
  // '...'". A GitHub App installation token authenticates as `x-access-token`
  // with the token as the password — never the other way round.
  fs.writeFileSync(
    askpass,
    `#!/bin/sh\ncase "$1" in\n  Username*) echo x-access-token ;;\n  *) cat "${tokenFile}" ;;\nesac\n`,
    { mode: 0o700 },
  );

  const result = spawnSync('git', ['push', 'origin', `${branch}:${defaultBranch}`], {
    env: { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
  });
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
