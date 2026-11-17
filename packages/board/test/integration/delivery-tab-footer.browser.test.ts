import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { type AgentEntry, type Fleet } from '../../src/contract/schema.js';

/**
 * THE DELIVERY TAB FOOTER, in a real browser against the shipped artifact: the
 * line holds no desk path, `details` opens the paths by keyboard with
 * `aria-expanded` flipping, and a dot's word is its accessible name.
 */
const DESK = '/Users/someone/.worktrees/desk-abc123';

const agent = (): AgentEntry => ({
  session: '', identity: 'synthesized', branch: '', checkout: '', worktree: DESK,
  command: '', startedAt: '', pid: '', previousPid: '', relaunches: 0,
  state: 'elsewhere',
}) as AgentEntry;

const fleet = (): Fleet => ({
  agents: [agent()],
  generatedAt: new Date().toISOString(),
  ageSeconds: 1,
  readRefAge: 3,
  ready: true,
  complete: true,
  error: null,
  rows: [],
  summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  prAgeSeconds: 100,
  prIntervalMs: 120_000,
  prNextInSeconds: 20,
  scanNextInSeconds: 4,
  prError: null,
}) as unknown as Fleet;

describe('the Delivery tab footer (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;
  beforeAll(async () => { cat = await openCatalogue(); }, 60_000);
  afterAll(async () => { await cat?.close(); });

  const open = async (): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      route: {
        '**/api/fleet': (route) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }),
      },
    });
    await page.locator('[data-footer-line]').waitFor({ timeout: 10_000 });
    return page;
  };

  it('keeps the desk path out of the line, opens it by keyboard, and names each dot by its word', async () => {
    const page = await open();
    try {
      const line = page.locator('[data-footer-line]');
      expect(await line.textContent()).not.toContain(DESK);
      expect(await line.textContent()).toMatch(/1 desk not placed/);

      // The PR reading is 100 s old against a 120 s interval: fresh. The dot's name is its word.
      await expect.poll(() => line.getByRole('img', { name: 'fresh' }).count()).toBeGreaterThan(0);

      const details = page.getByRole('button', { name: 'details' });
      expect(await details.getAttribute('aria-expanded')).toBe('false');
      expect(await page.getByText(DESK).count()).toBe(0);

      await details.focus();
      await page.keyboard.press('Enter');
      expect(await details.getAttribute('aria-expanded')).toBe('true');
      await page.getByText(DESK).first().waitFor({ timeout: 5_000 });
      expect(await line.textContent()).not.toContain(DESK);

      await page.keyboard.press('Space');
      expect(await details.getAttribute('aria-expanded')).toBe('false');
      await expect.poll(() => page.getByText(DESK).count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
