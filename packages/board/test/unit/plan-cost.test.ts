import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { buildBoard } from '../../src/server/board.js';
import { CardSchema, type Card } from '../../src/contract/schema.js';
import { costBadgeText, costBadgeDetail } from '../../src/app/components/PlanCard.js';
import type { SliceSpendRecord } from '@plot-pm/domain';
import { answered, failed, type PortResult } from '@plot-pm/domain';

/**
 * WHAT A PLAN'S CARD SAYS ABOUT WHAT ITS SLICES COST.
 *
 * Two halves, and the first is the one a naive implementation passes without.
 *
 * THE READ IS HOISTED, AND ONLY A CALL COUNT CAN SEE IT. Placing the reading
 * beside `planStatus` — which the slice's own Design sentence says — puts it
 * INSIDE `for (const meta of metas)`, and `sliceSpendFile` caches the resolved
 * directory rather than the contents, so `lines()` opens the record on every
 * call: roughly 290 `readFile`s per refresh on this estate. Every returned
 * value is IDENTICAL either way, which is exactly why the gate counts calls.
 *
 * THE CARD LEADS WITH COVERAGE. The four counters span five orders of
 * magnitude, so a glance reads the largest as the cost even though nothing
 * summed it. The badge says how much was measured; the counters are on the
 * tooltip, deferred rather than withheld.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');

/** A plan naming `count` slices, so the card has a denominator. */
function planFile(branches: string[]): string {
  const slices = branches
    .map((b, i) => `### Slice${i} (Branch: ${b})\n- do the thing\n`)
    .join('\n');
  return `# Fixture plan\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n- **Review:** in-session\n\n## Slices\n\n${slices}`;
}

/** A temp repo holding `plans` — slug → branch list. */
function withEstate(plans: Record<string, string[]>): { repoRoot: string; scriptsDir: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-cost-'));
  const plansDir = path.join(repoRoot, 'docs/plans');
  fs.mkdirSync(plansDir, { recursive: true });
  for (const [slug, branches] of Object.entries(plans)) {
    fs.writeFileSync(path.join(plansDir, `2026-09-16-${slug}.md`), planFile(branches), 'utf8');
  }
  return { repoRoot, scriptsDir: SCRIPTS_DIR };
}

/** One record line, as the worker writes it at `seal_declaration`. */
const line = (branch: string, inputTokens = 1): string =>
  JSON.stringify({
    branch,
    at: '2026-09-16T10:00:00.000Z',
    tokens: {
      inputTokens,
      outputTokens: 10,
      cacheCreationTokens: 100,
      cacheReadTokens: 1000,
    },
    turns: 1,
    models: ['claude-opus-5'],
  });

/**
 * A record port that COUNTS its reads.
 *
 * `lines` is the only operation a board build may reach; `sessions` opens a
 * desk's transcripts and throws here, because a render path that re-derives
 * would pass every correctness test and reintroduce the cost the record exists
 * to remove.
 */
function countingRecord(lines: readonly string[]): {
  port: SliceSpendRecord;
  reads: () => number;
} {
  let reads = 0;
  return {
    reads: () => reads,
    port: {
      location: () => answered('/tmp/nowhere/slice-spend.jsonl'),
      sessions: (): Promise<PortResult<never>> => {
        throw new Error('sessions() was called — a board path opened a transcript');
      },
      append: async () => {
        throw new Error('append() was called — rendering a cost writes nothing');
      },
      lines: async () => {
        reads += 1;
        return answered(lines);
      },
    } as unknown as SliceSpendRecord,
  };
}

/** Cards live under `columns`, so a slug lookup flattens them first. */
const cardFor = (board: { columns: readonly { cards: readonly Card[] }[] }, slug: string) =>
  board.columns.flatMap((c) => c.cards).find((c) => c.slug === slug);

/** Every card on the board, across all columns. */
const allCards = (board: { columns: readonly { cards: readonly Card[] }[] }): readonly Card[] =>
  board.columns.flatMap((c) => c.cards);

