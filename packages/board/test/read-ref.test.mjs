// `/api/fleet` names the ref its data came from — and says nothing when it
// cannot.
//
// The gap was measured, not imagined. During a two-agent dispatch on
// 2026-08-18 an operator read current-looking board data while their local
// `origin/main` was behind other agents' pushes. Three wrong diagnoses
// followed, including "the fleet endpoint is broken" and "the scan exceeds the
// board's timeout" — neither true. The board was right every time; it simply
// had no way to say WHICH WORLD it was right about. The UI renders "scanned 10s
// ago" well, and a machine consumer got no equivalent.
//
// TWO SCAN SHAPES, ONE ENDPOINT. `plot-fleet-scan.sh` emits only `head` today;
// a sibling branch (`bug/pulse-names-the-ref-it-read`) adds `read_ref` and
// `local_head` while keeping `head` as an alias for one release. Both shapes
// are asserted here because both are live: the branches were deliberately made
// independent, so this one must merge before, after, or without the other.
//
// The fallback runs in ONE DIRECTION and that asymmetry is the point:
//
//   - `head` is `git rev-parse --short HEAD` — the local checkout, under a name
//     that implies more. It is a sound fallback for `localHead`, which is the
//     same fact, and an UNSOUND one for `readRef`, which is a different commit
//     whenever the operator is not standing on a freshly fetched main. Filling
//     `readRef` from it would manufacture the precise false statement this
//     endpoint exists to end — silently, on every consumer.
//
// So an old scan must yield `readRef: null`. A null here is a consumer's cue to
// fetch and rescan; a wrong sha is a consumer's cue to misdiagnose for an hour.
//
// The pulse is PLANTED and the scan is BROKEN on purpose, which is what makes
// these assertions about the fallback at all. Against a working scan the served
// `read_ref` would be whatever today's script happens to emit — so the test
// would silently stop testing the old shape the moment the sibling landed, and
// could never test the new one before it did.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, fetchRaw, SCRIPTS_DIR, git, rmTree } from './helpers.mjs';

const BRIDGE = '.plot/state/last-pulse.json';

const PLAN = `# The fleet API names its ref

## Status
- **Phase:** Approved
- **Type:** feature

## Branches

### Honesty

- \`feature/fleet-api-names-its-ref\` — the response says what it read
`;

/** A minimal repo with a remote — enough for the server to start and scan. */
function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-readref-'));
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
  const planName = '2026-08-18-fleet-api-names-its-ref.md';
  fs.writeFileSync(path.join(plans, planName), PLAN, 'utf8');
  fs.symlinkSync(path.join(plans, planName), path.join(plans, 'active', planName));

  g('add', '-A');
  g('commit', '-m', 'plan: the fleet api names its ref');
  g('remote', 'add', 'origin', remote);
  g('push', '-u', 'origin', 'main');

  return { tmp, repo, cleanup: () => rmTree(tmp) };
}

/**
 * A scripts dir whose `plot-fleet-scan.sh` always fails, every other helper
 * symlinked from the real one. Borrowed wholesale from `bridge.test.mjs`, and
 * load-bearing for the same reason: a server whose scan cannot succeed serves
 * the planted pulse and nothing else, so what comes back is attributable.
 */
function makeBrokenScan() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-readref-scan-'));
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

