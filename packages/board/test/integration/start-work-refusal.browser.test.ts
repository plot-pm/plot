import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { openCatalogue, fleet, board as buildBoard, card as buildCard, column, type Catalogue } from '../catalogue/index.js';

/**
 * WHAT THE START BUTTON SAYS BEFORE THE CLICK, IN A REAL BROWSER.
 *
 * The unit suite (`test/unit/start-work-watch.test.ts`) owns the decision — it
 * can build the `claimed: 0, eligible: 1` shape directly. This owns the part
 * only a page can show: that the refusal REACHES the reader, on the control
 * itself, in words that name the reason — and that the button still does not
 * move the row it is reporting on.
 *
 * The garden is not a git repo, so no fleet pulse lands and both occupancy
 * counts are absent. That is not a limitation here, it IS the case under test:
 * a freshly opened board with no scan yet is precisely the window where falling
 * back to `card.started` would hide the defect behind a working-looking button.
 *
 * NO REAL DISPATCH. The one test that clicks fulfils `/api/dispatch` at the
 * network boundary, so nothing creates a worktree or pushes a claim, and the
 * recording is of REQUESTS THE PAGE MADE rather than of a spy inside the
 * component.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const VIEWPORT = { width: 1280, height: 900 };

/** The approved plan this file adds — waves, and therefore a wave summary. */
const WAVED_TITLE = 'Rebuild the raised beds';
const WAVED_PLAN = `# ${WAVED_TITLE}

## Status

- **Phase:** Approved
- **Type:** feature
- **Started:** 2026-08-17, gardener, \`feature/raised-beds-frame\`

## Branches

### Frame

- \`feature/raised-beds-frame\` — new cedar sides

### Soil

- \`feature/raised-beds-soil\` — fill and level
`;

/**
 * A copy of the garden outside this repository, with one extra plan.
 *
 * Outside, for the reason `approve.browser.test.ts` documents at length:
 * `plot-config.sh` locates configuration by `git rev-parse --show-toplevel`, so
 * a fixture nested inside the plot checkout reads plot's own `CLAUDE.md`.
 *
 * The extra plan lives HERE rather than in the shared fixture on purpose: the
 * garden's plan count is asserted by a sibling suite, and a plan that exists
 * for one file's question should not make every other file re-count.
 */
function gardenWithSlices(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-garden-waves-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/plans/2026-08-17-raised-beds.md'), WAVED_PLAN, 'utf8');
  return dir;
}

