import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import type { AgentRow, Fleet, Stuck } from '../../src/contract/schema.js';

/**
 * THE ACTIVITY MARK'S APPEARANCE — the half only a real page can settle.
 *
 * The predicate behind the mark (`isActive`, the lock echo, `activeRowKeys`) was
 * settled in the wave before this one and is pinned in
 * `test/unit/agent-list.test.ts`. The mark's class list — no `animate-*`, an
 * emerald `shadow-[…]`, a bar rather than a dot — is pinned there too, read out
 * of the source. Neither can answer what is here:
 *
 * - that the glow is a *computed* `box-shadow` and not a class Tailwind never
 *   emitted, which a class-name assertion cannot tell apart;
 * - that `prefers-reduced-motion` leaves the mark AND its glow intact — the
 *   glow is the carrier the unpushed mark will be distinguished against, so a
 *   reduced-motion rule that stripped it would take that distinction with it;
 * - that the six grid tracks do not move to make room for it, which is geometry;
 * - that four marks can hold on one row at once and stay four distinct
 *   elements, which needs them rendered together.
 *
 * `/api/fleet` is stubbed at the network boundary, the way the sibling suites do
 * it: every claim here is about what the tab RENDERS from a pulse, and a
 * synthetic pulse states the combinations exactly.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row =(over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  phase: 'Development', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, repair: null, ...over,
});

const fleet = (rows: AgentRow[]): Fleet => ({
  generatedAt: new Date().toISOString(),
  ageSeconds: 1, ready: true, error: null, rows,
  summary: {
    plans: 1, waves: 1, branches: rows.length,
    claimed: 0, eligible: 0, blocked: 0, deferred: 0,
  },
  prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
} as Fleet);

/**
 * Two rows differing ONLY in whether a write is in progress.
 *
 * The pair is what makes the track assertion mean anything: a mark that pushed
 * the columns in would move them on the marked row and not on the other, and a
 * single row cannot state that.
 */
const PAIR = [
  row({ branch: 'feature/writing', localDirty: true, branchUrl: `${GH}feature/writing` }),
  row({ branch: 'feature/idle', branchUrl: `${GH}feature/idle` }),
];

