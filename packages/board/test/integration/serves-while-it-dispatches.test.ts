import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The same framework-agnostic harness the read-path arm uses: spawn the built
// artifact, a real server. The property under test is about the EVENT LOOP, so
// a stubbed server would measure nothing.
import { startServer, fetchRaw, fetchBoard, makeRepo, request, rmTree } from '../helpers.mjs';

/**
 * THE BOARD ANSWERS WHILE IT DISPATCHES — the write-path twin of
 * `serves-while-it-reads.test.ts`.
 *
 * `2026-09-26-a-dispatch-does-not-hold-the-loop.md`, `Done when` item 1.
 * `POST /api/dispatch` ran the `Implement command` through `spawnSync` under a
 * five-minute bound, on the request's stack of a single-threaded server.
 * Measured 2026-09-26: the port holder sat at **0.0% CPU** while `/api/board`
 * timed out and the page told the operator to restart a live server.
 *
 * ## Why this file exists beside the read-path one
 *
 * The static gate (`test/unit/a-read-route-spawns-nothing.test.ts`) walks from
 * the three READ entry points and excludes the write routes deliberately — a
 * recorded decision, priced at *"a write route blocking for two seconds is a
 * button that feels slow to one person"*. That price is wrong by two orders of
 * magnitude for this one call, and the plan argues the measurement rather than
 * rewriting the gate. So the write route gets a RUNTIME assertion here, and the
 * gate's population is left exactly as it was.
 *
 * ## The assertion is SCALING, not a millisecond threshold, and that is measured
 *
 * The read-path arm asserts `/` under a flat 250 ms. **That threshold is
 * unreachable on this route, for a reason that is not this plan's to fix.**
 * `handleDispatch` calls `readConfig` for the `Implement command`, and
 * `board.ts:368` is a SYNCHRONOUS `plot-config.sh` spawn whose own docblock
 * names itself *"THE ONE BLOCKING READ THIS FILE MAKES"* and names the
 * migration that owns it. Measured on this machine, it costs a few hundred ms —
 * so a flat 250 ms bound here would fail on a blocker this branch is scoped out
 * of touching, and would read as *the dispatch still blocks* when it does not.
 *
 * What separates the defect from that residue is **whether the wait grows with
 * the child**. Measured 2026-09-26, same machine, same 6 s implement stub:
 *
 * ```
 *                          worst `/`      POST
 *   main (spawnSync)          7060 ms    9184 ms
 *   this branch (spawn)        358 ms    2496 ms
 * ```
 *
 * The blocked loop tracked the child exactly — 6 s of sleep, 7 s of silence.
 * What is left does not move when the stub's sleep changes from 2 s to 6 s. So
 * the bound asserted is a FRACTION of the child's own duration: a synchronous
 * wait cannot come in under it, and the config spawn does not grow into it.
 */

/** How long the implement stub sleeps. The clock the assertions are scaled to. */
const STUB_SLEEP_MS = 6_000;

/**
 * What `/` must beat while the implement runs.
 *
 * A third of the child's life. The synchronous route scored 7060 ms against
 * this 2000 ms — it cannot pass by luck — and the branch scored 358 ms, so the
 * margin absorbs the config spawn and a loaded runner both. Deliberately not
 * tighter: this repo has measured its own contention, and a number that also
 * measures performance fails on a shared runner and is skipped within a month.
 */
const SERVED_WHILE_BUSY_MS = STUB_SLEEP_MS / 3;

/**
 * Wait until `read()` returns truthy, or give up.
 *
 * The response no longer means the work happened, so state is polled rather
 * than slept for — raising a sleep would trade a race for a slower race.
 */
