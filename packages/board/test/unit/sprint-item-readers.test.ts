import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { itemsFrom } from '../../src/server/entry/sprint-transition.js';
import { parseSprintFile } from '../../src/server/board.js';

// EVERY TEMP PATH THIS FILE CREATES, REMOVED BY THE EXACT NAME `mkdtempSync`
// RETURNED. This file created sandboxes and removed none, so each run left them
// in `TMPDIR`; `scripts/owned-run.sh` now fails a run that does.
//
// `rmTree` rather than a raw recursive `fs.rmSync`: CI's *A teardown does not
// race a child* step allows exactly ONE such call under `packages/board/test/`,
// and it is `rmTree`'s own body. `rmTree` also retries ENOTEMPTY/EBUSY/EPERM,
// which is what a teardown racing a still-running child throws.
//
// Never a glob and never a prefix sweep over the shared temp directory.
import { rmTree } from '../helpers.mjs';
const trackTemp = <T extends string>(dir: T): T => {
  trackedTempPaths.push(dir);
  return dir;
};
const trackedTempPaths: string[] = [];
afterAll(() => {
  for (const dir of trackedTempPaths) {
    try { rmTree(dir); } catch { /* a sandbox already gone is the wanted state */ }
  }
});


/**
 * THE TWO BOARD-SIDE READERS ANSWER THE SAME QUESTION.
 *
 * `itemsFrom` (the commit gate) and `parseSprintMembers` (the board) are
 * separate copies of one rule, and they have parted before: both required a
 * `[slug]` after the checkbox until 2026-09-25, and fixing only one would have
 * left the board dropping bare items while the transition accepted them — the
 * shape the plan calls *"green and wrong"*.
 *
 * `packages/domain/corpus/sprint-item.corpus.test.ts` pairs them against the
 * SHELL over the real estate, and it holds a third copy of this regex because
 * the domain may not import the board. That copy is what this file keeps
 * honest: the corpus asks whether the readers match `plot-sprint-release.sh`,
 * and this asks whether the shipped readers still match the copy the corpus
 * tests. Without it the replica could drift and the corpus would keep passing
 * while testing something no longer shipped.
 *
 * SO THE ASSERTION IS OVER BEHAVIOUR, NOT OVER THE REGEX SOURCE. Comparing the
 * pattern strings would fail on a harmless rewrite and pass on a rewrite that
 * changed meaning; comparing what each reader ANSWERS over the same lines is
 * the property that actually matters.
 */

/** The corpus file's copy, verbatim. A change here must be made there too. */
const CORPUS_MEMBER_LINE = /^- \[( |x)\] (?:(?:~~)?\[([a-z0-9][a-z0-9-]*)\]\s*)?(.*)$/;

/**
 * Lines exercising every shape this estate writes, plus the ones it must reject.
 *
 * EVERY SLUG IS DISTINCT ON PURPOSE. Both readers dedupe by slug, so a repeated
 * one would make the shipped readers keep fewer items than the raw regex
 * matches and this file would report a drift that is really the dedup working.
 * Dedup has its own tests; the subject here is which lines are items.
 */
const LINES = [
  '- [ ] rename the deploy step',
  '- [x] update the runbook',
  '- [ ] [a-plan] a linked item',
  '- [x] [b-plan](../plans/2026-01-01-b-plan.md) a full markdown link',
  '- [ ] ~~[c-plan]~~ struck through, bare reference',
  '- [x] ~~[d-plan](../plans/x.md)~~ struck through, full link',
  '- [ ] Close [#935](https://example.invalid/935) — a reference mid-text',
  '- [ ] [#1039](https://example.invalid/1039) — **an issue in the lead**, naming no plan',
  '- [x] an item ending in t',
  '- [ ] trailing annotation <!-- moved: 2026-01-01 -->',
  // Not items: no checkbox at all.
  '- **Renaming Endgame.** a prose bullet',
  '- a plain bullet',
  '  - [ ] an indented checkbox',
  'not a bullet at all',
];

const SPRINT = (body: string) =>
  `# Sprint: Fixture\n\n## Status\n\n- **Phase:** Active\n- **State:** Planning\n- **Release:** 9.9.0\n\n### Must Have\n\n${body}\n`;

