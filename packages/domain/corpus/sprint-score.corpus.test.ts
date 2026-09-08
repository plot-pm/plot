import { beforeAll, describe, expect, it } from 'vitest';

import { scoreItem, type PlanDelivery, type SprintItem } from '../src/entities/sprint.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';
import {
  listSprintSlugs,
  readSprintRelease,
  type Estate,
  type SprintItemRow,
  type SprintRow,
} from './production.js';

/**
 * THE FIRST RULE-VERSUS-SHELL COMPARISON: does `scoreItem` answer what
 * `item_state` answers, over every MoSCoW item on this repository's estate?
 *
 * A DIFFERENT PAIR FROM THE OTHER CORPUS FILES, and the same shape. Those
 * compare an ADAPTER against production, where the rule has one implementation
 * and cannot disagree with itself. This compares two implementations of one
 * RULE — `entities/sprint.ts:scoreItem` and `plot-sprint-release.sh:item_state`
 * — which exist on purpose, because the shell needs an answer where a `node`
 * hop is not worth paying and the domain needs one to reason with.
 *
 * NEITHER SIDE IS AUTHORITATIVE. The test says they agree. `docs/shell-and-domain.md`
 * is the contract this is built to; on a disagreement the branch stops, and
 * adjusting either side to make this pass is the one move forbidden.
 *
 * Production supplies BOTH HALVES — the readings `item_state` was given and the
 * verdict it reached. Assembling the readings here from the sprint files would
 * compare the domain against this test's parser rather than against the shell.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

/**
 * The pair this file compares, and the words its report uses.
 *
 * `adapter=` / `production=` name the pair the other four corpus files compare.
 * Here neither side is production and neither is an adapter: they are two
 * implementations of one rule, so the report names them as such.
 */
const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

/**
 * The domain reading built from what the shell was given.
 *
 * `tier` and `text` do not reach `scoreItem` and are carried for the report's
 * sake — a disagreement has to name the item a person can find.
 */
const asItem = (row: SprintItemRow, tier: SprintItem['tier']): SprintItem => ({
  tier,
  checked: row.checked,
  plan: row.slug,
  text: row.text,
});

/** One item with the sprint it came from, so a disagreement can name both. */
interface Scored {
  /** The sprint's slug. */
  sprint: string;
  /** The item's slug, or its text where it names no plan. */
  subject: string;
  /** The shell's readings and verdict. */
  row: SprintItemRow;
  /** The domain reading assembled from those readings. */
  item: SprintItem;
}

/**
 * The shell's reading, as the domain expresses it.
 *
 * `item_state` takes `delivered` four-valued — `true`, `false`, `'none'`
 * meaning the line names no plan so nothing was looked up, and `'withdrawn'`
 * meaning the plan carries `State: Rejected` or `Superseded`. `scoreItem` took
 * a BOOLEAN until 2026-09-08, so `'none'` was inexpressible and a checked item
 * with no plan read `disputed` where the shell read `done`. That was this
 * file's declared divergence, and `a-sprint-item-has-one-scorer` closed it;
 * `a-withdrawn-item-is-not-open` added the fourth reading beside it.
 *
 * THE WORD IS TRANSLATED, NOT THE VERDICT. Each is the shell's spelling of a
 * reading the domain holds under another name; mapping one to a status here
 * would compare the domain against this test.
 */
const delivery = (row: SprintItemRow): PlanDelivery => {
  if (row.delivered === 'none') return 'no-plan-named';
  if (row.delivered === 'withdrawn') return 'withdrawn';
  return row.delivered;
};

let sprints: SprintRow[];
let scored: Scored[];

beforeAll(() => {
  sprints = listSprintSlugs(estate)
    .map((slug) => readSprintRelease(estate, slug))
    .filter((sprint): sprint is SprintRow => sprint !== null);
  scored = sprints.flatMap((sprint) =>
    (
      [
        ['must', sprint.must],
        ['should', sprint.should],
        ['could', sprint.could],
      ] as ReadonlyArray<readonly [SprintItem['tier'], SprintItemRow[]]>
    ).flatMap(([tier, rows]) =>
      rows.map((row) => ({
        sprint: sprint.sprint,
        subject: row.slug === '' ? `(no plan) ${row.text.slice(0, 60)}` : row.slug,
        row,
        item: asItem(row, tier),
      })),
    ),
  );
});

