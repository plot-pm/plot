import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, type Catalogue } from '../catalogue/index.js';
import { type Fleet, type FleetSprint, type Slice } from '../../src/contract/schema.js';

/**
 * THE RELEASE DELIVERY SECTION FOLDS TO ITS HEADER LINE.
 *
 * The 28 px button and a click anywhere else on the header row toggle it, open by default. Folded, the section shows
 * no plan rows and no column headers, and the counts stay. A non-zero count opens
 * the section and scrolls to its plan row; a 0 count is text. The fold is one
 * stored key, the same under the My sprint chip, and a plan row keeps its own fold.
 */
const ME = 'gardener';
const RELEASE = '[data-section="release-delivery"]';

const sprint = (slug: string, title: string, owner: string, members: string[]): FleetSprint => ({
  slug, title, release: '', timebox: 'none', timeboxLabel: '', ownerHandle: owner,
  counts: { total: members.length, open: 0, wip: 0, done: members.length, withdrawn: 0 },
  members: members.map((m) => ({ slug: m, text: '', tier: 'must', checked: false, known: true })),
} as unknown as FleetSprint);

const mergedSlice = (plan: string): Slice => ({
  plan, name: 'a', branches: [], verdict: 'complete', section: 'done', complete: true, planSliceCount: 1, merge: 'merged',
}) as unknown as Slice;

const fleet = (): Fleet => ({
  generatedAt: new Date().toISOString(),
  ageSeconds: 1, ready: true, error: null, rows: [],
  slices: [mergedSlice('plan-mine'), mergedSlice('plan-theirs')],
  sprints: [sprint('mine', 'My Sprint', ME, ['plan-mine']), sprint('theirs', 'Their Sprint', 'someone', ['plan-theirs'])],
  issues: [], issueAnswer: 'answered', issueError: null,
  summary: { plans: 2, waves: 2, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
  prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
}) as unknown as Fleet;

describe('the Release delivery section folds to its header line', () => {
  let cat: Catalogue;
  beforeAll(async () => { cat = await openCatalogue(); }, 60_000);
  afterAll(async () => { await cat?.close(); });

  const open = async (): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: {
        fleet: fleet(),
        board: buildBoard({ server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME, people: { [ME]: ME } } }),
      },
    });
    await page.locator(`${RELEASE} [data-plan-row]`).first().waitFor({ timeout: 15_000 });
    return page;
  };
  const toggle = (page: Page) => page.locator('[data-section-toggle="release-delivery"]');
  const expanded = (page: Page) => toggle(page).getAttribute('aria-expanded');
  // A click on the section title, clear of the count links, toggles the fold as the button does.
  const clickRow = (page: Page) => page.locator('h2[data-delivery-section="release-delivery"] svg[data-section-icon]').click();
  const chevronTurned = async (page: Page) => (await toggle(page).locator('[data-section-chevron]').getAttribute('class'))?.includes('rotate-90');

  it('starts open with nothing stored, and folds to its counts with no plan rows and no column headers', async () => {
    const page = await open();
    try {
      expect(await expanded(page)).toBe('true');
      expect(await chevronTurned(page)).toBe(true);
      await clickRow(page);
      await expect.poll(() => expanded(page)).toBe('false');
      expect(await chevronTurned(page)).toBe(false);
      expect(await page.locator(`${RELEASE} [data-plan-row]`).count()).toBe(0);
      expect(await page.locator(`${RELEASE} [data-plan-thead]`).count()).toBe(0);
      expect(await page.locator(`${RELEASE} [data-release-header-count="plans"]`).textContent()).toBe('2 plans');
      expect(await page.locator(`${RELEASE} [data-release-header-count="delivered"]`).textContent()).toBe('2 of 2 slices delivered');
      // The fold is stored: a reload reads it back.
      await page.reload();
      await page.locator(`${RELEASE} [data-release-header]`).waitFor({ timeout: 15_000 });
      expect(await expanded(page)).toBe('false');
      expect(await page.locator(`${RELEASE} [data-plan-row]`).count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('keeps an opened plan row open across a fold and a reopen', async () => {
    const page = await open();
    try {
      await page.locator(`${RELEASE} [data-plan-toggle="plan-mine"]`).click();
      await page.locator(`${RELEASE} [data-plan-row="plan-mine"] [data-plan-lines]`).waitFor({ timeout: 5_000 });
      await clickRow(page);
      await expect.poll(() => expanded(page)).toBe('false');
      await clickRow(page);
      await expect.poll(() => expanded(page)).toBe('true');
      expect(await page.locator(`${RELEASE} [data-plan-row="plan-mine"] [data-plan-lines]`).count()).toBe(1);
      expect(await page.locator(`${RELEASE} [data-plan-row="plan-theirs"] [data-plan-lines]`).count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('opens the section and scrolls on a non-zero count while folded, and gives a 0 count no button', async () => {
    const page = await open();
    try {
      await clickRow(page);
      await expect.poll(() => expanded(page)).toBe('false');
      expect(await page.locator(`${RELEASE} [data-release-header-count="blocked"]`).textContent()).toBe('0 blocked');
      expect(await page.locator(`${RELEASE} [data-release-header-count="blocked"] button`).count()).toBe(0);
      expect(await page.locator(`${RELEASE} [data-release-header-count="at-a-gate"] button`).count()).toBe(0);
      await page.locator(`${RELEASE} [data-release-header-link="plans"]`).click();
      await expect.poll(() => expanded(page)).toBe('true');
      await page.locator(`${RELEASE} [data-release-header-link="plans"]`).click();
      expect(await expanded(page)).toBe('true');
      await expect.poll(() => page.locator('#delivery-plan-plan-mine[data-link-target]').count(), { timeout: 5_000 }).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('keeps one fold under the My sprint chip, where the section reads Sprint delivery', async () => {
    const page = await open();
    try {
      await clickRow(page);
      await expect.poll(() => expanded(page)).toBe('false');
      const title = page.locator('[data-delivery-section="release-delivery"]');
      await page.locator('[data-chip="My sprint"]').click();
      await expect.poll(async () => (await title.textContent()) ?? '', { timeout: 10_000 }).toContain('Sprint delivery');
      expect(await expanded(page)).toBe('false');
      expect(await page.locator(`${RELEASE} [data-plan-row]`).count()).toBe(0);
      expect(await page.locator(`${RELEASE} [data-release-header-scope]`).textContent()).toBe('mine');
      expect(await page.locator(`${RELEASE} [data-release-header-count="plans"]`).textContent()).toBe('1 plan');
      await clickRow(page);
      await expect.poll(() => expanded(page)).toBe('true');
      await page.locator('[data-chip="My sprint"]').click();
      await expect.poll(async () => (await title.textContent()) ?? '', { timeout: 10_000 }).toContain('Release delivery');
      expect(await expanded(page)).toBe('true');
      expect(await page.locator(`${RELEASE} [data-plan-row]`).count()).toBe(2);
    } finally {
      await page.close();
    }
  }, 60_000);
});
