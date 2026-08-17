// The route contract for the board's SECOND state-changing endpoint.
//
// Modelled on dispatch.test.mjs, and deliberately so: `/api/approve` is the
// same door with a different thing behind it, and the guards are shared code.
// The tests are duplicated rather than parameterised because a guard that
// silently stopped applying to one route is exactly the regression worth
// spending a few repeated lines on — a shared loop would be deleted with the
// route it was written for.
//
// These tests never approve anything. `Approve command` in the scratch repo's
// CLAUDE.md points at a stub that records its argv and exits, so no PR is
// merged and nothing is pushed from CI.
//
// The load-bearing assertions:
//   - a REFUSED request ran nothing;
//   - a failing command's OWN WORDS reach the client, rather than "failed".
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startServer,
  fetchBoard,
  makeRepo,
  makeStubScripts,
  request,
  writeApproveCommand,
} from './helpers.mjs';

const DRAFT = `# Ship the widget
## Status
- **Phase:** Draft
- **Type:** feature
`;

/** Wait for the stub's marker file to settle — the spawn is detached. */
async function settle(ms = 400) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait until `read()` returns something, or give up.
 *
 * Used where the assertion is that something DID happen: a fixed sleep long
 * enough for a loaded CI machine is a slow suite, and one short enough to be
 * fast is a flake. Assertions that nothing happened still use a flat `settle` —
 * there is no event to wait for, and waiting longer is the whole point.
 */
async function until(read, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = read();
    if (value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0)) {
      return value;
    }
    if (Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** POST /api/approve as the board's own page would. */
function approve(port, slug) {
  return request(port, {
    method: 'POST',
    path: '/api/approve',
    headers: { 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ slug }),
  });
}

describe('POST /api/approve: allow-listed ahead of the 405, and only then', () => {
  let tmp, server, stub, ran;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: DRAFT }] });
    ran = writeApproveCommand(tmp);
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('answers 202 with the slug and the log path the SERVER chose', async () => {
    const res = await approve(server.port, 'ship-the-widget');
    assert.equal(res.status, 202);
    const body = JSON.parse(res.body);
    assert.equal(body.slug, 'ship-the-widget');
    // Beside the repo, next to the dispatcher's own logs, and named for the
    // ACT rather than the tool — `plot-approve-<slug>.log` sits beside
    // `plot-dispatch-<slug>.log` and neither can be mistaken for the other.
    assert.equal(
      fs.realpathSync(path.dirname(body.log)),
      fs.realpathSync(path.resolve(tmp, '..')),
    );
    assert.equal(path.basename(body.log), 'plot-approve-ship-the-widget.log');
  });

  it('runs the configured Approve command with /plot-approve <slug>', async () => {
    await until(() => ran.runs());
    // The board asks for the SKILL by name and passes the slug. It does not
    // merge a PR, flip a phase or write a record — every one of those rules
    // lives in `/plot-approve`, and the board reimplementing any of them is
    // the failure this indirection exists to prevent.
    assert.deepEqual(ran.runs(), ['/plot-approve ship-the-widget']);
  });

  it('the blanket 405 still answers every other path and verb', async () => {
    for (const [method, pathname] of [
      ['POST', '/api/board'],
      ['DELETE', '/api/approve'],
      ['PUT', '/api/approve'],
      ['GET', '/api/approve'],
    ]) {
      const res = await request(server.port, { method, path: pathname });
      if (method === 'GET') {
        // Same rule as /api/dispatch: the VERB is what is allow-listed, so a
        // GET falls through to the 404 default rather than the 405.
        assert.equal(res.status, 404, `GET ${pathname}`);
      } else {
        assert.equal(res.status, 405, `${method} ${pathname}`);
      }
    }
  });
});

describe('POST /api/approve: a refused request runs NOTHING', () => {
  let tmp, server, stub, ran;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: DRAFT }] });
    ran = writeApproveCommand(tmp);
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses a cross-site Sec-Fetch-Site with 403', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/approve',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 403);
  });

  it('refuses a foreign Origin with 403', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/approve',
      headers: { origin: 'http://evil.example' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 403);
  });

  it('and neither refusal approved anything', async () => {
    // THE assertion, and it matters more here than on /api/dispatch: a wrong
    // dispatch costs a `git worktree remove`, while a wrong approval merges a
    // PR on the git host and is undoable only by more git.
    await settle();
    assert.deepEqual(ran.runs(), []);
  });

  it('rejects a body that is not a plan slug, and runs nothing', async () => {
    for (const slug of ['../../etc/passwd', 'a b', '', 42, undefined]) {
      const res = await request(server.port, {
        method: 'POST',
        path: '/api/approve',
        headers: { 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ slug }),
      });
      assert.equal(res.status, 400, `slug ${JSON.stringify(slug)}`);
    }
    await settle();
    assert.deepEqual(ran.runs(), []);
  });
});

describe('POST /api/approve: the binding is the authorisation', () => {
  let tmp, server, stub, ran;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: DRAFT }] });
    ran = writeApproveCommand(tmp);
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir, HOST: '0.0.0.0' });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses with 403 when HOST is not localhost, and runs nothing', async () => {
    const res = await approve(server.port, 'ship-the-widget');
    assert.equal(res.status, 403);
    assert.match(JSON.parse(res.body).error, /0\.0\.0\.0/);
    await settle();
    assert.deepEqual(ran.runs(), []);
  });

  it('tells the board so, that the button may say what it cannot do', async () => {
    const board = await fetchBoard(server.port);
    assert.equal(board.approve.available, false);
    assert.match(board.approve.reason, /localhost/);
  });
});

