import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSprintContent,
  parseStoryContent,
  UNADMITTED_STATE,
} from '../../src/server/board.js';
import { SprintStateSchema, StoryStatusSchema } from '../../src/contract/schema.js';

/**
 * The four files #726's refusal was about, read through the parsers that refuse.
 *
 * SLICE 1 BUILT THE RULE AND THIS IS THE ESTATE IT JUDGES. `parseSprintContent`
 * and `parseStoryContent` report `UNKNOWN` for a state the domain does not
 * admit; on 2026-09-06 four files stated one, so the same parsers that prove the
 * rule works are what prove these four now pass it.
 *
 * READ FROM THE REAL FILES, not from fixtures. A fixture asserting `done`
 * parses would pass on the day the estate regressed — the defect this closes was
 * a file nobody read, and only the file itself can say it is corrected.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');

/** The three the plan names, each carrying `status: archived` until this slice. */
const STORIES = [
  'plot-gates',
  'setup-asks-what-the-repo-already-knows',
  'the-board-is-blank-where-it-matters',
];

/** The one sprint, which carried `Phase: Planned`. */
const SPRINT = 'docs/sprints/2026-W36-a-half-landed-workflow-says-so.md';

const storyCard = (slug: string) => {
  const rel = path.join('docs/stories', slug, `STORY-${slug}.md`);
  const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return parseStoryContent(content, slug, rel, '');
};

describe('the three stories say a status the domain admits', () => {
  it.each(STORIES)('%s parses, and not as UNKNOWN', (slug) => {
    const card = storyCard(slug);
    expect(card).not.toBeNull();
    expect(card!.status).not.toBe(UNADMITTED_STATE);
    expect(StoryStatusSchema.safeParse(card!.status).success).toBe(true);
  });

  it.each(STORIES)('%s pairs its status with its archived: date, or neither', (slug) => {
    // The two writes `archivalIsConsistent` requires. Either alone is the
    // half-archived story `plot-story-lint.sh` reports as S3, which is why the
    // repair ran `archiveStory` rather than editing the status word.
    //
    // IT ASSERTS THE PAIRING, NOT THE WORD. Pinning `done` outlived the repair
    // it was written for: all three of these were re-opened on 2026-09-08, each
    // for a stated reason — every one had been archived with its Phase 2 marked
    // unstarted, and one carried a measurement that had since become false. A
    // test that fails when a story is legitimately re-opened is asserting the
    // estate's shape on the day it was written, and would be answered by
    // reverting a deliberate decision.
    //
    // What must hold in both directions is that the two writes agree: `done`
    // carries an `archived:` date, and anything else carries none.
    const rel = path.join('docs/stories', slug, `STORY-${slug}.md`);
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const status = storyCard(slug)!.status;
    const archived = /^archived: \d{4}-\d{2}-\d{2}$/m.test(content);
    expect(archived).toBe(status === 'done');
  });
});

describe('the sprint says a phase the domain admits', () => {
  it('parses, and not as UNKNOWN', () => {
    const content = fs.readFileSync(path.join(ROOT, SPRINT), 'utf8');
    const card = parseSprintContent(content, path.basename(SPRINT));
    expect(card).not.toBeNull();
    expect(card!.phase).not.toBe(UNADMITTED_STATE);
    expect(SprintStateSchema.safeParse(card!.phase).success).toBe(true);
  });
});

describe('no story or sprint on the estate states an unadmitted value', () => {
  // THE SWEEP THE DEFECT NEEDED AND NOBODY RAN. Three stories and a sprint sat
  // wrong for weeks because every reader took the file's word; this asserts the
  // whole estate against the parsers rather than the four files that were found.
  it('every story under docs/stories/ parses', () => {
    const root = path.join(ROOT, 'docs/stories');
    const offenders: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'archived') continue;
      const dir = path.join(root, entry.name);
      const file = fs.readdirSync(dir).find((f) => /^STORY-.*\.md$/.test(f));
      if (!file) continue;
      const slug = file.replace(/^STORY-(.+)\.md$/, '$1');
      const card = parseStoryContent(fs.readFileSync(path.join(dir, file), 'utf8'), slug, file, '');
      // `''` is an ABSENCE — a story naming no status — which is not a wrong
      // word and is not what this sweep is about.
      if (card && card.status !== '' && card.status === UNADMITTED_STATE) offenders.push(slug);
    }
    expect(offenders).toEqual([]);
  });

  it('every active sprint parses', () => {
    const root = path.join(ROOT, 'docs/sprints');
    const offenders: string[] = [];
    for (const file of fs.readdirSync(root)) {
      if (!file.endsWith('.md')) continue;
      const card = parseSprintContent(fs.readFileSync(path.join(root, file), 'utf8'), file);
      // `null` is not a sprint file at all — the answer a README gets.
      if (card && card.phase === UNADMITTED_STATE) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
