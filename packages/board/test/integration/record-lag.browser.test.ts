import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from 'playwright';
import { openCatalogue, board, card, column, type Catalogue } from '../catalogue/index.js';
import { lagLine, removedKeyFinding } from '@plot-pm/domain/rules/record-ref';

/**
 * THE BOARD SHOWS THE RECORD LAG LINE AND THE REMOVED-KEY FINDING.
 *
 * The wording is the domain's (`lagLine`, `removedKeyFinding`, unit-tested in
 * `packages/domain/test/record-ref.test.ts`); this file proves the page draws
 * what the payload carries, and draws nothing where the payload carries null.
 */
const planSource = { ref: 'origin/main', resolved: true, localOnly: 0, behind: null };
const cards = [
  card({ slug: 'a-plan', title: 'a-plan', type: 'bug', phase: 'Development', path: 'docs/plans/2026-11-08-a-plan.md', phaseDate: '2026-11-08' }),
];

describe('the board shows how far the records are ahead', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  const open = async (extra: Parameters<typeof board>[0]): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      over: { board: board({ planSource, columns: [column({ phase: 'Development', cards })], ...extra }) },
    });
    await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
    return page;
  };

  it('shows the lag line with "none" for a sync PR that does not exist', async () => {
    const line = lagLine(3, null, 'main');
    const page = await open({ recordLag: line });
    try {
      const shown = page.locator('[data-record-lag]');
      expect(await shown.getAttribute('data-record-lag')).toBe('3');
      expect(await shown.textContent()).toBe('Records: 3 ahead of main · sync PR: none');
    } finally { await page.close(); }
  });

  it('shows the removed-key finding as a row', async () => {
    const finding = removedKeyFinding('', 'main', 2);
    const page = await open({ recordKeyRemoved: finding });
    try {
      const shown = page.locator('[data-record-key-removed]');
      expect(await shown.getAttribute('data-record-key-removed')).toBe('2');
      expect(await shown.textContent()).toBe(finding?.text);
    } finally { await page.close(); }
  });

  it('shows neither where the payload carries none', async () => {
    const page = await open({});
    try {
      expect(await page.locator('[data-record-lag]').count()).toBe(0);
      expect(await page.locator('[data-record-key-removed]').count()).toBe(0);
    } finally { await page.close(); }
  });
});
