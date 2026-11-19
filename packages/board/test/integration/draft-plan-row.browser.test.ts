import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, scenario, board as buildBoard, card, column, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import { DRAFT_PLAN_NOTE, type Fleet } from '../../src/contract/schema.js';

/**
 * A Draft plan with no branch is SEEN in You › Input to the fleet — the browser half of
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
      await page.locator('[data-delivery-section="you"]').waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const section = page.locator('[data-group="input-to-the-fleet"]');

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
      // The two shapes differ in style too: one restyle for both passes every text assertion above.
      const shape = (el: Element) => {
        const s = getComputedStyle(el);
        return { border: s.borderTopStyle, italic: s.fontStyle, fill: s.backgroundColor };
      };
      const zeroShape = await zeroBadge.evaluate(shape);
      const absentShape = await absentBadge.evaluate(shape);
      expect(zeroShape.border).not.toBe('dashed');
      expect(zeroShape.italic).toBe('normal');
      expect(zeroShape.fill).not.toBe('rgba(0, 0, 0, 0)');
      expect(absentShape.border).toBe('dashed');
      expect(absentShape.italic).toBe('italic');
      expect(absentShape.fill).toBe('rgba(0, 0, 0, 0)');

      // No action: the row says a decision is owed and offers none.
      expect(await zucchini.locator('button').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('shows a plan of five slices and no pulse rows as one row with its chips and the You headers', async () => {
    const { agents: _a, summary: _s, ...envelope } = scenario('ten-rows-one-kind-each').fleet;
    const fleet = buildFleet({
      ...envelope,
      draftPlans: [{
        plan: 'bean-trellis', planFile: '2026-09-26-bean-trellis.md', title: 'Bean trellis',
        openQuestions: { count: 3, first: 'Which wire gauge?' },
      }],
    } as Partial<Fleet>);
    const board = buildBoard({
      columns: [column({
        phase: 'Draft',
        cards: [card({
          slug: 'bean-trellis', title: 'Bean trellis', path: 'docs/plans/2026-09-26-bean-trellis.md',
          sliceSummary: { slices: 5, branches: 5, deferred: 0 },
        } as never)],
      })],
    });
    const page = await cat.open('ten-rows-one-kind-each', { tab: 'agents', over: { fleet, board } });
    try {
      await page.locator('[data-delivery-section="you"]').waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const row = page.locator('[data-draft-plan-row="bean-trellis"]');
      await row.waitFor({ timeout: 10_000 });
      expect(await page.locator('[data-draft-plan-row="bean-trellis"]').count()).toBe(1);
      expect(await row.locator('[data-draft-plan-slices]').textContent()).toBe('5 slices');
      expect(await row.locator('[data-draft-plan-questions]').textContent()).toBe('3 open');
      expect(await row.locator('[data-draft-plan-first-question]').textContent()).toContain('Which wire gauge?');
      expect(await row.locator('[data-draft-plan-more]').textContent()).toBe('+2 more');
      const headers = await page.locator('[data-you-header] [role="columnheader"]').allTextContents();
      expect(headers.slice(0, 5)).toEqual(['Kind', 'Item', 'Status', 'Do', 'Age']);
    } finally {
      await page.close();
    }
  });

  it('colours the open-questions chip by the domain tone: amber where a question is open, the body colour at 0', async () => {
    const { agents: _a, summary: _s, ...envelope } = scenario('ten-rows-one-kind-each').fleet;
    const fleet = buildFleet({
      ...envelope,
      draftPlans: [
        { plan: 'bean-trellis', planFile: '2026-09-26-bean-trellis.md', title: 'Bean trellis', openQuestions: { count: 3, first: 'Which wire gauge?' } },
        { plan: 'zucchini-glut', planFile: '2026-09-26-zucchini-glut.md', title: 'Zucchini glut', openQuestions: { count: 0, first: null } },
      ],
    } as Partial<Fleet>);
    const page = await cat.open('ten-rows-one-kind-each', { tab: 'agents', over: { fleet } });
    try {
      await page.locator('[data-delivery-section="you"]').waitFor({ timeout: 10_000 });
      await expandAgentFolds(page);
      const token = (t: string) => page.evaluate((name) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      }, t);
      const chip = (plan: string) => page.locator(`[data-draft-plan-row="${plan}"] [data-draft-plan-questions]`);
      await chip('bean-trellis').waitFor({ timeout: 10_000 });
      expect(await chip('bean-trellis').textContent()).toBe('3 open');
      expect(await chip('zucchini-glut').textContent()).toBe('0 open');
      const colour = (plan: string) => chip(plan).evaluate((el) => getComputedStyle(el).color);
      expect(await colour('bean-trellis')).toBe(await token('--hue-amber'));
      expect(await colour('zucchini-glut')).toBe(await token('--card-body'));
    } finally {
      await page.close();
    }
  });
});
