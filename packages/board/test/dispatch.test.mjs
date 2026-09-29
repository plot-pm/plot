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
  startServer,
  fetchBoard,
  makeRepo,
  makeStubScripts,
  writeImplementCommand,
  request,
  rmTree,
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

/**
 * Wait until `read()` returns a truthy value, or give up.
 *
 * THE RESPONSE NO LONGER MEANS THE WORK HAPPENED. Since
 * `a-dispatch-does-not-hold-the-loop` the 202 says the implement STARTED: the
 * implement runs detached and the dispatch is started from its `exit` listener,
 * so both stubs run after the response is written. Polling for the marker is
 * what replaces the old synchronous ordering — raising `settle`'s sleep instead
 * would trade a race for a slower race.
 */
async function until(read, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('POST /api/dispatch: allow-listed ahead of the 405, and only then', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    // Configure the Implement command — dispatch now calls /plot-implement first.
    writeImplementCommand(tmp, { bin: stub.implementBin });
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
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
    // `dispatchLog`, renamed from `log` by `a-dispatch-promises-a-worker`: the
    // bare name read as *a dispatch ran*, and at 202 time the file does not
    // exist — it is written only if the implement exits 0.
    assert.equal(
      fs.realpathSync(path.dirname(body.dispatchLog)),
      fs.realpathSync(path.resolve(tmp, '..')),
    );
    assert.equal(path.basename(body.dispatchLog), 'plot-dispatch-ship-the-widget.log');
    // The implementLog should also be present — from the implement step. It
    // names where the run is being written, not where it finished: the child is
    // still running when this is read.
    assert.ok(body.implementLog, 'implementLog should be present in response');
  });

  it('calls the implement stub first, then plot-dispatch.sh', async () => {
    // WAITED FOR, NOT SLEPT THROUGH. Both stubs now run after the response —
    // the implement detached, the dispatch from its exit listener — so the
    // ordering is asserted once the second marker exists rather than at a
    // moment chosen by a timer.
    await until(() => stub.implementRuns().length === 1, 'the implement stub to run');
    assert.match(stub.implementRuns()[0], /plot-implement.*ship-the-widget/);
    // `--max 1` because a button is one decision. Fanning out a whole wave
    // stays with /plot-dispatch, where the human sees the count first.
    await until(() => stub.runs().length === 1, 'the dispatch stub to run');
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
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
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
    server = await startServer(tmp, {
      PLOT_SCRIPTS_DIR: stub.dir,
      HOST: '0.0.0.0',
    });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
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
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('available, with no reason to give', async () => {
    const board = await fetchBoard(server.port);
    assert.deepEqual(board.dispatch, { available: true, reason: '' });
  });
});

describe('POST /api/dispatch: the brief gate (wave 2 of a-dispatch-hands-over-a-brief)', () => {
  let tmp, server, stub;

  before(async () => {
    // No Implement command configured — dispatch should refuse.
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('refuses with 409 and names the missing key when no Implement command is configured', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 409);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'no-implement-command');
    assert.match(body.detail, /Implement command/);
    assert.equal(body.slug, 'ship-the-widget');
  });

  it('and started neither implement nor dispatch', async () => {
    await settle();
    assert.deepEqual(stub.implementRuns(), []);
    assert.deepEqual(stub.runs(), []);
  });
});

