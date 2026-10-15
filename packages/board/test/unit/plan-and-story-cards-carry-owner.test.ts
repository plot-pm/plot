import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectStories } from '../../src/server/board.js';
import { CardSchema, StoryCardSchema } from '../../src/contract/schema.js';
import { controlsFor } from '../fixtures/card-controls.js';
import { rmTree } from '../helpers.mjs';

const trackedTempPaths: string[] = [];
afterAll(() => {
  for (const dir of trackedTempPaths) {
    try { rmTree(dir); } catch { /* a sandbox already gone is the wanted state */ }
  }
});

const storyFile = (frontmatter: string[]): string =>
  ['---', 'title: A story', 'status: active', ...frontmatter, '---', '', 'Objective.', ''].join('\n');

const storiesIn = async (frontmatter: string[], directory: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-owner-'));
  trackedTempPaths.push(root);
  const rel = 'docs/stories/s/STORY-s.md';
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), storyFile(frontmatter), 'utf8');
  return collectStories(root, 'docs/stories', [], undefined, undefined, directory);
};

describe('a story card carries its owner from storyCardView', () => {
  it('resolves the frontmatter author through People', async () => {
    const [card] = await storiesIn(['author: Jan Wloka'], { 'jan wloka': 'jwloka' });
    expect(card.owner).toBe('jwloka');
  });

  it('shows an author undeclared in People as written', async () => {
    const [card] = await storiesIn(['author: Somebody'], {});
    expect(card.owner).toBe('somebody');
  });

  it('carries no owner for a story with no author, never an empty name', async () => {
    const [card] = await storiesIn([], { 'jan wloka': 'jwloka' });
    expect(card.author).toBe('');
    expect(card.owner).toBeNull();
  });
});

describe('the card schema reads an absent owner as null', () => {
  it('defaults a plan card with no type label or owner to null', () => {
    const parsed = CardSchema.parse({
      slug: 'x', title: 'X', type: 'feature', phase: 'Discovery',
      path: 'docs/plans/x.md', prs: [], phaseDate: '', controls: controlsFor({ phase: 'Discovery' }),
    });
    expect(parsed.typeLabel).toBeNull();
    expect(parsed.owner).toBeNull();
  });

  it('defaults a story card with no owner to null', () => {
    expect(StoryCardSchema.shape.owner.parse(undefined)).toBeNull();
  });
});