/**
 * A scripts dir whose `plot-fleet-scan.sh` SUCCEEDS but always reports
 * `fetch_failed: true` — distinct from `makeBrokenScan`, whose scan dies
 * outright. This one exercises the OTHER failure shape: the scan ran, parsed,
 * and produced a pulse, but the `git fetch` of the ref inside it did not. Every
 * other helper is the real one, symlinked, so the scan's shape is the only
 * thing this directory changes.
 *
 * Emits the ONE line `scanOnce` (`packages/fleet/src/shared/fleet-scan.ts`)
 * actually reads from `--stream`: `{"kind":"reading","reading":{...}}` on
 * stdout, parsed through `FleetReadingSchema`. A bare pulse object (the
 * `--json` shape `plantBridge` uses for the bridge FILE) is a different
 * contract and would be silently dropped here, leaving `scanOnce` to throw
 * "ended without a terminal pulse line" instead of exercising the field.
 *
 * `plot-fleetctl.sh` is ALSO overridden, to report the supervisor `down`.
 * Without that, `fleetOwnsScan` (`scan-owner.ts`) reads a fresh planted bridge
 * plus a real `plot-fleetctl.sh`'s `up`/`unknown` as the fleet owning the scan
 * — the board then serves the bridge's own pulse and never invokes this
 * directory's `plot-fleet-scan.sh` at all, leaving the whole `fetch_failed`
 * path on `refresh`'s live-scan branch untested.
 */
function makeFetchFailedScan() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-readref-fetchfailed-'));
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (name === 'plot-fleet-scan.sh' || name === 'plot-fleetctl.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  fs.writeFileSync(
    path.join(dir, 'plot-fleetctl.sh'),
    '#!/usr/bin/env bash\necho "summary: supervisor=down"\nexit 1\n',
    { mode: 0o755 },
  );
  const reading = JSON.stringify({
    main: 'main',
    head: '91a9a60',
    read_ref: 'ee199aa',
    local_head: '91a9a60',
    fetch_failed: true,
    plans: [],
    summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  });
  const line = JSON.stringify({ kind: 'reading', reading: JSON.parse(reading) });
  fs.writeFileSync(
    path.join(dir, 'plot-fleet-scan.sh'),
    `#!/usr/bin/env bash\ncat <<'JSON'\n${line}\nJSON\n`,
    { mode: 0o755 },
  );
  return { dir, cleanup: () => rmTree(dir) };
}

const fetchFleet = async (port) => JSON.parse((await fetchRaw(port, '/api/fleet')).body);

/**
 * Plant a bridge carrying an arbitrary pulse shape.
 *
 * `pulse` is spread last so a caller decides exactly which ref fields exist —
 * including OMITTING them, which is the whole old-scan case. A default that
 * filled them in would make the absent shape untestable.
 */
