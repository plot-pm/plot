// `/api/attention` — what needs doing, and by whom, over HTTP.
//
// The verdict LOGIC is tested as pure functions in `test/unit/attention.test.ts`
// against rows built by `rowsFromPulse`; that is where a wrong verdict is a
// wrong answer no plumbing can fix. This file tests what only the shipped
// artifact can answer: that the route exists, that it serves the four lists,
// and — the assertion this file exists for — that a COLD CACHE does not read as
// an empty fleet.
//
// THOSE TWO ARE OPPOSITE FACTS AND ARRIVE IN THE SAME SHAPE. Four empty lists
// mean *nothing to do*, which invites a caller to stop; four empty lists before
// any scan has landed mean *nothing has been read yet*, which invites it to wait
// and ask again. A caller that cannot tell them apart concludes the first, exits,
// and the fleet sits still. `2026-08-18-not-yet-asked-is-not-nothing` shipped
// this same rule for the board's own rows.
//
// The scan is BROKEN ON PURPOSE in the cold case, which is what makes the
// assertion about the cold path at all: against a working scan the server would
// populate its cache within a few seconds and the window under test would close
// while the test was still setting up.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, fetchRaw, request, SCRIPTS_DIR, git, rmTree } from './helpers.mjs';

const BRIDGE = '.plot/state/last-pulse.json';

const PLAN = `# The board answers agents

## Status
- **Phase:** Approved
- **Type:** feature

## Branches

### Ask

- \`feature/api-attention-says-what-needs-you\` — one call, four lists
`;

/** A minimal repo with a remote — enough for the server to start and scan. */
function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-attention-'));
  const repo = path.join(tmp, 'work');
  const remote = path.join(tmp, 'remote.git');
  fs.mkdirSync(repo, { recursive: true });

  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  const g = git(repo);
  g('init', '-b', 'main');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'Plot Test');
  g('config', 'commit.gpgsign', 'false');

  const plans = path.join(repo, 'docs/plans');
  fs.mkdirSync(path.join(plans, 'active'), { recursive: true });
  const planName = '2026-08-18-the-board-answers-agents.md';
  fs.writeFileSync(path.join(plans, planName), PLAN, 'utf8');
  fs.symlinkSync(path.join(plans, planName), path.join(plans, 'active', planName));

  g('add', '-A');
  g('commit', '-m', 'plan: the board answers agents');
  g('remote', 'add', 'origin', remote);
  g('push', '-u', 'origin', 'main');

  return { tmp, repo, cleanup: () => rmTree(tmp) };
}

/**
 * A scripts dir whose `plot-fleet-scan.sh` always fails, every other helper
 * symlinked from the real one. Borrowed from `read-ref.test.mjs`, and
 * load-bearing for the same reason: a server whose scan cannot succeed serves
 * the planted pulse and nothing else, so what comes back is attributable.
 */
function makeBrokenScan() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-attention-scan-'));
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (name === 'plot-fleet-scan.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  fs.writeFileSync(
    path.join(dir, 'plot-fleet-scan.sh'),
    '#!/usr/bin/env bash\necho "scan is broken on purpose" >&2\nexit 3\n',
    { mode: 0o755 },
  );
  return { dir, cleanup: () => rmTree(dir) };
}

/** Plant a bridge carrying an arbitrary pulse — the server reads it on start. */
function plantBridge(repo, pulse) {
  const file = path.join(repo, BRIDGE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    at: Date.now(),
    pulse: {
      main: 'main',
      head: 'abc1234',
      read_ref: 'ee199aa',
      local_head: 'abc1234',
      summary: {
        plans: 1, waves: 1, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0,
      },
      ...pulse,
    },
    ages: [],
    branchUrlBase: '',
    approvedAt: [],
    ideaPlans: [],
  }), 'utf8');
  return file;
}

const fetchAttention = async (port) =>
  JSON.parse((await fetchRaw(port, '/api/attention')).body);

