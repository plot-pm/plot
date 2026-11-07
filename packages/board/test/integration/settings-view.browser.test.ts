import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

/**
 * The gear is SEEN: with no passkey registered it carries its marker and opens
 * Settings. The rule that decides the wording is unit-tested in
 * `passkey-settings.test.ts`; this test proves the page shows it. WebAuthn is
 * not called: the test asserts what is shown and registers nothing.
 */
describe('the settings view', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  const open = (tab: 'delivery' | 'planning'): Promise<Page> =>
    cat.open('an-empty-estate', {
      tab,
      route: {
        '**/api/passkey': (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registered: false }) }),
      },
    });

  it('marks the gear while no passkey is registered and opens Settings with a Register button', async () => {
    const page = await open('planning');
    try {
      const gear = page.getByRole('button', { name: 'Settings' });
      await expect.poll(() => gear.getAttribute('data-passkey-unregistered'), { timeout: 10_000 }).toBe('');
      await gear.click();
      expect(page.url()).toContain('settings=1');
      await expect.poll(() => page.getByText('No passkey registered').count(), { timeout: 10_000 }).toBeGreaterThan(0);
      expect(await page.getByRole('button', { name: 'Register', exact: true }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('keeps the tab in the URL when Settings closes', async () => {
    const page = await open('delivery');
    try {
      await page.getByRole('button', { name: 'Settings' }).click();
      expect(page.url()).toContain('tab=delivery');
      await page.getByRole('button', { name: 'Close' }).click();
      expect(page.url()).toContain('tab=delivery');
      expect(page.url()).not.toContain('settings=1');
    } finally {
      await page.close();
    }
  });
});
