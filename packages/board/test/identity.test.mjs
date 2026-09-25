// GET /api/board carries who is reading: the host user and git's email.
//
// Wave 1 of docs/plans/2026-09-24-the-board-shows-me-only-my-work.md. This
// drives the built artifact over HTTP. It catches a schema field that parses in
// the server and never reaches the page.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { startServer, fetchBoard, makeRepo, rmTree } from './helpers.mjs';

/** A git estate whose own config is the only one git can read. */
const estate = (email) => {
  const tmp = makeRepo();
  execFileSync('git', ['init', '-q', tmp]);
  if (email) execFileSync('git', ['-C', tmp, 'config', 'user.email', email]);
  return tmp;
};

/** Keeps the machine's own identity out of the answer. */
const isolated = (tmp, extra) => ({
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GH_CONFIG_DIR: path.join(tmp, 'no-gh-config'),
  PLOT_HOST: 'github',
  PLOT_BUDGET_HOME: path.join(tmp, '.budget'),
  PLOT_BUDGET_ACCOUNT: '',
  ...extra,
});

describe('/api/board names who is reading', () => {
  const dirs = [];
  const servers = [];
  after(async () => {
    for (const s of servers) await s.stop();
    for (const d of dirs) rmTree(d);
  });

  it('carries the host user and the git email', async () => {
    const tmp = estate('reader@example.com');
    dirs.push(tmp);
    const server = await startServer(tmp, isolated(tmp, { PLOT_BUDGET_ACCOUNT: 'octo-reader' }));
    servers.push(server);
    const board = await fetchBoard(server.port);
    assert.equal(board.server.hostUser, 'octo-reader');
    assert.equal(board.server.gitEmail, 'reader@example.com');
  });

  it('carries `` for each identity nobody could read, never `unknown`', async () => {
    const tmp = estate();
    dirs.push(tmp);
    const server = await startServer(tmp, isolated(tmp));
    servers.push(server);
    const board = await fetchBoard(server.port);
    assert.equal(board.server.hostUser, '');
    assert.equal(board.server.gitEmail, '');
  });
});
