import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openCatalogue, scenario, fleet, row, board as buildBoard, type Catalogue } from '../catalogue/index.js';

/**
 * A LOOSE BRANCH SHOWS ITS ACTIONS — what is seen.
 *
 * Whether a branch is loose is decided by `looseOf` in the domain and asserted in
 * `delivery-placement.test.ts` and `delivery-readings.test.ts`. This file proves
 * the result reaches the page: the loose branches sit under You › Unblock as one
 * grouped row, and its one `⋯` menu lists each branch with its own release and
 * delete actions, a disabled action naming its reason.
 */
describe('the loose branches under You > Unblock', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  /** Opens the one `⋯` menu of the grouped Unblock row and returns the part of the menu that lists `branch`. */
  const openMenu = async (page: import('playwright').Page, branch: string) => {
    const trigger = page.locator('[data-section="you"] [data-loose-group] [data-clean-up-menu]');
    await trigger.waitFor({ timeout: 15_000 });
    await trigger.click();
    const menu = page.locator(`[data-section="you"] [role="menu"] [data-menu-branch="${branch}"]`);
    await menu.waitFor({ timeout: 5_000 });
    return menu;
  };

  it('puts Delete in the row\'s one menu, with no second line of links', async () => {
    const base = scenario('a-full-estate');
    const loose = row({
      branch: 'feature/nobody-wants-this', plan: '', wave: '', group: 'quiet', state: 'wip', worker: 'elsewhere', desk: false,
      ageMinutes: 900, pr: null, branchUrl: 'https://github.com/tiny/garden/tree/feature/nobody-wants-this',
    });
    const page = await cat.open('a-full-estate', {
      tab: 'agents',
      over: { fleet: fleet({ ...base.fleet, rows: [...base.fleet.rows, loose] }) },
    });
    try {
      const menu = await openMenu(page, 'feature/nobody-wants-this');
      expect(await page.locator('[data-placement-reason]').count()).toBe(0);
      expect(await page.locator('[data-loose-actions]').count()).toBe(0);
      expect(await page.locator('[data-section="you"] [data-loose-group] [data-row-actions]').count()).toBe(1);
      expect(await menu.locator('[data-open-link]').getAttribute('href')).toContain('feature/nobody-wants-this');
      expect(await menu.locator('[data-release-claim]').count()).toBe(0);
      expect(await menu.locator('[data-menu-item="release-claim"][aria-disabled="true"]').count()).toBe(1);
      const del = menu.locator('[data-loose-delete]');
      expect(await del.getAttribute('aria-label')).toContain('feature/nobody-wants-this');
      expect((await del.innerText()).trim()).toBe('Delete branch…');
      await del.click();
      const confirm = menu.locator('[data-loose-delete-confirm]');
      expect(await confirm.innerText()).toContain('origin/feature/nobody-wants-this');
      expect(await confirm.innerText()).toContain('refs/plot/reaped/feature/nobody-wants-this/');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('offers Release and a disabled Delete on a claim-only branch, and says the claim belongs to another machine', async () => {
    const base = scenario('a-full-estate');
    const claim = row({
      branch: 'bug/main-repair-ad63459de05f', plan: '', wave: '', group: 'quiet', state: 'claimed', worker: 'elsewhere', desk: false,
      ageMinutes: 1_440, pr: null, quietKind: 'orphaned-claim', note: 'claimed, no work committed — claimed 1 day ago · claimed elsewhere',
    });
    const page = await cat.open('a-full-estate', {
      tab: 'agents',
      over: { fleet: fleet({ ...base.fleet, rows: [...base.fleet.rows, claim] }) },
    });
    try {
      const menu = await openMenu(page, 'bug/main-repair-ad63459de05f');
      expect(await page.locator('[data-section="you"] [data-loose-group] [data-row-actions]').count()).toBe(1);
      expect(await menu.locator('[data-release-claim]').count()).toBe(1);
      expect(await menu.locator('[data-loose-delete]').count()).toBe(0);
      expect(await menu.locator('[data-release-claim]').innerText()).toContain('another machine');
      const disabled = menu.locator('[data-menu-item="delete-branch"][aria-disabled="true"]');
      expect(await disabled.getAttribute('data-menu-reason')).toBe('claimed, release it first');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows Delete and no Release on a closed PR whose branch nobody names or holds', async () => {
    const base = scenario('a-full-estate');
    const closed = row({
      branch: 'feature/closed-and-forgotten', plan: '', wave: '', group: 'quiet', state: 'wip', worker: 'elsewhere', desk: false,
      ageMinutes: 900, kind: 'pr', pr: { ...base.fleet.rows.find((r) => r.pr !== null)!.pr!, state: 'closed', open: false },
    });
    const page = await cat.open('a-full-estate', {
      tab: 'agents',
      over: { fleet: fleet({ ...base.fleet, rows: [...base.fleet.rows, closed] }) },
    });
    try {
      const menu = await openMenu(page, 'feature/closed-and-forgotten');
      expect(await menu.locator('[data-loose-delete]').getAttribute('aria-label')).toContain('feature/closed-and-forgotten');
      expect(await menu.locator('[data-release-claim]').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('groups a claimed and a deletable branch into one row whose menu gives each its own reason, with no bulk control', async () => {
    const base = scenario('a-full-estate');
    const work = row({
      branch: 'feature/quiet-a', plan: '', wave: '', group: 'quiet', state: 'wip', worker: 'elsewhere', desk: false, ageMinutes: 900, pr: null,
      branchUrl: 'https://github.com/tiny/garden/tree/feature/quiet-a',
    });
    const claim = row({
      branch: 'bug/claim-only', plan: '', wave: '', group: 'quiet', state: 'claimed', worker: 'elsewhere', desk: false,
      ageMinutes: 1_440, pr: null, quietKind: 'orphaned-claim', branchUrl: 'https://github.com/tiny/garden/tree/bug/claim-only',
    });
    const page = await cat.open('a-full-estate', {
      tab: 'agents',
      over: { fleet: fleet({ ...base.fleet, rows: [...base.fleet.rows, work, claim] }) },
    });
    try {
      const group = page.locator('[data-section="you"] [data-loose-group]');
      await group.waitFor({ timeout: 15_000 });
      expect(await group.getAttribute('data-loose-group')).toBe('2');
      expect(await group.innerText()).toContain('2 loose branches');
      expect(await page.locator('h3[data-delivery-group="unblock"] button').count()).toBe(0);
      expect(await page.locator('[data-clean-up-bulk-delete]').count()).toBe(0);
      const claimed = await openMenu(page, 'bug/claim-only');
      expect(await claimed.locator('[data-menu-item="delete-branch"]').getAttribute('data-menu-reason')).toBe('claimed, release it first');
      expect(await claimed.locator('[data-release-claim]').count()).toBe(1);
      const deletable = page.locator('[data-section="you"] [role="menu"] [data-menu-branch="feature/quiet-a"]');
      expect(await deletable.locator('[data-menu-item="release-claim"]').getAttribute('data-menu-reason')).toBe('carries work');
      expect(await deletable.locator('[data-loose-delete]').count()).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('marks the three You groups red, blue and grey, and titles the third Unblock', async () => {
    const base = scenario('a-full-estate');
    const loose = row({
      branch: 'feature/nobody-wants-this', plan: '', wave: '', group: 'quiet', state: 'wip', worker: 'elsewhere', desk: false,
      ageMinutes: 900, pr: null,
    });
    // One item in each You group, so all three headings render.
    const asking = row({
      branch: 'feature/asking', plan: 'garden', wave: 'asking-slice', state: 'wip', group: 'waiting-on-you', ageMinutes: 30,
      question: { firstLine: 'which adapter should the fallback use?', askedAt: '2026-10-05T13:36:00.000Z' },
    });
    const page = await cat.open('a-full-estate', {
      tab: 'agents',
      over: {
        fleet: fleet({
          ...base.fleet,
          rows: [...base.fleet.rows, loose, asking],
          draftPlans: [{ plan: 'zucchini-glut', planFile: '2026-09-26-zucchini-glut.md', title: 'Zucchini glut', rounds: 0 }],
        }),
      },
    });
    try {
      const marker = (group: string) => page.locator(`h3[data-delivery-group="${group}"] [data-group-marker]`);
      await marker('unblock').waitFor({ timeout: 15_000 });
      expect(await page.locator('h3[data-delivery-group="unblock"]').innerText()).toContain('Unblock');
      expect(await page.locator('h3[data-delivery-group="unblock"]').innerText()).not.toContain('Clean up');
      for (const [group, name] of [['unblock', 'clean-up'], ['blocks-delivery', 'blocks-delivery'], ['input-to-the-fleet', 'input']] as const) {
        expect(await marker(group).count()).toBe(1);
        expect(await marker(group).getAttribute('data-group-marker')).toBe(name);
        expect((await marker(group).innerText()).trim()).toBe('');
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it('keeps a loose branch of unknown owner under Unblock when Mine hides unknown owners', async () => {
    const base = scenario('an-empty-estate');
    const loose = row({
      branch: 'feature/nobody-wants-this', plan: '', wave: '', group: 'quiet', state: 'wip', worker: 'elsewhere', desk: false,
      ageMinutes: 900, pr: null,
    });
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: {
        fleet: fleet({ ...base.fleet, rows: [loose] }),
        board: buildBoard({ server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: 'gardener' } }),
      },
    });
    try {
      const trigger = page.locator('[data-section="you"] [data-clean-up-menu]');
      await trigger.waitFor({ timeout: 15_000 });
      await page.locator('[data-chip^="Mine"]').click();
      const strict = page.locator('[data-mine-strict-toggle]');
      await expect.poll(async () => ((await strict.textContent()) ?? '').trim()).toBe('hide 1 unknown');
      await strict.click();
      await expect.poll(async () => ((await strict.textContent()) ?? '').trim()).toBe('show 1 unknown');
      expect(await trigger.count()).toBe(1);
      expect(await trigger.getAttribute('aria-label')).toBe('Actions for 1 loose branch');
      await trigger.click();
      expect(await page.locator('[data-section="you"] [role="menu"] [data-menu-branch="feature/nobody-wants-this"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);
});
