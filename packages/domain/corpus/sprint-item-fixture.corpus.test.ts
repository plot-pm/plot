import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';
import { listSprintSlugs, readSprintRelease, type Estate } from './production.js';

/**
 * THE FOUR SHAPES, READ BY ALL THREE READERS, OVER A FIXTURE RATHER THAN THE
 * ESTATE.
 *
 * `sprint-item.corpus.test.ts` compares the readers over `docs/sprints/`, which
 * is the right corpus for *does this repository parse consistently today*. It
 * cannot answer *does an issue-linked item parse consistently*, because
 * **the estate holds none**: `f6c7c9ef` rewrote W40 on 2026-09-28 and the count
 * has been 0 ever since, re-measured 2026-09-29 across all 16 sprint files. A
 * test over the estate alone would report agreement about a shape nobody wrote.
 *
 * So this file writes the shapes and runs the SHIPPED readers over them:
 *
 * | shape | written | a reference? |
 * |---|---|---|
 * | plan-linked | `[a-slug](…)` | yes — `a-slug` |
 * | struck-through | `~~[b-slug](…)~~` | yes — `b-slug`, the strike is read through |
 * | issue-linked | `[#1039](…)` | no — an item naming no plan |
 * | bare | no bracket at all | no — an item naming no plan |
 * | malformed | an unclosed bracket | no — and still an item |
 *
 * **THE COMPARISON GOES THROUGH THE REAL READERS.** `plot-sprint-release.sh` is
 * executed against the fixture repository, and the TypeScript side is asserted
 * in `packages/board/test/unit/sprint-item-readers.test.ts`, which drives
 * `itemsFrom` and `parseSprintFile` themselves. The sibling corpus file's
 * replicated regex is a third copy that a fix could turn green on its own —
 * editing it alone leaves the board's reading unchanged, which is exactly the
 * failure this pair of files exists to prevent.
 *
 * **THE FIXTURE IS NOT THE ESTATE, deliberately.** A sprint file added under
 * `docs/sprints/` would be a real sprint: the board would render it, the
 * release gate would read its `Release:` target, and `plot-reconcile-scan.sh`
 * §16 would report its state against `active/`. `Estate.root` is a parameter,
 * so the fixture gets its own repository in a temp directory with the real
 * scripts symlinked in — the script under test is the shipped one, and nothing
 * about this repository changes.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const SIDES: Sides = { left: 'shell', right: 'typescript' };
const report = describingAs(SIDES);

/**
 * The fixture sprint. Every shape on its own line, at a tier the shell reports.
 *
 * The two plan-linked items name plans the fixture estate also writes, so the
 * shell's `plan_delivery` lookup has something to resolve; an unresolvable slug
 * would score every line the same way and hide the distinction being tested.
 */
const SPRINT = `# Sprint: Shapes

> Every item shape this format admits, in one file.

## Status

- **State:** Active
- **Start:** 2026-09-28
- **End:** 2026-10-04
- **Release:** 9.9.0

## Sprint Goal

Exercise the four shapes.

### Must Have

- [ ] [a-plan-linked-item](../plans/2026-09-01-a-plan-linked-item.md) — names a plan
- [ ] ~~[a-withdrawn-item](../plans/2026-09-01-a-withdrawn-item.md)~~ — **withdrawn**, and the strike is read through

### Should Have

- [ ] [#1039](https://example.invalid/issues/1039) — **an issue in the lead**, naming no plan
- [ ] a bare task with no reference at all

### Could Have

- [ ] [an-unclosed-bracket — malformed, and still an item
`;

/** A plan the fixture's Musts can resolve against. */
const plan = (slug: string, state: string) => `# ${slug}

## Status

- **State:** ${state}
- **Type:** feature

## Changelog

- A fixture plan.
`;

