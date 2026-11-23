import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, card as buildCard, column, row, slice, type Catalogue } from '../catalogue/index.js';
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

/**
 * AN OPENED PLAN ROW'S SLICE LINES SHARE THE PLAN ROW'S LAST COLUMN.
 *
 * Plan `bed` holds a merged slice and a startable one with its own branch. Each slice line's ⋯ cell starts at the
 * plan row's ⋯ cell, the merged line's empty cell included, and Start work in the startable line's ⋯ posts that
 * line's branch to `/api/dispatch`.
 */
describe('an opened Release plan row unfolds to slice lines', () => {
  let cat: Catalogue;
  beforeAll(async () => { cat = await openCatalogue(); }, 60_000);
  afterAll(async () => { await cat?.close(); });

  const PLAN_FILE = 'docs/plans/bed.md';
  const BRANCH = 'feature/bed-sow';
  const estate = (): Fleet => ({
    ...fleet(),
    rows: [row({
      plan: 'bed', planFile: 'bed.md', branch: BRANCH, wave: 'Sow', state: 'open', group: 'not-started', phase: 'Development',
      planState: 'approved', waitingOn: 'click', verdict: 'eligible', startability: 'start-work',
    })],
    slices: [
      slice({ plan: 'bed', name: 'Dig', branches: [], verdict: 'complete', section: 'done', complete: true, planSliceCount: 2, merge: 'merged' }),
      slice({ plan: 'bed', name: 'Sow', branches: [BRANCH], verdict: 'eligible', section: 'not-started', complete: false, planSliceCount: 2 }),
    ],
    sprints: [sprint('mine', 'My Sprint', ME, ['bed'])],
  }) as unknown as Fleet;

  const open = async (): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      viewport: { width: 1280, height: 900 },
      over: {
        fleet: estate(),
        board: buildBoard({
          columns: [column({ phase: 'Development', cards: [buildCard({ slug: 'bed', title: 'Bed', path: PLAN_FILE })] })],
          dispatch: { available: true, reason: '' },
          server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME, people: { [ME]: ME } },
        }),
      },
    });
    await page.locator(`${RELEASE} [data-plan-toggle="bed"]`).click();
    await page.locator(`${RELEASE} [data-plan-row="bed"] [data-plan-line]`).first().waitFor({ timeout: 15_000 });
    return page;
  };
  const leftOf = async (page: Page, selector: string): Promise<number> => {
    const box = await page.locator(selector).boundingBox();
    if (box === null) throw new Error(`${selector} has no box`);
    return box.x;
  };

  it('puts every slice line\'s ⋯ cell at the plan row\'s ⋯ cell, the merged line\'s empty cell included', async () => {
    const page = await open();
    try {
      const row = `${RELEASE} [data-plan-row="bed"]`;
      const plan = await leftOf(page, `${row} > div > [data-row-cell="do"] [data-row-menu]`);
      const done = `${row} [data-plan-line="done"]`;
      const todo = `${row} [data-plan-line="to-do"]`;
      expect(await page.locator(`${done} [data-row-menu] button`).count()).toBe(0);
      expect(await leftOf(page, `${done} [data-row-menu]`)).toBe(plan);
      expect(await leftOf(page, `${todo} [data-row-menu]`)).toBe(plan);
      expect(await page.locator(`${done} [data-status-pill]`).textContent()).toBe('merged');
      expect(await page.locator(`${todo} [data-status-pill]`).textContent()).toBe('not started');
      expect(await page.locator(`${todo} [data-plan-line-branch="${BRANCH}"]`).count()).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('posts the line\'s branch when Start work in its ⋯ is clicked', async () => {
    const page = await open();
    let posted: unknown = null;
    await page.route('**/api/dispatch', (route) => {
      posted = route.request().postDataJSON();
      void route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ slug: 'bed' }) });
    });
    try {
      await page.locator(`${RELEASE} [data-slice-line-actions="Sow"]`).click();
      await page.getByRole('button', { name: 'Start work' }).click();
      await expect.poll(() => posted, { timeout: 10_000 }).toEqual({ slug: 'bed', branch: BRANCH });
    } finally {
      await page.close();
    }
  }, 60_000);
});
