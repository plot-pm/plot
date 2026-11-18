import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, scenario, fleet, row, type Catalogue } from '../catalogue/index.js';

/**
 * A PERSON'S UNANSWERED COMMENT — what is seen.
 *
 * Whether the arm fires is decided by `personCommentHolds` and `youCase` in the
 * domain and asserted in `person-comment.test.ts` and `delivery-placement.test.ts`.
 * This file proves the result reaches the page: a fired PR sits under Blocks
 * delivery with the person-comment Status word, and an unfired one does not.
 */
describe('a person-comment row', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  const prOf = (number: number, personComment?: { head: string; at: string }) => ({
    number, url: `https://github.com/tiny/garden/pull/${number}`, draft: false, state: 'green' as const,
    ciChecks: 'green' as const, plotReview: 'success' as const,
    headSha: 'aaaa1111', updatedAt: '2026-11-18T10:00:00.000Z',
    ...(personComment ? { personComment } : {}),
  });

  it('shows a fired PR under Blocks delivery with the comment status, and an unfired one elsewhere', async () => {
    const base = scenario('a-full-estate');
    const fired = row({
      branch: 'feature/has-a-comment', plan: 'comment-plan', wave: 'Comment', group: 'waiting-on-you', ageMinutes: 5,
      pr: prOf(141, { head: 'aaaa1111', at: '2026-11-18T10:30:00.000Z' }),
    });
    const quiet = row({
      branch: 'feature/no-comment', plan: 'quiet-plan', wave: 'Quiet', group: 'waiting-on-you', ageMinutes: 5,
      pr: prOf(142),
    });
    const page = await cat.open('a-full-estate', {
      tab: 'agents',
      over: { fleet: fleet({ ...base.fleet, rows: [...base.fleet.rows, fired, quiet] }) },
    });
    try {
      await page.locator('[data-delivery-section]').first().waitFor({ timeout: 15_000 });
      await expandAgentFolds(page);
      const inBlocks = page.locator('[data-section="you"] [data-group="blocks-delivery"]');
      await inBlocks.first().waitFor({ timeout: 15_000 });
      const firedRow = inBlocks.locator('li').filter({ has: page.locator('[data-branch="feature/has-a-comment"]') }).last();
      expect(await firedRow.count()).toBe(1);
      expect((await firedRow.innerText()).toLowerCase()).toContain('comment');
      const quietInBlocks = inBlocks.locator('li').filter({ has: page.locator('[data-branch="feature/no-comment"]') });
      expect(await quietInBlocks.count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});
