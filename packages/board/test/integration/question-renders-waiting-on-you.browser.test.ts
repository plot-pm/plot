import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, scenario, row as buildRow, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * A row whose desk holds a question renders under You › Unblock with the note
 * the server produced. The mapper reads the row's `question` as a blocked
 * marker, and `placeDelivery` is unit tested in
 * `packages/domain/test/delivery-placement.test.ts`; this test checks
 * rendering only.
 */
describe('a question moves its row into You › Unblock, with its age', () => {
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
      question: { firstLine: 'which adapter should the fallback use?', askedAt: '2026-10-05T13:36:00.000Z' },
    }),
    buildRow({
      branch: 'feature/escalated',
      plan: 'orchard',
      wave: 'escalated-slice',
      state: 'wip',
      group: 'waiting-on-you',
      ageMinutes: 30,
      note: 'waiting on you: should the scan keep its cache? · asked 4 hours ago · escalated: test',
      question: { firstLine: 'should the scan keep its cache?', askedAt: '2026-10-05T13:36:00.000Z' },
    }),
  ];

  /** The scenario's envelope with its own rows, agents and summary withheld. */
  const envelope = () => {
    const { agents: _a, summary: _s, rows: _r, ...rest } = scenario('ten-rows-one-kind-each').fleet;
    return rest;
  };

  const open = async (): Promise<Page> => {
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { fleet: buildFleet({ ...envelope(), rows }) as Fleet },
    });
    // The section HEADING, not any text reading "waiting on you" — the row's
    // own note says exactly that, so a bare text match is ambiguous.
    await page.locator('[data-delivery-section="you"]').waitFor({ timeout: 10_000 });
    return page;
  };

  const rowFor = (page: Page, branch: string) =>
    page.locator('[role="row"]').filter({ has: page.locator(`[data-branch="${branch}"]`) }).last();

  const group = (page: Page, key: string) => page.locator(`[data-group="${key}"]`);
  const section = (page: Page, key: string) => page.locator(`[data-section="${key}"]`);

  it('lands the row in You › Unblock, not under Work items', async () => {
    const page = await open();
    try {
      await expect.poll(() => group(page, 'unblock').locator('[data-branch="feature/asking"]').count())
        .toBe(1);
      await expect.poll(() => section(page, 'work-items').locator('[data-branch="feature/asking"]').count())
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

  it('shows the escalation reason in the row', async () => {
    const page = await open();
    try {
      const li = rowFor(page, 'feature/escalated');
      await expect.poll(() => li.textContent()).toContain('escalated: test');
    } finally {
      await page.close();
    }
  });
});
