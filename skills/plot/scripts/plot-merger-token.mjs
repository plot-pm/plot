#!/usr/bin/env node
// The GitHub App half of `plot-host.sh pr-merge`. Mints the `Merger app`
// installation's token for one repo and prints ONLY the token to stdout, so
// the shell can capture it into GH_TOKEN without ever putting it in a child's
// argv.
//
// Usage: plot-merger-token.mjs <owner/repo>
// Output: the installation token, and nothing else, on stdout.
// Exit: 4, naming the key, where `Merger app` is absent from ## Plot Config,
//       its key file cannot be read, or it names the SAME App id as
//       `Writer app` (one credential doing both jobs is forbidden — a merge
//       by it would carry the writer's branch-protection bypass). 3 where the
//       exchange itself fails. 0 with the token on stdout otherwise.
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

const [repo] = process.argv.slice(2);
if (!repo) refuse(1, 'usage: plot-merger-token.mjs <owner/repo>');

const { app, reason } = resolveApp('Merger app', here);
if (!app) refuse(4, reason);

// Two jobs on one credential is explicitly forbidden: a merger sharing the
// writer's App id would carry the writer's bypass-list membership into a
// merge, defeating the reason two identities exist at all. The writer key
// may legitimately be absent (not every caller of pr-merge also pushes), so
// only a NAMED, matching id refuses here.
const writer = resolveApp('Writer app', here);
if (writer.app && writer.app.appId === app.appId) {
  refuse(4, `'Merger app' and 'Writer app' name the same App id (${app.appId}); one credential cannot hold both jobs`);
}

const { token, error } = await installationToken(app, repo);
if (!token) refuse(3, error);
process.stdout.write(token);
