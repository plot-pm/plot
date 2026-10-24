// Contract test for the write-path mechanics `/plot-implement` steps 4 and 5
// must teach (docs/plans/2026-10-24-a-mixed-reset-leaves-the-main.md, Brief
// step slice). The incident: a brief commit landed on a HEAD 8 commits behind
// origin/main because the step never fetched first, then a second brief
// commit duplicated one origin/main already held, and the rejected push's
// recovery was a mixed `git reset` that stranded the main checkout's working
// tree. The Gate slice (PR #2640, merged) stops the mixed reset from landing;
// this slice stops the run from reaching that state — by teaching the SKILL
// text fetch-before-commit, skip-when-already-present, and re-cut-not-reset.
//
// NAMED SENTENCES, not occurrence counts — the same reason
// skills-say-slices.test.mjs and main-checkout-writers.test.mjs read specific
// lines rather than grepping a whole file: the step's prose is long, and a
// weak assertion (e.g. "mentions fetch") would pass on a fetch anywhere in
// the file, including step 2's unrelated staleness-preflight fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'plot-implement', 'SKILL.md');
const skill = readFileSync(skillPath, 'utf8');

/** The text of step 4 ("Hand-off Brief") through the end of step 5, where the commit mechanics this slice fixes live. */
const step4and5 = skill.slice(skill.indexOf('### 4. Hand-off Brief'), skill.indexOf('### 6. Summary'));

test('step 4/5 fetch origin/<default> immediately before committing, not only at step 2 staleness', () => {
  assert.match(
    step4and5,
    /git fetch origin ["$]/i,
    'the brief/Started commit mechanics must fetch origin/<default> right before committing',
  );
});

test('step 4/5 skip the commit when origin/<default> already holds a brief at the target path', () => {
  assert.match(
    step4and5,
    /already (holds|carries|has)\b.*brief/i,
    'the step must check whether origin/<default> already has the brief before writing a new commit',
  );
  assert.match(
    step4and5,
    /no second (brief )?commit|skip(s)? (the|writing (a|the)) (new )?commit|writes? no second/i,
    'the step must say explicitly that it writes no second commit for an already-present brief',
  );
});

test('step 4/5 recover from a rejected push by re-cutting in a disposable worktree, never by resetting', () => {
  assert.match(
    step4and5,
    /disposable worktree/i,
    'the recovery path must name a disposable worktree, the pattern plot-dispatch.sh\'s write_started_record already uses',
  );
  assert.match(
    step4and5,
    /never\b.*reset|reset\b.*never|does not reset|not (a |by )?(a )?(mixed )?reset/i,
    'the recovery path must rule out a git reset as the recovery mechanism',
  );
});

test('step 4/5 do not touch the Gate slice\'s own rule module or its gate wiring', () => {
  assert.doesNotMatch(
    step4and5,
    /main-checkout-write\.ts|gatesStrandingReset|strandsTree/,
    'this slice is scoped to brief/implement commit mechanics, not the Gate slice\'s domain rule (merged, PR #2640)',
  );
});
