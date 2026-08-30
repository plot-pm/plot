import { chromium, type Browser, type Page } from 'playwright';
import { startMockBoard, type MockBoard } from './mock-board.js';
import type { Scenario, ScenarioName } from './states.js';

export { startMockBoard, type MockBoard } from './mock-board.js';
export { SCENARIOS, scenario, type Scenario, type ScenarioName } from './states.js';
export { board, card, column, fleet, row, wave, generatedAt } from './build.js';

/**
 * A browser and a mock, opened together and closed together.
 *
 * A test says which state it wants and gets a page showing it:
 *
 * ```ts
 * const cat = await openCatalogue();
 * afterAll(() => cat.close());
 * const page = await cat.open('a-done-wave');
 * ```
 *
 * ONE browser and ONE mock per file, many pages — the same lifetime the suite's
 * existing `beforeAll`/`afterAll` pairs already use, so a migrating test keeps
 * its shape. What changes is that `startServer(FIXTURE)` no longer appears.
 */
export interface Catalogue {
  /** The mock, if a test needs its port or wants to `serve()` a different state mid-test. */
  mock: MockBoard;
  /** The browser, for a test that needs a context of its own. */
  browser: Browser;
  /**
   * Open a page showing a named state.
   *
   * `tab` selects the board's tab through the query string the client actually
   * reads, so routing is exercised rather than simulated. `viewport` matters to
   * layout assertions and is left to the caller for that reason.
   */
  open: (
    name: ScenarioName,
    opts?: {
      over?: Partial<Scenario>;
      tab?: 'agents' | 'board';
      viewport?: { width: number; height: number };
    },
  ) => Promise<Page>;
  /** Close the browser and stop the mock. */
  close: () => Promise<void>;
}

const DEFAULT_VIEWPORT = { width: 1400, height: 1200 };

/**
 * Launch a browser and a mock board.
 *
 * The mock starts on `an-empty-estate` and every `open()` re-serves the state it
 * was asked for, so a file's first `open()` is not privileged over its later
 * ones — a mock that kept its start state would make the first call cheap and
 * every subsequent one subtly different.
 */
export const openCatalogue = async (): Promise<Catalogue> => {
  const [browser, mock] = await Promise.all([
    chromium.launch(),
    startMockBoard('an-empty-estate'),
  ]);

  const open: Catalogue['open'] = async (name, opts = {}) => {
    mock.serve(name, opts.over);
    const context = await browser.newContext({ viewport: opts.viewport ?? DEFAULT_VIEWPORT });
    const page = await context.newPage();
    const tab = opts.tab ? `?tab=${opts.tab}` : '';
    await page.goto(`${mock.baseURL}${tab}`);
    return page;
  };

  return {
    mock,
    browser,
    open,
    close: async () => {
      await browser.close();
      await mock.stop();
    },
  };
};
