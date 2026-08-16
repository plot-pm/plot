import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';
// The threshold under test, IMPORTED rather than restated: a copy here would
// drift in exactly the way that matters — raise it in App.tsx and a hard-coded
// 8 would keep passing while asserting nothing about the shipped behaviour.
import { DIM_AFTER_FAILURES } from '../../src/app/App.js';

/**
 * A frozen board stops INVITING, not merely stops lying.
 *
 * `board-tells-the-truth` (#141) gave the page a banner, a `(frozen)` footer
 * and stopped clocks — it says *these numbers are old*. What was missing is
 * *do not operate this right now*: rows kept full contrast and the action menu
 * kept offering `Start work` on data minutes old.
 *
 * Every assertion here is one a weaker implementation passes without. In
 * particular: the short-silence case (a threshold-free implementation passes
 * every test written against the long one), the Board tab (which today only
 * ever set an `error` string, so an Agents-only implementation passes
 * everything else), and the bad-answer case (an overlay claiming *no contact*
 * about a server that is talking).
 *
 * Failures are driven through the VISIBILITY re-check rather than by waiting
 * out real poll intervals. That is not a shortcut around the threshold — it is
 * the mechanism the plan requires ("returning to a backgrounded tab re-checks
 * rather than counts"), exercised at speed. Eight failed polls at the board's
 * 30 s rate is four minutes of wall clock, which no test suite should spend,
 * and counting the failures is precisely what these tests are about.
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

function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/beans-a', plan: 'beans', ageMinutes: 200 }),
    // The row that carries a Start work button: the control whose invitation
    // this whole plan exists to withdraw.
    row({
      branch: 'feature/untaken', plan: 'plant-tomatoes', group: 'not-started',
      state: 'open', phase: 'Design', ageMinutes: null, note: ELIGIBLE_NOTE,
      branchUrl: `${GH}feature/untaken`, waitingDays: 22,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1,
    ready: true,
    error: null,
    rows,
    summary: {
      plans: 2, waves: 2, branches: rows.length,
      claimed: 0, eligible: 1, blocked: 0, deferred: 0,
    },
    prAgeSeconds: 74,
    prNextInSeconds: 46,
    scanNextInSeconds: 3,
    prError: null,
    ...over,
  };
}

describe('tiny-garden: a frozen board stops inviting', () => {
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

  const overlay = (page: Page) => page.locator('[data-unreachable-overlay]');
  const scrim = (page: Page) => page.locator('[data-unreachable-scrim]');
  const startButton = (page: Page) => page.getByRole('button', { name: /Start work/ });

  /**
   * How a real backgrounded tab comes back — and, here, the lever that drives
   * failures at speed.
   *
   * Chrome removed `Emulation.setPageVisibilityOverride`, so the state is
   * overridden and the event dispatched, which is exactly what the browser does
   * on a tab switch. The app's own handler is what turns this into a poll, so a
   * test that drives failures this way is also continuously asserting that the
   * re-check exists: an implementation that only counted timers would never
   * reach the threshold here and every dimming test would fail.
   */
  async function backgroundAndReturn(page: Page): Promise<void> {
    await page.evaluate(() => {
      const set = (v: string) =>
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      set('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      set('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  /** Drive `n` consecutive failed polls, one per return-to-tab. */
  async function failPolls(page: Page, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await backgroundAndReturn(page);
      // Let the poll settle before provoking the next one, so `n` returns
      // produce `n` failures rather than a pile of overlapping fetches.
      await page.waitForTimeout(120);
    }
  }

  /**
   * Open a tab with a switch that makes its endpoints fail, succeed, or answer
   * BADLY.
   *
   * Three modes rather than two, because the third is a distinct claim: a
   * server returning HTTP 500 is alive and speaking, and an overlay saying *no
   * contact* about it would be plainly wrong — with a restart hint that fixes
   * nothing.
   */
  type Mode = 'ok' | 'dead' | 'http500' | 'garbage';
  async function open(
    tab: 'board' | 'agents',
    payload: Fleet = fleet(),
  ): Promise<{ page: Page; set: (m: Mode) => void }> {
    let mode: Mode = 'ok';
    const page = await browser.newPage();
    const answer = (route: Parameters<Parameters<Page['route']>[1]>[0], body: string) => {
      if (mode === 'dead') return route.abort('connectionrefused');
      if (mode === 'http500') {
        return route.fulfill({
          status: 500, contentType: 'application/json',
          body: JSON.stringify({ error: 'plot-plan-meta.sh exited 1' }),
        });
      }
      if (mode === 'garbage') {
        return route.fulfill({ contentType: 'application/json', body: '{ not json at all' });
      }
      return route.fulfill({ contentType: 'application/json', body });
    };
    await page.route('**/api/fleet', (route) => answer(route, JSON.stringify(payload)));
    await page.route('**/api/board', async (route) => {
      if (mode === 'ok') return route.fallback();
      return answer(route, '');
    });
    await page.goto(tab === 'agents' ? `${baseURL}?tab=agents` : baseURL);
    // Wait for real content, so there is a payload to degrade FROM.
    if (tab === 'agents') await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    else await page.getByText('Deal with the zucchini glut').waitFor({ timeout: 10_000 });
    // The Agents tab needs the board's cards too — that is where Start work
    // and the restart command come from.
    if (tab === 'agents') {
      await page.getByRole('button', { name: 'Board' }).click();
      await page.getByText('Deal with the zucchini glut').waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Agents' }).click();
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    }
    return { page, set: (m: Mode) => { mode = m; } };
  }

  // ── A short silence dims nothing ──────────────────────────────────────────

  it('leaves the page fully operable after ONE failed poll — banner only', async () => {
    // The assertion a threshold-free implementation fails, and the reason the
    // threshold exists at all: `pnpm board` runs under `node --watch`, so an
    // ordinary edit restarts the server and the tab loses contact several times
    // an hour. Dimming for that would be a strobe, and it would teach the
    // reader to ignore the dimming.
    const { page, set } = await open('agents');
    try {
      set('dead');
      await failPolls(page, 1);
      expect(await overlay(page).count()).toBe(0);
      expect(await scrim(page).count()).toBe(0);
      // The banner IS there: the page says the numbers are old from the first
      // failure. Only the posture waits.
      await page.getByText(/Not reaching the board server/).waitFor({ timeout: 10_000 });
    } finally {
      await page.close();
    }
  });

  it('still dims nothing one poll short of the threshold', async () => {
    // The off-by-one, asserted from the other side. An implementation that
    // dimmed at 7 (or at 1) passes the single-failure test above only by
    // accident of where the line was drawn.
    const { page, set } = await open('agents');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES - 1);
      expect(await overlay(page).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── A sustained silence dims AND blocks ───────────────────────────────────

  it('dims and blocks after a sustained silence — both halves', async () => {
    // Both, deliberately: the visual state alone would pass on an overlay that
    // draws a scrim nothing actually stops.
    const { page, set } = await open('agents');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });

      // The action control cannot be activated. Asserted as `aria-disabled`
      // AND as a refused click — the attribute is a claim, the click is whether
      // it is true.
      const button = startButton(page).first();
      await expect.poll(() => button.count()).toBe(1);
      expect(await button.getAttribute('aria-disabled')).toBe('true');

      // The scrim covers the board, so a pointer cannot reach the control
      // underneath it at all. `force: false` is the point: Playwright refuses a
      // click that would land on another element, which is exactly what a real
      // pointer does.
      const blocked = await button
        .click({ timeout: 1_500, trial: true })
        .then(() => false)
        .catch(() => true);
      expect(blocked).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('keeps the rows readable underneath — degrade, do not hide', async () => {
    // Hiding the payload would break the rule `board-tells-the-truth` settled.
    // A reader mid-triage still wants to see which branch was where, even
    // knowing the figures are minutes old.
    const { page, set } = await open('agents');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });

      const branch = page.getByText('feature/beans-a', { exact: true });
      expect(await branch.count()).toBe(1);
      // Present is not the same as legible: a payload dimmed to invisibility
      // would pass a count. The element must still have a rendered box.
      const box = await branch.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.height ?? 0).toBeGreaterThan(0);
      // And the text itself is not blanked or replaced.
      expect(await page.getByText('last commit 3 min ago').first().count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('keeps the overlay\'s OWN controls usable while the board\'s are not', async () => {
    // An overlay that blocks the way out is a dead end with a lock on it. The
    // restart command is the one thing on screen that still works.
    const { page, set } = await open('agents');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });

      const command = page.locator('[data-restart-command]');
      await expect.poll(() => command.count()).toBe(1);
      // Reachable by a real pointer — the assertion that separates "inside the
      // overlay" from "under the scrim like everything else".
      await command.click({ timeout: 2_000 });
      // And selectable: a command you cannot copy is a command you must retype.
      const selected = await page.evaluate(() => {
        const el = document.querySelector('[data-restart-command]') as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return sel?.toString() ?? '';
      });
      expect(selected).toContain('pnpm board');
    } finally {
      await page.close();
    }
  });

  it('leaves blocked actions VISIBLE and aria-disabled, with the layout unmoved', async () => {
    // Buttons that vanish make the layout jump twice — once when contact is
    // lost and again when it returns — and a page that rearranges itself while
    // frozen is worse than one that simply admits it is. Measured as a box,
    // before and after, because "still present" passes on a control that
    // collapsed to nothing.
    const { page, set } = await open('agents');
    try {
      const button = startButton(page).first();
      await expect.poll(() => button.count()).toBe(1);
      const before = await button.boundingBox();
      const offsetBefore = await button.evaluate((el) => {
        const row = el.closest('li') as HTMLElement;
        return el.getBoundingClientRect().top - row.getBoundingClientRect().top;
      });

      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });

      expect(await button.count()).toBe(1);
      const after = await button.boundingBox();
      // Same size and same horizontal position: the control did not vanish,
      // collapse, or get replaced by something of another shape.
      expect(after?.x).toBe(before?.x);
      expect(after?.width).toBe(before?.width);
      expect(after?.height).toBe(before?.height);
      // Its vertical position is measured RELATIVE TO ITS OWN ROW rather than
      // to the viewport, because the whole page does move down — the staleness
      // banner from `board-tells-the-truth` (#141) is inserted above the rows,
      // by design, from the first failed poll. That shift is the banner's and
      // predates this work; what this asserts is that nothing shifted WITHIN
      // the row, which is what a vanishing button would cause.
      const offsetInRow = async () =>
        button.evaluate((el) => {
          const row = el.closest('li') as HTMLElement;
          return el.getBoundingClientRect().top - row.getBoundingClientRect().top;
        });
      expect(await offsetInRow()).toBe(offsetBefore);
      // The reason travels with it, so a disabled control never reads as a bug.
      expect(await button.getAttribute('title')).toContain('not answering');
    } finally {
      await page.close();
    }
  });

  // ── Both tabs ─────────────────────────────────────────────────────────────

  it('dims the BOARD tab too — it only ever set an error string before', async () => {
    // The assertion an Agents-only implementation fails while passing every
    // other test in this file. Silence was measured for the Agents tab alone
    // (`if (tab !== 'agents') setFleetStaleSeconds(null)`), and the Board tab
    // answered the same outage by REPLACING its cards with a red message.
    const { page, set } = await open('board');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });
      expect(await scrim(page).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('keeps the Board tab\'s last cards rather than replacing them with red text', async () => {
    // The half of this wave that is a BEHAVIOUR CHANGE rather than an addition:
    // `App.tsx:383` discarded a payload the client still held. One outage must
    // not produce two different stories depending on which tab is in front.
    const { page, set } = await open('board');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });

      // The cards are still there, and still readable.
      const card = page.getByText('Deal with the zucchini glut');
      expect(await card.count()).toBe(1);
      expect((await card.boundingBox())?.height ?? 0).toBeGreaterThan(0);
      // And the old whole-view replacement is gone.
      expect(await page.getByText(/^Failed to load board:/).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('dims both tabs after the SAME number of failures, despite the 7.5x rate gap', async () => {
    // The assertion a seconds-based threshold fails. `POLL_MS` is 30 s and
    // `FLEET_POLL_MS` is 4 s, so one seconds-count would mean seven and a half
    // missed polls on one tab and a single one on the other — dimming on the
    // first hiccup in one place and only after a real outage in the other.
    //
    // Driven identically on both, and the count is what is held equal.
    for (const tab of ['board', 'agents'] as const) {
      const { page, set } = await open(tab);
      try {
        set('dead');
        await failPolls(page, DIM_AFTER_FAILURES - 1);
        expect(await overlay(page).count(), `${tab} dimmed early`).toBe(0);
        await failPolls(page, 1);
        await overlay(page).waitFor({ timeout: 10_000 });
      } finally {
        await page.close();
      }
    }
  });

  // ── A server that answers badly does not dim ──────────────────────────────

  it('does NOT dim on HTTP 500 — the server is alive and speaking', async () => {
    // The overlay would claim *no contact* about a server that is talking, and
    // its restart hint would be the wrong advice: `pnpm board` does not fix a
    // 500. The existing error path keeps that case.
    const { page, set } = await open('board');
    try {
      set('http500');
      await failPolls(page, DIM_AFTER_FAILURES * 2);
      expect(await overlay(page).count()).toBe(0);
      expect(await scrim(page).count()).toBe(0);
      // And it says something — the failure is reported, just not as silence.
      await page.getByText(/Last board refresh failed/).waitFor({ timeout: 10_000 });
      // The cards survive that too.
      expect(await page.getByText('Deal with the zucchini glut').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('does NOT dim on malformed JSON — also an answer', async () => {
    const { page, set } = await open('board');
    try {
      set('garbage');
      await failPolls(page, DIM_AFTER_FAILURES * 2);
      expect(await overlay(page).count()).toBe(0);
      expect(await page.getByText('Deal with the zucchini glut').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('does not let a bad answer accumulate toward the threshold', async () => {
    // A count that ticked on 500s would creep the page into an overlay telling
    // the reader to restart something already running. Seven bad answers then
    // one silence must not equal eight silences.
    const { page, set } = await open('board');
    try {
      set('http500');
      await failPolls(page, DIM_AFTER_FAILURES - 1);
      set('dead');
      await failPolls(page, 1);
      expect(await overlay(page).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('a good answer resets the count — silences must be CONSECUTIVE', async () => {
    // Otherwise a board left open all day would eventually dim from a
    // scattering of unrelated restarts.
    const { page, set } = await open('board');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES - 1);
      // The banner is the observable proof that failures were counted — and
      // waiting for it to CLEAR is what makes the recovery deterministic. A
      // fixed pause would race the real server's response and let the reset
      // land after the second run of failures had already begun, which is a
      // flake rather than a finding.
      await page.getByText(/Not reaching the board server/).waitFor({ timeout: 10_000 });
      set('ok');
      await backgroundAndReturn(page);
      await expect.poll(
        () => page.getByText(/Not reaching the board server/).count(),
        { timeout: 10_000 },
      ).toBe(0);

      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES - 1);
      expect(await overlay(page).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── Returning to a hidden tab re-checks ───────────────────────────────────

  it('issues a poll when a hidden tab becomes visible', async () => {
    // Browsers throttle hidden timers, so a minimised window would otherwise
    // come back holding a count assembled from however often it was allowed to
    // wake. Asserted by COUNTING requests across the transition: a timer-only
    // implementation shows an overlay for a server that recovered while the tab
    // was in the background.
    const { page } = await open('board');
    try {
      let requests = 0;
      page.on('request', (r) => { if (r.url().includes('/api/board')) requests += 1; });
      // Quiet window well inside the 30 s poll, so any request in it is the
      // visibility handler's rather than the interval's.
      await page.waitForTimeout(300);
      expect(requests).toBe(0);
      await backgroundAndReturn(page);
      await expect.poll(() => requests, { timeout: 5_000 }).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('clears the overlay when the tab returns to a server that recovered', async () => {
    // The whole point of re-checking rather than counting: nobody should stare
    // at a dim page for a server that came back two minutes ago.
    const { page, set } = await open('board');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });
      set('ok');
      await backgroundAndReturn(page);
      await expect.poll(() => overlay(page).count(), { timeout: 10_000 }).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── Recovery ──────────────────────────────────────────────────────────────

  it('recovers on the next successful poll, with no reload', async () => {
    // A dimming that needs dismissing is a dimming that outlives its cause.
    const { page, set } = await open('agents');
    try {
      const before = page.url();
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });
      set('ok');
      await expect.poll(() => overlay(page).count(), { timeout: 15_000 }).toBe(0);
      expect(await scrim(page).count()).toBe(0);
      expect(page.url()).toBe(before);
      // The control is live again — the block lifted with the overlay rather
      // than outliving it.
      await expect.poll(() => startButton(page).first().getAttribute('aria-disabled'))
        .toBe(null);
    } finally {
      await page.close();
    }
  });

  // ── The message names the state and the way out ───────────────────────────

  it('names the restart command, not merely the problem', async () => {
    // Asserted as TEXT rather than as the presence of an overlay: a message
    // without a way out is the failure this is meant to remove. This board is
    // left running for hours and reloaded rarely, and whoever finds it frozen
    // at midday may not remember how it was started.
    const { page, set } = await open('board');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });
      expect(await overlay(page).textContent()).toContain('pnpm board');
    } finally {
      await page.close();
    }
  });

  it('names the port this page was served from', async () => {
    // If the server comes back somewhere else the overlay correctly stays up: a
    // page can only ask its own origin. Naming the port lets the reader see
    // that rather than wondering why a running board still reads as gone.
    const { page, set } = await open('board');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });
      expect(await page.locator('[data-served-port]').textContent())
        .toBe(`localhost:${server.port}`);
    } finally {
      await page.close();
    }
  });

  it('takes the command from the PAYLOAD — a different value round-trips', async () => {
    // The assertion hardcoding passes without. `pnpm board` is THIS repo's
    // convention and Plot hardcodes no project conventions (Principle 5): an
    // adopting project that starts its board differently would otherwise be
    // handed advice that does not work.
    const page = await browser.newPage();
    try {
      let dead = false;
      await page.route('**/api/board', async (route) => {
        if (dead) return route.abort('connectionrefused');
        // Take the real payload and substitute only the server's self-report,
        // so everything else on the page is exactly as it would be.
        const res = await route.fetch();
        const body = await res.json();
        body.server = { restartCommand: 'make garden-board', port: 4242 };
        return route.fulfill({ response: res, json: body });
      });
      await page.goto(baseURL);
      await page.getByText('Deal with the zucchini glut').waitFor({ timeout: 10_000 });
      dead = true;
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });

      const text = (await overlay(page).textContent()) ?? '';
      expect(text).toContain('make garden-board');
      expect(text).toContain('localhost:4242');
      // And the repo's own default is nowhere near it.
      expect(text).not.toContain('pnpm board');
    } finally {
      await page.close();
    }
  });

  it('names no command at all when the server reports none', async () => {
    // A guessed command is worse than none in exactly the case this is for: a
    // reader ready to believe the one instruction on screen.
    const page = await browser.newPage();
    try {
      let dead = false;
      await page.route('**/api/board', async (route) => {
        if (dead) return route.abort('connectionrefused');
        const res = await route.fetch();
        const body = await res.json();
        body.server = { restartCommand: '', port: 4242 };
        return route.fulfill({ response: res, json: body });
      });
      await page.goto(baseURL);
      await page.getByText('Deal with the zucchini glut').waitFor({ timeout: 10_000 });
      dead = true;
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });

      expect(await page.locator('[data-restart-command]').count()).toBe(0);
      // The silence is still stated — the overlay degrades rather than vanishes.
      expect(await overlay(page).textContent()).toContain('No contact');
    } finally {
      await page.close();
    }
  });

  // ── Announced, not merely drawn ───────────────────────────────────────────

  it('announces the state to assistive technology', async () => {
    // A visual dim tells a screen reader nothing at all. `alert` + assertive is
    // the right register: the statement is that the controls the reader is
    // about to use have stopped working.
    const { page, set } = await open('board');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      const box = overlay(page);
      await box.waitFor({ timeout: 10_000 });
      expect(await box.getAttribute('role')).toBe('alert');
      expect(await box.getAttribute('aria-live')).toBe('assertive');
      // The scrim is decoration and says nothing: announcing an empty box
      // beside the message would be noise.
      expect(await scrim(page).getAttribute('aria-hidden')).toBe('true');
    } finally {
      await page.close();
    }
  });

  it('gives a screen reader the REASON a blocked control will not act', async () => {
    // `aria-disabled` says *this will not work*; on its own it does not say
    // why, and `title` is read inconsistently and never shown on touch.
    const { page, set } = await open('agents');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });
      const name = await startButton(page).first().textContent();
      expect(name).toContain('not answering');
    } finally {
      await page.close();
    }
  });

  // ── An already-open modal is a layer above the board ──────────────────────

  it('leaves an already-open plan modal usable', async () => {
    // A modal is a layer above the board rather than part of it, and its own
    // content route has its own error path. Blocking it would take away a
    // document the reader already has open.
    const { page, set } = await open('board');
    try {
      // `Open` is the card's modal trigger — an anchor, so cmd-click still
      // opens the plan natively and only a plain click is intercepted.
      await page.getByRole('link', { name: 'Open' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });

      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });

      // Still open, and its own Close still reachable by a real pointer.
      expect(await dialog.count()).toBe(1);
      const close = dialog.getByRole('button', { name: /close/i }).first();
      await close.click({ timeout: 5_000 });
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('blocks opening a NEW plan modal — that is board interaction', async () => {
    const { page, set } = await open('board');
    try {
      set('dead');
      await failPolls(page, DIM_AFTER_FAILURES);
      await overlay(page).waitFor({ timeout: 10_000 });

      const card = page.getByRole('link', { name: 'Open' }).first();
      const blocked = await card
        .click({ timeout: 1_500, trial: true })
        .then(() => false)
        .catch(() => true);
      expect(blocked).toBe(true);
      expect(await page.getByRole('dialog').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── Nothing to dim ────────────────────────────────────────────────────────

  it('never dims a tab whose first poll failed — it has no payload to freeze', async () => {
    // Never-had-an-answer is a different statement from no-longer-trusted, and
    // dimming an empty page would claim data it never held. The same
    // distinction the staleness banner already draws.
    const page = await browser.newPage();
    try {
      await page.route('**/api/board', (route) => route.abort('connectionrefused'));
      await page.goto(baseURL);
      // With nothing ever received there is nothing to degrade TO, so the
      // whole-view error is the right answer here and stays the right answer —
      // it is the one case that branch still owns after this change.
      await page.getByText(/Failed to load board/).waitFor({ timeout: 10_000 });
      await failPolls(page, DIM_AFTER_FAILURES * 2);
      expect(await overlay(page).count()).toBe(0);
      expect(await scrim(page).count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
