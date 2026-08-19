// `POST /api/transition` — applying a phase transition through the spokes' rules.
//
// THE GUARDRAIL TESTS RUN THE REAL `plot-approve.sh`, and that is deliberate
// rather than incidental. A stub that exits non-zero would prove the wiring —
// stderr becomes `reason`, a failure becomes `applied:false` — and would prove
// nothing about the property that matters: that the API cannot approve a plan
// the spoke would refuse. Only the real script can demonstrate that, because
// the real script is where the rule lives.
//
// It is safe to run because the refusals asserted here happen BEFORE any host
// contact: `plot-approve.sh` reads the plan's phase and its `Review:` answer
// from disk and dies, so nothing is merged, pushed, or fetched. Verified
// 2026-08-19 against a scratch repo with no remote.
//
// The suites that would reach the host use the stub instead.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, makeRepo, makeStubScripts, request, rmTree, SCRIPTS_DIR } from './helpers.mjs';

/**
 * `plot-approve.sh` refuses a non-repository before it reads any plan, so the
 * fixture has to be one for the PHASE refusals to be the thing under test.
 *
 * Initialised and left with no remote ON PURPOSE. The refusals asserted here
 * fire from the plan file alone, and a repo with nowhere to push is the
 * strongest available evidence that they did: nothing could have been merged or
 * pushed even if a guardrail had failed to hold.
 */
function initRepo(dir) {
  const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run('init', '-q', '.');
  run('config', 'user.email', 'test@example.invalid');
  run('config', 'user.name', 'Plot Board Test');
}

const DRAFT_IN_SESSION = `# Needs a human
## Status
- **Phase:** Draft
- **Type:** feature
- **Review:** in-session
`;

const DELIVERED = `# Long done
## Status
- **Phase:** Delivered
- **Type:** feature
- **Review:** pr
`;

const APPROVED = `# Already approved
## Status
- **Phase:** Approved
- **Type:** feature
- **Review:** pr
`;

/** POST a transition and parse the body. */
async function transition(port, body) {
  const res = await request(port, {
    method: 'POST',
    path: '/api/transition',
    headers: { 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: JSON.parse(res.body) };
}

describe('POST /api/transition: a guardrail the spoke enforces is enforced here', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({
      plans: [
        { name: '2026-08-16-needs-a-human.md', content: DRAFT_IN_SESSION },
        { name: '2026-08-16-long-done.md', content: DELIVERED },
        { name: '2026-08-16-already-approved.md', content: APPROVED },
      ],
    });
    initRepo(tmp);
    // THE REAL SCRIPTS DIR — see the note at the top of this file.
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: SCRIPTS_DIR });
  });

  after(async () => {
    await server?.stop();
    if (tmp) rmTree(tmp);
  });

  // ── Direction 1: TOO EARLY. A plan that has not been through its review
  //    channel must not become Approved because an API asked nicely.
  it('refuses to approve a Draft whose review channel needs a human, in the spoke\'s words', async () => {
    const { status, body } = await transition(server.port, {
      slug: 'needs-a-human',
      transition: 'approve',
    });
    assert.equal(status, 200, 'a guardrail refusal is a normal answer, not a client error');
    assert.equal(body.applied, false, 'the transition must NOT have been applied');
    // The plan is still Draft, read back from the file rather than assumed.
    assert.equal(body.phase, 'draft');
    // The SPOKE'S OWN SENTENCE, forwarded rather than replaced. Replacing it
    // with a status name would send the reader to a terminal — and then the
    // command could have been typed there in the first place.
    assert.match(body.reason, /in-session/);
    assert.match(body.reason, /human in the room/);
  });

  it('leaves the plan file untouched when it refuses', async () => {
    // The load-bearing assertion: a refusal that already wrote is not a
    // refusal. Every other assertion here can pass while the phase moved.
    const onDisk = fs.readFileSync(
      path.join(tmp, 'docs/plans/2026-08-16-needs-a-human.md'),
      'utf8',
    );
    assert.equal(onDisk, DRAFT_IN_SESSION, 'a refused transition must write nothing');
  });

  // ── Direction 2: TOO LATE. A plan past the target phase must not be
  //    re-approved, and the endpoint must say where it actually stands.
  it('refuses to approve a plan that is already Delivered, and says where it stands', async () => {
    const { status, body } = await transition(server.port, {
      slug: 'long-done',
      transition: 'approve',
    });
    assert.equal(status, 200);
    assert.equal(body.applied, false);
    assert.equal(body.phase, 'delivered', 'the caller is told the real phase, not a guess');
    assert.match(body.reason, /already delivered/i);
  });

  it('does NOT refuse a plan already Approved — that is the idempotent repair, not an error', async () => {
    // THE SUBTLETY A REIMPLEMENTATION WOULD HAVE LOST.
    //
    // `Approved` looks like it should be refused, and `plot-approve.sh`
    // deliberately does not refuse it: a run that finds the phase already
    // flipped still has holds to clear, an annotation to check and a record
    // that may be missing — the half-states the script exists to repair. Its
    // own words: step 2 writes irreversibly, so RUN IT AGAIN is the repair for
    // every interruption after it.
    //
    // An API that wrote the phase rules for itself would have "helpfully" made
    // this a refusal, because it reads like one, and would have broken that
    // repair path silently. Wrapping inherits the subtlety for free. This test
    // exists to keep it inherited.
    const { body } = await transition(server.port, {
      slug: 'already-approved',
      transition: 'approve',
    });
    // It got PAST the phase gate and failed further on, at the PR lookup — in
    // this fixture there is no remote and no PR, which is exactly how far a
    // legitimate re-run gets here. The reason is that later step's, not a
    // phase complaint.
    assert.match(body.reason, /no PR found/i);
    assert.equal(body.phase, 'approved', 'and the phase is reported as it stands');
  });
});

describe('POST /api/transition: what it will not pretend to do', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-already-approved.md', content: APPROVED }] });
    stub = makeStubScripts();
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(async () => {
    await server?.stop();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('refuses `deliver` with 501 and names the command that owns it', async () => {
    // Plot has four phases and only ONE mechanised transition. Delivering is
    // prose /plot-deliver applies, with no script to wrap — so supporting it
    // here would mean writing those guardrails a second time beside the ones
    // that exist. 501 rather than 400: the caller named something real.
    const { status, body } = await transition(server.port, {
      slug: 'already-approved',
      transition: 'deliver',
    });
    assert.equal(status, 501);
    assert.match(body.error, /plot-deliver/);
  });

  it('refuses `release` with 501 and names the command that owns it', async () => {
    const { status, body } = await transition(server.port, {
      slug: 'already-approved',
      transition: 'release',
    });
    assert.equal(status, 501);
    assert.match(body.error, /plot-release/);
  });

  it('rejects a transition that is not a transition at all', async () => {
    const { status, body } = await transition(server.port, {
      slug: 'already-approved',
      transition: 'banana',
    });
    assert.equal(status, 400);
    assert.match(body.error, /must be one of/);
  });

  it('rejects a slug that is not a slug, and runs nothing', async () => {
    const { status } = await transition(server.port, {
      slug: '../../etc/passwd',
      transition: 'approve',
    });
    assert.equal(status, 400);
  });

  it('refuses a cross-origin request', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/transition',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ slug: 'already-approved', transition: 'approve' }),
    });
    assert.equal(res.status, 403);
  });
});
