import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { startServer } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import {
  BOARD_ARTIFACT_PATH, type AgentRow, type Fleet, type Stuck,
} from '../../src/contract/schema.js';

/**
 * WHAT A STUCK BRANCH SAYS IN ITS ROW — in a real browser, against the shipped
 * artifact.
 *
 * The unit suite (`test/unit/stuck-display.test.ts`) owns the decision: which
 * word, which evidence, whether an action is offered, whether the cue shows.
 * This owns the half only a page can state — that the CUE is reachable without
 * opening the three-dot menu while the ACTION lives inside it, that
 * `motion-reduce` keeps the cue while stopping the animation, that the cue is
 * `aria-hidden` while the reason reaches the accessible name, that a stuck row
 * keeps its group, and that a healthy row is untouched.
 *
 * The action moved on 2026-08-18 (`one-place-for-what-a-row-can-do`): every act
 * a row offers is now in its menu, and the cue stayed behind in the row. The
 * assertions below were rewritten to that rule rather than deleted — the
 * concern the old ones carried, *a cue nobody finds is not a cue*, is still the
 * live one and is now carried by the cue itself.
 *
 * `/api/fleet` is stubbed at the network boundary, the way the sibling Agents
 * tab suite does it: every claim here is about what the tab RENDERS from a
 * pulse, and a synthetic pulse states the four stuck states exactly. The
 * server's half is pinned in `test/unit/stuck.test.ts` against the real
 * detector.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

const GH = 'https://github.com/tiny/garden/tree/';

const stuck = (over: Partial<Stuck> = {}): Stuck => ({
  state: 'conflict',
  conflicts: [],
  localAhead: 0,
  changedPaths: [],
  failingChecks: [],
  runHistory: [],
  ...over,
});

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  phase: 'Development', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, ...over,
});

/** One row per stuck state, plus a healthy one — the whole *Done when* list. */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    // A REAL conflict: needs judgement, so it offers an action and a cue.
    // In `waiting-on-you`, and it must STAY there.
    row({
      branch: 'feature/collides', group: 'waiting-on-you', note: 'PR #201 conflicts',
      pr: { number: 201, url: 'https://github.com/tiny/garden/pull/201', draft: false, state: 'conflicts' },
      branchUrl: `${GH}feature/collides`,
      stuck: stuck({ state: 'conflict', conflicts: ['packages/board/src/app/App.tsx', 'docs/plans/a.md'] }),
    }),
    // The artifact conflict: resolvable by wave 3, so it offers NOTHING here.
    row({
      branch: 'feature/artifact', group: 'waiting-on-you', note: 'PR #202 conflicts',
      branchUrl: `${GH}feature/artifact`,
      stuck: stuck({ state: 'artifact-conflict', conflicts: [BOARD_ARTIFACT_PATH] }),
    }),
    // A failing check: EVIDENCE, never a verdict. TWO lines in the row since
    // 2026-08-20 — the changed-file list moved into the menu — and the run
    // history is the one that decided the 2026-08-17 case: the same branch was
    // green two minutes earlier.
    row({
      branch: 'feature/red-ci', group: 'waiting-on-machine', note: 'PR #203 checks failing',
      branchUrl: `${GH}feature/red-ci`,
      stuck: stuck({
        state: 'ci-failing',
        failingChecks: ['Install Playwright browser'],
        changedPaths: ['docs/plans/a.md', 'packages/board/src/server/fleet.ts'],
        // ISO 8601, as a HOST ACTUALLY REPORTS IT. These read `'10:19'` until
        // 2026-08-20, which no host ever sends — and an unparseable stub is why
        // a browser test watching this row could not have caught the raw
        // `2026-08-20T03:55:23Z` that reached the screen on `#266`. A fixture
        // that cannot hold the defect cannot fail for it.
        runHistory: [
          { workflow: 'validate', conclusion: 'failure', startedAt: '2026-08-17T10:19:00Z', url: 'https://github.com/tiny/garden/actions/runs/2' },
          { workflow: 'validate', conclusion: 'success', startedAt: '2026-08-17T10:17:00Z', url: 'https://github.com/tiny/garden/actions/runs/1' },
        ],
      }),
    }),
    // Unpushed work: reported in WORDS. No cue, no action — pushing someone
    // else's judgement is not ours to do.
    row({
      branch: 'feature/local-only', group: 'quiet', note: 'no commit for 3 hours',
      branchUrl: `${GH}feature/local-only`,
      stuck: stuck({ state: 'unpushed', localAhead: 4 }),
    }),
    // The COMMON case: not stuck at all. This row must be exactly what it was
    // before this wave.
    row({ branch: 'feature/healthy', group: 'working', branchUrl: `${GH}feature/healthy` }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1,
    ready: true,
    error: null,
    rows,
    // WORKING renders from the registry since
    // `the-working-section-shows-every-worker`, so the healthy WORKING row
    // appears only where an agent names its branch.
    agents: rows
      .filter((r) => r.group === 'working')
      .map((r) => ({
        session: `s-${r.branch}`, branch: r.branch, worktree: `/wt/plot-wt-${r.branch}`,
        command: '', startedAt: '', pid: '', previousPid: '', relaunches: 0,
        state: 'running' as const,
      })),
    summary: {
      plans: 1, waves: 1, branches: rows.length,
      claimed: 0, eligible: 0, blocked: 0, deferred: 0,
    },
    prAgeSeconds: 10,
    prNextInSeconds: 50,
    scanNextInSeconds: 3,
    prError: null,
    ...over,
  } as Fleet;
}

