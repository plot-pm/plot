import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { board, card, column } from '../catalogue/build.js';

/**
 * WHAT THE COST BADGE SHOWS — the half only a real page can settle.
 *
 * The badge's WORDS are pure functions pinned without a browser in
 * `test/unit/plan-cost.test.ts`: every edge case of `costBadgeText` and
 * `costBadgeDetail` is asserted there, which is this repo's standing rule that
 * a view state which cannot be tested without a browser has not been extracted
 * yet. What is left for a page, and only for a page:
 *
 * - that the badge is actually RENDERED on the card rather than computed into a
 *   payload nobody displays — the defect `planSpend` shipped with, where the
 *   rollup was correct and no human being could see it;
 * - that the rendered text contains NO COUNTER VALUE, which is the assertion
 *   the plan names. A card that "technically shows the cost" by printing
 *   40,690,450 satisfies every unit test about the data and defeats the design:
 *   the counters span five orders of magnitude, so a two-second reader takes
 *   the largest as the total even though nothing summed it;
 * - that the counters remain REACHABLE without leaving the board, on the
 *   badge's own tooltip, so the refusal to show them at a glance is not a
 *   refusal to show them.
 *
 * `/api/board` is served from the catalogue, so each claim is about what the
 * page RENDERS from a payload the schema validated.
 */

/** The real shape from a measured plan — five orders of magnitude apart. */
const MEASURED = {
  tokens: {
    inputTokens: 502,
    outputTokens: 107_182,
    cacheCreationTokens: 528_331,
    cacheReadTokens: 40_690_450,
  },
  measured: 3,
  absent: 2,
  unreadable: 0,
  slices: 5,
};

/** Every digit sequence a counter could put on screen, grouped or not. */
const COUNTER_VALUES = [
  '502', '107182', '107,182', '528331', '528,331', '40690450', '40,690,450',
];

let cat: Catalogue;
beforeAll(async () => { cat = await openCatalogue(); });
afterAll(async () => { await cat.close(); });

/** A one-column board whose single card carries `cost`. */
const withCost = (cost: unknown) =>
  board({
    columns: [column({
      phase: 'Development',
      cards: [card({
        slug: 'measured-plan', title: 'Measured plan', phase: 'Development',
        path: 'docs/plans/2026-09-16-measured-plan.md',
        ...(cost === undefined ? {} : { cost }),
      } as never)],
    })],
  });

describe('the cost badge on a plan card', () => {
  it('shows COVERAGE and no counter value', async () => {
    const page = await cat.open('a-board-of-plans', {
      over: { board: withCost(MEASURED) },
      tab: 'board',
    });
    const cardText = await page
      .locator('article', { hasText: 'Measured plan' })
      .first()
      .innerText();

    expect(cardText).toContain('measured on 3 of 5 slices');
    for (const value of COUNTER_VALUES) {
      expect(cardText).not.toContain(value);
    }
    await page.close();
  });

  it('keeps the four counters reachable, on the badge tooltip', async () => {
    // DEFERRED, NOT WITHHELD. Over-correcting into hiding the data is the
    // failure on the other side of the one above, and it is pinned separately
    // for that reason.
    const page = await cat.open('a-board-of-plans', {
      over: { board: withCost(MEASURED) },
      tab: 'board',
    });
    const tip = await page
      .locator('span[title*="cache-read"]')
      .first()
      .getAttribute('title');

    expect(tip).toContain('40,690,450');
    expect(tip).toContain('in 502');
    expect(tip).toContain('3 of 5 slices measured');
    await page.close();
  });

  it('says NOT MEASURED HERE for a plan with nothing measured, never a zero', async () => {
    const page = await cat.open('a-board-of-plans', {
      over: {
        board: withCost({ tokens: null, measured: 0, absent: 2, unreadable: 0, slices: 2 }),
      },
      tab: 'board',
    });
    const cardText = await page
      .locator('article', { hasText: 'Measured plan' })
      .first()
      .innerText();

    expect(cardText).toContain('not measured here');
    // A ZERO IS THE FAILURE THE WHOLE DESIGN AVOIDS — indistinguishable from a
    // free run, and wrong in the direction nobody checks.
    expect(cardText).not.toMatch(/\b0 (tokens|slices)\b/);
    await page.close();
  });

  it('renders exactly as today for a payload carrying no cost', async () => {
    // Every existing board must be unaffected: a server too old to have looked
    // sends no field at all, which is a third state apart from null and zero.
    const page = await cat.open('a-board-of-plans', {
      over: { board: withCost(undefined) },
      tab: 'board',
    });
    const cardText = await page
      .locator('article', { hasText: 'Measured plan' })
      .first()
      .innerText();

    expect(cardText).not.toContain('measured on');
    expect(cardText).not.toContain('not measured here');
    await page.close();
  });
});
