import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * THE WAVE NAME STAYS IN ITS CELL — measured in a browser.
 *
 * A 53-character wave name was reported painting over its neighbours: the name
 * escaping its cell instead of being contained by it. Every OTHER name on the
 * board clips (branch, plan, PR) and shows the whole string on hover, and the
 * wave row's name must read the same way.
 *
 * ## This is a REGRESSION LOCK, not a fix.
 *
 * The overlap is already prevented on `main`. Since `a-wave-is-one-row` (#339)
 * the wave name is projected as an ordinary `plan` link (`tupleFromSlice` →
 * slot 3) and rendered through the shared `min-w-0 truncate` chain, which clips
 * it at the cell edge. Measured 2026-08-23 on both the fixed `12rem` name track
 * AND the `minmax(12rem,auto)` growing track `the-name-track-holds-the-name`
 * (#340) introduces, at viewports from 660px to 1480px: the name's box always
 * ended before the status cell's began. There was no source change left to
 * make — so this pins the invariant instead, against the two ways it could come
 * back: the sibling's track change, and any later edit to the wave name cell.
 *
 * The pairing that matters: a weaker lock passes the obvious assertion. A test
 * asserting the rendered STRING was shortened passes an implementation whose box
 * still overlaps, so the geometry is asserted directly — the name cell's right
 * edge against the status cell's left — and the full name is asserted present on
 * hover, so a fix that clipped the name out of reach would fail here too.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const GH = 'https://github.com/tiny/garden/tree/';

// A wave name long enough to overrun a 12rem (192px) cell — 53 characters, the
// length reported on the board that filed this bug.
const LONG_WAVE = 'the-implementation-that-hardens-the-long-horizon-scan';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Design', group: 'not-started', ageMinutes: null,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null, deferredReason: '',
  ...over,
});

/**
 * A fleet whose one wave carries a 53-character name. Two branches, so the wave
 * renders as a GROUPED wave row — the name-in-a-cell case, with the branches
 * folded out of the way and the wave name the only thing in slot 3.
 */
function fleet(): Fleet {
  const rows: AgentRow[] = [
    row({
      plan: 'longhorizon-hardening', planFile: '2026-08-16-longhorizon-hardening.md',
      branch: 'feature/harden-the-scan', wave: LONG_WAVE,
      group: 'not-started', waitingDays: 4,
    }),
    row({
      plan: 'longhorizon-hardening', planFile: '2026-08-16-longhorizon-hardening.md',
      branch: 'feature/probe-the-horizon', wave: LONG_WAVE,
      group: 'not-started', waitingDays: 4,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    issues: [], issueAnswer: 'answered', issueError: null,
    summary: { plans: 1, waves: 1, branches: rows.length, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as unknown as Fleet;
}

describe('the wave name stays in its cell', () => {
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

  async function open(width = 1480): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: fleet() },
      viewport: { width, height: 1400 },
    });
    await page.getByText('Not started').first().waitFor({ timeout: 15_000 });
    await expandAgentFolds(page);
    return page;
  }

  /**
   * The name cell's right edge against the status cell's left edge, in one
   * measurement so the two are read at the same layout. `null` where a cell is
   * missing, which the caller asserts against rather than coercing.
   */
  async function nameVsStatus(page: Page) {
    const sliceRow = page.locator(`[data-wave-row="${LONG_WAVE}"]`);
    await expect.poll(() => sliceRow.count()).toBe(1);
    return sliceRow.evaluate((rowEl) => {
      const name = rowEl.querySelector('[data-tuple-text],[data-tuple-link]') as HTMLElement | null;
      const status = rowEl.querySelector('[data-tuple-status]') as HTMLElement | null;
      const n = name?.getBoundingClientRect();
      const s = status?.getBoundingClientRect();
      return {
        nameRight: n ? n.right : null,
        statusLeft: s ? s.left : null,
        title: name?.getAttribute('title') ?? null,
      };
    });
  }

  it('keeps a 53-char wave name inside its cell rather than painting over the status column', async () => {
    const page = await open();
    try {
      // GEOMETRY, NOT THE STRING — the plan's assertion. The name cell's box
      // against the status cell's: the name must END before the status BEGINS,
      // whatever the shared name track does with its width. A test that only
      // checked the rendered text was shortened would pass an implementation
      // whose box still painted over the status column, which is the exact
      // defect reported.
      const { nameRight, statusLeft, title } = await nameVsStatus(page);
      expect(nameRight).not.toBeNull();
      expect(statusLeft).not.toBeNull();
      expect(nameRight!).toBeLessThanOrEqual(statusLeft! + 1);
      // The name reads WHOLE on hover — containment must not cost the full text.
      // Asserted on the CONTENT, not on shortening: a fix that clips the string
      // would leave a reader unable to recover the name it hid.
      expect(title).toContain(LONG_WAVE);
    } finally {
      await page.close();
    }
  });

  it('still contains the name where slot 4 has no slack left to give', async () => {
    // The hostile case for a GROWING name track: a viewport narrow enough that
    // the links track (`1fr`) has collapsed toward zero, so a name that grows
    // instead of clipping has nowhere to go but into the status cell. Measured
    // 2026-08-23 at 760px on both the fixed and the `minmax(12rem,auto)` track —
    // the name clipped at the cell edge and left the status column untouched.
    // Above the card breakpoint on purpose: below it the row stops being a grid
    // and the columns no longer apply.
    const page = await open(760);
    try {
      const { nameRight, statusLeft } = await nameVsStatus(page);
      expect(nameRight).not.toBeNull();
      expect(statusLeft).not.toBeNull();
      expect(nameRight!).toBeLessThanOrEqual(statusLeft! + 1);
    } finally {
      await page.close();
    }
  });

  it('does not push the page into a horizontal scroll to fit the name', async () => {
    const page = await open();
    try {
      await page.locator(`[data-wave-row="${LONG_WAVE}"]`).first().waitFor({ timeout: 15_000 });
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    } finally {
      await page.close();
    }
  });
});
