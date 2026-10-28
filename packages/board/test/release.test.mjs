// The route contract for `POST /api/release` — the board's eighth state-
// changing endpoint, and slice 2 of an-in-session-approval-has-a-controller.
//
// Modelled on approve.test.mjs's script-arm tests: there is no agent arm here
// at all, and `plot-deliver.sh` is NOT in makeStubScripts' ACTING_SCRIPTS, so
// these tests drive the REAL script — which is safe because every plan here
// is shaped to make it refuse fast (no `→ #N` annotation), before any host
// call or git write. That refusal is itself part of the contract: the route
// answers 202 either way, because it never awaits the script.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, makeRepo, request, rmTree, SCRIPTS_DIR } from './helpers.mjs';

const DELIVERED_NO_PR = `# Ship the widget
## Status
- **Phase:** Delivered
- **Type:** feature
- **Delivered:** 2026-09-10

## Branches

### Wave one
- \`feature/alpha\` — no annotation
`;

async function settle(ms = 400) {
  await new Promise((r) => setTimeout(r, ms));
}

async function until(read, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (value !== undefined && value !== null) return value;
    if (Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function release(port, body) {
  return request(port, {
    method: 'POST',
    path: '/api/release',
    headers: { 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  });
}

/**
 * A scripts dir whose `plot-deliver.sh` blocks until a gate file appears,
 * every other helper symlinked from the real {@link SCRIPTS_DIR}.
 *
 * `plot-deliver.sh` runs for seconds even when it refuses fast (real git
 * checks, real host calls on a shaped plan) — too slow and too flaky a window
 * to hold a second POST against. A stub that blocks on a file gate gives the
 * test a deterministic overlap instead: the first call's job stays `running`
 * for exactly as long as the test needs it to.
 */
function makeBlockingDeliverStub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-release-stub-'));
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (name === 'plot-deliver.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  const gate = path.join(dir, 'deliver-gate.txt');
  fs.writeFileSync(
    path.join(dir, 'plot-deliver.sh'),
    `#!/usr/bin/env bash\necho "plot-deliver: $*"\nwhile [ ! -f ${JSON.stringify(gate)} ]; do sleep 0.05; done\n`,
    { mode: 0o755 },
  );
  return {
    dir,
    /** Let every blocked plot-deliver.sh run exit 0. */
    release: () => fs.writeFileSync(gate, 'go\n'),
    /** Close the gate again, so the next plot-deliver.sh run blocks. */
    block: () => fs.rmSync(gate, { force: true }),
    cleanup: () => rmTree(dir),
  };
}

describe('POST /api/release: answers 202 and starts plot-deliver.sh --release', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: DELIVERED_NO_PR }] });
    server = await startServer(tmp);
  });

  after(() => {
    server?.kill();
    if (tmp) rmTree(tmp);
  });

  it('answers 202 with the slug, version and the log path the SERVER chose', async () => {
    const res = await release(server.port, { slug: 'ship-the-widget', version: '1.2.3' });
    assert.equal(res.status, 202, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.slug, 'ship-the-widget');
    assert.equal(body.version, '1.2.3');
    assert.equal(
      fs.realpathSync(path.dirname(body.log)),
      fs.realpathSync(path.join(tmp, '.worktrees')),
    );
    assert.equal(path.basename(body.log), 'plot-release-ship-the-widget.log');
  });

  it('ran the real script, which refuses fast and safely against the scratch repo', async () => {
    // `makeRepo`'s scratch repo is not a real git checkout, so the script
    // refuses on that before it would reach the → #N check — the point this
    // test proves is that the REAL plot-deliver.sh ran (named in the log as
    // itself, prefixed "plot-deliver:") and refused rather than writing
    // anything, never which of its several early refusals fired first.
    const log = path.join(tmp, '.worktrees', 'plot-release-ship-the-widget.log');
    const text = await until(() =>
      fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() || null : null,
    );
    assert.match(text, /^plot-deliver:/, text);
  });

  it('the blanket 405 still answers every other verb', async () => {
    for (const [method, pathname] of [
      ['DELETE', '/api/release'],
      ['PUT', '/api/release'],
      ['GET', '/api/release'],
    ]) {
      const res = await request(server.port, { method, path: pathname });
      if (method === 'GET') {
        assert.equal(res.status, 404, `GET ${pathname}`);
      } else {
        assert.equal(res.status, 405, `${method} ${pathname}`);
      }
    }
  });

  it('GET /api/release/<slug> reads back the command\'s own words', async () => {
    // The first test in this block started a release of the same slug, and one
    // slug runs one job at a time. Wait for that job to end, or this POST is
    // refused as already-running on a slow machine.
    await until(async () => {
      const r = await request(server.port, { path: '/api/release/ship-the-widget' });
      return JSON.parse(r.body).state === 'running' ? null : true;
    });
    const res = await release(server.port, { slug: 'ship-the-widget', version: '1.2.3' });
    assert.equal(res.status, 202, res.body);
    const status = await until(async () => {
      const r = await request(server.port, { path: '/api/release/ship-the-widget' });
      const body = JSON.parse(r.body);
      return body.state !== 'unknown' && body.state !== 'running' ? body : null;
    });
    assert.equal(status.state, 'failed', JSON.stringify(status));
    assert.ok(status.message.length > 0, 'the refusal\'s own words must reach the reader');
  });

  it('GET /api/release/<bad slug> answers 400', async () => {
    const res = await request(server.port, { path: '/api/release/..%2F..%2Fetc%2Fpasswd' });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/release: validates its body before starting anything', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: DELIVERED_NO_PR }] });
    server = await startServer(tmp);
  });

  after(() => {
    server?.kill();
    if (tmp) rmTree(tmp);
  });

  it('rejects a body that is not a plan slug', async () => {
    for (const slug of ['../../etc/passwd', 'a b', '', 42, undefined]) {
      const res = await release(server.port, { slug, version: '1.2.3' });
      assert.equal(res.status, 400, `slug ${JSON.stringify(slug)}`);
    }
  });

  it('rejects a version that is not a version', async () => {
    for (const version of ['not-a-version', '1.2', '', 42, undefined, 'v1.2.3.4']) {
      const res = await release(server.port, { slug: 'ship-the-widget', version });
      assert.equal(res.status, 400, `version ${JSON.stringify(version)}`);
    }
  });

  it('accepts a version with or without the v prefix', async () => {
    for (const version of ['1.2.3', 'v1.2.3']) {
      const res = await release(server.port, { slug: 'ship-the-widget', version });
      assert.equal(res.status, 202, `version ${version}: ${res.body}`);
      // Wait for THIS call's job to finish before the next iteration reuses
      // the same slug — otherwise the loop races its own still-running job
      // and the second POST is correctly refused as already-running.
      await until(async () => {
        const r = await request(server.port, { path: '/api/release/ship-the-widget' });
        const body = JSON.parse(r.body);
        return body.state !== 'unknown' && body.state !== 'running' ? body : null;
      });
    }
  });
});

