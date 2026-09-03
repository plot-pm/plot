import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, scenario, row as buildRow, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * THE FOUR KINDS OF QUIET, SEEN IN A BROWSER.
 *
 * `quiet-is-not-one-state` split a fallthrough that described 26 rows by commit
 * age into four kinds with four sentences. The DECIDING is
 * `packages/domain/src/rules/quiet.ts`, unit-tested there against plain records
 * with no browser, no host and no git; `classifyGroup` and `prState` call it,
 * and `test/unit/fleet.test.ts` pins that. This file asserts the last step and
 * only the last step: **the badge shows what the rule decided.**
 *
 * That split is the Layering Rule's, verbatim: *"a view state that cannot be
 * asserted without a browser is a domain property that has not been extracted
 * yet"* — and the deciding slice extracted them. So these tests state a ROW and
 * read the screen. They compute nothing, and a change of section or sentence
 * fails in the unit suite first, here second.
 *
 * ## Why the rows are stated rather than classified
 *
 * The catalogue serves `/api/fleet` by name, so a row's `group` and `note` are
 * inputs here. A test that ran the classifier and then rendered its output
 * would be asserting the same derivation twice and would pass on a board that
 * renders neither field. Stating them asks the one question this layer owns:
 * given a row that says X, does a reader see X?
 */
