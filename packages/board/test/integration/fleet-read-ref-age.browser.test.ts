// The Delivery tab's own "scanned Ns ago" line, driven by `fleet.readRefAge` —
// not `fleet.ageSeconds`, which dates the server's 5 s scan cadence rather
// than the last successful ref fetch. See `AgentList.tsx`'s comment at the
// line this test asserts against.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openCatalogue, board as buildBoard, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';

describe('the Delivery tab\'s "scanned Ns ago" line reads fleet.readRefAge', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  it('shows exactly "scanned 40s ago" for readRefAge: 40', async () => {
    const page = await cat.open('an-empty-estate', {
      tab: 'delivery',
      over: {
        board: buildBoard(),
        fleet: buildFleet({ ageSeconds: 0, readRefAge: 40 }),
      },
    });
    try {
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
      await expect
        .poll(() => page.getByText('scanned 40s ago', { exact: false }).count(), { timeout: 10_000 })
        .toBe(1);
    } finally {
      await page.close();
    }
  });

  it('shows no scanned age for readRefAge: null', async () => {
    const page = await cat.open('an-empty-estate', {
      tab: 'delivery',
      over: {
        board: buildBoard(),
        fleet: buildFleet({ ageSeconds: 0, readRefAge: null }),
      },
    });
    try {
      await page.getByRole('heading', { name: 'Plot' }).waitFor({ timeout: 10_000 });
      await expect
        .poll(() => page.getByText('branches across', { exact: false }).count(), { timeout: 10_000 })
        .toBe(1);
      expect(await page.getByText('scanned', { exact: false }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
