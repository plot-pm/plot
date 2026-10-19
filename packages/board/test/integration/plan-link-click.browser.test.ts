import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import {
  openCatalogue, scenario, board, card, column, fleet as buildFleet, row as buildRow, sprint,
  type Catalogue,
} from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type Fleet } from '../../src/contract/schema.js';

/**
 * A CLICK ON A PLAN NAME, reproduced and then fixed — `a-click-on-a-plan-story`.
 *
 * On 2026-10-19 a click on a WAITING ON YOU plan-level row did not open the
 * plan, even though the board's payload held the card. `onOpenPlanFile`
 * remembered the click while `board` was still `null`, and the deferred
 * effect that later tries to resolve it dropped the click silently if the
 * board, once loaded, still had no matching card — the aborted-poll path
 * (#2083) leaves `board` null indefinitely, so the remembered click never
 * resolves. `planLinkClick` (`@plot-pm/domain`) is the fix: a pending click
 * that cannot resolve a card now falls back to `/plan/<file>` instead of
 * going nowhere.
 */
const PLAN = 'only-my-work-says-no-identity';
const PLAN_FILE = '2026-10-19-only-my-work-says-no-identity.md';

function fleetWithWaitingDesignRow(): Fleet {
  const base = scenario('ten-rows-one-kind-each');
  const { agents: _a, summary: _s, rows: _r, ...envelope } = base.fleet;
  return buildFleet({
    ...envelope,
    // The idea branch's own row: the fleet names the plan file before the
    // board has any card, which is what the plan-level row reads.
    rows: [{ ...base.fleet.rows[0], plan: PLAN, planFile: PLAN_FILE, branch: `idea/${PLAN}` }],
    design: {
      halted: false,
      running: [],
      refusals: {},
      rows: [{
        kind: 'spec',
        plan: PLAN,
        reason: 'the spec run failed 3 times; the fleet stopped retrying this plan',
        log: '/r/.plot/logs/plot-design-only-my-work-says-no-identity.log',
        restart: 'plot-design.mjs restart only-my-work-says-no-identity',
        stopped: true,
        halted: false,
      }],
    },
  } as Partial<Fleet>);
}

/** The board's card for the row above — present, exactly as the bug report describes. */
function boardWithCard() {
  return board({
    columns: [column({
      phase: 'Design',
      cards: [card({ slug: PLAN, title: 'Only my work says no identity', type: 'bug', phase: 'Design', path: `docs/plans/${PLAN_FILE}` })],
    })],
  });
}

describe('tiny-garden: a click on a plan name in Waiting on you', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const group = (page: Page, label: string) =>
    page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: new RegExp(label) }),
    });

  it('opens the modal on a plain click, with the board already loaded', async () => {
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { board: boardWithCard(), fleet: fleetWithWaitingDesignRow() },
    });
    try {
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const waiting = group(page, 'Waiting on you');
      const planRow = waiting.locator(`[data-plan-level-row="${PLAN}"]`);
      await expect.poll(() => planRow.count()).toBe(1);
      await planRow.getByRole('link', { name: PLAN }).click();
      const dialog = page.getByRole('dialog', { name: 'Plan: Only my work says no identity' });
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    } finally {
      await page.close();
    }
  });

  it('a click remembered while the board is still loading opens once the board lands', async () => {
    // The board's FIRST answer is delayed, so the click lands while `board`
    // is still `null` — `onOpenPlanFile`'s `wait` branch. Once the delayed
    // response arrives, the remembered click must resolve to the modal
    // rather than sitting there having done nothing.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { board: boardWithCard(), fleet: fleetWithWaitingDesignRow() },
      route: {
        '**/api/board': async (route) => {
          await gate;
          const res = await route.fetch();
          return route.fulfill({ response: res });
        },
      },
    });
    try {
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const waiting = group(page, 'Waiting on you');
      const planRow = waiting.locator(`[data-plan-level-row="${PLAN}"]`);
      await expect.poll(() => planRow.count()).toBe(1);
      await planRow.getByRole('link', { name: PLAN }).click();
      // Nothing has resolved yet — the board has not answered. The click must
      // not have navigated away in the meantime.
      expect(page.url()).not.toContain(`/plan/${PLAN_FILE}`);
      release?.();
      const dialog = page.getByRole('dialog', { name: 'Plan: Only my work says no identity' });
      await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    } finally {
      await page.close();
    }
  });

  it('a click that can never resolve a card falls back to /plan/<file> — board unreachable', async () => {
    // The aborted-poll path (#2083): every `/api/board` request fails, so
    // `board` stays `null` forever. The fleet still names the row (served on
    // `/api/fleet`, which this test leaves answering normally), so the row
    // renders and is clickable — the click must still end in navigation, not
    // silence.
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { fleet: fleetWithWaitingDesignRow() },
      route: {
        '**/api/board': (route) => route.abort('connectionrefused'),
      },
    });
    try {
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const waiting = group(page, 'Waiting on you');
      const planRow = waiting.locator(`[data-plan-level-row="${PLAN}"]`);
      await expect.poll(() => planRow.count()).toBe(1);
      await planRow.getByRole('link', { name: PLAN }).click();
      await page.waitForURL(`**/plan/${PLAN_FILE}`, { timeout: 35_000 });
    } finally {
      await page.close();
    }
  }, 45_000);

  it('a modified click still follows the browser default, board loaded or not', async () => {
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { board: boardWithCard(), fleet: fleetWithWaitingDesignRow() },
    });
    try {
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const waiting = group(page, 'Waiting on you');
      const planRow = waiting.locator(`[data-plan-level-row="${PLAN}"]`);
      await expect.poll(() => planRow.count()).toBe(1);
      const link = planRow.getByRole('link', { name: PLAN });
      const [popup] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 10_000 }),
        // `ControlOrMeta`: the new-tab modifier is Ctrl on Linux, where CI runs,
        // and Cmd on macOS. A Meta-click on Linux opens no page at all.
        link.click({ modifiers: ['ControlOrMeta'] }),
      ]);
      await popup.waitForLoadState();
      await popup.waitForURL(`**/plan/${PLAN_FILE}`, { timeout: 5_000 });
      await popup.close();
      expect(await page.getByRole('dialog').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

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
