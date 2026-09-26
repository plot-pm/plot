import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page, type Route } from 'playwright';
import { openCatalogue, board as buildBoard, card as buildCard, column, type Catalogue } from '../catalogue/index.js';
import type { Board, DispatchInfo } from '../../src/contract/schema.js';

/**
 * A DRAFT CARD SENDS ITS PLAN TO THE JURY — the Board tab's `Interrogate`.
 *
 * Plan file: docs/plans/2026-09-26-a-card-sends-its-plan-to-the-jury.md
 *
 * What only a rendered page settles:
 *   - Draft cards offer `Interrogate` beside `Approve`; an approved card does not
 *   - a missing `Interrogate command` renders the button refused, naming the key
 *   - a card whose panel is running offers no second one
 *   - a click posts the slug, once
 *   - `Approve` stays enabled at every round count, none included
 *
 * The catalogue serves the board; the two interrogate routes are the test's own
 * answers, layered with `page.route`.
 */
const AVAILABLE: DispatchInfo = { available: true, reason: '' };

const boardWith = (interrogate: DispatchInfo): Board => buildBoard({
  approve: AVAILABLE,
  interrogate,
  columns: [
    column({
      phase: 'Discovery',
      cards: [
        buildCard({ slug: 'never-asked', title: 'never-asked', type: 'feature', phase: 'Discovery',
          path: 'docs/plans/2026-09-26-never-asked.md', prs: [], phaseDate: '2026-09-26' }),
        buildCard({ slug: 'asked-zero', title: 'asked-zero', type: 'feature', phase: 'Discovery',
          path: 'docs/plans/2026-09-26-asked-zero.md', prs: [], phaseDate: '2026-09-26', rounds: 0 }),
        buildCard({ slug: 'asked-twice', title: 'asked-twice', type: 'feature', phase: 'Discovery',
          path: 'docs/plans/2026-09-26-asked-twice.md', prs: [], phaseDate: '2026-09-26', rounds: 2 }),
      ],
    }),
    column({
      phase: 'Development',
      cards: [
        buildCard({ slug: 'approved-one', title: 'approved-one', type: 'feature', phase: 'Development',
          path: 'docs/plans/2026-09-26-approved-one.md', prs: [], phaseDate: '2026-09-26', rounds: 1 }),
      ],
    }),
  ],
});