let estate: Estate;
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'plot-sprint-shapes-'));
  mkdirSync(join(root, 'docs/sprints'), { recursive: true });
  mkdirSync(join(root, 'docs/plans/delivered'), { recursive: true });
  mkdirSync(join(root, 'skills/plot'), { recursive: true });
  // The SHIPPED scripts, not a copy: the subject is what this repository runs.
  symlinkSync(join(ROOT, 'skills/plot/scripts'), join(root, 'skills/plot/scripts'));
  writeFileSync(
    join(root, 'CLAUDE.md'),
    '# Fixture\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Sprint directory:** docs/sprints/\n',
  );
  writeFileSync(join(root, 'docs/sprints/2026-W40-shapes.md'), SPRINT);
  writeFileSync(
    join(root, 'docs/plans/2026-09-01-a-plan-linked-item.md'),
    plan('a-plan-linked-item', 'Approved'),
  );
  writeFileSync(
    join(root, 'docs/plans/2026-09-01-a-withdrawn-item.md'),
    plan('a-withdrawn-item', 'Rejected'),
  );
  estate = { root };
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('the four item shapes read the same way in the shell and in TypeScript', () => {
  it('reads the fixture sprint at all', () => {
    // THE GUARD every corpus file needs: silence and agreement look identical,
    // so a fixture that failed to resolve must fail here rather than pass by
    // comparing nothing.
    expect(listSprintSlugs(estate)).toEqual(['shapes']);
    const row = readSprintRelease(estate, 'shapes');
    expect(row).not.toBeNull();
    expect([...row!.must, ...row!.should, ...row!.could]).toHaveLength(5);
  });

  it('reads a reference only where the line names a plan slug', () => {
    // THE SHAPE THIS PLAN CHOSE, asserted on the shell — the reader the release
    // gate actually consumes (`entry/release-gate.ts:216` is the only writer of
    // `sprintItems`). `packages/board/test/unit/sprint-item-readers.test.ts`
    // asserts the same five answers on the two TypeScript readers.
    const row = readSprintRelease(estate, 'shapes')!;
    const slugs = [...row.must, ...row.should, ...row.could].map((i) => i.slug);
    expect(slugs).toEqual(['a-plan-linked-item', 'a-withdrawn-item', '', '', '']);
  });

  it('tells a malformed item from a legal one that names no plan', () => {
    // THE DISTINCTION THE PLAN REQUIRES, asserted on WHAT THE RELEASE GATE
    // RECEIVES rather than on a parser's internals. All three of the last
    // shapes report slug `''`, so the slug alone cannot separate them — the
    // item's TEXT is what carries the difference, and it reaches the gate:
    // `release.ts` names each unfinished Must by `[${i.plan}]`, and a person
    // reading a refusal sees the line.
    const row = readSprintRelease(estate, 'shapes')!;
    const [issueLinked, bare] = row.should;
    const [malformed] = row.could;
    for (const item of [issueLinked, bare, malformed]) expect(item.slug).toBe('');
    // Each is still distinguishable, and each is still an item.
    expect(issueLinked.text).toContain('#1039');
    expect(bare.text).toContain('a bare task');
    expect(malformed.text).toContain('an-unclosed-bracket');
  });

  it('scores an issue-linked item as open rather than as withdrawn or done', () => {
    // WHAT THE GATE DOES WITH IT. An unticked item naming no plan is `open`,
    // which `release.ts:178-180` counts as unfinished — so a sprint that
    // commits to a ticket is held to it. That is the outcome shape 2 could not
    // produce: under an issue field a TICKED issue-only Must scores `disputed`,
    // which is also unfinished, and the sprint becomes uncloseable.
    const row = readSprintRelease(estate, 'shapes')!;
    const [issueLinked, bare] = row.should;
    expect(issueLinked.state).toBe('open');
    expect(bare.state).toBe('open');
    // And the strike still reaches `withdrawn` through the plan it names, which
    // is the reading the release gate already relies on.
    expect(row.must[1].state).toBe('withdrawn');
    expect(row.must[1].delivered).toBe('withdrawn');
  });

  it('agrees with the replicated TypeScript rule on every shape', () => {
    // The sibling corpus file's copy of the readers' regex, applied to the same
    // five lines. A disagreement is reported as a list, the way every corpus
    // file reports one: a person decides which reader is wrong.
    const MEMBER_LINE = /^- \[( |x)\] (?:(?:~~)?\[([a-z0-9][a-z0-9-]*)\]\s*)?(.*)$/;
    const row = readSprintRelease(estate, 'shapes')!;
    const shell = [...row.must, ...row.should, ...row.could];
    const ts = SPRINT.split('\n')
      .map((line) => line.match(MEMBER_LINE))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => (m[2] ?? '').trim());
    expect(ts).toHaveLength(shell.length);
    const found: Disagreement[] = [];
    shell.forEach((item, i) => {
      compareField(found, `shapes :: item ${i}`, 'slug', item.slug, ts[i]);
    });
    expect(found.map(report)).toEqual([]);
  });
});

/**
 * WHAT THIS FILE DOES NOT ASSERT.
 *
 * **The item's text is not compared across the pair.** The shell keeps the whole
 * line including a struck reference; the TypeScript readers consume the
 * reference and keep the remainder. That is a pre-existing difference, named as
 * limit 3 in the sibling file along with the BSD `sed` defect at
 * `plot-sprint-release.sh:241`, and neither is this branch's to fix.
 *
 * **A malformed item is not refused.** `- [ ] [an-unclosed-bracket — …` reads as
 * an item naming no plan, which is the same answer a bare task gets. The plan
 * requires the two to stay DISTINGUISHABLE, and they are — by their text, which
 * reaches the gate — not that the format rejects the second.
 */