/** Write a sprint file and read it back through `parseSprintFile`. */
const members = (body: string) => {
  const dir = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-readers-')));
  const abs = path.join(dir, '2026-W40-fixture.md');
  fs.writeFileSync(abs, SPRINT(body), 'utf8');
  return parseSprintFile(abs)!.members;
};

describe('the sprint-item readers agree with each other', () => {
  it('calls the same lines items', () => {
    const body = LINES.join('\n');
    const fromTransition = itemsFrom(SPRINT(body));
    const fromBoard = members(body);
    // Same count, same order, same slug and checkbox on every one.
    expect(fromBoard.length).toBe(fromTransition.length);
    expect(fromBoard.map((m) => m.slug)).toEqual(fromTransition.map((i) => i.plan));
    expect(fromBoard.map((m) => m.checked)).toEqual(fromTransition.map((i) => i.checked));
  });

  it('answers what the corpus copy of the rule answers', () => {
    // THE REPLICA GUARD. The corpus test cannot import this package, so its
    // copy is checked from this side instead.
    const viaCorpus = LINES.filter((l) => CORPUS_MEMBER_LINE.test(l));
    const viaShipped = itemsFrom(SPRINT(LINES.join('\n')));
    expect(viaShipped).toHaveLength(viaCorpus.length);
    expect(viaShipped.map((i) => i.plan)).toEqual(
      viaCorpus.map((l) => (l.match(CORPUS_MEMBER_LINE)![2] ?? '').trim()),
    );
  });

  it('reads ten of these fourteen lines as items', () => {
    // THE NUMBER, pinned: ten checkbox lines at the left margin, and four
    // that are not items — two prose bullets, an indented checkbox, and a line
    // that is not a bullet. A reader that started accepting the indented one
    // would widen what a sprint promises without anyone choosing that.
    //
    // Moved 9 -> 10 on 2026-09-29 with the issue-linked line below, which is
    // an item under every shape considered; the four non-items are unchanged.
    expect(itemsFrom(SPRINT(LINES.join('\n')))).toHaveLength(10);
    expect(members(LINES.join('\n'))).toHaveLength(10);
  });

  it('reads the slug through a strike, in both written forms', () => {
    // BOTH FORMS the estate writes, and this pin was INVERTED on 2026-09-29.
    // It asserted `['', '']` — the reading that made the board count W40's
    // withdrawn Should `open` while the release gate counted it `withdrawn`.
    // The shell has read through the strike since 2026-09-08
    // (`plot-sprint-release.sh:249`) and the release gate relies on it, so the
    // two TypeScript readers learned that rule rather than the shell losing it.
    //
    // The closing `~~` is deliberately not required: the second form wraps a
    // full markdown link, and anchoring on it reads that line as unstruck.
    const body = ['- [ ] ~~[c-plan]~~ bare', '- [x] ~~[d-plan](../plans/x.md)~~ linked'].join('\n');
    const fromTransition = itemsFrom(SPRINT(body));
    expect(fromTransition).toHaveLength(2);
    expect(fromTransition.map((i) => i.plan)).toEqual(['c-plan', 'd-plan']);
    expect(members(body).map((m) => m.slug)).toEqual(['c-plan', 'd-plan']);
  });

  it('reads an issue in the lead as an item naming no plan', () => {
    // THE SHAPE THIS PLAN CHOSE. A reference is a plan slug, so `[#1039](…)`
    // is text and the item names no plan — the answer the shell has always
    // given, and the one the release gate already acts on. It stays an ITEM:
    // a sprint committing to a ticket is a promise, and dropping the line
    // would understate what the sprint owes.
    const body = '- [ ] [#1039](https://example.invalid/1039) — **an issue**, naming no plan';
    const fromTransition = itemsFrom(SPRINT(body));
    expect(fromTransition).toHaveLength(1);
    expect(fromTransition[0].plan).toBe('');
    // The text keeps the issue link, so the line is still readable as what it
    // promised — an item naming no plan is not an item naming nothing.
    expect(fromTransition[0].text).toContain('#1039');
    expect(members(body).map((m) => m.slug)).toEqual(['']);
  });
});
