import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { headingOf } from '../../src/app/lib/agent-rows/waiting-view.js';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet, type IssueRow } from '../../src/contract/schema.js';

/**
 * Issue #1960, observed 2026-10-17: with 9 tickets assigned to the reader, the
 * rows with the longest titles showed only the plan icon and the block had no
 * `Assigned to you · 9` sub-header. The payload below is the `/api/fleet`
 * answer quoted there: `waiting: {shown: 9, hidden: 22, complete: true,
 * notice: null, source: {github, host-login}}`.
 */
const LONG_TITLE =
  'Waiting on you: a long ticket title squeezes the plan name out of its row and the assigned sub-header does not render';

const issue = (number: number, title: string): IssueRow => ({
  number, title, url: `https://github.com/tiny/garden/issues/${number}`, ageMinutes: 120,
  status: 'open', statusCategory: 'To Do', type: 'bug', owner: 'jwloka',
});

const OVERFLOWING = [1952, 1951, 1950, 1867, 1856, 1837];
const SHORT = [1849, 1848, 1830];

const tickets: IssueRow[] = [
  ...OVERFLOWING.map((n) => issue(n, `${LONG_TITLE} (#${n})`)),
  ...SHORT.map((n) => issue(n, 'Jira inbox and issue source')),
];

const productionFleet = (): Fleet => {
  const rows: AgentRow[] = [{
    repo: 'garden', branch: 'feature/needs-review', plan: 'reviewed-plan', planFile: '2026-08-15-reviewed-plan.md',
    wave: 'w', state: 'wip', phase: 'Development', group: 'waiting-on-you', ageMinutes: 30,
    waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: null,
    localDirty: false, localLocked: false, stuck: null,
  }];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: tickets,
    issueAnswer: 'answered',
    issueError: null,
    waiting: {
      tickets, shown: 9, hidden: 22, complete: true, notice: null,
      source: { service: 'github', match: 'host-login' },
    },
  } as Fleet;
};

describe('a long ticket title keeps its plan name in WAITING ON YOU', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  // 640 px is the `sm` breakpoint: the narrowest width at which rows are grids.
  const open = async (): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: productionFleet() },
      viewport: { width: 640, height: 1200 },
    });
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  };

  const section = (page: Page) => page.locator('ul[role="grid"][aria-label^="Waiting on you"]');
  const issueRow = (page: Page, n: number) => section(page).locator(`li[data-issue-row="${n}"]`);

  it('shows the sub-header the domain wrote for 9 assigned tickets', async () => {
    const page = await open();
    try {
      const heading = section(page).locator('[data-waiting-heading]');
      await expect.poll(() => heading.innerText()).toBe(headingOf(9, true));
      await expect.poll(() => heading.innerText()).toBe('Assigned to you · 9');
      expect(await heading.isVisible()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it.each(OVERFLOWING)('shows a readable plan name beside the overflowing title of #%i', async (n) => {
    const page = await open();
    try {
      const name = issueRow(page, n).locator('[data-issue-name]');
      await expect.poll(() => name.innerText()).not.toBe('');
      expect(await name.isVisible()).toBe(true);
      const box = await name.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(60);
      // The title is the column that gives way.
      const title = issueRow(page, n).locator('[data-issue-link]');
      expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth || el.querySelector('.truncate') !== null)).toBe(true);
    } finally {
      await page.close();
    }
  });
});
