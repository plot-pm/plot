import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet, type IssueRow } from '../../src/contract/schema.js';

/**
 * An issue is a signal the board can see — what only a rendered page settles.
 *
 * The fixture is the observation that produced the plan: #226, #227 and #228
 * open for hours with measurements and line numbers in each, none of them on
 * the board, because the board reads `docs/plans/` and an issue is not a plan.
 *
 * Three of these assertions are about what the row must NOT do, and each one
 * names a specific fabrication: a plan link with no plan behind it, a branch
 * name for a branch that does not exist, and a tracker URL the host never gave.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'wip', phase: 'Development', group: 'waiting-on-you', ageMinutes: 30,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, repair: null,
  ...over,
});

const issue = (over: Partial<IssueRow> = {}): IssueRow => ({
  number: 228, title: 'Fleet scan asks the host once per branch', url: '', ageMinutes: 120,
  ...over,
});

function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    // A real branch in the same section, so the issue rows are proved to sit
    // BESIDE branch rows rather than to replace them.
    row({
      plan: 'reviewed-plan', planFile: '2026-08-15-reviewed-plan.md',
      branch: 'feature/needs-review', note: 'PR #116 green',
      branchUrl: `${GH}feature/needs-review`,
      pr: { number: 116, url: 'https://github.com/tiny/garden/pull/116', draft: false, state: 'green' },
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 1, waves: 1, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [
      issue({
        number: 228, title: 'Fleet scan asks the host once per branch',
        url: 'https://github.com/tiny/garden/issues/228', ageMinutes: 120,
      }),
      // The host reported NO address for this one.
      issue({ number: 227, title: 'A blocked wave is not eligible', url: '', ageMinutes: 180 }),
    ],
    issueAnswer: 'answered',
    issueError: null,
    ...over,
  } as Fleet;
}

describe('an unplanned issue appears in WAITING ON YOU', () => {
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

  async function open(payload: Fleet = fleet()): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    return page;
  }

  const section = (page: Page) => page.locator('ul[role="grid"][aria-label^="Waiting on you"]');
  const issueRow = (page: Page, n: number) => section(page).locator(`li[data-issue-row="${n}"]`);

  it('shows an issue no plan references, beside the branch rows', async () => {
    const page = await open();
    try {
      await expect.poll(() => issueRow(page, 228).count()).toBe(1);
      await expect.poll(() => issueRow(page, 227).count()).toBe(1);
      // The branch row is untouched — issues are added to the section, not
      // substituted for it.
      await expect.poll(() =>
        section(page).locator('[data-branch="feature/needs-review"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('does NOT show an issue a plan references', async () => {
    // The server filters these out — `issues` is already the unplanned set — so
    // what a rendered page proves is that nothing downstream puts them back.
    const page = await open(fleet({ issues: [issue({ number: 228, url: '' })] }));
    try {
      await expect.poll(() => issueRow(page, 228).count()).toBe(1);
      await expect.poll(() => issueRow(page, 227).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('renders the inferred name as TEXT, never as an anchor', async () => {
    // Nothing is behind the name yet, and a link to a plan that does not exist
    // is the fabrication this board keeps removing.
    const page = await open();
    try {
      const name = issueRow(page, 228).locator('[data-issue-name]');
      await expect.poll(() => name.textContent()).toBe('fleet-scan-asks-the-host-once');
      await expect.poll(() => name.locator('a').count()).toBe(0);
      await expect.poll(() => name.evaluate((el) => el.tagName)).not.toBe('A');
    } finally {
      await page.close();
    }
  });

  it('leaves the branch column EMPTY rather than deriving a name', async () => {
    // A derived branch name would be indistinguishable from a branch nobody has
    // claimed — a row this board already renders, meaning something else.
    const page = await open();
    try {
      const cells = issueRow(page, 228).locator('[role="gridcell"]');
      // Track 4 (0-indexed 3) is the branch column — see ROW_TRACKS.
      await expect.poll(() => cells.nth(3).textContent()).toBe('');
      // And no branch marker anywhere on the row.
      await expect.poll(() => issueRow(page, 228).locator('[data-branch]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('links the number to the tracker when the host gave an address', async () => {
    const page = await open();
    try {
      const link = issueRow(page, 228).locator('a[data-issue-link]');
      await expect.poll(() => link.count()).toBe(1);
      await expect.poll(() => link.getAttribute('href'))
        .toBe('https://github.com/tiny/garden/issues/228');
    } finally {
      await page.close();
    }
  });

  it('renders the number as PLAIN TEXT when the host gave none', async () => {
    // `PrCell`'s own rule: a host that reported no address renders the number
    // as text rather than an invented link.
    const page = await open();
    try {
      await expect.poll(() => issueRow(page, 227).locator('[data-issue-number]').count()).toBe(1);
      await expect.poll(() => issueRow(page, 227).locator('a[data-issue-link]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('renders NOTHING for a host with no tracker, rather than an empty section', async () => {
    const page = await open(fleet({ issues: [], issueAnswer: 'unsupported' }));
    try {
      await page.locator('[data-branch="feature/needs-review"]').first().waitFor({ timeout: 10_000 });
      await expect.poll(() => section(page).locator('li[data-issue-row]').count()).toBe(0);
      // And no outage notice: nothing failed, this host simply has no issues.
      await expect.poll(() => section(page).locator('[data-issue-error]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('says a failed lookup is UNKNOWN, never "no issues"', async () => {
    // The rule `an-outage-is-not-an-answer`. Silence here is indistinguishable
    // from an empty inbox, and a reader would conclude they had nothing to
    // decide. Asserted with an OUTAGE, so the wording pinned is the *could not
    // be read* one — the rate-limit case, a THIRD state, is checked below.
    const page = await open(fleet({
      issues: [], issueAnswer: 'failed', issueError: 'gh: 503 Service Unavailable',
    }));
    try {
      const notice = section(page).locator('[data-issue-error]');
      await expect.poll(() => notice.count()).toBe(1);
      await expect.poll(() => notice.textContent()).toContain('could not be read');
    } finally {
      await page.close();
    }
  });

  it('says a spent rate limit is a rate limit, never "could not be read"', async () => {
    // `2026-08-20-a-rate-limit-is-not-an-outage.md`: a rate limit means the
    // tracker was REFUSED, not that reading it failed. *could not be read*
    // claims a check that ran and failed — the honest word is that the budget
    // is spent and returns. The issue poll shares the PR gate, so
    // `prNextInSeconds` is its reset too; 480 s is the measured ~8-minute reset.
    const page = await open(fleet({
      issues: [], issueAnswer: 'failed',
      issueError: 'GraphQL: API rate limit already exceeded for user ID 870334',
      prNextInSeconds: 480,
    }));
    try {
      const notice = section(page).locator('[data-issue-error]');
      await expect.poll(() => notice.count()).toBe(1);
      await expect.poll(() => notice.textContent()).toContain('rate limit');
      await expect.poll(() => notice.textContent()).toContain('8 min');
      await expect.poll(() => notice.textContent()).not.toContain('could not be read');
    } finally {
      await page.close();
    }
  });

  it('counts issue rows in the section tally', async () => {
    // One branch row plus two issues: a heading reading (1) above three lines
    // is the mismatch NOT STARTED already had to fix once.
    const page = await open();
    try {
      await expect.poll(async () =>
        (await page.getByRole('button', { name: /Waiting on you/ }).first().textContent())?.includes('(3)'))
        .toBe(true);
    } finally {
      await page.close();
    }
  });
});
