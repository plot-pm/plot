import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { refutedBadge, type Verification } from '@plot-pm/domain/rules/verification-record';
import { openCatalogue, board as buildBoard, card as buildCard, column, type Catalogue } from '../catalogue/index.js';

/**
 * A DELIVERED PLAN WHOSE VERIFICATION REFUTED A CLAIM SAYS SO ON ITS CARD.
 *
 * Plan file: docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md
 *
 * The badge text is decided by `refutedBadge` and unit-tested in
 * `packages/domain/test/verification-record.test.ts`. This test proves the
 * badge is seen: `refuted` draws `2 refuted`, and the other three answers draw
 * nothing.
 */
const delivered = (slug: string, verification?: { state: Verification; refuted: number }) =>
  buildCard({
    slug, title: slug, type: 'feature', phase: 'Testing',
    path: `docs/plans/2026-10-12-${slug}.md`, prs: [], phaseDate: '2026-10-12',
    ...(verification === undefined ? {} : {
      verification: { ...verification, badge: refutedBadge(verification.state, verification.refuted) },
    }),
  });

describe('a refuted verification shows a badge', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  const open = async (): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      over: {
        board: buildBoard({
          columns: [column({
            phase: 'Testing',
            cards: [
              delivered('refuted-plan', { state: 'refuted', refuted: 2 }),
              delivered('supported-plan', { state: 'supported', refuted: 0 }),
              delivered('stale-plan', { state: 'stale', refuted: 1 }),
              delivered('unverified-plan', { state: 'unverified', refuted: 0 }),
              delivered('unread-plan'),
            ],
          })],
        }),
      },
      tab: 'board',
      viewport: { width: 1600, height: 1200 },
    });
    await page.locator('#plan-refuted-plan').waitFor({ timeout: 10_000 });
    return page;
  };

  const badge = (page: Page, slug: string) => page.locator(`#plan-${slug} [data-refuted-badge]`);

  it('draws the count of refuted claims on a refuted plan', async () => {
    const page = await open();
    try {
      await expect.poll(() => badge(page, 'refuted-plan').count(), { timeout: 10_000 }).toBe(1);
      expect(await badge(page, 'refuted-plan').textContent()).toContain('2 refuted');
    } finally { await page.close(); }
  });

  it('draws no badge for supported, stale, unverified or unread plans', async () => {
    const page = await open();
    try {
      for (const slug of ['supported-plan', 'stale-plan', 'unverified-plan', 'unread-plan']) {
        await page.locator(`#plan-${slug}`).waitFor({ timeout: 10_000 });
        expect(await badge(page, slug).count(), slug).toBe(0);
      }
    } finally { await page.close(); }
  });
});
