import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * NOT STARTED counts PLANS — what only a rendered page can settle.
 *
 * The decisions themselves are pure functions, asserted in
 * `test/unit/not-started-plans.test.ts`. Three things are not: whether the fold
 * OPENS, whether the plan row's columns land on the same tracks as a branch
 * row's, and whether every other section still renders branch rows.
 *
 * The fixture is the live board of 2026-08-17, reduced: `activity-shows-itself`
 * with three unstarted waves, `plot-sprint-support` waiting 187 days on one,
 * `shelved-work` holding a deferred branch with a real PR and a real age, and
 * one WAITING ON YOU row to prove the other sections are untouched.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Design', group: 'not-started', ageMinutes: null,
  note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null,
  ...over,
});

function fleet(): Fleet {
  const rows: AgentRow[] = [
    // The plan that printed three identical rows for one wait.
    row({
      plan: 'activity-shows-itself', planFile: '2026-08-17-activity-shows-itself.md',
      branch: 'feature/activity-marker-glows', waitingDays: 1, note: ELIGIBLE_NOTE,
    }),
    row({
      plan: 'activity-shows-itself', planFile: '2026-08-17-activity-shows-itself.md',
      branch: 'feature/group-shows-inner-activity', waitingDays: 1,
      note: 'blocked by an earlier wave',
    }),
    row({
      plan: 'activity-shows-itself', planFile: '2026-08-17-activity-shows-itself.md',
      branch: 'feature/unpushed-work-shows-still', waitingDays: 1,
      note: 'blocked by an earlier wave',
    }),
    // One unstarted wave, waiting since February.
    row({
      plan: 'plot-sprint-support', planFile: '2026-02-11-plot-sprint-support.md',
      branch: 'feature/plot-sprint-support', waitingDays: 187,
    }),
    // A branch that WAS started and then shelved: it carries a PR and an age
    // that exist nowhere else in this section.
    row({
      plan: 'shelved-work', planFile: '2026-08-10-shelved-work.md',
      branch: 'feature/set-down', state: 'deferred', ageMinutes: 400, waitingDays: 7,
      note: 'last commit 6h ago', branchUrl: `${GH}feature/set-down`,
      pr: { number: 57, url: 'https://github.com/tiny/garden/pull/57', draft: false, state: 'green' },
    }),
    // Untouched neighbours: a real branch holding real work.
    row({
      plan: 'reviewed-plan', planFile: '2026-08-15-reviewed-plan.md',
      branch: 'feature/needs-review', group: 'waiting-on-you', state: 'wip',
      phase: 'Development', ageMinutes: 30, waitingDays: null,
      note: 'PR #116 green', branchUrl: `${GH}feature/needs-review`,
      pr: { number: 116, url: 'https://github.com/tiny/garden/pull/116', draft: false, state: 'green' },
    }),
    row({
      plan: 'quiet-plan', planFile: '2026-08-01-quiet-plan.md',
      branch: 'feature/gone-still', group: 'quiet', state: 'wip', phase: 'Development',
      ageMinutes: 4000, waitingDays: null, note: 'last commit 2d ago',
      branchUrl: `${GH}feature/gone-still`,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 5, waves: 6, branches: rows.length, claimed: 0, eligible: 2, blocked: 2, deferred: 1 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as Fleet;
}

describe('NOT STARTED renders one row per plan', () => {
  let browser: Browser;
  let server: { kill: () => void; port: number };
  let baseURL: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  async function open(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Not started').first().waitFor({ timeout: 10_000 });
    return page;
  }

  /** The NOT STARTED grid — located by its own accessible name. */
  const section = (page: Page) => page.locator('ul[role="grid"][aria-label^="Not started"]');

  const planRow = (page: Page, plan: string) =>
    section(page).locator(`li[data-plan-row="${plan}"]`);

  it('shows ONE row for a plan with three unstarted waves', async () => {
    const page = await open();
    try {
      // The measurement: three rows for one waiting plan, each carrying `pr=—`
      // and `age=—`, the two extras saying nothing the first did not.
      await expect.poll(() => planRow(page, 'activity-shows-itself').count()).toBe(1);
      // And the branches are NOT rendered while it is folded.
      await expect.poll(() =>
        section(page).locator('[data-branch="feature/activity-marker-glows"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('names how many waves remain and that the first is eligible', async () => {
    const page = await open();
    try {
      await expect.poll(() =>
        planRow(page, 'activity-shows-itself').locator('[data-wave-summary]').textContent())
        .toBe('3 waves, first eligible');
    } finally {
      await page.close();
    }
  });

  it('OPENS the fold and brings the three branch names back', async () => {
    const page = await open();
    try {
      // The pairing that matters: an implementation that summarises the waves
      // away passes the one-row assertion above and loses the plan's own words
      // for what it will do. A reader who wants them must not have to open the
      // plan file.
      await page.locator('[data-wave-toggle="activity-shows-itself"]').click();
      for (const branch of [
        'feature/activity-marker-glows',
        'feature/group-shows-inner-activity',
        'feature/unpushed-work-shows-still',
      ]) {
        await expect.poll(() =>
          section(page).locator(`[data-branch="${branch}"]`).count(), { timeout: 5_000 }).toBe(1);
      }
    } finally {
      await page.close();
    }
  });

  it('folds it shut again, and says which state it is in', async () => {
    const page = await open();
    try {
      const toggle = page.locator('[data-wave-toggle="activity-shows-itself"]');
      // `aria-expanded` is what tells a screen reader the fold is shut — the
      // caret alone is a visual fact.
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      await expect.poll(() =>
        section(page).locator('[data-branch="feature/activity-marker-glows"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('gives a plan with ONE unstarted wave no expander, and shows its branch', async () => {
    const page = await open();
    try {
      // A control that reveals a row it already shows is noise. And the row must
      // still be reachable: hiding it behind a control the reader was never
      // given would lose it entirely.
      await expect.poll(() =>
        page.locator('[data-wave-toggle="plot-sprint-support"]').count()).toBe(0);
      await expect.poll(() =>
        section(page).locator('[data-branch="feature/plot-sprint-support"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('reads the plan clock, so 187 days shows where the branch clock is blank', async () => {
    const page = await open();
    try {
      // `waitingLabel(187)` is `6mo` — the unit that reads. Its branch has no
      // tip, so `ageMinutes` says nothing about the six months the plan waited.
      await expect.poll(() =>
        planRow(page, 'plot-sprint-support').getByText('6mo').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('sorts the section by the plan clock, oldest first', async () => {
    const page = await open();
    try {
      // The pairing that matters: `groupByPlan`'s `ageMinutes` sort scores every
      // group here -1, so a test that only checks "the groups are ordered"
      // passes against a sort that does nothing. This asserts the ORDER.
      await expect.poll(() =>
        section(page).locator('li[data-plan-row]').evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-plan-row'))),
      ).toEqual(['plot-sprint-support', 'shelved-work', 'activity-shows-itself']);
    } finally {
      await page.close();
    }
  });

  it('keeps a deferred branch\'s own row, with its own PR and age, under its plan', async () => {
    const page = await open();
    try {
      // It WAS started and then shelved. `fleet.ts` warns what flattening it
      // costs: "a branch started and then shelved read as never begun, with its
      // age and its PR erased."
      const branchRow = section(page).locator('li[data-agent-row]')
        .filter({ has: page.locator('[data-branch="feature/set-down"]') });
      await expect.poll(() => branchRow.count()).toBe(1);
      await expect.poll(() => branchRow.locator('[data-pr-link]').textContent())
        .toContain('57');
      await expect.poll(() => branchRow.getByText('6h', { exact: true }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('leaves every OTHER section rendering branch rows', async () => {
    const page = await open();
    try {
      // The change is confined to the one section whose rows are not branches.
      for (const [label, branch] of [
        ['Waiting on you', 'feature/needs-review'],
        ['Quiet', 'feature/gone-still'],
      ] as const) {
        const grid = page.locator(`ul[role="grid"][aria-label^="${label}"]`);
        // Sections can start folded (`quiet` does) — open it before looking.
        const toggle = page.locator(`[data-group-toggle]`).filter({ hasText: label });
        if (await grid.count() === 0) await toggle.click();
        await expect.poll(() =>
          page.locator(`ul[role="grid"][aria-label^="${label}"] [data-branch="${branch}"]`).count(),
          { timeout: 5_000 }).toBe(1);
        // And NO plan rows there: the branch is rightly the subject.
        await expect.poll(() =>
          page.locator(`ul[role="grid"][aria-label^="${label}"] li[data-plan-row]`).count()).toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  it('lands a plan row\'s columns at the same x as a branch row\'s', async () => {
    const page = await open();
    try {
      // The section boundary must not break alignment — the cost
      // `agent-rows-line-up` paid to remove. Both rows are laid on `ROW_TRACKS`,
      // so the PLAN cell of each must start at one x.
      await page.locator('[data-wave-toggle="activity-shows-itself"]').click();
      const branchRow = section(page).locator('li[data-agent-row]')
        .filter({ has: page.locator('[data-branch="feature/activity-marker-glows"]') });
      await branchRow.waitFor({ timeout: 5_000 });
      // Cell 3 is the BRANCH track on both: the branch name on a branch row, the
      // wave summary on a plan row. If the tracks agreed only by accident, these
      // two would differ.
      const planCell = await planRow(page, 'activity-shows-itself')
        .locator('[role="gridcell"]').nth(2).boundingBox();
      const branchCell = await branchRow.locator('[role="gridcell"]').nth(2).boundingBox();
      expect(planCell!.x).toBeCloseTo(branchCell!.x, 0);
      expect(planCell!.width).toBeCloseTo(branchCell!.width, 0);
    } finally {
      await page.close();
    }
  });
});
