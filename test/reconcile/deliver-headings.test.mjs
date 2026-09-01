// Contract test for the headings a delivery reads branches from.
//
// The plan format has three spellings for one section — `## Branches` (the
// original), `## Waves` (the migration) and `## Slices` (what DESIGN-slice.md
// settles on). `plot-plan-meta.sh` has read all three since the migration
// began; `plot-deliver.sh` read only the first two until 2026-08-30.
//
// THE FAILURE HAD NO SYMPTOM, which is why it needs a test rather than a fix
// alone. A `## Slices` plan parsed to an EMPTY branch list — not an error, not
// a warning, just nothing to check — so the delivery gate that exists to refuse
// a plan with unmerged branches would have passed it. Measured that day, two
// approved plans were in exactly that state, one of them already dispatched.
//
// REWRITTEN 2026-09-01, WHEN THE SUBJECT MOVED. This file used to read the
// `sed` range out of `plot-deliver.sh` and re-run it, on the sound reasoning
// that "a copy would pass while the script stayed broken". That was right while
// the script owned a regex. It now calls `plot-plan-meta.sh` — the plan-format
// contract — so there is no range to read, and a test asserting one exists was
// asserting the implementation rather than the guarantee.
//
// So it drives `plot-deliver.sh --dry-run` and reads what it REPORTS. That is
// the same anti-copy discipline one level out: nothing here re-implements the
// parse, and the assertion is the behaviour the gate depends on rather than the
// dialect of the sed that used to provide it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../../skills/plot/scripts/plot-deliver.sh');

const branchesFrom = (planBody) => {
  // A whole repo, because the script reads config and resolves a slug. Cheap:
  // no remote, no host, and `--dry-run` stops before any write.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deliver-headings-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '## Plot Config\n\n- **Plan directory:** docs/plans/\n'
      + '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n');
    fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-headings.md'), planBody);

    // The refusal names every unmerged branch, so on a plan whose branches have
    // no PRs the refusal IS the parse, reported by the script itself.
    let out = '';
    try {
      out = execFileSync('bash', [script, '--dry-run', 'headings'],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    // The refusal names the branches and then advises what to do about them.
    // Stop at the advice rather than at the newline: the guidance sat on its own
    // line until 2026-09-01 and now follows on the same one, and a test that
    // pinned either shape would break on the other while the PARSE — the thing
    // under test — was right both times.
    const m = out.match(/not merged: ([^\n]+?)(?:\.\s+Merge them first|\n|$)/);
    return m
      ? m[1].split(',').map((b) => b.trim().replace(/\.$/, '')).filter(Boolean).sort()
      : [];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// EACH SPELLING CARRIES ITS BRANCHES IN ITS OWN SHAPE, and the fixture has to
// respect that or it tests nothing. Under `## Waves` / `## Slices` the branch
// rides the `### ` heading as `(Branch: …)`; under `## Branches` it rides a
// bullet as `` - `branch` ``. `plot-plan-meta.sh` reads exactly one shape per
// spelling — a `### (Branch: …)` under `## Branches` parses to an EMPTY list,
// verified 2026-09-01.
//
// The previous version of this file used the heading shape for all three and
// passed, because it re-ran a `sed` range and grepped for `(Branch: …)`
// regardless of the heading above it. So its `## Branches` case never exercised
// the `## Branches` shape at all. Driving the script exposed that immediately.
const body = (heading) => heading === 'Branches'
  ? `# A plan

## Status

- **Phase:** Approved

## Branches

- \`feature/one-thing\` — the first
- \`feature/another-thing\` — the second

## Notes
`
  : `# A plan

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
