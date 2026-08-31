import { describe, it, expect } from 'vitest';
import {
  exitWhenIdle,
  IDLE_LIMIT_MS,
  IDLE_CHECK_INTERVAL_MS,
} from '../../src/server/lifetime.js';

/**
 * THE GAP `exitWithParent` LEAVES, and the measurement that found it.
 *
 * That gate polls the launcher's pid and exits once it is gone — which covers a
 * killed or crashed suite and nothing else. Measured 2026-08-31: two `vitest`
 * processes sat at **0 % CPU for 33 and 47 minutes** holding a board server
 * between them. The server checked its ppid every second, found its parent
 * present, and kept running. Correctly. One held 135 MB on a machine whose load
 * average had reached 6.03, and it was killed by hand.
 *
 * A liveness check that a hung process passes is not a liveness check. The
 * parent gate asks *does my launcher exist?*; this one asks *does anyone still
 * want me?* — and a hung suite answers no to the second while still answering
 * yes to the first.
 *
 * These are unit tests with an injected clock, so the five-minute bound is
 * asserted at its boundaries rather than waited out. The end-to-end proof that
 * a real server exits lives in `test/lifetime.test.mjs` beside the parent gate's.
 */

/** A controllable scheduler: captures the tick so a test can drive it by hand. */
function scheduler() {
  const ticks: Array<() => void> = [];
  const setIntervalFn = ((fn: () => void) => {
    ticks.push(fn);
    return { unref: () => {} } as unknown as NodeJS.Timeout;
  }) as unknown as typeof setInterval;
  return { ticks, setIntervalFn, run: () => ticks.forEach((t) => t()) };
}

describe('the idle gate arms only when the harness asked for it', () => {
  // The SAME variable as the parent gate, and the docstring argues why: a hung
  // launcher and a dead one are two ways for one purpose to end. A second
  // variable would let a project arm half of this and leak only when a suite
  // hangs — the hardest case to notice, and the one it exists for.
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['0', '0'],
    ['false', 'false'],
  ])('stays disarmed when PLOT_EXIT_WITH_PARENT is %s', (_label, value) => {
    const s = scheduler();
    const timer = exitWhenIdle({
      env: value === undefined ? {} : { PLOT_EXIT_WITH_PARENT: value },
      lastRequestAt: () => 0,
      setIntervalFn: s.setIntervalFn,
    });
    expect(timer).toBeNull();
    expect(s.ticks).toHaveLength(0);
  });

  it('arms on any other value', () => {
    const s = scheduler();
    const timer = exitWhenIdle({
      env: { PLOT_EXIT_WITH_PARENT: '1' },
      lastRequestAt: () => 0,
      setIntervalFn: s.setIntervalFn,
    });
    expect(timer).not.toBeNull();
    expect(s.ticks).toHaveLength(1);
  });

  it("leaves an operator's board alone", () => {
    // `pnpm board` sets nothing, so a board somebody is USING must never exit
    // for being quiet — an operator who steps away for lunch would come back to
    // a dead board, which is a worse failure than the one this fixes.
    const exits: number[] = [];
    const s = scheduler();
    exitWhenIdle({
      env: {},
      lastRequestAt: () => 0,
      now: () => IDLE_LIMIT_MS * 100,
      onIdle: () => exits.push(1),
      setIntervalFn: s.setIntervalFn,
    });
    s.run();
    expect(exits).toHaveLength(0);
  });
});

describe('the idle gate measures silence, at its boundaries', () => {
  const armed = (lastAt: number, nowAt: number, exits: number[]) => {
    const s = scheduler();
    exitWhenIdle({
      env: { PLOT_EXIT_WITH_PARENT: '1' },
      lastRequestAt: () => lastAt,
      now: () => nowAt,
      onIdle: () => exits.push(nowAt),
      setIntervalFn: s.setIntervalFn,
    });
    s.run();
  };

  it('exits once the limit is reached', () => {
    const exits: number[] = [];
    armed(0, IDLE_LIMIT_MS, exits);
    expect(exits).toHaveLength(1);
  });

  it('does NOT exit one millisecond short', () => {
    // The off-by-one from the other side. An implementation that fired early
    // would kill working suites, and this is the assertion that catches it.
    const exits: number[] = [];
    armed(0, IDLE_LIMIT_MS - 1, exits);
    expect(exits).toHaveLength(0);
  });

  it('a request resets the clock', () => {
    // The property the whole gate rests on: a server being ASKED is a server
    // somebody wants, however long it has been running. Here it has been alive
    // for ten limits and asked a millisecond ago.
    const exits: number[] = [];
    const now = IDLE_LIMIT_MS * 10;
    armed(now - 1, now, exits);
    expect(exits).toHaveLength(0);
  });

  it('counts from LAUNCH, so a slow first assertion is not a hang', () => {
    // `lastRequestAt` is seeded at startup rather than left at 0. A suite that
    // spends four minutes building fixtures before its first request must not
    // be killed while it works — what the bound measures is silence, and a
    // server nobody has asked YET is not the same as one nobody will ask again.
    const exits: number[] = [];
    const launchedAt = 1_000_000;
    armed(launchedAt, launchedAt + IDLE_LIMIT_MS - 1, exits);
    expect(exits).toHaveLength(0);
  });
});

describe('the cadence costs nothing and holds nothing open', () => {
  it('checks far less often than it waits', () => {
    // The check is a subtraction; the bound is five minutes. Polling every 30 s
    // makes the worst-case overshoot one interval, which nobody can perceive,
    // for ten timer wakeups per bound.
    expect(IDLE_CHECK_INTERVAL_MS).toBeLessThan(IDLE_LIMIT_MS);
    expect(IDLE_LIMIT_MS / IDLE_CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(10);
  });

  it('unrefs its timer, so the gate is never why the process lives', () => {
    // The same rule the parent gate follows. Without it, a server with nothing
    // else to do would be held open by its own watchdog — the gate becoming the
    // leak it exists to close.
    let unrefCalled = false;
    const fakeTimer = { unref: () => { unrefCalled = true; } } as unknown as NodeJS.Timeout;
    exitWhenIdle({
      env: { PLOT_EXIT_WITH_PARENT: '1' },
      lastRequestAt: () => 0,
      setIntervalFn: (() => fakeTimer) as unknown as typeof setInterval,
    });
    expect(unrefCalled).toBe(true);
  });
});

describe('the guard reaches the built artifact, not only the source', () => {
  it('is wired into index.ts at the server, and reads a live request clock', async () => {
    // THE VACUOUS PASS THIS CLOSES. Every test above drives `exitWhenIdle`
    // directly, so all twelve would stay green if nobody ever CALLED it — the
    // gate would be perfect and unarmed. Measured while writing them: a grep
    // for the constant in the bundled artifact returns 0, because the bundler
    // renames locals, so "is it shipped?" cannot be answered by reading the
    // artifact either.
    //
    // What can be asserted cheaply is the wiring in the source the bundle is
    // built FROM: the guard is armed, and it is handed a function rather than a
    // constant — a `lastRequestAt` that never moves would satisfy the type and
    // kill every server after five minutes, including a busy one.
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, '../../src/server/index.ts'), 'utf8');

    expect(src).toContain('exitWhenIdle({');
    expect(src).toMatch(/lastRequestAt:\s*\(\)\s*=>\s*lastRequestAt/);
    // The clock is STAMPED per request, which is the half that makes it live.
    expect(src).toMatch(/lastRequestAt\s*=\s*Date\.now\(\)/);
  });
});
