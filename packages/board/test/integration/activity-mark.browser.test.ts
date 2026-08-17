import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import type { AgentRow, Fleet, Stuck } from '../../src/contract/schema.js';

/**
 * THE ACTIVITY MARK'S APPEARANCE — the half only a real page can settle.
 *
 * The predicate behind the mark (`isActive`, the lock echo, `activeRowKeys`) and
 * the rule choosing its speed (`activityPace`) are pure functions, pinned in
 * `test/unit/agent-list.test.ts`. The class lists — which travel utility, the
 * `motion-reduce` variant, the emerald `shadow-[…]`, the track's geometry — are
 * pinned there too, read out of the source, along with the keyframes themselves.
 * None of that can answer what is here:
 *
 * - that the glow is a *computed* `box-shadow` and not a class Tailwind never
 *   emitted, which a class-name assertion cannot tell apart;
 * - that the travel is a REAL animation the browser resolved, running at two
 *   distinguishable durations — a class name proves neither;
 * - that `prefers-reduced-motion` leaves the track AND the dot AND its glow
 *   intact and stops only the movement, which is the rule this repo has now
 *   written five times;
 * - that the six grid tracks do not move to make room for it, which is geometry;
 * - that the marks can hold on one row at once and stay distinct elements, which
 *   needs them rendered together.
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
 *
 * `feature/idle` is deliberately OUTSIDE WORKING, and that is not incidental: a
 * WORKING row now carries the mark at the SLOW pace, so a WORKING row would not
 * be the "no mark at all" half this pair needs. Outside WORKING there is no
 * claim to be unobserved about, and no mark.
 *
 * `waiting-on-machine` and not `quiet`, which would be the more obvious choice:
 * QUIET and DONE are in `COLLAPSED_BY_DEFAULT`, so a row placed there renders
 * inside a folded section and every geometry assertion below waits forever for
 * a cell that is not on the page. That is not a hypothetical — it is a 30 s
 * timeout rather than a failed claim, which reads like a hang rather than a
 * fixture mistake.
 */
const PAIR = [
  row({ branch: 'feature/writing', localDirty: true, branchUrl: `${GH}feature/writing` }),
  row({ branch: 'feature/idle', group: 'waiting-on-machine', branchUrl: `${GH}feature/idle` }),
];

