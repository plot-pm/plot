import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, scenario, row as buildRow, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * A green draft slice PR with no live Agent, seen in a browser.
 *
 * The section and the sentence are decided by `awaitsMarkReady` and asserted in
 * `packages/domain/test/pr-row.test.ts` and
 * `test/unit/a-green-draft-slice-waits-on-you.test.ts`. This file states the row
 * and asserts the last step only: the Waiting on you section shows it.
 */
describe('the board shows a green draft slice PR waiting to be marked ready', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const rows = [
    buildRow({
      branch: 'bug/green-draft', plan: 'garden', wave: 'green-draft-slice', state: 'wip', group: 'waiting-on-you',
      ageMinutes: 600, note: 'PR #2310, draft, green · mark ready',
      pr: { number: 2310, url: 'https://github.com/tiny/garden/pull/2310', draft: true, state: 'green' },
    }),
  ];

  const open = async (): Promise<Page> => {
    const { agents: _a, summary: _s, rows: _r, ...rest } = scenario('ten-rows-one-kind-each').fleet;
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { fleet: buildFleet({ ...rest, rows }) as Fleet },
    });
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  };

  it('lists the draft in Waiting on you with the action mark ready', async () => {
    const page = await open();
    try {
      const waiting = page.locator('section').filter({
        has: page.getByRole('heading', { level: 2, name: /Waiting on you/ }),
      });
      await expect.poll(() => waiting.getByText('bug/green-draft').count()).toBeGreaterThan(0);
      const li = page.locator('[role="row"]').filter({ has: page.locator('[data-branch="bug/green-draft"]') }).last();
      await expect.poll(() => li.textContent()).toContain('mark ready');
    } finally {
      await page.close();
    }
  });
});
