import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openCatalogue, scenario, fleet, row, board as buildBoard, type Catalogue } from '../catalogue/index.js';

/**
 * A LOOSE BRANCH SHOWS ITS ACTIONS — what is seen.
 *
 * Whether a branch is loose is decided by `looseOf` in the domain and asserted in
 * `delivery-placement.test.ts` and `delivery-readings.test.ts`. This file proves
 * the result reaches the page: the row sits under You, carries the reason, and
 * shows a release and a delete button.
 */
describe('a loose branch under You > Unblock', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  it('shows the release and delete buttons and no reason line', async () => {
    const base = scenario('a-full-estate');
    const loose = row({
      branch: 'feature/nobody-wants-this', plan: '', wave: '', group: 'quiet', state: 'wip', worker: 'elsewhere', desk: false,
      ageMinutes: 900, pr: null,
    });
    const page = await cat.open('a-full-estate', {
      tab: 'agents',
      over: { fleet: fleet({ ...base.fleet, rows: [...base.fleet.rows, loose] }) },
    });
    try {
      await page.locator('[data-section="you"] [data-loose-actions]').waitFor({ timeout: 15_000 });
      expect(await page.locator('[data-placement-reason]').count()).toBe(0);
      const actions = page.locator('[data-section="you"] [data-loose-actions]');
      expect(await actions.count()).toBe(1);
      expect(await actions.locator('[data-release-claim]').count()).toBe(1);
      expect(await actions.locator('[data-loose-delete]').count()).toBe(1);
      expect(await actions.locator('[data-loose-delete]').getAttribute('aria-label')).toContain('feature/nobody-wants-this');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('marks the three You groups red, blue and grey "clean up"', async () => {
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
      expect(await marker('unblock').innerText()).toContain('clean up');
      expect(await marker('unblock').getAttribute('data-group-marker')).toBe('clean-up');
      for (const [group, name] of [['blocks-delivery', 'blocks-delivery'], ['input-to-the-fleet', 'input']] as const) {
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
      const actions = page.locator('[data-section="you"] [data-loose-actions]');
      await actions.waitFor({ timeout: 15_000 });
      await page.locator('[data-chip^="Mine"]').click();
      const strict = page.locator('[data-mine-strict-toggle]');
      await expect.poll(async () => ((await strict.textContent()) ?? '').trim()).toBe('hide 1 unknown');
      await strict.click();
      await expect.poll(async () => ((await strict.textContent()) ?? '').trim()).toBe('show 1 unknown');
      expect(await actions.count()).toBe(1);
      expect(await actions.locator('[data-loose-delete]').getAttribute('aria-label')).toContain('feature/nobody-wants-this');
    } finally {
      await page.close();
    }
  }, 60_000);
});
