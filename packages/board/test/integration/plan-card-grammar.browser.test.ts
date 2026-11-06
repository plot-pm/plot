import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board, card, column, type Catalogue } from '../catalogue/index.js';
import { GLYPH_PATH } from '../../src/app/lib/glyphs.js';

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
  path: 'docs/plans/2026-11-06-cold.md', sprint: 'card-alignment',
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

  it('leads the title row with the plan kind icon, named Plan, and its type as a tag', async () => {
    const page = await open();
    try {
      const identity = page.locator('#plan-grammar [data-card-row="identity"]');
      expect(await identity.getByRole('img', { name: 'Plan' }).count()).toBe(1);
      expect(await identity.locator('[data-type="feature"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('draws the kind icons from the board\'s Octicon table, as large as the text beside them', async () => {
    const page = await open();
    try {
      const identity = page.locator('#plan-grammar [data-card-row="identity"]');
      const sizes = await identity.evaluate((row) => {
        const icon = row.querySelector('svg[data-kind-icon="plan"]')!.getBoundingClientRect();
        const title = row.querySelector('[data-card-title]')!;
        const titleBox = title.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
        return {
          icon: icon.height,
          font: parseFloat(getComputedStyle(title).fontSize),
          // The icon's centre against the centre of the title's first line.
          offset: (icon.top + icon.height / 2) - (titleBox.top + lineHeight / 2),
        };
      });
      expect(Math.abs(sizes.icon - sizes.font)).toBeLessThanOrEqual(1);
      expect(Math.abs(sizes.offset)).toBeLessThanOrEqual(1);
      expect(await identity.locator('svg[data-kind-icon="plan"] path').getAttribute('d')).toBe(GLYPH_PATH.plan);

      const sprint = page.locator('#plan-cold [data-lineage="sprints"]');
      expect(await sprint.locator('svg path').getAttribute('d')).toBe(GLYPH_PATH.sprint);
      const linkSizes = await sprint.evaluate((el) => ({
        icon: el.querySelector('svg')!.getBoundingClientRect().height,
        font: parseFloat(getComputedStyle(el).fontSize),
      }));
      expect(Math.abs(linkSizes.icon - linkSizes.font)).toBeLessThanOrEqual(1);
    } finally {
      await page.close();
    }
  });

  it('sets the action band apart: a top divider and its own tint', async () => {
    const page = await open();
    try {
      const band = page.locator('#plan-grammar [data-action-band]');
      const style = await band.evaluate((el) => {
        const s = getComputedStyle(el);
        return { border: s.borderTopWidth, bg: s.backgroundColor, card: getComputedStyle(el.closest('article')!).backgroundColor };
      });
      expect(style.border).not.toBe('0px');
      expect(style.bg).not.toBe(style.card);
    } finally {
      await page.close();
    }
  });

  it('a disabled Start work is a focusable control whose reason opens on focus and hover, and closes on Escape', async () => {
    const page = await open();
    try {
      const slot = page.locator('#plan-cold [data-action="start-work"]');
      const button = slot.getByRole('button', { name: 'Start work' });
      const reason = slot.locator('[role="tooltip"]');
      expect(await button.getAttribute('aria-disabled')).toBe('true');
      expect(await button.getAttribute('title')).toBeNull();
      expect(await button.getAttribute('aria-describedby')).toBe(await reason.getAttribute('id'));
      expect(await reason.isVisible()).toBe(false);

      // Keyboard: tab from the title reaches the disabled control, and focus opens the reason.
      await page.locator('#plan-cold [data-card-title]').focus();
      await page.keyboard.press('Tab');
      expect(await button.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await reason.isVisible()).toBe(true);
      expect(await reason.textContent()).toBe('no fleet scan yet');
      await page.keyboard.press('Escape');
      expect(await reason.isVisible()).toBe(false);

      // It opens below the control, never over the facts above it. Focus moves
      // away and back, because Escape closed it while the control kept focus.
      await page.locator('#plan-cold [data-card-title]').focus();
      await button.focus();
      expect(await reason.isVisible()).toBe(true);
      const boxes = await slot.evaluate((el) => ({
        control: el.querySelector('button')!.getBoundingClientRect().bottom,
        tip: el.querySelector('[role="tooltip"]')!.getBoundingClientRect().top,
      }));
      expect(boxes.tip).toBeGreaterThanOrEqual(boxes.control);
      await page.keyboard.press('Escape');

      // Pointer: hover opens it too.
      await page.locator('#plan-cold [data-card-title]').focus();
      await button.hover();
      expect(await reason.isVisible()).toBe(true);
    } finally {
      await page.close();
    }
  });
});
