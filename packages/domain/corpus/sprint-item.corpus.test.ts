import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';
import { listSprintSlugs, readSprintRelease, type Estate, type SprintRow } from './production.js';

/**
 * DO THE THREE READERS AGREE ABOUT WHICH LINES ARE ITEMS, AND AT WHICH TIER?
 *
 * One sprint file format, three parsers. `sprint-score.corpus.test.ts` compares
 * the reading one level DOWN — what status an item has once it is an item. This
 * asks the question before it: is this line an item at all?
 *
 * | Reader | File | A bare `- [ ] task` |
 * |---|---|---|
 * | `emit_tier` | `plot-sprint-release.sh:230` | an item |
 * | `itemsFrom` | `entry/sprint-transition.ts` | an item, since 2026-09-25 |
 * | `parseSprintMembers` | `server/board.ts` | an item, since 2026-09-25 |
 *
 * Until 2026-09-25 the two TypeScript readers required a `[slug]` link after
 * the checkbox, so a bare item was two open Musts to the release gate and no
 * Must at all to the commit gate — one file, opposite answers, and no test
 * pairing them. `docs/shell-and-domain.md` is the contract: duplication is
 * allowed and UNDECLARED duplication is not, and *"what makes it safe is not
 * that one side is authoritative, it is that a test says they agree."*
 *
 * NEITHER SIDE IS AUTHORITATIVE HERE EITHER. On a disagreement the branch
 * stops, the finding names the population and its lines, and a person decides
 * which reader is wrong. Adjusting either side to make this pass is the one
 * move the contract forbids.
 *
 * WHAT IS COMPARED, AND WHY THE TEXT IS NOT. The question is *which lines are
 * items, at which tier* — so the comparison is the item SEQUENCE per sprint:
 * position, tier and checkbox, before any dedup. The item's text is excluded
 * because the shell's copy of it is lossy, which this file measured rather than
 * assumed; the slug is compared separately, so the one population that parts on
 * it is reported rather than hidden. All three limits are documented with their
 * counts at the foot of this file, so each is a stated limit and not a silence.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

/** The pair: two implementations of one reading, so neither is "production". */
const SIDES: Sides = { left: 'shell', right: 'typescript' };
const report = describingAs(SIDES);

/** The tiers `plot-sprint-release.sh` reports. `### Deferred` is not among them. */
const TIERS = ['must', 'should', 'could'] as const;
type Tier = (typeof TIERS)[number];

/**
 * One line a reader called an item.
 *
 * IDENTIFIED BY POSITION, not by text or slug. Both of those are things the
 * readers can legitimately differ on — and do, in the two populations named at
 * the foot of this file — so keying on either would fold a disagreement about a
 * FIELD into a disagreement about the row's IDENTITY, and the report would say
 * a line is missing from one side when both sides read it.
 */
interface ItemLine {
  /** The sprint's slug. */
  sprint: string;
  /** Its 0-based position among that sprint's items, in file order. */
  ordinal: number;
  /** The tier the reader assigned it. */
  tier: Tier;
  /** Whether the checkbox is ticked. */
  checked: boolean;
  /** The `[slug]` reference, or `''` where the line names none. */
  slug: string;
  /** The item's wording, for the report. Lossy on the shell side — see below. */
  text: string;
}

/**
 * The TypeScript readers' rule, replicated here from their own source.
 *
 * A DELIBERATE THIRD COPY, and the layering rule is why. `@plot-pm/domain` must
 * not import `@plot-pm/board` — the dependency points inward, and the board
 * depends on the domain. So the board-side regex is restated, and
 * `packages/board/test/unit/sprint-item-readers.test.ts` asserts the two
 * shipped readers still answer what this copy answers, which is what keeps it
 * honest. A copy nothing checks would let the pair part silently, which is the
 * very failure this file exists to catch.
 */
const MEMBER_LINE = /^- \[( |x)\] (?:\[([^\]]+)\]\s*)?(.*)$/;

