import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

/**
 * THE WAVE LEAVES THE KIND ALONE — a regression lock, not a fix.
 *
 * The plan's defect #3 measured a wave name (`Shaped`, `Inverted`) rendered
 * BESIDE the kind slot on `PR`/`BRANCH`/`AGENT` rows — *"the wave did not move,
 * it was joined"*, `8 data-tuple-kind-label` and `3 data-wave` both rendered.
 * That state no longer exists: the wave-as-kind work (`a349130e`, `028e4311`)
 * and #339 (*a wave renders as exactly one row in exactly one section*) replaced
 * it. Every named-wave branch now groups under one `WaveRow` whose SUBJECT is
 * the wave — `waveGroupsFor` claims all of them — so no branch row wears a wave
 * badge and nothing lands in the kind's track.
 *
 * This test asserts the negative directly, which is the plan's own instruction:
 * *"an implementation that merely moves the element usually still leaves the old
 * one rendering in some row kind, and only the 'nothing in the kind track'
 * assertion catches that."* A future change that reintroduces a branch-row wave
 * badge — re-adding a per-branch row for a named wave, or dropping a kind from
 * `WAVE_LINKING_KINDS` — is caught here.
 *
 * **Through the pipeline, never a component fixture.** The plan is explicit that
 * *a fixture that skips the pipeline tests the part that was not broken* — the
 * component renders a wave in slot 3 correctly when handed one; the placement
 * decision lives in the ADAPTER. So this drives the board served with
 * `PLOT_BOARD_MOCK=1`: one row per kind, validated by the same schema and
 * grouped by the same code a real pulse is.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

describe('the wave leaves the kind alone', () => {
  // THE STATE IS SERVED, NOT SPAWNED AND STUBBED.
  //
  // This file started `board-server.mjs` over the tiny-garden fixture only to
  // serve `index.html`: it never read `/api/board`, and stubbed `/api/fleet`
  // itself. The mock serves the same built client and answers both payloads by
  // name, so the test states its own input instead of inheriting an estate.
  let cat: Catalogue;

  beforeAll(async () => {
    // THE SAME POPULATION, SERVED BY NAME. `PLOT_BOARD_MOCK=1` existed to get
    // one row per kind through the whole pipeline; `one-row-per-kind` is that
    // population as a named state, validated by the same schema and grouped by
    // the same adapter code. The pipeline this file is about is the CLIENT's —
    // the placement decision in `AgentList` — and that is unchanged.
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(): Promise<Page> {
    const page = await cat.open('one-row-per-kind', {
      tab: 'agents',
      viewport: { width: 1400, height: 1200 },
    });
    await page.locator('li[data-tuple-kind]').first().waitFor({ timeout: 10_000 });
    // Every wave and every branch beneath it, so any wave badge a branch row
    // might carry is in the DOM to be asserted absent.
    await expandAgentFolds(page);
    return page;
  }

  it('places NO data-wave element in the kind\'s track, on any row', async () => {
    const page = await open();
    try {
      // THE ASSERTION THE PLAN NAMES AS LOAD-BEARING. The kind slot is the cell
      // carrying `data-tuple-kind-label`; no wave badge may be a descendant of
      // one, on any kind of row. This is the assertion that catches a move that
      // left a copy behind.
      const kindCells = page.locator('[role="gridcell"]:has([data-tuple-kind-label])');
      const stray = kindCells.locator('[data-wave]');
      expect(await stray.count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('reads only kind labels down the kind column — every cell in it', async () => {
    const page = await open();
    try {
      // The column read end to end: each row's kind cell holds a wave-free label.
      // A wave joined here would make the column a second four-meanings column,
      // which is the defect the tuple exists to end.
      const labels = page.locator('[data-tuple-kind-label]');
      const count = await labels.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        const cell = labels.nth(i).locator('xpath=ancestor::*[@role="gridcell"][1]');
        expect(await cell.locator('[data-wave]').count(),
          `kind cell ${i} carries a wave`).toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  it('shows NO wave BADGE on any row — a wave is a WaveRow, not a mark on a kind', async () => {
    const page = await open();
    try {
      // The board-wide negative. Every named wave in the mock — `Shaped`,
      // `Modelled`, `Tracer`, `Relocated`, `Moved` — renders as its own row; none
      // is a `data-wave` badge sitting beside another kind's name. Measured on the
      // mock before this: 3 stray `data-wave` badges; after the wave-as-kind work:
      // 0.
      expect(await page.locator('[data-wave]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('shows NO wave on a plan row — a plan has no branch, so no wave', async () => {
    const page = await open();
    try {
      // *A plan row has no branch, so it has no wave to show* — the plan's words.
      // Its phase lives in the plan heading, not beside its kind.
      const planRows = page.locator('li[data-tuple-kind="plan"]');
      await expect.poll(() => planRows.count(), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(1);
      const count = await planRows.count();
      for (let i = 0; i < count; i += 1) {
        expect(await planRows.nth(i).locator('[data-wave]').count(),
          `plan row ${i} shows a wave`).toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  it('shows NO wave BADGE on the kinds that LINK their wave', async () => {
    const page = await open();
    try {
      // An `agent`, a `pr` and a `build` carry the wave as an ARTIFACT LINK in
      // slot 4 — see `WAVE_LINKING_KINDS`. A badge on them is a second copy of a
      // fact the row already states, measured on the mock as `Inverted` twice on
      // the agent row. None may wear the `data-wave` badge.
      for (const kind of ['agent', 'pr', 'build'] as const) {
        const rows = page.locator(`li[data-tuple-kind="${kind}"]`);
        const count = await rows.count();
        for (let i = 0; i < count; i += 1) {
          expect(await rows.nth(i).locator('[data-wave]').count(),
            `${kind} row ${i} wears a wave badge`).toBe(0);
        }
      }
    } finally {
      await page.close();
    }
  });

  it('renders each named wave as exactly one WaveRow head — the wave HAS a home', async () => {
    const page = await open();
    try {
      // The positive half, adapted to the model that replaced the badge: the wave
      // is not gone, it is a ROW. A regression that dropped wave rendering
      // altogether would pass every negative above and fail here.
      //
      // THE NAMES ARE THE SERVED STATE'S, not a fixture's. This read five wave
      // names out of `PLOT_BOARD_MOCK`'s data (`Shaped`, `Modelled`, `Tracer`,
      // `Relocated`, `Moved`); the state now says which waves it holds, so the
      // assertion names those. The claim is unchanged — one `data-wave-row` per
      // named wave, and never a mark beside a kind — and it is now a claim about
      // a state the test states rather than about whatever the mock happened to
      // contain.
      for (const wave of ['Kind-wave', 'Kind-branch', 'Kind-plan']) {
        await expect.poll(() => page.locator(`[data-wave-row="${wave}"]`).count(),
          { timeout: 10_000 }).toBe(1);
      }
    } finally {
      await page.close();
    }
  });
});
