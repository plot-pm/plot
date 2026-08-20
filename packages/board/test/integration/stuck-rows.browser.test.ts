import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
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
  let server: { port: number; kill: () => void };
  /** The same board bound to 0.0.0.0 — reachable, and unable to dispatch. */
  let tailscale: { port: number; kill: () => void };
  let browser: Browser;
  let baseURL: string;
  let tailscaleURL: string;

  beforeAll(async () => {
    server = await startServer(FIXTURE);
    // `0.0.0.0` is what the fleet user test uses to reach the board over
    // Tailscale, and it is deliberately NOT localhost: reachable from the
    // network, so *sitting at this machine* stops being true. It still answers
    // on localhost, which is how this test reaches it.
    tailscale = await startServer(FIXTURE, { HOST: '0.0.0.0' });
    baseURL = `http://localhost:${server.port}/`;
    tailscaleURL = `http://localhost:${tailscale.port}/`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.kill();
    tailscale?.kill();
  });

  async function open(
    payload: Fleet = fleet(),
    opts: { reducedMotion?: boolean; url?: string } = {},
  ): Promise<Page> {
    const context = opts.reducedMotion
      ? await browser.newContext({ reducedMotion: 'reduce' })
      : await browser.newContext();
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
    await page.goto(`${opts.url ?? baseURL}?tab=agents`);
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    return page;
  }

  /** ONE agent row, by the branch it carries — see the sibling suite. */
  const rowFor = (page: Page, branch: string) =>
    page.locator('li[data-agent-row]').filter({ has: page.locator(`[data-branch="${branch}"]`) });

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
      // The CUE is already there and visible: the row is findable at a glance.
      const cue = row.locator('[data-stuck-cue]');
      expect(await cue.count()).toBe(1);
      await expect.poll(() => cue.isVisible()).toBe(true);
      // And the ACTION is not in the row — it is behind the menu.
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

  it('reruns nothing on its own — the offered action REQUIRES a click', async () => {
    // The plan is explicit that a failing check is not rerun automatically, and
    // this wave adds no write path at all: rendering a stuck row must issue no
    // request beyond the reads the tab already makes. Recorded at the network
    // boundary rather than by spying inside the component, so what is asserted
    // is what the PAGE did.
    const posted: string[] = [];
    const page = await browser.newPage();
    page.on('request', (req) => {
      if (req.method() !== 'GET') posted.push(`${req.method()} ${req.url()}`);
    });
    try {
      await page.route('**/api/fleet', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
      // The stuck rows are on screen with their cues showing — the actions are
      // in their menus, unopened and therefore unrendered, which is if anything
      // a stronger form of the same claim.
      await expect.poll(() => page.locator('[data-stuck-cue]').count()).toBe(2);
      // …and nothing was asked of the server.
      expect(posted).toEqual([]);
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

  it('animates the cue on a row with a waiting action', async () => {
    const page = await open();
    try {
      const cue = rowFor(page, 'feature/red-ci').locator('[data-stuck-cue]');
      expect(await cue.count()).toBe(1);
      // The COMPUTED animation, not the class name: a class that Tailwind never
      // emitted would pass a class-name assertion and move nothing.
      const name = await cue.evaluate((el) => getComputedStyle(el).animationName);
      expect(name).not.toBe('none');
    } finally {
      await page.close();
    }
  });

  it('keeps the cue under motion-reduce and stops only the animation', async () => {
    // BOTH HALVES. Hiding the element under reduced motion passes a
    // motion-only assertion and takes the MARKER along with the movement.
    const page = await open(fleet(), { reducedMotion: true });
    try {
      const cue = rowFor(page, 'feature/red-ci').locator('[data-stuck-cue]');
      expect(await cue.count()).toBe(1);
      await expect.poll(() => cue.isVisible()).toBe(true);
      expect(await cue.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    } finally {
      await page.close();
    }
  });

  it('hides the cue from the accessibility tree and names the row in the reach of it', async () => {
    // Never motion alone and never colour alone. The animation is decoration
    // and says so; what a screen reader gets instead is the row's own words —
    // the stuck WORD and its evidence in the cell, and a menu whose items name
    // the branch they act on.
    const page = await open();
    try {
      const row = rowFor(page, 'feature/red-ci');
      expect(await row.locator('[data-stuck-cue]').getAttribute('aria-hidden')).toBe('true');
      // The STATE reaches the reader through the CELL, which is where it now
      // lives — it used to ride on the link's accessible name, and the link's
      // condition has since widened past the state (a green row offers the same
      // item), so the name could no longer carry it truthfully.
      expect(await row.locator('[data-stuck]').innerText()).toMatch(/CI failed/i);
      // THE BRANCH STAYS IN THE ITEM'S NAME. The menu is already scoped to one
      // row, so this reads as redundant from inside it — but a menu item is
      // announced without its opener, and nothing else in the item says which
      // of a dozen rows this run belongs to. Redundant context costs a few
      // words; missing context costs the click.
      await row.locator('[data-row-actions]').click();
      const link = row.locator('[data-stuck-link]');
      await expect.poll(() => link.count()).toBe(1);
      expect(await link.getAttribute('aria-label')).toContain('feature/red-ci');
    } finally {
      await page.close();
    }
  });

  it('clears the cue when the action is TAKEN, not when the branch unsticks', async () => {
    // The request has been answered. Whether the answer worked is what the
    // row's other marks report — and the pulse keeps saying `ci-failing`
    // throughout, which is exactly the point: nothing about the BRANCH changed.
    const page = await open();
    try {
      const row = rowFor(page, 'feature/red-ci');
      expect(await row.locator('[data-stuck-cue]').count()).toBe(1);
      // The action is in the menu now, so answering the request means opening
      // it first — and the cue must survive that, because opening a menu is not
      // answering anything.
      await row.locator('[data-row-actions]').click();
      expect(await row.locator('[data-stuck-cue]').count()).toBe(1);
      // The link opens a new tab; the click is what matters, so the popup is
      // simply allowed to open and closed with the context at the end.
      await row.locator('[data-stuck-link]').click({ modifiers: ['Alt'] });
      await expect.poll(() => row.locator('[data-stuck-cue]').count()).toBe(0);
      // Still stuck, and still saying so — only the request was answered.
      expect(await row.locator('[data-stuck]').getAttribute('data-stuck')).toBe('ci-failing');
    } finally {
      await page.close();
    }
  });

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
      // The cue SHOWS: something is stuck and waiting, and that is true here.
      await expect.poll(() => row.locator('[data-stuck-cue]').count()).toBe(1);
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

  it('leaves the live dot, the change mark and the activity mark alone', async () => {
    // #180 ships the precedent — *leaves the LIVE DOT alone: two marks, two
    // meanings* — and no mark may be implemented by modifying another. A stuck
    // WORKING row must still carry its dot, and its activity mark must answer
    // to the local signals and to WORKING membership rather than to stuckness.
    const page = await open(fleet({
      rows: fleet().rows.map((r) =>
        r.branch === 'feature/healthy'
          ? { ...r, localDirty: true }
          : r.branch === 'feature/collides'
            ? { ...r, group: 'working' as const }
            : r),
    }));
    try {
      // The live dot belongs to WORKING membership, stuck or not.
      expect(await rowFor(page, 'feature/collides').locator('[data-live-dot]').count()).toBe(1);
      expect(await rowFor(page, 'feature/healthy').locator('[data-live-dot]').count()).toBe(1);
      // The activity mark answers to the LOCAL SIGNALS and to WORKING
      // membership — never to stuckness. Both rows carry one here, and the
      // claim is that they carry DIFFERENT ones: `feature/healthy` reports
      // `localDirty` and travels fast; `feature/collides` is in WORKING with
      // neither signal — claimed, unobserved — and travels slow.
      //
      // The pairing that matters for THIS suite: a stuck row's mark must not be
      // decided by its stuckness. `feature/collides` is the stuck one, and its
      // pace is the one a row with the same signals and no conflict would get.
      const paceOf = (branch: string) =>
        rowFor(page, branch).locator('[data-activity-mark]').getAttribute('data-activity-pace');
      expect(await rowFor(page, 'feature/healthy').locator('[data-activity-mark]').count()).toBe(1);
      expect(await rowFor(page, 'feature/collides').locator('[data-activity-mark]').count()).toBe(1);
      expect(await paceOf('feature/healthy')).toBe('fast');
      expect(await paceOf('feature/collides')).toBe('slow');
      // And nothing here lights a change mark: the first pulse marks nothing.
      expect(await page.locator('[data-change-mark]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
