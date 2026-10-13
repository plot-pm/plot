import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { type Board, type Card } from '../../src/contract/schema.js';

/**
 * A DESIGN PLAN'S CARD READS ITS SPIKE — what only a rendered page can settle.
 *
 * The unit suite owns the decision (`spikeCardState`, `cardControls`). This
 * owns the half a page states: the line shows the domain's wording, and the
 * *Confirm slices and approve* control appears once — and only once — the spike
 * has merged. Interrogate stays on the card in every state, because it reads
 * `controls.interrogate` and not the Approve control.
 *
 * `/api/board` is served from the mock, so every claim is about what the tab
 * renders from a board payload.
 */
const controls = (spikeState: string | null, over: Record<string, unknown> = {}) => ({
  approve: spikeState === null || spikeState === 'spike-merged',
  needsDesign: false, interrogate: true, commission: false, roundsBadge: false,
  dispatch: false, readyToStart: false,
  approveSpike: spikeState === 'spike-not-approved',
  confirmSlices: spikeState === 'spike-merged',
  spikeState,
  ...over,
});

const card = (spikeState: string | null): Card => ({
  slug: 'greenhouse', title: 'greenhouse', type: 'feature', phase: 'Design', path: 'p-greenhouse.md', prs: [],
  controls: controls(spikeState),
}) as unknown as Card;

const board = (c: Card) => ({
  generatedAt: new Date().toISOString(),
  columns: [{ phase: 'Design', cards: [c] }],
  checklist: [], sprints: [], stories: [],
  dispatch: { available: true, reason: '' },
  approve: { available: true, reason: '' },
  continue: { available: false, reason: '' },
  idea: { available: false, reason: '' },
  commission: { available: true, reason: '' },
  interrogate: { available: true, reason: '' },
  server: { restartCommand: '', port: 0 },
});

describe('a Design plan card states where its spike stands', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  const open = async (spikeState: string | null): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      over: { board: board(card(spikeState)) as unknown as Board },
      tab: 'board',
      viewport: { width: 1400, height: 1200 },
    });
    await page.locator('article', { hasText: 'greenhouse' }).first().waitFor({ timeout: 10_000 });
    return page;
  };
  const article = (page: Page) => page.locator('article', { hasText: 'greenhouse' });

  it('offers Approve spike and no plan approval before the spike is approved', async () => {
    const page = await open('spike-not-approved');
    try {
      await expect.poll(() => article(page).locator('[data-spike-state="spike-not-approved"]').count()).toBe(1);
      expect(await article(page).getByRole('button', { name: 'Approve spike' }).count()).toBe(1);
      expect(await article(page).getByRole('button', { name: 'Confirm slices and approve' }).count()).toBe(0);
      expect(await article(page).getByRole('button', { name: 'Approve', exact: true }).count()).toBe(0);
      expect(await article(page).locator('[data-interrogate="greenhouse"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers no approval while the approved spike has not merged', async () => {
    const page = await open('spike-approved');
    try {
      await expect.poll(() => article(page).locator('[data-spike-state="spike-approved"]').count()).toBe(1);
      expect(await article(page).getByRole('button', { name: /Approve|Confirm slices/ }).count()).toBe(0);
      expect(await article(page).locator('[data-interrogate="greenhouse"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers Confirm slices and approve once the spike has merged', async () => {
    const page = await open('spike-merged');
    try {
      await expect.poll(() => article(page).locator('[data-spike-state="spike-merged"]').count()).toBe(1);
      expect(await article(page).getByRole('button', { name: 'Confirm slices and approve' }).count()).toBe(1);
      expect(await article(page).getByRole('button', { name: 'Approve', exact: true }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('keeps a spike-less Design plan\'s plain Approve and shows no spike line', async () => {
    const page = await open(null);
    try {
      await expect.poll(() => article(page).getByRole('button', { name: 'Approve', exact: true }).count()).toBe(1);
      expect(await article(page).locator('[data-spike-state]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
