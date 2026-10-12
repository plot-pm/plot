import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, it, expect } from 'vitest';

import { refsFixture } from '@plot-pm/domain/adapters';
import { failed } from '@plot-pm/domain';

import { buildBoard } from '../../src/server/board.js';
import { type Card } from '../../src/contract/schema.js';
import { rmTree } from '../helpers.mjs';

/**
 * A DELIVERED CARD CARRIES ITS VERIFICATION — the scan's half.
 *
 * Plan file: docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md
 *
 * The scan asks `recordCommit(<repo-relative file>, 'Delivered')` for each
 * Delivered plan and hands the answer to `verificationOf`. The refs fixture
 * answers only for the key `<rel>\tDelivered`, so a wrong path or field reads
 * `null` and the commit-based `stale` arm does not fire.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');

const DELIVERY = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
const RECORD = '2026-10-20, delivery 2026-10-19 at 1a2b3c4, judged at 1a2b3c4 with tools at 9f8e7d6, 1 supported, 2 refuted';

const plan = (state: string): string => [
  '# Fixture plan',
  '',
  '## Status',
  '',
  `- **State:** ${state}`,
  '- **Type:** feature',
  '- **Review:** in-session',
  '- **Delivered:** 2026-10-19',
  `- **Verified:** ${RECORD}`,
  '',
  '## Verification',
  '',
  '- Claim-1 supported — Does a thing — 3 of 3 (executed: behaviour)',
  '- Claim-2 refuted — Does another — behaviour refuted — #1712',
  '- Claim-3 refuted — Does a third — changelog refuted — no issue: none',
  '',
].join('\n');

const REL = 'docs/plans/2026-10-19-checked.md';

const made: string[] = [];
const estate = (state: string): { repoRoot: string; scriptsDir: string } => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'delivered-verification-'));
  made.push(repoRoot);
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, REL), plan(state), 'utf8');
  return { repoRoot, scriptsDir: SCRIPTS_DIR };
};

const savedRoot = process.env.PLOT_REPO_ROOT;
afterEach(() => {
  if (savedRoot === undefined) delete process.env.PLOT_REPO_ROOT;
  else process.env.PLOT_REPO_ROOT = savedRoot;
  for (const dir of made.splice(0)) rmTree(dir);
});

const cardOf = async (state: string, recordCommits: Record<string, string>): Promise<Card | undefined> => {
  const opts = estate(state);
  process.env.PLOT_REPO_ROOT = opts.repoRoot;
  const board = await buildBoard({ ...opts, refs: refsFixture({ recordCommits }) });
  return board.columns.flatMap((c) => c.cards).find((c) => c.slug === 'checked');
};

describe('the scan reads the delivery commit of a Delivered plan', () => {
  it('answers refuted with the count when the delivery commit matches the record', async () => {
    const card = await cardOf('Delivered', { [`${REL}\tDelivered`]: DELIVERY });
    expect(card?.verification).toEqual({ state: 'refuted', refuted: 2, badge: '2 refuted' });
  });

  it('answers stale when the delivery commit differs from the record', async () => {
    const card = await cardOf('Delivered', { [`${REL}\tDelivered`]: 'f'.repeat(40) });
    expect(card?.verification).toEqual({ state: 'stale', refuted: 2, badge: '' });
  });

  it('attaches no verification to an Approved card', async () => {
    const card = await cardOf('Approved', { [`${REL}\tDelivered`]: DELIVERY });
    expect(card).toBeDefined();
    expect(card?.verification).toBeUndefined();
  });

  it('attaches no verification when the delivery commit cannot be read', async () => {
    const opts = estate('Delivered');
    process.env.PLOT_REPO_ROOT = opts.repoRoot;
    const refs = { ...refsFixture({}), recordCommit: async () => failed<string | null>() };
    const board = await buildBoard({ ...opts, refs });
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.slug === 'checked');
    expect(card).toBeDefined();
    expect(card?.verification).toBeUndefined();
  });
});