describe('scoreItem agrees with plot-sprint-release.sh item_state', () => {
  it('reads a corpus worth comparing', () => {
    // A FLOOR, because every assertion below is universally quantified and a
    // universal claim over an empty set is true. Measured 2026-09-07: 134 items
    // across 10 sprints. Asserted as an order of magnitude rather than a
    // constant, because a new sprint is a normal week here.
    expect(sprints.length).toBeGreaterThan(5);
    expect(scored.length).toBeGreaterThan(50);
  });

  it('exercises every answer the rule can give, so this is not vacuous', () => {
    // A comparison that can only pass proves nothing. Both sides answer three
    // words; if the estate only ever produced one, agreement would be an
    // accident of the corpus rather than a property of the pair.
    const states = new Set(scored.map((one) => one.row.state));
    expect([...states].sort()).toEqual(['disputed', 'done', 'open', 'withdrawn']);
    // And both readings `scoreItem` takes must vary, or the rule is being
    // asked one question repeatedly.
    expect(scored.some((one) => one.row.checked)).toBe(true);
    expect(scored.some((one) => !one.row.checked)).toBe(true);
    expect(scored.some((one) => one.row.delivered === true)).toBe(true);
    expect(scored.some((one) => one.row.delivered === false)).toBe(true);
    expect(scored.some((one) => one.row.delivered === 'withdrawn')).toBe(true);
  });

  it('answers what the shell answers, on every item on the estate', () => {
    // NO ITEM IS SKIPPED. This loop carried a `continue` for the plan-less
    // items until 2026-09-08, because the domain could not score them; the
    // whole corpus is now compared, which is what the plan's done-when asks.
    const found: Disagreement[] = [];
    for (const one of scored) {
      compareField(
        found,
        `${one.sprint} :: ${one.subject}`,
        'state',
        scoreItem(one.item, delivery(one.row)),
        one.row.state,
      );
    }
    // ONE comparison rather than an assertion per item: a failure has to name
    // every disagreeing item, because one item disagreeing and all 134
    // disagreeing are different findings pointing at different bugs.
    expect(found.map(report)).toEqual([]);
  });

  it('scores a withdrawn plan withdrawn, whatever its checkbox says', () => {
    // THE CHECKBOX STOPS MATTERING FOR THESE, and a corpus that only held
    // ticked ones would leave that unproven. Measured 2026-09-08: two items
    // point at Rejected plans and both are ticked, because ticking was the
    // workaround this plan removes — so the unticked arm is asserted against a
    // constructed item rather than claimed from the estate.
    const withdrawn = scored.filter((one) => one.row.delivered === 'withdrawn');
    expect(withdrawn.length).toBeGreaterThan(0);
    expect(withdrawn.every((one) => one.row.state === 'withdrawn')).toBe(true);
    for (const one of withdrawn) {
      expect(scoreItem({ ...one.item, checked: !one.item.checked }, 'withdrawn')).toBe('withdrawn');
    }
  });

  it('exercises the reading that used to diverge, so the fix is not vacuous', () => {
    // THE DIVERGENCE THIS FILE DECLARED, now asserted empty rather than named.
    // Emptiness alone would pass on an estate with no plan-less item, so the
    // corpus is first shown to CONTAIN the case — four items measured
    // 2026-09-08 — and only then shown to agree.
    const planless = scored.filter((one) => one.row.delivered === 'none');
    expect(planless.length).toBeGreaterThan(0);
    expect(planless.every((one) => one.row.slug === '')).toBe(true);
    // Both arms of the new reading are reached: a plan-less item is `done` when
    // ticked and `open` when not, and a corpus of only one would leave half the
    // branch unexercised.
    expect(planless.some((one) => one.row.checked)).toBe(true);
    const disagreeing = planless.filter(
      (one) => scoreItem(one.item, 'no-plan-named') !== one.row.state,
    );
    expect(disagreeing.map((one) => `${one.sprint} :: ${one.subject}`)).toEqual([]);
  });

  it('reports a disagreement naming the subject and both answers', () => {
    // THE REPORT IS THE DELIVERABLE, so it is asserted rather than assumed.
    // `"1 disagreement"` sends a reader to find it; this names the item and
    // what each side said.
    const line = report({
      subject: 'the-domain-owns-the-lifecycle :: the-scripts-say-slice',
      field: 'state',
      adapter: '"withdrawn"',
      production: '"open"',
    });
    expect(line).toBe(
      'the-domain-owns-the-lifecycle :: the-scripts-say-slice :: state :: rule="withdrawn" shell="open"',
    );
  });
});
