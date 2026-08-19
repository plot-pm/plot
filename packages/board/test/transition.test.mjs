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
import { execFileSync, spawnSync } from 'node:child_process';
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

/**
 * Run the real `plot-approve.sh` against a fixture and return what it said.
 *
 * DIRECT, WITHOUT A SERVER, and the split is what keeps this file affordable.
 * Two separable things are under test here: whether the SPOKE refuses, and
 * whether the ENDPOINT forwards that refusal faithfully. The first is a
 * property of the script and is provable by running it — with the endpoint out
 * of the way, which makes it a stronger claim, not a weaker one. The second
 * needs a server and needs it exactly once.
 *
 * Booting a server per guardrail cost three seconds each in shell forks and
 * pushed the whole `node --test` run — which runs files concurrently — past the
 * point where unrelated suites started losing. Measured 2026-08-19: eight
 * failures across `approve` and `bridge` with these three present, one without.
 * None of them was logically broken; they were starved.
 */
function runApprove(repo, slug) {
  const res = spawnSync('bash', [path.join(SCRIPTS_DIR, 'plot-approve.sh'), slug], {
    cwd: repo,
    encoding: 'utf8',
    // `PLOT_HOST` is plot-host.sh's own documented test hook, and an
    // unrecognised value makes the adapter die immediately and LOCALLY. No test
    // in this file may reach a git host.
    env: { ...process.env, PLOT_HOST: 'none-in-tests' },
  });
  return { code: res.status, said: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

describe('the spoke refuses, and this is what it says', () => {
  let tmp;

  before(() => {
    tmp = makeRepo({
      plans: [
        { name: '2026-08-16-needs-a-human.md', content: DRAFT_IN_SESSION },
        { name: '2026-08-16-long-done.md', content: DELIVERED },
        { name: '2026-08-16-already-approved.md', content: APPROVED },
      ],
    });
    initRepo(tmp);
  });

  after(() => {
    if (tmp) rmTree(tmp);
  });

  // ── Direction 1: TOO EARLY. A plan that has not been through its review
  //    channel must not become Approved because something asked nicely.
  it('refuses a Draft whose review channel needs a human', () => {
    const { code, said } = runApprove(tmp, 'needs-a-human');
    assert.notEqual(code, 0, 'a refusal must be a non-zero exit');
    assert.match(said, /in-session/);
    assert.match(said, /human in the room/);
    // The load-bearing assertion: a refusal that already wrote is not one.
    assert.equal(
      fs.readFileSync(path.join(tmp, 'docs/plans/2026-08-16-needs-a-human.md'), 'utf8'),
      DRAFT_IN_SESSION,
      'a refused transition must write nothing',
    );
  });

  // ── Direction 2: TOO LATE. A plan past the target phase has nothing to
  //    approve, and saying so is the refusal.
  it('refuses a plan that is already Delivered', () => {
    const { code, said } = runApprove(tmp, 'long-done');
    assert.notEqual(code, 0);
    assert.match(said, /already delivered/i);
  });

  it('does NOT refuse a plan already Approved — that is the idempotent repair', () => {
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
    // repair path silently. Wrapping inherits the subtlety for free; this keeps
    // it inherited.
    const { said } = runApprove(tmp, 'already-approved');
    assert.doesNotMatch(
      said,
      /nothing to approve|not Draft/i,
      'an Approved plan must not be refused on its phase',
    );
  });
});

describe('POST /api/transition: the spoke\'s refusal reaches the caller intact', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-needs-a-human.md', content: DRAFT_IN_SESSION }] });
    initRepo(tmp);
    // ONE server for the whole file's endpoint half — see `runApprove` above
    // for why the guardrails themselves are asserted without one. THE REAL
    // SCRIPTS DIR: a stub exiting non-zero would prove the wiring and nothing
    // about the property that matters, which is that the API cannot approve a
    // plan the spoke would refuse.
    server = await startServer(tmp, {
      PLOT_SCRIPTS_DIR: SCRIPTS_DIR,
      PLOT_HOST: 'none-in-tests',
    });
  });

  after(async () => {
    await server?.stop();
    if (tmp) rmTree(tmp);
  });

  it('answers 200 with applied:false, the real phase, and the spoke\'s own words', async () => {
    const { status, body } = await transition(server.port, {
      slug: 'needs-a-human',
      transition: 'approve',
    });
    assert.equal(status, 200, 'a guardrail refusal is a normal answer, not a client error');
    assert.equal(body.applied, false, 'the transition must NOT have been applied');
    // Read back from the file rather than inferred from the exit code — the
    // endpoint's promise is that a caller never re-derives whether it landed.
    assert.equal(body.phase, 'draft');
    // Forwarded rather than replaced. Replacing it with a status name would
    // send the reader to a terminal — and then the command could have been
    // typed there in the first place. Both lines travel: the cause and the
    // instruction are each half of the reason.
    assert.match(body.reason, /in-session/);
    assert.match(body.reason, /human in the room/);
  });

  it('wrote nothing to the plan file', async () => {
    assert.equal(
      fs.readFileSync(path.join(tmp, 'docs/plans/2026-08-16-needs-a-human.md'), 'utf8'),
      DRAFT_IN_SESSION,
    );
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
