// The route contract for the board's ONE state-changing endpoint.
//
// These tests never run a real dispatch. PLOT_SCRIPTS_DIR points the server at
// a stub `plot-dispatch.sh` that appends a line and exits, so no worktree is
// created beside the temp repo and nothing is pushed from CI. Driving the real
// script end-to-end would prove the wiring and would be slow, flaky and
// network-dependent in a suite that is currently none of those; the wiring is
// covered by the fleet user test, where a human is watching.
//
// The load-bearing assertion is that a REFUSED request spawned nothing. Every
// other one here can pass while the side effect still happened.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  findFreePort,
  startServer,
  fetchBoard,
  makeRepo,
  makeStubScripts,
  request,
} from './helpers.mjs';

const APPROVED = `# Ship the widget
## Status
- **Phase:** Approved
- **Type:** feature
`;

/** Wait for the stub's marker file to settle — the spawn is detached. */
async function settle(ms = 400) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('POST /api/dispatch: allow-listed ahead of the 405, and only then', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    server = await startServer(tmp, await findFreePort(), { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('answers 202 with the slug and the log path the SERVER chose', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 202);
    const body = JSON.parse(res.body);
    assert.equal(body.slug, 'ship-the-widget');
    // Keyed by SLUG, not by branch: `--max 1` asks --next at runtime which
    // branch is eligible, so the branch is unknowable at 202 time.
    // Beside the repo, not inside it — the same place the fleet's worktrees
    // live. Compared through realpath because macOS temp dirs are reached via
    // a /private symlink and the server keeps PLOT_REPO_ROOT verbatim.
    assert.equal(
      fs.realpathSync(path.dirname(body.log)),
      fs.realpathSync(path.resolve(tmp, '..')),
    );
    assert.equal(path.basename(body.log), 'plot-dispatch-ship-the-widget.log');
  });

  it('spawns plot-dispatch.sh with --max 1 and the slug', async () => {
    await settle();
    // `--max 1` because a button is one decision. Fanning out a whole wave
    // stays with /plot-dispatch, where the human sees the count first.
    assert.deepEqual(stub.runs(), ['--max 1 ship-the-widget']);
  });

  it('the blanket 405 still answers every other path and verb', async () => {
    // The guard was preserved, not weakened: exactly one path-and-verb pair
    // slips past it.
    for (const [method, pathname] of [
      ['POST', '/api/board'],
      ['POST', '/api/fleet'],
      ['POST', '/'],
      ['DELETE', '/api/dispatch'],
      ['PUT', '/api/dispatch'],
      ['GET', '/api/dispatch'],
    ]) {
      const res = await request(server.port, { method, path: pathname });
      if (method === 'GET') {
        // A GET on the dispatch path is not a 405 — it falls through to the
        // 404 default, which is the point: the verb is what is allow-listed.
        assert.equal(res.status, 404, `GET ${pathname}`);
      } else {
        assert.equal(res.status, 405, `${method} ${pathname}`);
      }
    }
  });
});

describe('POST /api/dispatch: a refused request spawns NOTHING', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    server = await startServer(tmp, await findFreePort(), { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses a cross-site Sec-Fetch-Site with 403', async () => {
    // Set by the browser, unforgeable by page JavaScript — which is exactly why
    // it is worth checking and a token is not.
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 403);
  });

  it('refuses a foreign Origin with 403', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { origin: 'http://evil.example' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 403);
  });

  it('and neither refusal started a dispatch', async () => {
    // THE assertion. An attacker cannot read the reply and does not need to:
    // the worktree would exist and the claim would be pushed before the
    // response was written. A 403 that still spawned is not a refusal.
    await settle();
    assert.deepEqual(stub.runs(), []);
  });

  it('rejects a body that is not a plan slug, and starts nothing', async () => {
    for (const slug of ['../../etc/passwd', 'a b', '', 42, undefined]) {
      const res = await request(server.port, {
        method: 'POST',
        path: '/api/dispatch',
        headers: { 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ slug }),
      });
      assert.equal(res.status, 400, `slug ${JSON.stringify(slug)}`);
    }
    await settle();
    assert.deepEqual(stub.runs(), []);
  });
});

describe('POST /api/dispatch: the binding is the authorisation', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    // What the fleet user test uses to reach the board over Tailscale. Whoever
    // reaches localhost:7777 is sitting at the machine that owns the worktrees;
    // bound to 0.0.0.0 that is no longer true, and the route refuses rather
    // than inventing an auth scheme.
    server = await startServer(tmp, await findFreePort(), {
      PLOT_SCRIPTS_DIR: stub.dir,
      HOST: '0.0.0.0',
    });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses with 403 when HOST is not localhost', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 403);
    assert.match(JSON.parse(res.body).error, /0\.0\.0\.0/);
  });

  it('and started nothing', async () => {
    await settle();
    assert.deepEqual(stub.runs(), []);
  });

  it('tells the board so, that the button may render disabled with the reason', async () => {
    // A control that looks live and 403s on click is a worse answer than one
    // that says up front what it cannot do.
    const board = await fetchBoard(server.port);
    assert.equal(board.dispatch.available, false);
    assert.match(board.dispatch.reason, /localhost/);
  });
});

describe('GET /api/board reports dispatch as available on localhost', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    server = await startServer(tmp, await findFreePort(), { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('available, with no reason to give', async () => {
    const board = await fetchBoard(server.port);
    assert.deepEqual(board.dispatch, { available: true, reason: '' });
  });
});