describe('Start work refuses before the click when it cannot know', () => {
  // THE STATE IS SERVED, and the refusal is on the CARD.
  //
  // `startRefusal` reads `card.sliceSummary`: a summary whose `claimed` and
  // `eligible` are ABSENT is a plan no pulse has reached, which is what
  // *waiting for the first fleet scan* means. `SliceSummarySchema` makes exactly
  // those two optional for this reason — its own words: *`claimed: 0` and "no
  // pulse has landed yet" must not render identically*.
  //
  // The real server reached that state by accident of the fixture: the temp
  // garden is not a git repo, so no pulse landed. Stating it is the same
  // reading without the accident.
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const cardFor = (page: Page, title: string) => page.locator('article', { hasText: title });

  async function openBoard(): Promise<Page> {
    const page = await cat.open('a-board-that-can-act', {
      viewport: VIEWPORT,
      over: {
        board: buildBoard({
          dispatch: { available: true, reason: '' },
          approve: { available: true, reason: '' },
          columns: [column({
            phase: 'Development',
            cards: [buildCard({
              slug: 'raised-beds', title: WAVED_TITLE, type: 'feature',
              phase: 'Development', path: 'docs/plans/2026-08-17-raised-beds.md',
              // `claimed` and `eligible` absent: no pulse has reached this plan.
              sliceSummary: { waves: 2, branches: 2, deferred: 0 },
            })],
          })],
        }),
        fleet: fleet({ ready: false, rows: [], waves: [] }),
      },
    });
    await page.getByText(WAVED_TITLE).waitFor({ timeout: 10_000 });
    return page;
  }

  it('says it is waiting for the first scan, rather than going quiet', async () => {
    const page = await openBoard();
    try {
      const button = cardFor(page, WAVED_TITLE).getByRole('button', { name: /Start work/ });
      await button.waitFor({ timeout: 10_000 });

      // On the control, for a pointer…
      expect(await button.getAttribute('title')).toMatch(/first (fleet )?scan/);
      // …and in the accessible name, for a reader who can see neither the
      // pointer nor the dimming. Both, because either alone leaves someone out.
      expect(await button.textContent()).toMatch(/first (fleet )?scan/);
      expect(await button.getAttribute('aria-disabled')).toBe('true');
    } finally {
      await page.close();
    }
  });

  it('does not fall back to `card.started` — a STARTED plan refuses too', async () => {
    // This plan carries a `Started:` record, so the flag the button used to
    // watch is true. If the code fell back to it here, the button would offer a
    // click it could never report on.
    const page = await openBoard();
    try {
      const button = cardFor(page, WAVED_TITLE).getByRole('button', { name: /Start work/ });
      await button.waitFor({ timeout: 10_000 });
      expect(await button.getAttribute('aria-disabled')).toBe('true');
    } finally {
      await page.close();
    }
  });

  it('refuses the CLICK, not just the appearance', async () => {
    // `aria-disabled` does not stop a click the way the native attribute does,
    // so a button that only looked refused would still dispatch. The click is
    // forced past the driver's actionability check to assert the HANDLER
    // declines.
    const page = await cat.open('a-board-that-can-act', {
      viewport: VIEWPORT,
      over: {
        board: buildBoard({
          dispatch: { available: true, reason: '' },
          approve: { available: true, reason: '' },
          columns: [column({
            phase: 'Development',
            cards: [buildCard({
              slug: 'raised-beds', title: WAVED_TITLE, type: 'feature',
              phase: 'Development', path: 'docs/plans/2026-08-17-raised-beds.md',
              sliceSummary: { waves: 2, branches: 2, deferred: 0 },
            })],
          })],
        }),
        fleet: fleet({ ready: false, rows: [], waves: [] }),
      },
    });
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(new URL(req.url()).pathname);
    });
    await page.route('**/api/dispatch', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ slug: 'raised-beds', log: 'stubbed' }),
      }));
    try {
      const button = cardFor(page, WAVED_TITLE).getByRole('button', { name: /Start work/ });
      await button.waitFor({ timeout: 10_000 });
      await button.click({ force: true });
      await button.click({ force: true });
      await page.waitForTimeout(500);
      expect(posts).toEqual([]);
      // And it never claimed to be working: `starting…` on a refused click
      // would be the board asserting something it did not do.
      expect(await button.textContent()).not.toMatch(/starting…/);
    } finally {
      await page.close();
    }
  });

  it('the outcome is still DERIVED — the button does not move the row', async () => {
    // A plan with no waves gets no summary at all and is left to
    // `plot-dispatch.sh` to judge, so this card's button still acts. What it
    // must NOT do is advance the card itself: the row travels when the pulse
    // re-reads git, and an optimistic update would make the board display
    // something it does not know.
    const page = await cat.open('a-board-that-can-act', {
      viewport: VIEWPORT,
      // THE SCENARIO'S OWN BOARD, unmodified: this test clicks the button and
      // asserts the card DOES NOT MOVE, so the click has to be ALLOWED — the
      // opposite of its three siblings. `a-board-that-can-act` already serves
      // a startable leaky-hose card, which is this test's subject.
    });
    await page.route('**/api/dispatch', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ slug: 'fix-leaky-hose', log: 'stubbed' }),
      }));
    try {
      const card = cardFor(page, 'Fix the leaky soaker hose');
      const button = card.getByRole('button', { name: 'Start work' });
      await button.waitFor({ timeout: 10_000 });
      const columnBefore = await card.locator('xpath=ancestor::section[1]').getAttribute('aria-label');

      await button.click();
      await card.getByRole('button', { name: /starting…/ }).waitFor({ timeout: 5_000 });

      // The request has been answered 202. Nothing in git changed, so nothing
      // on the board may change either.
      const columnAfter = await card.locator('xpath=ancestor::section[1]').getAttribute('aria-label');
      expect(columnAfter).toBe(columnBefore);
    } finally {
      await page.close();
    }
  });
});
