import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectStories } from '../../src/server/board.js';
import { CardSchema, StoryCardSchema } from '../../src/contract/schema.js';
import { controlsFor } from '../fixtures/card-controls.js';
import { planFactsOf } from '../../src/server/plan-facts.js';
import { rmTree } from '../helpers.mjs';
import type { StoryFactsContext } from '../../src/server/story-facts.js';

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
  const context: StoryFactsContext = {
    issueContext: { issuePrefix: null, jiraProjects: [] }, plans: new Map(), sprints: [], directory,
  };
  return collectStories(root, 'docs/stories', [], undefined, undefined, context);
};

describe("a story card's assignee is its author, through storyCardFacts", () => {
  it('resolves the frontmatter author through People', async () => {
    const [card] = await storiesIn(['author: Jan Wloka'], { 'jan wloka': 'jwloka' });
    expect(card.facts?.ownership.assignees).toEqual({ value: ['jwloka'] });
  });

  it('shows an author undeclared in People as written', async () => {
    const [card] = await storiesIn(['author: Somebody'], {});
    expect(card.facts?.ownership.assignees).toEqual({ value: ['somebody'] });
  });

  it('reads a story with no author as unassigned, never an empty name', async () => {
    const [card] = await storiesIn([], { 'jan wloka': 'jwloka' });
    expect(card.author).toBe('');
    expect(card.facts?.ownership.assignees).toEqual({ value: [] });
  });
});

describe('an absent owner reads as null', () => {
  it('a plan card with no type and no assignee says so in its facts', () => {
    const fields = CardSchema.omit({ facts: true }).parse({
      slug: 'x', title: 'X', type: '', phase: 'Discovery',
      path: 'docs/plans/x.md', prs: [], phaseDate: '', controls: controlsFor({ phase: 'Discovery' }),
    });
    const facts = planFactsOf(fields);
    expect(facts.identity.type).toBeNull();
    expect(facts.ownership.assignees).toEqual({ value: [] });
  });

  it('carries no facts on a story card the board built none for', () => {
    expect(StoryCardSchema.shape.facts.parse(undefined)).toBeUndefined();
  });
});
