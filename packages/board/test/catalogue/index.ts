import { chromium, type Browser, type Page, type Route } from 'playwright';
import { startMockBoard, type MockBoard } from './mock-board.js';
import type { Scenario, ScenarioName } from './states.js';

export { startMockBoard, type MockBoard } from './mock-board.js';
export { SCENARIOS, scenario, type Scenario, type ScenarioName } from './states.js';
export { agent, board, card, column, fleet, row, sprint, story, wave, generatedAt } from './build.js';

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
      /**
       * The context's `prefers-reduced-motion`, for a test whose subject is an
       * animation. `activity-mark.browser.test.ts` asserts both halves — that a
       * mark travels, and that it does not when motion is reduced — so the
       * setting has to be a page-open parameter rather than a fixed default.
       */
      reducedMotion?: 'reduce' | 'no-preference';
      /**
       * Context permissions, for a test that reads what a control wrote.
       * `command-copy` asserts the Copy button's clipboard contents, which the
       * driver refuses without `clipboard-read`.
       */
      permissions?: readonly string[];
      /**
       * Routes installed BEFORE the first navigation, for a state no payload
       * can express.
       *
       * A served payload is an answer; some tests are about the server not
       * answering at all — an aborted `/api/fleet` is what an unreachable board
       * looks like, and `fleet.error` is the opposite, a server saying its scan
       * failed. Two facts, and only one of them is a payload.
       *
       * Installed here rather than by the caller because a route added to an
       * open page cannot catch a poll already in flight: between the test
       * deciding and the route existing there is a window a fetch can land in,
       * and a success arriving in it reads as the assertion failing. A handler
       * closing over a mutable flag is the shape that has no such window.
       *
       * The route wins over the mock for the paths it names. Everything else,
       * `index.html` included, still comes from the server.
       */
      route?: Record<string, (route: Route) => unknown>;
    },
  ) => Promise<Page>;
  /** Close the browser and stop the mock. */
  close: () => Promise<void>;
}

const DEFAULT_VIEWPORT = { width: 1400, height: 1200 };

/**
 * Open every fold on the Agents tab, plans first and then waves.
 *
 * A copy of `helpers.mjs`'s helper of the same name, and copied DELIBERATELY:
 * that module also exports `startServer`, so importing it here would put the
 * board-spawning helper one auto-import away from every catalogue consumer —
 * the shortcut this whole slice exists to keep out of reach. Six lines of
 * duplication buys an import graph in which the mock cannot reach the artifact.
 *
 * ORDER MATTERS. A wave's toggle does not exist in the DOM until the plan
 * holding it is open, so a single pass over both selectors misses every wave
 * under a folded plan.
 */
export const expandAgentFolds = async (page: Page): Promise<void> => {
  for (const selector of ['[data-wave-toggle]', '[data-wave-branch-toggle]']) {
    const toggles = page.locator(selector);
    for (let i = 0; i < (await toggles.count()); i += 1) {
      const toggle = toggles.nth(i);
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    }
  }
};

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
    const context = await browser.newContext({
      viewport: opts.viewport ?? DEFAULT_VIEWPORT,
      ...(opts.reducedMotion ? { reducedMotion: opts.reducedMotion } : {}),
      ...(opts.permissions ? { permissions: [...opts.permissions] } : {}),
    });
    const page = await context.newPage();
    // BEFORE `goto`, so the first fetch the client makes is already covered.
    for (const [pattern, handler] of Object.entries(opts.route ?? {})) {
      await page.route(pattern, handler);
    }
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
