import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { crossRepoReferences } from '../src/rules/cross-repo-reference.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * Does `crossRepoReferences` answer what `plot-impl-status.sh`'s
 * `annotation_for` answers, over every `(repository, branch)` row a plan's
 * slice lines name?
 *
 * THE PAIR EXISTS ON PURPOSE. `docs/shell-and-domain.md` licenses a shell
 * duplicate run once per agent per pass; `plot-impl-status.sh` is read by every
 * worker, so it holds its own copy of the same reading rather than paying a
 * `node` hop. NEITHER SIDE IS AUTHORITATIVE — on a disagreement the branch
 * stops, and adjusting either side to make this pass is the one move
 * forbidden.
 *
 * BOTH REFERENCE FORMS ARE IN THE PRODUCT. A list claim's trailing
 * `→ owner/repo#N` and a heading's `PR: owner/repo#N` are read by different
 * regexes on both sides, and a plan carrying either form alone, or both, must
 * agree.
 *
 * THE MULTI-REPO CASE IS THE ONE THE PAIR EXISTS TO HOLD: a branch named in
 * several repositories is claimed on several lines, and the defect this
 * comparison guards against is either side collapsing to the first.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const IMPL_STATUS = `${ROOT}/skills/plot/scripts/plot-impl-status.sh`;

/** Two implementations of one rule, so neither is `adapter=` nor `production=`. */
const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

/** One plan fixture and the branch it is read for. */
interface Case {
  readonly name: string;
  readonly plan: string;
  readonly branch: string;
}

const plan = (...body: string[]): string =>
  ['# A plan', '', '## Status', '', '- **State:** Approved', '', ...body].join('\n');

const CASES: readonly Case[] = [
  {
    name: 'single list claim',
    plan: plan('## Slices', '', '- `feature/x` — the work → quatico/other#4711'),
    branch: 'feature/x',
  },
  {
    name: 'three repositories, one branch name',
    plan: plan(
      '## Slices', '',
      '- `infra/shared-name` — repo one → quatico/one#11',
      '- `infra/shared-name` — repo two → quatico/two#22',
      '- `infra/shared-name` — repo three → quatico/three#33',
    ),
    branch: 'infra/shared-name',
  },
  {
    name: 'heading PR: form',
    plan: plan('## Waves', '', '### One (Branch: feature/y, PR: acme/widget.js#7)', '', 'work'),
    branch: 'feature/y',
  },
  {
    name: 'same-repo arrow is not a cross-repo reference',
    plan: plan('## Branches', '', '- `feature/x` — work → #12'),
    branch: 'feature/x',
  },
  {
    name: 'un-annotated branch',
    plan: plan('## Slices', '', '- `feature/bare` — no annotation at all'),
    branch: 'feature/bare',
  },
];

/**
 * Every `(repo, number)` the shell's `annotations_for` reads for one branch.
 *
 * THE FUNCTION IS EXTRACTED, NOT THE WHOLE SCRIPT SOURCED: `plot-impl-status.sh`
 * resolves its plan from `origin/<default>` and runs real host calls at its top
 * level, so sourcing it whole would require a live checkout and a host. Only
 * `annotations_for` is under test, so `awk` pulls its body out by its opening
 * and closing brace — both at column 0, the shape every function in this file
 * takes. `BRANCHES_SECTION` and `WAVES_SECTION` are pulled out the same way,
 * BY LINE RATHER THAN RETYPED, so a hand-copied `sed` expression can never
 * drift from the one the script runs — which is exactly how the first draft of
 * this file disagreed with itself: a typo'd `BRANCHES_SECTION` pattern that
 * also matched `## Slices` double-counted every reference against the real
 * script's single-count behaviour.
 */
const SECTION_ASSIGNMENTS = execFileSync(
  'sed',
  ['-n', '/^BRANCHES_SECTION=/p;/^WAVES_SECTION=/p', IMPL_STATUS],
  { encoding: 'utf8' },
);
const ANNOTATIONS_FOR_FN = execFileSync(
  'awk',
  ['/^annotations_for\\(\\) \\{/,/^\\}/', IMPL_STATUS],
  { encoding: 'utf8' },
);

const shellReferences = (planText: string, branch: string): ReadonlyArray<{ repo: string; number: number }> => {
  const script = `
    set -euo pipefail
    PLAN_CONTENT=$(cat)
    ${SECTION_ASSIGNMENTS}
    ${ANNOTATIONS_FOR_FN}
    annotations_for ${JSON.stringify(branch)}
  `;
  const out = execFileSync('bash', ['-c', script], {
    input: planText,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [repo, number] = [line.slice(0, line.lastIndexOf('#')), line.slice(line.lastIndexOf('#') + 1)];
      return { repo, number: Number(number) };
    })
    // A bare `#N` carries no `/`, so `repo` is empty — not a cross-repo
    // reference, and dropped here exactly as `HEADING_REFERENCE`/`REFERENCE`
    // drop it on the rule side by requiring `owner/repo` before `#N`.
    .filter((one) => one.repo.includes('/'));
};

describe('crossRepoReferences agrees with plot-impl-status.sh annotations_for', () => {
  it('reads a corpus worth comparing', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(5);
  });

  it('exercises both an empty and a non-empty answer, so this is not vacuous', () => {
    const ruleCounts = CASES.map((one) => (crossRepoReferences(one.plan).get(one.branch) ?? []).length);
    expect(ruleCounts.some((n) => n === 0)).toBe(true);
    expect(ruleCounts.some((n) => n > 0)).toBe(true);
    expect(ruleCounts.some((n) => n > 1)).toBe(true);
  });

  it('answers what the shell answers, on every case', () => {
    const found: Disagreement[] = [];
    for (const one of CASES) {
      const rule = [...(crossRepoReferences(one.plan).get(one.branch) ?? [])]
        .map((r) => `${r.repo}#${r.number}`)
        .sort();
      const shell = [...shellReferences(one.plan, one.branch)]
        .map((r) => `${r.repo}#${r.number}`)
        .sort();
      compareField(found, one.name, 'cross-repo-references', rule, shell);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('keeps every repository for a branch named in several, on both sides', () => {
    const multi = CASES.find((one) => one.name === 'three repositories, one branch name')!;
    const rule = crossRepoReferences(multi.plan).get(multi.branch) ?? [];
    expect(rule.map((r) => r.repo).sort()).toEqual(['quatico/one', 'quatico/three', 'quatico/two']);
    expect(shellReferences(multi.plan, multi.branch).map((r) => r.repo).sort()).toEqual([
      'quatico/one',
      'quatico/three',
      'quatico/two',
    ]);
  });
});
