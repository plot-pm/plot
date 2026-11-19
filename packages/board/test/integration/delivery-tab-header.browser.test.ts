import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, scenario, fleet, row, type Catalogue } from '../catalogue/index.js';

/**
 * THE TAB HEADER'S LAYOUT AND ONE OF ITS COLOURS, IN A REAL BROWSER.
 *
 * `delivery-header.css` puts the to-do column beside the status column from
 * 768 px up and stacks them below, and colours a to-do verb by its marker. A
 * utility left on the element would win silently over neither, so both are read
 * as computed boxes and styles from the shipped artifact.
 */

describe('the Delivery tab header (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  });

  afterAll(async () => {
    await cat?.close();
  });

  const openAt = async (width: number): Promise<Page> => {
    const page = await cat.open('every-delivery-section', { tab: 'agents', viewport: { width, height: 900 }, colorScheme: 'dark' });
    await page.locator('[data-tab-header-column="status"]').waitFor({ timeout: 10_000 });
    return page;
  };

  const boxes = async (page: Page) => {
    const todo = (await page.locator('[data-tab-header-column="todo"]').boundingBox())!;
    const status = (await page.locator('[data-tab-header-column="status"]').boundingBox())!;
    return { todo, status };
  };

  it('puts the two columns side by side at 1280 px', async () => {
    const page = await openAt(1280);
    try {
      const { todo, status } = await boxes(page);
      expect(status.x).toBeGreaterThanOrEqual(todo.x + todo.width);
      expect(Math.abs(status.y - todo.y)).toBeLessThan(1);
    } finally {
      await page.close();
    }
  });

  it('stacks the status column below the to-do column at 767 px', async () => {
    const page = await openAt(767);
    try {
      const { todo, status } = await boxes(page);
      expect(status.y).toBeGreaterThanOrEqual(todo.y + todo.height);
      expect(Math.abs(status.x - todo.x)).toBeLessThan(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(767);
    } finally {
      await page.close();
    }
  });

  it('colours a blocks-delivery verb with --hue-red and an input verb with --hue-blue', async () => {
    const page = await openAt(1280);
    try {
      for (const [marker, token] of [['blocks-delivery', '--hue-red'], ['input', '--hue-blue']] as const) {
        const verb = page.locator(`[data-todo-line="${marker}"] [data-todo-verb]`).first();
        await verb.waitFor({ timeout: 10_000 });
        const [actual, expected] = await verb.evaluate((el, t) => {
          const probe = document.createElement('span');
          probe.style.color = `var(${t})`;
          el.parentElement!.appendChild(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          return [getComputedStyle(el).color, want];
        }, token);
        expect(actual, `${marker} verb`).toBe(expected);
      }
    } finally {
      await page.close();
    }
  });

  for (const width of [1280, 320]) {
    it(`keeps every to-do line on one grid row at ${width} px: chip, kind, link aligned`, async () => {
      const base = scenario('every-delivery-section');
      const loose = (branch: string) => row({
        kind: 'branch', branch, plan: '', planFile: '', wave: '', state: 'open', group: 'not-started',
        desk: false, worker: 'none', ageMinutes: 4000,
      });
      const page = await cat.open('every-delivery-section', {
        tab: 'agents',
        viewport: { width, height: 900 },
        colorScheme: 'dark',
        over: {
          fleet: fleet({
            ...base.fleet,
            rows: [
              ...base.fleet.rows,
              loose('feature/a-merged-pending-check-is-asked-again'),
              loose('plot/release-no-controller-resumes-a-claimed-slice'),
            ],
          }),
        },
      });
      try {
        const lines = page.locator('[data-todo-line]');
        await lines.first().waitFor({ timeout: 10_000 });
        const geometry = await lines.evaluateAll((els) => els.map((el) => {
          const box = (sel: string) => el.querySelector(sel)!.getBoundingClientRect();
          const verb = box('[data-todo-verb]');
          const label = box('[data-todo-label]');
          // A baseline, read exactly: a zero-height inline-block sits with its bottom on the line's baseline.
          const baseline = (sel: string) => {
            const probe = document.createElement('span');
            probe.style.display = 'inline-block';
            probe.style.height = '0';
            el.querySelector(sel)!.appendChild(probe);
            const y = probe.getBoundingClientRect().bottom;
            probe.remove();
            return y;
          };
          return {
            text: el.textContent ?? '',
            chipBottom: baseline('[data-todo-marker]'),
            labelBottom: baseline('[data-todo-label]'),
            verbLeft: Math.round(verb.left),
            labelLeft: Math.round(label.left),
            labelRight: label.right,
            lineRight: el.getBoundingClientRect().right,
            title: el.querySelector('[data-todo-label]')!.getAttribute('title'),
          };
        }));
        expect(geometry.length).toBeGreaterThan(2);
        // One column x for the kind word and one for the link, on every line.
        expect(new Set(geometry.map((g) => g.verbLeft)).size).toBe(1);
        expect(new Set(geometry.map((g) => g.labelLeft)).size).toBe(1);
        for (const g of geometry) {
          // The chip and the link share one baseline.
          expect(Math.abs(g.chipBottom - g.labelBottom), g.text).toBeLessThan(1.5);
          expect(g.labelRight, g.text).toBeLessThanOrEqual(g.lineRight + 1);
        }
        const long = geometry.find((g) => g.title === 'feature/a-merged-pending-check-is-asked-again');
        expect(long).toBeDefined();
        expect(long!.text.startsWith('clean up')).toBe(true);
        expect(long!.text).toContain('Branch feature/a-merged');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      } finally {
        await page.close();
      }
    });
  }
});
