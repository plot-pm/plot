import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import {
  openCatalogue, board, card, column, fleet as buildFleet, row as buildRow, sprint,
  type Catalogue,
} from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type Fleet } from '../../src/contract/schema.js';

/**
 * A CLICK ON A PLAN NAME — `a-click-on-a-plan-story`, and the fetch-bound
 * slice that followed it (#2088, #2113).
 *
 * `onOpenPlanFile` remembers a click as `pendingPlan` while the board has not
 * loaded. Once the board arrives, a deferred effect resolves it: the modal
 * opens if a matching card exists, or the click falls back to
 * `/plan/<file>` navigation — `planLinkClick` (`@plot-pm/domain`) decides
 * which. Two more paths close the loop: a hard deadline
 * (`PENDING_PLAN_TIMEOUT_MS`) falls back on its own if the board never
 * answers at all, and a click already waiting when the board's OWN
 * unreachable signal turns true (not the fleet's — the two are counted on
 * different cadences) resolves to navigation immediately rather than sitting
 * out the rest of that deadline.
 */
/**
 * THE OTHER LINKS that open a board modal. The plan card's Open control
 * (`tiny-garden.browser.test.ts`), the story badge and the swimlane story header
 * (`story-overlay.browser.test.ts`) each have their click test already; these
 * are the two with none: a plan row's tuple link, and the sprint control.
 */
const ROW_PLAN = 'net-the-beds';
const ROW_PLAN_FILE = `2026-10-19-${ROW_PLAN}.md`;

const fleetWithPlanRow = (): Fleet => buildFleet({
  rows: [buildRow({
    repo: 'garden', branch: `feature/${ROW_PLAN}`, plan: ROW_PLAN, planFile: ROW_PLAN_FILE,
    wave: 'One', state: 'open', phase: 'Development', group: 'not-started', ageMinutes: null,
    waitingOn: 'click', note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
    localDirty: false, localLocked: false, stuck: null,
  })],
});

describe('every other link that opens a board modal', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const planRowLink = (page: Page) =>
    page.locator(`li[data-plan-row="${ROW_PLAN}"] a[data-tuple-link="plan"]`);

  it('a plan row\'s plan link opens the modal on a plain click', async () => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      viewport: { width: 1400, height: 1400 },
      over: {
        board: board({ columns: [column({ phase: 'Development', cards: [card({
          slug: ROW_PLAN, title: 'Net the beds', type: 'feature', phase: 'Development',
          path: `docs/plans/${ROW_PLAN_FILE}`,
        })] })] }),
        fleet: fleetWithPlanRow(),
      },
    });
    try {
      await expect.poll(() => planRowLink(page).count(), { timeout: 10_000 }).toBe(1);
      await planRowLink(page).click();
      await page.getByRole('dialog', { name: 'Plan: Net the beds' })
        .waitFor({ state: 'visible', timeout: 5_000 });
    } finally {
      await page.close();
    }
  });

  it('a plan row\'s plan link navigates to /plan/<file> where the loaded board holds no card', async () => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      viewport: { width: 1400, height: 1400 },
      over: { board: board(), fleet: fleetWithPlanRow() },
    });
    try {
      await expect.poll(() => planRowLink(page).count(), { timeout: 10_000 }).toBe(1);
      await planRowLink(page).click();
      await page.waitForURL(`**/plan/${ROW_PLAN_FILE}`, { timeout: 10_000 });
    } finally {
      await page.close();
    }
  });

  it('the sprint control in a story opens the sprint modal', async () => {
    const base = scenario('a-story-with-and-without-a-file').board;
    const page = await cat.open('a-story-with-and-without-a-file', {
      viewport: { width: 1280, height: 900 },
      over: {
        board: {
          ...base,
          stories: base.stories.map((s) =>
            s.slug === 'berry-patch' ? { ...s, sprints: [{ slug: 'spring-planting', planCount: 1 }] } : s),
          sprints: [sprint({
            slug: 'spring-planting', title: 'Spring planting', phase: 'active',
            members: [{ slug: 'strawberry-netting', tier: 'must', checked: false }],
          })],
        },
      },
    });
    try {
      const badge = page
        .locator('article', { hasText: 'Net the strawberry bed' })
        .getByRole('link', { name: 'berry-patch' });
      await badge.waitFor({ timeout: 10_000 });
      await badge.click();
      const story = page.getByRole('dialog');
      await story.getByRole('heading', { name: 'Story' }).waitFor({ timeout: 5_000 });
      await story.getByRole('button', { name: 'spring-planting' }).click();
      await page.getByRole('dialog', { name: 'Sprint: Spring planting' })
        .waitFor({ state: 'visible', timeout: 5_000 });
    } finally {
      await page.close();
    }
  });
});