describe('/api/attention', () => {
  let fixture, broken;

  before(() => {
    fixture = makeRepo();
    broken = makeBrokenScan();
  });

  after(() => {
    broken?.cleanup();
    fixture?.cleanup();
  });

  describe('before any pulse has landed', () => {
    let body;

    before(async () => {
      // No bridge, and a scan that cannot succeed: nothing has ever been read.
      const cold = makeRepo();
      const server = await startServer(cold.repo, { PLOT_SCRIPTS_DIR: broken.dir });
      try {
        body = await fetchAttention(server.port);
      } finally {
        await server.stop();
        cold.cleanup();
      }
    });

    it('says so, rather than serving four empty lists as an answer', () => {
      // THE ASSERTION THIS FILE EXISTS FOR. Without `ready`, the payload below
      // is indistinguishable from a fleet with genuinely nothing to do — and
      // the two invite opposite behaviour from a caller.
      assert.equal(body.ready, false);
    });

    it('still returns the four lists, empty', () => {
      // Empty rather than absent: a caller iterating them must not have to
      // branch on `ready` to avoid a crash. `ready` changes what the emptiness
      // MEANS, never whether the fields are there.
      assert.deepEqual(body.needsAgent, []);
      assert.deepEqual(body.needsHuman, []);
      assert.deepEqual(body.waiting, []);
      assert.deepEqual(body.claimable, []);
    });

    it('dates nothing, because nothing was read', () => {
      // Null rather than 0 — 0 would assert a read that just happened, the
      // confident-absent-value shape this contract refuses everywhere.
      assert.equal(body.ageSeconds, null);
      assert.equal(body.readRef, null);
    });
  });

  describe('a fleet with genuinely nothing to do', () => {
    let body;

    before(async () => {
      // A pulse that LANDED and carries no branches at all. Same four empty
      // lists as the cold case above, opposite meaning.
      plantBridge(fixture.repo, {
        plans: [{
          file: '2026-08-18-the-board-answers-agents.md',
          phase: 'approved',
          waves: [{ name: 'Ask', verdict: 'complete', branches: [] }],
        }],
      });
      const server = await startServer(fixture.repo, { PLOT_SCRIPTS_DIR: broken.dir });
      try {
        body = await fetchAttention(server.port);
      } finally {
        await server.stop();
      }
    });

    it('reports ready, which is what separates it from a cold cache', () => {
      assert.equal(body.ready, true);
      assert.deepEqual(body.needsAgent, []);
      assert.deepEqual(body.claimable, []);
    });

    it('names the ref its verdicts are about', () => {
      // A verdict is a stronger claim than a fact and needs the provenance at
      // least as much: *restart this branch* is advice, and advice about a
      // world three pushes old is worse than none.
      assert.equal(body.readRef, 'ee199aa');
      assert.equal(typeof body.ageSeconds, 'number');
    });
  });

  describe('a fleet with work in every state', () => {
    let body;

    before(async () => {
      plantBridge(fixture.repo, {
        plans: [{
          file: '2026-08-18-the-board-answers-agents.md',
          phase: 'approved',
          waves: [
            { name: 'Ask', verdict: 'eligible', branches: [
              { branch: 'feature/has-failed', state: 'claimed', deferred: false, claimed: '',
                worker: 'failed', worker_exit: '1' },
              { branch: 'feature/is-waiting', state: 'claimed', deferred: false, claimed: '',
                worker: 'waiting' },
              { branch: 'feature/is-running', state: 'claimed', deferred: false, claimed: '',
                worker: 'running', worker_pid: '4242' },
              { branch: 'feature/nobody-took-it', state: 'open', deferred: false, claimed: '' },
            ] },
          ],
        }],
        summary: {
          plans: 1, waves: 1, branches: 4, claimed: 3, eligible: 1, blocked: 0, deferred: 0,
        },
      });
      const server = await startServer(fixture.repo, { PLOT_SCRIPTS_DIR: broken.dir });
      try {
        body = await fetchAttention(server.port);
      } finally {
        await server.stop();
      }
    });

    it('puts the failed worker in needsAgent, with its evidence', () => {
      assert.equal(body.needsAgent.length, 1);
      const [item] = body.needsAgent;
      assert.equal(item.branch, 'feature/has-failed');
      assert.equal(item.verdict, 'abandoned');
      // The audit trail: a caller can check this verdict against /api/fleet
      // without running anything, which is what makes the list trustworthy.
      assert.equal(item.evidence, 'worker: failed');
    });

    it('puts the waiting worker in its OWN list, never in needsAgent', () => {
      assert.equal(body.waiting.length, 1);
      assert.equal(body.waiting[0].branch, 'feature/is-waiting');
      assert.equal(body.waiting[0].verdict, 'question');
      // The regression written down: restarting a worker that is holding the
      // door open re-runs what it finished before it asked.
      assert.ok(!body.needsAgent.some((i) => i.branch === 'feature/is-waiting'));
    });

    it('leaves the running worker out of every list', () => {
      const all = [...body.needsAgent, ...body.needsHuman, ...body.waiting];
      assert.ok(!all.some((i) => i.branch === 'feature/is-running'));
      assert.ok(!body.claimable.some((c) => c.branch === 'feature/is-running'));
    });

    it('does NOT name the untaken branch claimable while the host is unasked', () => {
      // REWRITTEN 2026-09-21, and the old assertion was the defect.
      //
      // This fixture starts the server with `PLOT_SCRIPTS_DIR: broken.dir`, so
      // the host cannot be asked and the PR map is never populated. Until
      // `an-unasked-host-is-not-an-absent-pr`, `prUnknown` was produced only by
      // `held?.state === 'unknown'` over a NULLABLE map — a null map yields
      // `held === null`, so `prUnknown` was `false` for exactly the total
      // outage it exists to report, and `classifyGroup` never withheld.
      //
      // `fleet.ts:4308` states the rule this test used to contradict:
      // *"`eligible` is an answer about the host, and the host did not
      // answer."* An unasked host cannot establish that a branch has no PR, so
      // it cannot establish that the branch is free to take — it may well have
      // one already. Offering it is the double-dispatch the test below guards.
      //
      // So the row is withheld from `claimable` and lands in `waiting-on-you`
      // with `PR_UNKNOWN_NOTE`. The row itself is NOT blanked; that is the next
      // assertion, and it is what separates a withheld verdict from a lost row.
      assert.equal(body.claimable.length, 0);
    });

    it('does not move the withheld branch into an errand list either', () => {
      // WHERE THE ROW GOES, and this endpoint is not it.
      //
      // `/api/attention` is a FILTERED VIEW over `buildFleet`, not the row
      // store: `findingItems`/`readingFor` answer null for a branch with no
      // worker and no PR, which is this branch by construction. So withholding
      // the verdict takes it out of `claimable` and puts it in nothing here —
      // and that is correct for an errand list, because there is no errand: the
      // reader's job is to fix the host, which the banner already says once for
      // the whole board rather than once per branch.
      //
      // The ROW itself is not lost. It lives in `/api/fleet` with its slice,
      // its plan and `PR_UNKNOWN_NOTE`, which is the plan's Done-when 4 and is
      // asserted there — `an-unasked-host-is-not-an-absent-pr.test.ts` — rather
      // than here, where a row's survival is not the endpoint's subject.
      const all = [...body.needsAgent, ...body.needsHuman, ...body.waiting];
      assert.ok(!all.some((i) => i.branch === 'feature/nobody-took-it'));
    });

    it('never lists a claimed branch as claimable', () => {
      // Offering to start a branch that already has a worker invites the
      // double-dispatch `fleet-sees-merged-branches` was written to prevent.
      for (const c of body.claimable) {
        assert.notEqual(c.branch, 'feature/has-failed');
        assert.notEqual(c.branch, 'feature/is-waiting');
      }
    });
  });

  describe('the endpoint is read-only', () => {
    it('refuses a POST', async () => {
      // KEEPING THIS WAVE READ-ONLY PRESERVES THE SPLIT THE REPO RESTS ON:
      // read-only investigation gates every write. `/api/dispatch` spawns
      // processes and is same-origin locked precisely because it does; this
      // endpoint names candidates and reserves nothing, so it earns no such
      // gate — and must never quietly grow one by accepting a body.
      //
      // The refusal is the server's blanket 405 rather than a check of this
      // route's own, which is the point: a default that refuses is a gate,
      // while a per-route method check every future route must remember is a
      // rule.
      const server = await startServer(fixture.repo, { PLOT_SCRIPTS_DIR: broken.dir });
      try {
        const res = await request(server.port, { method: 'POST', path: '/api/attention' });
        assert.equal(res.status, 405);
      } finally {
        await server.stop();
      }
    });
  });
});
