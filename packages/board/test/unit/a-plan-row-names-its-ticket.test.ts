import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, it, expect } from 'vitest';

import { buildBoard, planEstate } from '../../src/server/board.js';
import { type Card } from '../../src/contract/schema.js';
import { planNameLabel, tupleFromPlan } from '../../src/app/lib/tuple-row.js';
import { rmTree } from '../helpers.mjs';

/**
 * A PLAN ROW NAMES ITS TICKET — the server half and the label rule.
 *
 * The parser already emits `issues[]`; `PlanMetaSchema` stripped it, so the
 * key reached no card. The first assertion that catches a naive build is the
 * STRING `"1089"`: a builder forwarding the parser's number fails it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');

const plan = (phase: string, issue: string): string =>
  `# Fixture plan\n\n## Status\n\n- **Phase:** ${phase}\n- **Type:** feature\n- **Review:** in-session\n- **Issue:** ${issue}\n\n## Slices\n\n### One (Branch: feature/one)\n- do the thing\n`;

const made: string[] = [];
const estate = (plans: Record<string, string>, claudeMd?: string): { repoRoot: string; scriptsDir: string } => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-names-ticket-'));
  made.push(repoRoot);
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  for (const [slug, content] of Object.entries(plans)) {
    fs.writeFileSync(path.join(repoRoot, 'docs/plans', `2026-09-30-${slug}.md`), content, 'utf8');
  }
  if (claudeMd !== undefined) fs.writeFileSync(path.join(repoRoot, 'CLAUDE.md'), claudeMd, 'utf8');
  return { repoRoot, scriptsDir: SCRIPTS_DIR };
};

const savedRoot = process.env.PLOT_REPO_ROOT;
afterEach(() => {
  if (savedRoot === undefined) delete process.env.PLOT_REPO_ROOT;
  else process.env.PLOT_REPO_ROOT = savedRoot;
  for (const dir of made.splice(0)) rmTree(dir);
});

const cardsOf = (board: { columns: readonly { cards: readonly Card[] }[] }): readonly Card[] =>
  board.columns.flatMap((c) => c.cards);

describe('the server carries the plan\'s tracker keys as strings', () => {
  it('a plan naming #1089 yields a card with issues ["1089"]', async () => {
    const opts = estate({ answered: plan('Approved', '#1089') });
    process.env.PLOT_REPO_ROOT = opts.repoRoot;
    const card = cardsOf(await buildBoard(opts)).find((c) => c.slug === 'answered');
    expect(card?.issues).toEqual(['1089']);
  });

  it('a plan naming no issue yields issues []', async () => {
    const opts = estate({ quiet: plan('Approved', '') });
    process.env.PLOT_REPO_ROOT = opts.repoRoot;
    const card = cardsOf(await buildBoard(opts)).find((c) => c.slug === 'quiet');
    expect(card?.issues).toEqual([]);
  });

  it('a Draft plan naming #1090, #1091 yields a draft entry with ["1090", "1091"]', async () => {
    const opts = estate({ drafted: plan('Draft', '#1090, #1091') });
    process.env.PLOT_REPO_ROOT = opts.repoRoot;
    const { draftPlans } = await planEstate(opts, null, true);
    expect(draftPlans.find((d) => d.plan === 'drafted')?.issues).toEqual(['1090', '1091']);
  });

  it('a Jira tracker yields issues ["EWZKUS-3430"]', async () => {
    const opts = estate(
      { keyed: plan('Approved', 'EWZKUS-3430') },
      '# Fixture\n\n## Plot Config\n\n- **Tracker:** jira https://example.atlassian.net\n',
    );
    process.env.PLOT_REPO_ROOT = opts.repoRoot;
    const card = cardsOf(await buildBoard(opts)).find((c) => c.slug === 'keyed');
    expect(card?.issues).toEqual(['EWZKUS-3430']);
  });
});

describe('the plan row label', () => {
  const facts = { plan: 'a-plan', planFile: '2026-09-30-a-plan.md', phase: 'Development', waitingDays: null };

  it('prefixes the keys the way the ticket row prints them', () => {
    expect(tupleFromPlan({ ...facts, issues: ['1089'] }).name.label).toBe('1089: a-plan');
    expect(tupleFromPlan({ ...facts, issues: ['1090', '1091'] }).name.label).toBe('1090, 1091: a-plan');
    expect(tupleFromPlan({ ...facts, issues: ['EWZKUS-3430'] }).name.label).toBe('EWZKUS-3430: a-plan');
  });

  it('prints the slug alone where the plan names no issue', () => {
    expect(tupleFromPlan({ ...facts, issues: [] }).name.label).toBe('a-plan');
    expect(planNameLabel('a-plan')).toBe('a-plan');
  });

  it('keeps the link on the plan', () => {
    expect(tupleFromPlan({ ...facts, issues: ['1089'] }).name.href).toBe('/plan/2026-09-30-a-plan.md');
  });
});
