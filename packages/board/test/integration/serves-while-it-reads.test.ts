import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
// The framework-agnostic harness: spawn the built artifact — a real server with
// the real `plot-config.sh` / `plot-plan-meta.sh` helpers behind it. The
// property under test is about the EVENT LOOP, so a stubbed server would
// measure nothing: what is asserted is that a process which is busy reading an
// estate can still answer.
import { startServer, fetchRaw, fetchBoard, makeRepo, rmTree } from '../helpers.mjs';

/**
 * THE BOARD ANSWERS WHILE IT READS — the runtime half of the Proving slice.
 *
 * `2026-08-31-the-read-path-stops-spawning.md`, `Done when` items 2 and 3. The
 * static gate beside this file (`test/unit/a-read-route-spawns-nothing.test.ts`)
 * proves the SOURCE cannot reach a synchronous spawn on a request's stack; this
 * proves the BEHAVIOUR that absence buys, and neither substitutes for the other.
 *
 * ## What the defect looked like from outside
 *
 * A static file timed out at 15 s. Not slowly served — timed out, on a board
 * whose own `/api/board` was taking 0.77 s warm. That gap is the whole
 * signature: a slow computation does not stop `/` from being served, and a
 * blocked event loop does. `sample <pid> 5` named the cause in five seconds
 * where four readings of the source had named four wrong ones.
 *
 * ## Why it is asserted back to back and not on a timer
 *
 * The plan says so, and the reason is that a timer measures the wrong thing.
 * *"`/` is fast"* is true of a board with nothing to do; the property is *"`/`
 * is fast WHILE `/api/board` is in flight"*, which is only visible if the two
 * overlap. So the API requests are started and deliberately not awaited, `/` is
 * requested in the same tick, and its latency is taken before anything is
 * joined.
 *
 * **Both read routes, together.** `/api/fleet` reads a different cache from
 * `/api/board` and was migrated by a different wave; putting both in flight is
 * what makes this a test of the read PATH rather than of one route.
 *
 * ## The threshold, and why it is not single-digit milliseconds
 *
 * The plan's phrasing is *single-digit ms*, and that is the right target for a
 * developer's machine. The assertion here is **250 ms**, and the gap is not a
 * softened requirement — it is what a shared CI runner can promise. This repo
 * has measured its own contention: two agents running `test:e2e` produced 53
 * concurrent `node --test` processes and load average 8.69, and several suites
 * run at once here by design.
 *
 * What the number has to separate is a served response from a BLOCKED one, and
 * the two are three orders of magnitude apart: 15 000 ms against single digits.
 * A threshold anywhere in that gap catches the defect; one tight enough to also
 * measure performance would fail on a loaded runner and be skipped within a
 * month, which is the failure mode `no-network.test.ts` names about latency
 * thresholds generally — *contention flatters and spoils a number*.
 *
 * So the number is a floor under *the loop was not blocked*, and the profile is
 * reported in the plan rather than asserted here.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

/**
 * What `/` must beat while both read routes are in flight.
 *
 * Chosen to sit in the gap between *served* and *blocked* rather than at the
 * edge of *fast*. See the docblock above.
 */
const SERVED_WHILE_BUSY_MS = 250;

const APPROVED_PLAN = `# A plan added after the first read

## Status

- **Phase:** Approved
- **Type:** feature

## Changelog

- Added while the server was already running.
`;

