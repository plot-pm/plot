import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

/**
 * THE ACTING BUTTONS, CLICKED TWICE INSIDE ONE TICK.
 *
 * Both buttons carry a comment claiming a double click cannot fire two runs,
 * and both implement it by reading a value derived from `useState`:
 *
 *     const blocked = starting || !dispatch.available;
 *     onClick={() => { if (blocked) return; void start(); }}
 *
 * `setState` does not take effect until the next render, so the claim is only
 * true if something else — React's own batching, the browser's event loop —
 * happens to serialise the two clicks. Nothing in this repo had ever checked.
 * This file is that check, and it is written to fail before any latch exists:
 * a green run here would mean the guard already works and no fix is owed.
 *
 * TWO CLICKS INSIDE ONE TICK, NOT TWO AWAITED CLICKS. Playwright's `.click()`
 * awaits actionability between calls, which hands React a render in between and
 * makes `blocked` true by the second — the defect would be invisible. So the
 * events are dispatched from ONE synchronous block inside the page, which is
 * what a real double click on a fast machine does.
 *
 * NO REAL DISPATCH, NO REAL APPROVAL. Both POST routes are fulfilled at the
 * network boundary, so nothing creates a worktree, pushes a claim or merges
 * anything — and the recording is of REQUESTS THE PAGE MADE, which is the fact
 * under test, rather than of a spy the test installed inside the component.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const VIEWPORT = { width: 1280, height: 900 };

/** The approved-but-unstarted card: the one that carries `Start work`. */
const STARTABLE = 'Fix the leaky soaker hose';
/** A Draft card with a plan PR: the one whose `Approve` names a number. */
const DRAFT_WITH_PR = 'Plant heirloom tomatoes';

/**
 * A copy of the garden outside this repository, for the reason
 * `approve.browser.test.ts` documents at length: `plot-config.sh` locates
 * configuration by `git rev-parse --show-toplevel`, so a fixture nested inside
 * the plot checkout reads plot's own `CLAUDE.md` instead of the garden's.
 */
