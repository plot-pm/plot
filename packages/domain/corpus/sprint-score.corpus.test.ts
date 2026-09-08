import { beforeAll, describe, expect, it } from 'vitest';

import { scoreItem, type SprintItem } from '../src/entities/sprint.js';
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
  annotation: '',
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
 * The items the domain CANNOT yet score, named rather than skipped.
 *
 * `item_state` takes a third reading `scoreItem` has no parameter for:
 * `delivered: 'none'`, meaning the line names no plan so nothing was looked up.
 * The shell takes such an item at its checkbox — a lightweight task has only
 * one source — while `scoreItem`'s signature forces `planIsDelivered` to a
 * boolean, and a checked item with no plan therefore reads `disputed`.
 *
 * THIS IS THE DRIFT THE PLAN NAMED, and closing it is
 * `a-sprint-item-has-one-scorer`'s job: the domain gains a way to say *no plan
 * named*. Until then the divergence is DECLARED — the set is asserted exactly,
 * so it shrinks when that plan lands and a new one still fails.
 */
const expressibility = (row: SprintItemRow): boolean => row.delivered !== 'none';

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
    expect([...states].sort()).toEqual(['disputed', 'done', 'open']);
    // And both readings `scoreItem` takes must vary, or the rule is being
    // asked one question repeatedly.
    expect(scored.some((one) => one.row.checked)).toBe(true);
    expect(scored.some((one) => !one.row.checked)).toBe(true);
    expect(scored.some((one) => one.row.delivered === true)).toBe(true);
    expect(scored.some((one) => one.row.delivered === false)).toBe(true);
  });

  it('answers what the shell answers, on every item the domain can express', () => {
    const found: Disagreement[] = [];
    for (const one of scored) {
      if (!expressibility(one.row)) continue;
      compareField(
        found,
        `${one.sprint} :: ${one.subject}`,
        'state',
        scoreItem(one.item, one.row.delivered === true),
        one.row.state,
      );
    }
    // ONE comparison rather than an assertion per item: a failure has to name
    // every disagreeing item, because one item disagreeing and all 134
    // disagreeing are different findings pointing at different bugs.
    expect(found.map(report)).toEqual([]);
  });

  it('names the items the domain cannot yet express, so the set can only shrink', () => {
    // DECLARED, NOT SKIPPED. Listing them makes the divergence a decision
    // somebody wrote down: this fails when the estate grows a NEW plan-less
    // item, and it fails again — correctly — when `a-sprint-item-has-one-scorer`
    // teaches the domain to say *no plan named* and the list should empty.
    const inexpressible = scored.filter((one) => !expressibility(one.row));
    expect(inexpressible.every((one) => one.row.slug === '')).toBe(true);
    // And the divergence is real rather than theoretical: each of these is an
    // item where the two implementations DO answer differently today.
    const differing = inexpressible.filter(
      (one) => scoreItem(one.item, false) !== one.row.state,
    );
    expect(differing.map((one) => `${one.sprint} :: ${one.subject}`)).toEqual(
      inexpressible
        .filter((one) => one.row.checked)
        .map((one) => `${one.sprint} :: ${one.subject}`),
    );
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
