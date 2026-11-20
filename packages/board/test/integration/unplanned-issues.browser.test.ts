import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { expandTickets } from '../catalogue/index.js';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
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
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'wip', phase: 'Development', group: 'waiting-on-you', ageMinutes: 30,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: null,
  localDirty: false, localLocked: false, stuck: null,
  ...over,
});

const issue = (over: Partial<IssueRow> = {}): IssueRow => ({
  number: 228, title: 'Fleet scan asks the host once per branch', url: '', ageMinutes: 120,
  // The tracker's own word, which the row RENDERS — GitHub's arm sources `open`
  // from `--state open` rather than the board assuming it, so `open` here is a
  // fact the host stated and no longer a literal the renderer wrote.
  status: 'open', statusCategory: 'To Do',
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

describe('an unplanned issue appears in the ticket list', () => {
  // THE STATE IS SERVED, NOT SPAWNED AND STUBBED.
  //
  // This file started `board-server.mjs` over the tiny-garden fixture only to
  // serve `index.html`: it never read `/api/board`, and stubbed `/api/fleet`
  // itself. The mock serves the same built client and answers both payloads by
  // name, so the test states its own input instead of inheriting an estate.
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(payload: Fleet = fleet()): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: payload },
      viewport: { width: 1400, height: 1200 },
    });
    await page.locator('[data-delivery-section="you"]').waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    await expandTickets(page);
    return page;
  }

  // Tickets render in the Delivery tab's trailing list outside the placement rule.
  const section = (page: Page) => page.locator('ul[role="grid"][aria-label="Tickets"]');
  const issueRow = (page: Page, n: string | number) =>
    section(page).locator(`li[data-issue-row="${n}"]`);

  it('shows an issue no plan references, and leaves the branch rows in place', async () => {
    const page = await open();
    try {
      await expect.poll(() => issueRow(page, 228).count()).toBe(1);
      await expect.poll(() => issueRow(page, 227).count()).toBe(1);
      // The branch row is untouched — issues are added to the tab, not
      // substituted for it. Its open green PR places it under Work items › At a gate.
      await expect.poll(() =>
        page.locator('[data-group="at-a-gate"] [data-branch="feature/needs-review"]').count()).toBe(1);
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

  it('does NOT show a Jira-keyed issue a plan references', async () => {
    // The GitHub analog above (`does NOT show an issue a plan references`)
    // only ever passed a numeric key through this path. `entry.issues` is
    // filtered against `issueKey`, which never coerces a Jira key to a
    // number — a regression collapsing it through `Number()` would show here
    // without ever touching a GitHub-shaped fixture.
    //
    // A FIXTURE THAT CAN FAIL: `EWZKUS-3893` is never served at all here, so
    // its absence alone proves nothing — a typo in the assertion, or a
    // renderer that drops every Jira-keyed row regardless of filtering,
    // would pass the same way. `EWZKUS-9001` IS served and asserted present,
    // proving the page renders a Jira-keyed row at all when nothing filters
    // it; only against that baseline does `EWZKUS-3893`'s absence mean the
    // plan-reference filter ran, rather than "Jira rows never render here".
    const page = await open(fleet({
      issues: [
        issue({ number: 228, url: '' }),
        issue({ number: 'EWZKUS-9001', title: 'Not referenced by any plan', url: '' }),
      ],
    }));
    try {
      await expect.poll(() => issueRow(page, 228).count()).toBe(1);
      await expect.poll(() => issueRow(page, 'EWZKUS-9001').count()).toBe(1);
      await expect.poll(() => issueRow(page, 'EWZKUS-3893').count()).toBe(0);
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
      await expect.poll(() => page.locator('section#tickets [data-issue-error]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('says WHY a list cannot be asked, and never that it could not be read', async () => {
    // A Bitbucket repository with no `Tracker` has no issue list to ask. The
    // reason is shown as an absence, not as an outage.
    const absence = 'Open issues are not listed: the git host `bitbucket` has no issue list to read';
    const page = await open(fleet({ issues: [], issueAnswer: 'unsupported', issueAbsence: absence }));
    try {
      const notice = page.locator('section#tickets [data-issue-absence]');
      await expect.poll(() => notice.count()).toBe(1);
      await expect.poll(() => notice.textContent()).toBe(absence);
      await expect.poll(() => page.locator('section#tickets [data-issue-error]').count()).toBe(0);
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
      const notice = page.locator('section#tickets [data-issue-error]');
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
      const notice = page.locator('section#tickets [data-issue-error]');
      await expect.poll(() => notice.count()).toBe(1);
      await expect.poll(() => notice.textContent()).toContain('rate limit');
      await expect.poll(() => notice.textContent()).toContain('8 min');
      await expect.poll(() => notice.textContent()).not.toContain('could not be read');
    } finally {
      await page.close();
    }
  });


});
