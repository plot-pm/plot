import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { PlanRecord } from '@plot-pm/domain/ports/plan-store';
import { cardControls } from '@plot-pm/domain/rules/card-controls';
import { sliceReadingsOf } from '@plot-pm/domain/rules/slice-readings';
import { spikeCardState } from '@plot-pm/domain/rules/spike-confirm';
import { approvedSpikeKey, planEstate } from '../../src/server/board.js';
import { spikeBranchOfRecord } from '../../src/server/entry/gate.js';
import { planGateAnswer } from '../../src/server/entry/plangate.js';
import { rmTree } from '../helpers.mjs';

/**
 * Every reader of a `Spike approved:` record names the same licensed branch,
 * or none. A seventh reader that tests the record for emptiness fails the
 * source reading at the end.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');
const SERVER = path.resolve(HERE, '../../src/server');
const DOMAIN_RULES = path.resolve(HERE, '../../../domain/src/rules');

const FIXTURES: { name: string; record: string; licensed: string | null }[] = [
  { name: 'bound', record: '2026-11-03, jwloka, in-session, feature/a', licensed: 'feature/a' },
  { name: 'moved marker', record: '2026-11-03, jwloka, in-session, feature/b', licensed: null },
  { name: 'renamed branch', record: '2026-11-03, jwloka, in-session, feature/c', licensed: null },
  { name: 'date-only', record: '2026-11-03', licensed: null },
  { name: 'three-field', record: '2026-11-03, jwloka, in-session', licensed: null },
  { name: 'unparseable', record: '2026-11-03, jwloka, in-session, feature/a extra', licensed: null },
];

const slices = [
  { name: 'First', branches: [{ branch: 'feature/a', spike: true }] },
  { name: 'Second', branches: [{ branch: 'feature/b' }] },
];

const planText = (record: string): string =>
  `# P\n\n## Status\n\n- **Phase:** Design\n- **Type:** feature\n- **Spike approved:** ${record}\n\n## Slices\n\n### First (Branch: \`feature/a\`) <!-- spike -->\n- a\n\n### Second (Branch: \`feature/b\`)\n- b\n`;

const made: string[] = [];
const savedRoot = process.env.PLOT_REPO_ROOT;
afterEach(() => {
  if (savedRoot === undefined) delete process.env.PLOT_REPO_ROOT;
  else process.env.PLOT_REPO_ROOT = savedRoot;
  for (const dir of made.splice(0)) rmTree(dir);
});

describe('the readers of a Spike approved: record agree', () => {
  for (const { name, record, licensed } of FIXTURES) {
    it(`${name} licenses ${licensed ?? 'nothing'} in every reader`, async () => {
      const plan = { file: 'p.md', phase: 'design', spikeApprovedRaw: record, slices } as unknown as PlanRecord;

      const readings = sliceReadingsOf(plan, [0, 0]);
      expect(readings.map((r) => r.spike && r.spikeApproved)).toEqual([licensed !== null, false]);

      const meta = JSON.stringify({ file: 'p.md', phase: 'design', impl: 'own-branches', spike_approved_raw: record, slices });
      const gate = planGateAnswer(
        { slug: 'p', source: 'origin/main', defaultBranch: 'main', refResolved: true, allowLocal: false, branch: 'feature/a' },
        meta,
      );
      expect(gate.code).toBe(licensed !== null ? 0 : 1);

      const fromRecord = spikeBranchOfRecord(plan);
      expect(fromRecord.licensed ? fromRecord.branch : null).toBe(licensed);

      const card = cardControls({ state: 'design', status: 'draft', started: false, slices, spikeApproved: record });
      expect(card.approveSpike).toBe(licensed === null);
      expect(spikeCardState({ state: 'design', slices, spikeApproved: record })).toBe(
        licensed === null ? 'spike-not-approved' : 'spike-approved',
      );

      const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'licensed-spike-'));
      made.push(repoRoot);
      fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'docs/plans/2026-11-04-p.md'), planText(record), 'utf8');
      process.env.PLOT_REPO_ROOT = repoRoot;
      const { approvedSpikes } = await planEstate({ repoRoot, scriptsDir: SCRIPTS_DIR }, null, true);
      expect([...approvedSpikes]).toEqual(
        licensed === null ? [] : [approvedSpikeKey('docs/plans/2026-11-04-p.md', licensed)],
      );
    });
  }
});

describe('no reader tests the record for emptiness', () => {
  const sources: [string, boolean][] = [
    [path.join(SERVER, 'board.ts'), true],
    [path.join(SERVER, 'entry/gate.ts'), true],
    [path.join(SERVER, 'entry/plangate.ts'), true],
    [path.join(DOMAIN_RULES, 'slice-readings.ts'), true],
  ];
  for (const [file, imports] of sources) {
    it(`${path.relative(path.resolve(HERE, '../../..'), file)} asks licensedSpike`, () => {
      const text = fs.readFileSync(file, 'utf8');
      if (imports) expect(text).toMatch(/import\s*\{[^}]*\blicensedSpike\b[^}]*\}\s*from/);
      expect(text).not.toMatch(/spike_approved_raw\.trim\(\)/);
      expect(text).not.toMatch(/spikeApprovedRaw\.trim\(\)/);
      expect(text).not.toMatch(/spikeApprovedRaw\s*!==\s*''/);
    });
  }
});