const TIER_HEADINGS: ReadonlyArray<readonly [RegExp, Tier]> = [
  [/^### Must Have\b/, 'must'],
  [/^### Should Have\b/, 'should'],
  [/^### Could Have\b/, 'could'],
];

/**
 * Every line the TypeScript readers call an item, in file order.
 *
 * BEFORE DEDUP. Both readers dedupe by slug and the shell does not, so a
 * deduped comparison would disagree on the two files that list a slug twice —
 * a disagreement about membership, not about what an item is.
 */
const tsItems = (sprint: string, content: string): ItemLine[] => {
  const out: ItemLine[] = [];
  let tier: Tier | null = null;
  for (const line of content.split('\n')) {
    if (line.startsWith('### ') || line.startsWith('## ')) {
      tier = TIER_HEADINGS.find(([re]) => re.test(line))?.[1] ?? null;
      continue;
    }
    if (!tier) continue;
    const m = line.match(MEMBER_LINE);
    if (!m) continue;
    out.push({
      sprint,
      ordinal: out.length,
      tier,
      checked: m[1] === 'x',
      slug: (m[2] ?? '').trim(),
      text: (m[3] ?? '').trim(),
    });
  }
  return out;
};

/**
 * Every item the shell reported, in the order it reported them.
 *
 * THE TIER ORDER IS THE FILE ORDER. `emit_tier` is asked Must, then Should,
 * then Could, and a sprint file is written in that order — so concatenating the
 * three arrays reproduces the sequence `tsItems` reads top-down. A sprint whose
 * sections ran out of order would part here, and that would itself be a finding
 * worth having.
 */
const shellItems = (row: SprintRow): ItemLine[] => {
  const out: ItemLine[] = [];
  for (const tier of TIERS) {
    for (const item of row[tier]) {
      out.push({
        sprint: row.sprint,
        ordinal: out.length,
        tier,
        checked: item.checked,
        slug: item.slug,
        text: item.text,
      });
    }
  }
  return out;
};

/** The subject a disagreement names: one item, findable by a person. */
const subjectOf = (it: ItemLine): string =>
  `${it.sprint} :: item ${it.ordinal} (${it.tier}) ${it.slug !== '' ? `[${it.slug}]` : it.text.slice(0, 60)}`;

const shellSide: ItemLine[] = [];
const tsSide: ItemLine[] = [];
let sprints: string[] = [];

beforeAll(() => {
  sprints = listSprintSlugs(estate);
  for (const slug of sprints) {
    const row = readSprintRelease(estate, slug);
    if (!row) continue;
    shellSide.push(...shellItems(row));
    tsSide.push(...tsItems(row.sprint, readFileSync(join(ROOT, row.file), 'utf8')));
  }
});

describe('the three sprint-item readers agree about what an item is', () => {
  it('reads a corpus worth comparing', () => {
    // A GUARD, NOT A MEASUREMENT. If the estate ever reads as empty this file
    // would pass by comparing nothing — the failure mode every corpus test has
    // to close, because silence and agreement look identical. Measured
    // 2026-09-25: 14 sprints, 197 items.
    expect(sprints.length).toBeGreaterThan(0);
    expect(shellSide.length).toBeGreaterThan(20);
  });

  it('counts the same items in each sprint', () => {
    // THE HEADLINE. This is the number the bug moved: a sprint of bare Musts
    // read as 2 items to the shell and 0 to both TypeScript readers.
    const countBy = (rows: ItemLine[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const it of rows) m.set(it.sprint, (m.get(it.sprint) ?? 0) + 1);
      return m;
    };
    const shellCounts = countBy(shellSide);
    const tsCounts = countBy(tsSide);
    const found: Disagreement[] = [];
    for (const sprint of new Set([...shellCounts.keys(), ...tsCounts.keys()])) {
      compareField(found, sprint, 'item-count', shellCounts.get(sprint) ?? 0, tsCounts.get(sprint) ?? 0);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('reads the same item at each position, at the same tier and checkbox', () => {
    // THE SEQUENCE. A reader that dropped one line and kept the next would
    // still agree on the count only by accident; comparing position by position
    // is what makes the count meaningful.
    //
    // ONE EMPTY-ARRAY COMPARISON, never an assertion per item: a disagreement
    // stops the branch, and the report has to name every item that parted, not
    // only the first. One item disagreeing and all 197 are different findings.
    const key = (it: ItemLine) => `${it.sprint}#${it.ordinal}`;
    const byKey = new Map(tsSide.map((it) => [key(it), it]));
    const found: Disagreement[] = [];
    for (const it of shellSide) {
      const other = byKey.get(key(it));
      if (!other) {
        found.push({
          subject: subjectOf(it),
          field: 'is-item',
          adapter: `item(${it.tier})`,
          production: 'not-an-item',
        });
        continue;
      }
      compareField(found, subjectOf(it), 'tier', it.tier, other.tier);
      compareField(found, subjectOf(it), 'checked', it.checked, other.checked);
    }
    const shellKeys = new Set(shellSide.map(key));
    for (const it of tsSide) {
      if (shellKeys.has(key(it))) continue;
      found.push({
        subject: subjectOf(it),
        field: 'is-item',
        adapter: 'not-an-item',
        production: `item(${it.tier})`,
      });
    }
    expect(found.map(report)).toEqual([]);
  });

  it('reads the same slug for every item that is not struck through', () => {
    // THE SLUG IS COMPARED, and the one population that parts on it is excluded
    // BY NAME rather than by dropping the field. `~~[slug]~~` is how this estate
    // marks an item that left the sprint: the shell reads through the strike
    // (`plot-sprint-release.sh:249`), both TypeScript readers see it as text.
    // Measured 2026-09-25: exactly 4 lines, listed at the foot of this file.
    //
    // Excluding the population rather than the field is what keeps this honest
    // — a fifth struck-through line changes nothing, but a NEW kind of slug
    // disagreement still fails here.
    const key = (it: ItemLine) => `${it.sprint}#${it.ordinal}`;
    const byKey = new Map(tsSide.map((it) => [key(it), it]));
    const found: Disagreement[] = [];
    let struckThrough = 0;
    for (const it of shellSide) {
      const other = byKey.get(key(it));
      if (!other) continue; // the previous test's subject
      // The TypeScript side sees the whole `~~[slug]~~ …` as text, so that is
      // where the strike is detected — the shell has already resolved it away.
      // TWO WRITTEN FORMS, both measured on this estate: `~~[slug]~~` wraps a
      // bare reference, `~~[slug](../plans/x.md)~~` wraps a full markdown link.
      // The shell handles both because its own regex only needs the opening
      // `~~` and the bracket (`plot-sprint-release.sh:249`); anchoring on the
      // CLOSING `~~` caught the first form only and let the other two through.
      if (other.slug === '' && /^~~\[[^\]]+\]/.test(other.text)) {
        struckThrough += 1;
        continue;
      }
      compareField(found, subjectOf(it), 'slug', it.slug, other.slug);
    }
    expect(found.map(report)).toEqual([]);
    // THE EXCLUSION IS PINNED. If the count moves, the population changed and
    // this file's footnote is out of date — which is a finding, not a pass.
    expect(struckThrough).toBe(4);
  });
});

/**
 * THREE LIMITS, EACH MEASURED RATHER THAN ASSUMED.
 *
 * Every one is a real difference between the readers, and each is about a
 * neighbouring question rather than about which lines are items. Widening this
 * file to cover them would make it fail for reasons this plan did not set out
 * to settle, and adjusting a reader to silence one is the forbidden move. They
 * are named here with their counts, so each is a stated limit and not a
 * silence. Measured 2026-09-24, re-measured on the full estate 2026-09-25:
 * 14 sprints, 197 items.
 *
 * 1. STRUCK-THROUGH REFERENCES — 4 lines, and the slug test excludes them BY
 * NAME. `- [x] ~~[slug]~~ ...` is how this estate marks an item that left the
 * sprint. The shell reads the slug through an optional `~~`
 * (`plot-sprint-release.sh:249`); both TypeScript readers see `~~[slug]~~ ...`
 * as text and report the item with NO slug. They agree it is an item, at the
 * same tier, with the same checkbox — only the slug parts. The four:
 *   - `a-half-landed-workflow-says-so`, item 3 — `the-board-watches-instead-of-re-asking`
 *   - `the-domain-is-one-implementation`, item 5 — `the-board-suite-fits-its-budget`
 *   - `a-declared-agent-costs-what-it-costs`, items 7 and 9 —
 *     `a-connector-declares-its-ceiling`, `a-complete-page-is-not-truncated`
 * Whether the TypeScript readers should learn the strike-through is a follow-up
 * decision; it changes what a slug MEANS, not what an item is.
 *
 * 2. DUPLICATE SLUGS — 2 files, and this file compares before dedup because of
 * them. `2026-W34-working-shows-the-agent.md` and
 * `2026-W35-the-board-tells-the-truth-in-every-section.md` each list a slug
 * more than once, which is how a plan sliced across slices is written. The
 * shell reports every line; both TypeScript readers keep the first. That is a
 * disagreement about MEMBERSHIP versus LINES — both answers are right for their
 * own question, which is exactly the shape `refs-git.ts` and the scan's §22
 * already have.
 *
 * 3. THE ITEM'S TEXT IS NOT COMPARED, because the shell's copy of it is lossy —
 * and this is a DEFECT found by writing this file, not a property to design
 * around. `plot-sprint-release.sh:241` strips trailing whitespace with
 * `sed -E 's/[ \t]+$//'`. In a BSD `sed` bracket expression `\t` is not a tab:
 * the class is space, backslash and the letter **t**, so every item whose text
 * ends in `t` loses that character — `Plot` reported as `Plo`, `must` as `mus`,
 * `not-draft` as `not-draf`. Measured 2026-09-25: **16 items across 7 sprint
 * files.** `[[:space:]]` is the portable class and the one-word fix, but
 * `plot-sprint-release.sh` belongs to no slice of this plan, so this branch
 * reports it rather than reaching into a file it does not own. The comparison
 * above therefore keys on position and compares tier, checkbox and slug — every
 * field the defect does not touch.
 */
