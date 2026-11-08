import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { branchClaims } from '../src/rules/cross-repo-reference.js';
import { annotateSlicePr } from '../src/rules/slice-pr-annotation.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';
import { listPlanFiles, type Estate } from './production.js';

/**
 * `annotateSlicePr` against `branchClaims`: does the recorder write each
 * branch's annotation on the line `branchClaims` reads it from?
 *
 * Both walk the slice sections through `sectionLines`. For every plan under
 * `docs/plans/` and every branch `branchClaims` reports, the recorder's edit
 * must change a line inside a slice section, and re-reading the edited file
 * must show the new PR on that branch. The subject is the plan's slug and the
 * compared reading is the number of the line the edit changed.
 *
 * ON A DISAGREEMENT THE BRANCH STOPS. Adjusting either side to make this pass is
 * the one move forbidden (`docs/shell-and-domain.md`).
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

const report = describingAs({ left: 'rule', right: 'shell' } satisfies Sides);
const PR = '999999';

const slugOf = (file: string): string => file.replace(/^.*\//, '').replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');

describe('annotateSlicePr against branchClaims', () => {
  let files: string[] = [];

  beforeAll(() => {
    files = listPlanFiles(estate);
  });

  it('records each claimed branch on a line branchClaims reads it from', () => {
    const found: Disagreement[] = [];
    for (const file of files) {
      const content = readFileSync(`${ROOT}/${file}`, 'utf8');
      const slug = slugOf(file);
      for (const { branch, reference } of branchClaims(content)) {
        // `annotateSlicePr` anchors to a list bullet; a heading claim has none.
        const result = annotateSlicePr(content, branch, PR);
        if (result.outcome === 'refused') {
          if (result.reason === 'branch-unaddressed') continue;
          const rule = result.reason === 'already-annotated' ? 'annotated' : result.reason;
          compareField(found, `annotate-vs-claims :: ${slug}`, `${branch} outcome`, rule, reference === null ? 'unannotated' : 'annotated');
          continue;
        }
        const before = content.split('\n');
        const after = result.content.split('\n');
        const changed = after.flatMap((line, i) => (line === before[i] ? [] : [i + 1]));
        const claimed = branchClaims(result.content).filter((c) => c.branch === branch).map((c) => c.reference?.number);
        compareField(found, `annotate-vs-claims :: ${slug}`, `${branch} recorded`, claimed.includes(Number(PR)), true);
        expect(changed, `${slug} ${branch} edits one line`).toHaveLength(1);
      }
    }
    expect(found.map(report)).toEqual([]);
  });
});
