import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startBoard, type BoardRun } from './board-driver.js';
import { between, treeOf } from './census-session.js';
import { CENSUS_ROWS, recordCount, rowTitle } from './census-rows.js';
import type { CensusFixture } from './census-report.js';
import { buildFleetdEntry, type FleetdEntry } from './fleetd-entry-build.js';
import { startFleetd, type FleetdRun } from './fleetd-driver.js';
import { buildSandbox, type Sandbox } from './sandbox.js';
import { censusGate, findStrace } from './strace-run.js';
import type { ExecRecord, StraceCensus } from './strace-execs.js';

// The board over a wall-clock window (S1, S2, S3, and P3 for the board). The
// board's pulse takes no injected clock (`startPulse(clockSystem(), …)`), so
// each scenario counts the board's tree between two marks and reports it per
// minute. `PLOT_CENSUS_WINDOW_MS` sets the window; 60 s by default.

const gate = censusGate({ stracePath: findStrace(process.env['PATH'] ?? ''), platform: process.platform });

const WINDOW_MS = Number(process.env['PLOT_CENSUS_WINDOW_MS'] ?? '60000');
/** The time a scenario lets the board settle after its warm read, before the window opens. */
const SETTLE_MS = 10_000;
/**
 * How long the board must have no child process before a no-client window
 * opens. The warm read's scan is the board's last child where no client is
 * attached, and on Bitbucket it outran `SETTLE_MS`.
 */
const QUIET_MS = 3_000;
/** The longest a no-client scenario waits for the warm read to end. */
const QUIET_TIMEOUT_MS = 180_000;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const basename = (path: string): string => path.split('/').pop() ?? path;

type Window = { census: StraceCensus; board: number; execs: ExecRecord[] };

/**
 * Starts the board traced, runs `before` (the scenario's setup after the warm
 * read), settles, and returns the board tree's images inside the window. With
 * `quiet`, the window opens only after the board has had no child process for
 * `QUIET_MS`, so a warm read still running is not counted as idle work; a
 * board that never goes quiet within `QUIET_TIMEOUT_MS` is measured anyway.
 */
const measureBoard = async (
  box: Sandbox,
  before: (board: BoardRun) => Promise<() => Promise<void>>,
  options: { quiet: boolean },
): Promise<Window> => {
  const board = await startBoard(box, { trace: true });
  let census: StraceCensus | null = null;
  let after: () => Promise<void> = async () => undefined;
  try {
    expect(await board.read()).toBe(200);
    after = await before(board);
    if (options.quiet && !(await board.quiet(QUIET_MS, QUIET_TIMEOUT_MS))) {
      console.warn(`process census: the board did not go quiet within ${QUIET_TIMEOUT_MS} ms`);
    }
    await wait(SETTLE_MS);
    await board.mark('w0');
    await wait(WINDOW_MS);
    await board.mark('w1');
  } finally {
    await after();
    census = (await board.stop()).census;
  }
  if (census === null) throw new Error('process census: the board run was not traced');
  return { census, board: board.pid, execs: treeOf(census, between(census.execs, 'w0', 'w1'), board.pid) };
};

const perMinute = (n: number): number => (n * 60_000) / WINDOW_MS;

const isFixedAnswer = (e: ExecRecord): boolean =>
  (basename(e.path) === 'git' &&
    e.argv.includes('rev-parse') &&
    (e.argv.includes('--show-toplevel') || e.argv.includes('--git-common-dir'))) ||
  (basename(e.path) === 'bash' && e.argv.some((a) => a.endsWith('/plot-host.sh')) && e.argv.includes('backend'));

describe.skipIf(gate.kind !== 'run').each<CensusFixture>([
  { host: 'github', desks: 0, openPrs: 5 },
  { host: 'bitbucket', desks: 0, openPrs: 5 },
])('an idle board with no tab and no fleetd on $host (S1)', (fixture) => {
  let box: Sandbox;
  let window: Window;

  beforeAll(async () => {
    box = await buildSandbox(fixture);
    window = await measureBoard(box, async () => async () => undefined, { quiet: true });
  }, 420_000);

  afterAll(async () => {
    await box?.remove();
  });

  it('traces the board through its window', () => {
    expect(window.census.execs.some((e) => e.pid === window.board)).toBe(true);
  });

  it(rowTitle(CENSUS_ROWS.S1, fixture), () => {
    recordCount(CENSUS_ROWS.S1, fixture, perMinute(window.execs.length), window.execs);
    expect(window.execs).toHaveLength(0);
  });

});

describe.skipIf(gate.kind !== 'run')('an idle board whose one page turned hidden (S2)', () => {
  const fixture: CensusFixture = { host: 'github', desks: 0, openPrs: 5 };
  let box: Sandbox;
  let window: Window;

  beforeAll(async () => {
    box = await buildSandbox(fixture);
    // THE PAGE'S PROTOCOL, NOT A BROWSER: a visible page holds `/api/events`
    // open, and a hidden one closes it (no-tab-no-pulse, slice Hidden page).
    // The page's own hide behaviour is the board's browser tests' subject.
    window = await measureBoard(box, async (board) => {
      const page = await board.attach();
      await wait(SETTLE_MS);
      await page.detach();
      return async () => undefined;
    }, { quiet: true });
  }, 420_000);

  afterAll(async () => {
    await box?.remove();
  });

  it(rowTitle(CENSUS_ROWS.S2, fixture), () => {
    recordCount(CENSUS_ROWS.S2, fixture, perMinute(window.execs.length), window.execs);
    expect(window.execs).toHaveLength(0);
  });
});

describe.skipIf(gate.kind !== 'run')('an idle board with one visible page and fleetd running (S3)', () => {
  const fixture: CensusFixture = { host: 'github', desks: 0, openPrs: 5 };
  let box: Sandbox;
  let entry: FleetdEntry;
  let fleetd: FleetdRun | undefined;
  let window: Window;

  beforeAll(async () => {
    box = await buildSandbox(fixture);
    entry = await buildFleetdEntry();
    // fleetd UNTRACED, on the system clock: S3 counts the board's tree, and
    // S4 counts fleetd's.
    fleetd = startFleetd(entry, box, { trace: false, clock: 'system' });
    await fleetd.session.waitFor(/^plot-fleetd: supervising /, 60_000);
    window = await measureBoard(box, async (board) => {
      const page = await board.attach();
      return () => page.detach();
    }, { quiet: false });
  }, 300_000);

  afterAll(async () => {
    await fleetd?.stop();
    entry?.remove();
    await box?.remove();
  });

  it.fails(rowTitle(CENSUS_ROWS.S3, fixture), () => {
    recordCount(CENSUS_ROWS.S3, fixture, perMinute(window.execs.length), window.execs);
    expect(window.execs).toHaveLength(0);
  });

  // P3 FOR THE BOARD IS COUNTED HERE, where the board's pulse runs. With no
  // event stream attached the board runs no pass at all (no-tab-no-pulse,
  // slice Server pulse), so S1's window holds no pass after the first, and a
  // zero there says nothing about P3. Here the attached page starts the pulse:
  // a scan every 5 s and a PR beat every 60 s inside the window.
  it(`${rowTitle(CENSUS_ROWS.P3, fixture)} - the board`, () => {
    const direct = window.execs.filter((e) => e.ppid === window.board && isFixedAnswer(e));
    recordCount({ ...CENSUS_ROWS.P3, id: 'P3-board', unit: 'execve per minute' }, fixture, perMinute(direct.length), direct);
    expect(direct).toHaveLength(0);
  });
});