describe('the record is read ONCE per board build', () => {
  it('reads once for a five-plan estate, not once per plan', async () => {
    // THE GATE THE SLICE'S OWN WORDING WOULD FAIL. Five plans, one read. A
    // per-plan reading returns byte-identical cards and costs five file opens,
    // which is why this asserts the count and not the payload.
    const estate = withEstate({
      a: ['feature/a'],
      b: ['feature/b'],
      c: ['feature/c'],
      d: ['feature/d'],
      e: ['feature/e'],
    });
    const rec = countingRecord([line('feature/a'), line('feature/b')]);

    const board = await buildBoard({ ...estate, spendRecord: rec.port });

    expect(allCards(board).length).toBe(5);
    expect(rec.reads()).toBe(1);
  });

  it('opens no transcript — the board never reaches sessions()', async () => {
    // `sessions()` throws in the stub above, so reaching it fails the build.
    const estate = withEstate({ a: ['feature/a'] });
    const rec = countingRecord([line('feature/a')]);

    const board = await buildBoard({ ...estate, spendRecord: rec.port });

    expect(cardFor(board, 'a')?.cost?.measured).toBe(1);
  });
});

describe('the cost a card carries', () => {
  it('sums the measured slices and counts the rest', async () => {
    const estate = withEstate({ mixed: ['feature/one', 'feature/two', 'feature/three'] });
    const rec = countingRecord([line('feature/one', 5), line('feature/two', 7)]);

    const board = await buildBoard({ ...estate, spendRecord: rec.port });
    const cost = cardFor(board, 'mixed')?.cost;

    expect(cost?.tokens?.inputTokens).toBe(12);
    expect(cost?.measured).toBe(2);
    expect(cost?.absent).toBe(1);
    expect(cost?.unreadable).toBe(0);
    expect(cost?.slices).toBe(3);
  });

  it('reports NO total for a plan with nothing measured, never a zero', async () => {
    // `reduce(…, 0)` is correct arithmetic and a lie: it reports a plan nobody
    // measured as a free one.
    const estate = withEstate({ none: ['feature/never-ran'] });
    const rec = countingRecord([]);

    const board = await buildBoard({ ...estate, spendRecord: rec.port });
    const cost = cardFor(board, 'none')?.cost;

    expect(cost?.tokens).toBeNull();
    expect(cost?.measured).toBe(0);
    expect(cost?.absent).toBe(1);
  });

  it('keeps an UNREADABLE record apart from an absent one', async () => {
    // A failed call and an empty result are different answers, and collapsing
    // them is the failure this repo has shipped twice.
    const estate = withEstate({ broken: ['feature/x'] });
    const port = {
      location: () => answered('/tmp/nowhere'),
      sessions: () => { throw new Error('sessions()'); },
      append: async () => { throw new Error('append()'); },
      lines: async (): Promise<PortResult<readonly string[]>> => failed(),
    } as unknown as SliceSpendRecord;

    const board = await buildBoard({ ...withEstate({}), ...estate, spendRecord: port });
    const cost = cardFor(board, 'broken')?.cost;

    expect(cost?.unreadable).toBe(1);
    expect(cost?.absent).toBe(0);
    expect(cost?.tokens).toBeNull();
  });

  it('writes no fifth summed field — asserted on the KEY SET', async () => {
    // Prose cannot catch a helpful `total` beside the four, and neither can a
    // DOM test: a summed field sitting unrendered in the payload passes every
    // assertion about what the screen shows. `.strict()` on the schema is what
    // makes this a gate, and this proves the gate is wired.
    const estate = withEstate({ keys: ['feature/k'] });
    const rec = countingRecord([line('feature/k')]);

    const board = await buildBoard({ ...estate, spendRecord: rec.port });
    const cost = cardFor(board, 'keys')?.cost;

    expect(Object.keys(cost!.tokens!).sort()).toEqual([
      'cacheCreationTokens',
      'cacheReadTokens',
      'inputTokens',
      'outputTokens',
    ]);
    expect(Object.keys(cost!).sort()).toEqual([
      'absent',
      'measured',
      'slices',
      'tokens',
      'unreadable',
    ]);
    // And the schema REFUSES a fifth, rather than merely not producing one.
    expect(
      CardSchema.safeParse({
        ...cardFor(board, 'keys'),
        cost: { ...cost, tokens: { ...cost!.tokens, totalTokens: 1111 } },
      }).success,
    ).toBe(false);
  });

  it('attaches nothing to a plan that names no slices', async () => {
    // `0 of 0` is not a fact about cost. The field is left off, which is the
    // same silence `rounds` keeps for an unrecorded count.
    const estate = withEstate({ empty: [] });
    const rec = countingRecord([line('feature/elsewhere')]);

    const board = await buildBoard({ ...estate, spendRecord: rec.port });

    expect(cardFor(board, 'empty')?.cost).toBeUndefined();
  });
});

