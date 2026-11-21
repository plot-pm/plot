import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { refsFixture } from '@plot-pm/domain/adapters';

import { buildBoard } from '../../src/server/board.js';
import { rmTree } from '../helpers.mjs';

/**
 * THE BOARD CARRIES THE LAST RELEASE. `lastRelease` is the highest version the
 * plans' `Released:` records name, with that record's date; the Release group
 * names it where no release is targeted.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');

const plan = (title: string, released: string): string => [
  `# ${title}`,
  '',
  '## Status',
  '',
  '- **State:** Released',
  '- **Type:** feature',
  '- **Review:** in-session',
  `- **Released:** ${released}`,
  '',
].join('\n');

const made: string[] = [];
const savedRoot = process.env.PLOT_REPO_ROOT;
afterEach(() => {
  if (savedRoot === undefined) delete process.env.PLOT_REPO_ROOT;
  else process.env.PLOT_REPO_ROOT = savedRoot;
  for (const dir of made.splice(0)) rmTree(dir);
});

const boardOf = async (plans: Record<string, string>) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'last-release-'));
  made.push(repoRoot);
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  for (const [file, text] of Object.entries(plans)) fs.writeFileSync(path.join(repoRoot, 'docs/plans', file), text, 'utf8');
  process.env.PLOT_REPO_ROOT = repoRoot;
  return buildBoard({ repoRoot, scriptsDir: SCRIPTS_DIR, refs: refsFixture({}) });
};

describe('the board payload', () => {
  it('carries the highest released version and its date', async () => {
    const board = await boardOf({
      '2026-10-01-older.md': plan('The older plan', '2026-11-10, v2.10.0'),
      '2026-09-01-lower.md': plan('The lower plan', '2026-11-12, v2.9.0'),
    });
    expect(board.lastRelease).toEqual({ tag: 'v2.10.0', date: '2026-11-10' });
  });

  it('carries null where no plan is released', async () => {
    const board = await boardOf({});
    expect(board.lastRelease).toBeNull();
  });
});
