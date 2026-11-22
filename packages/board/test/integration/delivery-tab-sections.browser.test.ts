import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from 'playwright';
import { openCatalogue, scenario, fleet, row, type Catalogue } from '../catalogue/index.js';

/**
 * THE DELIVERY TAB SHOWS FIVE SECTIONS — what is seen.
 *
 * Where a row lands is decided by `placeDelivery` and asserted in
 * `delivery-view.test.ts` and `delivery-readings.test.ts`. This file proves the
 * result reaches the page: five headings in the layout's order, and one row
 * under each of You, Work items and Fleet.
 */
describe('the Delivery tab renders the five sections', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  it('shows the five headings and a row under You, Work items and Fleet', async () => {
    const base = scenario('a-full-estate');
    // A green PR with a pending review and `Auto-review` off waits for a person.
    const forYou = row({
      branch: 'feature/ready-for-review', plan: 'review-plan', wave: 'Review', group: 'waiting-on-you',
      ageMinutes: 5,
      pr: {
        number: 131, url: 'https://github.com/tiny/garden/pull/131', draft: false, state: 'green',
        ciChecks: 'green', plotReview: 'pending',
      },
    });
    const page = await cat.open('a-full-estate', {
      tab: 'agents',
      over: { fleet: fleet({ ...base.fleet, rows: [...base.fleet.rows, forYou] }) },
    });
    try {
      await page.locator('[data-delivery-section]').first().waitFor({ timeout: 15_000 });
      const headings = await page.locator('[data-delivery-section]').evaluateAll(
        (els) => els.map((el) => el.getAttribute('data-delivery-section')),
      );
      expect(headings).toEqual(['release-delivery', 'you', 'work-items', 'fleet', 'machine', 'tickets']);
      for (const section of ['you', 'work-items', 'fleet']) {
        const rows = page.locator(`[data-section="${section}"] li[data-tuple-kind], [data-section="${section}"] li[data-fleet-agent-row]`);
        expect(await rows.count(), `a row under ${section}`).toBeGreaterThan(0);
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows the You header counts and the phase strip, and a count link reaches its target', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const header = page.locator('h2[data-delivery-section="you"]');
      await header.waitFor({ timeout: 15_000 });
      const line = header.locator('[data-you-header]');
      await line.waitFor({ timeout: 15_000 });
      const counts = await line.locator('[data-you-count]').allInnerTexts();
      expect(counts.length, `counts ${JSON.stringify(counts)}`).toBeGreaterThan(0);
      for (const c of counts.map((t) => t.replace(/^· /, '').trim())) expect(c).toMatch(/^(\d+ (block delivery|inputs the fleet waits for|to clean up|tickets to triage)|tickets to triage: not read)$/);
      const strip = header.locator('[data-phase-strip]');
      await strip.waitFor({ timeout: 15_000 });
      expect(await strip.innerText()).toMatch(/─▶/);
      expect(await strip.locator('[data-phase-strip-entry]').count()).toBeGreaterThan(0);
      const link = header.locator('[data-you-count-link]').first();
      if (await link.count() > 0) {
        const key = await link.getAttribute('data-you-count-link');
        await link.click();
        const target = key === 'tickets' ? '[data-delivery-section="tickets"]' : `[data-group="${key}"][data-link-target]`;
        await page.locator(target).first().waitFor({ state: 'attached', timeout: 5_000 });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows an icon and a count link in a header, and the link reaches its group', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const header = page.locator('h2[data-delivery-section="fleet"]');
      await header.waitFor({ timeout: 15_000 });
      expect(await header.locator('svg[data-section-icon]').count()).toBe(1);
      const link = header.locator('[data-summary-link]').first();
      await link.waitFor({ timeout: 15_000 });
      const key = await link.getAttribute('data-summary-link');
      await link.click();
      await page.locator(`[data-group="${key}"][data-link-target]`).waitFor({ timeout: 5_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows Work items counts that link to their group, and a column name under each group', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const header = page.locator('h2[data-delivery-section="work-items"]');
      await header.waitFor({ timeout: 15_000 });
      const link = header.locator('[data-summary-link]').first();
      await link.waitFor({ timeout: 15_000 });
      expect(await link.innerText()).toMatch(/^\d+ [a-z ]+$/);
      const key = await link.getAttribute('data-summary-link');
      await link.click();
      await page.locator(`[data-group="${key}"][data-link-target]`).waitFor({ timeout: 5_000 });
      const names = await page.locator('[data-section="work-items"] [data-column-header]').allTextContents();
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) expect(['Gates', 'Progress', 'Waits on']).toContain(n);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows the At a gate cell as one mark per gate', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      await page.locator('[data-delivery-section="work-items"]').waitFor({ timeout: 15_000 });
      const cells = page.locator('[data-section="work-items"] [data-group="at-a-gate"] [data-row-cell="status"]');
      await cells.first().waitFor({ timeout: 15_000 });
      const texts = await cells.allInnerTexts();
      const marked = texts.filter((t) => /CI [✓⟳✗]|review [✓⟳✗–]/.test(t));
      expect(marked.length, `a gate mark among ${JSON.stringify(texts)}`).toBeGreaterThan(0);
      for (const t of marked) expect(t).toMatch(/(CI [✓⟳✗])?( · )?(review [✓⟳✗–])?$/);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows a Progress cell and a Waits on cell', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      await page.locator('[data-delivery-section="work-items"]').waitFor({ timeout: 15_000 });
      const cell = (group: string) => page.locator(`[data-section="work-items"] [data-group="${group}"] [data-row-cell="status"]`);
      const built = (await cell('being-built').allInnerTexts()).map((t) => t.trim()).filter((t) => t !== '');
      const queued = (await cell('queued').allInnerTexts()).map((t) => t.trim()).filter((t) => t !== '');
      expect(built.length + queued.length, `cells ${JSON.stringify({ built, queued })}`).toBeGreaterThan(0);
      for (const t of built) expect(t).toMatch(/^(no PR yet|PR open)( · \d+ unpushed)?$/);
      for (const t of queued) expect(t).not.toMatch(/^waits on /);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows the header above the sections, and its links open the You section and the Tickets section', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const header = page.locator('[data-tab-header]');
      await header.locator('[data-header-group="you"]').waitFor({ timeout: 15_000 });
      const [headerY, cardY] = await Promise.all([
        header.evaluate((el) => el.getBoundingClientRect().top + window.scrollY),
        page.locator('[data-delivery-section]').first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY),
      ]);
      expect(headerY).toBeLessThan(cardY);
      await header.locator('[data-header-open="you"]').click();
      expect(await page.locator('[data-section="you"]').first().isVisible()).toBe(true);
      await header.locator('[data-header-triage]').click();
      await page.locator('#tickets').waitFor({ state: 'attached', timeout: 5_000 });
      await page.setViewportSize({ width: 320, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('leaves the fold unchanged on a click on a header count or switch', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const toggle = page.locator('[data-section-toggle="fleet"]');
      await toggle.waitFor({ timeout: 15_000 });
      expect(await toggle.getAttribute('aria-expanded')).toBe('true');
      await page.locator('h2[data-delivery-section="fleet"] [data-summary-link]').first().click();
      expect(await toggle.getAttribute('aria-expanded')).toBe('true');
      await page.locator('[data-fleet-control-column]').click({ position: { x: 1, y: 1 } });
      expect(await toggle.getAttribute('aria-expanded')).toBe('true');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('renders no machine line in a folded Machine section', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const machine = page.locator('[data-section="machine"]');
      await machine.locator('[data-machine-line]').waitFor({ timeout: 15_000 });
      await page.locator('[data-section-toggle="machine"]').click();
      await expect.poll(() => page.locator('[data-section-toggle="machine"]').getAttribute('aria-expanded')).toBe('false');
      expect(await machine.locator('[data-machine-line]').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('opens a folded section on a You count link and marks the target', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const link = page.locator('h2[data-delivery-section="you"] [data-you-count-link]').first();
      await link.waitFor({ timeout: 15_000 });
      const key = await link.getAttribute('data-you-count-link');
      const section = key === 'tickets' ? 'tickets' : 'you';
      const toggle = page.locator(`[data-section-toggle="${section}"]`);
      await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      await link.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      const target = key === 'tickets' ? '#tickets[data-link-target]' : `[data-group="${key}"][data-link-target]`;
      await page.locator(target).first().waitFor({ state: 'attached', timeout: 5_000 });
    } finally {
      await page.close();
    }
  }, 60_000);
  it('opens a folded section on a summary chip link and marks the target group', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const toggle = page.locator('[data-section-toggle="work-items"]');
      await toggle.waitFor({ timeout: 15_000 });
      await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      const summary = page.locator('[data-section="work-items"] [data-section-summary-parts]');
      await summary.waitFor({ timeout: 5_000 });
      expect(await summary.locator('[data-summary-chip]').count()).toBeGreaterThan(0);
      const chip = summary.locator('[data-summary-chip-link]').first();
      const key = await chip.getAttribute('data-summary-chip');
      await chip.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      await page.locator(`[data-group="${key}"][data-link-target]`).first().waitFor({ state: 'attached', timeout: 5_000 });
    } finally {
      await page.close();
    }
  }, 60_000);

  it('keeps the activity spinner and shows the agent circles in a folded Fleet heading', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const toggle = page.locator('[data-section-toggle="fleet"]');
      await toggle.waitFor({ timeout: 15_000 });
      await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      const fleetSection = page.locator('[data-section="fleet"]');
      await fleetSection.locator('[data-summary-circles]').waitFor({ timeout: 5_000 });
      expect(await fleetSection.locator('[data-summary-circle]').count()).toBeGreaterThan(0);
      expect(await fleetSection.locator('h2 [data-activity-spinner]').count()).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);

  /** Folds a group by its toggle and waits for the fold. */
  const foldGroup = async (page: Page, key: string) => {
    const toggle = page.locator(`[data-group-toggle="${key}"]`);
    await toggle.waitFor({ timeout: 15_000 });
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
    return toggle;
  };

  /** Whether an element lies inside the viewport; a zero-height anchor counts by its top. */
  const inViewport = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom >= 0 && r.top <= window.innerHeight;
  });

  it('opens the folded group that holds a blocking slice on a click on the blocker mark', async () => {
    const plan = 'netting';
    const planFile = '2026-11-21-netting.md';
    const rows = [
      // The blocker: an approved plan's eligible slice, so Work items › Queued holds it.
      row({
        branch: 'feature/net-posts', plan, planFile, wave: 'Posts', group: 'not-started', state: 'open',
        phase: 'Development', planState: 'approved', ageMinutes: null, verdict: 'eligible', waitingOn: 'click', pr: null,
      }),
      // The blocked slice asks a question, so it sits under You with its mark in view.
      row({
        branch: 'feature/net-mesh', plan, planFile, wave: 'Mesh', group: 'not-started', state: 'open',
        phase: 'Development', planState: 'approved', ageMinutes: null, verdict: 'blocked', blockedBy: 'Posts',
        waitingOn: 'time', question: { firstLine: 'which mesh?', askedAt: '2026-11-21T09:00:00.000Z' }, pr: null,
      }),
    ];
    const slices = [
      { plan, name: 'Posts', branches: ['feature/net-posts'], verdict: 'eligible', section: 'not-started', complete: false, planSliceCount: 2 },
      { plan, name: 'Mesh', branches: ['feature/net-mesh'], verdict: 'blocked', section: 'not-started', complete: false, planSliceCount: 2 },
    ];
    const page = await cat.open('an-empty-estate', { tab: 'agents', over: { fleet: fleet({ rows, slices } as never) } });
    try {
      const toggle = await foldGroup(page, 'queued');
      expect(await page.locator('[data-slice-row="Posts"]').count()).toBe(0);
      const mark = page.locator('[data-section="you"] [data-slice-blocked-by="Posts"]');
      await mark.first().waitFor({ timeout: 15_000 });
      await mark.first().click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      await page.locator('[data-slice-row="Posts"]').first().waitFor({ timeout: 5_000 });
      await expect.poll(() => inViewport(page, '[data-slice-row="Posts"]')).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  // An agent acting on an item sits in Fleet › Working or Blocked, and neither group folds
  // (`ALWAYS_OPEN_GROUPS`), so the fold that can hide the link's target is the Fleet section.
  it('opens the folded Fleet section that holds an agent on a click on an agents link', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const line = page.locator('li[data-delivery-link]').filter({ hasText: '← agents:' }).first();
      await line.waitFor({ timeout: 15_000 });
      const anchor = await line.evaluate((el) => el.querySelector('a[href^="#"]')?.getAttribute('href')?.slice(1) ?? null);
      expect(anchor, 'an agents link with an anchor').not.toBeNull();
      expect(await page.evaluate((id) => document.getElementById(id)?.closest('[data-section]')?.getAttribute('data-section') ?? null, anchor!)).toBe('fleet');
      const toggle = page.locator('[data-section-toggle="fleet"]');
      await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      expect(await page.locator(`[id="${anchor}"]`).count()).toBe(0);
      await line.locator(`a[href="#${anchor}"]`).click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      await page.locator(`[id="${anchor}"]`).waitFor({ state: 'attached', timeout: 5_000 });
      await expect.poll(() => inViewport(page, `[id="${anchor}"]`)).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);
});

