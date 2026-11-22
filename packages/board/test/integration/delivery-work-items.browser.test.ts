import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

/**
 * THE WORK ITEMS SECTION'S LOOK — what `delivery-work-items.css` computes on
 * real Work items elements of `every-delivery-section`.
 *
 * The screenshot test proves the file loads; this proves its rules beat the
 * utilities on the same elements. `feature/rain-barrel` is At a gate with CI
 * pending, so its CI pill is the real element each tone is read on. The markup
 * half — which word, tone and link each pill carries — is asserted without a
 * browser in `packages/domain/test/delivery-work-columns.test.ts`.
 */
describe('the Work items grid in the mockup look (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;
  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (colorScheme: 'light' | 'dark'): Promise<Page> => {
    const page = await cat.open('every-delivery-section', { tab: 'agents', viewport: { width: 1280, height: 900 }, colorScheme });
    await page.locator('[data-section="work-items"] [data-pill-tone="amber"]').first().waitFor({ timeout: 15_000 });
    return page;
  };

  for (const scheme of ['light', 'dark'] as const) {
    it(`colours each pill's dot from its tone's token in ${scheme}`, async () => {
      const page = await open(scheme);
      try {
        const read = await page.locator('[data-section="work-items"] [data-pill-tone="amber"]').first().evaluate((pill) => {
          const section = pill.closest('[data-section="work-items"]')!;
          const dot = pill.querySelector('[data-pill-dot]')!;
          const token = (name: string) => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = `var(${name})`;
            section.appendChild(probe);
            const value = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return value;
          };
          const was = pill.getAttribute('data-pill-tone')!;
          const colours: Record<string, string> = {};
          for (const tone of ['green', 'amber', 'red', 'blue', 'grey']) {
            pill.setAttribute('data-pill-tone', tone);
            colours[tone] = getComputedStyle(dot).backgroundColor;
          }
          pill.setAttribute('data-pill-tone', was);
          return {
            colours,
            tokens: { green: token('--hue-green-dot'), amber: token('--hue-amber-dot'), red: token('--hue-red-dot'), blue: token('--hue-blue-dot'), grey: token('--hue-slate-dot') },
          };
        });
        expect(read.colours).toEqual(read.tokens);
        expect(new Set(Object.values(read.colours)).size).toBe(5);
      } finally {
        await page.close();
      }
    });
  }

  it('keeps every status pill whole while a long branch gives way with its full name on hover', async () => {
    const page = await cat.open('every-delivery-section', { tab: 'agents', viewport: { width: 760, height: 900 }, colorScheme: 'light' });
    try {
      await page.locator('[data-section="work-items"] [data-status-pill]').first().waitFor({ timeout: 15_000 });
      const long = 'feature/rain-barrel-overflow-collects-every-drop-from-the-shed-roof-and-the-greenhouse-gutter';
      const read = await page.locator('[data-section="work-items"]').evaluate((section, name) => {
        // The catalogue's rows carry one pill and a short branch, so the first row with a branch is given the
        // longest status the domain words and a long branch name.
        const row = [...section.querySelectorAll('[role="row"]')].find((r) => r.querySelector('[data-item-links] [data-tuple-link="branch"]'))!;
        const link = row.querySelector('[data-item-links] [data-tuple-link="branch"]')!;
        const head = link.querySelector('.truncate')!;
        head.textContent = name;
        const first = row.querySelector<HTMLElement>('[data-status-pill]')!;
        for (const word of ['claimed 2 days ago, no work committed', 'claimed on another machine', 'no sprint']) {
          const extra = first.cloneNode(true) as HTMLElement;
          extra.setAttribute('data-status-pill', word);
          extra.lastChild!.textContent = word;
          first.parentElement!.appendChild(extra);
        }
        const status = row.querySelector('[data-row-cell="status"]')!;
        const by = row.querySelector('[data-row-cell="by"]')!;
        const pills = [...row.querySelectorAll<HTMLElement>('[data-status-pill]')].map((p) => ({
          word: p.getAttribute('data-status-pill')!,
          text: p.textContent,
          cut: p.scrollWidth > p.clientWidth,
          inside: p.getBoundingClientRect().right <= status.getBoundingClientRect().right + 0.5,
        }));
        return {
          ellipsised: head.scrollWidth > head.clientWidth && getComputedStyle(head).textOverflow === 'ellipsis',
          title: link.getAttribute('title') ?? link.closest('[title]')?.getAttribute('title') ?? '',
          statusBeforeBy: status.getBoundingClientRect().right <= by.getBoundingClientRect().left + 0.5,
          pills,
        };
      }, long);
      expect(read.ellipsised).toBe(true);
      expect(read.title).toContain('feature/rain-barrel');
      expect(read.statusBeforeBy).toBe(true);
      expect(read.pills.length).toBe(4);
      for (const p of read.pills) {
        expect(p.text).toBe(p.word);
        expect(p.cut).toBe(false);
        expect(p.inside).toBe(true);
      }
    } finally {
      await page.close();
    }
  });

  it('renders an empty group as one "— none" row inside its grid', async () => {
    const page = await open('light');
    try {
      const read = await page.locator('[data-section="work-items"] [data-group]').evaluateAll((groups) => groups.map((g) => ({
        key: g.getAttribute('data-group'),
        inHeading: g.querySelectorAll('h3 [data-group-none]').length,
        inGrid: g.querySelectorAll('[role="grid"] [data-group-none]').length,
        rows: g.querySelectorAll('[role="grid"] [data-delivery-row]').length,
      })));
      for (const g of read) {
        expect(g.inHeading).toBe(0);
        expect(g.inGrid).toBe(g.rows === 0 ? 1 : 0);
      }
    } finally {
      await page.close();
    }
  });

  it('draws the PR and its branch as one tuple beside the item name, the branch in the muted colour', async () => {
    const page = await open('dark');
    try {
      const where = page.locator('[data-section="work-items"] [data-item-links]')
        .filter({ has: page.locator('[data-tuple-link="pr"]') })
        .filter({ has: page.locator('[data-tuple-link="branch"]') })
        .first();
      const read = await where.evaluate((cell) => {
        const prLink = cell.querySelector('[data-tuple-link="pr"]')!;
        const pr = prLink.getBoundingClientRect();
        const branch = cell.querySelector('[data-tuple-link="branch"]')!;
        const sameTuple = prLink.closest('[data-link-tuple]') !== null && prLink.closest('[data-link-tuple]') === branch.closest('[data-link-tuple]');
        const probe = document.createElement('span');
        probe.style.color = 'var(--card-meta)';
        cell.appendChild(probe);
        const meta = getComputedStyle(probe).color;
        probe.remove();
        return { sameTuple, prTop: pr.top, prRight: pr.right, branch: branch.getBoundingClientRect(), colour: getComputedStyle(branch).color, meta };
      });
      // One tuple: the branch is the PR's next segment, on the same line and to its right.
      expect(read.sameTuple).toBe(true);
      expect(read.branch.top).toBeCloseTo(read.prTop, 0);
      expect(read.branch.left).toBeGreaterThanOrEqual(read.prRight);
      expect(read.colour).toBe(read.meta);
    } finally {
      await page.close();
    }
  });
});
