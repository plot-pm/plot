import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board, card, column, sprint, type Catalogue } from '../catalogue/index.js';
import { planFactsOf } from '../../src/server/plan-facts.js';
import { stateFor } from '../fixtures/card-controls.js';
import { GLYPH_PATH } from '../../src/app/lib/glyphs.js';

/**
 * A PLAN CARD RENDERS THE CARD GRAMMAR — what only a rendered page can settle.
 *
 * `presentCard` decides the rows and the words, asserted in
 * `test/unit/card-presentation.test.ts` with no browser. This owns the half a
 * page states: the three sections land in their fixed order on screen, the tab order
 * runs title, primary, secondaries, expanders, a count opens a popover of
 * links, and a link reads as text until hover or focus.
 */
const DRAFT_INPUT = {
  slug: 'grammar', title: 'The card grammar', phase: 'Discovery', status: 'draft',
  path: 'docs/plans/2026-11-06-grammar.md', assignee: 'jwloka', issues: ['3101'], rounds: 2,
  prs: [
    { number: 11, url: 'https://example.invalid/pull/11', checksUrl: 'https://example.invalid/pull/11/checks', checks: 'green' },
    { number: 12, url: 'https://example.invalid/pull/12', checks: 'unknown' },
  ],
} satisfies Parameters<typeof card>[0];
/** Each PR's head branch, as the scan reads it. */
const DRAFT = card({
  ...DRAFT_INPUT,
  facts: planFactsOf(card(DRAFT_INPUT), { state: stateFor(DRAFT_INPUT), prHeads: new Map([[11, 'feature/a'], [12, 'feature/b']]) }),
});

const SPRINT = sprint({ slug: 'card-alignment', title: 'The fleet delivers a scope alone', release: '2.31.0' });
const COLD_INPUT = {
  slug: 'cold', title: 'Waiting for a scan', phase: 'Development', status: 'approved', started: false,
  path: 'docs/plans/2026-11-06-cold.md', sprint: 'card-alignment',
  sliceSummary: { slices: 2, branches: 2, deferred: 0 },
} satisfies Parameters<typeof card>[0];
/** A plan with no `Assignee:` line whose `Started:` record names who took it up. */
const APP_KEYS_INPUT = {
  slug: 'app-keys', title: 'App keys resolve from one per-user folder', phase: 'Development', status: 'approved', started: true,
  path: 'docs/plans/2026-11-06-app-keys.md',
} satisfies Parameters<typeof card>[0];
const APP_KEYS = card({
  ...APP_KEYS_INPUT,
  facts: planFactsOf(card(APP_KEYS_INPUT), {
    state: stateFor(APP_KEYS_INPUT),
    records: {
      designRaw: '', approvedRaw: '', deliveredRaw: '', releasedRaw: '',
      startedRaw: '2026-11-06, Jan Wloka, feature/app-keys-resolve-from-one-folder',
    },
    directory: { 'jan wloka': 'jwloka' },
  }),
});

const STARTABLE_COLD = card({ ...COLD_INPUT, facts: planFactsOf(card(COLD_INPUT), { state: stateFor(COLD_INPUT), sprints: [SPRINT] }) });

