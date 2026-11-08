#!/usr/bin/env node
// The GitHub App half of `plot-host.sh pr-merge`. Mints the `Merger app`
// installation's token for one repo and prints ONLY the token to stdout, so
// the shell can capture it into GH_TOKEN without ever putting it in a child's
// argv.
//
// Usage: plot-merger-token.mjs <owner/repo>
//        plot-merger-token.mjs --check
// Output: the installation token, and nothing else, on stdout. `--check`
//         prints nothing on stdout ever — it answers only through its exit
//         code, and mints no token, so a usable key costs no network call.
// Exit: 5 with one notice line on stderr and nothing on stdout where
//       ## Plot Config declares no `Merger app` key, so the caller merges as
//       the signed-in `gh` identity. 4, naming the key, where `Merger app` is
//       declared but malformed, its key file cannot be read, or it names the
//       SAME App id as `Writer app` (one credential doing both jobs is
//       forbidden — a merge by it would carry the writer's branch-protection
//       bypass). 3 where the exchange itself fails (not reachable from
//       `--check`, which exchanges nothing). 0 with the token on stdout
//       otherwise, or with nothing on stdout for `--check`.
//
// NO CREDENTIAL LEAVES THIS PROCESS except in a request header. The JWT and
// the installation token travel through `fetch`; the token this script
// prints is read by the caller directly into an environment variable, never
// passed back out through this process's own argv or a file.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installationToken, resolveApp } from './plot-github-app.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const refuse = (code, message) => {
  process.stderr.write(`plot-host: pr-merge — ${message}\n`);
  process.exit(code);
};

/**
 * `resolveApp('Merger app', ...)` plus the same-id-as-Writer check, the one
 * piece of validity `resolveApp` itself does not cover. Shared by the minting
 * path and `--check` so neither reimplements it.
 */
const checkMergerApp = () => {
  const { app, absent, reason } = resolveApp('Merger app', here);
  if (absent) return { app: null, absent: true, reason: 'Merger app not configured — merging as the signed-in gh identity' };
  if (!app) return { app: null, absent: false, reason };

  // Two jobs on one credential is explicitly forbidden: a merger sharing the
  // writer's App id would carry the writer's bypass-list membership into a
  // merge, defeating the reason two identities exist at all. The writer key
  // may legitimately be absent (not every caller of pr-merge also pushes), so
  // only a NAMED, matching id refuses here.
  const writer = resolveApp('Writer app', here);
  if (writer.app && writer.app.appId === app.appId) {
    return {
      app: null,
      absent: false,
      reason: `'Merger app' and 'Writer app' name the same App id (${app.appId}); one credential cannot hold both jobs`,
    };
  }
  return { app, absent: false, reason: null };
};

const [arg] = process.argv.slice(2);

if (arg === '--check') {
  const { app, absent, reason } = checkMergerApp();
  if (absent) refuse(5, reason);
  if (!app) refuse(4, reason);
  process.exit(0);
}

// `--check-app <config key>`: the same exit contract as `--check` for any App
// key (`Review app`, `Merger app`, `Writer app`). Reads, mints nothing.
if (arg === '--check-app') {
  const configKey = process.argv[3];
  if (!configKey) refuse(1, 'usage: plot-merger-token.mjs --check-app <config key>');
  const { app, absent, reason } = configKey === 'Merger app' ? checkMergerApp() : resolveApp(configKey, here);
  if (absent) refuse(5, reason);
  if (!app) refuse(4, reason);
  process.exit(0);
}

const repo = arg;
if (!repo) refuse(1, 'usage: plot-merger-token.mjs <owner/repo> | --check | --check-app <config key>');

const { app, absent, reason } = checkMergerApp();
if (absent) refuse(5, reason);
if (!app) refuse(4, reason);

const { token, error } = await installationToken(app, repo);
if (!token) refuse(3, error);
process.stdout.write(token);
