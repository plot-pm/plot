// The loopback boundary, as a gate rather than a sentence.
//
// The boundary was stated in `dispatch.ts` from the first write route and never
// enforced: `HOST` was read once in index.ts and never checked, so a board
// started with `HOST=0.0.0.0` published /api/dispatch — which spawns detached
// agents — to every interface the machine had. The plan that licensed this wave
// asserted "loopback is the boundary and already in force", which held only
// while nobody set it.
//
// THE LOAD-BEARING ASSERTION IS THAT A REFUSED REQUEST RAN NOTHING. A 403 that
// arrives after the script already spawned is not a gate; it is a slow apology.
// Every other assertion here can pass while the side effect still happened.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ARTIFACT,
  startServer,
  makeRepo,
  makeStubScripts,
  request,
  rmTree,
} from './helpers.mjs';

const APPROVED = `# Ship the widget
## Status
- **Phase:** Approved
- **Type:** feature
`;

/**
 * Every route that changes state. The gate is asserted over the WHOLE set, and
 * that is the point of the test rather than thoroughness for its own sake: the
 * brief's rule is that a gate covering two of five is not a boundary, and a
 * per-endpoint test would pass for the two somebody remembered.
 */
const WRITE_ROUTES = [
  { path: '/api/approve', body: { slug: 'ship-the-widget' } },
  { path: '/api/continue', body: { branch: 'feature/x', answer: 'go' } },
  { path: '/api/dispatch', body: { slug: 'ship-the-widget' } },
  // Landed on the default branch while this gate was being written, and is the
  // reason the router dispatches from a TABLE rather than from a list of paths
  // beside a chain of `if`s: as a list, this route merged cleanly, typechecked,
  // and was the one ungated write endpoint. A test that enumerates the routes
  // by hand has the same weakness, so the assertion below that this list
  // matches the server's own table is not a formality.
  { path: '/api/idea', body: { number: 1 } },
  // Commission design spawns a plot agent that writes a plan to this disk — the
  // same class of write as /api/idea, and gated by the same loopback boundary.
  { path: '/api/commission', body: { slug: 'ship-the-widget' } },
  // Reslice spawns a plot agent that slices a plan's tangled wave into one wave
  // per branch — the same class of write as /api/commission, and gated by the
  // same loopback boundary. Added here because the router dispatches from a
  // TABLE and this test reads that table back out of the artifact: a write route
  // absent from this list fails the coverage assertion below.
  { path: '/api/reslice', body: { slug: 'ship-the-widget' } },
  // Deliver spawns a plot agent that flips a fully-merged plan's phase on this
  // disk — the same class of write as /api/reslice, and gated by the same
  // loopback boundary. Added here because the router dispatches from a TABLE and
  // this test reads that table back out of the artifact: a write route absent
  // from this list fails the coverage assertion below.
  { path: '/api/deliver', body: { slug: 'ship-the-widget' } },
  // Implement spawns a plot agent that prepares an approved plan on this disk —
  // the same class of write as /api/deliver, and gated by the same loopback
  // boundary. Added here because the router dispatches from a TABLE and this
  // test reads that table back out of the artifact: a write route absent from
  // this list fails the coverage assertion below.
  { path: '/api/implement', body: { slug: 'ship-the-widget' } },
  { path: '/api/claim', body: { slug: 'ship-the-widget' } },
  { path: '/api/transition', body: { slug: 'ship-the-widget', transition: 'approve' } },
  // Sets the two shared fleet controls (auto-dispatch switch, parallel-agent
  // cap). It spawns nothing and only writes a small JSON file under
  // `.plot/state/`, but it is a write all the same and gated by the same
  // loopback boundary: a control that decides whether a fleet runs must not be
  // reachable by a phone reading the board over Tailscale.
  { path: '/api/fleet-controls', body: { autoDispatch: true } },
];