const until = async (
  read: () => Promise<unknown>,
  what: string,
  timeoutMs = 30_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await read()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

const APPROVED = `# Ship the widget

## Status

- **Phase:** Approved
- **Type:** feature

## Changelog

- The plan the dispatch under test names.
`;

describe('the board serves while a dispatch runs the implement', () => {
  let repo: string;
  let stubDir: string;
  let server: { port: number; kill: () => void };

  beforeAll(async () => {
    repo = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-slow-implement-'));
    // A SLOW implement, which is the whole fixture. It sleeps well past the
    // threshold and then exits 0, so the run is a success that simply takes
    // time — the ordinary case, not a failure case. A fast stub would finish
    // before anything is measured and the test would pass on the old code.
    const bin = path.join(stubDir, 'slow-implement.sh');
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env bash\nsleep ${STUB_SLEEP_MS / 1000}\necho "stub implement done: $*"\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(repo, 'CLAUDE.md'),
      `## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Implement command:** ${bin}\n`,
      'utf8',
    );
    server = await startServer(repo);
    // Warm the board AND `/` before measuring. The caches are filled on first
    // use and the first request legitimately pays for them; asserting against
    // that would measure cache priming and call it a blocked loop.
    await fetchBoard(server.port);
    for (let i = 0; i < 3; i += 1) await fetchRaw(server.port, '/');
  }, 60_000);

  const started: Promise<unknown>[] = [];

  afterAll(async () => {
    // Joined rather than abandoned: a request outliving its server resolves as
    // ECONNRESET and vitest reports it against whatever ran next, which is how
    // a test like this becomes known as flaky rather than as wrong.
    await Promise.all(started);
    server?.kill();
    if (stubDir) rmTree(stubDir);
    if (repo) rmTree(repo);
  }, 60_000);

  it('answers `/` while a dispatch is in flight, and answers the POST before the child exits', async () => {
    // IN FLIGHT MEANS NOT AWAITED. Awaiting the POST first would assert that a
    // board serves once it is idle, which is the state the defect never reached.
    const at = performance.now();
    const dispatch = request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    started.push(dispatch.catch(() => undefined));

    const probedAt = performance.now();
    const index = await fetchRaw(server.port, '/');
    const elapsed = performance.now() - probedAt;

    expect(index.status, '`/` did not serve at all while a dispatch ran').toBe(200);
    expect(
      elapsed,
      `\`/\` took ${Math.round(elapsed)} ms while a dispatch was in flight with a `
      + `${STUB_SLEEP_MS} ms implement. A synchronous spawn cannot yield, so the event `
      + 'loop serves NOTHING while one runs — measured at 7060 ms on the code this '
      + 'replaced, against 358 ms here',
    ).toBeLessThan(SERVED_WHILE_BUSY_MS);

    // THE POST IS THE REQUEST WHOSE STACK THE SPAWN USED TO SIT ON, so its own
    // latency is the direct reading. It answered in 9184 ms against a 6 s child
    // before; it must now come back well inside the child's life.
    const res = await dispatch;
    const postTook = performance.now() - at;
    expect(res.status, 'the dispatch was not accepted').toBe(202);
    expect(
      postTook,
      `the POST took ${Math.round(postTook)} ms against a ${STUB_SLEEP_MS} ms implement. `
      + 'The 202 must be written when the child STARTS, not when it exits',
    ).toBeLessThan(STUB_SLEEP_MS);

    // The route the operator could not load, asserted to ANSWER rather than to
    // be fast: it reads the estate, so its latency is the machine's business.
    // Measured with no dispatch at all on this machine, `/api/board` took
    // 1686-5127 ms — which is why only its status is asserted here.
    const board = await fetchRaw(server.port, '/api/board');
    expect(board.status, '/api/board did not answer while a dispatch ran').toBe(200);
  }, 120_000);

  it('serves `/` repeatedly while the implement runs, not once by luck', async () => {
    // ONE FAST RESPONSE CAN BE A SCHEDULING ACCIDENT — the request landing in a
    // window between two blocking calls. A blocked loop cannot answer five in a
    // row, which is what turns a timing observation into a property.
    //
    // A SECOND DISPATCH OF THE SAME SLUG, once the first test's child has
    // exited. `implementRunning` refuses an overlapping implement — measured
    // here as a 409 when this test ran straight after the first — so the wait is
    // for the LOCK to clear, read through the status route rather than slept
    // through. That refusal is itself asserted in `dispatch.test.mjs`; here it
    // would only measure the refusal path instead of the loop.
    await until(async () => {
      const res = await request(server.port, {
        method: 'GET',
        path: '/api/implement/ship-the-widget',
      });
      return JSON.parse(res.body).state !== 'running';
    }, 'the first implement to finish');

    const dispatch = request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    started.push(dispatch.catch(() => undefined));
    expect((await dispatch).status, 'the second dispatch was refused').toBe(202);

    const timings: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const at = performance.now();
      const res = await fetchRaw(server.port, '/');
      timings.push(performance.now() - at);
      expect(res.status).toBe(200);
      // Spread across the child's life rather than fired back to back, so the
      // samples cover the window the loop used to be held for.
      await new Promise((r) => setTimeout(r, 250));
    }

    const worst = Math.max(...timings);
    expect(
      worst,
      `the slowest of five \`/\` requests took ${Math.round(worst)} ms while the `
      + `implement ran (all: ${timings.map((t) => Math.round(t)).join(', ')} ms)`,
    ).toBeLessThan(SERVED_WHILE_BUSY_MS);
  }, 120_000);
});
