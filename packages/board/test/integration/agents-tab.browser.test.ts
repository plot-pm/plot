import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

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
  phase: 'Development', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null, ...over,
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
    // PR-URL derivation would have left unlinked. `state: 'open'` and the
    // eligible note make it the one row a person can actually pick up, so it
    // is also the row that carries the Start work button.
    row({
      branch: 'feature/untaken', plan: 'plant-tomatoes', group: 'not-started',
      state: 'open', phase: 'Design', ageMinutes: null, note: ELIGIBLE_NOTE,
      branchUrl: `${GH}feature/untaken`, waitingDays: 22,
    }),
    // The other half of `not-started`, and the one that must NOT get a button:
    // a branch an earlier wave still blocks. plot-dispatch.sh refuses it, so a
    // button here would invite an action the tool declines.
    row({
      branch: 'feature/blocked', plan: 'plant-tomatoes', group: 'not-started',
      state: 'open', phase: 'Design', ageMinutes: null,
      note: 'blocked by an earlier wave', branchUrl: `${GH}feature/blocked`,
      waitingDays: 22,
    }),
    // A branch handed back: real commits inside the quiet window, under an
    // APPROVED plan. Both halves must show — the phase has fallen back to
    // Design (nobody is working on it) AND the badge says why (someone gave it
    // up, rather than never having begun). Either alone is the wrong answer.
    row({
      branch: 'feature/shelved', plan: 'beans', group: 'not-started',
      state: 'deferred', phase: 'Design', ageMinutes: 2,
      note: 'last commit 2 min ago', branchUrl: `${GH}feature/shelved`,
    }),
    // A not-started row whose plan records no approval date — every plan
    // predating the `Approved:` field. It must show no waiting age at all.
    row({
      branch: 'feature/undated', plan: 'beans', group: 'not-started',
      state: 'open', phase: 'Design', ageMinutes: null, note: ELIGIBLE_NOTE,
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
    // The same missing card, on a row that is otherwise perfectly startable.
    // `StartWorkButton` takes a Card, and a row is not one — so this row gets
    // NO button rather than a broken one.
    row({
      branch: 'feature/ghost-ready', plan: 'ghost-plan',
      planFile: '2099-01-01-ghost-plan.md', group: 'not-started', state: 'open',
      phase: 'Design', ageMinutes: null, note: ELIGIBLE_NOTE,
      branchUrl: `${GH}feature/ghost-ready`,
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
    server = await startServer(FIXTURE);
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
   * The same tab, in a browser whose reader has asked for reduced motion.
   *
   * A separate CONTEXT rather than a `page.emulateMedia` call on an open page:
   * the preference is a property of the environment the reader arrives with, and
   * emulating it after first paint tests a transition nobody performs.
   */
  async function openAgentsReducedMotion(payload: Fleet = fleet()): Promise<Page> {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
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

  /**
   * ONE agent row, by a branch name it contains.
   *
   * `locator('li', { hasText })` is not enough and stopped being enough the
   * moment a second plan earned a sub-heading: `groupByPlan` wraps each plan's
   * rows in an outer `<li>`, so the filter matches the wrapper AND the row, and
   * every count inside it doubles. The wrapper holds no branch link of its own,
   * so descending through one is what names a single row.
   */
  const rowFor = (page: Page, branch: string) =>
    // Matched on the branch CELL's exact text, not as a substring of the row:
    // `hasText` is a substring match and `feature/ghost` is a prefix of
    // `feature/ghost-ready`, so a plain filter would return both rows. The
    // cells carry no separating whitespace either, which rules out a
    // word-boundary regex over the row's text.
    page.locator('li.flex').filter({ has: page.getByText(branch, { exact: true }) });

  /** The section for one waiting-group, by its heading text. */
  const group = (page: Page, label: string) =>
    page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: new RegExp(label) }),
    });

  /**
   * Unfold a group, for the assertions that need to see inside one.
   *
   * `quiet` and `done` start COLLAPSED by default, so a test about what a quiet
   * row renders has to open the section first — the same click a reader makes.
   * Idempotent: it opens only what is folded, so a test can call it without
   * knowing the default.
   */
  async function expand(page: Page, key: string) {
    const toggle = page.locator(`[data-group-toggle="${key}"]`);
    await toggle.waitFor({ timeout: 10_000 });
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  }

  /** Open every group, for the tests that read the whole list. */
  async function expandAll(page: Page) {
    for (const key of ['quiet', 'done']) await expand(page, key);
  }

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
      // DONE starts collapsed, so the row has to be shown before it can be read.
      await expand(page, 'done');
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
      await expand(page, 'done');
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
      const untaken = rowFor(page, 'feature/untaken');
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
      const undated = rowFor(page, 'feature/undated');
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
        const li = rowFor(page, branch);
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

  // ── The phase takes the repo's place ──────────────────────────────────────

  it('shows the phase SPELLED OUT, and not truncated at its longest', async () => {
    // Initials cannot carry this: Discovery, Design and Development all begin
    // with D, and `DE` covers two of them. Nor can icons — PHASE_LEADERSHIP
    // maps 👤 to three of the five phases, because it encodes who LEADS rather
    // than which phase. So the assertion is the full word, and that the cell is
    // wide enough for the longest one: at `w-16` "Development" rendered
    // "Developm…", which is worse than nothing.
    const page = await openAgents();
    try {
      const li = rowFor(page, 'feature/reviewed');
      await expect.poll(() => li.textContent()).toContain('Development');
      // Not clipped: the rendered width covers the text it holds. `scrollWidth`
      // exceeding `clientWidth` is exactly what truncation looks like in the
      // DOM, and it is invisible to a text assertion — `textContent` returns
      // the full string even when the ellipsis is what the reader sees.
      const cell = li.locator('[data-phase]');
      expect(await cell.textContent()).toBe('Development');
      const fits = await cell.evaluate(
        (el) => el.scrollWidth <= (el.parentElement as HTMLElement).clientWidth,
      );
      expect(fits).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('drops the repo column — the phase took its place', async () => {
    // A seventh cell would wrap a row that already wraps on long branch names.
    // The repo is the right thing to give up: constant in a one-repo board and
    // rendered nowhere else in the app. Asserted as an ABSENCE, because adding
    // the phase beside the repo passes every other test in this file.
    const page = await openAgents();
    try {
      const li = rowFor(page, 'feature/reviewed');
      await expect.poll(() => li.textContent()).toContain('Development');
      expect(await li.textContent()).not.toContain('garden');
    } finally {
      await page.close();
    }
  });

  it('names the phase for a screen reader, which has no column position', async () => {
    // The list is a `<li>` of `<span>`s — a visual table with no table
    // semantics — so a row is heard as a run of words and nothing says which
    // word is the phase. `plot` survived that on luck, reading as a repo name
    // because it looks like one; `Development` does not announce itself.
    //
    // Asserted as accessible TEXT rather than as a title attribute: `title` is
    // never shown on touch and is read inconsistently across screen readers, so
    // it may accompany the label and not replace it.
    const page = await openAgents();
    try {
      const li = rowFor(page, 'feature/reviewed');
      await expect.poll(() => li.textContent()).toContain('Phase: Development');
      // And it costs no space on screen — the label is for the reader who
      // cannot see the column, not an extra word in the row.
      //
      // Asserted on the rendered BOX rather than on `innerText`: sr-only hides
      // by clipping an absolutely-positioned 1px box, which Chromium still
      // reports in `innerText` (it is not `display: none`). The box is what
      // decides whether a sighted reader sees it.
      const label = li.locator('span.sr-only');
      const box = await label.boundingBox();
      expect(box?.width ?? 99).toBeLessThanOrEqual(1);
      expect(box?.height ?? 99).toBeLessThanOrEqual(1);
      // The word itself is not hidden with it.
      const word = li.locator('[data-phase]');
      expect(await word.textContent()).toBe('Development');
      expect((await word.boundingBox())?.width ?? 0).toBeGreaterThan(1);
    } finally {
      await page.close();
    }
  });

  it('leaves the cell empty where no phase is honest', async () => {
    // A plan that is rejected, superseded or simply unknown has no column, and
    // the row says nothing rather than guessing one.
    const page = await openAgents(
      fleet({ rows: fleet().rows.map((r) => ({ ...r, phase: null })) }),
    );
    try {
      const li = rowFor(page, 'feature/reviewed');
      await expect.poll(() => li.textContent()).not.toContain('Phase:');
      for (const word of ['Discovery', 'Design', 'Development', 'Endgame', 'Released']) {
        expect(await li.textContent()).not.toContain(word);
      }
    } finally {
      await page.close();
    }
  });

  // ── A deferred branch reads Design AND says it was handed back ────────────

  it('shows a deferred branch its phase AND the badge — each alone is wrong', async () => {
    // Both halves, asserted together. Bare Design is indistinguishable from a
    // branch nobody ever started; the badge alone would leave a month-old
    // branch reading Development while nobody is working on it and the question
    // of whether it is wanted is back on the table.
    const page = await openAgents();
    try {
      const li = rowFor(page, 'feature/shelved');
      await expect.poll(() => li.textContent()).toContain('deferred');
      expect(await li.textContent()).toContain('Design');
      expect(await li.textContent()).not.toContain('Development');
    } finally {
      await page.close();
    }
  });

  it('keeps the row\'s own note — `deferred` does not replace it', async () => {
    // The defect this pins: classify() used to return `note: 'deferred'`
    // unconditionally, so a branch started and then shelved lost whatever else
    // it had to say. The badge carries that fact; the note keeps its own.
    const page = await openAgents();
    try {
      const li = rowFor(page, 'feature/shelved');
      await expect.poll(() => li.textContent()).toContain('last commit 2 min ago');
    } finally {
      await page.close();
    }
  });

  it('never reads WORKING for a deferred branch with a fresh commit', async () => {
    // The one place intent outranks git. WORKING claims *an agent is on this
    // right now*, which is false for work someone handed back — however recent
    // the last commit. `feature/shelved` is two minutes old and belongs in
    // NOT STARTED.
    const page = await openAgents();
    try {
      await expect.poll(() => group(page, 'Not started').getByText('feature/shelved').count())
        .toBe(1);
      expect(await group(page, 'Working').getByText('feature/shelved').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('puts no badge on a branch nobody handed back', async () => {
    const page = await openAgents();
    try {
      const li = rowFor(page, 'feature/untaken');
      await expect.poll(() => li.textContent()).toContain('Design');
      expect(await li.textContent()).not.toContain('deferred');
    } finally {
      await page.close();
    }
  });

  // ── Start work, on the rows that can actually be started ──────────────────

  const startButtons = (page: Page) => page.getByRole('button', { name: 'Start work' });

  /** The three-dot overflow menu inside one row. */
  const menu = (page: Page, branch: string) =>
    rowFor(page, branch).locator('[data-row-actions]');

  /** Open that row's menu and hand back the row, for the actions inside it. */
  async function openMenu(page: Page, branch: string) {
    await menu(page, branch).click();
    return rowFor(page, branch);
  }

  it('offers Start work THROUGH the menu, and nowhere else', async () => {
    // Both halves. An implementation that keeps the bare button beside the menu
    // passes a test that only checks the action still works — and the whole
    // point of the move is that the row's right edge holds one control of
    // constant width, not a growing row of them.
    const page = await openAgentsWithBoard();
    try {
      await expect.poll(() => menu(page, 'feature/untaken').count()).toBe(1);
      // Closed, the action is not in the document at all.
      expect(await startButtons(page).count()).toBe(0);
      const li = await openMenu(page, 'feature/untaken');
      await expect.poll(() => li.getByRole('button', { name: 'Start work' }).count()).toBe(1);
      // And it appeared HERE, not somewhere else on the page.
      expect(await startButtons(page).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('renders the menu DISABLED on a row blocked by an earlier wave', async () => {
    // The deliberate exception to this estate's rule against greyed-out
    // controls, and it turns on what a control CLAIMS: a dead `Start work`
    // would name an action that does not exist here, while a dimmed three-dot
    // menu claims only *this is where actions would be*, true on every row.
    const page = await openAgentsWithBoard();
    try {
      const li = rowFor(page, 'feature/blocked');
      await expect.poll(() => li.textContent()).toContain('blocked by an earlier wave');
      const dots = menu(page, 'feature/blocked');
      await expect.poll(() => dots.count()).toBe(1);
      expect(await dots.getAttribute('aria-disabled')).toBe('true');
      // Never the native attribute — see the focusability assertion below.
      expect(await dots.getAttribute('disabled')).toBeNull();
      // And activating it opens nothing. Dispatched rather than clicked: the
      // driver's own actionability check treats `aria-disabled` as disabled and
      // would wait forever — itself evidence the attribute is doing its job —
      // so the event is forced past that to prove the HANDLER declines too.
      await dots.dispatchEvent('click');
      expect(await li.getByRole('button', { name: 'Start work' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('keeps the disabled menu FOCUSABLE, so its explanation stays reachable', async () => {
    // `disabled` would drop the control out of the tab order and take the
    // reason with it — putting the explanation out of reach of anyone not
    // hovering with a mouse. `aria-disabled` suppresses activation and keeps it.
    const page = await openAgentsWithBoard();
    try {
      const dots = menu(page, 'feature/blocked');
      await expect.poll(() => dots.count()).toBe(1);
      await dots.focus();
      expect(await dots.evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('says WHY in the row\'s own words, not a generic "no actions"', async () => {
    // A disabled control without a reason makes people guess, and the row
    // already knows: the note beside it is the whole explanation.
    const page = await openAgentsWithBoard();
    try {
      const blocked = menu(page, 'feature/blocked');
      await expect.poll(() => blocked.count()).toBe(1);
      expect(await blocked.getAttribute('title')).toContain('blocked by an earlier wave');
      // A different row, a different reason — so the title is read from the row
      // rather than being one string for every disabled menu.
      await expand(page, 'quiet');
      const quiet = menu(page, 'feature/ghost');
      await expect.poll(() => quiet.count()).toBe(1);
      expect(await quiet.getAttribute('title')).toContain('no commit for 16 hours');
    } finally {
      await page.close();
    }
  });

  it('keeps the right edge still when a row gains or loses its action', async () => {
    // The layout argument that decides the disabled menu at all: with most rows
    // carrying no action, rendering nothing would leave the right edge ragged
    // AND moving, since the pulse re-scans every five seconds.
    const page = await openAgentsWithBoard();
    try {
      await expect.poll(() => menu(page, 'feature/untaken').count()).toBe(1);
      const enabled = await menu(page, 'feature/untaken').boundingBox();
      const disabled = await menu(page, 'feature/blocked').boundingBox();
      expect(enabled!.width).toBe(disabled!.width);
      // And both sit at the same right edge, which is the thing that must not
      // move as a row's action comes and goes.
      expect(Math.round(enabled!.x + enabled!.width))
        .toBe(Math.round(disabled!.x + disabled!.width));
    } finally {
      await page.close();
    }
  });

  it('renders a disabled menu on a row whose plan has no board card', async () => {
    // StartWorkButton takes a Card and a row is not one, so the card is looked
    // up by planFile. A plan outside the walked directories has a row and no
    // card — it gets no ACTION rather than a broken one, the same honest
    // fallback the plan link already makes.
    const page = await openAgentsWithBoard();
    try {
      const li = rowFor(page, 'feature/ghost-ready');
      await expect.poll(() => li.textContent()).toContain(ELIGIBLE_NOTE);
      expect(await menu(page, 'feature/ghost-ready').getAttribute('aria-disabled')).toBe('true');
      expect(await li.getByRole('button', { name: 'Start work' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('offers no ACTION on rows that already have a branch and a claim', async () => {
    // Working, quiet and waiting rows are somebody's already. Offering to start
    // one invites exactly the double-dispatch fleet-sees-merged-branches was
    // written to prevent. The menu is still there — dimmed, claiming nothing.
    const page = await openAgentsWithBoard();
    try {
      await expect.poll(() => menu(page, 'feature/untaken').count()).toBe(1);
      // Two of these rows sit in groups that start folded.
      await expandAll(page);
      for (const branch of ['feature/beans-a', 'feature/reviewed', 'feature/landed',
        'feature/ghost', 'feature/shelved']) {
        expect(await menu(page, branch).getAttribute('aria-disabled')).toBe('true');
        // Forced past the driver's actionability check — see the disabled-menu
        // test above — so this asserts the handler declines, not merely that
        // the attribute is present.
        await menu(page, branch).dispatchEvent('click');
        expect(await rowFor(page, branch).getByRole('button', { name: 'Start work' }).count())
          .toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  it('keeps NAVIGATION in the row — the menu holds only actions', async () => {
    // cmd-click on a real link is worth more than a tidier line, so the plan and
    // branch names stay anchors in the row where the thing is named. The menu
    // acts; the row shows.
    const page = await openAgentsWithBoard();
    try {
      const li = rowFor(page, 'feature/untaken');
      // The branch name, still an anchor in the row rather than an entry in the
      // menu — so cmd-click keeps opening it on the host.
      await expect.poll(() => li.getByRole('link', { name: 'feature/untaken' }).count()).toBe(1);
      expect(await li.getByRole('link', { name: 'feature/untaken' }).getAttribute('href'))
        .toContain('/tree/feature/untaken');
      // The plan is reachable too — from the group's sub-heading here, since
      // this group earned one and the rows stopped repeating the name.
      expect(await group(page, 'Not started').getByRole('link', { name: 'plant-tomatoes' })
        .count()).toBeGreaterThan(0);
      // Opening the menu adds no links anywhere: what it holds is an action.
      const before = await li.getByRole('link').count();
      await openMenu(page, 'feature/untaken');
      expect(await li.getByRole('link').count()).toBe(before);
    } finally {
      await page.close();
    }
  });

  it('offers no action at all before the board has said whether it can dispatch', async () => {
    // `openAgents` does not wait for /api/board, so no cards and no dispatch
    // capability have landed. A control whose outcome is unknown is worse than
    // no control — the same rule PlanCard follows. The menu renders dimmed,
    // which claims nothing about dispatch either way.
    const page = await browser.newPage();
    try {
      await page.route('**/api/board', (route) => route.abort('connectionrefused'));
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await rowFor(page, 'feature/untaken').waitFor({ timeout: 10_000 });
      expect(await menu(page, 'feature/untaken').getAttribute('aria-disabled')).toBe('true');
      expect(await startButtons(page).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── Working rows show motion ──────────────────────────────────────────────
  //
  // The board's FIRST animation. Every assertion here is about what the motion
  // CLAIMS: that the row is in WORKING, re-derived every scan. It stops when the
  // row leaves the group, which is deliberately unlike the countdown that kept
  // ticking after its server died — that asserted a specific future event that
  // was not coming.

  /** The live indicator inside one row, by the branch that row names. */
  const liveDot = (page: Page, branch: string) =>
    rowFor(page, branch).locator('[data-live-dot]');

  /** Whether an element is actually running an animation, per the browser. */
  const animating = (page: Page, branch: string) =>
    liveDot(page, branch).evaluate((el) => {
      const name = getComputedStyle(el).animationName;
      return name !== 'none' && name !== '';
    });

  it('animates a WORKING row, and rows in every other group hold still', async () => {
    const page = await openAgents();
    try {
      await expect.poll(() => liveDot(page, 'feature/beans-a').count()).toBe(1);
      expect(await animating(page, 'feature/beans-a')).toBe(true);
      // The negative, across every other group — a blanket indicator passes a
      // test that only looks at a working row.
      for (const branch of ['feature/reviewed', 'feature/untaken', 'feature/blocked',
        'feature/shelved', 'feature/landed', 'feature/ghost']) {
        expect(await liveDot(page, branch).count()).toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  it('leaves a QUIET row still even when it carries a fresh claim', async () => {
    // The near-miss: a quiet row can hold a claim and a recent-looking note and
    // still be quiet. The GROUP is what decides, because the group is what the
    // pulse re-derives every five seconds.
    const rows = [
      ...fleet().rows,
      row({
        branch: 'feature/claimed-but-quiet', plan: 'beans', group: 'quiet',
        ageMinutes: 1_400, note: 'claimed, no commits yet',
        branchUrl: `${GH}feature/claimed-but-quiet`,
      }),
    ];
    const page = await openAgents(fleet({ rows }));
    try {
      // The row must be VISIBLE for "it holds still" to mean anything — a
      // folded group hides it, which would pass this assertion for the wrong
      // reason entirely.
      await expand(page, 'quiet');
      await expect.poll(() => rowFor(page, 'feature/claimed-but-quiet').count()).toBe(1);
      expect(await liveDot(page, 'feature/claimed-but-quiet').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('gives all three WORKING notes the SAME indicator', async () => {
    // The assertion a confidence-graded implementation fails. WORKING has three
    // entrances of differing strength, and grading the animation by which one
    // applied would pass a test that checks only the dirty worktree. Membership
    // is the statement, and the note already says which reason.
    const notes = [
      'uncommitted work in a local worktree',
      'last commit 3 min ago',
      'claimed, no commits yet',
    ];
    const rows = notes.map((note, i) =>
      row({
        branch: `feature/live-${i}`, plan: 'beans', group: 'working',
        ageMinutes: i === 2 ? null : 3, note, branchUrl: `${GH}feature/live-${i}`,
      }));
    const page = await openAgents(fleet({ rows }));
    try {
      await expect.poll(() => liveDot(page, 'feature/live-0').count()).toBe(1);
      // Identical, not merely present: same rendered box and same animation, so
      // a graded speed or a graded size would fail here rather than pass.
      const seen: string[] = [];
      for (const i of [0, 1, 2]) {
        const dot = liveDot(page, `feature/live-${i}`);
        expect(await dot.count()).toBe(1);
        seen.push(await dot.evaluate((el) => {
          const s = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return [s.animationName, s.animationDuration, s.animationIterationCount,
            s.backgroundColor, box.width, box.height].join('|');
        }));
      }
      expect(seen[0]).not.toContain('none');
      expect(new Set(seen).size).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('drops the indicator when the row LEAVES the group', async () => {
    // Asserted across a state change rather than on a static fixture: the whole
    // honesty of this animation is that it stops on its own, and a fixture-only
    // test passes on an implementation that never re-evaluates.
    let moved = false;
    const working = fleet();
    const done = fleet({
      rows: fleet().rows.map((r) =>
        r.branch === 'feature/beans-a'
          ? { ...r, group: 'done' as const, state: 'merged' as const, note: 'merged' }
          : r),
    });
    const page = await browser.newPage();
    try {
      await page.route('**/api/fleet', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(moved ? done : working),
        }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await expect.poll(() => liveDot(page, 'feature/beans-a').count()).toBe(1);
      // DONE is where the row is going, and it starts folded — opened FIRST, so
      // the assertion below is about the indicator stopping rather than about
      // the row being hidden.
      await expand(page, 'done');
      moved = true;
      // The row survives — it is the same branch — and only the motion goes.
      await expect.poll(() => liveDot(page, 'feature/beans-a').count(), { timeout: 15_000 })
        .toBe(0);
      expect(await rowFor(page, 'feature/beans-a').count()).toBe(1);
      await expect.poll(() => group(page, 'Done').getByText('feature/beans-a').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('stops the animation under prefers-reduced-motion, and keeps the dot', async () => {
    // BOTH halves. Removing the element entirely would satisfy "no motion" and
    // lose the marker along with it — and motion triggers nausea for some
    // readers, so this is not politeness, it is whether they can leave the view
    // open beside their work at all.
    const page = await openAgentsReducedMotion();
    try {
      await expect.poll(() => liveDot(page, 'feature/beans-a').count()).toBe(1);
      expect(await animating(page, 'feature/beans-a')).toBe(false);
      // Still drawn: a visible box, not a collapsed one.
      const box = await liveDot(page, 'feature/beans-a').boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.height ?? 0).toBeGreaterThan(0);
      // And still at full opacity rather than frozen mid-pulse at 0.5, which
      // would read as a disabled row.
      const opacity = await liveDot(page, 'feature/beans-a')
        .evaluate((el) => Number(getComputedStyle(el).opacity));
      expect(opacity).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('leaves the row fully legible with the animation off', async () => {
    // The animation is decoration on top of information, never the carrier of
    // it — the rule the contract already sets for colour. Group, note and age
    // must all read the same with motion suppressed.
    const still = await openAgentsReducedMotion();
    try {
      const li = rowFor(still, 'feature/beans-a');
      await expect.poll(() => li.textContent()).toContain('last commit 3 min ago');
      expect(await li.textContent()).toContain('beans');
      // 200 minutes → 3h, the same age the moving row shows.
      expect(await li.locator('span').last().textContent()).toBe('3h');
      expect(await group(still, 'Working').getByText('feature/beans-a').count()).toBe(1);
    } finally {
      await still.close();
    }
  });

  it('hides the dot from a screen reader — it carries nothing the text does not', async () => {
    // The group heading and the row's own words already say everything. A dot
    // announced beside them is noise, and this is the same rule the sr-only
    // phase label follows from the other direction.
    const page = await openAgents();
    try {
      const dot = liveDot(page, 'feature/beans-a');
      await expect.poll(() => dot.count()).toBe(1);
      expect(await dot.getAttribute('aria-hidden')).toBe('true');
      // The row's text is unchanged by its presence: nothing was added to the
      // accessible name.
      expect(await rowFor(page, 'feature/beans-a').textContent())
        .toContain('last commit 3 min ago');
    } finally {
      await page.close();
    }
  });

  it('animates nothing in an EMPTY working group', async () => {
    // Trivial by construction — the dot sits on a row — but asserted so nobody
    // later moves the animation to the group header, where it would run against
    // zero rows and claim work that does not exist.
    const page = await openAgents(
      fleet({ rows: fleet().rows.filter((r) => r.group !== 'working') }),
    );
    try {
      const working = group(page, 'Working');
      await expect.poll(() => working.getByText('none').count()).toBe(1);
      expect(await working.locator('[data-live-dot]').count()).toBe(0);
      // Nowhere else on the page either.
      expect(await page.locator('[data-live-dot]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── Dormant groups start collapsed, and remember ──────────────────────────
  //
  // The other half of the same question the motion above answers: how does this
  // view behave when you leave it open beside your work? One answer is that live
  // rows should look live; this one is that dormant rows must not cost the space
  // the live ones need.

  /** The rows a group is currently showing. */
  const groupRows = (page: Page, label: string) => group(page, label).locator('li.flex');

  /** The header of one group, whose count must survive folding. */
  const heading = (page: Page, label: string) =>
    group(page, label).getByRole('heading', { level: 2 });

  it('starts QUIET and DONE collapsed, and every other group open', async () => {
    // BOTH halves. A blanket default — everything folded, or nothing — passes an
    // assertion that checks only one group, and the default is the existing
    // actionable-before-diagnostic order made effective rather than a
    // preference.
    const page = await openAgents();
    try {
      await expect.poll(() => groupRows(page, 'Working').count()).toBeGreaterThan(0);
      expect(await groupRows(page, 'Quiet').count()).toBe(0);
      expect(await groupRows(page, 'Done').count()).toBe(0);
      // And the actionable end is untouched.
      expect(await groupRows(page, 'Waiting on you').count()).toBeGreaterThan(0);
      expect(await groupRows(page, 'Not started').count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('keeps the COUNT on a collapsed header', async () => {
    // A folded header with no number reads as *nothing here*, which is worse
    // than the crowding this fixes. The count is already rendered — it simply
    // must not be hidden with the body.
    const page = await openAgents();
    try {
      await expect.poll(() => heading(page, 'Quiet').textContent()).toContain('(1)');
      expect(await groupRows(page, 'Quiet').count()).toBe(0);
      expect(await heading(page, 'Done').textContent()).toContain('(1)');
    } finally {
      await page.close();
    }
  });

  it('gives an EMPTY group no collapse control, and keeps its hint', async () => {
    // Both halves — a blanket toggle passes the first and quietly hides the
    // hint. An empty group hides nothing, and the hint is the explanation for
    // the emptiness: exactly what a reader wants when there is nothing to list.
    const page = await openAgents();
    try {
      const machine = group(page, 'Waiting on a machine');
      await expect.poll(() => machine.count()).toBe(1);
      expect(await machine.locator('[data-group-toggle]').count()).toBe(0);
      expect(await machine.getByRole('heading', { level: 2 }).textContent())
        .toContain('nothing — CI will finish');
      // And no "(0)" anywhere in that header.
      expect(await machine.getByRole('heading', { level: 2 }).textContent()).not.toContain('(0)');
    } finally {
      await page.close();
    }
  });

  it('survives a reload, and applies the default when nothing is stored', async () => {
    // Both halves. Persistence is not optional — this board is left running and
    // reloaded several times an hour, and without it the reader re-configures
    // the view every time, which teaches them not to bother. And a FIRST visit
    // must not depend on state that does not exist yet.
    //
    // One context for both loads, deliberately: `browser.newPage()` gives each
    // page its own storage, which is the isolation every other test here wants
    // and precisely what this test must not have.
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      // The default, on a context that has stored nothing.
      await expect.poll(() => groupRows(page, 'Quiet').count()).toBe(0);
      await expand(page, 'quiet');
      await expect.poll(() => groupRows(page, 'Quiet').count()).toBe(1);

      await page.reload();
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      // The reader's choice came back — not the default.
      await expect.poll(() => groupRows(page, 'Quiet').count()).toBe(1);
      // And the group they never touched is still folded, so the reload
      // restored a SET rather than opening everything.
      expect(await groupRows(page, 'Done').count()).toBe(0);
    } finally {
      await context.close();
    }
  });

  it('never puts the collapse state in the URL', async () => {
    // A shared link must not rebuild the recipient's view. Everything in the
    // query string today is worth sending to someone — *look at this plan* —
    // and `?collapsed=quiet,done` would hand over my personal tidying as a side
    // effect of "have a look at this".
    const page = await openAgents();
    try {
      const before = page.url();
      await expand(page, 'quiet');
      await expect.poll(() => groupRows(page, 'Quiet').count()).toBe(1);
      expect(page.url()).toBe(before);
      // Folding it again is equally silent.
      await page.locator('[data-group-toggle="quiet"]').click();
      await expect.poll(() => groupRows(page, 'Quiet').count()).toBe(0);
      expect(page.url()).toBe(before);
      expect(page.url()).not.toContain('collapsed');
    } finally {
      await page.close();
    }
  });

  it('updates the count of a collapsed group WITHOUT expanding it', async () => {
    // Auto-expanding passes a naive "the new row is visible" test and breaks the
    // reading position. The pulse re-scans every five seconds and `quiet` is by
    // construction the group whose changes are least urgent: whoever folded it
    // was asking not to be interrupted by it.
    let extra = false;
    const one = fleet();
    const two = fleet({
      rows: [
        ...fleet().rows,
        row({
          branch: 'feature/gone-quiet', plan: 'beans', group: 'quiet',
          ageMinutes: 2_000, note: 'no commit for 33 hours',
          branchUrl: `${GH}feature/gone-quiet`,
        }),
      ],
    });
    const page = await browser.newPage();
    try {
      await page.route('**/api/fleet', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(extra ? two : one),
        }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await expect.poll(() => heading(page, 'Quiet').textContent()).toContain('(1)');
      extra = true;
      // The count moves…
      await expect.poll(() => heading(page, 'Quiet').textContent(), { timeout: 15_000 })
        .toContain('(2)');
      // …and nothing else does.
      expect(await groupRows(page, 'Quiet').count()).toBe(0);
      expect(await page.locator('[data-group-toggle="quiet"]').getAttribute('aria-expanded'))
        .toBe('false');
    } finally {
      await page.close();
    }
  });

  it('never folds a group by itself while the reader has it open', async () => {
    // The pulse re-scans every five seconds, and a view that folds itself while
    // being read moves the line under the cursor — the same objection this plan
    // raises against a right edge that shifts.
    let quietened = false;
    const before = fleet();
    const after = fleet({
      rows: fleet().rows.map((r) =>
        r.group === 'working'
          ? { ...r, group: 'quiet' as const, note: 'no commit for 3 hours', ageMinutes: 200 }
          : r),
    });
    const page = await browser.newPage();
    try {
      await page.route('**/api/fleet', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(quietened ? after : before),
        }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      // The reader opens QUIET deliberately.
      await expand(page, 'quiet');
      await expect.poll(() => groupRows(page, 'Quiet').count()).toBe(1);
      quietened = true;
      // Every working row lands in it — and it stays open, showing them.
      await expect.poll(() => groupRows(page, 'Quiet').count(), { timeout: 15_000 }).toBe(4);
      expect(await page.locator('[data-group-toggle="quiet"]').getAttribute('aria-expanded'))
        .toBe('true');
      // And WORKING, now empty, has lost its control rather than folding.
      expect(await group(page, 'Working').locator('[data-group-toggle]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('leaves the footer reachable without scrolling past a collapsed group', async () => {
    // The measurable form of the original complaint: QUIET (7) and DONE (13)
    // rendered twenty rows between them, and the line reporting when the last
    // scan ran had scrolled out of view.
    const many = fleet({
      rows: [
        ...fleet().rows,
        ...Array.from({ length: 7 }, (_, i) =>
          row({
            branch: `feature/dormant-${i}`, plan: 'beans', group: 'quiet',
            ageMinutes: 30_000 + i, note: 'no commit for 22 days',
            branchUrl: `${GH}feature/dormant-${i}`,
          })),
        ...Array.from({ length: 13 }, (_, i) =>
          row({
            branch: `feature/finished-${i}`, plan: 'beans', group: 'done',
            state: 'merged', ageMinutes: 40_000 + i, note: 'merged', branchUrl: '',
          })),
      ],
    });
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(many) }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      // The counts say the twenty rows are there and hidden.
      await expect.poll(() => heading(page, 'Quiet').textContent()).toContain('(8)');
      expect(await heading(page, 'Done').textContent()).toContain('(14)');
      // And the footer is inside the viewport — the assertion the complaint was
      // actually about, stated in pixels rather than in row counts.
      const box = await footer(page).boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(800);
      // Unfolding both puts it back out of reach, which is what makes the
      // assertion above about the COLLAPSE rather than about a short fixture.
      await expandAll(page);
      await expect.poll(() => groupRows(page, 'Done').count()).toBe(14);
      const opened = await footer(page).boundingBox();
      expect(opened!.y).toBeGreaterThan(800);
    } finally {
      await page.close();
    }
  });

  it('keeps QUIET leading with its OLDEST — the inversion is confined', async () => {
    // A global change would silently reverse the group that most needs
    // oldest-first: `quiet` asks *has this died?*, and the longest-silent branch
    // is the one to check.
    const page = await openAgents(fleet({
      rows: [
        ...fleet().rows,
        row({
          branch: 'feature/recently-quiet', plan: 'beans', group: 'quiet',
          ageMinutes: 40, note: 'no commit for 40 minutes',
          branchUrl: `${GH}feature/recently-quiet`,
        }),
      ],
    }));
    try {
      await expand(page, 'quiet');
      await expect.poll(() => groupRows(page, 'Quiet').count()).toBe(2);
      const branches = await group(page, 'Quiet')
        .locator('li a[href*="/tree/"], li span.font-mono').allTextContents();
      // 999 minutes before 40: oldest first, unchanged.
      expect(branches).toEqual(['feature/ghost', 'feature/recently-quiet']);
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
      // `.first()`: the plan has two rows in different groups, each naming it.
      const link = page.getByRole('link', { name: 'ghost-plan' }).first();
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
