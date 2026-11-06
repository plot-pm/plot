import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { refsFixture } from '@plot-pm/domain/adapters';

import { buildBoard } from '../../src/server/board.js';
import { rmTree } from '../helpers.mjs';

/**
 * TWO PLANS SHARING A SLUG KEEP THEIR OWN FACTS. The slug is cut from the file
 * name after its date, so two plan files can share one; each card's facts are
 * read from its own file, keyed by the file's repo-relative path.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');

const plan = (title: string, started: string): string => [
  `# ${title}`,
  '',
  '## Status',
  '',
  '- **State:** Approved',
  '- **Type:** feature',
  '- **Review:** in-session',
  `- **Started:** ${started}`,
  '',
].join('\n');

const made: string[] = [];
const savedRoot = process.env.PLOT_REPO_ROOT;
afterEach(() => {
  if (savedRoot === undefined) delete process.env.PLOT_REPO_ROOT;
  else process.env.PLOT_REPO_ROOT = savedRoot;
  for (const dir of made.splice(0)) rmTree(dir);
});

describe('two plan files with one slug', () => {
  it('each card carries the facts of its own file', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'same-slug-facts-'));
    made.push(repoRoot);
    fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'docs/plans/2026-10-01-same.md'), plan('The October plan', '2026-10-02, alice, `feature/a`'), 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'docs/plans/2026-11-01-same.md'), plan('The November plan', '2026-11-02, bob, `feature/b`'), 'utf8');
    process.env.PLOT_REPO_ROOT = repoRoot;

    const board = await buildBoard({ repoRoot, scriptsDir: SCRIPTS_DIR, refs: refsFixture({}) });
    const cards = board.columns.flatMap((c) => c.cards).filter((c) => c.slug === 'same');
    expect(cards.map((c) => [c.path, c.facts.ownership.assignees, c.facts.ownership.assignedFrom]).sort()).toEqual([
      ['docs/plans/2026-10-01-same.md', { value: ['alice'] }, { source: 'started', at: '2026-10-02' }],
      ['docs/plans/2026-11-01-same.md', { value: ['bob'] }, { source: 'started', at: '2026-11-02' }],
    ]);
  });
});
