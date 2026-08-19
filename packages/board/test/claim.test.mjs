// `POST /api/claim` — reserving a branch, and saying what resulted.
//
// These tests never run a real claim. `PLOT_SCRIPTS_DIR` points the server at a
// stub `plot-dispatch.sh`, for the reason dispatch.test.mjs states: a real one
// would create a worktree beside the temp repo and PUSH A CLAIM from CI. What
// is tested here is the contract the endpoint adds on top of that script —
// which flags it is invoked with, and that the script's own words are reported
// rather than paraphrased.
//
// The endpoint's whole premise is that the response carries the RESULTING STATE
// rather than an acknowledgement, so the assertions are about the body, not the
// status code.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, makeRepo, makeStubScripts, request, rmTree } from './helpers.mjs';

const APPROVED = `# Ship the widget
## Status
- **Phase:** Approved
- **Type:** feature
`;

/**
 * A stub dispatcher that prints what a real one prints on a WINNING claim, and
 * records the arguments it was called with.
 *
 * The output format is the script's documented contract:
 *   `dispatched <branch> → <worktree>` then the `summary:` footer.
 */
function winningStub(stub, marker) {
  fs.writeFileSync(
    path.join(stub.dir, 'plot-dispatch.sh'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(marker)}
echo "dispatched feature/the-widget → /tmp/wt/plot-wt-feature-the-widget"
echo "summary: dispatched=1 reused=0 skipped=0 started=0 brief=missing worker=suppressed"
`,
    { mode: 0o755 },
  );
}

describe('POST /api/claim: wraps the ref-push claim and returns the resulting state', () => {
  let tmp, server, stub, marker;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    marker = path.join(stub.dir, 'claim-args.txt');
    winningStub(stub, marker);
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(async () => {
    await server?.stop();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('returns the branch and worktree that resulted, not a bare acknowledgement', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/claim',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    // The point of the endpoint: a caller never has to ask a second endpoint
    // whether its write landed. A 200 with only `{ok:true}` would leave it
    // doing exactly what this replaces.
    assert.equal(body.claimed, true);
    assert.equal(body.branch, 'feature/the-widget');
    assert.equal(body.worktree, '/tmp/wt/plot-wt-feature-the-widget');
    assert.equal(body.slug, 'ship-the-widget');
    assert.match(body.summary, /^summary: dispatched=1/);
  });

  it('claims WITHOUT starting a worker — claiming is not dispatching', async () => {
    // The separation `/api/attention` states from the other side: an agent that
    // has committed to doing work has not asked for a second agent to do it.
    // `--no-start` is the flag plot-dispatch.sh already carries for exactly
    // this, and `--max 1` keeps one call to one branch.
    const args = fs.readFileSync(marker, 'utf8').trim().split('\n');
    assert.ok(args.length >= 1, 'the dispatcher should have been invoked');
    const last = args[args.length - 1];
    assert.match(last, /--no-start/, 'must not start a worker');
    assert.match(last, /--max 1/, 'one call reserves one branch');
    assert.match(last, /ship-the-widget/);
  });

  it('rejects a body whose slug is not a slug, and runs nothing', async () => {
    const before = fs.readFileSync(marker, 'utf8');
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/claim',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: '../../etc/passwd' }),
    });
    assert.equal(res.status, 400);
    assert.equal(fs.readFileSync(marker, 'utf8'), before, 'a rejected slug must reach no script');
  });

  it('refuses a cross-origin request', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/claim',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 403);
  });
});

describe('POST /api/claim: losing the race is a normal answer, not an error', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    // What a real dispatcher prints when another session won the ref push.
    fs.writeFileSync(
      path.join(stub.dir, 'plot-dispatch.sh'),
      `#!/usr/bin/env bash
echo "skipped feature/the-widget (claimed by another session)"
echo "summary: dispatched=0 reused=0 skipped=1 started=0 brief=missing worker=suppressed"
`,
      { mode: 0o755 },
    );
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(async () => {
    await server?.stop();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('answers 200 with claimed:false and the losing reason, never a 4xx', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/claim',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    // Losing a claim race is the NORMAL outcome of a fleet doing its job: two
    // dispatchers ask at once and git refuses the second, which IS the
    // concurrency control. A 409 would train a caller to treat its own healthy
    // behaviour as a fault and retry the branch it just lost.
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.claimed, false);
    assert.equal(body.branch, null);
    assert.match(body.reason, /claimed by another session/);
  });
});