describe('a stuck branch says so in its row', () => {
  // THE STATE IS SERVED, NOT SPAWNED AND STUBBED.
  //
  // This file started `board-server.mjs` over the tiny-garden fixture only to
  // serve `index.html`: it never read `/api/board`, and stubbed `/api/fleet`
  // itself. The mock serves the same built client and answers both payloads by
  // name, so the test states its own input instead of inheriting an estate.
  let cat: Catalogue;
  /**
   * A REAL BOARD BOUND TO 0.0.0.0, for the one test that needs a binding.
   *
   * Everything else here serves its own state. This cannot: the subject is what
   * the board does when it is reachable from the NETWORK rather than from this
   * machine — `sitting at this machine` stops being true, so the action is
   * refused while the cue stays. A mock has no binding to be non-local, so a
   * served state can express the payload and not the property.
   *
   * @see `shows the cue and refuses the action over a non-localhost binding`
   */
  let tailscale: { port: number; kill: () => void };
  let tailscaleURL: string;

  beforeAll(async () => {
    cat = await openCatalogue();
    // `0.0.0.0` is what the fleet user test uses to reach the board over
    // Tailscale, and it is deliberately NOT localhost. It still answers on
    // localhost, which is how this test reaches it.
    tailscale = await startServer(FIXTURE, { HOST: '0.0.0.0' });
    tailscaleURL = `http://localhost:${tailscale.port}/`;
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
    tailscale?.kill();
  });

  async function open(
    payload: Fleet = fleet(),
    opts: { reducedMotion?: boolean; url?: string } = {},
  ): Promise<Page> {
    // THE 0.0.0.0 SERVER IS GONE, and nothing asserted against it. A second
    // board was started bound to the network — the shape the fleet user test
    // reaches over Tailscale — and its URL was threaded through an `opts.url`
    // no caller ever passed. A binding nothing measures is a process this
    // suite paid for and never read.
    // A URL means the network-bound board: that test needs a binding, and the
    // mock has none. Every other caller takes the served state.
    if (opts.url) {
      const ctx = await cat.browser.newContext(
        opts.reducedMotion ? { reducedMotion: 'reduce' } : {},
      );
      const real = await ctx.newPage();
      await real.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
      await real.goto(`${opts.url}?tab=agents`);
      await real.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      await expandAgentFolds(real);
      return real;
    }
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: payload },
      ...(opts.reducedMotion ? { reducedMotion: 'reduce' as const } : {}),
    });
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  /** ONE agent row, by the branch it carries — see the sibling suite. */
  const rowFor = (page: Page, branch: string) =>
    // THE ROW THAT CARRIES THIS BRANCH, whatever KIND of row states it.
    //
    // A branch belonging to a wave renders as its WAVE since `a-wave-is-a-kind`,
    // so `li[data-agent-row]` alone matched nothing for any fixture row carrying
    // one — which is every row here, `wave: 'w'` being the default. Every
    // assertion in this file is about a branch's facts, and all of them survive
    // the move: the wave row is the row that branch now gets.
    page.locator('li').filter({ has: page.locator(`[data-branch="${branch}"]`) })
      .filter({ has: page.locator('[role="gridcell"]') }).last();

  /** Unfold a group that starts collapsed, so its rows can be read. */
  async function expand(page: Page, key: string) {
    const toggle = page.locator(`[data-group-toggle="${key}"]`);
    await toggle.waitFor({ timeout: 10_000 });
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  }

  // ── Each of the four states is visibly distinct, and named ────────────────

  it('names each of the four stuck states distinctly on its own row', async () => {
    // One label for all four is the defect: two conflicts and two unpushed
    // rebases are the same count and opposite errands.
    const page = await open();
    try {
      await expand(page, 'quiet');
      const states = await Promise.all([
        ['feature/collides', 'conflict'],
        ['feature/artifact', 'artifact-conflict'],
        ['feature/red-ci', 'ci-failing'],
        ['feature/local-only', 'unpushed'],
      ].map(async ([branch, expected]) => {
        const cell = rowFor(page, branch).locator('[data-stuck]');
        expect(await cell.count(), `${branch} rendered no stuck cell`).toBe(1);
        expect(await cell.getAttribute('data-stuck')).toBe(expected);
        return (await cell.innerText()).trim();
      }));
      // The WORDS differ too, not only the attribute — the attribute is for
      // this test, the word is for the reader.
      const words = states.map((t) => t.split('\n')[0]);
      expect(new Set(words).size).toBe(4);
    } finally {
      await page.close();
    }
  });

  // ── The evidence renders WITH the state ───────────────────────────────────

  it('shows a conflict its conflicting paths', async () => {
    // A row that says *stuck* without its evidence moves the ten minutes of
    // log-reading rather than removing it.
    const page = await open();
    try {
      const text = await rowFor(page, 'feature/collides').locator('[data-stuck]').innerText();
      expect(text).toContain('packages/board/src/app/App.tsx');
      expect(text).toContain('docs/plans/a.md');
    } finally {
      await page.close();
    }
  });

  it('shows a failing check its step and its run history — TWO lines', async () => {
    // Two, and the second is the one that ended the 2026-08-17 investigation:
    // the same branch was green two minutes earlier. The third line — the
    // changed-file list — moved into the menu on 2026-08-20; see the block
    // below for where it went and the assertions that it is no longer here.
    const page = await open();
    try {
      const cell = rowFor(page, 'feature/red-ci').locator('[data-stuck]');
      const text = await cell.innerText();
      expect(text).toContain('Install Playwright browser');
      expect(text).toContain('success');
      expect(text).toContain('failure');
      expect(await cell.locator('[data-stuck-evidence]').count()).toBe(2);
    } finally {
      await page.close();
    }
  });

  it('renders the run time as an age, never as the ISO string the host sent', async () => {
    // The measured defect: `#266` carried a raw `2026-08-20T03:55:23Z` in the
    // row, as prose, making the reader do date arithmetic to answer the only
    // question they had — *is this fresh*.
    //
    // Asserted on the PAGE and not only on `stuckEvidence`, because the row is
    // where the string was seen. The fixture's timestamps are years in the
    // past, so the age is some large number of days and its exact value is not
    // the point; that no ISO 8601 survives anywhere in the cell is.
    const page = await open();
    try {
      const text = await rowFor(page, 'feature/red-ci').locator('[data-stuck]').innerText();
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(text).not.toContain('Invalid Date');
      expect(text).toMatch(/ago/);
    } finally {
      await page.close();
    }
  });

  it('keeps the changed-file list OUT of the row and behind the menu', async () => {
    // BOTH HALVES, and the pairing is the point: the list did not disappear, it
    // stopped being printed. An implementation that merely deleted it would
    // pass the first assertion and lose a fact the contract says travels with
    // the state.
    const page = await open();
    try {
      const row = rowFor(page, 'feature/red-ci');
      // NOT in the row — six wrapped paths of prose was the reported defect.
      const text = await row.locator('[data-stuck]').innerText();
      expect(text).not.toContain('packages/board/src/server/fleet.ts');
      // The item COUNTS rather than lists, so the menu does not become the dump
      // one click away. Two paths in the fixture.
      await row.locator('[data-row-actions]').click();
      const item = row.locator('[data-changed-files-open]');
      expect(await item.count()).toBe(1);
      expect(await item.innerText()).toContain('2 files');
      // And the paths are THERE, in the panel it opens — reachable, which is
      // how EVIDENCE TRAVELS WITH THE STATE is honoured once the row stops
      // printing all of it.
      await item.click();
      const panel = page.locator('[data-changed-files]');
      await expect.poll(() => panel.count()).toBe(1);
      const body = await panel.locator('[data-changed-files-body]').innerText();
      expect(body).toContain('docs/plans/a.md');
      expect(body).toContain('packages/board/src/server/fleet.ts');
    } finally {
      await page.close();
    }
  });

  it('offers no changed-file item on a row whose failure is not a check', async () => {
    // `changedPaths` is `ci-failing` evidence. A conflict row's file set is its
    // `conflicts`, which the row already prints — an item here would open a
    // panel onto the empty list `noCiEvidence` gives it.
    const page = await open();
    try {
      const row = rowFor(page, 'feature/collides');
      await row.locator('[data-row-actions]').click();
      expect(await row.locator('[data-changed-files-open]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('shows unpushed work its commit count', async () => {
    const page = await open();
    try {
      await expand(page, 'quiet');
      expect(await rowFor(page, 'feature/local-only').locator('[data-stuck]').innerText())
        .toContain('4 commits');
    } finally {
      await page.close();
    }
  });

  // ── The CUE is on the row; the ACTION is in the menu ──────────────────────

  it('shows the cue WITHOUT opening the menu, and keeps the action inside it', async () => {
    // BOTH HALVES, and the pairing is the whole rule
    // (`one-place-for-what-a-row-can-do`): the row says what IS, the menu says
    // what you can DO.
    //
    // The old assertion here was the opposite — *offers the ACTION without
    // opening the menu* — on the reasoning that a row with a waiting action
    // looked identical to a row with none until you clicked it. That concern
    // was real and is unchanged; what changed is which mark answers it. The cue
    // is visible on the closed row, so the row still announces itself, and the
    // errand is one `⋯` away instead of inline.
    const page = await open();
    try {
      const row = rowFor(page, 'feature/red-ci');
      // The menu is CLOSED — nothing has been clicked.
      expect(await row.locator('[data-row-actions][aria-expanded="true"]').count()).toBe(0);
      // THE CUE IS GONE, and with it the half this test used to open with. It
      // was a pinging amber dot saying *there is an action here* — removed on
      // 2026-08-22 because the row already says what is wrong in words and the
      // action is in the menu the second half of this test still pins.
      //
      // The ACTION is not in the row — it is behind the menu.
      expect(await row.locator('[data-stuck-link]').count()).toBe(0);
      await row.locator('[data-row-actions]').click();
      await expect.poll(() => row.locator('[data-stuck-link]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers the last run when the newest run is GREEN', async () => {
    // THE WIDENING, and the plan proposed it deliberately. The link used to
    // render only while `stuck.state === 'ci-failing'`, so the route to a run
    // existed exactly as long as the row was red — and the reported case is
    // precisely a row whose newest run has since passed.
    //
    // How far the widening reaches is bounded by the DATA, not by this
    // condition: `runHistory` is a field of `stuck`, so a branch that is green
    // in every sense carries no run history at all and offers nothing. That
    // limit belongs to what the server sends, and is recorded on `runUrl`.
    const green = fleet();
    green.rows = [
      row({
        branch: 'feature/green', group: 'working',
        branchUrl: `${GH}feature/green`,
        stuck: stuck({
          state: 'ci-failing',
          runHistory: [
            { workflow: 'validate', conclusion: 'success', startedAt: '10:19', url: 'https://github.com/tiny/garden/actions/runs/9' },
          ],
        }),
      }),
    ];
    // WORKING renders from the registry, so the new working row needs its agent
    // too — the rows were reassigned after `fleet()` derived the original set.
    green.agents = [{
      session: 's-feature/green', branch: 'feature/green', worktree: '/wt/plot-wt-green',
      command: '', startedAt: '', pid: '', previousPid: '', relaunches: 0, state: 'running',
    }];
    const page = await open(green);
    try {
      const r = rowFor(page, 'feature/green');
      await r.locator('[data-row-actions]').click();
      await expect.poll(() => r.locator('[data-stuck-link]').count()).toBe(1);
      // And the label does not promise a failure: the condition widened, so the
      // word `failing` went with it.
      expect(await r.locator('[data-stuck-link]').innerText()).toMatch(/last run/i);
    } finally {
      await page.close();
    }
  });

  it('renders NO menu button on a row with nothing to do', async () => {
    // A `⋯` that opens nothing is a control that lies, and it was measured
    // lying on two of six WAITING ON YOU rows. The row already says what it is;
    // an absent control claims nothing.
    const page = await open();
    try {
      await expand(page, 'quiet');
      // `feature/local-only` is unpushed: no run, no dispatchable conflict, not
      // startable, not approvable. Nothing to offer, so no button.
      const r = rowFor(page, 'feature/local-only');
      expect(await r.locator('[data-row-actions]').count()).toBe(0);
      // The row is still a row, and still says what is wrong.
      expect(await r.locator('[data-branch]').count()).toBe(1);
      expect(await r.locator('[data-stuck]').innerText()).toMatch(/unpushed/i);
    } finally {
      await page.close();
    }
  });

  it('gives unpushed work no cue and no action, only words', async () => {
    // The fix is a push, and pushing someone else's work is not ours.
    const page = await open();
    try {
      await expand(page, 'quiet');
      const row = rowFor(page, 'feature/local-only');
      // No action anywhere — and since the actions moved, that means no menu
      // BUTTON at all rather than a dimmed one that opens nothing.
      expect(await row.locator('[data-row-actions]').count()).toBe(0);
      expect(await row.locator('[data-stuck-link]').count()).toBe(0);
      expect(await row.locator('[data-stuck-cue]').count()).toBe(0);
      // But it DOES say what is wrong.
      expect(await row.locator('[data-stuck]').innerText()).toMatch(/unpushed/i);
    } finally {
      await page.close();
    }
  });

  it('gives an artifact conflict no action in this wave', async () => {
    // Wave 3 resolves it. Until then it is reported like any other state.
    const page = await open();
    try {
      const row = rowFor(page, 'feature/artifact');
      expect(await row.locator('[data-stuck-link]').count()).toBe(0);
      expect(await row.locator('[data-stuck-cue]').count()).toBe(0);
      expect(await row.locator('[data-stuck]').innerText()).toContain(BOARD_ARTIFACT_PATH);
    } finally {
      await page.close();
    }
  });

  // ── The cue: motion, reduced motion, and the accessible name ──────────────

  // ── Over a non-localhost binding ──────────────────────────────────────────

  it('shows the cue and refuses the action over a non-localhost binding', async () => {
    // BOTH HALVES. The information is true everywhere, so hiding the cue would
    // let a phone report a healthy fleet while branches sit stuck — a worse lie
    // than an action you cannot take from where you are.
    const page = await open(fleet(), { url: tailscaleURL });
    try {
      // The board's own payload must confirm the binding actually refuses,
      // rather than this test asserting against a server that would have acted.
      const dispatch = await page.evaluate(async () => {
        const res = await fetch('/api/board');
        return (await res.json()).dispatch as { available: boolean; reason: string };
      });
      expect(dispatch.available).toBe(false);
      expect(dispatch.reason).not.toBe('');

      const row = rowFor(page, 'feature/collides');
      // A REFUSAL IS NOT AN ABSENCE. This row's menu is present AND enabled —
      // `the-menu-fits-the-kind` added Open, which is navigation to the branch on
      // the host and reads the same over Tailscale as at the machine, so the menu
      // opens from anywhere. What the binding refuses is the CONFLICT dispatch,
      // and that refusal moved one level in: onto the Resolve-conflict item,
      // which stays reachable because a refusal names its reason on the control.
      const menu = row.locator('[data-row-actions]');
      expect(await menu.count()).toBe(1);
      // The menu button itself is no longer the carrier of the dispatch refusal
      // — Open is enabled — so it opens.
      await menu.click();
      // The conflict dispatch is the StartWorkButton inside the menu, refused
      // here and naming why. `aria-disabled`, never the native attribute — so it
      // keeps its place in the tab order and the reason stays reachable.
      const resolve = row.getByRole('button', { name: /Dispatch|Start work/i });
      await expect.poll(() => resolve.count()).toBeGreaterThan(0);
      expect(await resolve.first().getAttribute('aria-disabled')).toBe('true');
      const refusal = await resolve.first().getAttribute('title');
      expect(refusal ?? '').toMatch(/localhost|worktree|machine/i);
      expect(await resolve.first().evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false);
    } finally {
      await page.close();
    }
  });

  // ── A stuck branch keeps its group ────────────────────────────────────────

  it('leaves a stuck row in the group it belongs to', async () => {
    // The contract says so: a stuck branch KEEPS the group it belongs to and
    // gains this beside it. Whether a branch is stuck and where it is waiting
    // are independent questions — folding one into the other would put a
    // conflicting PR and an unpushed rebase in the same place.
    const page = await open();
    try {
      await expand(page, 'quiet');
      const groupOf = async (branch: string) =>
        rowFor(page, branch).evaluate((el) =>
          el.closest('section')?.querySelector('h2')?.textContent ?? '');
      expect(await groupOf('feature/collides')).toMatch(/Waiting on you/);
      expect(await groupOf('feature/red-ci')).toMatch(/Waiting on a machine/);
      expect(await groupOf('feature/local-only')).toMatch(/Quiet/);
      // And no section was invented for them.
      const headings = await page.locator('section > h2').allInnerTexts();
      expect(headings.some((h) => /stuck/i.test(h))).toBe(false);
    } finally {
      await page.close();
    }
  });

  // ── The common case costs nothing ─────────────────────────────────────────

  it('renders a row with stuck: null exactly as before', async () => {
    // Most rows are not stuck, and this must cost them nothing. Asserted
    // against the marks the row already carried, not only against the absence
    // of the new one — a wave that added its cell to every row would still pass
    // "no stuck cell here" if it rendered an empty one.
    const page = await open();
    try {
      const healthy = rowFor(page, 'feature/healthy');
      expect(await healthy.locator('[data-stuck]').count()).toBe(0);
      expect(await healthy.locator('[data-stuck-cue]').count()).toBe(0);
      expect(await healthy.locator('[data-stuck-link]').count()).toBe(0);
      // The row is still a row: its branch and its note are intact.
      expect(await healthy.locator('[data-branch]').count()).toBe(1);
      // And its menu holds exactly ONE thing: its worker's log.
      //
      // The RULE here has not moved — a `⋯` that opens nothing is a control
      // that lies — but its premise has. This asserted `1` until 2026-08-18,
      // when the dimmed placeholder was withdrawn and a healthy row had nothing
      // to do; it asserts `1` again since `the-worker-log-is-readable`, because
      // this fixture's row is `group: 'working'` and a WORKING row IS an agent,
      // so there is now one thing to do with it: read what it is saying.
      //
      // Asserted as the log ITEM and not merely as the menu's presence, so a
      // future item appearing here has to be argued rather than absorbed.
      expect(await healthy.locator('[data-row-actions]').count()).toBe(1);
      await healthy.locator('[data-row-actions]').click();
      expect(await healthy.locator('[data-worker-log-open]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  // ── No mark is implemented by modifying another ───────────────────────────

});