function plantBridge(repo, pulse) {
  const file = path.join(repo, BRIDGE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    at: Date.now(),
    pulse: {
      main: 'main',
      plans: [{
        file: 'docs/plans/2026-08-18-fleet-api-names-its-ref.md',
        phase: 'approved',
        waves: [{
          name: 'Honesty',
          verdict: 'eligible',
          branches: [{
            branch: 'feature/fleet-api-names-its-ref',
            state: 'open',
            deferred: false,
            claimed: '',
          }],
        }],
      }],
      summary: {
        plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0,
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

/**
 * Serve one planted pulse and return the fleet payload.
 *
 * The bridge is read synchronously in `ensureCache`, before anything is
 * awaited, so the FIRST request already carries it — no polling for a scan that
 * is designed never to land.
 */
async function serve(repo, scriptsDir, pulse) {
  plantBridge(repo, pulse);
  const server = await startServer(repo, { PLOT_SCRIPTS_DIR: scriptsDir });
  try {
    return await fetchFleet(server.port);
  } finally {
    await server.stop();
  }
}

describe('/api/fleet names the ref it read', () => {
  let fixture, broken;

  before(() => {
    fixture = makeRepo();
    broken = makeBrokenScan();
  });

  after(() => {
    broken?.cleanup();
    fixture?.cleanup();
  });

  describe('a scan that reports read_ref (the sibling branch has landed)', () => {
    let fleet;

    before(async () => {
      // The divergence is CONSTRUCTED, not hoped for: the read ref and the
      // local head are different shas here. A fixture where the two agreed
      // would pass against code that confused them, which is the failure this
      // whole pair of branches is about.
      fleet = await serve(fixture.repo, broken.dir, {
        head: 'aaaaaaa',
        read_ref: 'ee199aa',
        local_head: 'aaaaaaa',
      });
    });

    it('reports the ref the scan actually read', () => {
      assert.equal(fleet.readRef, 'ee199aa');
    });

    it('reports the local checkout separately, and does not conflate the two', () => {
      assert.equal(fleet.localHead, 'aaaaaaa');
      assert.notEqual(fleet.localHead, fleet.readRef);
    });

    it('dates the read, in seconds, beside the ref it names', () => {
      assert.equal(typeof fleet.readRefAge, 'number');
      assert.ok(fleet.readRefAge >= 0, 'the age of a read that happened is not negative');
      // One cached scan produces both, so they cannot disagree — `readRefAge`
      // is named for the ref rather than for the tab, but it is the same clock.
      assert.equal(fleet.readRefAge, fleet.ageSeconds);
    });
  });

  describe('a scan that emits only head (the fallback path)', () => {
    let fleet;

    before(async () => {
      // Exactly today's shape: `head` and nothing else. This is what the
      // endpoint must tolerate until the sibling branch lands, and a hard
      // dependency on the newer fields would have made this branch unmergeable
      // in the meantime.
      fleet = await serve(fixture.repo, broken.dir, { head: '91a9a60' });
    });

    it('falls back to head for the LOCAL checkout, which is what head has always been', () => {
      assert.equal(fleet.localHead, '91a9a60');
    });

    it('reports readRef as null rather than substituting the local head', () => {
      // The load-bearing assertion of this file. `head` is the local checkout;
      // the ref that was read is `origin/main` and may be far ahead. Answering
      // '91a9a60' here would be a confident claim about a commit the scan never
      // read — the original defect, relocated into the endpoint built to fix
      // it. Null is the honest answer and a consumer can act on it.
      assert.equal(fleet.readRef, null);
      assert.notEqual(fleet.readRef, fleet.localHead);
    });

    it('still dates the read, because a pulse did land', () => {
      // An unnamed ref is not an unread one: the scan ran, it just did not say
      // what it read. The age stays true and stays reported.
      assert.equal(typeof fleet.readRefAge, 'number');
    });
  });

  describe('a scan that looked and could not resolve the ref', () => {
    it('passes the scan\'s explicit "unknown" through, distinct from null', () => {
      // The scan reports the string `unknown` when `origin/<main>` cannot be
      // resolved (no remote, fresh clone) rather than falling back to HEAD.
      // That is a DIFFERENT fact from null — "I looked and could not tell"
      // versus "this scan predates the field" — and flattening the two would
      // discard the distinction the sibling branch went to the trouble of
      // making. Neither reads as a confident claim, which is what matters.
      return serve(fixture.repo, broken.dir, {
        head: '91a9a60',
        read_ref: 'unknown',
        local_head: '91a9a60',
      }).then((fleet) => {
        assert.equal(fleet.readRef, 'unknown');
      });
    });
  });

  describe('before any pulse has landed', () => {
    let fleet, empty;

    before(async () => {
      // No bridge, and a scan that cannot succeed: nothing has ever been read.
      empty = makeRepo();
      const server = await startServer(empty.repo, { PLOT_SCRIPTS_DIR: broken.dir });
      try {
        fleet = await fetchFleet(server.port);
      } finally {
        await server.stop();
      }
    });

    after(() => empty?.cleanup());

    it('says nothing about a ref it never read', () => {
      assert.equal(fleet.ready, false);
      assert.equal(fleet.readRef, null);
      assert.equal(fleet.localHead, null);
    });

    it('reports readRefAge as null rather than 0', () => {
      // 0 would assert a read that just happened — the confident absent value
      // this file exists to refuse. Null says there is nothing to date.
      assert.equal(fleet.readRefAge, null);
    });
  });

  describe('a bridge seeded from a scan whose fetch failed', () => {
    // `ensureCache` seeds `entry.fetchedAt` from the bridge FILE on cold start
    // (`fleet.ts:3026-3038`), before any live scan has run — the same
    // `fetch_failed` rule as `refresh`'s, applied to the seed. A seed that
    // skipped the check would date a fetch the bridged scan never made, which
    // is the exact false claim `readRefAge` exists to refuse.
    let fleet, seeded;

    before(async () => {
      seeded = makeRepo();
      plantBridge(seeded.repo, {
        head: '91a9a60',
        read_ref: 'ee199aa',
        local_head: '91a9a60',
        fetch_failed: true,
      });
      // A scan that cannot succeed: whatever the endpoint answers came from the
      // planted bridge alone, never from a live read landing in the meantime.
      // `serve()` is not used here because it plants its OWN bridge, which
      // would overwrite the `fetch_failed: true` pulse planted above.
      const server = await startServer(seeded.repo, { PLOT_SCRIPTS_DIR: broken.dir });
      try {
        fleet = await fetchFleet(server.port);
      } finally {
        await server.stop();
      }
    });

    after(() => seeded?.cleanup());

    it('gives readRefAge as null rather than dating a fetch that failed', () => {
      assert.equal(fleet.readRefAge, null);
      assert.equal(fleet.ageSeconds, 0);
    });
  });

  describe('a scan whose reading reports fetch_failed leaves the age at the previous good fetch', () => {
    // THE OTHER HALF of the rule above, on the LIVE path rather than the seed:
    // `refresh` must not move `entry.fetchedAt` forward when the scan it just
    // ran reports `fetch_failed: true`, even though the scan succeeded and
    // produced a pulse. The board writes no bridge itself (`fleet.ts:2900`),
    // so "a good fetch already happened" is seeded the same way
    // `bridge.test.mjs` seeds it — a planted bridge with no `fetch_failed`,
    // standing in for a real `plot-fleetd` pulse. The live scan this server
    // then runs is the one pointed at `makeFetchFailedScan()`, and the
    // assertion is that it must not move `fetchedAt` forward.
    let restarted, seededAt, failing, fleet;

    before(async () => {
      restarted = makeRepo();
      seededAt = Date.now() - 10_000;
      plantBridge(restarted.repo, { head: '91a9a60', read_ref: 'ee199aa', local_head: '91a9a60' });
      const bridgeFile = path.join(restarted.repo, BRIDGE);
      const planted = JSON.parse(fs.readFileSync(bridgeFile, 'utf8'));
      planted.at = seededAt;
      fs.writeFileSync(bridgeFile, JSON.stringify(planted), 'utf8');

      failing = makeFetchFailedScan();
      // The scan runs in process now: an unreachable remote makes its own fetch fail.
      execFileSync('git', ['remote', 'set-url', 'origin', path.join(restarted.tmp, 'no-such-remote.git')], { cwd: restarted.repo, stdio: 'ignore' });
      const server = await startServer(restarted.repo, { PLOT_SCRIPTS_DIR: failing.dir });
      try {
        // The FIRST request is what triggers `ensureCache`, which seeds from
        // the bridge synchronously and fires the live scan in the background
        // (`void refresh(...)`, never awaited) — so this first response still
        // reads the seed, before the live scan has had any chance to run.
        await fetchFleet(server.port);
        // Wait past one refresh tick so the live (failing) scan this server
        // just started has had the chance to finish and — if the code were
        // wrong — overwrite `fetchedAt`.
        await new Promise((r) => setTimeout(r, 6_000));
        fleet = await fetchFleet(server.port);
      } finally {
        await server.stop();
      }
    });

    after(() => {
      failing?.cleanup();
      restarted?.cleanup();
    });

    it('still dates the age from the seeded fetch, not from the one that just ran', () => {
      // A wrong implementation resets `fetchedAt` to "now" on every scan
      // regardless of `fetch_failed`, which would report an age near 0 here.
      // The right one leaves it dating the seeded fetch from ~10 seconds ago.
      assert.equal(typeof fleet.readRefAge, 'number');
      assert.ok(
        fleet.readRefAge >= 5,
        `readRefAge (${fleet.readRefAge}s) should still date the seeded fetch, not the failing scan`,
      );
    });
  });
});
