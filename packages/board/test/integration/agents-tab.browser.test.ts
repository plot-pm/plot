import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { findFreePort, startServer } from '../helpers.mjs';
import type { AgentRow, Fleet } from '../../src/contract/schema.js';

/**
 * The Agents tab, driven in a REAL browser against the shipped artifact.
 *
 * `/api/fleet` is stubbed at the network boundary rather than by building a git
 * fixture: every claim here is about what the tab RENDERS from a pulse — which
 * links exist and where they point, how rows are grouped, whether a countdown
 * appears — and a synthetic pulse states the awkward cases (a merged branch, a
 * row with no PR, a server that reports no PR interval) exactly. The server's
 * half of the same contract is pinned in test/unit/fleet.test.ts against the
 * real `rowsFromPulse`.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  group: 'working', ageMinutes: 3, note: 'last commit 3 min ago', pr: null,
  branchUrl: `${GH}feature/x`, waitingDays: null, ...over,
});

/** A pulse carrying the cases the plan's *Done when* list names. */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    // Two plans in `working`, so the group earns sub-headings. `beans` holds the
    // older row, so it must be the first plan shown.
    row({ branch: 'feature/beans-a', plan: 'beans', ageMinutes: 200 }),
    row({ branch: 'feature/beans-b', plan: 'beans', ageMinutes: 10 }),
    row({ branch: 'feature/toms-a', plan: 'plant-tomatoes', ageMinutes: 50 }),
    // A branch WITH a PR: the two links must differ, each landing where its own
    // text points.
    row({
      branch: 'feature/reviewed', plan: 'beans', group: 'waiting-on-you',
      ageMinutes: 20, note: 'PR #130 green',
      pr: { number: 130, url: 'https://github.com/tiny/garden/pull/130' },
      branchUrl: `${GH}feature/reviewed`,
    }),
    // A not-started row: no PR at all, and exactly the class the rejected
    // PR-URL derivation would have left unlinked.
    row({
      branch: 'feature/untaken', plan: 'plant-tomatoes', group: 'not-started',
      ageMinutes: null, note: 'eligible — nobody has taken it',
      branchUrl: `${GH}feature/untaken`, waitingDays: 22,
    }),
    // A not-started row whose plan records no approval date — every plan
    // predating the `Approved:` field. It must show no waiting age at all.
    row({
      branch: 'feature/undated', plan: 'beans', group: 'not-started',
      ageMinutes: null, note: 'eligible — nobody has taken it',
      branchUrl: `${GH}feature/undated`, waitingDays: null,
    }),
    // A merged branch: its remote page is gone, so no branch link.
    row({
      branch: 'feature/landed', plan: 'plant-tomatoes', group: 'done',
      state: 'merged', ageMinutes: 300, note: 'merged', branchUrl: '',
    }),
    // A plan with no board card — tiny-garden has no such plan file, so the row
    // must keep its plain /plan/ link rather than open an empty modal.
    row({
      branch: 'feature/ghost', plan: 'ghost-plan', planFile: '2099-01-01-ghost-plan.md',
      group: 'quiet', ageMinutes: 999, note: 'no commit for 16 hours',
      branchUrl: `${GH}feature/ghost`,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1,
    ready: true,
    error: null,
    rows,
    summary: {
      plans: 3, waves: 3, branches: rows.length,
      claimed: 0, eligible: 1, blocked: 0, deferred: 0,
    },
    prAgeSeconds: 74,
    prNextInSeconds: 46,
    scanNextInSeconds: 3,
    prError: null,
    ...over,
  };
}

