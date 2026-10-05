import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, scenario, row as buildRow, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * THE LAST STEP OF `a-question-is-listed-as-waiting-on-you`, SEEN IN A BROWSER.
 *
 * The DECIDING is `classify` in `packages/board/src/server/fleet.ts`, unit
 * tested in `test/unit/fleet.test.ts` and `test/unit/broken-agent.test.ts`
 * against plain records with no browser, no host and no git. This file asserts
 * the last step and only the last step, exactly as `quiet-kinds-render.browser.
 * test.ts` does for QUIET's four kinds: **the row shows what the rule decided.**
 *
 * So this is the ONE browser test for the slice — a row is stated with the
 * group and note `classify` would have produced for a `running` worker with an
 * outstanding question, and the assertion is that a reader sees it in WAITING
 * ON YOU, carrying the question and its age.
 */
describe('a question moves its row into WAITING ON YOU, with its age', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const rows = [
    buildRow({
      branch: 'feature/asking',
      plan: 'garden',
      wave: 'asking-slice',
      state: 'wip',
      group: 'waiting-on-you',
      ageMinutes: 30,
      note: 'waiting on you: which adapter should the fallback use? · asked 4 hours ago',
    }),
  ];

  async function open(): Promise<Page> {
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { fleet: buildFleet({ ...envelope(), rows }) as Fleet },
    });
    // The HEADING, not any text reading "waiting on you" — the row's own note
    // says exactly that, so a bare text match is ambiguous between the two.
    await page.getByRole('heading', { level: 2, name: /Waiting on you/ }).waitFor({ timeout: 10_000 });
    return page;
  }

  /** The scenario's envelope with its own rows, agents and summary withheld. */
  function envelope() {
    const { agents: _a, summary: _s, rows: _r, ...rest } = scenario('ten-rows-one-kind-each').fleet;
    return rest;
  }

  const rowFor = (page: Page, branch: string) =>
    page.locator('[role="row"]').filter({ has: page.locator(`[data-branch="${branch}"]`) }).last();

  const group = (page: Page, label: string) =>
    page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: new RegExp(label) }),
    });

  it('lands the row in WAITING ON YOU, not WORKING', async () => {
    const page = await open();
    try {
      await expect.poll(() => group(page, 'Waiting on you').locator('[data-branch="feature/asking"]').count())
        .toBe(1);
      await expect.poll(() => group(page, '^Working').locator('[data-branch="feature/asking"]').count())
        .toBe(0);
    } finally {
      await page.close();
    }
  });

  it('shows the question and its age in the row', async () => {
    const page = await open();
    try {
      const li = rowFor(page, 'feature/asking');
      await expect.poll(() => li.textContent())
        .toContain('which adapter should the fallback use?');
      await expect.poll(() => li.textContent()).toContain('4 hours');
    } finally {
      await page.close();
    }
  });
});