function detachedGarden(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-garden-dbl-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe('the acting buttons refuse a second click inside the same tick', () => {
  let server: { port: number; kill: () => void };
  // THE STATE IS SERVED. This copied the garden to a temp directory and started
  // a real board over it for two reasons, and only one was the payload: the
  // other was the CAPABILITY. `dispatch` and `approve` gate both buttons here,
  // and BoardSchema defaults them to false — `a-board-that-can-act` says which
  // board this is. The write routes stay intercepted below, which is where a
  // click's effect belongs.
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  /**
   * A page whose acting routes answer without acting, recording every POST.
   *
   * `/api/dispatch` answers the way the real route does on success — 202 with a
   * slug and a log — so the button takes its normal in-flight path rather than
   * an error path that would refuse a second click for the wrong reason.
   */
  async function openBoard(): Promise<{ page: Page; posts: string[] }> {
    const page = await cat.open('a-board-that-can-act', { viewport: VIEWPORT });
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(new URL(req.url()).pathname);
    });
    await page.route('**/api/dispatch', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ slug: 'fix-leaky-hose', log: 'stubbed' }),
      }));
    await page.route('**/api/approve', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ slug: 'plant-tomatoes' }),
      }));
    // The polled answer, so the armed-and-run Approve button neither settles
    // nor fails while the assertion is being made.
    await page.route('**/api/approve/*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'running' }),
      }));
    await page.getByText(STARTABLE).waitFor({ timeout: 10_000 });
    return { page, posts };
  }

  const cardFor = (page: Page, title: string) => page.locator('article', { hasText: title });

  /**
   * Click an element TWICE from one synchronous block in the page.
   *
   * The whole point of this file. Two `locator.click()` calls would let React
   * render between them; `el.click(); el.click();` in one statement does not,
   * and is what a fast physical double click delivers to the handler.
   */
  async function doubleClickInOneTick(page: Page, selector: string, name: string) {
    await page.evaluate(
      ({ selector, name }) => {
        const el = [...document.querySelectorAll<HTMLElement>(selector)]
          .find((n) => (n.textContent ?? '').includes(name));
        if (!el) throw new Error(`no element matching ${selector} with text ${name}`);
        el.click();
        el.click();
      },
      { selector, name },
    );
  }

  it('Start work: two clicks in one tick produce exactly one POST', async () => {
    const { page, posts } = await openBoard();
    try {
      const card = cardFor(page, STARTABLE);
      await card.getByRole('button', { name: 'Start work' }).waitFor({ timeout: 10_000 });

      await doubleClickInOneTick(page, 'article button', 'Start work');

      // Give any second request time to arrive before counting. Asserting
      // immediately would pass against a broken button whose second `fetch` had
      // simply not left the page yet.
      await expect.poll(() => posts.filter((p) => p === '/api/dispatch').length,
        { timeout: 5_000 }).toBe(1);
      await page.waitForTimeout(500);
      expect(posts.filter((p) => p === '/api/dispatch')).toHaveLength(1);
    } finally {
      await page.close();
    }
  });

  it('Approve: two clicks on the ARMED button in one tick produce exactly one POST', async () => {
    const { page, posts } = await openBoard();
    try {
      // Approve takes two clicks by design — the first arms, the second acts —
      // so the tick under test is the one where the ARMED button is clicked
      // twice. Arming happens first, on its own, and posts nothing.
      const card = cardFor(page, DRAFT_WITH_PR);
      await card.getByRole('button', { name: 'Approve' }).click();
      await card.getByRole('button', { name: /merges PR #146/ }).waitFor({ timeout: 5_000 });
      expect(posts).toHaveLength(0);

      await doubleClickInOneTick(page, 'article button', 'merges PR #146');

      await expect.poll(() => posts.filter((p) => p === '/api/approve').length,
        { timeout: 5_000 }).toBe(1);
      await page.waitForTimeout(500);
      expect(posts.filter((p) => p === '/api/approve')).toHaveLength(1);
    } finally {
      await page.close();
    }
  });

  it('a slow single click still works — the latch is not a wall', async () => {
    // The pairing that matters. A latch that never releases passes every
    // assertion above and breaks the button entirely, so one ordinary click
    // must still reach the route.
    const { page, posts } = await openBoard();
    try {
      const card = cardFor(page, STARTABLE);
      await card.getByRole('button', { name: 'Start work' }).click();
      await expect.poll(() => posts.filter((p) => p === '/api/dispatch').length,
        { timeout: 5_000 }).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('the latch holds while the button still reads `starting…`', async () => {
    // Where the release belongs. A `finally` beside the `fetch` would re-arm
    // the button the moment the request returned — while it still reads
    // `starting…` and still refuses for every other reason — so a later click
    // would fire a second dispatch against a button that looks disabled.
    const { page, posts } = await openBoard();
    try {
      const card = cardFor(page, STARTABLE);
      await card.getByRole('button', { name: 'Start work' }).click();
      await card.getByRole('button', { name: /starting…/ }).waitFor({ timeout: 5_000 });
      await expect.poll(() => posts.filter((p) => p === '/api/dispatch').length,
        { timeout: 5_000 }).toBe(1);

      // The request has returned by now — the route answered immediately. The
      // button is still pending, so it must still refuse.
      await doubleClickInOneTick(page, 'article button', 'starting…');
      await page.waitForTimeout(500);
      expect(posts.filter((p) => p === '/api/dispatch')).toHaveLength(1);
      expect(await card.getByRole('button', { name: /starting…/ }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});

describe('a board that cannot act refuses both clicks for its OWN reasons', () => {
  // `blocked` carries refusals a latch knows nothing about — no dispatch
  // binding, a non-localhost host. The ref answers *is one of mine already
  // running*, never *may this act at all*, so both must still refuse here.
  let server: { port: number; kill: () => void };
  let browser: Browser;
  let garden: string;

  beforeAll(async () => {
    garden = detachedGarden();
    // Bound to 0.0.0.0: whoever reaches localhost owns the worktrees, and over
    // a network that stops being true. Both routes refuse.
    server = await startServer(garden, { HOST: '0.0.0.0' });
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.kill();
    if (garden) fs.rmSync(garden, { recursive: true, force: true });
  });

  it('neither button posts, however many times it is clicked', async () => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(new URL(req.url()).pathname);
    });
    try {
      await page.goto(`http://localhost:${server.port}/`);
      const start = page.locator('article', { hasText: STARTABLE })
        .getByRole('button', { name: 'Start work' });
      await start.waitFor({ timeout: 10_000 });
      const approve = page.locator('article', { hasText: DRAFT_WITH_PR })
        .getByRole('button', { name: 'Approve' });
      await approve.waitFor({ timeout: 10_000 });

      // Forced past the driver's actionability check — `aria-disabled` makes it
      // wait forever otherwise — so this asserts the HANDLER declines.
      await start.click({ force: true });
      await start.click({ force: true });
      await approve.click({ force: true });
      await approve.click({ force: true });
      await page.waitForTimeout(500);

      expect(posts).toEqual([]);
      // Not even armed: an inert control that changed its label would claim a
      // next click will act.
      expect(await approve.textContent()).not.toMatch(/merges PR/);
    } finally {
      await page.close();
    }
  });
});
