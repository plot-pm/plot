import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * A FOLDED PLAN SAYS WHAT IT HIDES — the DOM half.
 *
 * The precedence and the count are pure and live in
 * `test/unit/tuple-row.test.ts`. What only a rendered page can settle is the one
 * decision the brief warns costs a fix if got wrong: the badge must appear on
 * BOTH plan-head paths, which are asymmetric.
 *
 *   - the PLAN-GROUP path — NOT STARTED (`countsPlans`), which folds a plan and
 *     its waves and draws `data-plan-group`;
 *   - the `planHeads` path — a plan head drawn OVER wave groups in WAITING ON
 *     YOU, QUIET and DONE.
 *
 * A test on one path only passes while half the boards stay broken — the very
 * defect the branch exists to end, reported as *"Wo ist 304?"*: a failing PR
 * two rows down inside a fold that read only its phase. So both paths carry a
 * folded plan over a red branch, and each asserts the badge is on its head.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';
const PR = 'https://github.com/tiny/garden/pull/';

const pr = (number: number, state: NonNullable<AgentRow['pr']>['state']) => ({
  number, url: `${PR}${number}`, draft: false, state,
});

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Design', group: 'not-started', ageMinutes: null,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null,
  ...over,
});

/**
 * The fixture carries a plan for each thing the badge must say, on WHICHEVER
 * path exercises it:
 *
 *   PLAN-GROUP (NOT STARTED), deferred branches that kept their PRs:
 *     `two-failures`   two `failing` PRs   → `checks failing (2)`
 *     `all-green`      one `green` PR       → no badge
 *
 *   `planHeads` (WAITING ON YOU), branches with open PRs awaiting review:
 *     `conflict-wins`  `conflicts` + `failing` → `conflicts` (no count, one each)
 *     `just-pending`   one `pending` PR        → `CI running`, the dimmer tone
 *     `lone-failure`   one `failing` PR        → `checks failing`, no count
 */
