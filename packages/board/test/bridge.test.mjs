// The last good pulse survives a restart — asserted across an ACTUAL process
// restart, never a cleared in-memory map.
//
// That distinction is the whole test file. `fleet.ts` already keeps a per-repo
// cache that every request reads while the scan refreshes it asynchronously,
// and that design is right — it is why the tab polls at 4 s without running a
// scan per request. It is process memory, and losing it on restart IS the
// defect: measured on 2026-08-17 with five agents in flight, three of them
// editing `packages/board/`, the Agents tab rendered `0 branches across 0
// plans` — an EMPTY view, not a stale one, because the operator's board runs
// under `node --watch` and every save restarts it. A test that emptied the Map
// and refilled it would pass without ever touching the mechanism at fault.
//
// So: a real git repo, the real `plot-fleet-scan.sh`, the built artifact, and
// two server processes with a kill between them.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, fetchRaw, SCRIPTS_DIR } from './helpers.mjs';

const BRIDGE = '.plot/state/last-pulse.json';

const PLAN = `# The board survives its own restart

## Status
- **Phase:** Approved
- **Type:** bug

## Branches

### Continuity

- \`feature/board-bridges-its-restart\` — the pulse outlives the process
`;

const git = (cwd) => (...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * A repo with a real remote and a real claim, so the pulse it produces has
 * something in it worth losing. Same shape as `claimed.test.mjs` builds, and
 * for the same reason: a claim is an empty `plot: claim …` commit pushed as a
 * ref, not an annotation anyone writes into the plan.
 */
function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-bridge-'));
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
  const planName = '2026-08-17-board-survives-restart.md';
  fs.writeFileSync(path.join(plans, planName), PLAN, 'utf8');
  fs.symlinkSync(path.join(plans, planName), path.join(plans, 'active', planName));

  g('add', '-A');
  g('commit', '-m', 'plan: the board survives its own restart');
  g('remote', 'add', 'origin', remote);
  g('push', '-u', 'origin', 'main');

  const claimed = 'feature/board-bridges-its-restart';
  g('checkout', '-b', claimed);
  g('commit', '--allow-empty', '-m', `plot: claim ${claimed}`);
  g('push', 'origin', claimed);
  g('checkout', 'main');

  return { tmp, repo, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/**
 * A scripts dir whose `plot-fleet-scan.sh` always fails, every other helper
 * symlinked from the real one.
 *
 * This is how "the file answered" is separated from "a fast rescan answered".
 * Both mechanisms are wanted and both are asserted — but a server whose scan
 * cannot possibly succeed has only the bridge to serve from, so a populated
 * `/api/fleet` under it can have come from nowhere else.
 */
function makeBrokenScan() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-brokenscan-'));
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (name === 'plot-fleet-scan.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  fs.writeFileSync(
    path.join(dir, 'plot-fleet-scan.sh'),
    '#!/usr/bin/env bash\necho "scan is broken on purpose" >&2\nexit 3\n',
    { mode: 0o755 },
  );
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const fetchFleet = async (port) => JSON.parse((await fetchRaw(port, '/api/fleet')).body);

/**
 * Plant a bridge file by hand, describing a repository state that does not
 * exist. Every row it carries is therefore identifiable as having come off the
 * disk rather than out of git — which is what lets "expired" and "outranked by
 * a real scan" be asserted at all.
 */
function plantBridge(repo, { at, plan, branch }) {
  const file = path.join(repo, BRIDGE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    at,
    pulse: {
      main: 'main',
      head: 'main',
      plans: [{
        file: plan,
        phase: 'approved',
        waves: [{
          name: 'Ghosts',
          verdict: 'eligible',
          branches: [{ branch, state: 'open', deferred: false, claimed: '' }],
        }],
      }],
      summary: {
        plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0,
      },
    },
    ages: [],
    branchUrlBase: '',
    approvedAt: [],
    ideaPlans: [],
  }), 'utf8');
  return file;
}

/**
 * Poll until the scan has landed AND been written down.
 *
 * The two are not the same moment, and conflating them made an earlier version
 * of this suite fail for the wrong reason. `entry.pulse` is assigned as soon as
 * the scan parses — which is what flips `ready` — while the branch ages, the
 * origin, the approval dates and the idea plans are each fetched after it. The
 * bridge is written once ALL of them are in, because a payload missing half its
 * facts is not the last good answer.
 *
 * So the file is what this waits for. It is also the honest thing to wait for:
 * the restart below can only be served by something already on disk.
 */
