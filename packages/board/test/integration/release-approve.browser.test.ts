import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, scenario, row, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';

/**
 * The Release group's "Approve release" button is SEEN. `releaseStatusLine` in the
 * domain decides it and the status line together and is unit-tested in
 * `release-group.test.ts`; this test proves the page shows the button in the release
 * slot above Work items, enabled for a ready release and disabled with the status
 * line's reason for one whose review names another commit, that the header's You
 * group counts only the ready release as blocking, and that the slot sits in the
 * header's Release group. It signs nothing.
 */
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const releasePr = (reviewSha: string) => ({
  number: 300,
  url: 'https://host/pull/300',
  draft: false,
  state: 'green' as const,
  open: true,
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'green' as const,
  plotReview: 'success' as const,
  plotReviewSha: reviewSha,
  plotReviewJudged: 'success' as const,
  plotReviewCheckedSha: HEAD,
});

describe('the Release group approves the release', () => {
  let cat: Catalogue;
  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (reviewSha: string, viewport?: { width: number; height: number }): Promise<Page> => {
    const base = scenario('ten-rows-one-kind-each').fleet;
    const { agents: _a, summary: _s, rows, ...envelope } = base;
    const release = row({
      kind: 'release', version: '2.7.0', plan: '', planFile: '', wave: '', group: 'waiting-on-you',
      branch: 'changeset-release/main', branchUrl: 'https://host/tree/changeset-release/main',
      ageMinutes: 12, pr: releasePr(reviewSha),
    });
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      ...(viewport ? { viewport } : {}),
      over: { fleet: buildFleet({ ...envelope, rows: [...rows, release] }) },
      route: {
        '**/api/passkey': (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registered: true, credentialId: 'cred' }) }),
      },
    });
    await page.locator('[data-release-slot-version="2.7.0"]').waitFor({ timeout: 10_000 });
    return page;
  };

  const slot = (page: Page) => page.locator('[data-release-slot-version="2.7.0"]');
  const status = (page: Page) => page.locator('[data-release-group] [data-release-status]');

  it('enables the slot\'s button on a ready release PR and disables it, with the reason as the status line, where the review names another head', async () => {
    let readyBlocks = 0;
    const ready = await open(HEAD);
    try {
      const button = slot(ready).getByRole('button', { name: 'Approve release' });
      await expect.poll(() => button.count(), { timeout: 10_000 }).toBe(1);
      await expect.poll(() => button.isEnabled(), { timeout: 10_000 }).toBe(true);
      expect(await status(ready).textContent()).toMatch(/^Release PR #\d+ ready$/);
      expect(await ready.locator('[data-testid="passkey-panel"]').count()).toBe(0);
      expect(await ready.locator('[data-header-release-wait]').count()).toBe(0);
      readyBlocks = Number(await ready.locator('[data-header-number="blocks-delivery"]').getAttribute('data-count'));
    } finally {
      await ready.close();
    }
    const stale = await open(OTHER);
    try {
      const button = slot(stale).getByRole('button', { name: 'Approve release' });
      await expect.poll(() => button.count(), { timeout: 10_000 }).toBe(1);
      expect(await button.isEnabled()).toBe(false);
      expect(await status(stale).textContent()).toMatch(/older head/);
      expect(await button.getAttribute('title')).toBe(await status(stale).textContent());
      const waiting = stale.locator('[data-header-release-wait]', { hasText: 'Approve release 2.7.0' });
      await expect.poll(() => waiting.count(), { timeout: 10_000 }).toBe(1);
      expect(await waiting.textContent()).toMatch(/older head/);
      const staleBlocks = Number(await stale.locator('[data-header-number="blocks-delivery"]').getAttribute('data-count'));
      expect(staleBlocks).toBe(readyBlocks - 1);
    } finally {
      await stale.close();
    }
  });

  it('places the release slot in the header\'s Release group above Work items and shows no release row', async () => {
    const page = await open(HEAD);
    try {
      const top = (await slot(page).boundingBox())!.y;
      const work = (await page.locator('[data-delivery-section="work-items"]').boundingBox())!.y;
      expect(top).toBeLessThan(work);
      expect(await page.locator('[data-agent-row][data-branch="changeset-release/main"], [data-agent-row] [data-branch="changeset-release/main"]').count()).toBe(0);
      expect(await page.locator('[data-tab-header] [data-header-group="release"] [data-release-group] [data-release-slot-version="2.7.0"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('draws the disabled button with a dashed border, and the enabled one with a solid border', async () => {
    const style = async (reviewSha: string) => {
      const page = await open(reviewSha);
      try {
        const button = slot(page).getByRole('button', { name: 'Approve release' });
        await expect.poll(() => button.count(), { timeout: 10_000 }).toBe(1);
        await expect.poll(() => button.isEnabled(), { timeout: 10_000 }).toBe(reviewSha === HEAD);
        return await button.evaluate((el) => getComputedStyle(el).borderTopStyle);
      } finally {
        await page.close();
      }
    };
    expect(await style(HEAD)).toBe('solid');
    expect(await style(OTHER)).toBe('dashed');
  });

  it('keeps the slot in one place whatever the length of the status line', async () => {
    const box = async (reviewSha: string) => {
      const page = await open(reviewSha);
      try {
        const button = slot(page).getByRole('button', { name: 'Approve release' });
        await expect.poll(() => button.isEnabled(), { timeout: 10_000 }).toBe(reviewSha === HEAD);
        const group = (await page.locator('[data-release-group]').boundingBox())!;
        const at = (await slot(page).boundingBox())!;
        return { text: (await status(page).textContent())!, right: group.x + group.width - (at.x + at.width), top: at.y - group.y };
      } finally {
        await page.close();
      }
    };
    const short = await box(HEAD);
    const long = await box(OTHER);
    expect(long.text.length).toBeGreaterThan(short.text.length);
    expect(long.right).toBeCloseTo(short.right, 0);
    expect(long.top).toBeCloseTo(short.top, 0);
  });

  it('scrolls the page no wider than 320 px', async () => {
    const page = await open(OTHER, { width: 320, height: 900 });
    try {
      await slot(page).getByRole('button', { name: 'Approve release' }).waitFor({ timeout: 10_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    } finally {
      await page.close();
    }
  });
});