function fleet(): Fleet {
  const rows: AgentRow[] = [
    // ── PLAN-GROUP PATH: NOT STARTED, folded plan over deferred branches ──
    // Two branches, both failing — a folded head must say `checks failing (2)`.
    row({
      plan: 'two-failures', planFile: '2026-08-10-two-failures.md',
      branch: 'feature/tf-one', wave: 'First', state: 'deferred', waitingDays: 4,
      branchUrl: `${GH}feature/tf-one`, pr: pr(201, 'failing'),
    }),
    row({
      plan: 'two-failures', planFile: '2026-08-10-two-failures.md',
      branch: 'feature/tf-two', wave: 'Second', state: 'deferred', waitingDays: 4,
      branchUrl: `${GH}feature/tf-two`, pr: pr(202, 'failing'),
    }),
    // A green plan in the same section — its head says only its phase.
    row({
      plan: 'all-green', planFile: '2026-08-11-all-green.md',
      branch: 'feature/ag-one', wave: 'Only', state: 'deferred', waitingDays: 2,
      phase: 'Testing', branchUrl: `${GH}feature/ag-one`, pr: pr(210, 'green'),
    }),

    // ── planHeads PATH: WAITING ON YOU, folded plan over open PRs ──
    // A plan carrying BOTH a conflict and a failure — conflicts wins, and with
    // one branch each there is no count.
    row({
      plan: 'conflict-wins', planFile: '2026-08-12-conflict-wins.md',
      branch: 'feature/cw-conflict', wave: 'Rebase', group: 'waiting-on-you', state: 'wip',
      phase: 'Development', ageMinutes: 20, waitingDays: null,
      note: 'PR #221', branchUrl: `${GH}feature/cw-conflict`, pr: pr(221, 'conflicts'),
    }),
    row({
      plan: 'conflict-wins', planFile: '2026-08-12-conflict-wins.md',
      branch: 'feature/cw-failing', wave: 'Checks', group: 'waiting-on-you', state: 'wip',
      phase: 'Development', ageMinutes: 25, waitingDays: null,
      note: 'PR #222', branchUrl: `${GH}feature/cw-failing`, pr: pr(222, 'failing'),
    }),
    // A plan whose one open PR is still building — `CI running`, dimmer.
    row({
      plan: 'just-pending', planFile: '2026-08-13-just-pending.md',
      branch: 'feature/jp-a', wave: 'One', group: 'waiting-on-you', state: 'wip',
      phase: 'Development', ageMinutes: 5, waitingDays: null,
      note: 'PR #231', branchUrl: `${GH}feature/jp-a`, pr: pr(231, 'pending'),
    }),
    row({
      plan: 'just-pending', planFile: '2026-08-13-just-pending.md',
      branch: 'feature/jp-b', wave: 'Two', group: 'waiting-on-you', state: 'wip',
      phase: 'Development', ageMinutes: 6, waitingDays: null,
      note: 'PR #232', branchUrl: `${GH}feature/jp-b`, pr: pr(232, 'pending'),
    }),
    // A plan with a single failing PR — the word, and NO count.
    row({
      plan: 'lone-failure', planFile: '2026-08-14-lone-failure.md',
      branch: 'feature/lf', wave: 'Only', group: 'waiting-on-you', state: 'wip',
      phase: 'Development', ageMinutes: 40, waitingDays: null,
      note: 'PR #241', branchUrl: `${GH}feature/lf`, pr: pr(241, 'failing'),
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 5, waves: 8, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 3 },
    stuck: { stuck: 0, artifact: 0, conflict: 1, unpushed: 0, ci: 3 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as Fleet;
}

describe('a folded plan folds its branches PR states onto its head', () => {
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
    const context = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    return page;
  }

  const planRow = (page: Page, plan: string) =>
    page.locator(`li[data-plan-row="${plan}"]`);
  const fold = (page: Page, plan: string) =>
    planRow(page, plan).locator('[data-plan-pr-fold]');

  // ── PLAN-GROUP PATH (NOT STARTED) ──────────────────────────────────────

  it('PLAN-GROUP PATH: a folded plan over two failing branches says so', async () => {
    const page = await open();
    try {
      // Folded — its branches are not in the DOM — and the head carries the fold.
      await expect.poll(() =>
        page.locator('[data-branch="feature/tf-one"]').count()).toBe(0);
      await expect.poll(() => fold(page, 'two-failures').getAttribute('data-plan-pr-fold'))
        .toBe('failing');
      expect(await fold(page, 'two-failures').textContent()).toContain('checks failing');
      // A COUNT, because more than one branch is affected.
      expect(await fold(page, 'two-failures').getAttribute('data-plan-pr-count')).toBe('2');
      expect(await fold(page, 'two-failures').textContent()).toContain('(2)');
    } finally {
      await page.close();
    }
  });

  it('PLAN-GROUP PATH: keeps the PHASE beside the fold, never replacing it', async () => {
    const page = await open();
    try {
      // Slot 5 still holds the plan's phase — the fold rides beside it. A
      // regression that put the badge INTO the phase slot would lose this.
      await expect.poll(() =>
        planRow(page, 'two-failures').locator('[data-phase]').getAttribute('data-phase'))
        .toBe('Design');
    } finally {
      await page.close();
    }
  });

  it('PLAN-GROUP PATH: a green plan says only its phase', async () => {
    const page = await open();
    try {
      await expect.poll(() =>
        planRow(page, 'all-green').locator('[data-phase]').getAttribute('data-phase'))
        .toBe('Testing');
      // No badge — nothing to act on.
      expect(await fold(page, 'all-green').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── planHeads PATH (WAITING ON YOU) ────────────────────────────────────

  it('planHeads PATH: a folded plan over an open red PR says so', async () => {
    const page = await open();
    try {
      // This is the "Wo ist 304?" case: a red PR under a plan head over wave
      // groups. Fold it if it is open, then read the head.
      const toggle = page.locator('[data-wave-toggle="lone-failure"]');
      if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
      await expect.poll(() => fold(page, 'lone-failure').getAttribute('data-plan-pr-fold'))
        .toBe('failing');
      expect(await fold(page, 'lone-failure').textContent()).toContain('checks failing');
      // ONE branch, so NO count.
      expect(await fold(page, 'lone-failure').getAttribute('data-plan-pr-count')).toBeNull();
      expect(await fold(page, 'lone-failure').textContent()).not.toContain('(');
    } finally {
      await page.close();
    }
  });

  it('planHeads PATH: conflicts wins over failing on a plan carrying both', async () => {
    const page = await open();
    try {
      const toggle = page.locator('[data-wave-toggle="conflict-wins"]');
      if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
      await expect.poll(() => fold(page, 'conflict-wins').getAttribute('data-plan-pr-fold'))
        .toBe('conflicts');
      expect(await fold(page, 'conflict-wins').textContent()).toContain('conflicts');
      // One conflict, one failure — the winning state has a count of one, so no
      // parenthesis.
      expect(await fold(page, 'conflict-wins').getAttribute('data-plan-pr-count')).toBeNull();
    } finally {
      await page.close();
    }
  });

  it('planHeads PATH: pending renders in the DIMMER tone, not the actionable one', async () => {
    const page = await open();
    try {
      const toggle = page.locator('[data-wave-toggle="just-pending"]');
      if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
      await expect.poll(() => fold(page, 'just-pending').getAttribute('data-plan-pr-fold'))
        .toBe('pending');
      expect(await fold(page, 'just-pending').textContent()).toContain('CI running');
      // The dimmer slate, distinct from the actionable rose the two red states
      // wear — *something is happening* against *do something*.
      const cls = (await fold(page, 'just-pending').getAttribute('class')) ?? '';
      expect(cls).toContain('text-slate-400');
      expect(cls).not.toContain('rose');
      // And the actionable states DO wear rose, which is what makes the contrast
      // a fact rather than an assumption.
      const failToggle = page.locator('[data-wave-toggle="lone-failure"]');
      if (await failToggle.getAttribute('aria-expanded') === 'true') await failToggle.click();
      const failCls = (await fold(page, 'lone-failure').getAttribute('class')) ?? '';
      expect(failCls).toContain('rose');
    } finally {
      await page.close();
    }
  });

  it('planHeads PATH: the fold STAYS when the group is expanded', async () => {
    const page = await open();
    try {
      // A long group scrolls its head off screen either way, so the fact must
      // not vanish on expand — the rule the change mark's own docstring names as
      // the shape it should have had.
      const toggle = page.locator('[data-wave-toggle="conflict-wins"]');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      // Branches are on screen now — and the head still carries the fold.
      await expect.poll(() =>
        page.locator('[data-branch="feature/cw-conflict"]').count()).toBeGreaterThan(0);
      expect(await fold(page, 'conflict-wins').getAttribute('data-plan-pr-fold'))
        .toBe('conflicts');
    } finally {
      await page.close();
    }
  });
});