describe('POST /api/release: a refused request runs nothing', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: DELIVERED_NO_PR }] });
    server = await startServer(tmp);
  });

  after(() => {
    server?.kill();
    if (tmp) rmTree(tmp);
  });

  it('refuses a cross-site Sec-Fetch-Site with 403, and starts nothing', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/release',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ slug: 'ship-the-widget', version: '1.2.3' }),
    });
    assert.equal(res.status, 403);
    await settle();
    assert.equal(fs.existsSync(path.join(tmp, '.worktrees', 'plot-release-ship-the-widget.log')), false);
  });
});

describe('POST /api/release: the binding is the authorisation', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: DELIVERED_NO_PR }] });
    server = await startServer(tmp, { HOST: '0.0.0.0' });
  });

  after(() => {
    server?.kill();
    if (tmp) rmTree(tmp);
  });

  it('refuses with 403 when HOST is not localhost', async () => {
    const res = await release(server.port, { slug: 'ship-the-widget', version: '1.2.3' });
    assert.equal(res.status, 403);
    assert.match(JSON.parse(res.body).error, /0\.0\.0\.0/);
  });
});

describe('POST /api/release: a second call for a running slug is refused, per slug', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({
      plans: [
        { name: '2026-08-16-ship-the-widget.md', content: DELIVERED_NO_PR },
        { name: '2026-08-16-ship-the-gadget.md', content: DELIVERED_NO_PR.replace(/widget/g, 'gadget') },
      ],
    });
    stub = makeBlockingDeliverStub();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('refuses a second POST for the same slug while the first is still running, leaves its log untouched, and reports the first job\'s outcome', async () => {
    const log = path.join(tmp, '.worktrees', 'plot-release-ship-the-widget.log');

    const first = await release(server.port, { slug: 'ship-the-widget', version: '1.2.3' });
    assert.equal(first.status, 202, first.body);

    // Wait for the first job's own log line, so the overlap is against a job
    // actually running — not a race against the spawn.
    await until(() =>
      fs.existsSync(log) && /^plot-deliver:/.test(fs.readFileSync(log, 'utf8')) ? true : null,
    );
    const beforeSecond = fs.readFileSync(log, 'utf8');

    const second = await release(server.port, { slug: 'ship-the-widget', version: '1.2.3' });
    assert.equal(second.status, 409, second.body);
    const secondBody = JSON.parse(second.body);
    assert.equal(secondBody.ok, false);
    assert.equal(secondBody.slug, 'ship-the-widget');
    assert.equal(secondBody.reason, 'already-running');

    // The refusal must not have truncated or reopened the first job's log.
    assert.equal(fs.readFileSync(log, 'utf8'), beforeSecond);

    // Let the first job finish, then read its outcome back.
    stub.release();
    const status = await until(async () => {
      const r = await request(server.port, { path: '/api/release/ship-the-widget' });
      const body = JSON.parse(r.body);
      return body.state !== 'unknown' && body.state !== 'running' ? body : null;
    });
    assert.equal(status.state, 'done', JSON.stringify(status));
  });

  it('a second POST for a DIFFERENT slug still succeeds with 202 while the first is running', async () => {
    // The test above opened the gate, and an open gate lets every run exit at
    // once. Close it, so the first job is still running when the second POST
    // arrives.
    stub.block();
    const first = await release(server.port, { slug: 'ship-the-gadget', version: '1.2.3' });
    assert.equal(first.status, 202, first.body);

    const log = path.join(tmp, '.worktrees', 'plot-release-ship-the-gadget.log');
    await until(() =>
      fs.existsSync(log) && /^plot-deliver:/.test(fs.readFileSync(log, 'utf8')) ? true : null,
    );

    const second = await release(server.port, { slug: 'ship-the-widget', version: '1.2.3' });
    assert.equal(second.status, 202, second.body);

    stub.release();
  });
});
