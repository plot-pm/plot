// A slice whose brief is being written through the IMPLEMENT ROUTE says so —
// in a real browser against the shipped artifact.
//
// THE DEFECT: since `aa1f36296` ("a dispatch names the act it started",
// 2026-09-29) the dispatch controller writes a slice's brief through
// `/plot-implement --brief-only`, which logs to a path `briefAskLogPaths` did
// not name. A row whose ONLY ask is an implement-route log reads "approved —
// nobody has taken it" on that code — this is the row this test's fixture
// builds, and it must read "brief asked" instead.
//
// With a `.plot/` or `.plot-brief-` log present this would pass on the old
// code too, so this fixture carries NEITHER — `briefAskedAt` is set directly,
// the way `fleet.ts` would compute it from an implement-route log alone.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, scenario, fleet as buildFleet, row, type Catalogue } from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type Fleet } from '../../src/contract/schema.js';

describe('a brief the implement route is writing shows as asked (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const askedAt = Date.now() - 45_000;

  // JOINS THE EXISTING `toms-open` WAVE, which already holds TWO branches
  // (`feature/untaken`, `feature/blocked`) in the base scenario. A slice of
  // exactly one branch collapses into `SliceRow`, which renders no brief note
  // at all — `needsBrief` is read only by `Row`, the per-branch renderer a
  // multi-branch wave's branches go through. A fixture with a single branch
  // would pass for the wrong reason: no note anywhere, on code old or new.
  const withAskedRow = (): Fleet => {
    const { agents: _a, summary: _s, ...envelope } = scenario('ten-rows-one-kind-each').fleet;
    return buildFleet({
      ...envelope,
      rows: [
        ...envelope.rows,
        row({
          branch: 'feature/writing-now', wave: 'toms-open', plan: 'plant-tomatoes', planFile: '2026-03-01-plant-tomatoes.md',
          group: 'not-started', state: 'open', phase: 'Design', ageMinutes: null,
          waitingOn: 'click', note: ELIGIBLE_NOTE, verdict: 'eligible',
          brief: 'missing', startability: 'needs-brief',
          briefAskedAt: askedAt, briefFailed: null,
          branchUrl: '', waitingDays: 3,
        }),
      ],
    } as Partial<Fleet>);
  };

  it('renders "brief asked" rather than the gap note, for an implement-route-only ask', async () => {
    const page = await cat.open('ten-rows-one-kind-each', { tab: 'agents', over: { fleet: withAskedRow() } });
    try {
      // THE SECTION IS AN ELEMENT, not an attribute on the row — the same trap
      // `a-handed-slice-reads-as-taken.browser.test.ts` records: rows carry no
      // `data-group`, so the section is located by its own toggle.
      const notStarted = page.locator('section', {
        has: page.locator('[data-group-toggle="not-started"]'),
      });

      const rowLocator = notStarted.locator('li[role="row"]')
        .filter({ has: page.locator('[data-branch="feature/writing-now"]') });

      await expect.poll(async () => {
        await expandAgentFolds(page);
        return rowLocator.count();
      }, { timeout: 20_000 }).toBeGreaterThan(0);

      const asked = rowLocator.locator('[data-brief-asked]');
      await expect.poll(() => asked.count()).toBe(1);
      expect(await asked.textContent()).toContain('brief asked');

      // Never the missing-brief errand: the brief IS being written.
      expect(await rowLocator.locator('[data-brief-gap]').count()).toBe(0);
      expect(await rowLocator.locator('[data-brief-failed]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
