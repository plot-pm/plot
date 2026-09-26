import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, scenario, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import { DRAFT_PLAN_NOTE, type Fleet } from '../../src/contract/schema.js';

/**
 * A Draft plan with no branch is SEEN in WAITING ON YOU — the browser half of
 * `a-draft-plan-asks-for-a-decision`. The row rule is asserted in
 * `test/unit/draft-plan-row.test.ts`; this proves the shipped artifact renders it.
 */
describe('a Draft plan asks for a decision (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const withDrafts = (): Fleet => {
    const { agents: _a, summary: _s, ...envelope } = scenario('ten-rows-one-kind-each').fleet;
    return buildFleet({
      ...envelope,
      draftPlans: [
        { plan: 'zucchini-glut', planFile: '2026-09-26-zucchini-glut.md', title: 'Zucchini glut', rounds: 0 },
        { plan: 'bean-trellis', planFile: '2026-09-26-bean-trellis.md', title: 'Bean trellis' },
        // `plant-tomatoes` already has branch rows in this scenario, so it must
        // not gain a second, plan-level row.
        { plan: 'plant-tomatoes', planFile: '2026-04-01-plant-tomatoes.md', title: 'Plant heirloom tomatoes', rounds: 2 },
      ],
    } as Partial<Fleet>);
  };

  it('renders one row per branchless Draft plan, naming its rounds and the note', async () => {
    const page = await cat.open('ten-rows-one-kind-each', { tab: 'agents', over: { fleet: withDrafts() } });
    try {
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const section = page.locator('section', { has: page.getByRole('heading', { level: 2, name: /Waiting on you/ }) });

      const zucchini = section.locator('[data-draft-plan-row="zucchini-glut"]');
      const beans = section.locator('[data-draft-plan-row="bean-trellis"]');
      await zucchini.waitFor({ timeout: 10_000 });
      await expect.poll(() => beans.count()).toBe(1);
      // The plan with branch rows appears through those rows, never twice.
      expect(await page.locator('[data-draft-plan-row="plant-tomatoes"]').count()).toBe(0);

      expect(await zucchini.textContent()).toContain(DRAFT_PLAN_NOTE);
      expect(await zucchini.textContent()).toContain('zucchini-glut');

      // A recorded 0 and an absent field are two statements and render apart.
      const zeroBadge = zucchini.locator('[data-draft-plan-rounds]');
      const absentBadge = beans.locator('[data-draft-plan-rounds]');
      expect(await zeroBadge.textContent()).toBe('0 rounds');
      expect(await zeroBadge.getAttribute('data-rounds')).toBe('recorded');
      expect(await absentBadge.textContent()).toBe('not interrogated');
      expect(await absentBadge.getAttribute('data-rounds')).toBe('absent');

      // No action: the row says a decision is owed and offers none.
      expect(await zucchini.locator('button').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
