import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { DOC_FETCH_TIMEOUT_MS } from '../../src/app/lib/bounded-fetch.js';

/**
 * A request that never answers must render the FAILURE branch, not `Loading…`.
 *
 * Measured 2026-08-26: a plan panel sat on `Loading…` indefinitely while the
 * route served 200/18 KB when tested the same minute. `pnpm board` runs under
 * `node --watch`, so a rebuild restarts the server MID-REQUEST — the headers
 * had gone out and the socket died before a response arrived. An unbounded
 * `fetch` neither resolves nor rejects for that, so the correct `.catch` in
 * `DocModal` never ran.
 *
 * **A route that REJECTS does not reproduce this and never did.** `route.abort()`
 * makes `fetch` reject promptly, which lit the red branch before this fix
 * existed — a test built on it passes against the bug. The only faithful
 * reproduction is a route that ACCEPTS the connection and then says nothing,
 * which is a handler that never calls `fulfill` or `abort` at all.
 */
// @needs-real-board: it needs a live transport it can abandon mid-response, which is the one condition route.abort cannot produce
//
// Read by the gate (`stubbed-tests-start-no-board.test.ts`) and then verified:
// the entitlement is the handler below that accepts a route and never answers
// it — the same structure the docstring above argues is the only faithful
// reproduction. This file asserts neither a write nor a process, so the plan's
// two named arms would have refused it; the third exists because this file
// exists.
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const VIEWPORT = { width: 1280, height: 900 };
const PLAN_DOC = '**/plan/*';

describe('a dead fetch is not a slow one', () => {
  let server: { port: number; kill: () => void };
  let browser: Browser;
  let baseURL: string;

  beforeAll(async () => {
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  async function openBoard(): Promise<Page> {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(baseURL);
    await page.getByText('Deal with the zucchini glut').waitFor({ timeout: 10_000 });
    return page;
  }

  const tomatoCard = (page: Page) =>
    page.locator('article', { hasText: 'Plant heirloom tomatoes' });

  async function openPlanModal(page: Page) {
    await tomatoCard(page).getByRole('link', { name: 'Open' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    return dialog;
  }

  it('renders the FAILURE branch when the document request never answers', async () => {
    const page = await openBoard();
    try {
      // Accept the connection and never answer — a server killed mid-response.
      // Holding the route object (rather than returning) keeps the request
      // outstanding for the life of the test, exactly like a dead socket.
      await page.route(PLAN_DOC, () => {
        /* deliberately never fulfilled: this IS the defect's condition */
      });

      const dialog = await openPlanModal(page);
      // Before the fix this arm rendered forever. It is legitimately what shows
      // while the bound is still running, so assert it gives way — not that it
      // never appeared.
      await expect
        .poll(() => dialog.getByText('Loading…').count(), {
          timeout: DOC_FETCH_TIMEOUT_MS + 8_000,
          interval: 250,
        })
        .toBe(0);

      const failure = dialog.locator('p.text-red-600, p.dark\\:text-red-400').first();
      expect(await failure.count()).toBe(1);
      expect(await failure.textContent()).toContain('Failed to load plan');
    } finally {
      await page.close();
    }
  });

  it('names the RESTART, not the exception class', async () => {
    const page = await openBoard();
    try {
      await page.route(PLAN_DOC, () => {
        /* never answers */
      });
      const dialog = await openPlanModal(page);
      await expect
        .poll(() => dialog.getByText('Loading…').count(), {
          timeout: DOC_FETCH_TIMEOUT_MS + 8_000,
          interval: 250,
        })
        .toBe(0);

      const text = (await dialog.locator('p').first().textContent()) ?? '';
      // A reader who is shown `TimeoutError` has learned nothing they can act
      // on. The message must say what happened and what to do about it.
      expect(text).toContain('timed out');
      expect(text).toMatch(/restart/i);
      expect(text).toContain('close and reopen');
      expect(text).not.toContain('TimeoutError');
      expect(text).not.toContain('AbortError');
    } finally {
      await page.close();
    }
  });

  it('a SLOW-but-successful load still succeeds', async () => {
    const page = await openBoard();
    try {
      // Just under the bound: the fix must not turn a large plan into an error.
      // This is the assertion a naive "make it fail fast" fix cannot pass, and
      // the reason the bound was chosen against the measured slow case rather
      // than against what feels responsive.
      const delayMs = DOC_FETCH_TIMEOUT_MS - 3_000;
      await page.route(PLAN_DOC, (route) => {
        setTimeout(() => {
          route
            .fulfill({
              status: 200,
              contentType: 'text/html',
              body: '<h1>Plant heirloom tomatoes</h1>',
            })
            .catch(() => {
              /* page closed first — nothing to answer */
            });
        }, delayMs);
      });

      const dialog = await openPlanModal(page);
      const frame = dialog.locator('iframe');
      await frame.waitFor({ state: 'visible', timeout: delayMs + 10_000 });
      // The document arrived: the success arm, not the red one.
      expect(await dialog.getByText('Loading…').count()).toBe(0);
      expect(await dialog.locator('p.text-red-600').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
