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
    // text points. The PR carries its condition as FIELDS — the row's cell is
    // built from these, never from the sentence in `note`.
    row({
      branch: 'feature/reviewed', plan: 'beans', group: 'waiting-on-you',
      ageMinutes: 20, note: 'PR #130 green',
      pr: {
        number: 130, url: 'https://github.com/tiny/garden/pull/130',
        draft: false, state: 'green',
      },
      branchUrl: `${GH}feature/reviewed`,
    }),
    // A not-started row: no PR at all, and exactly the class the rejected
    // PR-URL derivation would have left unlinked. `state: 'open'` and the
    // eligible note make it the one row a person can actually pick up, so it
    // is also the row that carries the Start work button.
    row({
      branch: 'feature/untaken', plan: 'plant-tomatoes', group: 'not-started',
      state: 'open', phase: 'Design', ageMinutes: null, waitingOn: 'click' as const, note: ELIGIBLE_NOTE,
      branchUrl: `${GH}feature/untaken`, waitingDays: 22,
    }),
    // The other half of `not-started`, and the one that must NOT get a button:
    // a branch an earlier wave still blocks. plot-dispatch.sh refuses it, so a
    // button here would invite an action the tool declines.
    row({
      branch: 'feature/blocked', plan: 'plant-tomatoes', group: 'not-started',
      state: 'open', phase: 'Design', ageMinutes: null,
      waitingOn: 'time' as const, note: 'blocked by Truth', branchUrl: `${GH}feature/blocked`,
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
      state: 'open', phase: 'Design', ageMinutes: null, waitingOn: 'click' as const, note: ELIGIBLE_NOTE,
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
      phase: 'Design', ageMinutes: null, waitingOn: 'click' as const, note: ELIGIBLE_NOTE,
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

  /**
   * Open the Agents tab with `/api/fleet` answering with `payload`.
   *
   * NOT STARTED's inner folds are opened on the way in — see `expandPlans`. That
   * section now counts plans and folds its branches, and the assertions in this
   * file are about what a not-started ROW renders; opening the fold is the click
   * a reader makes to ask the same question. The plan row is a separate claim
   * with its own suite.
   */
  async function openAgents(payload: Fleet = fleet()): Promise<Page> {
    const page = await browser.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    await expandPlans(page);
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
    await expandPlans(page);
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
    // Re-opened, because leaving the tab and returning remounts the list and the
    // inner fold is per-mount state — deliberately not persisted, unlike the
    // section-level collapse.
    await expandPlans(page);
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
    await expandPlans(page);
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
    // Matched on the branch cell's `data-branch`, which carries the WHOLE name
    // whatever the column's width does to the rendering. Two reasons it is not
    // a text match: `hasText` is a substring match and `feature/ghost` is a
    // prefix of `feature/ghost-ready`, so a plain filter returns both rows; and
    // the name is now folded in the middle across two spans, so no single
    // element holds it as exact text.
    page.locator('li[data-agent-row]').filter({ has: page.locator(`[data-branch="${branch}"]`) });

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

  /**
   * Open NOT STARTED's inner folds, so its branch rows are on the page.
   *
   * That section counts PLANS: one row per plan, with its branches folded
   * beneath it and expandable — because its rows are not branches. Measured on
   * the live board, every one of them carried `pr=—` and `age=—`, the name
   * having come from the plan's `## Branches` section with no branch ever
   * created for it.
   *
   * The branch rows are still there and still carry everything they did; they
   * are one click away rather than on arrival. So the tests below that assert
   * what a not-started ROW renders open the fold first — the same click a reader
   * now makes — rather than being rewritten to assert the plan row, which is a
   * different claim and has its own suite in
   * `test/integration/not-started-plans.browser.test.ts`.
   *
   * Idempotent, and silent where a plan has no fold: a plan with one branch
   * beneath it gets no expander, and its branch renders unconditionally.
   */
  async function expandPlans(page: Page) {
    const toggles = page.locator('[data-wave-toggle]');
    for (let i = 0; i < (await toggles.count()); i += 1) {
      const toggle = toggles.nth(i);
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    }
  }

  /** Open every group, for the tests that read the whole list. */
  async function expandAll(page: Page) {
    for (const key of ['quiet', 'done']) await expand(page, key);
    await expandPlans(page);
  }

  const staleBanner = (page: Page) => page.getByText(/Not reaching the board server/);

  const footer = (page: Page) => page.getByText(/branches across .* plans/);

  // ── Every link goes where its text says ───────────────────────────────────

  it('links the branch name to the BRANCH and the PR cell to the pull request', async () => {
    // The defect this replaces: one link, on the wrong word — the branch name
    // opened the PR while `PR #130` beside it was plain text. Asserting merely
    // that "a link exists" passes on that bug, so the assertion is that the two
    // targets DIFFER and each matches its own text.
    //
    // The PR link is now named by the glyph's label and the number rather than
    // by the words `PR #130`: the cell is composed from the row's fields, and
    // the word `PR` became the git host's own mark. `Pull request 130` is what
    // a screen reader hears, which is the assertion worth making.
    const page = await openAgents();
    try {
      const branchHref = await page.getByRole('link', { name: 'feature/reviewed' })
        .getAttribute('href');
      const prHref = await page.getByRole('link', { name: 'Pull request 130' })
        .getAttribute('href');
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
      expect(await page.getByRole('link', { name: 'Pull request 130' }).count()).toBe(1);
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
    // Both plans hold TWO rows on purpose. A single-row plan earns no heading
    // (see the mixed-section test below), so the default fixture would leave
    // one heading here — and one heading is in the right order whatever the
    // sort does. The ordering assertion needs two to mean anything.
    const page = await openAgents(fleet({
      rows: [
        ...fleet().rows.filter((r) => r.group !== 'working'),
        row({ branch: 'feature/beans-old', plan: 'beans', planFile: 'p-beans.md',
              group: 'working', ageMinutes: 200, note: 'last commit 200 min ago' }),
        row({ branch: 'feature/beans-new', plan: 'beans', planFile: 'p-beans.md',
              group: 'working', ageMinutes: 10, note: 'last commit 10 min ago' }),
        row({ branch: 'feature/tom-a', plan: 'plant-tomatoes', planFile: 'p-tom.md',
              group: 'working', ageMinutes: 50, note: 'last commit 50 min ago' }),
        row({ branch: 'feature/tom-b', plan: 'plant-tomatoes', planFile: 'p-tom.md',
              group: 'working', ageMinutes: 20, note: 'last commit 20 min ago' }),
      ],
    }));
    try {
      const headings = group(page, 'Working').getByRole('heading', { level: 3 });
      // `beans` holds the 200-minute row, `plant-tomatoes` the 50-minute one —
      // so beans first. Ordering by anything else would let a plan with one
      // stale branch outrank one whose branch just moved.
      await expect.poll(() => headings.allTextContents())
        .toEqual(['beans(2)', 'plant-tomatoes(2)']);
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

  it('in a MIXED section, the lonely row still names its own plan', async () => {
    // The case a section-wide answer cannot express, asserted where it actually
    // breaks: in the DOM, across both halves of the rule at once.
    //
    // `showPlanHeading` is pinned per group in test/unit, but it is a pure
    // function of a group — it cannot observe the row side, and the row side is
    // where a naive implementation fails. Drop a heading from a one-row group
    // without moving the name back onto its row and that plan disappears from
    // the tab entirely: the unit test still passes, and the reader is looking
    // at a branch with nothing saying what it belongs to.
    //
    // So both halves are asserted together, in one section holding both shapes:
    // `beans` with three rows earns a heading and its rows stay bare; `lonely`
    // with one row earns none and its row must carry the name itself.
    const rows = [
      row({ branch: 'feature/beans-1', plan: 'beans', group: 'quiet', ageMinutes: 500 }),
      row({ branch: 'feature/beans-2', plan: 'beans', group: 'quiet', ageMinutes: 400 }),
      row({ branch: 'feature/beans-3', plan: 'beans', group: 'quiet', ageMinutes: 300 }),
      row({ branch: 'feature/solo', plan: 'lonely', group: 'quiet', ageMinutes: 200 }),
    ];
    const page = await openAgents(fleet({ rows }));
    try {
      await expand(page, 'quiet');
      const quiet = group(page, 'Quiet');

      // Exactly one heading in the section, and it is the multi-row plan's.
      await expect.poll(() => quiet.getByRole('heading', { level: 3 }).allTextContents())
        .toEqual(['beans(3)']);

      // The one-row plan's name survives ON ITS ROW — the half that vanishes in
      // a naive implementation, and the reason this test exists.
      const solo = rowFor(page, 'feature/solo');
      await expect.poll(() => solo.textContent()).toContain('lonely');

      // And the headed plan's rows do NOT repeat the name, or the heading would
      // be saving nothing and the layout would say it twice.
      //
      // Asserted on the plan CELL rather than the row's text: the branch is
      // named `feature/beans-1`, so a substring search for the plan name finds
      // the branch and fails for the wrong reason. The cell is a link when a
      // row carries its plan and absent when the heading carries it, which is
      // exactly the distinction under test.
      expect(await rowFor(page, 'feature/beans-1')
        .getByRole('link', { name: 'beans', exact: true }).count()).toBe(0);
      expect(await solo.getByRole('link', { name: 'lonely', exact: true }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('groups DONE like every other group', async () => {
    // The group that grows fastest over a working day is the first to become a
    // list one scrolls past — a rule with an exception for it is a rule someone
    // has to remember.
    // TWO rows per plan, because a heading is earned by saving repetition and a
    // one-row plan saves none. One row each would leave DONE headingless for
    // the right reason and prove nothing about DONE being grouped at all.
    const rows = [
      ...fleet().rows,
      row({
        branch: 'feature/also-landed', plan: 'beans', group: 'done', state: 'merged',
        ageMinutes: 120, note: 'merged', branchUrl: '',
      }),
      row({
        branch: 'feature/landed-too', plan: 'beans', group: 'done', state: 'merged',
        ageMinutes: 130, note: 'merged', branchUrl: '',
      }),
      row({
        branch: 'feature/tom-landed', plan: 'plant-tomatoes', group: 'done', state: 'merged',
        ageMinutes: 140, note: 'merged', branchUrl: '',
      }),
      row({
        branch: 'feature/tom-landed-too', plan: 'plant-tomatoes', group: 'done', state: 'merged',
        ageMinutes: 150, note: 'merged', branchUrl: '',
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
      // Read off the GRIDCELLS, which is what the tracks now are: the order of
      // the cells IS the order of the columns, and a swapped pair of tracks
      // would fail here rather than merely reordering two spans.
      const cells = await group(page, 'Waiting on you')
        .locator('li[data-agent-row]').first()
        .locator('[role="gridcell"]').allTextContents();
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
      // ON THE PLAN ROW, not on the branch. `waitingDays` dates the plan's own
      // `Approved:` record, so every branch of one plan carries the same
      // number — stating it per branch said one measurement three times. This
      // asserted the branch row until the section learned to group; what it
      // MEANS (one column, one answer, carried by colour and title) is
      // unchanged and asserted here.
      const untakenPlan = page.locator('li[data-plan-row]')
        .filter({ hasText: 'plant-tomatoes' }).first();
      await expect.poll(() => untakenPlan.getByTitle(/nobody has started it/).count()).toBe(1);
      await expect.poll(() => untakenPlan.getByTitle(/nobody has started it/).textContent())
        .toBe('22d');
      const untaken = rowFor(page, 'feature/untaken');
      // ONCE, and on the plan row. This asserted the clock on the BRANCH's last
      // cell to prove the row did not carry it twice; the branch now does not
      // carry it at all, which satisfies that intent more strongly than the
      // assertion could say. Stated directly instead: the number appears on the
      // plan row and nowhere in the branch row beneath it.
      await expect.poll(() => untaken.count()).toBe(1);
      expect(await untaken.textContent()).not.toContain('22d');
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
        .locator('li [data-branch]').evaluateAll((els) => els.map((e) => e.getAttribute('data-branch')));
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

  it('names the phase by its COLUMN, and drops the sr-only prefix that stood in', async () => {
    // Both halves, and the second is the one an easy implementation gets wrong.
    //
    // The list used to be a `<li>` of `<span>`s — a visual table with no table
    // semantics — so a row was heard as a run of words and nothing said which
    // word was the phase. `Development` does not announce itself. An `sr-only`
    // prefix compensated for that missing structure; with a header row carrying
    // `role="columnheader"`, the structure exists and the prefix would be a
    // second copy of the same word.
    //
    // A fix that adds the header AND keeps the prefix passes every assertion
    // about the header, and announces the column twice on every row of the
    // fleet. So the absence is asserted, not merely the presence.
    const page = await openAgents();
    try {
      const li = rowFor(page, 'feature/reviewed');
      await expect.poll(() => li.textContent()).toContain('Development');
      // The header names the column, once for the whole grid.
      const headers = group(page, 'Waiting on you').getByRole('columnheader');
      await expect.poll(() => headers.allTextContents())
        .toEqual(['Phase', 'Plan', 'Branch', 'Pull request', 'Age', 'Actions']);
      // And the row does not say it again — asserted on the ACCESSIBLE NAME
      // rather than on `textContent`, which reports text a `display: none`
      // element still holds in the DOM. What a screen reader hears is the
      // question, and it hears the header once and the cell's word once.
      //
      // The prefix survives BELOW `sm`, and only there: a card has no columns
      // for a header to name, so the word `Development` would arrive with
      // nothing saying what it is. That half is asserted in the card tests.
      // NOT `.first()` — that is the marks cell now. The phase is the second,
      // read by the named constant so this stays in step with the geometry
      // constants above.
      const phaseCell = li.locator('[role="gridcell"]').nth(PHASE_CELL);
      const name = await phaseCell.evaluate((el) => (el as HTMLElement).innerText);
      expect(name.trim()).toBe('Development');
      // The word itself is untouched, and visible.
      const word = li.locator('[data-phase]');
      expect(await word.textContent()).toBe('Development');
      expect((await word.boundingBox())?.width ?? 0).toBeGreaterThan(1);
    } finally {
      await page.close();
    }
  });

  it('costs no space on screen for the column names', async () => {
    // The header is for the reader who cannot see the alignment — printing six
    // words above every one of six groups would be chrome that never varies,
    // and the alignment is what a sighted reader reads instead.
    //
    // Asserted on the rendered BOX rather than on `innerText`: `sr-only` hides
    // by clipping an absolutely-positioned 1px box, which Chromium still
    // reports in `innerText` (it is not `display: none`).
    const page = await openAgents();
    try {
      const header = group(page, 'Waiting on you').getByRole('row').first();
      await expect.poll(() => header.count()).toBe(1);
      const box = await header.boundingBox();
      expect(box?.width ?? 99).toBeLessThanOrEqual(1);
      expect(box?.height ?? 99).toBeLessThanOrEqual(1);
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
      // The PHASE is on the plan row now: it is a property of the plan that a
      // branch inherits, so stating it per branch said one word down a column.
      // The badge's absence is still asserted on the BRANCH, which is where a
      // badge would appear — the two halves live one level apart, and this
      // asserted both on the branch until the section grew a plan row.
      const li = rowFor(page, 'feature/untaken');
      await expect.poll(() => li.count()).toBe(1);
      const plan = page.locator('li[data-plan-row]')
        .filter({ hasText: 'plant-tomatoes' }).first();
      expect(await plan.textContent()).toContain('Design');
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

  it('renders NO menu on a row blocked by an earlier wave', async () => {
    // **This asserted a DIMMED menu until 2026-08-18**, on the reasoning that a
    // dead `Start work` names an action that does not exist here while a dimmed
    // three-dot menu claims only *this is where actions would be*, true on
    // every row.
    //
    // `one-place-for-what-a-row-can-do` withdrew that exception. The claim is
    // not the whole cost: a `⋯` that opens nothing is a control that lies, and
    // it was measured lying on two of six WAITING ON YOU rows. The row already
    // says what it is, and an absent control claims nothing at all.
    //
    // The reason it was allowed — a ragged, moving right edge — was answered by
    // the fixed track this cell has since gained; see the right-edge test below,
    // which now measures exactly that.
    const page = await openAgentsWithBoard();
    try {
      const li = rowFor(page, 'feature/blocked');
      // NAMES THE WAVE — *blocked by which one?* is the reader's next
      // question, and the fixture's row says `blocked by Truth`. This is the
      // half that matters more now: with no control to carry a title, the ROW
      // is where the explanation lives.
      await expect.poll(() => li.textContent()).toContain('blocked by Truth');
      expect(await menu(page, 'feature/blocked').count()).toBe(0);
      expect(await li.getByRole('button', { name: 'Start work' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('keeps a REFUSED menu focusable, so its explanation stays reachable', async () => {
    // A REFUSAL IS NOT AN ABSENCE, and this is the case that survived the
    // withdrawal above. A row whose act the server declines still HAS something
    // to do — you cannot do it from this binding — so it keeps its button and
    // names the reason on it.
    //
    // `disabled` would drop that control out of the tab order and take the
    // reason with it, putting the explanation out of reach of anyone not
    // hovering with a mouse. `aria-disabled` suppresses activation and keeps it.
    // Asserted on the shipped artifact in `stuck-rows.browser.test.ts`, which
    // has a non-localhost binding to refuse with; here the fixture's server
    // acts, so this file asserts the shape the enabled control keeps.
    const page = await openAgentsWithBoard();
    try {
      const dots = menu(page, 'feature/untaken');
      await expect.poll(() => dots.count()).toBe(1);
      await dots.focus();
      expect(await dots.evaluate((el) => el === document.activeElement)).toBe(true);
      // Never the native attribute, on either side of the enabled/refused line.
      expect(await dots.getAttribute('disabled')).toBeNull();
    } finally {
      await page.close();
    }
  });

  it("says WHY in the row's own words, not a generic \"no actions\"", async () => {
    // The reason did not disappear with the dimmed menu — it moved to where it
    // was always more useful. A row with nothing to do now carries its
    // explanation in the NOTE beside it rather than in the `title` of a control
    // that is no longer there, and the note is visible without hovering.
    const page = await openAgentsWithBoard();
    try {
      const blocked = rowFor(page, 'feature/blocked');
      await expect.poll(() => blocked.textContent()).toContain('blocked by Truth');
      expect(await menu(page, 'feature/blocked').count()).toBe(0);
      // A different row, a different reason — so the words are read from the
      // row rather than being one string for every row with nothing to do.
      await expand(page, 'quiet');
      const quiet = rowFor(page, 'feature/ghost');
      await expect.poll(() => quiet.textContent()).toContain('no commit for 16 hours');
      expect(await menu(page, 'feature/ghost').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('keeps the right edge still when a row gains or loses its action', async () => {
    // THE ARGUMENT THAT USED TO REQUIRE A DIMMED MENU, now measured directly
    // against the thing that replaced it. Rendering nothing was rejected
    // because most rows have no action, so the right edge would be ragged AND
    // moving as the five-second pulse gave and took actions.
    //
    // The cell has since gained a fixed `1.25rem` track of its own, and the
    // GRIDCELL still renders unconditionally while only the button inside it is
    // conditional. So the column holds still on its own, and the placeholder
    // was paying for something it no longer bought. This asserts that
    // directly: a row WITH a menu and a row WITHOUT one line up.
    const page = await openAgentsWithBoard();
    try {
      await expect.poll(() => menu(page, 'feature/untaken').count()).toBe(1);
      // The row with an action, and a row with none — the exact pair whose
      // divergence the old placeholder existed to prevent.
      expect(await menu(page, 'feature/blocked').count()).toBe(0);
      const withAction = await rowFor(page, 'feature/untaken')
        .locator('[role="gridcell"]').last().boundingBox();
      const without = await rowFor(page, 'feature/blocked')
        .locator('[role="gridcell"]').last().boundingBox();
      // Same width and same right edge, with no button in one of them.
      expect(withAction!.width).toBe(without!.width);
      expect(Math.round(withAction!.x + withAction!.width))
        .toBe(Math.round(without!.x + without!.width));
    } finally {
      await page.close();
    }
  });

  it('renders no menu on a row whose plan has no board card', async () => {
    // StartWorkButton takes a Card and a row is not one, so the card is looked
    // up by planFile. A plan outside the walked directories has a row and no
    // card — it gets no ACTION rather than a broken one, the same honest
    // fallback the plan link already makes.
    //
    // And now no CONTROL either: with nothing behind it, the `⋯` was the empty
    // menu in its purest form.
    const page = await openAgentsWithBoard();
    try {
      const li = rowFor(page, 'feature/ghost-ready');
      await expect.poll(() => li.textContent()).toContain(ELIGIBLE_NOTE);
      expect(await menu(page, 'feature/ghost-ready').count()).toBe(0);
      expect(await li.getByRole('button', { name: 'Start work' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('offers no ACTION on rows that already have a branch and a claim', async () => {
    // Working, quiet and waiting rows are somebody's already. Offering to start
    // one invites exactly the double-dispatch fleet-sees-merged-branches was
    // written to prevent.
    //
    // The menu is no longer "still there, dimmed" — it is not there. Same
    // conclusion for the reader, one fewer control that lies.
    //
    // **THE CLAIM IS ABOUT STARTING, NOT ABOUT THE MENU**, and the two came
    // apart once a row could offer a READ. `feature/beans-a` is a WORKING row —
    // an agent — so since `the-worker-log-is-readable` it carries a menu holding
    // its worker's log, while still offering nothing that would dispatch it. So
    // the absence of `Start work` is asserted on EVERY row below, and the
    // absence of the menu only on those with nothing at all to offer.
    //
    // Written this way rather than by dropping `beans-a` from the list: the row
    // that most needs the no-double-dispatch guarantee is precisely the one
    // somebody is already working, and removing it would retire the assertion
    // on its most important case.
    const page = await openAgentsWithBoard();
    try {
      await expect.poll(() => menu(page, 'feature/untaken').count()).toBe(1);
      // Two of these rows sit in groups that start folded.
      await expandAll(page);
      const claimed = ['feature/beans-a', 'feature/reviewed', 'feature/landed',
        'feature/ghost', 'feature/shelved'];
      for (const branch of claimed) {
        // THE LOAD-BEARING ONE: nothing here offers to dispatch a branch that
        // is already somebody's.
        expect(await rowFor(page, branch).getByRole('button', { name: 'Start work' }).count(),
          `${branch} offered Start work`).toBe(0);
      }
      // No menu at all on the rows that are not agents and have no run to open.
      for (const branch of claimed.filter((b) => b !== 'feature/beans-a')) {
        expect(await menu(page, branch).count(), `${branch} rendered a menu`).toBe(0);
      }
      // And the WORKING row's menu holds the log — a read — and nothing that acts.
      await menu(page, 'feature/beans-a').click();
      const working = rowFor(page, 'feature/beans-a');
      expect(await working.locator('[data-worker-log-open]').count()).toBe(1);
      expect(await working.getByRole('button', { name: 'Start work' }).count()).toBe(0);
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
    // no control — the same rule PlanCard follows.
    //
    // This asserted a DIMMED menu until 2026-08-18. With no card and no
    // dispatch verdict there is no item to hold, and a menu with no items now
    // renders no button — the empty `⋯` in its purest form, on a page that
    // knows nothing yet. The claim the old dimmed control made (*this is where
    // actions would be*) is exactly the claim this page cannot support.
    const page = await browser.newPage();
    try {
      await page.route('**/api/board', (route) => route.abort('connectionrefused'));
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      // This test builds its own page rather than going through `openAgents`, so
      // it opens NOT STARTED's fold itself — the row it is about is a
      // not-started BRANCH row, which now sits one click in.
      await expandPlans(page);
      await rowFor(page, 'feature/untaken').waitFor({ timeout: 10_000 });
      expect(await menu(page, 'feature/untaken').count()).toBe(0);
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
  const groupRows = (page: Page, label: string) => group(page, label).locator('li[data-agent-row]');

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
        .toContain('nothing — a machine is working');
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

  // ── A plan heading is earned per group, not per section ───────────────────

  it('heads a plan with several rows and leaves a one-row plan bare', async () => {
    // The mixed section is the whole reason this moved off a section-wide flag:
    // one plan with several rows beside a plan with one. A single answer is
    // wrong for one of them either way — it either heads the lonely row (a
    // label for the one line under it, costing a line of height to say what
    // that line already says) or strips the heading off the several.
    const page = await openAgents(fleet({
      rows: [
        row({ branch: 'feature/many-a', plan: 'tomatoes', planFile: 'p-tom.md', group: 'working' }),
        row({ branch: 'feature/many-b', plan: 'tomatoes', planFile: 'p-tom.md', group: 'working' }),
        row({ branch: 'feature/lonely', plan: 'beans', planFile: 'p-beans.md', group: 'working' }),
      ],
    }));
    try {
      const working = group(page, 'Working');
      await expect.poll(() => groupRows(page, 'Working').count()).toBe(3);
      // Only the multi-row plan earns a heading.
      const headings = await working.getByRole('heading', { level: 3 }).allTextContents();
      // No space before the count: the gap is a margin on the tally's span, so
      // it lives in CSS and never reaches textContent.
      expect(headings.map((t) => t.trim())).toEqual(['tomatoes(2)']);
      // And the half that is easy to lose: the unheaded row must name its own
      // plan, or the name vanishes from the page entirely. A fix that only
      // removes headings passes every assertion above and fails here.
      const texts = await groupRows(page, 'Working').allTextContents();
      const textFor = (branch: string) => texts.find((t) => t.includes(branch)) ?? '';
      expect(textFor('feature/lonely')).toContain('beans');
      // The headed rows do NOT repeat it — that repetition is what the heading
      // was bought with.
      expect(textFor('feature/many-a')).not.toContain('tomatoes');
      expect(textFor('feature/many-b')).not.toContain('tomatoes');
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
        .locator('li [data-branch]').evaluateAll((els) => els.map((e) => e.getAttribute('data-branch')));
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
      expect(await page.getByRole('link', { name: 'Pull request 130' }).count()).toBe(1);
      // One heading, not two: the default fixture's WORKING group holds `beans`
      // with two rows and `plant-tomatoes` with one, and a one-row plan earns
      // no heading. The point of the assertion is that the GROUPING survives a
      // failed poll — the number is whatever the payload happens to contain.
      expect(await group(page, 'Working').getByRole('heading', { level: 3 }).count()).toBe(1);
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

  // ── The row is a grid, and the columns hold still ─────────────────────────
  //
  // The defect these pin, from the screenshot that produced the plan: four rows
  // in WAITING ON YOU and no two of them agreeing on where anything sat. Only
  // three cells had a width, `ml-auto` on the note shoved everything from there
  // to the right edge, and the branch started wherever the plan cell before it
  // happened to end.

  /** The x of one cell of one row, by the cell's index in the track list. */
  async function cellX(page: Page, branch: string, index: number): Promise<number> {
    const cell = rowFor(page, branch).locator('[role="gridcell"]').nth(index);
    const box = await cell.boundingBox();
    return Math.round(box!.x);
  }

  // Cell indices, and they moved by one when the marks earned a track of their
  // own at the front of the row. Named rather than inlined precisely so this
  // shift is one edit — a stale `nth()` scattered through the file would keep
  // PASSING while measuring a different column, which is the quietest way for a
  // geometry test to stop meaning what it says.
  const PHASE_CELL = 1;
  const BRANCH_CELL = 3;
  const PR_CELL = 4;
  const AGE_CELL = 4;

  it('starts every branch cell at the same x, with a phase and without one', async () => {
    // The first of the three defects, and the reason the row became a grid at
    // all. `feature/reviewed` has a phase and `feature/nophase` has none; under
    // the flex row the second branch began 6rem to the left of the first,
    // because an absent cell took no space rather than leaving a gap.
    const page = await openAgents(fleet({
      rows: [
        row({ branch: 'feature/reviewed', plan: 'beans', group: 'waiting-on-you',
              phase: 'Development', ageMinutes: 20, note: 'awaiting review',
              branchUrl: `${GH}feature/reviewed` }),
        row({ branch: 'feature/nophase', plan: 'beans', group: 'waiting-on-you',
              phase: null, ageMinutes: 30, note: 'awaiting review',
              branchUrl: `${GH}feature/nophase` }),
      ],
    }));
    try {
      await expect.poll(() => rowFor(page, 'feature/nophase').count()).toBe(1);
      expect(await cellX(page, 'feature/nophase', BRANCH_CELL))
        .toBe(await cellX(page, 'feature/reviewed', BRANCH_CELL));
    } finally {
      await page.close();
    }
  });

  it('aligns a row whose plan sits in the heading with one whose does not', async () => {
    // The MIXED section — the case `showPlanHeading` introduced an hour before
    // this plan was written. A group with several rows under one plan prints
    // the name in the heading and leaves the rows bare; a group with one row
    // prints it in the row. Under the flex layout those two shapes differed by
    // a whole cell, so two rows in the same section could not line up.
    const page = await openAgents(fleet({
      rows: [
        row({ branch: 'feature/beans-1', plan: 'beans', group: 'waiting-on-you',
              ageMinutes: 500, note: 'awaiting review', branchUrl: `${GH}feature/beans-1` }),
        row({ branch: 'feature/beans-2', plan: 'beans', group: 'waiting-on-you',
              ageMinutes: 400, note: 'awaiting review', branchUrl: `${GH}feature/beans-2` }),
        row({ branch: 'feature/solo', plan: 'lonely', group: 'waiting-on-you',
              ageMinutes: 300, note: 'awaiting review', branchUrl: `${GH}feature/solo` }),
      ],
    }));
    try {
      await expect.poll(() => rowFor(page, 'feature/solo').count()).toBe(1);
      // `beans` earned a heading, so its rows carry no plan cell content;
      // `lonely` did not, so its row prints the name itself. Both branches must
      // still start at the same x — the cell is rendered either way.
      expect(await cellX(page, 'feature/solo', BRANCH_CELL))
        .toBe(await cellX(page, 'feature/beans-1', BRANCH_CELL));
      // And the fixture really is mixed, or the assertion above proves nothing.
      const headings = await group(page, 'Waiting on you')
        .getByRole('heading', { level: 3 }).allTextContents();
      expect(headings.map((t) => t.trim())).toEqual(['beans(2)']);
    } finally {
      await page.close();
    }
  });

  it('holds the PR and age columns still under a very long branch name', async () => {
    // The third defect: with the branch content-sized and the note pushed right
    // by `ml-auto`, the slack collected BETWEEN branch and PR — so the PR cell
    // sat wherever the branch happened to end.
    const page = await openAgents(fleet({
      rows: [
        row({ branch: 'feature/x', plan: 'beans', group: 'waiting-on-you',
              ageMinutes: 20, note: 'awaiting review', branchUrl: `${GH}feature/x` }),
        row({ branch: 'feature/opus5-longhorizon-hardening-challenge-budget-and-more',
              plan: 'beans', group: 'waiting-on-you', ageMinutes: 30,
              note: 'awaiting review', branchUrl: `${GH}feature/long` }),
      ],
    }));
    try {
      const long = 'feature/opus5-longhorizon-hardening-challenge-budget-and-more';
      await expect.poll(() => rowFor(page, long).count()).toBe(1);
      expect(await cellX(page, long, PR_CELL)).toBe(await cellX(page, 'feature/x', PR_CELL));
      expect(await cellX(page, long, AGE_CELL)).toBe(await cellX(page, 'feature/x', AGE_CELL));
    } finally {
      await page.close();
    }
  });

  // ── A branch row names its wave, where the plan has more than one ──────────
  //
  // The phase this column would show is the PLAN's word, the same on every
  // branch; which wave a branch belongs to is the fact that varies row to row.
  // So the wave name takes the cell — but only where the plan divides its work,
  // which is the whole rule: a caption over a plan's only wave is a partition of
  // one, and it is not shown.

  /**
   * A fleet holding one MULTI-WAVE plan whose branches sit in different
   * sections, plus two SINGLE-WAVE plans — one named, one unnamed.
   *
   * The multi-wave plan is what proves "in every section": its `Truth` branch is
   * in WORKING and its `Fold` branches in NOT STARTED, so a per-section reading
   * of the wave count would get one of them wrong. The named single-wave plan is
   * the one a presence check leaks on — it HAS a name and must still show none.
   */
  function waveFleet(): Fleet {
    return fleet({
      rows: [
        // Multi-wave plan `layered`: wave Truth (working) and wave Fold (two
        // not-started branches). Two waves, three branches, two sections.
        row({ branch: 'feature/truth-a', plan: 'layered', wave: 'Truth',
              group: 'working', ageMinutes: 5, note: 'last commit 5 min ago',
              branchUrl: `${GH}feature/truth-a` }),
        row({ branch: 'feature/fold-a', plan: 'layered', wave: 'Fold',
              group: 'not-started', state: 'open', phase: 'Design', ageMinutes: null,
              waitingOn: 'time' as const, note: 'blocked by Truth',
              branchUrl: `${GH}feature/fold-a` }),
        row({ branch: 'feature/fold-b', plan: 'layered', wave: 'Fold',
              group: 'not-started', state: 'open', phase: 'Design', ageMinutes: null,
              waitingOn: 'time' as const, note: 'blocked by Truth',
              branchUrl: `${GH}feature/fold-b` }),
        // Single-wave plan `flat`, with a NAMED wave. The trap: it has a name and
        // still must show none, because it is the plan's only wave.
        row({ branch: 'feature/flat-a', plan: 'flat', wave: 'Layout',
              group: 'working', ageMinutes: 8, note: 'last commit 8 min ago',
              branchUrl: `${GH}feature/flat-a` }),
        // Single-wave plan `plain`, UNNAMED — every branch carries `(unnamed)`.
        row({ branch: 'feature/plain-a', plan: 'plain', wave: '(unnamed)',
              group: 'working', ageMinutes: 12, note: 'last commit 12 min ago',
              branchUrl: `${GH}feature/plain-a` }),
        row({ branch: 'feature/plain-b', plan: 'plain', wave: '(unnamed)',
              group: 'working', ageMinutes: 15, note: 'last commit 15 min ago',
              branchUrl: `${GH}feature/plain-b` }),
      ],
    });
  }

  it('names a branch\'s wave in the phase cell, in EVERY section', async () => {
    // The load-bearing claim, across two sections at once: the count is
    // plan-wide, so a branch of a multi-wave plan names its wave whether it sits
    // in WORKING or NOT STARTED. A per-section count would leave the lone WORKING
    // branch reading as single-wave and blank its label.
    const page = await openAgents(waveFleet());
    try {
      const truth = rowFor(page, 'feature/truth-a');       // WORKING
      await expect.poll(() => truth.locator('[data-wave]').textContent()).toBe('Truth');
      const foldA = rowFor(page, 'feature/fold-a');        // NOT STARTED
      await expect.poll(() => foldA.locator('[data-wave]').textContent()).toBe('Fold');
      const foldB = rowFor(page, 'feature/fold-b');
      await expect.poll(() => foldB.locator('[data-wave]').textContent()).toBe('Fold');
      // The wave took the PHASE cell, not a seventh column: no `data-phase` on a
      // branch that now names its wave, and the wave word sits in that cell. Read
      // off `data-wave` rather than the cell text, which also holds the sr-only
      // "Wave:" prefix — the same shape the phase cell's own test reads.
      expect(await truth.locator('[data-phase]').count()).toBe(0);
      const waveCell = truth.locator('[role="gridcell"]').nth(PHASE_CELL);
      expect(await waveCell.locator('[data-wave]').textContent()).toBe('Truth');
    } finally {
      await page.close();
    }
  });

  it('shows NO wave label for a single-wave plan, named OR unnamed', async () => {
    // Both halves, and the named one is the trap. `flat`'s only wave is called
    // `Layout`; a presence check would print it, turning one branch into a line
    // of ceremony. `plain` is unnamed and must be just as bare.
    const page = await openAgents(waveFleet());
    try {
      const flat = rowFor(page, 'feature/flat-a');
      await expect.poll(() => flat.count()).toBe(1);
      expect(await flat.locator('[data-wave]').count()).toBe(0);
      expect(await flat.textContent()).not.toContain('Layout');
      const plain = rowFor(page, 'feature/plain-a');
      expect(await plain.locator('[data-wave]').count()).toBe(0);
      expect(await plain.textContent()).not.toContain('unnamed');
    } finally {
      await page.close();
    }
  });

  it('groups a wave\'s consecutive rows without repeating the name on each', async () => {
    // The grouping is unchanged — consecutive `Fold` rows read as one run
    // because they are adjacent, not because a heading was drawn per wave. The
    // name appears on BOTH rows (it is the phase cell's content, per row), which
    // is what a column does; what it must not do is add a wave HEADING row.
    const page = await openAgents(waveFleet());
    try {
      const notStarted = group(page, 'Not started');
      // Both Fold rows carry the name, in document order, adjacent.
      const waves = await notStarted.locator('li[data-agent-row] [data-wave]')
        .allTextContents();
      expect(waves).toEqual(['Fold', 'Fold']);
      // And no extra ROW was invented for the wave — the section holds exactly
      // its branches (under the plan row NOT STARTED draws), not a wave header.
      expect(await notStarted.getByRole('heading', { name: /^Fold/ }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('keeps the grid tracks still whether a row names a wave or a phase', async () => {
    // The wave name takes the phase cell rather than adding a column, so a row
    // that names its wave and one that names its phase must start their branch
    // cell at the same x. Asserted across the two plans in one section.
    const page = await openAgents(waveFleet());
    try {
      await expect.poll(() => rowFor(page, 'feature/truth-a').count()).toBe(1);
      // `truth-a` names a wave (multi-wave plan); `flat-a` names neither (its
      // single wave shows nothing) — the pair whose cell would diverge if the
      // wave label came from anywhere but the phase track.
      expect(await cellX(page, 'feature/truth-a', BRANCH_CELL))
        .toBe(await cellX(page, 'feature/flat-a', BRANCH_CELL));
      // Seven tracks, unchanged: the wave did not earn a column of its own.
      const tracks = await rowFor(page, 'feature/truth-a')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
      expect(tracks.split(' ')).toHaveLength(7);
    } finally {
      await page.close();
    }
  });

  it('gives the PR cell 14rem, and makes the LONG BRANCH pay for it', async () => {
    // The reported defect, measured in the browser rather than off the class
    // name: the PR cell held `⑂116 no checks` at 9rem and nothing wider, while
    // the window's slack sat in the branch's `1fr` drawing nothing.
    //
    // Both halves, because the first alone is passed by shapes the plan
    // rejected: the cell is 224px (14rem) AND the branch elides to make room,
    // rather than the row growing or the PR cell moving.
    const long = 'feature/opus5-longhorizon-hardening-challenge-budget-and-more';
    const page = await openAgentsAt(1024, fleet({
      rows: [
        row({ branch: 'feature/x', plan: 'beans', group: 'waiting-on-you',
              ageMinutes: 20, note: 'awaiting review', branchUrl: `${GH}feature/x`,
              pr: { number: 116, url: `${GH}../pull/116`, draft: false, state: 'none' } }),
        row({ branch: long, plan: 'beans', group: 'waiting-on-you', ageMinutes: 30,
              note: 'awaiting review', branchUrl: `${GH}feature/long` }),
      ],
    }));
    try {
      await expect.poll(() => rowFor(page, long).count()).toBe(1);
      const cell = rowFor(page, 'feature/x').locator('[role="gridcell"]').nth(PR_CELL);
      expect(Math.round((await cell.boundingBox())!.width)).toBe(224);
      // The long branch elides — it did not widen the row or shove the PR cell.
      // Measured as a CLIP rather than as a shorter string: `splitBranch` hands
      // the browser two spans and lets `truncate` fold them, so the ellipsis is
      // painted and `innerText` still reports the whole name. The fact that
      // matters is that the head's content outgrew the box it was given.
      // Asserted through `[data-branch]` rather than a Tailwind class name: the
      // clip belongs to the head span, and the row's own stable hook is the
      // anchor around it.
      const clipped = await rowFor(page, long).locator('[data-branch]').evaluate(
        (el) => Array.from(el.querySelectorAll('span'))
          .some((s) => s.scrollWidth > s.clientWidth),
      );
      expect(clipped).toBe(true);
      expect(await cellX(page, long, PR_CELL)).toBe(await cellX(page, 'feature/x', PR_CELL));
      // And `⑂116 no checks` — the widest cell in the reported screenshot, the
      // one 9rem could not hold — now fits inside its track rather than being
      // clipped by it.
      const fits = await cell.evaluate(
        (el) => Array.from(el.querySelectorAll('span'))
          .every((s) => s.scrollWidth <= s.clientWidth + 1),
      );
      expect(fits).toBe(true);
      expect(await cell.innerText()).toContain('116');
      expect(await cell.innerText()).toContain('no checks');
    } finally {
      await page.close();
    }
  });

  it('elides a long branch in the MIDDLE, so a shared prefix stays readable', async () => {
    // The decision that matters most about the truncation, and the one an
    // ordinary `truncate` gets exactly backwards. These six branches share
    // twenty-four characters and differ only after them, so end-truncation
    // renders all six identically — which reads as six DUPLICATE ROWS rather
    // than as truncation, and is worse than no truncation at all.
    const suffixes = ['challenge-budget', 'longhorizon', 'tool-budget', 'retry-policy'];
    const branches = suffixes.map((s) => `feature/opus5-hardening-${s}`);
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 900, height: 800 });
      await page.route('**/api/fleet', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(fleet({
          rows: branches.map((b, i) => row({
            branch: b, plan: 'beans', group: 'waiting-on-you', ageMinutes: 100 + i,
            note: 'awaiting review', branchUrl: `${GH}${b}`,
          })),
        })),
      }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await expect.poll(() => group(page, 'Waiting on you')
        .locator('li[data-agent-row]').count()).toBe(4);

      // What a sighted reader sees, per row — `innerText` rather than
      // `textContent`, because the fold is done by clipping and only the
      // rendered text tells them apart.
      const shown = await page.locator('[data-branch]').evaluateAll(
        (els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, '')),
      );
      // Every row reads differently: the assertion end-truncation fails.
      expect(new Set(shown).size).toBe(4);
      // And each keeps the tail that says WHICH one — the half end-truncation
      // throws away.
      for (const s of suffixes) {
        expect(shown.some((t) => t.endsWith(s.slice(-8)))).toBe(true);
      }
      // The full name survives for anyone who needs it: in `title`, and in the
      // accessible name.
      expect(await page.getByRole('link', { name: branches[0] }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('gives every waiting-group the same row — no special case for one', async () => {
    // `AgentList` maps GROUPS and renders ONE `<Row>` inside it, so this comes
    // free. Pinned anyway, because the cheap way to fix one group's alignment
    // is a special case, and a special case is how six sections stop agreeing.
    const page = await openAgents();
    try {
      await expandAll(page);
      for (const label of ['Waiting on you', 'Working', 'Not started', 'Quiet', 'Done']) {
        const rows = group(page, label).locator('li[data-agent-row]');
        await expect.poll(() => rows.count()).toBeGreaterThan(0);
        // Same tracks, read off the browser rather than off the class name: a
        // group given its own class list would pass a `toContain('grid-cols')`
        // assertion and lay out differently.
        const tracks = await rows.first().evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns,
        );
        // SEVEN since the marks earned a track of their own at the front.
      expect(tracks.split(' ')).toHaveLength(7);
      }
    } finally {
      await page.close();
    }
  });

  // ── The PR cell reads its fields, and the note keeps the rest ─────────────

  /** A pulse holding one row with the PR fields under test. */
  const withPr = (pr: AgentRow['pr'], note: string) => fleet({
    rows: [row({
      branch: 'feature/pr-row', plan: 'beans', group: 'waiting-on-you',
      ageMinutes: 20, note, pr, branchUrl: `${GH}feature/pr-row`,
    })],
  });

  it('renders the PR cell from the FIELDS, not from the note\'s wording', async () => {
    // The `indexOf` version searched `row.note` for `PR #<n>` in order to link
    // it — a parser for a format nobody declared, which silently rendered an
    // unlinked note the moment the server's wording drifted. So the note here
    // says nothing of the kind, and the cell must still be complete.
    const page = await openAgents(withPr(
      { number: 158, url: 'https://github.com/tiny/garden/pull/158', draft: false, state: 'green' },
      'uncommitted work in a local worktree',
    ));
    try {
      const li = rowFor(page, 'feature/pr-row');
      await expect.poll(() => li.count()).toBe(1);
      const link = li.getByRole('link', { name: 'Pull request 158' });
      expect(await link.count()).toBe(1);
      expect(await link.getAttribute('href')).toBe('https://github.com/tiny/garden/pull/158');
      expect(await li.textContent()).toContain('green');
    } finally {
      await page.close();
    }
  });

  it('keeps what a PR state cannot say — the note is relieved, not replaced', async () => {
    // Three notes that no PR state can carry. The cell takes over one duty; it
    // does not take over the note.
    for (const note of ['uncommitted work in a local worktree',
      'blocked by an earlier wave', 'claimed elsewhere']) {
      const page = await openAgents(withPr(null, note));
      try {
        const li = rowFor(page, 'feature/pr-row');
        await expect.poll(() => li.textContent()).toContain(note);
      } finally {
        await page.close();
      }
    }
  });

  it('says the PR\'s condition ONCE, not twice', async () => {
    // The server still composes `PR #158, conflicts · awaiting review` — this
    // wave does not touch `fleet.ts`. With the cell rendering the same facts
    // from the fields, printing the whole sentence beside it would say them
    // twice on every row that has a PR. What survives is everything AFTER the
    // separator, which is what a PR state cannot say.
    const page = await openAgents(withPr(
      { number: 158, url: 'https://github.com/tiny/garden/pull/158',
        draft: false, state: 'conflicts' },
      'PR #158, conflicts · awaiting review',
    ));
    try {
      const li = rowFor(page, 'feature/pr-row');
      await expect.poll(() => li.textContent()).toContain('awaiting review');
      const text = (await li.textContent()) ?? '';
      // The words `PR #158` are gone — the glyph and the number replaced them.
      expect(text).not.toContain('PR #158');
      // And `conflicts` appears once, from the cell.
      expect(text.match(/conflicts/g) ?? []).toHaveLength(1);
    } finally {
      await page.close();
    }
  });

  it('shows a draft AND its check state — never one folded into the other', async () => {
    // Folding `draft` into the state enum would rebuild the short-circuit that
    // kept WAITING ON A MACHINE empty for three releases: the classifier used
    // to return on every draft before the checks were consulted. A draft has CI
    // like anything else, and both facts must reach the row.
    const page = await openAgents(withPr(
      { number: 158, url: 'https://github.com/tiny/garden/pull/158',
        draft: true, state: 'pending' },
      'awaiting review',
    ));
    try {
      const li = rowFor(page, 'feature/pr-row');
      await expect.poll(() => li.locator('[data-pr-draft]').count()).toBe(1);
      expect(await li.locator('[data-pr-state="pending"]').textContent()).toBe('CI running');
    } finally {
      await page.close();
    }
  });

  it('says `conflicts` where the PR conflicts, and `no checks` where it does not', async () => {
    // The pairing that matters: one label for both is the defect, and renaming
    // all of them to `conflicts` is the same defect mirrored. The distinction
    // is settled in the FIELD by wave 1; this asserts the cell prints it.
    for (const [state, word] of [['conflicts', 'conflicts'], ['none', 'no checks']] as const) {
      const page = await openAgents(withPr(
        { number: 149, url: 'https://github.com/tiny/garden/pull/149', draft: false, state },
        'awaiting review',
      ));
      try {
        const li = rowFor(page, 'feature/pr-row');
        await expect.poll(() => li.locator(`[data-pr-state="${state}"]`).textContent())
          .toBe(word);
      } finally {
        await page.close();
      }
    }
  });

  it('says nothing at all where the host cannot report a state', async () => {
    // Bitbucket carries no check rollup. The word "unknown" on every row of an
    // entire host is noise saying only *this board could not find out* — absent
    // is the honest rendering, the same rule the contract states for the field.
    const page = await openAgents(withPr(
      { number: 149, url: 'https://github.com/tiny/garden/pull/149',
        draft: false, state: 'unknown' },
      'awaiting review',
    ));
    try {
      const li = rowFor(page, 'feature/pr-row');
      await expect.poll(() => li.getByRole('link', { name: 'Pull request 149' }).count()).toBe(1);
      expect(await li.locator('[data-pr-state]').count()).toBe(0);
      expect(await li.textContent()).not.toContain('unknown');
    } finally {
      await page.close();
    }
  });

  it('keeps the icon from being the sole carrier', async () => {
    // The repo's rule is *symbol AND word*: the glyph replaces the label `PR`,
    // never the state. The number stays, the state stays as a word, and the
    // glyph carries an accessible label — a bare `157` announces nothing.
    const page = await openAgents(withPr(
      { number: 157, url: 'https://github.com/tiny/garden/pull/157',
        draft: false, state: 'failing' },
      'awaiting review',
    ));
    try {
      const li = rowFor(page, 'feature/pr-row');
      await expect.poll(() => li.textContent()).toContain('157');
      expect(await li.textContent()).toContain('checks failing');
      expect(await li.getByRole('img', { name: 'Pull request' }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('renders a PR with no address as plain text rather than an invented link', async () => {
    // An older host CLI reports no URL. The same rule the branch cell follows
    // for a merged branch: plain text, never a guessed address.
    const page = await openAgents(withPr(
      { number: 157, url: '', draft: false, state: 'green' },
      'awaiting review',
    ));
    try {
      const li = rowFor(page, 'feature/pr-row');
      await expect.poll(() => li.locator('[data-pr-number]').count()).toBe(1);
      expect(await li.locator('[data-pr-link]').count()).toBe(0);
      expect(await li.textContent()).toContain('157');
    } finally {
      await page.close();
    }
  });

  // ── A row marks itself when its PR status changes ─────────────────────────
  //
  // The RULE is pinned in test/unit/agent-list.test.ts, where `changedRows` is
  // a pure function over (prior, current) — vitest runs `environment: 'node'`,
  // so what belongs here is only what genuinely needs a page: that the mark
  // appears on a real transition, that it clears itself, that reduced motion
  // keeps it, and that it announces nothing.

  /**
   * The Agents tab with a payload that can be SWAPPED between polls.
   *
   * A transition cannot be stated as one payload — that is the entire point of
   * the feature. The route reads a mutable variable rather than being
   * re-registered, so a poll in flight at the moment of the swap cannot slip
   * past an unrouted window.
   */
  async function openAgentsSwappable(
    first: Fleet,
    opts: { reducedMotion?: 'reduce' | 'no-preference' } = {},
  ): Promise<{ page: Page; swap: (next: Fleet) => void }> {
    let current = first;
    const context = await browser.newContext(
      opts.reducedMotion ? { reducedMotion: opts.reducedMotion } : {});
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(current) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    return { page, swap: (next: Fleet) => { current = next; } };
  }

  /** One fleet holding one row, whose PR carries `state` (or no PR at all). */
  const oneRow = (state: 'green' | 'pending' | 'failing' | 'conflicts' | null,
                  over: Partial<AgentRow> = {}) =>
    fleet({ rows: [row({
      branch: 'feature/watched', plan: 'beans', group: 'waiting-on-you',
      ageMinutes: 20, note: 'awaiting review', branchUrl: `${GH}feature/watched`,
      pr: state === null ? null
        : { number: 200, url: `${GH}../pull/200`, draft: false, state },
      ...over,
    })] });

  const mark = (page: Page, branch: string) =>
    rowFor(page, branch).locator('[data-change-mark]');

  it('marks NOTHING on the first pulse, with rows already carrying states', async () => {
    // Fires on every page load and every board restart. A naive implementation
    // gets this wrong in the loudest possible way — every row at once.
    const { page } = await openAgentsSwappable(oneRow('conflicts'));
    try {
      await expect.poll(() => rowFor(page, 'feature/watched').count()).toBe(1);
      // Given time for several polls to land, so this is not merely early.
      await page.waitForTimeout(1_500);
      expect(await mark(page, 'feature/watched').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('marks a row whose PR status changes, and clears itself after ~3s', async () => {
    // Both halves in one run, because the clearing is what makes it a MARKER
    // rather than a state — and a mark that waits for the next pulse to clear
    // would sit lit forever on a board whose server died, which is exactly when
    // nothing is changing.
    const { page, swap } = await openAgentsSwappable(oneRow('pending'));
    try {
      await expect.poll(() => rowFor(page, 'feature/watched').count()).toBe(1);
      expect(await mark(page, 'feature/watched').count()).toBe(0);
      swap(oneRow('failing'));
      await expect.poll(() => mark(page, 'feature/watched').count(),
        { timeout: 10_000 }).toBe(1);
      // And it goes out on its OWN timer while the payload keeps arriving
      // unchanged — no further transition clears it.
      await expect.poll(() => mark(page, 'feature/watched').count(),
        { timeout: 10_000 }).toBe(0);
    } finally {
      await page.close();
    }
  });

  // The RESTART rule is asserted in test/unit/agent-list.test.ts, on a fake
  // clock, and deliberately not here: `FLEET_POLL_MS` is 4s while a mark lives
  // 3s, so two changes on consecutive polls can never overlap. A browser test
  // claiming to watch a restart is really watching a second mark replace an
  // expired first — it passes with the restart removed, which was checked.

  it('marks a row that changed SECTION, at its new location', async () => {
    // The common case rather than the exotic one: `pr.state` helps decide the
    // group, so a change frequently moves the row. The pairing that matters —
    // an implementation keyed on position loses the prior value exactly here.
    const { page, swap } = await openAgentsSwappable(
      oneRow('pending', { group: 'waiting-on-machine' }));
    try {
      await expect.poll(() => rowFor(page, 'feature/watched').count()).toBe(1);
      swap(oneRow('conflicts', { group: 'waiting-on-you' }));
      await expect.poll(() => mark(page, 'feature/watched').count(),
        { timeout: 10_000 }).toBe(1);
      // On the row where it NOW sits, which is the other section.
      const marked = group(page, 'Waiting on you').locator('[data-change-mark]');
      expect(await marked.count()).toBe(1);
      expect(await group(page, 'Waiting on a machine')
        .locator('[data-change-mark]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('marks a PR APPEARING on a row that had none', async () => {
    // `null → pending`, and the half that separates *never seen* from *seen
    // with no PR*: the row is observed WITHOUT a PR first, so its first PR is a
    // transition rather than a first sighting.
    const { page, swap } = await openAgentsSwappable(oneRow(null));
    try {
      await expect.poll(() => rowFor(page, 'feature/watched').count()).toBe(1);
      await page.waitForTimeout(1_000);
      expect(await mark(page, 'feature/watched').count()).toBe(0);
      swap(oneRow('pending'));
      await expect.poll(() => mark(page, 'feature/watched').count(),
        { timeout: 10_000 }).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('marks ten simultaneous changes with ten marks', async () => {
    // A move on the default branch flips many PRs to `conflicts` at once. No
    // threshold and no suppression: a rule that went quiet exactly when the
    // most changed would be least informative at its most eventful moment.
    const many = (state: 'green' | 'conflicts') => fleet({
      rows: Array.from({ length: 10 }, (_, i) => row({
        branch: `feature/m${i}`, plan: 'beans', group: 'waiting-on-you',
        ageMinutes: 20 + i, note: 'awaiting review', branchUrl: `${GH}feature/m${i}`,
        pr: { number: 300 + i, url: `${GH}../pull/${300 + i}`, draft: false, state },
      })),
    });
    const { page, swap } = await openAgentsSwappable(many('green'));
    try {
      await expect.poll(() => group(page, 'Waiting on you')
        .locator('li[data-agent-row]').count()).toBe(10);
      swap(many('conflicts'));
      await expect.poll(() => page.locator('[data-change-mark]').count(),
        { timeout: 10_000 }).toBe(10);
    } finally {
      await page.close();
    }
  });

  it('does NOT mark a row whose PR status held, however much else moved', async () => {
    // The note and the commit age change; the watched value does not. The
    // marker is about that value alone.
    const { page, swap } = await openAgentsSwappable(
      oneRow('green', { note: 'awaiting review', ageMinutes: 20 }));
    try {
      await expect.poll(() => rowFor(page, 'feature/watched').count()).toBe(1);
      swap(oneRow('green', { note: 'last commit 1 min ago', ageMinutes: 1 }));
      // The new note really did land, or this asserts nothing.
      await expect.poll(() => rowFor(page, 'feature/watched').innerText(),
        { timeout: 10_000 }).toContain('last commit 1 min ago');
      expect(await mark(page, 'feature/watched').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('KEEPS the mark under reduced motion, and stops only the animation', async () => {
    // Both halves. A fix that hides the mark under `motion-reduce` passes a
    // motion-only assertion and loses the information along with the movement —
    // the same rule `LiveDot` follows.
    const { page, swap } = await openAgentsSwappable(
      oneRow('pending'), { reducedMotion: 'reduce' });
    try {
      await expect.poll(() => rowFor(page, 'feature/watched').count()).toBe(1);
      swap(oneRow('conflicts'));
      const el = mark(page, 'feature/watched');
      await expect.poll(() => el.count(), { timeout: 10_000 }).toBe(1);
      // Still visible, and carrying a background — the information survives.
      const seen = await el.evaluate((e) => {
        const s = getComputedStyle(e);
        return { animation: s.animationName, bg: s.backgroundColor };
      });
      expect(seen.animation).toBe('none');
      expect(seen.bg).not.toBe('rgba(0, 0, 0, 0)');
    } finally {
      await page.close();
    }
  });

  it('announces nothing — the mark is decoration over text that already changed', async () => {
    // A screen reader reaches the new value by reading the row. An `aria-live`
    // region firing on every CI transition across every row would be an
    // interruption rather than an aid.
    const { page, swap } = await openAgentsSwappable(oneRow('pending'));
    try {
      await expect.poll(() => rowFor(page, 'feature/watched').count()).toBe(1);
      swap(oneRow('conflicts'));
      const el = mark(page, 'feature/watched');
      await expect.poll(() => el.count(), { timeout: 10_000 }).toBe(1);
      expect(await el.getAttribute('aria-hidden')).toBe('true');
      // And no live region was introduced anywhere on the page to carry it.
      expect(await page.locator('[aria-live]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('leaves the LIVE DOT alone — two marks, two meanings', async () => {
    // #176 settled that distinction and keeping them separate is a requirement:
    // the dot means *something is alive, end unknown* and lives for hours; this
    // means *this just changed* and lives for seconds.
    const { page, swap } = await openAgentsSwappable(
      oneRow('pending', { group: 'working' }));
    try {
      await expect.poll(() => rowFor(page, 'feature/watched').count()).toBe(1);
      const li = rowFor(page, 'feature/watched');
      expect(await li.locator('[data-live-dot]').count()).toBe(1);
      swap(oneRow('conflicts', { group: 'working' }));
      await expect.poll(() => mark(page, 'feature/watched').count(),
        { timeout: 10_000 }).toBe(1);
      // Both present, and they are different elements.
      expect(await li.locator('[data-live-dot]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  // ── Below 640px the row becomes a card ────────────────────────────────────

  /** The agents tab at one viewport width. */
  async function openAgentsAt(width: number, payload: Fleet = fleet()): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    return page;
  }

  it('drops NOTHING at 375px — the card stacks, it does not shed columns', async () => {
    // Measured: the fixed tracks need 624px before the branch column gets a
    // single pixel, and a 375px phone is 249px short. So the row stops being a
    // row — but dropping columns was the cheaper answer and is wrong. The plan
    // name in particular is what `showPlanHeading` just made a row's own
    // responsibility, and removing it on a phone would re-open at one width the
    // defect closed at every width an hour earlier.
    const page = await openAgentsAt(375, fleet({
      rows: [row({
        branch: 'feature/phone', plan: 'lonely-plan', group: 'waiting-on-you',
        phase: 'Development', ageMinutes: 20, note: 'awaiting review',
        pr: { number: 158, url: 'https://github.com/tiny/garden/pull/158',
              draft: false, state: 'green' },
        branchUrl: `${GH}feature/phone`,
      })],
    }));
    try {
      const li = rowFor(page, 'feature/phone');
      await expect.poll(() => li.count()).toBe(1);
      const text = (await li.textContent()) ?? '';
      // All five facts, present.
      expect(text).toContain('lonely-plan');   // plan
      expect(text).toContain('Development');   // phase
      expect(text).toContain('158');           // PR
      expect(text).toContain('green');         // PR state
      expect(text).toContain('20m');           // age
      // And the branch, WHOLE — nothing elided in the card form.
      const shown = await li.locator('[data-branch]').evaluate(
        (el) => (el as HTMLElement).innerText.replace(/\s+/g, ''),
      );
      expect(shown).toBe('feature/phone');
    } finally {
      await page.close();
    }
  });

  it('gives the branch its own line at 375px, and the rest beneath it', async () => {
    // The branch is the row's primary key and the thing worth reading in full,
    // so the card leads with it and wraps everything else below. Asserted in
    // pixels: a "card" that merely wraps mid-row is the flex layout this
    // replaced.
    const page = await openAgentsAt(375, fleet({
      rows: [row({
        branch: 'feature/phone', plan: 'lonely-plan', group: 'waiting-on-you',
        phase: 'Development', ageMinutes: 20, note: 'awaiting review',
        branchUrl: `${GH}feature/phone`,
      })],
    }));
    try {
      const li = rowFor(page, 'feature/phone');
      await expect.poll(() => li.count()).toBe(1);
      const branch = await li.locator('[data-branch]').boundingBox();
      const phase = await li.locator('[data-phase]').boundingBox();
      // The phase sits ABOVE the branch (plan and phase lead the wrapped line
      // in DOM order), and nothing shares the branch's line to its right.
      expect(phase!.y).toBeLessThan(branch!.y);
      // The row is taller than one line: it stacked rather than ranged.
      const box = await li.boundingBox();
      expect(box!.height).toBeGreaterThan(branch!.height * 1.5);
      // And the page does not scroll sideways, which is what a grid at 375px
      // would do.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    } finally {
      await page.close();
    }
  });

  it('names the phase in the card, where there is no column to name it', async () => {
    // The other half of dropping the `sr-only` prefix. The header goes with the
    // columns below `sm`, so a card reader would otherwise hear `Development`
    // with nothing saying what it is — exactly the defect the prefix was
    // written for. It is gone from the GRID, where the header replaced it, not
    // gone from the app.
    const page = await openAgentsAt(375, fleet({
      rows: [row({
        branch: 'feature/phone', plan: 'lonely-plan', group: 'waiting-on-you',
        phase: 'Development', ageMinutes: 20, note: 'awaiting review',
        branchUrl: `${GH}feature/phone`,
      })],
    }));
    try {
      const li = rowFor(page, 'feature/phone');
      await expect.poll(() => li.count()).toBe(1);
      // NOT `.first()` — that is the marks cell now. The phase is the second,
      // read by the named constant so this stays in step with the geometry
      // constants above.
      const phaseCell = li.locator('[role="gridcell"]').nth(PHASE_CELL);
      // `innerText` reports the sr-only span as its own line, so the assertion
      // is on the words rather than on the exact spacing between them.
      const heard = await phaseCell.evaluate((el) => (el as HTMLElement).innerText);
      expect(heard).toContain('Phase:');
      expect(heard).toContain('Development');
      // And the header is not also announcing it — there are no columns.
      expect(await group(page, 'Waiting on you').getByRole('columnheader').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('does NOT render a card above the threshold', async () => {
    // The pairing that matters: a fix that renders cards everywhere passes
    // every mobile assertion above. At 1280px the row is one line, on tracks.
    const page = await openAgentsAt(1280, fleet({
      rows: [row({
        branch: 'feature/desk', plan: 'lonely-plan', group: 'waiting-on-you',
        phase: 'Development', ageMinutes: 20, note: 'awaiting review',
        branchUrl: `${GH}feature/desk`,
      })],
    }));
    try {
      const li = rowFor(page, 'feature/desk');
      await expect.poll(() => li.count()).toBe(1);
      const branch = await li.locator('[data-branch]').boundingBox();
      const phase = await li.locator('[data-phase]').boundingBox();
      // Same line: the phase is to the LEFT of the branch, not above it.
      expect(phase!.x).toBeLessThan(branch!.x);
      expect(Math.abs(phase!.y - branch!.y)).toBeLessThan(branch!.height);
      // And it really is a grid with six tracks.
      const tracks = await li.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
      // SEVEN since the marks earned a track of their own at the front.
      expect(tracks.split(' ')).toHaveLength(7);
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

  /**
   * The WAITING ON A MACHINE section, header and body, as one reader sees it.
   *
   * Read from the rendered page rather than from the props, because the whole
   * defect was a rendering one: every fact needed to tell the two situations
   * apart was already in the payload and already in the footer, and the section
   * printed one word for both anyway.
   */
  async function machineSection(page: Page): Promise<{ header: string; body: string }> {
    const header = page.locator('h2', { hasText: 'Waiting on a machine' });
    await header.waitFor({ timeout: 10_000 });
    const body = page.locator('ul[aria-label="Waiting on a machine — agent branches"]');
    await body.waitFor({ timeout: 10_000 });
    return {
      header: (await header.textContent()) ?? '',
      body: (await body.textContent()) ?? '',
    };
  }

  it('does not print `none` on a board that has not yet asked the host', async () => {
    // THE REPORTED DEFECT, rendered. Measured 2026-08-18 from two screenshots
    // of one board 22 seconds apart: at `PR data 22s ago` the section read
    // `none` with no status on any row, and 22 seconds later the same board
    // reported #57 `conflicts`, #196 `checks failing` since the previous day
    // and #203 `CI running`. Nothing changed on the host. The operator read it
    // as the board having lost its state; it had not yet fetched it.
    //
    // `prAgeSeconds: null` is the contract's own spelling of *it has never
    // landed — not that it is fresh*, and it is the state every board is in for
    // the first seconds after it opens.
    const page = await openAgents(fleet({ prAgeSeconds: null, prNextInSeconds: null }));
    try {
      const { header, body } = await machineSection(page);
      expect(body).not.toContain('none');
      expect(body).toContain('not checked yet');
      // And the header says it too, because QUIET and DONE prove a header can
      // be the only part of a section on screen.
      expect(header).toContain('not checked yet');
      // The claim is WITHDRAWN, not merely reworded: the default hint promises
      // a machine is working on it, which is exactly what an unasked board
      // cannot support.
      expect(header).not.toContain('CI will finish');
    } finally {
      await page.close();
    }
  });

  it('reads exactly as today once a fetch has landed and found nothing', async () => {
    // The other half, and the one a regression would take out silently. After
    // an answer, `none` is a real observation — nothing is pending — and it
    // must keep saying so in the same words. A fix that labelled every empty
    // section `not checked yet` would trade one misreading for another.
    const page = await openAgents(fleet({ prAgeSeconds: 4 }));
    try {
      const { header, body } = await machineSection(page);
      expect(body).toContain('none');
      expect(body).not.toContain('not checked yet');
      expect(header).toContain('nothing — a machine is working');
    } finally {
      await page.close();
    }
  });

  it('keeps ageing a fetched board rather than re-labelling it', async () => {
    // A FIRST-LOAD STATE, NOT A STALENESS DISPLAY. 111 s against a 60 s
    // `PR_REFRESH_MS` is the measured miss that
    // `bug/a-refresh-that-never-fires-is-not-a-cadence` fixes — and it is still
    // an ANSWER. The footer reports its age; the section must not start
    // flickering between two labels every minute.
    const page = await openAgents(fleet({ prAgeSeconds: 111, prNextInSeconds: 0 }));
    try {
      const { body } = await machineSection(page);
      expect(body).toContain('none');
      expect(body).not.toContain('not checked yet');
      // The age is the footer's job, and it is still doing it.
      await page.getByText(/PR data 11\ds ago/).waitFor({ timeout: 10_000 });
    } finally {
      await page.close();
    }
  });

  it('shows a FAILED first call as an outage, not as not-checked-yet', async () => {
    // The plan's open question, decided in favour of a fourth state.
    // `2026-08-17-an-outage-is-not-an-answer.md` (Delivered) established that
    // an outage must be visible AS an outage: `unasked` clears itself within
    // seconds and asks the reader for nothing, while this one waits for
    // somebody to read the error.
    //
    // The server draws the same line: `refreshPrs` leaves `prAt` untouched when
    // the call throws, so a null age BESIDE an error is a first fetch that
    // failed rather than one not yet made.
    const page = await openAgents(fleet({ prAgeSeconds: null, prError: 'gh: 503' }));
    try {
      const { header, body } = await machineSection(page);
      expect(body).not.toContain('none');
      expect(body).toContain('could not reach the host');
      expect(body).not.toContain('not checked yet');
      expect(header).toContain('could not reach the host');
      // The existing banner still carries the message itself — the section says
      // WHICH state it is in, the banner says what went wrong. Neither
      // duplicates the other.
      await page.locator('p', { hasText: 'PR data unavailable' })
        .waitFor({ timeout: 10_000 });
    } finally {
      await page.close();
    }
  });

  it('says a spent rate limit is a rate limit, and names when it returns', async () => {
    // `2026-08-20-a-rate-limit-is-not-an-outage.md`: a spent budget is partial,
    // temporary, and has a KNOWN END — none of which *unavailable* conveys. The
    // sibling wave taught the fetch to back off to the host's real reset and to
    // carry that reset in `prNextInSeconds`; this branch is what SAYS so to the
    // reader. 480 s is the ~8-minute reset this repo measured on 2026-08-20.
    const page = await openAgents(fleet({
      prAgeSeconds: null,
      prError: 'GraphQL: API rate limit already exceeded for user ID 870334',
      prNextInSeconds: 480,
    }));
    try {
      const banner = page.locator('[data-pr-error]');
      await banner.waitFor({ timeout: 10_000 });
      const text = await banner.textContent();
      // SAYS the state: a rate limit, not a generic outage.
      expect(text).toMatch(/rate limit/i);
      // NAMES when service returns — the known end an outage does not have.
      expect(text).toContain('8 min');
      // And does NOT read as *unavailable*, the outage word this branch removes
      // from the rate-limit case.
      expect(text).not.toContain('unavailable');
    } finally {
      await page.close();
    }
  });

  it('never lets a host-fed section borrow the git scan\'s freshness', async () => {
    // Two sources, two clocks. The git scan runs every few seconds and the host
    // every 60, so a board that is git-fresh and host-unfetched is not an edge
    // case — it is most of every minute, and it is precisely the board that was
    // misread. A scan one second old must change nothing about what the
    // unfetched section says.
    const page = await openAgents(
      fleet({ ageSeconds: 1, scanNextInSeconds: 3, prAgeSeconds: null, prNextInSeconds: null }));
    try {
      const { body } = await machineSection(page);
      expect(body).toContain('not checked yet');
      expect(body).not.toContain('none');
      // Both ages are still reported separately, which is the separation the
      // section is now honouring rather than replacing.
      await page.getByText(/scanned \ds ago/).waitFor({ timeout: 10_000 });
      await page.getByText(/no PR data yet/).waitFor({ timeout: 10_000 });
    } finally {
      await page.close();
    }
  });

  it('shows the WHOLE PR error, however long the path in it', async () => {
    // The message used to be cut at 80 characters, which is short enough to
    // land mid-path — and the cut carried no ellipsis, so
    // `…/skills/plot/script` read like a complete filename and named a file
    // that does not exist. Measured cost: one wrong lookup before finding
    // `plot-host.sh`.
    //
    // Asserted with the REAL message shape rather than a synthetic long string:
    // an absolute path in this repo is already past 80 characters, which is why
    // the limit bit in ordinary use rather than in some edge case.
    const message =
      'Command failed: bash /Users/someone/Quatico/Agentic-Tools/plot/skills/plot/scripts/plot-host.sh pr-list --rich';
    expect(message.length).toBeGreaterThan(80);
    const page = await openAgents(fleet({ prError: message }));
    try {
      const warning = page.locator('p', { hasText: 'PR data unavailable' });
      await warning.waitFor({ timeout: 10_000 });
      // The tail is what a slice would have removed, and the script's name is
      // the whole point of reading the message at all.
      expect(await warning.textContent()).toContain('plot-host.sh pr-list --rich');
      // And it WRAPS rather than widening the page: the footer is a paragraph,
      // and a message with nowhere to break would otherwise push a horizontal
      // scrollbar onto every other row on the board.
      const overflows = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflows).toBe(false);
    } finally {
      await page.close();
    }
  });
});