describe('tiny-garden: the Agents tab (real browser renders the shipped artifact)', () => {
  let server: { port: number; kill: () => void };
  let browser: Browser;
  let baseURL: string;

  beforeAll(async () => {
    server = await startServer(FIXTURE, await findFreePort());
    baseURL = `http://localhost:${server.port}/`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  /** Open the Agents tab with `/api/fleet` answering with `payload`. */
  async function openAgents(payload: Fleet = fleet()): Promise<Page> {
    const page = await browser.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    return page;
  }

  /**
   * The same, having waited for `/api/board` as well.
   *
   * A plan row's click needs the board's cards to find its own, and until they
   * land the app deliberately swallows the click rather than navigating away
   * from a live view for a plan it is about to have. Visiting the board tab is
   * how a real reader waits for that.
   */
  async function openAgentsWithBoard(payload: Fleet = fleet()): Promise<Page> {
    const page = await openAgents(payload);
    await page.getByRole('button', { name: 'Board' }).click();
    await page.getByText('Deal with the zucchini glut').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Agents' }).click();
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    return page;
  }

  /**
   * Open the Agents tab, then hand back a switch that makes `/api/fleet` fail.
   *
   * The dead-server case cannot be stated as a payload — that is the entire
   * defect. `fleet.error` is the server ANSWERING to say its scan failed; this
   * is the server answering nothing, so it has to be produced at the network
   * boundary, by aborting the request the way an unreachable port does.
   *
   * The route is installed once and reads a mutable flag rather than being
   * re-registered, so a poll in flight at the moment of the switch cannot slip
   * past an unrouted window and land a success the test did not intend.
   */
  async function openAgentsWithFailSwitch(
    payload: Fleet = fleet(),
  ): Promise<{ page: Page; fail: () => void; recover: () => void }> {
    let failing = false;
    const page = await browser.newPage();
    await page.route('**/api/fleet', (route) =>
      failing
        ? route.abort('connectionrefused')
        : route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    return { page, fail: () => { failing = true; }, recover: () => { failing = false; } };
  }

  /** The section for one waiting-group, by its heading text. */
  const group = (page: Page, label: string) =>
    page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: new RegExp(label) }),
    });

  const staleBanner = (page: Page) => page.getByText(/Not reaching the board server/);

  const footer = (page: Page) => page.getByText(/branches across .* plans/);

  // ── Every link goes where its text says ───────────────────────────────────

  it('links the branch name to the BRANCH and PR #<n> to the pull request', async () => {
    // The defect this replaces: one link, on the wrong word — the branch name
    // opened the PR while `PR #130` beside it was plain text. Asserting merely
    // that "a link exists" passes on that bug, so the assertion is that the two
    // targets DIFFER and each matches its own text.
    const page = await openAgents();
    try {
      const branchHref = await page.getByRole('link', { name: 'feature/reviewed' })
        .getAttribute('href');
      const prHref = await page.getByRole('link', { name: 'PR #130' }).getAttribute('href');
      expect(branchHref).toBe('https://github.com/tiny/garden/tree/feature/reviewed');
      expect(prHref).toBe('https://github.com/tiny/garden/pull/130');
      expect(branchHref).not.toBe(prHref);
    } finally {
      await page.close();
    }
  });

  it('links a not-started branch, which has no PR to derive one from', async () => {
    const page = await openAgents();
    try {
      expect(await page.getByRole('link', { name: 'feature/untaken' }).getAttribute('href'))
        .toBe('https://github.com/tiny/garden/tree/feature/untaken');
    } finally {
      await page.close();
    }
  });

  it('leaves a merged branch as plain text — its remote page is gone', async () => {
    const page = await openAgents();
    try {
      expect(await page.getByRole('link', { name: 'feature/landed' }).count()).toBe(0);
      await expect.poll(() => page.getByText('feature/landed').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('renders every branch as plain text when the server reports no branch URLs', async () => {
    // An unrecognised origin. No guessed URL shape — the same rule a PR with no
    // reported address already follows.
    const page = await openAgents(
      fleet({ rows: fleet().rows.map((r) => ({ ...r, branchUrl: '' })) }),
    );
    try {
      expect(await page.getByRole('link', { name: 'feature/reviewed' }).count()).toBe(0);
      expect(await page.getByRole('link', { name: 'feature/untaken' }).count()).toBe(0);
      // The PR link is unaffected: it never came from the branch URL.
      expect(await page.getByRole('link', { name: 'PR #130' }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('leaves `green` as plain text — the row carries no checks URL', async () => {
    const page = await openAgents();
    try {
      expect(await page.getByRole('link', { name: 'green' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── Rows group by plan inside each waiting-group ──────────────────────────

  it('shows a sub-heading per plan, ordered by each plan\'s most urgent row', async () => {
    const page = await openAgents();
    try {
      const headings = group(page, 'Working').getByRole('heading', { level: 3 });
      // `beans` holds the 200-minute row, `plant-tomatoes` the 50-minute one —
      // so beans first. Ordering by anything else would let a plan with one
      // stale branch outrank one whose branch just moved.
      await expect.poll(() => headings.allTextContents())
        .toEqual(['beans(2)', 'plant-tomatoes(1)']);
    } finally {
      await page.close();
    }
  });

  it('gives a group holding ONE plan no sub-heading', async () => {
    const page = await openAgents();
    try {
      // `waiting-on-you` has a single plan. Chrome that never varies is noise.
      expect(await group(page, 'Waiting on you').getByRole('heading', { level: 3 }).count())
        .toBe(0);
    } finally {
      await page.close();
    }
  });

  it('groups DONE like every other group', async () => {
    // The group that grows fastest over a working day is the first to become a
    // list one scrolls past — a rule with an exception for it is a rule someone
    // has to remember.
    const rows = [
      ...fleet().rows,
      row({
        branch: 'feature/also-landed', plan: 'beans', group: 'done', state: 'merged',
        ageMinutes: 120, note: 'merged', branchUrl: '',
      }),
    ];
    const page = await openAgents(fleet({ rows }));
    try {
      await expect.poll(() => group(page, 'Done').getByRole('heading', { level: 3 }).count())
        .toBe(2);
    } finally {
      await page.close();
    }
  });

  it('puts NOT STARTED above QUIET — actionable before diagnostic', async () => {
    // Work a person can pick up now outranks work they must go investigate.
    const page = await openAgents();
    try {
      const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
      const at = (label: string) => headings.findIndex((h) => h.includes(label));
      expect(at('Not started')).toBeLessThan(at('Quiet'));
      // And the groups before it are untouched.
      expect(at('Waiting on you')).toBeLessThan(at('Working'));
      expect(at('Quiet')).toBeLessThan(at('Done'));
    } finally {
      await page.close();
    }
  });

  it('shows the plan BEFORE the branch in a row', async () => {
    // What this belongs to, then which slice of it. With the branch first,
    // branch names of differing length left the plan column frayed across rows
    // of one plan — the grouping undone by the layout beside it. Asserted
    // because a swap like this silently reverts in a later refactor.
    const page = await openAgents();
    try {
      const cells = await group(page, 'Waiting on you')
        .locator('li').first()
        .locator('a, span.font-mono').allTextContents();
      const plan = cells.findIndex((t) => t.trim() === 'beans');
      const branch = cells.findIndex((t) => t.trim() === 'feature/reviewed');
      expect(plan).toBeGreaterThanOrEqual(0);
      expect(branch).toBeGreaterThanOrEqual(0);
      expect(plan).toBeLessThan(branch);
    } finally {
      await page.close();
    }
  });

  it('shows the waiting age IN the age column, and nothing without a date', async () => {
    // One age column, answering "how old is this" once. An earlier cut put the
    // waiting age in its own badge mid-row and left the column reading "—":
    // two places for one question, one of them empty. The distinction that
    // matters — a plan approved 22d ago is not a branch untouched for 22d — is
    // carried by colour and title, not by a second position.
    const page = await openAgents();
    try {
      const untaken = page.locator('li', { hasText: 'feature/untaken' });
      await expect.poll(() => untaken.getByTitle(/nobody has started it/).count()).toBe(1);
      await expect.poll(() => untaken.getByTitle(/nobody has started it/).textContent())
        .toBe('22d');
      // And NOT beside it: the row must not carry the age twice. Asserted on
      // the LAST cell rather than by searching the row for an em dash — the
      // note reads "eligible — nobody has taken it" and contains one, so a
      // text search finds the wrong thing and passes for the wrong reason.
      await expect.poll(() => untaken.locator('span').last().textContent()).toBe('22d');
      expect(await untaken.getByText(/waiting/).count()).toBe(0);
      // No approval date recorded — nothing rather than a zero or a "just now".
      const undated = page.locator('li', { hasText: 'feature/undated' });
      expect(await undated.getByTitle(/nobody has started it/).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('never puts a waiting age on a row that has a branch tip age', async () => {
    // The two clocks must never appear on one row: `ageMinutes` is the better
    // answer wherever a branch exists, and a second age beside it would compete.
    const page = await openAgents();
    try {
      for (const branch of ['feature/beans-a', 'feature/reviewed', 'feature/landed']) {
        const li = page.locator('li', { hasText: branch });
        expect(await li.getByText(/waiting/).count()).toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  it('keeps rows in age order inside a plan', async () => {
    const page = await openAgents();
    try {
      const branches = await group(page, 'Working')
        .locator('li a[href*="/tree/"], li span.font-mono').allTextContents();
      // beans: 200 then 10; then plant-tomatoes: 50.
      expect(branches).toEqual(['feature/beans-a', 'feature/beans-b', 'feature/toms-a']);
    } finally {
      await page.close();
    }
  });

  // ── Both footer ages gain a countdown ─────────────────────────────────────

  it('shows both countdowns beside their ages', async () => {
    const page = await openAgents();
    try {
      const text = await footer(page).textContent();
      expect(text).toMatch(/scanned \d+s ago · next in \d+s/);
      expect(text).toMatch(/PR data \d+s ago · next in \d+s/);
    } finally {
      await page.close();
    }
  });

  it('shows NO git countdown when the server does not report its scan interval', async () => {
    // The mirror of the PR case below, and it caught a real bug twice over.
    // First the countdown was computed from the CLIENT's 4 s poll against
    // `ageSeconds`, which dates the SERVER's 5 s scan — reliably negative, so
    // it read "next in 0s" permanently. Then the fix used `=== null`, and a
    // payload that never went through the schema sends `undefined`, which
    // rendered "next in NaNs". Both are worse than showing nothing.
    const page = await openAgents(fleet({ scanNextInSeconds: null }));
    try {
      const text = (await footer(page).textContent()) ?? '';
      expect(text).toMatch(/scanned \d+s ago/);
      expect(text).not.toContain('NaN');
      // Exactly one countdown remains: the PR's.
      expect(text.match(/next in/g) ?? []).toHaveLength(1);
    } finally {
      await page.close();
    }
  });

  it('shows NO PR countdown when the server does not report its interval', async () => {
    // The load-bearing negative: `PR_REFRESH_MS` is 60 s but backs off to 120 s,
    // so a client assuming 60 s would count to zero and sit there — rendering
    // "I don't know" as "any moment now". An older server sends nothing here.
    const page = await openAgents(fleet({ prNextInSeconds: null }));
    try {
      const text = (await footer(page).textContent()) ?? '';
      expect(text).toMatch(/PR data \d+s ago/);
      // Exactly one countdown remains: git's.
      expect(text.match(/next in/g) ?? []).toHaveLength(1);
    } finally {
      await page.close();
    }
  });

  it('the countdown ticks — it is not a static number', async () => {
    const page = await openAgents();
    try {
      const read = async () => {
        const t = (await footer(page).textContent()) ?? '';
        return Number(/scanned \d+s ago · next in (\d+)s/.exec(t)?.[1]);
      };
      const first = await read();
      await expect.poll(read, { timeout: 6_000 }).not.toBe(first);
    } finally {
      await page.close();
    }
  });

  it('leaves NO ticking counter behind when the agents tab is closed', async () => {
    // App.tsx already stops polling when the tab is not open, so a counter that
    // kept ticking would count toward a refresh that is not coming. The whole
    // list unmounts with the tab — asserted rather than assumed, because "it
    // stops" is exactly the kind of claim prose makes and code forgets.
    const page = await openAgents();
    try {
      await page.getByRole('button', { name: 'Board' }).click();
      await expect.poll(() => footer(page).count()).toBe(0);
      // Returning brings it back live rather than frozen where it left off.
      await page.getByRole('button', { name: 'Agents' }).click();
      await footer(page).waitFor({ timeout: 5_000 });
      const read = async () => {
        const t = (await footer(page).textContent()) ?? '';
        return Number(/scanned \d+s ago · next in (\d+)s/.exec(t)?.[1]);
      };
      const first = await read();
      await expect.poll(read, { timeout: 6_000 }).not.toBe(first);
    } finally {
      await page.close();
    }
  });

  // ── A dead server says so, rather than looking alive ──────────────────────
  //
  // The incident these pin: on 2026-08-16 two screenshots were reported as
  // regressions ("the heading is still there", "the link is still missing").
  // Both were the frozen last render of a page whose server had stopped. Three
  // hypotheses — stale bundle, JSX guard, minification — were spent before
  // anyone checked what was running. Every assertion below is one that would
  // have ended that in a glance.

  it('says the server is unreachable after ONE failed fetch', async () => {
    // ONE, not two. A two-strikes implementation passes a test written against
    // two failures, which is why this counts them: the poll is 4 s, so a
    // two-strikes rule would leave the page confident for up to 8 s — and the
    // whole cost of this bug was a page that looked confident.
    //
    // The outcomes are asymmetric and that is what settles it: a false alarm
    // shows a banner that clears itself on the next poll, while a missed dead
    // server costs a misdiagnosis.
    const { page, fail } = await openAgentsWithFailSwitch();
    try {
      let failures = 0;
      page.on('requestfailed', (r) => { if (r.url().includes('/api/fleet')) failures += 1; });
      fail();
      await staleBanner(page).waitFor({ timeout: 10_000 });
      expect(failures).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('stops the countdown rather than clamping it at "next in 0s"', async () => {
    // The current behaviour clamps, and "next in 0s" reads as *about to
    // refresh* — the precise opposite of the truth, held indefinitely. The
    // assertion is the absence of a countdown, not a frozen one: a number held
    // at 3 is still a prediction, and no refresh is coming.
    const { page, fail } = await openAgentsWithFailSwitch();
    try {
      expect(await footer(page).textContent()).toMatch(/next in \d+s/);
      fail();
      await staleBanner(page).waitFor({ timeout: 10_000 });
      await expect.poll(async () => (await footer(page).textContent()) ?? '')
        .not.toMatch(/next in/);
      expect(await footer(page).textContent()).not.toContain('next in 0s');
    } finally {
      await page.close();
    }
  });

  it('freezes the ages instead of ageing against a scan that is not happening', async () => {
    // The assertion a banner-only test passes without: `ageSeconds + tick` kept
    // climbing under the old code, and a number that keeps moving is the most
    // convincing part of a dead page. Read twice across more than a poll
    // interval — a frozen clock and a slow one are only distinguishable over
    // time.
    const { page, fail } = await openAgentsWithFailSwitch();
    try {
      const scanned = async () =>
        Number(/scanned (\d+)s ago/.exec((await footer(page).textContent()) ?? '')?.[1]);
      fail();
      await staleBanner(page).waitFor({ timeout: 10_000 });
      const frozen = await scanned();
      expect(Number.isFinite(frozen)).toBe(true);
      await page.waitForTimeout(5_000);
      expect(await scanned()).toBe(frozen);
      // And it says so, so a reader does not have to watch it to find out.
      expect(await footer(page).textContent()).toContain('frozen');
    } finally {
      await page.close();
    }
  });

  it('keeps the last payload on screen — degrade, do not hide', async () => {
    // It is still the best information available; blanking it would destroy
    // what the reader came for. What changes is the confidence around it.
    const { page, fail } = await openAgentsWithFailSwitch();
    try {
      fail();
      await staleBanner(page).waitFor({ timeout: 10_000 });
      await expect.poll(() => page.getByRole('link', { name: 'feature/reviewed' }).count()).toBe(1);
      expect(await page.getByRole('link', { name: 'PR #130' }).count()).toBe(1);
      expect(await group(page, 'Working').getByRole('heading', { level: 3 }).count()).toBe(2);
    } finally {
      await page.close();
    }
  });

  it('recovers on the next successful fetch, with no reload, and the clock resumes', async () => {
    // The assertion a set-only implementation fails: a stale flag that is never
    // cleared passes every test that only checks it gets set. With a
    // first-failure threshold this is what keeps a hiccup from stranding the
    // view in permanent distrust.
    //
    // The clock resuming is asserted separately from the banner clearing,
    // because stopping a timer is easy to do irreversibly.
    const { page, fail, recover } = await openAgentsWithFailSwitch();
    try {
      const before = page.url();
      fail();
      await staleBanner(page).waitFor({ timeout: 10_000 });
      recover();
      await expect.poll(() => staleBanner(page).count(), { timeout: 15_000 }).toBe(0);
      // Same page, never reloaded: the polling never stopped, so the page can
      // observe its own recovery.
      expect(page.url()).toBe(before);

      const read = async () => {
        const t = (await footer(page).textContent()) ?? '';
        return Number(/scanned \d+s ago · next in (\d+)s/.exec(t)?.[1]);
      };
      await expect.poll(read, { timeout: 10_000 }).not.toBeNaN();
      const first = await read();
      await expect.poll(read, { timeout: 8_000 }).not.toBe(first);
      expect(await footer(page).textContent()).not.toContain('frozen');
    } finally {
      await page.close();
    }
  });

  it('keeps the first-load message distinct from the staleness message', async () => {
    // Never-had-an-answer is a different statement from no-longer-trusted, and
    // merging them would let an empty view claim staleness it cannot have. A
    // tab whose very first fetch fails has nothing to be stale ABOUT.
    const page = await browser.newPage();
    try {
      await page.route('**/api/fleet', (route) => route.abort('connectionrefused'));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Loading…').waitFor({ timeout: 10_000 });
      // No pulse ever arrived, so there is no "last heard" moment to report.
      expect(await staleBanner(page).count()).toBe(0);
      // And no rows are invented to be stale about.
      expect(await footer(page).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('reports a failed SCAN separately from an unreachable server', async () => {
    // Two different failures, and both can be true at once — a scan that broke,
    // then a process that died. The server reporting its own scan failure
    // requires a server that answered; the other says nothing came back at all.
    // Collapsing them would tell the reader the wrong thing to go check.
    const { page, fail } = await openAgentsWithFailSwitch(
      fleet({ error: 'plot-fleet-scan.sh exited 1' }),
    );
    try {
      await page.getByText(/Last scan failed/).waitFor({ timeout: 10_000 });
      expect(await staleBanner(page).count()).toBe(0);
      fail();
      await staleBanner(page).waitFor({ timeout: 10_000 });
      // The scan error is still shown: the newer failure does not erase it.
      expect(await page.getByText(/Last scan failed/).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  // ── Clicking a plan opens the modal, with a way through to the board ──────

  it('opens PlanModal in place — no navigation away from the live view', async () => {
    const page = await openAgentsWithBoard();
    try {
      const before = page.url();
      await page.getByRole('link', { name: 'plant-tomatoes' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });
      // Still on the board app, still on the agents tab: the tab polls every
      // 4 s, and navigating away would cost the reader what they came to watch.
      expect(page.url()).toBe(before);
      expect(await dialog.locator('header h2').textContent()).toBe('Plan');
    } finally {
      await page.close();
    }
  });

  it('a click made before the cards land still opens the modal, not a navigation', async () => {
    // "The board has not loaded yet" is not "this plan has no card". Against a
    // real repo /api/board takes seconds, so this is the ordinary case rather
    // than a race: the click is held and resolved, never spent navigating away
    // from a live view. `openAgents` deliberately does NOT wait for the board.
    const page = await openAgents();
    try {
      const before = page.url();
      await page.getByRole('link', { name: 'plant-tomatoes' }).first().click();
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10_000 });
      expect(page.url()).toBe(before);
    } finally {
      await page.close();
    }
  });

  it('keeps the plain /plan/ link for a row whose plan has no board card', async () => {
    // Not hypothetical: a plan outside the walked directories has a row and no
    // card. `PlanModal` takes a Card, so an empty modal is the alternative.
    const page = await openAgentsWithBoard();
    try {
      const link = page.getByRole('link', { name: 'ghost-plan' });
      expect(await link.getAttribute('href')).toBe('/plan/2099-01-01-ghost-plan.md');
      await link.click();
      // The click navigates (to a 404 for this fixture) rather than opening a
      // dialog — the honest fallback.
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
      await expect.poll(() => page.url()).toContain('/plan/2099-01-01-ghost-plan.md');
    } finally {
      await page.close();
    }
  });

  it('"Show in board" lands on the card, scrolled into view and highlighted', async () => {
    // The filter alone was the version that left you scanning a nine-card
    // column — so the highlight is what is asserted, not merely the tab switch.
    const page = await openAgentsWithBoard();
    try {
      await page.getByRole('link', { name: 'plant-tomatoes' }).first().click();
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5_000 });
      await page.getByRole('button', { name: 'Show in board' }).click();

      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('plan'))
        .toBe('plant-tomatoes');
      // Filtered to the plan's story, so the card sits among its neighbours
      // rather than alone.
      expect(new URL(page.url()).searchParams.get('story')).toBe('raised-beds');

      const card = page.locator('#plan-plant-tomatoes');
      await card.waitFor({ state: 'visible', timeout: 5_000 });
      expect(await card.getAttribute('data-highlighted')).toBe('true');
      // Exactly one card wears the ring: it marks where you arrived, not a
      // selection.
      expect(await page.locator('article[data-highlighted="true"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('?plan=<slug> survives a reload and lands on the same highlighted card', async () => {
    // Naming it in the URL rather than passing it as state is what makes the
    // landing shareable and survivable.
    const page = await browser.newPage();
    try {
      await page.goto(`${baseURL}?plan=plant-tomatoes`);
      const card = page.locator('#plan-plant-tomatoes');
      await card.waitFor({ state: 'visible', timeout: 10_000 });
      await expect.poll(() => card.getAttribute('data-highlighted')).toBe('true');

      await page.reload();
      const again = page.locator('#plan-plant-tomatoes');
      await again.waitFor({ state: 'visible', timeout: 10_000 });
      await expect.poll(() => again.getAttribute('data-highlighted')).toBe('true');
    } finally {
      await page.close();
    }
  });

  it('ignores a ?plan= that matches nothing — the board renders normally', async () => {
    // A stale link, or a plan since delivered out of the filtered set. An empty
    // filtered column would read as "this story has no plans", which is a
    // different and false statement.
    const page = await browser.newPage();
    try {
      await page.goto(`${baseURL}?plan=no-such-plan`);
      await page.getByText('Deal with the zucchini glut').waitFor({ timeout: 10_000 });
      // Every card the board has, exactly as with no parameter at all.
      expect(await page.locator('article').count()).toBe(8);
      expect(await page.locator('article[data-highlighted="true"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
