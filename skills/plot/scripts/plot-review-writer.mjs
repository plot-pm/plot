#!/usr/bin/env node
// The login that Review app's `plot/review` statuses carry, as `<slug>[bot]`.
// Read by the host adapter's `reviewWriter`; `checkedReview` judges a
// `pr-review` reading against it.
//
//   plot-review-writer.mjs
//       Prints the login and exits 0. Prints nothing and exits 0 where the
//       default branch's config declares no `Review app` key (the reading is
//       unchecked). Exits 4, naming the cause on stderr, where `origin/<default>`
//       does not exist, the key is malformed or names a key file that cannot be
//       read, the JWT does not sign, or `GET /app` does not answer.
//
// THE TRUST ANCHOR IS THE COMMITTED CONFIG ON THE DEFAULT BRANCH. `Review app`
// is read through `git show origin/<default>:CLAUDE.md`, then `AGENTS.md`, and
// never from the working tree: a desk or a PR head must not choose the login
// its own `plot/review` status is judged against. Nothing here fetches, so a
// `Review app` changed on the host since the last fetch reads the old value.
//
// The bot user id is not the App id and no status field names the integration,
// so the slug comes from `GET /app` with the App JWT. `GITHUB_API_URL` sets the
// API base, as in `plot-github-app.mjs`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appJwt, call } from './plot-github-app.mjs';

const refuse = (message) => {
  process.stderr.write(`plot-review-writer: ${message}\n`);
  process.exit(4);
};

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};

/** `origin/<default>`: the remote's HEAD where it is set, else `origin/main`, else `origin/master`. */
const defaultRef = () => {
  const head = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')?.trim();
  return [head, 'origin/main', 'origin/master'].find((ref) => ref && git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`) !== null);
};

/** The `Review app` value inside a `## Plot Config` section, or null. */
const reviewAppOf = (text) => {
  let inSection = false;
  for (const line of text.split('\n')) {
    if (/^##\s/.test(line)) inSection = /^##\s+Plot Config\b/i.test(line);
    if (!inSection) continue;
    const m = /^\s*(?:[-*]\s+)?(?:\*\*)?Review app:(?:\*\*)?\s*(.*)$/i.exec(line);
    if (m) return m[1].replace(/`/g, '').replace(/\([^)]*\)/g, '').trim();
  }
  return null;
};

const ref = defaultRef();
if (!ref) refuse('no origin/<default> ref to read `Review app` from');

let declared = null;
for (const file of ['CLAUDE.md', 'AGENTS.md']) {
  const text = git('show', `${ref}:${file}`);
  declared = text === null ? null : reviewAppOf(text);
  if (declared !== null) break;
}
if (declared === null || declared === '') process.exit(0);

const [appId, key] = declared.split(/\s+/);
if (!appId || !key) refuse(`'Review app' needs <app id> <key path>, read from ${ref}`);
const root = git('rev-parse', '--show-toplevel')?.trim() || '.';
const keyPath = path.isAbsolute(key) ? key : path.join(root, key);
try {
  fs.accessSync(keyPath, fs.constants.R_OK);
} catch {
  refuse(`'Review app' names a key file that cannot be read: ${keyPath}`);
}

let jwt;
try {
  jwt = appJwt({ appId, keyPath });
} catch {
  refuse(`App ${appId}'s key failed to sign a JWT`);
}
const app = await call(jwt, 'GET', 'app');
if (app.status !== 200 || !app.body.slug) refuse(`GET /app did not name App ${appId} (HTTP ${app.status})`);
process.stdout.write(`${app.body.slug}[bot]\n`);
