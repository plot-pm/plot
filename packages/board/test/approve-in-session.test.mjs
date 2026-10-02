// The route contract for `POST /api/approve`'s in-session arm — slice 2 of
// an-in-session-approval-has-a-controller.
//
// Modelled on approve.test.mjs, and deliberately so: these are the same guards
// over a different plan shape. `plot-approve.sh` is stubbed exactly as
// `makeStubScripts` stubs it for every other approve test — these tests never
// actually approve anything, they assert on WHICH entrance ran and WHAT it was
// told.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startServer,
  makeRepo,
  makeStubScripts,
  request,
  writeApproveCommand,
  rmTree,
} from './helpers.mjs';

const IN_SESSION = `# Ship the widget
## Status
- **Phase:** Draft
- **Type:** feature
- **Review:** in-session
`;

const PR_REVIEW = `# Ship the widget
## Status
- **Phase:** Draft
- **Type:** feature
- **Review:** pr
`;

async function settle(ms = 400) {
  await new Promise((r) => setTimeout(r, ms));
}

function approve(port, slug, who) {
  return request(port, {
    method: 'POST',
    path: '/api/approve',
    headers: { 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(who === undefined ? { slug } : { slug, who }),
  });
}

describe('POST /api/approve: the agent arm answers 409 on an in-session plan', () => {
  let tmp, server, stub, ran;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: IN_SESSION }] });
    ran = writeApproveCommand(tmp);
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('answers 409 and spawns nothing — the agent would only refuse', async () => {
    const res = await approve(server.port, 'ship-the-widget');
    assert.equal(res.status, 409);
    const body = JSON.parse(res.body);
    assert.match(body.error, /in-session/);

    await settle();
    assert.deepEqual(ran.runs(), [], 'the configured Approve command must never have started');
  });
});

describe('POST /api/approve: a pr-review plan with Approve command still runs the agent', () => {
  let tmp, server, stub, ran;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: PR_REVIEW }] });
    ran = writeApproveCommand(tmp);
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('answers 202 — the 409 check is specific to in-session, not every plan', async () => {
    const res = await approve(server.port, 'ship-the-widget');
    assert.equal(res.status, 202, res.body);
  });
});

describe('POST /api/approve: the script arm (no Approve command) passes --who', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: IN_SESSION }] });
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('runs the stub with --who <handle>, and records the entry as board', async () => {
    const res = await approve(server.port, 'ship-the-widget', 'jwloka');
    assert.equal(res.status, 202, res.body);
    await settle();
    // `makeStubScripts`'s plot-approve.sh stub echoes `stub plot-approve.sh $*`
    // to its own log — the log this route opens, not the dispatcher's marker.
    const log = fs.readFileSync(JSON.parse(res.body).log, 'utf8');
    assert.match(log, /stub plot-approve\.sh ship-the-widget --who jwloka/, log);
  });

  it('with no who in the body, runs the stub with the slug alone', async () => {
    const res = await approve(server.port, 'ship-the-widget');
    assert.equal(res.status, 202, res.body);
    await settle();
    const log = fs.readFileSync(JSON.parse(res.body).log, 'utf8');
    assert.match(log, /stub plot-approve\.sh ship-the-widget\s*$/m, log);
  });
});

describe('POST /api/approve: a cross-origin request still answers 403 before the 409 check', () => {
  let tmp, server, stub, ran;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: IN_SESSION }] });
    ran = writeApproveCommand(tmp);
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('refuses a cross-site Sec-Fetch-Site with 403, not 409', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/approve',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 403);
    await settle();
    assert.deepEqual(ran.runs(), []);
  });
});