describe('the activity mark glows, and does not move', () => {
  let browser: Browser;
  let server: { kill: () => void; port: number };
  let baseURL: string;
  const contexts: BrowserContext[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
  }, 60_000);

  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    server?.kill();
  });

  /**
   * The Agents tab at a desktop width, optionally for a reader who asked for
   * reduced motion.
   *
   * A separate CONTEXT rather than `page.emulateMedia` on an open page: the
   * preference is a property of the environment the reader arrives with, and
   * emulating it after first paint tests a transition nobody performs. The same
   * reasoning the Agents tab suite documents for its own helper.
   *
   * 1400px because the marks hang in the row's left padding via `sm:absolute`;
   * below `sm` the row becomes a card and they flow inline, which is a different
   * layout and not the one under test here.
   */
  async function open(
    rows: AgentRow[] = PAIR,
    opts: { reducedMotion?: 'reduce' } = {},
  ): Promise<Page> {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      ...(opts.reducedMotion ? { reducedMotion: opts.reducedMotion } : {}),
    });
    contexts.push(context);
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet(rows)) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    return page;
  }

  const rowFor = (page: Page, branch: string) =>
    page.locator('li[data-agent-row]').filter({ has: page.locator(`[data-branch="${branch}"]`) });

  const markIn = (page: Page, branch: string) =>
    rowFor(page, branch).locator('[data-activity-mark]');

  /** What the browser actually resolved — never the class list. */
  const styleOf = (page: Page, branch: string) =>
    markIn(page, branch).evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        animationName: s.animationName,
        boxShadow: s.boxShadow,
        backgroundColor: s.backgroundColor,
        opacity: Number(s.opacity),
        visibility: s.visibility,
      };
    });

  // ── The glow ──────────────────────────────────────────────────────────────

  it('renders the mark on the writing row and NOT on the idle one', async () => {
    // The floor everything below stands on. An assertion about a glow on an
    // element that renders everywhere would pass while saying nothing.
    const page = await open();
    await expect.poll(() => markIn(page, 'feature/writing').count()).toBe(1);
    expect(await markIn(page, 'feature/idle').count()).toBe(0);
  });

  it('carries a real, computed glow — not a class Tailwind never emitted', async () => {
    // The reason this test is in a browser at all. `shadow-[…]` with an
    // arbitrary value is emitted only if Tailwind saw the literal string in the
    // source; a typo produces no rule, and the class-name assertion in the unit
    // suite would still pass. The COMPUTED shadow is the only proof.
    const page = await open();
    await expect.poll(() => markIn(page, 'feature/writing').count()).toBe(1);
    const seen = await styleOf(page, 'feature/writing');
    expect(seen.boxShadow).not.toBe('none');
    // And it is the mark's OWN colour rather than a neutral drop shadow: the
    // glow reads as light coming off the bar, which a grey blur does not.
    //
    // Asserted on the EMERALD layers rather than on the absence of black, and
    // the difference is not cosmetic: Tailwind v4 composes every `shadow-*`
    // out of five slots and fills the four unused ones (inset-shadow, ring,
    // inset-ring, and the base shadow) with `rgba(0, 0, 0, 0) 0px 0px 0px 0px`.
    // A `not.toMatch(/rgba\(0, 0, 0/)` therefore fails on a glow that is
    // perfectly correct — which is exactly what the first draft of this test
    // did. What matters is that emerald layers with a real blur radius are
    // present.
    expect(seen.boxShadow).toMatch(/rgba\(16,\s*185,\s*129,\s*0\.9\)\s+0px\s+0px\s+4px/);
    expect(seen.boxShadow).toMatch(/rgba\(16,\s*185,\s*129,\s*0\.5\)\s+0px\s+0px\s+10px/);
    // The layers that carry no colour carry no size either, so none of them is
    // a grey drop shadow smuggled in beside the glow.
    for (const layer of seen.boxShadow.split(/,(?![^(]*\))/)) {
      if (/rgba\(0,\s*0,\s*0/.test(layer)) expect(layer).toMatch(/0px 0px 0px 0px/);
    }
  });

  it('does not animate — the row already carries four moving things', async () => {
    // THE constraint of this wave, stated against what the browser resolved.
    // Measured on the row as it stands: `[data-live-dot]` pulses,
    // `[data-change-mark]` pulses, `[data-stuck-cue]` pings. A fifth at a fifth
    // scale competes rather than adds, and a fact true for hours has less claim
    // on motion than one true for three seconds.
    const page = await open();
    await expect.poll(() => markIn(page, 'feature/writing').count()).toBe(1);
    const seen = await styleOf(page, 'feature/writing');
    expect(seen.animationName).toBe('none');
    // The pairing that matters, stated positively so this cannot pass by the
    // mark simply being absent: a mark that IS there, and still.
    expect(seen.opacity).toBe(1);
    expect(seen.visibility).toBe('visible');
  });

  it('keeps the mark AND its glow under prefers-reduced-motion', async () => {
    // Both halves, and the second one is this wave's own. Nothing animates, so
    // there is no movement for reduced motion to stop — what it must not do is
    // strip the GLOW. The glow is the channel that will separate this mark from
    // the unpushed one (*glow means someone is here*), so a reduced-motion rule
    // that removed it would take that distinction with it before it is built.
    const page = await open(PAIR, { reducedMotion: 'reduce' });
    await expect.poll(() => markIn(page, 'feature/writing').count()).toBe(1);
    const seen = await styleOf(page, 'feature/writing');
    expect(seen.animationName).toBe('none');
    expect(seen.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(seen.opacity).toBe(1);
    // The EMERALD layers specifically, not merely "a box-shadow" — and the
    // difference is the whole assertion. `motion-reduce:shadow-none` does not
    // compute to the string `none`: Tailwind v4 resolves it to the same five
    // slots with every one transparent, so `boxShadow !== 'none'` passes on a
    // mark whose glow has just been stripped. Measured by mutating exactly that
    // — the weaker form let it through and only the equality test below caught
    // it.
    expect(seen.boxShadow).toMatch(/rgba\(16,\s*185,\s*129,\s*0\.9\)\s+0px\s+0px\s+4px/);
    expect(seen.boxShadow).toMatch(/rgba\(16,\s*185,\s*129,\s*0\.5\)\s+0px\s+0px\s+10px/);
  });

  it('renders identically with and without reduced motion', async () => {
    // The strongest form of the rule above: nothing about this mark depends on
    // the preference, because nothing about it moves. Asserted as an equality
    // rather than two separate presence checks, which is what would catch a
    // `motion-reduce:` variant added later "for consistency" with the marks
    // that do animate.
    const normal = await open();
    await expect.poll(() => markIn(normal, 'feature/writing').count()).toBe(1);
    const reduced = await open(PAIR, { reducedMotion: 'reduce' });
    await expect.poll(() => markIn(reduced, 'feature/writing').count()).toBe(1);
    expect(await styleOf(reduced, 'feature/writing'))
      .toEqual(await styleOf(normal, 'feature/writing'));
  });

  // ── It costs the row nothing ──────────────────────────────────────────────

  it('leaves the six tracks exactly where they are', async () => {
    // The mark hangs in the row's left padding via `sm:absolute`, deliberately
    // outside the six grid tracks, so the columns do not move in from the edge
    // on every row in the fleet to reserve room for a mark most rows never
    // carry. Stated as the pair: the marked row's columns sit at the same x as
    // the unmarked one's.
    const page = await open();
    await expect.poll(() => markIn(page, 'feature/writing').count()).toBe(1);

    const xOf = async (branch: string, selector: string) =>
      (await rowFor(page, branch).locator(selector).first().boundingBox())!.x;

    for (const selector of ['[data-phase]', '[data-branch]']) {
      const writing = await xOf('feature/writing', selector);
      const idle = await xOf('feature/idle', selector);
      expect(Math.abs(writing - idle), `${selector} moved`).toBeLessThan(1);
    }
    // And the row really is on six tracks — otherwise the equality above could
    // hold for a layout that is not the grid this is about.
    const tracks = await rowFor(page, 'feature/writing')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(tracks.split(' ')).toHaveLength(6);
  });

  it('sits at the row\'s edge, clear of the live dot beside it', async () => {
    // A row in WORKING that is being written to carries BOTH, and they must
    // read as two marks rather than one thickened one. The mark is at `left-0`
    // and the dot at `left-1`, so their boxes never overlap.
    const page = await open([
      row({ branch: 'feature/both', localDirty: true, group: 'working', branchUrl: `${GH}feature/both` }),
    ]);
    await expect.poll(() => markIn(page, 'feature/both').count()).toBe(1);
    const li = rowFor(page, 'feature/both');
    expect(await li.locator('[data-live-dot]').count()).toBe(1);
    const mark = (await markIn(page, 'feature/both').boundingBox())!;
    const dot = (await li.locator('[data-live-dot]').boundingBox())!;
    // Two boxes, side by side, with the mark on the outside — and no overlap.
    expect(mark.x).toBeLessThan(dot.x);
    expect(mark.x + mark.width).toBeLessThanOrEqual(dot.x + 0.5);
    // A bar rather than a dot, in the geometry the browser resolved: taller
    // than it is wide, and taller than the dot it stands beside.
    expect(mark.height).toBeGreaterThan(mark.width);
    expect(mark.height).toBeGreaterThan(dot.height);
  });

  // ── Four marks, four meanings ─────────────────────────────────────────────

  it('leaves the live dot pulsing exactly as it was', async () => {
    // No mark implemented by modifying another — the standard
    // `[data-change-mark]` set when it shipped. The dot means *in the WORKING
    // group* and still pulses; this wave changed neither its channel nor its
    // motion, and the cheap way to make activity prominent is to repaint it.
    const page = await open([
      row({ branch: 'feature/live', group: 'working', branchUrl: `${GH}feature/live` }),
      row({
        branch: 'feature/writing', localDirty: true, group: 'working',
        branchUrl: `${GH}feature/writing`,
      }),
    ]);
    await expect.poll(() => markIn(page, 'feature/writing').count()).toBe(1);

    const dot = rowFor(page, 'feature/live').locator('[data-live-dot]');
    expect(await dot.count()).toBe(1);
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).not.toBe('none');
    // The unwritten row carries the dot and NOT the mark — the two are not the
    // same claim, and an implementation that made one a variant of the other
    // would show both here.
    expect(await markIn(page, 'feature/live').count()).toBe(0);
  });

  it('holds the mark and the live dot on ONE row, as distinct elements', async () => {
    // A row can be in WORKING and be written to this instant, and then it says
    // both. The failure this guards is a mark implemented by repainting
    // another: that would still show "a mark" and lose a meaning.
    //
    // The STUCK CUE is deliberately not in this pairing, and its absence is a
    // fixture limit rather than a claim: `showsCue` requires an action that is
    // actually reachable, which needs a dispatch card this fixture's synthetic
    // branches have none of — `stuck-row-alignment.browser.test.ts` documents
    // the same fallback. The cue's own channel (amber, `animate-ping`) is
    // pinned against the source in `test/unit/agent-list.test.ts`, and its
    // rendering is owned by `stuck-rows.browser.test.ts`.
    const page = await open([
      row({
        branch: 'feature/everything', localDirty: true, localLocked: true,
        group: 'working', branchUrl: `${GH}feature/everything`,
      }),
    ]);
    const li = rowFor(page, 'feature/everything');
    await expect.poll(() => li.locator('[data-activity-mark]').count()).toBe(1);
    expect(await li.locator('[data-live-dot]').count()).toBe(1);
    // Two ELEMENTS, not one node answering to both hooks.
    const distinct = await li.evaluate((el) => new Set(
      ['[data-activity-mark]', '[data-live-dot]']
        .map((s) => el.querySelector(s))).size);
    expect(distinct).toBe(2);
  });

  // ── What it says, and to whom ─────────────────────────────────────────────

  it('names its local-only limit, and says nothing to a screen reader', async () => {
    // Every signal behind the mark is local: an agent on another machine
    // produces no mark HERE, ever, and a reader who takes an unmarked row for
    // an idle one has been misled by a marker that was technically correct. The
    // `title` says so. `aria-hidden` because the row's note already carries the
    // fact in words, and a screen reader must not hear it twice.
    const page = await open();
    await expect.poll(() => markIn(page, 'feature/writing').count()).toBe(1);
    const mark = markIn(page, 'feature/writing');
    expect(await mark.getAttribute('title')).toBe('A write is in progress in this checkout');
    expect(await mark.getAttribute('aria-hidden')).toBe('true');
  });
});