describe('the board serves while it reads', () => {
  let server: { port: number; kill: () => void };

  beforeAll(async () => {
    server = await startServer(FIXTURE);
    // One warm request before measuring. The caches this slice inherits are
    // filled on first use, and the FIRST request to a cold board legitimately
    // pays for them — asserting against that would measure cache priming and
    // call it a blocked loop.
    await fetchBoard(server.port);
  }, 30_000);

  /**
   * Every request this file starts is joined before the server is killed.
   *
   * Both tests deliberately leave requests IN FLIGHT — that is the property —
   * and a request outliving its server resolves as `ECONNRESET` after the test
   * that owns it has finished, so vitest reports it as an unhandled rejection in
   * whatever ran next. Observed once here on a cold first run, which is exactly
   * how a test like this becomes known as flaky rather than as wrong.
   */
  const started: Promise<unknown>[] = [];
  const inFlight = (pathname: string): Promise<{ status: number; body: string }> => {
    const request = fetchRaw(server.port, pathname);
    started.push(request.catch(() => undefined));
    return request;
  };

  afterAll(async () => {
    await Promise.all(started);
    server?.kill();
  });

  it('answers `/` in a few milliseconds while both read routes are in flight', async () => {
    // IN FLIGHT MEANS NOT AWAITED. Starting the two API reads and awaiting them
    // before touching `/` would assert nothing at all: a board serves fine once
    // it is idle, and that is the state the defect never reached.
    const board = inFlight('/api/board');
    const fleet = inFlight('/api/fleet');

    const at = performance.now();
    const index = await fetchRaw(server.port, '/');
    const elapsed = performance.now() - at;

    expect(index.status, '`/` did not serve at all while the read routes ran').toBe(200);
    expect(
      elapsed,
      `\`/\` took ${Math.round(elapsed)} ms while /api/board and /api/fleet were in `
      + 'flight. A synchronous spawn cannot yield, so the event loop serves NOTHING '
      + 'while one runs — this is how the defect presented on 2026-08-31, as a '
      + 'static file timing out at 15 s beside a 0.77 s API call',
    ).toBeLessThan(SERVED_WHILE_BUSY_MS);

    // Joined at the end rather than abandoned: an unhandled rejection from a
    // dangling request would fail a LATER test, in a file that has no idea why.
    // Both are also asserted to have answered, because "`/` was fast because the
    // API requests never really started" is the way this test could pass while
    // measuring nothing.
    const [boardRes, fleetRes] = await Promise.all([board, fleet]);
    expect(boardRes.status, '/api/board did not answer').toBe(200);
    expect(fleetRes.status, '/api/fleet did not answer').toBe(200);
  }, 60_000);

  it('serves `/` repeatedly while a read route runs, not once by luck', async () => {
    // ONE FAST RESPONSE CAN BE A SCHEDULING ACCIDENT — the request landing in a
    // window between two spawns. A blocked loop cannot answer five in a row, so
    // the repetition is what turns a timing observation into a property.
    const running = [inFlight('/api/board'), inFlight('/api/fleet')];

    const timings: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const at = performance.now();
      const res = await fetchRaw(server.port, '/');
      timings.push(performance.now() - at);
      expect(res.status).toBe(200);
    }

    const worst = Math.max(...timings);
    expect(
      worst,
      `the slowest of five \`/\` requests took ${Math.round(worst)} ms while the read `
      + `routes ran (all: ${timings.map((t) => Math.round(t)).join(', ')} ms)`,
    ).toBeLessThan(SERVED_WHILE_BUSY_MS);

    await Promise.all(running);
  }, 60_000);
});

/**
 * THE FRESHNESS ARM, and it is not a separate subject.
 *
 * The plan names it as a `Done when` for a specific reason: *the tempting wrong
 * fix for latency is a cache that freezes content*. Every assertion above gets
 * FASTER if the board stops reading the estate, so a board that answered from a
 * frozen snapshot would pass all of them — and be worse than the one this slice
 * replaced. A fast board showing last hour's plans is worse than a slow one
 * showing this minute's.
 *
 * So the two arms are load-bearing together: the first says the loop is not
 * blocked, this says nothing was bought by lying.
 *
 * Its own repository, because it writes a plan and the tiny-garden fixture is
 * committed source.
 */
describe('a plan added since the last request still appears', () => {
  let repo: string;
  let server: { port: number; kill: () => void };

  beforeAll(async () => {
    repo = makeRepo({ plans: [] });
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '## Plot Config\n\n- **Plan directory:** docs/plans/\n', 'utf8');
    server = await startServer(repo);
  }, 30_000);

  afterAll(() => {
    server?.kill();
    if (repo) rmTree(repo);
  });

  it('reads the estate again rather than answering from a frozen snapshot', async () => {
    const before = await fetchBoard(server.port);
    const slugsBefore = before.columns.flatMap((c: any) => c.cards.map((x: any) => x.slug));
    expect(slugsBefore, 'the fixture repo should start with no plans').not.toContain('added-mid-run');

    fs.writeFileSync(
      path.join(repo, 'docs/plans/2026-09-01-added-mid-run.md'),
      APPROVED_PLAN,
      'utf8',
    );

    const after = await fetchBoard(server.port);
    const slugsAfter = after.columns.flatMap((c: any) => c.cards.map((x: any) => x.slug));
    expect(
      slugsAfter,
      'a plan written after the first request is missing from the second. The board '
      + 'is answering from a cache of the estate\'s CONTENTS — which is the wrong '
      + 'fix for latency this plan names: a fast board showing last hour\'s plans is '
      + 'worse than a slow one showing this minute\'s',
    ).toContain('added-mid-run');
  }, 60_000);
});
