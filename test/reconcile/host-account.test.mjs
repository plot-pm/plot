// `plot-host.sh account` — who is reading the board, at no request's cost.
//
// Wave 1 of docs/plans/2026-09-24-the-board-shows-me-only-my-work.md. The op
// exposes the reading `budget_account` already makes and changes nothing it
// returns to the budget callers. Each test names the implementation it catches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');

const HOSTS_YML = `github.com:
    users:
        octo-reader:
    git_protocol: ssh
    user: octo-reader
`;

/** A scratch repo with an origin remote, a `gh` config dir, and a PATH stub dir. */
const sandbox = (remote) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-host-account-'));
  execFileSync('git', ['init', '-q', root]);
  if (remote) execFileSync('git', ['-C', root, 'remote', 'add', 'origin', remote]);
  const ghConfig = path.join(root, 'gh');
  fs.mkdirSync(ghConfig);
  // A `gh` and a `bb` that record being called. The op must reach neither: an
  // identity asked on the board's timer must not spend a request.
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const called = path.join(root, 'called');
  for (const cli of ['gh', 'bb']) {
    const stub = path.join(bin, cli);
    fs.writeFileSync(stub, `#!/bin/sh\necho "${cli} $*" >> "${called}"\necho api-user\n`);
    fs.chmodSync(stub, 0o755);
  }
  return { root, ghConfig, bin, called };
};

const account = (box, backend, extra = {}) => {
  const env = {
    ...process.env,
    PATH: `${box.bin}:${process.env.PATH}`,
    PLOT_HOST: backend,
    GH_CONFIG_DIR: box.ghConfig,
    PLOT_BUDGET_HOME: path.join(box.root, 'budget'),
    ...extra,
  };
  delete env.PLOT_BUDGET_ACCOUNT;
  if (extra.PLOT_BUDGET_ACCOUNT !== undefined) env.PLOT_BUDGET_ACCOUNT = extra.PLOT_BUDGET_ACCOUNT;
  const res = spawnSync('bash', [adapter, 'account'], { cwd: box.root, encoding: 'utf8', env });
  return { code: res.status, out: res.stdout.trim(), err: res.stderr };
};

const cliCalls = (box) =>
  fs.existsSync(box.called) ? fs.readFileSync(box.called, 'utf8').trim() : '';

test('account: GitHub answers the login from hosts.yml, and asks no API', () => {
  // CATCHES an implementation that calls `gh api user`: the stub would answer
  // `api-user`, and the fixture file names `octo-reader`.
  const box = sandbox('git@github.com:octo/repo.git');
  fs.writeFileSync(path.join(box.ghConfig, 'hosts.yml'), HOSTS_YML);
  const got = account(box, 'github');
  assert.equal(got.code, 0, got.err);
  assert.equal(got.out, 'octo-reader');
  assert.equal(cliCalls(box), '', 'the op reached a host CLI');
});

test('account: an unreadable hosts.yml exits 3 and never prints `unknown`', () => {
  // CATCHES a straight re-export of `budget_account`, which prints `unknown`
  // with exit 0 — a login that matches nothing and reads as a name.
  const box = sandbox('git@github.com:octo/repo.git');
  const got = account(box, 'github');
  assert.equal(got.code, 3);
  assert.equal(got.out, '');
  assert.match(got.err, /hosts\.yml/);
});

test('account: Bitbucket does not answer the workspace', () => {
  // CATCHES a re-export of the Bitbucket arm, which answers the remote's owner
  // segment. On a team workspace that is every contributor's answer.
  const box = sandbox('git@bitbucket.org:someteam/repo.git');
  const got = account(box, 'bitbucket');
  assert.notEqual(got.out, 'someteam');
  assert.equal(got.out, '');
  assert.equal(got.code, 4, 'Bitbucket has no free reading, which is the unaskable exit');
  assert.equal(cliCalls(box), '', 'the op reached a host CLI');
});

test('account: PLOT_BUDGET_ACCOUNT overrides the reading on both backends', () => {
  for (const [backend, remote] of [
    ['github', 'git@github.com:octo/repo.git'],
    ['bitbucket', 'git@bitbucket.org:someteam/repo.git'],
  ]) {
    const box = sandbox(remote);
    const got = account(box, backend, { PLOT_BUDGET_ACCOUNT: 'pinned' });
    assert.equal(got.code, 0, `${backend}: ${got.err}`);
    assert.equal(got.out, 'pinned', backend);
  }
});

test('account: budget_account still answers its callers as before', () => {
  // CATCHES a Bitbucket fix made inside the shared function. The budget key
  // groups by workspace on purpose, and `unknown` is its honest group name.
  const src = fs.readFileSync(adapter, 'utf8');
  const fn = src.match(/^budget_account\(\) \{\n[\s\S]*?\n\}\n/m);
  assert.ok(fn, 'budget_account is no longer defined in plot-host.sh');
  const ask = (box, backend) =>
    spawnSync('bash', ['-c', `${fn[0]}\nbudget_account ${backend}`], {
      cwd: box.root,
      encoding: 'utf8',
      env: { ...process.env, GH_CONFIG_DIR: box.ghConfig, PLOT_BUDGET_ACCOUNT: '' },
    }).stdout.trim();

  const bitbucket = sandbox('git@bitbucket.org:someteam/repo.git');
  assert.equal(ask(bitbucket, 'bitbucket'), 'someteam');

  const github = sandbox('git@github.com:octo/repo.git');
  assert.equal(ask(github, 'github'), 'unknown');
  fs.writeFileSync(path.join(github.ghConfig, 'hosts.yml'), HOSTS_YML);
  assert.equal(ask(github, 'github'), 'octo-reader');
});
