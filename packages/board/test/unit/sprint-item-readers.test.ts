import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { itemsFrom } from '../../src/server/entry/sprint-transition.js';
import { parseSprintFile } from '../../src/server/board.js';

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
const CORPUS_MEMBER_LINE = /^- \[( |x)\] (?:\[([^\]]+)\]\s*)?(.*)$/;

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-readers-'));
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

  it('reads nine of these thirteen lines as items', () => {
    // THE NUMBER, pinned: nine checkbox lines at the left margin, and four
    // that are not items — two prose bullets, an indented checkbox, and a line
    // that is not a bullet. A reader that started accepting the indented one
    // would widen what a sprint promises without anyone choosing that.
    expect(itemsFrom(SPRINT(LINES.join('\n')))).toHaveLength(9);
    expect(members(LINES.join('\n'))).toHaveLength(9);
  });

  it('agrees that a struck-through reference is an item with no slug', () => {
    // BOTH FORMS the estate writes. This is the population the corpus test
    // excludes BY NAME from its slug comparison, because the shell reads the
    // slug through the strike and these two do not. Pinning the behaviour here
    // is what makes that exclusion a stated difference rather than a guess.
    const body = ['- [ ] ~~[c-plan]~~ bare', '- [x] ~~[d-plan](../plans/x.md)~~ linked'].join('\n');
    const fromTransition = itemsFrom(SPRINT(body));
    expect(fromTransition).toHaveLength(2);
    expect(fromTransition.map((i) => i.plan)).toEqual(['', '']);
    expect(members(body).map((m) => m.slug)).toEqual(['', '']);
  });
});
