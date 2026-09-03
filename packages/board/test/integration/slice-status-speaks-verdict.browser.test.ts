import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

/**
 * A WAVE ROW SPEAKS ITS OWN VERDICT — the STATUS slot uses the verdict word.
 *
 * Before this fix, a multi-branch wave in DONE showed `6 delivered` because
 * `groupedWord` was chosen by section (`done` → `delivered`). But the wave's
 * own verdict is `complete`, and using a section-chosen word meant different
 * sections used different words for the same verdict.
 *
 * The fix: `groupedWord` now reads from `wg.verdict`, so a multi-branch wave
 * shows `6 complete` — the verdict itself, consistent across all sections.
 *
 * Branch rows (item 6) still show `delivered` for merged refs — that comes from
 * `stateStatus`, which is unchanged. Single-branch waves inherit their branch's
 * status via `soleStatus`, per the #323 fix.
 *
 * ## Why this file reads the catalogue — the demonstration for `a-ui-test-needs-
 * data-not-a-board`
 *
 * It used to build its own `fleet()` inline and start a REAL board against
 * `test/fixtures/tiny-garden` — then intercept `/api/fleet` and throw the whole
 * scan away. Nothing it asserts has ever depended on that scan.
 *
 * It is now the first consumer of `test/catalogue`, and it is here to prove the
 * shape works rather than to be part of a migration: the other stubbed browser
 * tests are `infra/the-browser-tests-read-the-catalogue`'s job, deliberately a
 * separate slice so a reviewer can tell a broken catalogue from a badly-moved
 * test.
 *
 * **The assertions below are unchanged, character for character.** What moved is
 * where the data comes from — and the inline fixture it replaces was cast
 * (`as Fleet`), which is how it carried `phase: 'Approved'`, a PLAN phase that
 * `AgentRow.phase` does not admit, straight past the type system into the
 * renderer. Building through `row()` rejects it.
 */
describe('a wave row speaks its own verdict in the status slot', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(): Promise<Page> {
    // A DONE wave with two merged branches — verdict `complete`. The status slot
    // must show `2 complete`, not `2 delivered`. That state is the catalogue's
    // `a-done-wave`, and this file's inline fixture is what it was built from.
    const page = await cat.open('a-done-wave', { tab: 'agents' });
    await page.getByText('Done').first().waitFor({ timeout: 10_000 });
    // DONE is folded by default — unfold it to see the wave rows.
    const doneToggle = page.locator('[data-group-toggle]').filter({ hasText: 'Done' });
    if ((await doneToggle.getAttribute('aria-expanded')) === 'false') {
      await doneToggle.click();
    }
    return page;
  }

  /** The status cell of a wave row. */
  const sliceStatus = (page: Page, wave: string) =>
    page.locator(`[data-slice-row="${wave}"]`).locator('[data-tuple-status]');

  it('a multi-branch wave in DONE shows "complete", not "delivered"', async () => {
    const page = await open();
    try {
      const status = sliceStatus(page, 'Complete');
      await status.waitFor({ timeout: 5_000 });
      // The verdict word: `complete`, not `delivered`.
      // `2 complete` is the shape — count + word.
      const text = await status.textContent();
      expect(text).toContain('complete');
      expect(text).not.toContain('delivered');
      // Asserted directly by name: item 5 says no row reads `delivered` while
      // its siblings read `complete`.
      expect(text).toMatch(/2\s+complete/);
    } finally {
      await page.close();
    }
  });
});
