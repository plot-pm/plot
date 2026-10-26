// `plot-host.sh pr-comment <number> <body>` — one comment on a PR's
// timeline through the signed-in `gh` identity on GitHub, exit 4 on Bitbucket.
// The `gh` and `bb` on PATH are stubs that log their argv; nothing reaches a
// real host.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every directory this file creates, removed after its last test by the exact
// path mkdtempSync returned — never by a glob over the shared temp directory.
const made = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');

// The identity `gh_marker_comment_id` scopes a marker match to: the login the
// stub answers for `gh api user -q .login`. A fixture comment whose
// `user.login` is this value is "ours"; any other login is a PR participant's
// own comment. The sandbox's `hosts.yml` and `PLOT_BUDGET_ACCOUNT` name two
// OTHER identities, so a lookup that read either one would miss its own comment.
const PLOT_LOGIN = 'plot-bot';
const HOSTS_YML_USER = 'hosts-yml-user';
const GROUPING_ACCOUNT = 'a-grouping-name';

/** A scratch repo whose `gh` and `bb` log their argv to `calls` and run `ghTail`/`bbTail`. */
const sandbox = ({ ghTail = 'exit 0', bbTail = 'exit 0' } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-host-pr-comment-'));
  made.push(root);
  execFileSync('git', ['init', '-q', root]);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const calls = path.join(root, 'calls');
  const stub = (name, tail) => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${tail}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  };
  stub('gh', ghTail);
  stub('bb', bbTail);
  const ghConfigDir = path.join(root, 'gh-config');
  fs.mkdirSync(ghConfigDir);
  fs.writeFileSync(path.join(ghConfigDir, 'hosts.yml'), `github.com:\n    user: ${HOSTS_YML_USER}\n`);
  return { root, bin, calls, ghConfigDir };
};

const prComment = (box, backend, args) =>
  new Promise((resolve) => {
    const child = spawn('bash', [adapter, 'pr-comment', ...args], {
      cwd: box.root,
      env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, PLOT_HOST: backend, GH_CONFIG_DIR: box.ghConfigDir, PLOT_BUDGET_ACCOUNT: GROUPING_ACCOUNT },
    });
    let err = '';
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => resolve({ code, err }));
  });

const callLog = (box) => (fs.existsSync(box.calls) ? fs.readFileSync(box.calls, 'utf8') : '');

test('pr-comment: GitHub posts the body through gh pr comment and exits 0', async () => {
  const box = sandbox();
  const got = await prComment(box, 'github', ['7', 'HIGH 1, MEDIUM 0, LOW 0']);
  assert.equal(got.code, 0, got.err);
  assert.match(callLog(box), /^gh pr comment 7 --body HIGH 1, MEDIUM 0, LOW 0$/m);
});

test('pr-comment: a gh call that fails exits 3 with gh’s own words', async () => {
  const box = sandbox({ ghTail: 'echo "HTTP 403: Resource not accessible" >&2; exit 1' });
  const got = await prComment(box, 'github', ['7', 'b']);
  assert.equal(got.code, 3);
  assert.match(got.err, /HTTP 403: Resource not accessible/);
});

test('pr-comment: Bitbucket exits 4, names the backend, and calls neither CLI', async () => {
  const box = sandbox();
  const got = await prComment(box, 'bitbucket', ['7', 'b']);
  assert.equal(got.code, 4);
  assert.match(got.err, /pr-comment: bitbucket has no verified pr-comment write/);
  assert.doesNotMatch(callLog(box), /^(gh|bb) pr comment/m);
});

/**
 * A `gh` whose comment list answers `comments`, whose `api user` answers
 * `login` (or fails with a 403 when `login` is null), and whose every other
 * call exits 0.
 */
const listing = (comments, login = PLOT_LOGIN) => ({
  ghTail: [
    login === null
      ? `[ "$1 $2" = "api user" ] && { echo "HTTP 403: Resource not accessible by integration" >&2; exit 1; }`
      : `[ "$1 $2" = "api user" ] && { echo '${login}'; exit 0; }`,
    `[ "$1 $2" = "api --paginate" ] && echo '${JSON.stringify(comments)}'; exit 0`,
  ].join('\n'),
});

