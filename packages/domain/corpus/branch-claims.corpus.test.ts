import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { branchClaims, DEFAULT_BRANCH_PREFIXES, parseBranchPrefixes } from '../src/rules/cross-repo-reference.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';
import { listPlanFiles, readPlanMeta, type Estate } from './production.js';

/**
 * `branchClaims` against `plot-plan-meta.sh`: do they name the same branches
 * for every plan under `docs/plans/`?
 *
 * Both read the branches a plan's slice sections claim. `plot-plan-meta.sh`
 * claims a list line only when its token starts with a `Branch prefixes` entry;
 * `branchClaims` takes the same entries as a parameter. The subject is the plan's
 * slug and the compared reading is the sorted set of branch names.
 *
 * ON A DISAGREEMENT THE BRANCH STOPS. Adjusting either side to make this pass is
 * the one move forbidden (`docs/shell-and-domain.md`).
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

/** Plans a file-list line under `## Slices` made `plot-deliver --release` refuse, 2026-11-07. */
const REFUSED_SLUGS: readonly string[] = [
  'continue-and-the-agent-panel-refuse',
  'controller-gate-refuses-read-only-commands',
  'open-plot-review-findings-from-the',
  'partial-board-pulse-reported-as-unknown',
  'plot-fleetctl-stop-unloads-another-checkout',
  'restart-refuses-unknown-branch-when-it',
];

/**
 * Plans whose heading names its branch in backticks, `(Branch: \`infra/x\`)`.
 * `plot-plan-meta.sh` reads that spelling and `HEADING_CLAIM` does not, so the
 * rule reads no branch where the shell reads three. The divergence predates the
 * prefix filter and the brief leaves `HEADING_CLAIM` unchanged; it is declared
 * here, with both readings, so that a change to either side fails this file.
 */
const KNOWN_DIVERGENCES: ReadonlyMap<string, { rule: string[]; shell: string[] }> = new Map([
  [
    'a-parsed-plan-joins-the-index',
    {
      rule: [],
      shell: [
        'infra/a-parsed-plan-joins-the-index',
        'infra/the-parse-is-a-pure-function',
        'infra/the-scan-reads-the-plan-index',
      ],
    },
  ],
  [
    'the-board-updates-an-index',
    {
      rule: [],
      shell: [
        'bug/every-tool-call-updates-the-index',
        'bug/the-board-updates-an-index',
        'bug/the-index-serves-its-consumers',
      ],
    },
  ],
]);

const slugOf = (file: string): string => file.replace(/^.*\//, '').replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');

const sorted = (names: Iterable<string>): string[] => [...new Set(names)].sort();

/** The branch names `plot-plan-meta.sh` read, in its two dialects. */
const shellBranches = (record: Record<string, unknown>): string[] => {
  const waves = (record.waves ?? []) as { branches?: { branch: string }[] }[];
  return sorted([
    ...((record.branches ?? []) as string[]),
    ...waves.flatMap((wave) => (wave.branches ?? []).map((b) => b.branch)),
  ]);
};

const prefixes = parseBranchPrefixes(
  execFileSync('bash', [`${ROOT}/skills/plot/scripts/plot-config.sh`, 'get', 'Branch prefixes', ''], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim() || DEFAULT_BRANCH_PREFIXES.join(', '),
);

describe('branchClaims against plot-plan-meta.sh', () => {
  let files: string[] = [];
  let records: Record<string, unknown>[] = [];

  beforeAll(() => {
    files = listPlanFiles(estate);
    records = readPlanMeta(estate, files);
  });

  it('names the same branches for every plan', () => {
    expect(records.length).toBe(files.length);
    const found: Disagreement[] = [];
    files.forEach((file, i) => {
      const rule = sorted(branchClaims(readFileSync(`${ROOT}/${file}`, 'utf8'), prefixes).map((c) => c.branch));
      const slug = slugOf(file);
      const shell = shellBranches(records[i]!);
      const known = KNOWN_DIVERGENCES.get(slug);
      if (known !== undefined) {
        expect({ rule, shell }, `${slug} diverges as declared`).toEqual(known);
        return;
      }
      compareField(found, `branchclaims-vs-plan-meta :: ${slug}`, 'branches', rule, shell);
    });
    expect(found.map(report)).toEqual([]);
  });

  it.each(REFUSED_SLUGS)('reads %s, which a file-list line made refuse', (slug) => {
    const file = files.find((f) => slugOf(f) === slug);
    expect(file, `${slug} is under docs/plans/`).toBeDefined();
    const names = branchClaims(readFileSync(`${ROOT}/${file}`, 'utf8'), prefixes).map((c) => c.branch);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(prefixes.some((p) => name.startsWith(`${p}/`))).toBe(true);
  });

  it('answers alike on a path and an idea plan, and parts on a glob as declared', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-branch-claims-'));
    try {
      const file = join(dir, '2026-11-07-tokens.md');
      const text = [
        '# T', '', '## Status', '', '- **State:** Approved', '- **Type:** bug', '',
        '## Slices', '', '### One', '',
        '- `bug/real` — work',
        '- `docs/plans/a.md` — a path',
        '- `bug/*` — a glob',
        '- `idea/some-plan` — a plan',
        '- `skills/plot-fleet/SKILL.md` — a path',
        '',
      ].join('\n');
      writeFileSync(file, text);
      const [record] = readPlanMeta(estate, [file]);
      // `plot-plan-meta.sh` claims every backticked token after a prefix, `bug/*`
      // included; `branchClaims` reads `[A-Za-z0-9_./-]` and so reads no glob.
      // Both claim a path under a prefix (`docs/plans/a.md`) and `idea/some-plan`.
      // The glob is the one declared difference; the rest must agree.
      const rule = sorted(branchClaims(text, prefixes).map((c) => c.branch));
      const shell = shellBranches(record!).filter((name) => name !== 'bug/*');
      expect(shellBranches(record!)).toContain('bug/*');
      const found: Disagreement[] = [];
      compareField(found, 'branchclaims-vs-plan-meta :: tokens', 'branches', rule, shell);
      expect(found.map(report)).toEqual([]);
      expect(rule).toEqual(['bug/real', 'docs/plans/a.md', 'idea/some-plan']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
