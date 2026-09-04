import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectStories } from '../../src/server/board.js';
import type { Refs } from '@plot-pm/domain/ports/refs';

/**
 * STORIES COME FROM THE SAME REF THE PLANS DO.
 *
 * The board reads plans from `origin/<main>` through the `Refs` port, and read
 * stories from the WORKING TREE alone until 2026-09-04. So a checkout whose
 * `docs/stories/` differed from that ref showed its plans and an EMPTY Stories
 * filter — and an empty Topics list with it, since topics are derived from
 * stories. Reported against the published board, where `repoRoot` defaults to
 * `process.cwd()` and need not be the repository at all.
 *
 * `collectSprints` already merged both sources one-directionally. These tests
 * hold stories to the same contract.
 */
const STORY = [
  '---',
  'title: The fixture story',
  'status: active',
  '---',
  '',
  'A story.',
  '',
].join('\n');

/** A `Refs` double answering one story file, and nothing else. */
const refsWith = (blobs: Record<string, string>): Refs =>
  ({
    listBlobs: async () => ({
      ok: true,
      value: Object.keys(blobs).map((p, i) => ({
        path: p,
        sha: `sha${i}`,
        mode: '100644' as const,
      })),
    }),
    readBlobs: async (shas: readonly string[]) => ({
      ok: true,
      value: new Map(
        shas.map((sha, i) => [sha, Object.values(blobs)[i] ?? '']),
      ),
    }),
  }) as unknown as Refs;

const emptyRepo = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stories-ref-'));
  return root;
};

describe('a story reaches the board from the ref, not only from the checkout', () => {
  it('finds a story the ref carries and the working tree does not', async () => {
    // THE REPORTED FAILURE. Before the fix this answered [] — the checkout has
    // no `docs/stories/` at all, which is every published-board run from a
    // directory that is not the repository.
    const repoRoot = emptyRepo();
    const stories = await collectStories(
      repoRoot,
      'docs/stories',
      [],
      'origin/main',
      refsWith({ 'docs/stories/the-fixture/STORY-the-fixture.md': STORY }),
    );
    expect(stories.map((s) => s.slug)).toEqual(['the-fixture']);
  });

  it('reads the working tree when no ref is given, as it always did', async () => {
    // The caller with neither `ref` nor `refs` must behave exactly as before:
    // `resolveStoryFile` is one such caller and passes neither.
    const repoRoot = emptyRepo();
    const dir = path.join(repoRoot, 'docs/stories/on-disk');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'STORY-on-disk.md'), STORY, 'utf8');

    const stories = await collectStories(repoRoot, 'docs/stories', []);
    expect(stories.map((s) => s.slug)).toEqual(['on-disk']);
  });

  it('takes the ref over the working tree when both carry a slug', async () => {
    // The one-directional merge `collectSprints` makes: the ref wins, and the
    // working tree may only ADD a story the ref lacks.
    const repoRoot = emptyRepo();
    const dir = path.join(repoRoot, 'docs/stories/shared');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'STORY-shared.md'),
      STORY.replace('title: The fixture story', 'title: The checkout copy'),
      'utf8',
    );

    const stories = await collectStories(
      repoRoot,
      'docs/stories',
      [],
      'origin/main',
      refsWith({ 'docs/stories/shared/STORY-shared.md': STORY }),
    );
    expect(stories).toHaveLength(1);
    expect(stories[0].title).toBe('The fixture story');
  });

  it('skips an archived story on the ref path, as the walk always has', async () => {
    const repoRoot = emptyRepo();
    const stories = await collectStories(
      repoRoot,
      'docs/stories',
      [],
      'origin/main',
      refsWith({ 'docs/stories/archived/old/STORY-old.md': STORY }),
    );
    expect(stories).toEqual([]);
  });
});