/**
 * WHERE THE MARK SITS ON A ROW THAT GREW A SECOND LINE.
 *
 * Reported from the running board, and the third consequence of one change. The
 * mark used to centre itself on the whole row:
 *
 * ```
 * sm:absolute sm:left-0 sm:top-1/2 sm:-translate-y-1/2
 * ```
 *
 * resting on an assumption its own comment stated — *the row is `py-2` around
 * ONE line of `text-sm`* — under which centring on the row and centring on the
 * line are the same pixel. The stuck cell then landed as its own line beneath
 * the six columns, so a row carrying a status line is roughly twice as tall, and
 * `top-1/2` put the mark BETWEEN the two lines instead of beside the branch name
 * it belongs to.
 *
 * **The pairing that matters, and the reason this suite is in a browser:**
 * `top-1/2` looks correct on every single-line row and is wrong on exactly the
 * rows carrying the most information. A single-line assertion passes on the
 * defect; only a two-line row states it, and only a rendered page has heights.
 */
describe('the activity mark aligns to the row\'s first line', () => {
  let browser: Browser;
  let server: { kill: () => void; port: number };
  let baseURL: string;
  const contexts: BrowserContext[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
  }, 60_000);

  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    server?.kill();
  });

  const stuck = (over: Partial<Stuck> = {}): Stuck => ({
    state: 'conflict',
    conflicts: ['packages/board/src/app/App.tsx'],
    localAhead: 0,
    changedPaths: [],
    failingChecks: [],
    runHistory: [],
    ...over,
  });

  /**
   * One row on ONE line and one row on TWO, both being written to.
   *
   * The pair is the assertion: the mark must land beside the branch name on
   * both, which is a different pixel on each — and `top-1/2` lands on the right
   * one only for the first.
   */
  const ROWS = [
    row({
      branch: 'feature/one-line', localDirty: true,
      branchUrl: `${GH}feature/one-line`,
    }),
    row({
      branch: 'feature/two-lines', localDirty: true,
      // A stuck row renders its evidence on its own line beneath the six
      // columns, which is what makes this row tall. `group: 'waiting-on-you'`
      // is where such a row actually sits.
      group: 'waiting-on-you', stuck: stuck(),
      branchUrl: `${GH}feature/two-lines`,
    }),
  ];

  async function open(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    contexts.push(context);
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet(ROWS)) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    return page;
  }

  const rowFor = (page: Page, branch: string) =>
    page.locator('li[data-agent-row]').filter({ has: page.locator(`[data-branch="${branch}"]`) });

  const markIn = (page: Page, branch: string) =>
    rowFor(page, branch).locator('[data-activity-mark]');

  /** Vertical centre of a box, which is what "beside" means in pixels. */
  const midY = (box: { y: number; height: number }) => box.y + box.height / 2;

  it('renders a row that really is two lines tall, and one that is not', async () => {
    // The floor the alignment claims stand on. If the stuck row were NOT taller
    // than the plain one, every assertion below would hold on the defect too —
    // this fixture would be quietly testing nothing.
    const page = await open();
    await expect.poll(() => markIn(page, 'feature/two-lines').count()).toBe(1);
    expect(await rowFor(page, 'feature/two-lines').locator('[data-stuck]').count()).toBe(1);

    const tall = (await rowFor(page, 'feature/two-lines').boundingBox())!;
    const short = (await rowFor(page, 'feature/one-line').boundingBox())!;
    expect(tall.height).toBeGreaterThan(short.height * 1.5);
  });

  it('sits beside the BRANCH NAME on a row carrying a status line', async () => {
    // THE assertion of this fix, in the terms the report used: the mark marks
    // the branch, and the branch is on line one whatever else grows beneath it.
    const page = await open();
    await expect.poll(() => markIn(page, 'feature/two-lines').count()).toBe(1);

    const mark = (await markIn(page, 'feature/two-lines').boundingBox())!;
    const branch = (await rowFor(page, 'feature/two-lines')
      .locator('[data-branch]').first().boundingBox())!;

    // Within a few pixels of the branch name's own middle. A tolerance rather
    // than an equality: the bar is 20px against a 20px line box, and the text's
    // own box is a hair shorter than its line.
    expect(Math.abs(midY(mark) - midY(branch))).toBeLessThan(4);
  });

  it('does NOT sit between the two lines — the defect, stated directly', async () => {
    // The negative the tolerance above already implies, written out because it
    // is what was actually reported and what a future reader will search for.
    // Under `top-1/2` the mark's centre lands on the ROW's centre, which on a
    // two-line row is the gap between them.
    const page = await open();
    await expect.poll(() => markIn(page, 'feature/two-lines').count()).toBe(1);

    const mark = (await markIn(page, 'feature/two-lines').boundingBox())!;
    const li = (await rowFor(page, 'feature/two-lines').boundingBox())!;

    // Strictly in the row's TOP half, and by a real margin rather than by a
    // rounding error: the whole mark ends before the row's midpoint.
    expect(mark.y + mark.height).toBeLessThan(midY(li));
  });

  it('leaves a single-line row exactly where it was', async () => {
    // The half a fix can silently break: `top-2` and `top-1/2` agree on a row
    // that is `py-2` around one line, and the common case must not move. Stated
    // against the branch name on the SAME row rather than against a remembered
    // pixel, so it survives an unrelated padding change.
    const page = await open();
    await expect.poll(() => markIn(page, 'feature/one-line').count()).toBe(1);

    const mark = (await markIn(page, 'feature/one-line').boundingBox())!;
    const branch = (await rowFor(page, 'feature/one-line')
      .locator('[data-branch]').first().boundingBox())!;
    const li = (await rowFor(page, 'feature/one-line').boundingBox())!;

    expect(Math.abs(midY(mark) - midY(branch))).toBeLessThan(4);
    // And on THIS row that is still the row's centre, which is the sense in
    // which nothing moved.
    expect(Math.abs(midY(mark) - midY(li))).toBeLessThan(4);
  });

  it('keeps the live dot beside it on the row\'s first line too', async () => {
    // `LiveDot` centres on the row by the same `top-1/2` this mark just left,
    // so on a two-line WORKING row it has the same defect. NOT fixed here —
    // this wave owns one element — but pinned as a KNOWN difference so the next
    // reader finds it stated rather than discovering it from a screenshot. See
    // the report accompanying this branch.
    const page = await open();
    await expect.poll(() => markIn(page, 'feature/one-line').count()).toBe(1);
    const li = rowFor(page, 'feature/one-line');
    // On a single-line row the two agree, which is all this wave asserts.
    if (await li.locator('[data-live-dot]').count()) {
      const dot = (await li.locator('[data-live-dot]').boundingBox())!;
      const mark = (await markIn(page, 'feature/one-line').boundingBox())!;
      expect(Math.abs(midY(dot) - midY(mark))).toBeLessThan(4);
    }
  });
});