describe('a Draft card offers Interrogate', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  /**
   * Open the Board tab. `running` names the slugs whose status reads running;
   * `posts` collects every POST body sent to `/api/interrogate`.
   */
  const open = async (opts: {
    interrogate?: DispatchInfo;
    running?: string[];
    posts?: unknown[];
  } = {}): Promise<Page> => {
    const running = new Set(opts.running ?? []);
    const page = await cat.open('an-empty-estate', {
      over: { board: boardWith(opts.interrogate ?? AVAILABLE) },
      tab: 'board',
      viewport: { width: 1600, height: 1200 },
    });
    await page.route('**/api/interrogate**', (route: Route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname === '/api/interrogate') {
        const body = req.postDataJSON() as { slug?: string };
        opts.posts?.push(body);
        // The server records the run; so does this stub.
        if (body.slug) running.add(body.slug);
        void route.fulfill({ status: 202, contentType: 'application/json',
          body: JSON.stringify({ ok: true, log: '/tmp/plot-interrogate-x.log' }) });
        return;
      }
      const slug = decodeURIComponent(url.pathname.slice('/api/interrogate/'.length));
      void route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ state: running.has(slug) ? 'running' : 'unknown', message: '', log: '/tmp/x.log' }) });
    });
    await page.locator('#plan-never-asked').waitFor({ timeout: 10_000 });
    return page;
  };

  const card = (page: Page, slug: string) => page.locator(`#plan-${slug}`);
  const interrogate = (page: Page, slug: string) => card(page, slug).locator(`[data-interrogate="${slug}"]`);
  const approve = (page: Page, slug: string) => card(page, slug).getByRole('button', { name: /^Approve/ });

  it('offers Interrogate beside Approve on every Draft card, and not on an approved one', async () => {
    const page = await open();
    try {
      for (const slug of ['never-asked', 'asked-zero', 'asked-twice']) {
        await expect.poll(() => interrogate(page, slug).count(), { timeout: 10_000 }).toBe(1);
        expect(await approve(page, slug).count()).toBe(1);
        expect(await interrogate(page, slug).getAttribute('aria-disabled')).toBeNull();
      }
      await card(page, 'approved-one').waitFor();
      expect(await card(page, 'approved-one').locator('[data-interrogate]').count()).toBe(0);
    } finally { await page.close(); }
  });

  it('leaves Approve enabled at every round count, none included', async () => {
    const page = await open();
    try {
      for (const slug of ['never-asked', 'asked-zero', 'asked-twice']) {
        await expect.poll(() => approve(page, slug).count(), { timeout: 10_000 }).toBe(1);
        expect(await approve(page, slug).getAttribute('aria-disabled'), slug).toBeNull();
      }
    } finally { await page.close(); }
  });

  it('refuses by naming the key when Interrogate command is absent', async () => {
    const reason = 'no `Interrogate command` in Plot Config — interrogating a plan runs /plot-panel, which no script can do; add the key or run /plot-panel yourself';
    const posts: unknown[] = [];
    const page = await open({ interrogate: { available: false, reason }, posts });
    try {
      const btn = interrogate(page, 'never-asked');
      await expect.poll(() => btn.count(), { timeout: 10_000 }).toBe(1);
      expect(await btn.getAttribute('aria-disabled')).toBe('true');
      expect(await btn.getAttribute('title')).toContain('Interrogate command');
      // Playwright will not click an aria-disabled control; the event reaches
      // the handler, which is the guard under test.
      await btn.dispatchEvent('click');
      await page.waitForTimeout(300);
      expect(posts).toHaveLength(0);
    } finally { await page.close(); }
  });

  it('offers no second panel while one is running for the plan', async () => {
    const page = await open({ running: ['asked-twice'] });
    try {
      const running = card(page, 'asked-twice').locator('[data-interrogate-running="asked-twice"]');
      await expect.poll(() => running.count(), { timeout: 10_000 }).toBe(1);
      expect(await interrogate(page, 'asked-twice').count()).toBe(0);
      // The other Draft cards are unaffected.
      expect(await interrogate(page, 'asked-zero').count()).toBe(1);
    } finally { await page.close(); }
  });

  it('posts the slug once, and shows the panel running', async () => {
    const posts: unknown[] = [];
    const page = await open({ posts });
    try {
      const btn = interrogate(page, 'asked-zero');
      await expect.poll(() => btn.count(), { timeout: 10_000 }).toBe(1);
      await btn.click();
      await expect.poll(() => posts.length, { timeout: 10_000 }).toBe(1);
      expect(posts[0]).toEqual({ slug: 'asked-zero' });
      await expect.poll(
        () => card(page, 'asked-zero').locator('[data-interrogate-running]').count(),
        { timeout: 10_000 },
      ).toBe(1);
    } finally { await page.close(); }
  });

  it('marks a plan with no Rounds: field apart from one recording 0', async () => {
    const page = await open();
    try {
      const badge = (slug: string) => card(page, slug).locator('[data-rounds]');
      await expect.poll(() => badge('never-asked').count(), { timeout: 10_000 }).toBe(1);
      expect(await badge('never-asked').getAttribute('data-rounds')).toBe('absent');
      expect(await badge('never-asked').textContent()).toContain('not interrogated');
      expect(await badge('asked-zero').getAttribute('data-rounds')).toBe('recorded');
      expect(await badge('asked-zero').textContent()).toContain('0 rounds');
    } finally { await page.close(); }
  });
});