async function waitForBridge(repo, port, { rows = 1 } = {}) {
  const file = path.join(repo, BRIDGE);
  for (let i = 0; i < 80; i++) {
    const fleet = await fetchFleet(port);
    if (fleet.ready && fleet.rows.length >= rows && fs.existsSync(file)) return fleet;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fetchFleet(port);
}

describe('bridge: the last good pulse outlives the process', () => {
  let fixture, broken, first, second, beforeRestart, firstRequest, afterRestart;

  before(async () => {
    fixture = makeRepo();
    broken = makeBrokenScan();

    // ONE: a healthy server, a real scan, a real pulse.
    first = await startServer(fixture.repo);
    beforeRestart = await waitForBridge(fixture.repo, first.port);
    first.kill();
    first = null;
    // The kill is asynchronous; the file is already written by then (the scan
    // that produced `beforeRestart` wrote it), so nothing is waited for here
    // beyond the port being free of the old listener.
    await new Promise((r) => setTimeout(r, 300));

    // TWO: the same repo, a scan that CANNOT succeed. Anything this server
    // serves came off the disk.
    second = await startServer(fixture.repo, { PLOT_SCRIPTS_DIR: broken.dir });
    // The VERY FIRST request, kept separately: this is the window the whole
    // branch exists to close. A board that only recovered once its own scan
    // finished would still serve `0 branches across 0 plans` for the measured
    // 500–1050 ms (21.2 s on a cold boot) — and under a `--watch` restart storm
    // that window is most of what an operator sees.
    firstRequest = await fetchFleet(second.port);
    // The bridge is served from the FIRST request onwards — it is read
    // synchronously in `ensureCache`, before anything is awaited. The wait here
    // is only for the failing scan to report itself, which is what makes the
    // "no second vocabulary" assertion below about the real pairing of a served
    // pulse with a live error rather than about a server that had not looked.
    for (let i = 0; i < 40; i++) {
      afterRestart = await fetchFleet(second.port);
      if (afterRestart.error) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  after(() => {
    first?.kill();
    second?.kill();
    broken?.cleanup();
    fixture?.cleanup();
  });

  it('writes the pulse to .plot/state/last-pulse.json on a successful scan', () => {
    const file = path.join(fixture.repo, BRIDGE);
    assert.ok(fs.existsSync(file), `${BRIDGE} should exist after a successful scan`);
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(typeof payload.at, 'number');
    assert.ok(payload.pulse.plans.length >= 1, 'the written pulse should carry the plan');
  });

  it('had a real pulse before the restart', () => {
    assert.equal(beforeRestart.ready, true);
    assert.ok(beforeRestart.rows.length >= 1, 'the first server should see the claimed branch');
  });

  it('answers the FIRST request after a restart with the previous pulse', () => {
    // The window the branch exists to close, asserted at its narrowest point:
    // no poll, no timer, no scan — the first request a page makes.
    assert.equal(firstRequest.ready, true, 'the first request must not report "no data yet"');
    assert.ok(firstRequest.rows.length >= 1, 'the first request must not render 0 branches');
  });

  it('serves the previous pulse after a restart rather than 0 branches', () => {
    // THE HEADLINE. Without the bridge this is `ready: false` with zero rows —
    // the measured `0 branches across 0 plans`.
    assert.equal(afterRestart.ready, true, 'a restarted board must not report "no data yet"');
    assert.deepEqual(
      afterRestart.rows.map((r) => r.branch).sort(),
      beforeRestart.rows.map((r) => r.branch).sort(),
    );
    assert.equal(afterRestart.summary.branches, beforeRestart.summary.branches);
  });

  it('labels the bridged pulse with its real age, not with the restart moment', () => {
    // The age is what makes it honest. `ageSeconds` drives #141's banner, the
    // `(frozen)` footer and the stopped clocks; dating a bridged payload from
    // when it was LOADED would present a ten-minute-old answer as fresh, which
    // is the one thing worse than showing nothing.
    assert.ok(
      afterRestart.ageSeconds >= beforeRestart.ageSeconds,
      `bridged age (${afterRestart.ageSeconds}s) should not be younger than the scan it came from`,
    );
  });

  it('feeds the existing stale rendering rather than inventing a second one', () => {
    // `error` + `ready: true` is exactly the pair AgentList already renders as
    // "Last scan failed: … — showing the last successful pulse below." No new
    // field, no second vocabulary for "these numbers are old".
    assert.match(afterRestart.error ?? '', /scan is broken on purpose|exit|3/i);
  });

  it('does not overwrite the file when a scan FAILS', async () => {
    // One-directional, like every other signal here: a failure must not destroy
    // the last good answer, which is the only thing standing between a restart
    // and an empty board. The second server has been failing its scan on a 5 s
    // timer since it started.
    const file = path.join(fixture.repo, BRIDGE);
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(written.pulse.plans.length >= 1, 'the good pulse should still be on disk');
    // Wait past a refresh tick and confirm the payload is byte-identical.
    const raw = fs.readFileSync(file, 'utf8');
    await new Promise((r) => setTimeout(r, 6_000));
    assert.equal(fs.readFileSync(file, 'utf8'), raw, 'a failing scan must not rewrite the bridge');
  });
});

describe('bridge: a real scan wins immediately over the file', () => {
  let fixture, server, fleet;

  before(async () => {
    fixture = makeRepo();
    // A bridge from a DIFFERENT repository state: a plan and a branch that no
    // longer exist. If the file ever outranked a live scan, this row would show
    // up in the served pulse.
    plantBridge(fixture.repo, {
      at: Date.now(),
      plan: '2020-01-01-a-plan-that-is-gone.md',
      branch: 'feature/a-branch-that-is-gone',
    });

    server = await startServer(fixture.repo);
    // Wait for the REAL scan to land AND be written down — identified by the
    // branch only git knows about. The two moments differ (see
    // `waitForBridge`), and the second assertion below is about the file.
    for (let i = 0; i < 80; i++) {
      fleet = await fetchFleet(server.port);
      const live = fleet.rows.some((r) => r.branch === 'feature/board-bridges-its-restart');
      const written = fs.readFileSync(path.join(fixture.repo, BRIDGE), 'utf8');
      if (live && written.includes('board-bridges-its-restart')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  after(() => {
    server?.kill();
    fixture?.cleanup();
  });

  it('replaces every bridged row the moment a scan completes', () => {
    assert.ok(
      fleet.rows.some((r) => r.branch === 'feature/board-bridges-its-restart'),
      'the live scan should have landed',
    );
    assert.ok(
      !fleet.rows.some((r) => r.branch === 'feature/a-branch-that-is-gone'),
      'no bridged row may survive a completed scan',
    );
  });

  it('rewrites the file with the fresh answer', () => {
    const written = JSON.parse(fs.readFileSync(path.join(fixture.repo, BRIDGE), 'utf8'));
    assert.ok(
      !JSON.stringify(written).includes('a-branch-that-is-gone'),
      'a successful scan replaces the bridge',
    );
  });

  it('issues the startup scan alongside the file read', () => {
    // Both, never one. The file alone leaves the board stale until the next
    // poll; the scan alone leaves the measured 500–1050 ms window (21.2 s on a
    // cold boot) empty. This assertion is the "scan" half — the board reached a
    // live answer on its own at start-up, with nothing but the initial warm to
    // do it — and the restart suite above is the "file" half.
    assert.equal(fleet.ready, true);
    assert.equal(fleet.error, null);
  });
});

describe('bridge: a stale-enough file is not served', () => {
  let fixture, broken, server, fleet;

  before(async () => {
    fixture = makeRepo();
    broken = makeBrokenScan();
    // Sixteen minutes old — past the fifteen-minute expiry. A bridge that never
    // expires is a store, and a store of git-derived state is a second source
    // of truth that can disagree with the repository (Principle 1).
    plantBridge(fixture.repo, {
      at: Date.now() - 16 * 60_000,
      plan: '2020-01-01-ancient.md',
      branch: 'feature/ancient',
    });

    server = await startServer(fixture.repo, { PLOT_SCRIPTS_DIR: broken.dir });
    // Give the failing scan a moment to land its error, so this is not merely
    // "the server had not looked yet".
    for (let i = 0; i < 40; i++) {
      fleet = await fetchFleet(server.port);
      if (fleet.error) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  after(() => {
    server?.kill();
    broken?.cleanup();
    fixture?.cleanup();
  });

  it('says no data rather than serving an expired pulse', () => {
    assert.equal(fleet.ready, false, 'an expired bridge must not be served');
    assert.deepEqual(fleet.rows, []);
    assert.equal(fleet.summary.branches, 0);
  });

  it('still reports the scan failure, so the page is not silently empty', () => {
    assert.ok(fleet.error, 'the failing scan must still surface its own words');
  });
});