describe('the board shows which kind of quiet a row is in', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  /**
   * The four kinds as four rows, replacing the scenario's own.
   *
   * One per kind, each carrying the sentence `quietNote` returns for it. The
   * fourth — plain `quiet` — is the shelved branch with a written reason, which
   * is what still reaches QUIET through `classifyGroup`: somebody decided and
   * wrote down why, so the row is a record and asks for nothing.
   */
  const rows = [
    buildRow({
      branch: 'feature/declined', plan: 'garden', wave: 'declined-slice', state: 'wip', group: 'quiet',
      ageMinutes: 60 * 24 * 26, note: 'PR closed without merging', quietKind: 'closed-pr',
      pr: { number: 53, url: 'https://github.com/tiny/garden/pull/53', draft: false, state: 'closed' },
    }),
    buildRow({
      branch: 'feature/never-begun', plan: 'garden', wave: 'never-begun-slice', state: 'claimed', group: 'waiting-on-you',
      ageMinutes: 4_320, note: 'claimed, no work committed — claimed 3 days ago',
      quietKind: 'orphaned-claim',
    }),
    buildRow({
      branch: 'feature/left-behind', plan: 'garden', wave: 'left-behind-slice', state: 'wip', group: 'waiting-on-you',
      ageMinutes: 60 * 24 * 126, note: 'commits, no PR ever opened — last commit 126 days ago',
      quietKind: 'abandoned',
    }),
    buildRow({
      branch: 'feature/shelved-with-reason', plan: 'garden', wave: 'shelved-slice', state: 'deferred', group: 'quiet',
      ageMinutes: 900, note: 'superseded by the rewrite',
    }),
  ];

  /**
   * Open the Agents tab over the four rows, with QUIET unfolded.
   *
   * QUIET is collapsed by default — `COLLAPSED_BY_DEFAULT` — so a test about
   * what a quiet row renders opens the section first, which is the same click a
   * reader makes. WAITING ON YOU is open on arrival and needs none.
   */
  async function open(): Promise<Page> {
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { fleet: buildFleet({ ...envelope(), rows }) as Fleet },
    });
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    const toggle = page.locator('[data-group-toggle="quiet"]');
    await toggle.waitFor({ timeout: 10_000 });
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    return page;
  }

  /**
   * The scenario's envelope with its own rows, agents and summary withheld.
   *
   * `buildFleet` derives `agents` and `summary` FROM the rows, and an explicit
   * value wins over the derivation — so spreading the base fleet in whole would
   * carry the ten-row estate's agents onto a four-row one. Only the envelope
   * the countdowns and PR timers live in is kept.
   */
  function envelope() {
    const { agents: _a, summary: _s, rows: _r, ...rest } = scenario('ten-rows-one-kind-each').fleet;
    return rest;
  }

  /**
   * One row, by the branch cell's `data-branch` — the whole name, whatever the
   * column does to it.
   *
   * `[role="row"]`, NOT the `li`. A branch sits inside a slice inside a plan,
   * and every one of those is an `li`, so an ancestor match returns the whole
   * section and `textContent()` then spans four branches — a `toContain` that
   * passes because some OTHER row said the thing. The grid row is the innermost
   * element that holds one branch's six slots.
   */
  const rowFor = (page: Page, branch: string) =>
    page.locator('[role="row"]').filter({ has: page.locator(`[data-branch="${branch}"]`) }).last();

  /** The section with this heading. */
  const group = (page: Page, label: string) =>
    page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: new RegExp(label) }),
    });

  it('shows a declined PR as declined, not as silence', async () => {
    // The 17-row population, and the one this plan's first draft got wrong. It
    // read `closed` inside a QUIET list described by commit age, so a decision
    // somebody took looked like a branch nobody had touched.
    const page = await open();
    try {
      const li = rowFor(page, 'feature/declined');
      // The WORD, from `prStatus` — a declined PR has one and it already says
      // what happened rather than what its checks said when it stopped.
      await expect.poll(() => li.textContent()).toContain('closed');
      // AND THE SENTENCE, which is the half that was missing. `closed` inside a
      // list described by commit age read as one more silent row.
      await expect.poll(() => li.textContent()).toContain('PR closed without merging');
    } finally {
      await page.close();
    }
  });

  it('keeps a declined PR ON the board', async () => {
    // ASSERTED BECAUSE AN EARLIER DRAFT OF THE BRIEF ASKED FOR THE OPPOSITE.
    // Interrogation disproved it on 2026-09-03: #53, #363 and #654 all still
    // have LIVE REFS. The branch exists, still holds a worktree slot, and is
    // still findable by everything except the surface a person acts through —
    // so hiding it would make the board lie in the other direction.
    const page = await open();
    try {
      await expect.poll(() => rowFor(page, 'feature/declined').count()).toBe(1);
      // In QUIET, not DONE: DONE would read a declined branch as an equal
      // outcome to a merged one.
      await expect.poll(() => group(page, 'Quiet').getByText('feature/declined').count())
        .toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('shows an orphaned claim in the sweep’s own words', async () => {
    // 2 rows. `plot-reap.sh --dry-run` calls it the same thing, so a reader who
    // meets one here finds it again in the sweep's output rather than meeting
    // two names for one thing.
    const page = await open();
    try {
      const li = rowFor(page, 'feature/never-begun');
      await expect.poll(() => li.textContent()).toContain('claimed, no work committed');
      // THE STATUS WORD MOVED TOO. It read `claimed` — a ref exists — which
      // says nothing about whether anybody started. `unclaimed` is slot 5's one
      // word for it; the sweep's full wording is the note above.
      await expect.poll(() => li.textContent()).toContain('unclaimed');
      // AND NOT *in progress*, which is what a ref existing used to imply. This
      // estate ran 0 live workers while the board showed seven rows working.
      await expect.poll(() => li.textContent()).not.toContain('in progress');
    } finally {
      await page.close();
    }
  });

  it('shows abandoned work as abandoned, and says for how long', async () => {
    // 6 rows, and the one kind that genuinely needs a person: revive it, or
    // drop it. The age RIDES WITH the state rather than standing in for it —
    // *how long* is the fact that call turns on, and it was the whole of what
    // the row used to say.
    const page = await open();
    try {
      const li = rowFor(page, 'feature/left-behind');
      await expect.poll(() => li.textContent()).toContain('commits, no PR ever opened');
      await expect.poll(() => li.textContent()).toContain('abandoned');
      // THE AGE IS STILL THERE, beside the state rather than instead of it.
      await expect.poll(() => li.textContent()).toContain('126 days');
      // THE MEASURED DEFECT, asserted directly: `stateStatus` maps `wip` to
      // *in progress*, and six branches four months idle rendered it while the
      // estate ran zero workers.
      await expect.poll(() => li.textContent()).not.toContain('in progress');
    } finally {
      await page.close();
    }
  });

  it('puts the two kinds that need a person where a person will see them', async () => {
    // THE GROUP IS THE HALF THAT ASKS FOR SOMETHING, and moving it is the plan's
    // own warning. #669 fixed a withdrawn plan's NOTE and kept its group,
    // calling that conservative — so the row went on asking for a decision its
    // own sentence said was made, and sat in WAITING ON YOU for a day until
    // #675 moved it.
    const page = await open();
    try {
      const waiting = group(page, 'Waiting on you');
      await expect.poll(() => waiting.getByText('feature/never-begun').count()).toBeGreaterThan(0);
      await expect.poll(() => waiting.getByText('feature/left-behind').count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('keeps QUIET for the record it still means', async () => {
    // A branch somebody shelved with a written reason. Nobody is coming back
    // for it and nothing is being asked, so QUIET is the honest placement — the
    // section keeps only what it means rather than being emptied for its own
    // sake.
    const page = await open();
    try {
      await expect.poll(() => group(page, 'Quiet').getByText('feature/shelved-with-reason').count())
        .toBeGreaterThan(0);
      await expect.poll(() => rowFor(page, 'feature/shelved-with-reason').textContent())
        .toContain('superseded by the rewrite');
    } finally {
      await page.close();
    }
  });
});
