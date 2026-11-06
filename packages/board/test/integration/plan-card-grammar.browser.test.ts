import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board, card, column, type Catalogue } from '../catalogue/index.js';

/**
 * A PLAN CARD RENDERS THE CARD GRAMMAR — what only a rendered page can settle.
 *
 * `presentCard` decides the rows and the words, asserted in
 * `test/unit/card-presentation.test.ts` with no browser. This owns the half a
 * page states: the five rows land in their fixed order on screen, the tab order
 * runs title, primary, secondaries, expanders, and an expander is a
 * `<button aria-expanded>` that opens its list in place.
 */
const DRAFT = card({
  slug: 'grammar', title: 'The card grammar', phase: 'Discovery', status: 'draft',
  path: 'docs/plans/2026-11-06-grammar.md', assignee: 'jwloka', issues: ['3101'], rounds: 2,
  prs: [
    { number: 11, url: '', checks: 'green' },
    { number: 12, url: '', checks: 'unknown' },
  ],
});

const STARTABLE_COLD = card({
  slug: 'cold', title: 'Waiting for a scan', phase: 'Development', status: 'approved', started: false,
  path: 'docs/plans/2026-11-06-cold.md',
  sliceSummary: { slices: 2, branches: 2, deferred: 0 },
});

describe('a plan card renders the card grammar', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  const open = async (): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      over: {
        board: board({
          columns: [column({ phase: 'Discovery', cards: [DRAFT] }), column({ phase: 'Development', cards: [STARTABLE_COLD] })],
          dispatch: { available: true, reason: '' },
          approve: { available: true, reason: '' },
          interrogate: { available: true, reason: '' },
        }),
      },
      tab: 'board',
      viewport: { width: 1400, height: 1200 },
    });
    await page.locator('#plan-grammar').waitFor({ timeout: 10_000 });
    return page;
  };

  it('shows the five rows in their fixed order on screen', async () => {
    const page = await open();
    try {
      const tops = await page.locator('#plan-grammar [data-card-row]').evaluateAll((els) =>
        els.map((el) => ({ row: el.getAttribute('data-card-row'), top: el.getBoundingClientRect().top })),
      );
      const order = [...tops].sort((a, b) => a.top - b.top).map((t) => t.row);
      expect(order).toEqual(['identity', 'progress', 'next', 'ownership']);
      expect(await page.locator('#plan-grammar [data-card-row="next"]').getAttribute('data-emphasis')).toBe('true');
    } finally {
      await page.close();
    }
  });

  it('tabs through title, primary, secondaries, then expanders', async () => {
    const page = await open();
    try {
      await page.locator('#plan-grammar [data-card-title]').focus();
      const focused: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        focused.push(await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return '';
          if (el.hasAttribute('data-card-title')) return 'title';
          if (el.hasAttribute('aria-expanded')) return `expander:${el.getAttribute('data-expander')}`;
          return `action:${el.closest('[data-action-slot]')?.getAttribute('data-action-slot') ?? '?'}:${el.textContent?.trim()}`;
        }));
        await page.keyboard.press('Tab');
      }
      expect(focused).toEqual(['title', 'action:primary:Approve', 'action:secondary:Interrogate', 'expander:prs']);
    } finally {
      await page.close();
    }
  });

  it('a PR list expands in place under a button carrying aria-expanded, and an unknown reads checks unknown', async () => {
    const page = await open();
    try {
      const expander = page.locator('#plan-grammar [data-expander="prs"]');
      expect(await expander.evaluate((el) => el.tagName)).toBe('BUTTON');
      expect(await expander.getAttribute('aria-expanded')).toBe('false');
      expect(await expander.textContent()).toBe('2 PRs · 1 checks unknown');
      expect(await page.locator('#plan-grammar [data-pr-number="12"]').isVisible()).toBe(false);
      await expander.click();
      expect(await expander.getAttribute('aria-expanded')).toBe('true');
      expect(await page.locator('#plan-grammar [data-pr-number="12"]').textContent()).toBe('#12 checks unknown');
    } finally {
      await page.close();
    }
  });

  it('a disabled Start work names its reason on the card, not only on hover', async () => {
    const page = await open();
    try {
      const slot = page.locator('#plan-cold [data-action="start-work"]');
      expect(await slot.getByRole('button', { name: 'Start work' }).getAttribute('aria-disabled')).toBe('true');
      const reason = slot.locator('[data-action-reason]');
      expect(await reason.isVisible()).toBe(true);
      expect(await reason.textContent()).toContain('no fleet scan yet');
    } finally {
      await page.close();
    }
  });
});
