import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
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
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
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
      // `innerText`, not `textContent`. The slot carries an `sr-only` word
      // naming the column — measured, `textContent` reads
      // `planfleet-scan-asks-the-host-once` — and that word is for a screen
      // reader, not part of the name. `innerText` is computed from layout and
      // reports what a sighted reader sees, which is what this claims.
      await expect.poll(() => name.evaluate((el) => (el as HTMLElement).innerText.trim()))
        .toBe('fleet-scan-asks-the-host-once');
      await expect.poll(() => name.locator('a').count()).toBe(0);
      await expect.poll(() => name.evaluate((el) => el.tagName)).not.toBe('A');
    } finally {
      await page.close();
    }
  });

  it('is labelled Ticket, and is NOT given a plan phase it does not have', async () => {
    // Slot 2 read `Discovery` on this row — a PLAN PHASE on a thing that is not
    // a plan and has never entered the lifecycle that word comes from. It was
    // defended as *not a fifth phase; the first one, worn by something that is
    // not a plan yet*, which is coherent and still borrows another object's
    // vocabulary to say what this row is.
    //
    // And the sentence that explained it was a TOOLTIP — *"Not a plan yet, this
    // row asks whether it should become one"* — hover-only text doing a label's
    // job, which is the second defect this branch closes.
    const page = await open();
    try {
      const kind = issueRow(page, 228).locator('[data-kind]');
      // `Ticket`, and it said `Story` until 2026-08-20. A story is a Plot
      // artefact — an umbrella over several plans, tracked in `docs/stories` —
      // and this row is an ISSUE on the git host that no plan references yet.
      // Two different things, and the row was labelled with the other one's
      // name; `KIND_LABEL` was corrected and this assertion was not.
      await expect.poll(() => kind.textContent()).toBe('Ticket');
      // The phase word is gone, and so is the tooltip that stood in for a label.
      await expect.poll(() => issueRow(page, 228).locator('[data-phase]').count()).toBe(0);
      expect(await issueRow(page, 228).textContent()).not.toContain('Discovery');
      const cell = issueRow(page, 228).locator('[role="gridcell"]').nth(1);
      expect(await cell.getAttribute('title')).toBeNull();
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
      // NO BRANCH IS INVENTED — the claim, and slot 4 is no longer where it is
      // read. That slot was the branch COLUMN under `ROW_TRACKS`; the tuple
      // made it the ARTIFACT slot, and on a ticket it carries the plan name the
      // issue would become. Measured: `fleet-scan-asks-the-host-once`, which is
      // a plan slug and not a branch.
      //
      // So the assertion is asked of the branch itself, one line down, which is
      // where it was always true — an empty cell was only ever a proxy for it.
      expect(await cells.nth(3).evaluate((el) => (el as HTMLElement).innerText.trim()))
        .not.toMatch(/^(feature|bug|docs|infra|idea)\//);
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