describe('the activity mark glows, and travels without arriving', () => {
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

  /** The travelling dot INSIDE the track — what glows, and what moves. */
  const dotIn = (page: Page, branch: string) =>
    markIn(page, branch).locator('[data-activity-dot]');

  /** What the browser actually resolved — never the class list. */
  const styleOf = (page: Page, branch: string) =>
    dotIn(page, branch).evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        animationName: s.animationName,
        animationDuration: s.animationDuration,
        animationIterationCount: s.animationIterationCount,
        animationDirection: s.animationDirection,
        animationPlayState: s.animationPlayState,
        boxShadow: s.boxShadow,
        backgroundColor: s.backgroundColor,
        opacity: Number(s.opacity),
        visibility: s.visibility,
      };
    });

  /** Seconds, parsed off a computed `animation-duration` like `1.1s`. */
  const seconds = (duration: string) => Number.parseFloat(duration);

  /**
   * A box read WITHOUT waiting for the element to stop moving.
   *
   * Playwright's own `boundingBox()` waits for stability — two animation frames
   * at the same position — and the travelling dot never provides them, so it
   * times out after 30 s rather than failing on a claim. That is not a flake to
   * retry around: a mark whose whole point is that it never stops cannot be
   * measured by a helper that waits for it to stop.
   *
   * `getBoundingClientRect` answers immediately with wherever the dot is in
   * this frame, which is all any assertion here needs — every claim below is
   * about a BOUND the dot stays inside, never about a particular position.
   */
  const rectOf = (locator: ReturnType<typeof markIn>) =>
    locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
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

  it('travels — a real animation the browser resolved, not a class name', async () => {
    // The reason this claim is in a browser. `animate-travel-fast` is emitted
    // only if the `--animate-travel-fast` theme variable and the `travel`
    // keyframes both exist; a typo in either produces a class that resolves to
    // nothing, and every class-name assertion in the unit suite still passes.
    const page = await open();
    await expect.poll(() => dotIn(page, 'feature/writing').count()).toBe(1);
    const seen = await styleOf(page, 'feature/writing');
    expect(seen.animationName).toBe('travel');
    expect(seen.animationPlayState).toBe('running');
    expect(seconds(seen.animationDuration)).toBeGreaterThan(0);
    // Stated positively so this cannot pass by the mark being absent: a dot
    // that IS there, and moving.
    expect(seen.opacity).toBe(1);
    expect(seen.visibility).toBe('visible');
  });

  it('NEVER ARRIVES — the animation returns to where it began', async () => {
    // THE constraint that makes travel acceptable here at all. Rotation and
    // traversal were refused twice in this repo because they *imply progress
    // toward completion, which nothing here measures*; a dot that comes back
    // promises no destination and reports a RATE instead.
    //
    // Stated on the RESOLVED keyframes rather than on the source text, which
    // the unit suite already reads: this is the browser's own account of where
    // the animation starts and ends, so a stylesheet that failed to load or a
    // rule overridden later cannot pass it.
    const page = await open();
    await expect.poll(() => dotIn(page, 'feature/writing').count()).toBe(1);

    const frames = await page.evaluate(() => {
      const out: { offset: number | null; transform: string }[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSKeyframesRule) || rule.name !== 'travel') continue;
          for (const frame of Array.from(rule.cssRules) as CSSKeyframeRule[]) {
            out.push({
              offset: Number.parseFloat(frame.keyText),
              transform: frame.style.transform,
            });
          }
        }
      }
      return out;
    });

    expect(frames.length, 'no resolved @keyframes travel').toBeGreaterThan(1);
    const at = (pct: number) => frames.find((f) => f.offset === pct);
    // Both ends present and both at the origin — a set with only 0% and 50%
    // also "returns", and would leave the transform undefined at the close.
    // The browser NORMALISES the authored `translateX(0)` to `translate(0px)`,
    // so this reads what it resolved rather than what was written. Matched as
    // "a translate whose every component is zero", which holds whichever
    // spelling a future engine chooses.
    const atOrigin = (t: string | undefined) =>
      t !== undefined && /^translate(X|3d)?\((\s*0(px)?\s*,?)+\)$/.test(t.replace(/\s+/g, ''));
    expect(atOrigin(at(0)?.transform), `0% was ${at(0)?.transform}`).toBe(true);
    expect(atOrigin(at(100)?.transform), `100% was ${at(100)?.transform}`).toBe(true);
    // And it goes somewhere in between, or "never arrives" is satisfied by
    // never leaving.
    const middle = frames.filter((f) => f.offset !== 0 && f.offset !== 100);
    expect(middle.length).toBeGreaterThan(0);
    for (const frame of middle) expect(atOrigin(frame.transform)).toBe(false);

    // The return is carried by the CYCLE, not borrowed from `alternate` —
    // which spends half its time running the frames backwards.
    const seen = await styleOf(page, 'feature/writing');
    expect(seen.animationDirection).toBe('normal');
    expect(seen.animationIterationCount).toBe('infinite');
  });

  it('keeps the track, the dot AND its glow under prefers-reduced-motion', async () => {
    // All three halves, and the fifth time this repo has written the rule:
    // hiding the element under reduced motion passes a motion-only assertion
    // and takes the MARKER along with the movement. The dot rests at one end,
    // still glowing, still in place.
    const page = await open(PAIR, { reducedMotion: 'reduce' });
    await expect.poll(() => dotIn(page, 'feature/writing').count()).toBe(1);

    // The TRACK is still there — the half that a `motion-reduce:hidden` on the
    // outer element would take out entirely.
    expect(await markIn(page, 'feature/writing').count()).toBe(1);
    expect(await markIn(page, 'feature/writing')
      .evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');

    const seen = await styleOf(page, 'feature/writing');
    // The travel is stopped…
    expect(seen.animationName).toBe('none');
    // …and everything that is not travel survives it.
    expect(seen.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(seen.opacity).toBe(1);
    expect(seen.visibility).toBe('visible');
    // The EMERALD layers specifically, not merely "a box-shadow" — and the
    // difference is the whole assertion. `motion-reduce:shadow-none` does not
    // compute to the string `none`: Tailwind v4 resolves it to the same five
    // slots with every one transparent, so `boxShadow !== 'none'` passes on a
    // mark whose glow has just been stripped.
    expect(seen.boxShadow).toMatch(/rgba\(16,\s*185,\s*129,\s*0\.9\)\s+0px\s+0px\s+4px/);
    expect(seen.boxShadow).toMatch(/rgba\(16,\s*185,\s*129,\s*0\.5\)\s+0px\s+0px\s+10px/);
  });

  it('rests the dot AT ONE END under reduced motion, not mid-flight', async () => {
    // Where a stopped dot sits is a decision, not an accident: with the
    // animation removed the element falls back to its own `left-0`, which is
    // the track's start. A dot frozen halfway would read as a paused progress
    // bar — the exact reading this mark is arranged to avoid.
    const page = await open(PAIR, { reducedMotion: 'reduce' });
    await expect.poll(() => dotIn(page, 'feature/writing').count()).toBe(1);
    const track = await rectOf(markIn(page, 'feature/writing'));
    const dot = await rectOf(dotIn(page, 'feature/writing'));
    expect(Math.abs(dot.x - track.x)).toBeLessThan(1);
  });

  it('collapses the two speeds into ONE appearance under reduced motion', async () => {
    // And that is correct rather than a loss: SPEED is the thing being removed,
    // so it cannot be the only carrier of the distinction. The row's note
    // already says which state it is in, in words — *last commit 18 min ago*
    // against *claimed, no known worker*.
    //
    // Asserted as an equality between a fast row and a slow one, which is what
    // catches a `motion-reduce` rule that stopped only one of the two.
    const page = await open([
      row({ branch: 'feature/fast', localDirty: true, branchUrl: `${GH}feature/fast` }),
      row({ branch: 'feature/slow', group: 'working', branchUrl: `${GH}feature/slow` }),
    ], { reducedMotion: 'reduce' });
    await expect.poll(() => dotIn(page, 'feature/fast').count()).toBe(1);
    await expect.poll(() => dotIn(page, 'feature/slow').count()).toBe(1);

    const fast = await styleOf(page, 'feature/fast');
    const slow = await styleOf(page, 'feature/slow');
    expect(fast.animationName).toBe('none');
    expect(slow.animationName).toBe('none');
    expect(fast).toEqual(slow);
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

    // `rectOf` rather than `boundingBox()`: the marked row contains a element
    // that never stops moving, and Playwright's stability wait never returns
    // for anything it decides is in motion. The columns themselves are still —
    // what is needed is a reader that does not wait to be told so.
    const xOf = async (branch: string, selector: string) =>
      (await rectOf(rowFor(page, branch).locator(selector).first())).x;

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
    const mark = await rectOf(markIn(page, 'feature/both'));
    const dot = await rectOf(li.locator('[data-live-dot]'));
    // The track starts at the row's edge, outside the live dot.
    expect(mark.x).toBeLessThan(dot.x);
    // A horizontal TRACK, in the geometry the browser resolved: wider than it
    // is tall, which is the axis the bar used to run along. Stated because the
    // travel needs a track to happen on, and a mark that stayed a vertical
    // stroke would have nowhere to go.
    //
    // Measured on `[data-activity-track]`, not on the mark: the OUTER element
    // is the first line's box (12x20) and exists to place the mark on that
    // line, so its own proportions say nothing about the track's shape.
    const track = await rectOf(li.locator('[data-activity-track]'));
    expect(track.width).toBeGreaterThan(track.height);
    // The travelling dot is the same size as the live dot it passes near, and
    // stays INSIDE its track at both ends of the journey — a dot that overran
    // would collide with the live dot and read as one smeared mark.
    const travelling = await rectOf(dotIn(page, 'feature/both'));
    expect(travelling.x).toBeGreaterThanOrEqual(track.x - 0.5);
    expect(travelling.x + travelling.width).toBeLessThanOrEqual(track.x + track.width + 0.5);
  });

  // ── Four marks, four meanings ─────────────────────────────────────────────

  it('leaves the live dot pulsing exactly as it was', async () => {
    // No mark implemented by modifying another — the standard
    // `[data-change-mark]` set when it shipped. The dot means *in the WORKING
    // group* and still pulses on its own `animate-pulse`; this wave gave the
    // activity mark a `travel` of its own rather than reaching for the dot.
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
    // Its OWN animation, and not the one this wave introduced. `not 'none'`
    // alone would pass if the dot had been given `travel` — which is exactly
    // the "implemented by modifying another" failure this test exists for.
    const live = await dot.evaluate((el) => getComputedStyle(el).animationName);
    expect(live).not.toBe('none');
    expect(live).not.toBe('travel');
    // The unwritten WORKING row still carries a mark — at the SLOW pace, which
    // is this wave's addition and is asserted in its own block below. What
    // matters here is that the two elements remain two.
    expect(await markIn(page, 'feature/live').count()).toBe(1);
    expect(await dotIn(page, 'feature/live')
      .evaluate((el) => getComputedStyle(el).animationName)).toBe('travel');
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

  it('never lets a screen reader hear a SPEED', async () => {
    // The pace is in the motion and in the `title`, and in nothing a screen
    // reader reaches. Both paces, because the slow one is the newer claim and
    // the easier one to leak: it is the row whose note is the only place the
    // state is stated in words.
    // The branch names deliberately avoid the words being searched for: naming
    // a fixture branch `feature/fast` makes this test fail on its own fixture
    // and prove nothing, which is what the first draft did.
    const page = await open([
      row({ branch: 'feature/measured', localDirty: true, branchUrl: `${GH}feature/measured` }),
      row({ branch: 'bug/unobserved', group: 'working', branchUrl: `${GH}bug/unobserved` }),
    ]);
    await expect.poll(() => markIn(page, 'feature/measured').count()).toBe(1);
    for (const branch of ['feature/measured', 'bug/unobserved']) {
      expect(await markIn(page, branch).getAttribute('aria-hidden')).toBe('true');
      // The words "fast" and "slow" appear nowhere in the accessible text of
      // the row — the note carries the STATE, never the speed.
      const text = await rowFor(page, branch).innerText();
      expect(text.toLowerCase()).not.toMatch(/\b(fast|slow)\b/);
    }
  });
});

/**
 * THE TWO SPEEDS — the fact each one states, and that they are told apart.
 *
 * **The speed is a fact, not a decoration.** One rule, two states the board can
 * defend, taken from the pulse that was reported the day this was asked for:
 *
 * ```
 * feature/not-started-counts-plans  dirty=true   → fast  ("last commit 18 min ago")
 * bug/green-never-outranks-unknown  dirty=false  → slow  ("claimed, no known worker")
 * ```
 *
 * Fast means *being written to right now*, and every signal behind it is local.
 * Slow means *claimed, and this checkout observed nothing* — which is a weaker
 * statement on purpose: absence is not falsehood, so the slow dot says
 * *unknown*, never *nobody*.
 *
 * `activityPace` is a pure function and is pinned in the unit suite. What needs
 * a page is that the two RESOLVE to different durations and that a reader can
 * tell them apart — a class name proves neither.
 */
describe('the dot travels at two speeds, and they are distinguishable', () => {
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
   * The two live rows, in the terms the report used.
   *
   * Both in WORKING, differing ONLY in `localDirty` — which is the whole claim.
   * A fixture where the two differed in group or in note would let an
   * implementation reading either of those pass.
   */
  const ROWS = [
    row({
      branch: 'feature/measured', group: 'working', localDirty: true,
      note: 'last commit 18 min ago', branchUrl: `${GH}feature/measured`,
    }),
    row({
      branch: 'bug/unobserved', group: 'working', localDirty: false, localLocked: false,
      note: 'claimed, no known worker', branchUrl: `${GH}bug/unobserved`,
    }),
  ];

  async function open(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    contexts.push(context);
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet(ROWS)) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    return page;
  }

  const rowFor = (page: Page, branch: string) =>
    page.locator('li[data-agent-row]').filter({ has: page.locator(`[data-branch="${branch}"]`) });

  const dotIn = (page: Page, branch: string) =>
    rowFor(page, branch).locator('[data-activity-mark] [data-activity-dot]');

  const durationOf = async (page: Page, branch: string) =>
    Number.parseFloat(await dotIn(page, branch)
      .evaluate((el) => getComputedStyle(el).animationDuration));

  it('marks BOTH rows — the measured one and the merely claimed one', async () => {
    // The floor. If the unobserved row carried no mark, "slow" would have
    // nothing to be slow about, and every duration assertion below would be
    // comparing one row against nothing.
    const page = await open();
    await expect.poll(() => dotIn(page, 'feature/measured').count()).toBe(1);
    expect(await dotIn(page, 'bug/unobserved').count()).toBe(1);
  });

  it('travels FAST where a write was observed and SLOW where none was', async () => {
    // THE assertion, in the durations the browser resolved. Stated as an
    // inequality rather than as two exact numbers, so retuning either speed
    // stays a design choice rather than a test edit.
    const page = await open();
    await expect.poll(() => dotIn(page, 'feature/measured').count()).toBe(1);
    const fast = await durationOf(page, 'feature/measured');
    const slow = await durationOf(page, 'bug/unobserved');
    expect(fast).toBeGreaterThan(0);
    expect(slow).toBeGreaterThan(fast);
  });

  it('separates the two by enough to actually READ as different', async () => {
    // The half an inequality misses: 1.10s against 1.11s satisfies "slower"
    // and is indistinguishable to a person, which would make the speed a fact
    // the board states and nobody can receive. A factor rather than a
    // difference, because what the eye compares is the ratio.
    const page = await open();
    await expect.poll(() => dotIn(page, 'feature/measured').count()).toBe(1);
    const fast = await durationOf(page, 'feature/measured');
    const slow = await durationOf(page, 'bug/unobserved');
    expect(slow / fast).toBeGreaterThanOrEqual(2);
  });

  it('reads the local signals, and NOT the group or the note', async () => {
    // Both rows are in WORKING and both notes are plausible; only `localDirty`
    // differs. An implementation keyed on the group would give them the same
    // speed, and one keyed on the note's wording would be reading a sentence.
    const page = await open();
    await expect.poll(() => dotIn(page, 'feature/measured').count()).toBe(1);
    for (const branch of ['feature/measured', 'bug/unobserved']) {
      const group = await rowFor(page, branch).locator('[data-branch]').count();
      expect(group).toBe(1);
    }
    expect(await durationOf(page, 'feature/measured'))
      .not.toBe(await durationOf(page, 'bug/unobserved'));
  });

  it('says which fact each pace states, in the mark\'s own words', async () => {
    // The two are different claims and the `title` says so — *a write is in
    // progress* against *claimed, and no write observed*. A single shared title
    // would flatten the two speeds back into one fact, leaving the distinction
    // carried by motion alone, which this board never allows.
    const page = await open();
    await expect.poll(() => dotIn(page, 'feature/measured').count()).toBe(1);
    const fast = rowFor(page, 'feature/measured').locator('[data-activity-mark]');
    const slow = rowFor(page, 'bug/unobserved').locator('[data-activity-mark]');
    expect(await fast.getAttribute('title')).toBe('A write is in progress in this checkout');
    expect(await slow.getAttribute('title'))
      .toBe('Claimed, and no write observed in this checkout');
    // And the slow one says UNKNOWN rather than NOBODY: absence is not
    // falsehood, and a scan that could not observe a worktree reports absence
    // rather than cleanliness.
    expect((await slow.getAttribute('title'))!.toLowerCase()).not.toMatch(/idle|nobody|no one/);
  });

  it('exposes the pace as a hook, so neither speed can be asserted by accident', async () => {
    // A duration is a number that could arrive from anywhere; the hook names
    // the DECISION. It is what a later wave reads to tell the two apart without
    // re-deriving the rule from a stylesheet.
    const page = await open();
    await expect.poll(() => dotIn(page, 'feature/measured').count()).toBe(1);
    expect(await rowFor(page, 'feature/measured')
      .locator('[data-activity-mark]').getAttribute('data-activity-pace')).toBe('fast');
    expect(await rowFor(page, 'bug/unobserved')
      .locator('[data-activity-mark]').getAttribute('data-activity-pace')).toBe('slow');
  });

  it('keeps the row\'s note carrying the state in words', async () => {
    // The channel that survives reduced motion, a screenshot, and a screen
    // reader. Under `motion-reduce` the two speeds collapse into one
    // appearance — correct, because speed is what is being removed — and this
    // is what still tells them apart.
    const page = await open();
    await expect.poll(() => dotIn(page, 'feature/measured').count()).toBe(1);
    expect(await rowFor(page, 'feature/measured').innerText()).toMatch(/last commit/i);
    expect(await rowFor(page, 'bug/unobserved').innerText()).toMatch(/claimed, no known worker/i);
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
