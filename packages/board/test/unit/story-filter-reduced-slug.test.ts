import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { passesFilter } from '../../src/app/lib/filters.js';
import { buildLanes } from '../../src/app/components/Swimlanes.js';
import { board, card, story } from '../catalogue/build.js';
import { SCRIPTS_DIR, rmTree } from '../helpers.mjs';

/**
 * Issue #2411: `plot-plan-meta.sh` reduces a `Story:` Markdown link to its
 * text, so `/api/board` carries the slug on `card.story` — never the raw
 * link. Neither the story filter nor the lane grouping changes for this: both
 * already compare `card.story` to a plain slug, which is what the parser now
 * guarantees. Built from `/api/board`'s real schema (the catalogue), not a
 * hand-written `card.story`, so a card the server could never actually send
 * cannot make this pass.
 */
describe('story filter and lanes over a reduced slug', () => {
  const SLUG = 'kanban-board';

  it('the parser reduces a Markdown-link Story: field to its text', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-story-reduce-'));
    const plan = path.join(dir, '2026-08-24-a-plan.md');
    fs.writeFileSync(plan, [
      '# A plan', '', '## Status', '',
      '- **Phase:** Draft',
      `- **Story:** [${SLUG}](docs/stories/${SLUG}/STORY-${SLUG}.md)`,
      '', '## Changelog', '', '- a plan', '',
    ].join('\n'), 'utf8');
    const out = execFileSync('bash', [path.join(SCRIPTS_DIR, 'plot-plan-meta.sh'), plan], {
      encoding: 'utf8',
    });
    const meta = JSON.parse(out.trim()) as { story: string };
    expect(meta.story).toBe(SLUG);
    rmTree(dir);
  });

  it('the story filter selects a card whose story is the reduced slug', () => {
    const b = board({
      columns: [{ phase: 'Development', cards: [card({ slug: 'a-plan', phase: 'Development', story: SLUG })] }],
      stories: [story({ slug: SLUG })],
    });
    const plan = b.columns[0].cards[0];
    expect(passesFilter(plan, [SLUG], 'story', '__no_story__')).toBe(true);
    expect(passesFilter(plan, ['other-slug'], 'story', '__no_story__')).toBe(false);
  });

  it('a card whose story is the reduced slug sits in that slug\'s lane', () => {
    const plan = card({ slug: 'a-plan', phase: 'Development', story: SLUG });
    const lanes = buildLanes([plan], [story({ slug: SLUG })]);
    const lane = lanes.find((l) => l.key === SLUG);
    expect(lane, 'the slug gets its own lane').toBeTruthy();
    expect(lane?.cards.map((c) => c.slug)).toEqual(['a-plan']);
  });
});