describe('POST /api/dispatch: implement failure stops dispatch', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    // Create an implement stub that FAILS (exits non-zero).
    const failingBin = path.join(stub.dir, 'failing-implement.sh');
    fs.writeFileSync(
      failingBin,
      '#!/usr/bin/env bash\necho "drift detected: plan is stale" >&2\nexit 1\n',
      { mode: 0o755 },
    );
    writeImplementCommand(tmp, { bin: failingBin });
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  // THE REFUSAL MOVED, AND THIS TEST MOVED WITH IT. It asserted a 409 in the
  // POST's own response, which `a-dispatch-does-not-hold-the-loop` made
  // impossible: the implement now runs detached and the response is written
  // before it exits. The refusal is not weaker for that — it never reached the
  // operator through the response either, because the client aborts actions at
  // 15 s (`bounded-fetch.ts:45`) and a real `/plot-implement` takes minutes.
  // What is asserted now is the route it does arrive by.
  it('accepts the POST before the implement has decided', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 202);
    const body = JSON.parse(res.body);
    assert.ok(body.implementLog, 'the 202 names where the implement is being written');
  });

  it('reports the failure through the implement status, naming the log', async () => {
    const status = await until(async () => {
      const res = await request(server.port, {
        method: 'GET',
        path: '/api/implement/ship-the-widget',
      });
      const parsed = JSON.parse(res.body);
      return parsed.state === 'failed' ? parsed : null;
    }, 'the implement status to report failure');
    // The command's own last words, which is what an operator needs: `exited 1`
    // alone would name the fact and not the cause.
    assert.match(status.message, /drift detected|stale|exited/i);
    assert.ok(status.log, 'the status names the log');
  });

  it('and started no dispatch', async () => {
    // ASSERTED AFTER THE CHILD EXITED, not on a timer: the status above is only
    // `failed` once the exit listener has run, which is the same listener that
    // would have started the dispatch. So by here the decision is made, and an
    // empty run list is evidence rather than a race won.
    await settle();
    assert.deepEqual(stub.runs(), []);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// What the 202 says it did — `a-dispatch-promises-a-worker`.
//
// The body is asserted WHILE THE IMPLEMENT IS STILL RUNNING, which is the only
// moment that tests the claim. At 202 time no claim is pushed, no desk exists
// and `plot-dispatch.sh` has not been invoked — it runs from the child's exit
// listener, minutes later. A stub that exits inside the same tick lets that
// listener run first, so the assertion would be taken against a world the
// caller never sees, and a dishonest body would pass.
//
// THE ASSERTION IS ON THE WHOLE KEY SET, not on the added field. A test that
// checks only `act` passes while a `started: true` sits beside it, which is the
// exact shape this branch exists to refuse.
// ────────────────────────────────────────────────────────────────────────────
describe('POST /api/dispatch: the 202 names the act, not an outcome', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    writeImplementCommand(tmp, { bin: stub.blockingImplementBin });
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(async () => {
    // RELEASED, THEN WAITED FOR. The child holds the gate open until told, and a
    // teardown that removed the tree under a live child is the `ENOTEMPTY` the
    // helper's own `rmTree` note records.
    stub?.release();
    if (server) {
      await until(async () => {
        const res = await request(server.port, {
          method: 'GET',
          path: '/api/implement/ship-the-widget',
        });
        return JSON.parse(res.body).state !== 'running';
      }, 'the blocking implement child to exit').catch(() => {});
    }
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('answers a body whose every field is an address, while the implement runs', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 202);
    const body = JSON.parse(res.body);

    // The child has NOT exited: the implement stub blocks on its gate file, so
    // no exit listener has run and no dispatch has been started. This is the
    // precondition the whole assertion rests on, so it is asserted rather than
    // assumed.
    const live = await request(server.port, {
      method: 'GET',
      path: '/api/implement/ship-the-widget',
    });
    assert.equal(
      JSON.parse(live.body).state,
      'running',
      'the implement must still be running when the body is judged',
    );
    assert.deepEqual(stub.runs(), [], 'no dispatch has been started at 202 time');

    // THE WHOLE KEY SET. A new field that could be read as an outcome fails
    // here even if every assertion below it still passes.
    assert.deepEqual(
      Object.keys(body).sort(),
      ['act', 'dispatchLog', 'implementLog', 'slug', 'status'].sort(),
      'the 202 carries exactly these fields',
    );

    // The act performed, named. `implement-started` is true when it is written
    // and stays true; it describes the spawn, not the run.
    assert.equal(body.act, 'implement-started');
    assert.equal(body.slug, 'ship-the-widget');

    // Where the fate becomes knowable — the read-back, which the plan verified
    // against the shipped route and this slice adds nothing to.
    assert.equal(body.status, '/api/implement/ship-the-widget');

    // `dispatchLog` RATHER THAN `log`. The bare name read as *a dispatch ran*,
    // and the file it names does not exist yet: it is written only if the
    // implement exits 0. Qualified, the pair reads as two addresses.
    assert.equal(path.basename(body.dispatchLog), 'plot-dispatch-ship-the-widget.log');
    assert.equal(
      fs.realpathSync(path.dirname(body.dispatchLog)),
      fs.realpathSync(path.resolve(tmp, '..')),
    );
    assert.equal(path.basename(body.implementLog), 'plot-implement-ship-the-widget.log');

    // NO FIELD CAN BE READ AS A WORKER RUNNING. Named explicitly so a future
    // addition of any of them fails a test that says why.
    for (const forbidden of ['started', 'queued', 'claimed', 'ok', 'running', 'dispatched']) {
      assert.ok(
        !(forbidden in body),
        `\`${forbidden}\` names a world that does not exist when the response is written`,
      );
    }
  });
});
