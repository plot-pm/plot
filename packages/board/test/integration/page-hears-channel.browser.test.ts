import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

/**
 * The page refetches `/api/board` when the channel reports a change, at most
 * once per window, and polls as before when no event ever arrives.
 */
const POLL_MS = 30_000;

/** Replaces `EventSource` with one the test drives through `window.__emit`. */
const FAKE_EVENT_SOURCE = `
  window.__sources = [];
  window.EventSource = class {
    constructor(url) { this.url = url; this.onmessage = null; this.onerror = null; window.__sources.push(this); }
    close() {}
  };
  window.__emit = () => window.__sources.forEach((s) => s.onmessage && s.onmessage({ data: '{"type":"finding"}' }));
  window.__fail = () => window.__sources.forEach((s) => s.onerror && s.onerror({}));
`;

describe('the page hears the channel', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  });
  afterAll(async () => {
    await cat?.close();
  });

  const openBoard = async (): Promise<{ page: Page; boardRequests: () => number }> => {
    const page = await cat.open('a-done-wave');
    await page.addInitScript(FAKE_EVENT_SOURCE);
    await page.clock.install();
    let count = 0;
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/board') count += 1;
    });
    // Reload so the fake and the fake clock are in place before the page's own scripts run.
    await page.reload();
    await page.waitForLoadState('networkidle');
    return { page, boardRequests: () => count };
  };

  const emit = (page: Page) => page.evaluate(() => (window as unknown as { __emit(): void }).__emit());

  it('refetches once for a burst of events, and again after the window', async () => {
    const { page, boardRequests } = await openBoard();
    try {
      const before = boardRequests();
      for (let i = 0; i < 5; i += 1) await emit(page);
      await expect.poll(boardRequests).toBe(before + 1);
      await page.clock.runFor(500);
      await emit(page);
      expect(boardRequests()).toBe(before + 1);
      await page.clock.runFor(2_000);
      await emit(page);
      await expect.poll(boardRequests).toBe(before + 2);
    } finally {
      await page.close();
    }
  });

  it('polls at the 30 s cadence when no event arrives', async () => {
    const { page, boardRequests } = await openBoard();
    try {
      const before = boardRequests();
      await page.clock.runFor(POLL_MS - 1_000);
      expect(boardRequests()).toBe(before);
      await page.clock.runFor(1_500);
      await expect.poll(boardRequests).toBe(before + 1);
    } finally {
      await page.close();
    }
  });

  it('shows no error and keeps polling when the stream errors', async () => {
    const { page, boardRequests } = await openBoard();
    try {
      const before = boardRequests();
      await page.evaluate(() => (window as unknown as { __fail(): void }).__fail());
      await page.clock.runFor(POLL_MS + 500);
      await expect.poll(boardRequests).toBe(before + 1);
      expect(await page.locator('article').count()).toBeGreaterThan(0);
      expect(await page.locator('[data-unreachable-overlay]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