test('pr-comment: a marker held by an earlier comment edits that comment and posts nothing', async () => {
  const box = sandbox(listing([
    { id: 11, body: 'other', user: { login: PLOT_LOGIN } },
    { id: 12, body: 'old <!-- m -->', user: { login: PLOT_LOGIN } },
  ]));
  const got = await prComment(box, 'github', ['7', 'new <!-- m -->', '<!-- m -->']);
  assert.equal(got.code, 0, got.err);
  assert.match(callLog(box), /^gh api -X PATCH repos\/\{owner\}\/\{repo\}\/issues\/comments\/12 -f body=new <!-- m -->$/m);
  assert.doesNotMatch(callLog(box), /^gh pr comment/m);
});

test('pr-comment: a marker held only by another author’s comment does not match — posts instead of editing', async () => {
  const box = sandbox(listing([{ id: 12, body: 'old <!-- m -->', user: { login: 'a-pr-participant' } }]));
  const got = await prComment(box, 'github', ['7', 'new <!-- m -->', '<!-- m -->']);
  assert.equal(got.code, 0, got.err);
  assert.match(callLog(box), /^gh pr comment 7 --body new <!-- m -->$/m);
  assert.doesNotMatch(callLog(box), /PATCH/);
});

test('pr-comment: a marker comment with no user field edits that comment while the login is known', async () => {
  const box = sandbox(listing([{ id: 12, body: 'old <!-- m -->' }]));
  const got = await prComment(box, 'github', ['7', 'new <!-- m -->', '<!-- m -->']);
  assert.equal(got.code, 0, got.err);
  assert.match(callLog(box), /^gh api -X PATCH repos\/\{owner\}\/\{repo\}\/issues\/comments\/12 -f body=new <!-- m -->$/m);
  assert.doesNotMatch(callLog(box), /^gh pr comment/m);
});

test('pr-comment: with no login from gh api user, the marker alone matches and another author’s comment is edited', async () => {
  const box = sandbox(listing([{ id: 12, body: 'old <!-- m -->', user: { login: 'a-pr-participant' } }], null));
  const got = await prComment(box, 'github', ['7', 'new <!-- m -->', '<!-- m -->']);
  assert.equal(got.code, 0, got.err);
  assert.match(callLog(box), /^gh api -X PATCH repos\/\{owner\}\/\{repo\}\/issues\/comments\/12 -f body=new <!-- m -->$/m);
  assert.doesNotMatch(callLog(box), /^gh pr comment/m);
});

test('pr-comment: a marker no comment holds posts, and so does a PR with no comments', async () => {
  for (const comments of [[{ id: 11, body: 'other', user: { login: PLOT_LOGIN } }], []]) {
    const box = sandbox(listing(comments));
    const got = await prComment(box, 'github', ['7', 'first <!-- m -->', '<!-- m -->']);
    assert.equal(got.code, 0, got.err);
    assert.match(callLog(box), /^gh pr comment 7 --body first <!-- m -->$/m);
    assert.doesNotMatch(callLog(box), /PATCH/);
  }
});

test('pr-comment: a failed edit exits 3 and posts nothing beside it', async () => {
  const box = sandbox({
    ghTail: `[ "$1 $2" = "api --paginate" ] && echo '[{"id":12,"body":"<!-- m -->","user":{"login":"${PLOT_LOGIN}"}}]' && exit 0\n[ "$2" = "-X" ] && { echo "HTTP 403" >&2; exit 1; }\nexit 0`,
  });
  const got = await prComment(box, 'github', ['7', 'b <!-- m -->', '<!-- m -->']);
  assert.equal(got.code, 3);
  assert.doesNotMatch(callLog(box), /^gh pr comment/m);
});

test('pr-comment: a failed listing exits 3 and posts nothing — never "no marker found"', async () => {
  const box = sandbox({
    ghTail: `[ "$1 $2" = "api --paginate" ] && { echo "HTTP 502: Bad Gateway" >&2; exit 1; }\nexit 0`,
  });
  const got = await prComment(box, 'github', ['7', 'b <!-- m -->', '<!-- m -->']);
  assert.equal(got.code, 3);
  assert.match(got.err, /HTTP 502: Bad Gateway/);
  assert.doesNotMatch(callLog(box), /^gh pr comment/m);
});

test('pr-comment: Bitbucket with a marker still exits 4 and reads nothing', async () => {
  const box = sandbox();
  const got = await prComment(box, 'bitbucket', ['7', 'b', '<!-- m -->']);
  assert.equal(got.code, 4);
  assert.equal(callLog(box), '');
});