describe('the badge a reader sees', () => {
  const card = (over: Partial<Card> = {}): Card => ({
    slug: 'x', title: 'X', type: 'feature', phase: 'Development',
    path: 'docs/plans/2026-09-16-x.md', prs: [], phaseDate: '', ...over,
  });
  const cost = (over: Partial<NonNullable<Card['cost']>> = {}): Card['cost'] => ({
    tokens: {
      inputTokens: 502,
      outputTokens: 107_182,
      cacheCreationTokens: 528_331,
      cacheReadTokens: 40_690_450,
    },
    measured: 3, absent: 2, unreadable: 0, slices: 5, ...over,
  });

  it('leads with COVERAGE and shows no counter value', () => {
    // The card that "technically shows the cost" by printing 40,690,450 is the
    // failure this catches. The counters span five orders of magnitude, so the
    // eye takes the largest as the total even though nothing summed it.
    const text = costBadgeText(card({ cost: cost() }));

    expect(text).toBe('measured on 3 of 5 slices');
    for (const counter of ['502', '107182', '107,182', '528331', '40690450', '40,690,450']) {
      expect(text).not.toContain(counter);
    }
  });

  it('keeps the four counters REACHABLE, on the tooltip', () => {
    // Deferred, not withheld: refusing them at a glance is not refusing them.
    const detail = costBadgeDetail(card({ cost: cost() }));

    expect(detail).toContain('502');
    expect(detail).toContain('107,182');
    expect(detail).toContain('528,331');
    expect(detail).toContain('40,690,450');
    expect(detail).toContain('3 of 5 slices measured');
    expect(detail).toContain('2 not measured here');
  });

  it('says NOT MEASURED HERE rather than a zero', () => {
    expect(costBadgeText(card({ cost: cost({ tokens: null, measured: 0, absent: 5 }) })))
      .toBe('not measured here');
    expect(costBadgeText(card({ cost: cost({ tokens: null, measured: 0, absent: 0, unreadable: 5 }) })))
      .toBe('not measured here (5 unreadable)');
  });

  it('names an unreadable record beside a partial sum', () => {
    expect(costBadgeText(card({ cost: cost({ unreadable: 1 }) })))
      .toBe('measured on 3 of 5 slices · 1 unreadable');
  });

  it('renders exactly as today for a payload carrying no cost', () => {
    // Every existing board must be unaffected: a server too old to have looked
    // sends no field, and that is a third state apart from both zero and null.
    expect(costBadgeText(card())).toBe('');
    expect(costBadgeDetail(card())).toBe('');
    expect(CardSchema.safeParse(card()).success).toBe(true);
  });

  it('says nothing for a plan naming no slices', () => {
    expect(costBadgeText(card({ cost: cost({ slices: 0, measured: 0, absent: 0, tokens: null }) })))
      .toBe('');
  });
});
