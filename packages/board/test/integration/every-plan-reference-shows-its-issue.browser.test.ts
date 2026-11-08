import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import {
  openCatalogue, board as buildBoard, card as buildCard, column, type Catalogue,
} from '../catalogue/index.js';

/**
 * EVERY PLAN REFERENCE SHOWS ITS ISSUE — the panels half. The prefix rule is
 * asserted in `test/unit/panels-show-the-prefix.test.ts`; this proves the
 * shipped artifact prints it wherever the Planning tab names a plan.
 *
 * The plan's title differs from its slug and its file name, so a leaf element
 * whose text carries the title is a place the board NAMES the plan. Each such
 * element must sit inside `[data-plan-ref]` and start with the tracker key.
 */
const TITLE = 'Mulch the herb beds';

describe('every plan reference shows its issue (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (): Promise<Page> => cat.open('an-empty-estate', {
    over: {
      board: buildBoard({
        columns: [column({
          phase: 'Development',
          cards: [buildCard({
            slug: 'mulch-beds', title: TITLE, type: 'feature', phase: 'Development',
            path: 'docs/plans/2026-09-30-mulch-beds.md', prs: [], phaseDate: '2026-09-30',
            issues: ['1089'],
          })],
        })],
      }),
    },
    tab: 'planning',
    viewport: { width: 1400, height: 1400 },
  });

  it('prints the tracker key before the title on every element that names the plan', async () => {
    const page = await open();
    try {
      await expect.poll(
        () => page.locator('[data-plan-ref]').count(), { timeout: 10_000 },
      ).toBeGreaterThan(0);
      // Every element whose OWN text names the plan, and the reference it sits
      // in: the card's title styles the key apart, so the key and the title
      // are sibling nodes of one reference rather than one leaf.
      const named = await page.evaluate((title) => {
        const owners = [...document.querySelectorAll('body *')]
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').includes(title)));
        return owners.map((el) => {
          const ref = el.closest('[data-plan-ref]');
          // A card's title names the key on its meta line and in its title attribute.
          const card = el.closest('[data-card]');
          const text = card && ref
            ? (ref.getAttribute('title') ?? '')
            : ((ref ?? el).textContent ?? '').trim();
          return { text, inRef: ref !== null, metaKey: card?.querySelector('[data-key]')?.textContent ?? null };
        });
      }, TITLE);
      expect(named.length).toBeGreaterThan(0);
      expect(named.filter((n) => !n.inRef)).toEqual([]);
      for (const n of named) expect(n.text.startsWith('1089: ')).toBe(true);
      // On the card, the number itself shows on the meta line under the title.
      for (const n of named.filter((x) => x.metaKey !== null)) expect(n.metaKey).toBe('#1089');
    } finally { await page.close(); }
  });
});
