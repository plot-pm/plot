import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

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
});
