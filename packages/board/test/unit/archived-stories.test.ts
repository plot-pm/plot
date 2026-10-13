import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectArchivedStories, collectStories } from '../../src/server/board.js';
import type { Refs } from '@plot-pm/domain/ports/refs';
import { rmTree } from '../helpers.mjs';

const trackedTempPaths: string[] = [];
afterAll(() => {
  for (const dir of trackedTempPaths) {
    try { rmTree(dir); } catch { /* a sandbox already gone is the wanted state */ }
  }
});

const story = (title: string): string =>
  ['---', `title: ${title}`, 'status: done', '---', '', 'A story.', ''].join('\n');

const refsWith = (blobs: Record<string, string>): Refs =>
  ({
    listBlobs: async () => ({
      ok: true,
      value: Object.keys(blobs).map((p, i) => ({ path: p, sha: `sha${i}`, mode: '100644' as const })),
    }),
    readBlobs: async (shas: readonly string[]) => ({
      ok: true,
      value: new Map(shas.map((sha, i) => [sha, Object.values(blobs)[i] ?? ''])),
    }),
  }) as unknown as Refs;

const sandbox = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archived-stories-'));
  trackedTempPaths.push(root);
  return root;
};

const write = (root: string, rel: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content, 'utf8');
};

describe('archivedStories reads the archived location only', () => {
  it('lists a story under archived/ and keeps it out of stories', async () => {
    const root = sandbox();
    write(root, 'docs/stories/archived/old/STORY-old.md', story('Old'));
    write(root, 'docs/stories/live/STORY-live.md', story('Live'));

    const archived = await collectArchivedStories(root, 'docs/stories', []);
    const live = await collectStories(root, 'docs/stories', []);
    expect(archived.map((s) => s.slug)).toEqual(['old']);
    expect(live.map((s) => s.slug)).toEqual(['live']);
  });

  it('reads archived/ under a declared Story directory, not the default', async () => {
    const root = sandbox();
    write(root, 'work/stories/archived/old/STORY-old.md', story('Old'));
    write(root, 'docs/stories/archived/other/STORY-other.md', story('Other'));

    const archived = await collectArchivedStories(root, 'work/stories', []);
    expect(archived.map((s) => s.slug)).toEqual(['old']);
  });

  it('answers [] where no archived directory exists', async () => {
    const root = sandbox();
    write(root, 'docs/stories/live/STORY-live.md', story('Live'));
    expect(await collectArchivedStories(root, 'docs/stories', [])).toEqual([]);
  });

  it('reads the ref and lets it win over the working tree', async () => {
    const root = sandbox();
    write(root, 'docs/stories/archived/shared/STORY-shared.md', story('Checkout copy'));
    write(root, 'docs/stories/archived/local/STORY-local.md', story('Local only'));

    const archived = await collectArchivedStories(
      root,
      'docs/stories',
      [],
      'origin/main',
      refsWith({
        'docs/stories/archived/shared/STORY-shared.md': story('Ref copy'),
        'docs/stories/live/STORY-live.md': story('Live'),
      }),
    );
    expect(archived.map((s) => [s.slug, s.title]).sort()).toEqual([
      ['local', 'Local only'],
      ['shared', 'Ref copy'],
    ]);
  });
});