describe('a board with NO `Approve command` can approve', () => {
  let tmp, server, stub;

  before(async () => {
    // No `Approve command` in this repo's config — the exact state that
    // produced the question, and the state this repo's own CLAUDE.md is in.
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: DRAFT }] });
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('`Start work` and `Approve` give the SAME availability answer', async () => {
    // The defect this closes: two controls on one surface asking different
    // questions. Both scripts ship with Plot, so both ask only whether this is
    // a local, same-origin request — and a fix that merely added a fallback
    // while leaving the config question in place would keep the divergence.
    const board = await fetchBoard(server.port);
    assert.equal(board.dispatch.available, true);
    assert.equal(board.approve.available, true);
    assert.deepEqual(board.approve, board.dispatch);
    // And no lingering "add one to approve from the board".
    assert.equal(board.approve.reason, '');
  });

  it('the route acts rather than refusing with a config key', async () => {
    const res = await approve(server.port, 'ship-the-widget');
    assert.equal(res.status, 202);
  });

  it('and it runs `plot-approve.sh <slug>` — the script Plot ships', async () => {
    // ONE implementation of the mechanics behind both entrances. Without an
    // `Approve command` the board goes straight to the script; with one it goes
    // through the agent, whose skill calls the same script.
    const log = path.join(path.resolve(tmp, '..'), 'plot-approve-ship-the-widget.log');
    const text = await until(() =>
      fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() || null : null,
    );
    assert.match(text, /stub plot-approve\.sh ship-the-widget/);
  });
});

describe('`Approve command`, when declared, still wins', () => {
  let tmp, server, stub, ran;

  before(async () => {
    // Demoted is not removed: a project that wants the full skill — the
    // ceremony questions, the tracer heuristic, the in-session walkthrough —
    // declares a command and gets the agent path.
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: DRAFT }] });
    ran = writeApproveCommand(tmp);
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('runs the configured command, not the script', async () => {
    await approve(server.port, 'ship-the-widget');
    await until(() => ran.runs());
    assert.deepEqual(ran.runs(), ['/plot-approve ship-the-widget']);
    const log = path.join(path.resolve(tmp, '..'), 'plot-approve-ship-the-widget.log');
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    assert.doesNotMatch(text, /plot-approve\.sh/);
  });
});

describe('POST /api/approve: a failing command reports its OWN words', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-draft-pr-widget.md', content: DRAFT }] });
    // The exact sentence /plot-approve writes for a plan PR still in draft —
    // the state that occurred repeatedly in one evening.
    writeApproveCommand(tmp, {
      script: `echo "Plan is still a draft. Mark it ready for review first." >&2\nexit 1\n`,
    });
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes the command\'s message to the log the 202 named', async () => {
    // The 202 cannot carry the outcome — the command has not finished when it
    // is written, the same constraint /api/dispatch lives under. So the log is
    // where the reason lands, and the route must have named a readable one.
    const res = await approve(server.port, 'draft-pr-widget');
    assert.equal(res.status, 202);
    const { log } = JSON.parse(res.body);
    await settle(800);
    assert.match(fs.readFileSync(log, 'utf8'), /still a draft/);
  });

  it('GET /api/approve/<slug> serves that message back to the card', async () => {
    // How the script's own words reach the card. Without this the board could
    // only render "failed", which is the failure the plan names outright: a
    // reason-less failure sends the reader to a terminal, and then the command
    // could have been typed there in the first place.
    const res = await request(server.port, { path: '/api/approve/draft-pr-widget' });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.state, 'failed');
    assert.match(body.message, /Plan is still a draft\. Mark it ready for review first\./);
    // Not a generic replacement. Asserted negatively too, because a body that
    // merely CONTAINED the word "failed" alongside the real text would pass the
    // match above while a naive implementation returning only "failed" would
    // also pass a looser check.
    assert.notEqual(body.message.trim(), 'failed');
  });

  it('reports an unknown slug as unknown rather than as a failure', async () => {
    // Nothing has been attempted for it. Answering "failed" would put a red
    // message on a card whose button has never been pressed.
    const res = await request(server.port, { path: '/api/approve/never-attempted' });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).state, 'unknown');
  });

  it('refuses a status read for something that is not a slug', async () => {
    const res = await request(server.port, { path: '/api/approve/..%2F..%2Fetc%2Fpasswd' });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/approve: a command that succeeds says so', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-approved-widget.md', content: DRAFT }] });
    writeApproveCommand(tmp, { script: `echo "Approved approved-widget"\n` });
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports `done` once the command exits 0', async () => {
    const res = await approve(server.port, 'approved-widget');
    assert.equal(res.status, 202);
    await settle(800);
    const status = await request(server.port, { path: '/api/approve/approved-widget' });
    assert.equal(JSON.parse(status.body).state, 'done');
  });

  it('reports `running` while it is still going', async () => {
    // A third state, and it must be distinguishable from both others: a card
    // that showed `done` mid-run would claim an approval that has not happened.
    writeApproveCommand(tmp, { script: `sleep 3\n` });
    await approve(server.port, 'slow-one');
    await settle(400);
    const status = await request(server.port, { path: '/api/approve/slow-one' });
    assert.equal(JSON.parse(status.body).state, 'running');
  });
});
