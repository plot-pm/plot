// Contract test for the heading plot-deliver.sh reads branches from.
//
// The plan format has three spellings for one section — `## Branches` (the
// original), `## Waves` (the migration) and `## Slices` (what DESIGN-slice.md
// settles on). `plot-plan-meta.sh` has read all three since the migration
// began; `plot-deliver.sh` read only the first two until 2026-08-30.
//
// THE FAILURE HAD NO SYMPTOM, which is why it needs a test rather than a fix
// alone. A `## Slices` plan parsed to an EMPTY branch list here — not an error,
// not a warning, just nothing to check — so the delivery gate that exists to
// refuse a plan with unmerged branches would have passed it. Measured that day,
// two approved plans were in exactly that state, one of them already dispatched.
//
// The test drives the script's own extraction rather than re-implementing the
// sed range: a copy would pass while the script stayed broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../../skills/plot/scripts/plot-deliver.sh');

// The one line of plot-deliver.sh under test, read FROM the script so the test
// cannot drift away from it: if someone edits the range, this reads the edit.
const sedRange = (() => {
  const src = fs.readFileSync(script, 'utf8');
  const m = src.match(/branches_section=\$\(printf '%s' "\$plan_content" \| sed -n '([^']+)'/);
  assert.ok(m, 'could not find the branches_section sed range in plot-deliver.sh');
  return m[1];
})();

const branchesFrom = (planBody) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deliver-headings-'));
  try {
    const plan = path.join(dir, 'plan.md');
    fs.writeFileSync(plan, planBody);
    const out = execFileSync('sh', ['-c',
      `sed -n '${sedRange}' "$1" | grep -oE '### .*\\(Branch: (feature|bug|docs|infra|idea)/[A-Za-z0-9_./-]+' | sed 's/.*Branch: //' | sort -u || true`,
      'sh', plan], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const body = (heading) => `# A plan

## Status

- **Phase:** Approved

## ${heading}

### First (Branch: feature/one-thing)

Prose about the first slice.

### Second (Branch: feature/another-thing)

Prose about the second.

## Notes
`;

// One named test per spelling. `node:test` has no `.each`, so the cases are
// spread by iteration either way — `forEach` keeps the file's arrow style, and
// the runner already names each case, so nothing is lost in diagnosis.
['Slices', 'Waves', 'Branches'].forEach((heading) => {
  test(`reads branches from a ## ${heading} heading`, () => {
    assert.deepEqual(branchesFrom(body(heading)),
      ['feature/another-thing', 'feature/one-thing']);
  });
});

test('a Slices plan does not parse to an empty list', () => {
  // The regression in its own words: empty is the dangerous answer, because the
  // delivery gate reads "no unmerged branches" from it and lets the plan through.
  assert.notDeepEqual(branchesFrom(body('Slices')), []);
});
