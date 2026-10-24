import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page, type Route } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import {
  openCatalogue, scenario, board, card, column, fleet as buildFleet, row as buildRow, sprint,
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
    // The board's FIRST answer is held back, so the click lands while `board`
    // is still `null` — `onOpenPlanFile`'s `wait` branch. Once the handler is
    // told to stop holding and the board's own poll comes back around, the
    // remembered click must resolve to the modal rather than sitting there
    // having done nothing.
    //
    // The route callback stays SYNCHRONOUS throughout — it never awaits
    // `route.fetch()` — because the board polls on timers, and an awaited
    // pass-through still in flight when `page.close()` runs rejects with
    // "Request context disposed" as an unhandled rejection vitest blames on
    // the file. Holding the `Route` itself (rather than a mutable boolean
    // read per-poll) answers THIS SAME request once released, instead of
    // leaving it hanging while a later poll's request answers in its place.
    //
    // Held back means PENDING, never ABORTED: an abort is a reached-nothing
    // failure that sets the board's own unreachable signal (the fix this
    // slice adds) and would make the pending click resolve to navigation
    // before this test ever releases it.
    let held: Route | undefined;
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { fleet: fleetWithWaitingDesignRow() },
      route: {
        '**/api/board': (route) => { held = route; },
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
      await held?.fulfill({ json: boardWithCard() });
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
    //
    // This now resolves fast rather than waiting the full
    // `PENDING_PLAN_TIMEOUT_MS`: the very first failed `/api/board` poll
    // sets the board's own unreachable signal, and the pending click reads
    // it directly instead of sitting out the 30 s deadline. A short timeout
    // here is itself part of the assertion — proving the early-exit path
    // actually fires rather than merely happening to finish before a longer
    // one would have.
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
      await page.waitForURL(`**/plan/${PLAN_FILE}`, { timeout: 10_000 });
    } finally {
      await page.close();
    }
  });

  it('a click remembered then the board answers, late, with no card for this slug', async () => {
    // The gap the plan names explicitly: the board is not unreachable and it
    // is not instant either — it answers AFTER the click, and when it does
    // it holds no card for this slug. That is neither "opens the modal" nor
    // "falls back because the board never answers" — it is `planLinkClick`'s
    // `navigate` branch reached through the deferred effect rather than the
    // unreachable-signal or hard-deadline paths the other tests cover.
    //
    // The route is HELD, never ABORTED, for the same reason as the test
    // above: an abort sets the board's own unreachable signal and this test
    // would then (silently, and for the wrong reason) take that early-exit
    // path instead of the deferred effect's `navigate` branch its own name
    // promises to exercise.
    let held: Route | undefined;
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { fleet: fleetWithWaitingDesignRow() },
      route: {
        '**/api/board': (route) => { held = route; },
      },
    });
    try {
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const waiting = group(page, 'Waiting on you');
      const planRow = waiting.locator(`[data-plan-level-row="${PLAN}"]`);
      await expect.poll(() => planRow.count()).toBe(1);
      await planRow.getByRole('link', { name: PLAN }).click();
      // The click is remembered, not yet resolved — the board has not
      // answered at all yet, let alone with a cardless payload.
      expect(page.url()).not.toContain(`/plan/${PLAN_FILE}`);
      await held?.fulfill({ json: board() });
      await page.waitForURL(`**/plan/${PLAN_FILE}`, { timeout: 10_000 });
      expect(await page.getByRole('dialog').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

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