/** Give a spawn that should NOT have happened time to leave its mark. */
async function settle(ms = 400) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('the write gate: bound off loopback, the write endpoints refuse', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    // 0.0.0.0 is the case this gate exists for: the wildcard bind is what the
    // fleet user test uses to read the board over Tailscale, and it is exactly
    // what makes "sitting at this machine" stop being true.
    server = await startServer(tmp, { HOST: '0.0.0.0', PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(async () => {
    await server?.stop();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  for (const route of WRITE_ROUTES) {
    it(`refuses POST ${route.path} with 403`, async () => {
      const res = await request(server.port, {
        method: 'POST',
        path: route.path,
        headers: { 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify(route.body),
      });
      assert.equal(res.status, 403, `${route.path} should refuse off loopback`);
    });
  }

  it('says WHY it refused and WHAT to pass — a bare 403 sends the reader to the source', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/claim',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    const { error } = JSON.parse(res.body);
    // The three things a developer who bound to 0.0.0.0 on purpose needs: what
    // the server is bound to, that the binding is the cause, and the exact
    // opt-in. Asserted as content rather than as an exact sentence so the
    // wording can improve without breaking the test.
    assert.match(error, /0\.0\.0\.0/, 'names the binding it refused for');
    assert.match(error, /loopback/, 'names the boundary');
    assert.match(error, /PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand/, 'names the escape exactly');
  });

  it('ran NOTHING — the refusal precedes the spawn, which is what makes it a gate', async () => {
    await settle();
    assert.deepEqual(stub.runs(), [], 'a refused request must not have spawned the dispatcher');
  });

  it('covers EVERY write route the server has — this list cannot silently drift', async () => {
    // THE ASSERTION THAT KEEPS THE OTHERS HONEST. Each case above proves one
    // named route refuses; none of them notices a SEVENTH route added later.
    // The artifact carries the router's own table, so the routes are read back
    // out of it and compared with what this file exercises. A new write
    // endpoint fails here until it is covered, which is the only version of
    // "the gate covers all of them" that survives someone else's merge.
    const artifact = fs.readFileSync(ARTIFACT, 'utf8');
    const declared = [...artifact.matchAll(/path:\s*"(\/api\/[a-z-]+)",\s*verb:/g)].map((m) => m[1]);
    assert.ok(declared.length > 0, 'the router table should be readable in the artifact');
    assert.deepEqual(
      [...declared].sort(),
      WRITE_ROUTES.map((r) => r.path).sort(),
      'every route in the server\'s write table must be exercised by this file',
    );
  });

  it('still serves the READ endpoints — the gate covers writes, not the board', async () => {
    // A phone reading this board over Tailscale is the workflow the gate must
    // not break. Refusing reads too would be a bigger change than the boundary
    // asks for, and would make the board useless for the case it was bound
    // wide FOR.
    for (const p of ['/api/board', '/api/fleet', '/api/attention']) {
      const res = await request(server.port, { path: p });
      assert.equal(res.status, 200, `${p} must still be served`);
    }
  });
});

describe('the write gate: the opt-in is deliberate and exact', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    server = await startServer(tmp, {
      HOST: '0.0.0.0',
      PLOT_SCRIPTS_DIR: stub.dir,
      PLOT_BOARD_ALLOW_REMOTE_WRITES: 'i-understand',
    });
  });

  after(async () => {
    await server?.stop();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('serves the write endpoints once the named opt-in is set', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 202, 'the opt-in must actually open the gate');
  });
});

describe('the write gate: a truthy guess does not open it', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    // `1` is what a person types when guessing at a flag, and guessing is the
    // failure mode the named value exists to prevent. The value is checked,
    // never merely the presence of the variable.
    server = await startServer(tmp, {
      HOST: '0.0.0.0',
      PLOT_SCRIPTS_DIR: stub.dir,
      PLOT_BOARD_ALLOW_REMOTE_WRITES: '1',
    });
  });

  after(async () => {
    await server?.stop();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('still refuses — the opt-in must be typed knowingly, not guessed', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/claim',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 403);
  });
});

describe('the write gate: loopback serves, as it always did', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    // The default binding. This suite is the regression guard for the gate
    // itself: a boundary that also refused the normal case would be caught
    // here rather than by a person whose board stopped working.
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(async () => {
    await server?.stop();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('serves /api/dispatch on the default loopback binding', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 202);
  });

  it('neither new path is readable, and the blanket 405 is not weakened', async () => {
    // THE VERB IS WHAT IS ALLOW-LISTED, and these two routes must behave
    // exactly as /api/dispatch already does — the contract dispatch.test.mjs
    // pins. A GET is not a 405: it passes the method check by BEING a GET and
    // then matches no read route, so it falls through to the 404 default.
    // Every other verb meets the blanket 405.
    //
    // Both halves are asserted because the risk is that a new route weakens the
    // default rather than sitting ahead of it. Neither answers 200, which is
    // the property that actually matters: claiming and transitioning are never
    // reachable by a read.
    for (const p of ['/api/claim', '/api/transition']) {
      const get = await request(server.port, { path: p });
      assert.equal(get.status, 404, `GET ${p} falls through to the 404 default`);
      for (const method of ['PUT', 'DELETE', 'PATCH']) {
        const res = await request(server.port, { method, path: p });
        assert.equal(res.status, 405, `${method} ${p} meets the blanket 405`);
      }
    }
  });
});
