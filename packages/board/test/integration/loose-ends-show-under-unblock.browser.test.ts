import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openCatalogue, scenario, fleet, row, type Catalogue } from '../catalogue/index.js';

/**
 * A LOOSE BRANCH SHOWS ITS ACTIONS — what is seen.
 *
 * Whether a branch is loose is decided by `looseOf` in the domain and asserted in
 * `delivery-placement.test.ts` and `delivery-readings.test.ts`. This file proves
 * the result reaches the page: the row sits under You, carries the reason, and
 * shows a release and a delete button.
 */
describe('a loose branch under You > Unblock', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  it('shows the reason and the release and delete buttons', async () => {
    const base = scenario('a-full-estate');
    const loose = row({
      branch: 'feature/nobody-wants-this', plan: '', wave: '', group: 'quiet', state: 'wip', worker: 'elsewhere', desk: false,
      ageMinutes: 900, pr: null,
    });
    const page = await cat.open('a-full-estate', {
      tab: 'agents',
      over: { fleet: fleet({ ...base.fleet, rows: [...base.fleet.rows, loose] }) },
    });
    try {
      await page.locator('[data-placement-reason="loose"]').waitFor({ timeout: 15_000 });
      const actions = page.locator('[data-section="you"] [data-loose-actions]');
      expect(await actions.count()).toBe(1);
      expect(await actions.locator('[data-release-claim]').count()).toBe(1);
      expect(await actions.locator('[data-loose-delete]').count()).toBe(1);
      expect(await actions.locator('[data-loose-delete]').getAttribute('aria-label')).toContain('feature/nobody-wants-this');
    } finally {
      await page.close();
    }
  }, 60_000);
});
