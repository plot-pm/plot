import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, scenario, row, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';

/**
 * The release card's "Approve release" button is SEEN. `releaseCardApprovable` in
 * the domain decides it and is unit-tested in `release-card.test.ts`; this test
 * proves the page shows it on the card above Work items for a ready release and not
 * for one whose review names another commit, and that the to-do line scrolls to the
 * card. It signs nothing.
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

describe('the release card approves the release', () => {
  let cat: Catalogue;
  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (reviewSha: string): Promise<Page> => {
    const base = scenario('ten-rows-one-kind-each').fleet;
    const { agents: _a, summary: _s, rows, ...envelope } = base;
    const release = row({
      kind: 'release', version: '2.7.0', plan: '', planFile: '', wave: '', group: 'waiting-on-you',
      branch: 'changeset-release/main', branchUrl: 'https://host/tree/changeset-release/main',
      ageMinutes: 12, pr: releasePr(reviewSha),
    });
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { fleet: buildFleet({ ...envelope, rows: [...rows, release] }) },
      route: {
        '**/api/passkey': (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registered: true, credentialId: 'cred' }) }),
      },
    });
    await page.locator('[data-release-card-version="2.7.0"]').waitFor({ timeout: 10_000 });
    return page;
  };

  const card = (page: Page) => page.locator('[data-release-card-version="2.7.0"]');

  it('enables the button on a ready release card and disables it with a reason where the review names another head', async () => {
    const ready = await open(HEAD);
    try {
      const button = card(ready).getByRole('button', { name: 'Approve release' });
      await expect.poll(() => button.count(), { timeout: 10_000 }).toBe(1);
      await expect.poll(() => button.isEnabled(), { timeout: 10_000 }).toBe(true);
      expect(await ready.locator('[data-testid="passkey-panel"]').count()).toBe(0);
      const blocking = ready.locator('[data-todo-line="blocks-delivery"]', { hasText: 'Approve release 2.7.0' });
      await expect.poll(() => blocking.count(), { timeout: 10_000 }).toBe(1);
    } finally {
      await ready.close();
    }
    const stale = await open(OTHER);
    try {
      const button = card(stale).getByRole('button', { name: 'Approve release' });
      await expect.poll(() => button.count(), { timeout: 10_000 }).toBe(1);
      expect(await button.isEnabled()).toBe(false);
      expect(await card(stale).locator('[data-testid="release-approve-reason"]').textContent()).toMatch(/older head/);
      const waiting = stale.locator('[data-todo-line="waits"]', { hasText: 'Approve release 2.7.0' });
      await expect.poll(() => waiting.count(), { timeout: 10_000 }).toBe(1);
      expect(await waiting.locator('[data-todo-reason]').textContent()).toMatch(/older head/);
      expect(await stale.locator('[data-todo-line="blocks-delivery"]', { hasText: 'Approve release' }).count()).toBe(0);
    } finally {
      await stale.close();
    }
  });

  it('places the card above Work items, shows no release row, and scrolls to the card from its to-do line', async () => {
    const page = await open(HEAD);
    try {
      const top = (await card(page).boundingBox())!.y;
      const work = (await page.locator('[data-delivery-section="work-items"]').boundingBox())!.y;
      expect(top).toBeLessThan(work);
      expect(await page.locator('[data-agent-row][data-branch="changeset-release/main"], [data-agent-row] [data-branch="changeset-release/main"]').count()).toBe(0);
      const line = page.locator('[data-todo-name]', { hasText: 'Approve release 2.7.0' });
      expect(await line.count()).toBe(1);
      await line.click();
      await expect.poll(() => card(page).getAttribute('data-link-target'), { timeout: 5_000 }).toBe('');
    } finally {
      await page.close();
    }
  });
});