/** A plan offering more than two secondaries: the rest go behind `⋯`. */
const MANY_INPUT = {
  slug: 'many', title: 'A plan with many actions', phase: 'Development', status: 'approved', started: false,
  path: 'docs/plans/2026-11-06-many.md', sliceSummary: { slices: 2, branches: 2, deferred: 0 },
} satisfies Parameters<typeof card>[0];
const MANY_BASE = card(MANY_INPUT);
const MANY = card({
  ...MANY_INPUT,
  facts: {
    ...MANY_BASE.facts,
    next: {
      primary: { action: 'approve', enabled: true, reason: null },
      secondary: [
        { action: 'interrogate', enabled: true, reason: null },
        { action: 'deliver', enabled: true, reason: null },
        { action: 'start-work', enabled: false, reason: { kind: 'awaiting-fleet-scan' } },
        { action: 'confirm-slices', enabled: true, reason: null },
      ],
    },
  },
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
          columns: [column({ phase: 'Discovery', cards: [DRAFT] }), column({ phase: 'Development', cards: [STARTABLE_COLD, APP_KEYS, MANY] })],
          branchUrlBase: 'https://example.invalid/tree/',
          issueUrlBase: 'https://example.invalid/issues/',
          sprints: [SPRINT],
          dispatch: { available: true, reason: '' },
          approve: { available: true, reason: '' },
          interrogate: { available: true, reason: '' },
          deliver: { available: true, reason: '' },
        }),
      },
      tab: 'board',
      viewport: { width: 1400, height: 1200 },
    });
    await page.locator('#plan-grammar').waitFor({ timeout: 10_000 });
    return page;
  };

  it('shows the three sections in their fixed order on screen, the footer flush at the bottom', async () => {
    const page = await open();
    try {
      const tops = await page.locator('#plan-cold [data-section]').evaluateAll((els) =>
        els.map((el) => ({ section: el.getAttribute('data-section'), top: el.getBoundingClientRect().top })),
      );
      const order = [...tops].sort((a, b) => a.top - b.top).map((t) => t.section);
      expect(order).toEqual(['header', 'status', 'footer']);
      expect(await page.locator('#plan-cold [data-section="footer"]').getAttribute('data-emphasis')).toBe('true');
      const bottoms = await page.locator('#plan-cold').evaluate((card) => ({
        card: card.getBoundingClientRect().bottom,
        band: card.querySelector('[data-footer-band]')!.getBoundingClientRect().bottom,
      }));
      expect(Math.abs(bottoms.card - bottoms.band)).toBeLessThanOrEqual(1);
      // The status panel opens with the state pill; the footer holds the assignee.
      const status = page.locator('#plan-grammar [data-section="status"]');
      expect(await status.locator('[data-state-pill]').first().textContent()).toBe('Draft');
      expect(await page.locator('#plan-grammar [data-assignees]').getAttribute('aria-label')).toBe('@jwloka');
      // Nobody assigned is an empty circle named for it, not a word on the card.
      const nobody = page.locator('#plan-cold [data-assignees]');
      expect(await nobody.getAttribute('aria-label')).toBe('Unassigned');
      // The circle is not the only sign: a muted word follows it.
      expect(await nobody.locator('[data-assignee-word]').innerText()).toBe('unassigned');
      // A plan with no Assignee: shows who started it, and the tooltip names the record.
      const starter = page.locator('#plan-app-keys [data-assignees]');
      expect(await starter.getAttribute('aria-label')).toBe('@jwloka');
      expect(await starter.innerText()).toBe('JW');
      await starter.focus();
      // The tooltip the avatar names as its description.
      const tip = page.locator(`[id="${await starter.getAttribute('aria-describedby')}"]`);
      await expect.poll(() => tip.isVisible()).toBe(true);
      expect(await tip.textContent()).toBe('Started by @jwloka on 2026-11-06');
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

  it('"2 PRs" opens a popover of links: it takes focus, Escape closes it, and focus returns to the count', async () => {
    const page = await open();
    try {
      const count = page.locator('#plan-grammar [data-expander="prs"]');
      expect(await count.evaluate((el) => el.tagName)).toBe('BUTTON');
      expect(await count.getAttribute('aria-haspopup')).toBe('dialog');
      expect(await count.getAttribute('aria-expanded')).toBe('false');
      // One dot and count per check state; the word rides beside it for assistive technology.
      expect(await count.locator('[data-dot]').evaluateAll((els) => els.map((el) => el.getAttribute('data-dot'))))
        .toEqual(['green', 'checks unknown']);

      await count.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '2 PRs' });
      await dialog.waitFor({ timeout: 5_000 });
      expect(await count.getAttribute('aria-expanded')).toBe('true');
      // Every PR is a link that opens the host in a new tab, and says so; focus moved inside.
      const prLink = dialog.locator('[data-pr-link="11"]');
      expect(await prLink.getAttribute('href')).toBe('https://example.invalid/pull/11');
      expect(await prLink.getAttribute('target')).toBe('_blank');
      expect(await prLink.textContent()).toContain('opens in a new tab');
      expect(await prLink.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await dialog.locator('[data-branch-link="feature/a"]').getAttribute('href')).toBe('https://example.invalid/tree/feature/a');
      expect(await dialog.locator('[data-build-link="11"]').getAttribute('href')).toBe('https://example.invalid/pull/11/checks');
      expect(await dialog.locator('[data-pr-number="12"]').textContent()).toContain('checks unknown');
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

      await page.keyboard.press('Escape');
      await expect.poll(() => dialog.count()).toBe(0);
      expect(await count.evaluate((el) => el === document.activeElement)).toBe(true);

      // A click outside closes it too.
      await count.click();
      await dialog.waitFor({ timeout: 5_000 });
      await page.mouse.click(5, 5);
      await expect.poll(() => dialog.count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('a sprint link opens the sprint view; a link reads as plain text at rest and underlines on hover and focus', async () => {
    const page = await open();
    try {
      const sprint = page.locator('#plan-cold a[data-lineage="sprints"]');
      const decoration = () => sprint.evaluate((el) => getComputedStyle(el).textDecorationLine);
      expect(await decoration()).toBe('none');
      expect(await sprint.evaluate((el) => getComputedStyle(el).color))
        .toBe(await page.locator('#plan-cold [data-meta]').evaluate((el) => getComputedStyle(el).color));
      await sprint.hover();
      expect(await decoration()).toBe('underline');
      await page.mouse.move(0, 0);
      await page.locator('#plan-cold [data-card-title]').focus();
      await page.keyboard.press('Shift+Tab');
      await sprint.focus();
      expect(await decoration()).toBe('underline');

      // The label is the release, copied verbatim, then the title.
      expect(await sprint.textContent()).toBe('Sprint2.31.0 · The fleet delivers a scope alone');
      await sprint.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ timeout: 5_000 });
      expect(await dialog.textContent()).toContain('The fleet delivers a scope alone');
    } finally {
      await page.close();
    }
  });

  it('leads the title row with the plan kind icon, named Plan, and its type as a tag', async () => {
    const page = await open();
    try {
      const identity = page.locator('#plan-grammar [data-card-row="identity"]');
      expect(await identity.getByRole('img', { name: 'Plan' }).count()).toBe(1);
      // The type tag sits on the muted meta line below the title.
      const meta = page.locator('#plan-grammar [data-meta]');
      expect(await meta.locator('[data-type="feature"]').count()).toBe(1);
      // The ticket number leads the title line as its own link to the issue, muted in tabular figures.
      const number = page.locator('#plan-grammar a[data-title-number]');
      expect(await number.getAttribute('href')).toBe('https://example.invalid/issues/3101');
      expect(await number.getAttribute('target')).toBe('_blank');
      expect(await number.textContent()).toBe('#3101 (opens in a new tab)');
      expect(await number.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toBe('tabular-nums');
      expect(await number.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
      // The title is a separate link at full weight, and it comes after the number in the tab order.
      const title = page.locator('#plan-grammar [data-card-title]');
      expect(await title.textContent()).toBe('The card grammar');
      expect(Number(await title.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
      await number.focus();
      await page.keyboard.press('Tab');
      expect(await title.evaluate((el) => el === document.activeElement)).toBe(true);
      // The title opens PlanModal in place.
      await title.click();
      const path = page.getByRole('dialog').locator('[data-plan-path]');
      await path.waitFor({ timeout: 5_000 });
      expect(await path.textContent()).toBe('docs/plans/2026-11-06-grammar.md');
      // The meta line names no ticket number.
      expect(await meta.textContent()).not.toMatch(/#\d+/);
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

  it('sets the footer apart: a top divider and its own tint', async () => {
    const page = await open();
    try {
      const band = page.locator('#plan-grammar [data-footer-band]');
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
  it('the action group wraps whole to its own row at 320 px, and every label shows in full', async () => {
    const page = await open();
    try {
      const rect = (sel: string) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
      // Wide enough, the assignees and the actions share one row.
      const wide = { band: await rect('#plan-grammar [data-action-band]'), who: await rect('#plan-grammar [data-card-row="ownership"]') };
      expect(wide.band.top).toBeLessThan(wide.who.bottom);

      await page.locator('#plan-many').evaluate((el) => { el.style.width = '320px'; });
      const band = await rect('#plan-many [data-action-band]');
      const who = await rect('#plan-many [data-card-row="ownership"]');
      expect(band.top).toBeGreaterThanOrEqual(who.bottom);
      // The group stays on one row, right-aligned, in order: primary, two secondaries, then `⋯`.
      const slots = await page.locator('#plan-many [data-action-band] > [data-action-slot]').evaluateAll((els) =>
        els.map((el) => ({ slot: el.getAttribute('data-action-slot'), top: Math.round(el.getBoundingClientRect().top) })));
      expect(slots.map((x) => x.slot)).toEqual(['primary', 'secondary', 'secondary', 'more']);
      expect(new Set(slots.map((x) => x.top)).size).toBe(1);
      const card = await rect('#plan-many');
      expect(card.right - band.right).toBeLessThanOrEqual(2);
      // No label is shrunk, cut or wrapped.
      const widths = await page.locator('#plan-many [data-action-band] button').evaluateAll((els) =>
        els.map((el) => ({ text: el.textContent, scroll: el.scrollWidth, client: el.clientWidth, height: el.getBoundingClientRect().height })));
      for (const w of widths) {
        expect(w.scroll, w.text ?? '').toBeLessThanOrEqual(w.client);
        expect(w.height, w.text ?? '').toBeLessThanOrEqual(30);
      }
    } finally {
      await page.close();
    }
  });

  it('more than two secondaries put the rest behind More actions, in order, a disabled one with its reason', async () => {
    const page = await open();
    try {
      const more = page.locator('#plan-many').getByRole('button', { name: 'More actions' });
      expect(await more.textContent()).toBe('⋯');
      // Tab order: title, primary, the two secondaries, then `⋯`.
      await page.locator('#plan-many [data-card-title]').focus();
      const order: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press('Tab');
        order.push(await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
        }));
      }
      expect(order).toEqual(['Approve', 'Interrogate', 'Deliver', 'More actions']);

      await page.keyboard.press('Enter');
      const menu = page.getByRole('dialog', { name: 'More actions' });
      await menu.waitFor({ timeout: 5_000 });
      expect(await menu.locator('[data-menu-action]').evaluateAll((els) => els.map((el) => el.getAttribute('data-menu-action'))))
        .toEqual(['start-work', 'confirm-slices']);
      const disabled = menu.locator('[data-action="start-work"] button');
      expect(await disabled.getAttribute('aria-disabled')).toBe('true');
      const reasonId = await disabled.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reasonId}"]`).textContent()).toBe('no fleet scan yet');
      await page.keyboard.press('Escape');
      await expect.poll(() => menu.count()).toBe(0);
      expect(await more.evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await page.close();
    }
  });
});
