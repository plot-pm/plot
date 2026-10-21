// Contract test for `plot-review-status.sh` tolerating a sprint line with no
// `[slug]`. Under `set -euo pipefail`, `grep -oE` finding no match exits 1,
// and that status used to carry out of the `$(...)` substitution and end the
// script before `[ -z "$ITEM_SLUG" ] && continue` ever ran — a no-match is an
// ordinary line, not an error, and must not abort the loop.
//
// Lifted from the fix's brief: a plain line must sit BEFORE at least one item
// that should appear in the output, or a loop that silently stops early would
// still pass. The test runs the UNFIXED script first and pins exit code 1, so
// a future revert of the fix is caught here rather than only in production.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const script = path.join(root, 'skills', 'plot', 'scripts', 'plot-review-status.sh');

const made = [];
const tmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `plot-${tag}-`));
  made.push(d);
  return d;
};
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A bare sandbox repo with its own `docs/sprints/` and no `origin` branch to
 * find — `git ls-remote origin <branch>` then returns nothing, so an
 * annotated line with `branch:` reads `head_sha: branch-not-found` and
 * `needs_review: true` rather than resolving a real remote.
 */
function sandboxRepo(sprintBody) {
  const t = tmp('review-status');
  const origin = path.join(t, 'origin.git');
  const repo = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', origin);
  git(t, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repo, 'docs', 'sprints'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'sprints', '2026-10-21-a-sprint.md'), sprintBody);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  return repo;
}

function run(repo) {
  const env = { ...process.env };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  return spawnSync('bash', [script, 'a-sprint'], { encoding: 'utf8', cwd: repo, env });
}

const SPRINT_BODY = [
  '# A sprint',
  '',
  '## Items',
  '',
  '- [ ] [plan-one] a plan item with no annotation',
  '- [ ] a plain item with no slug at all',
  '- [ ] [plan-two] a plan item with an annotation <!-- pr: #9, branch: feature/plan-two, review_sha: deadbeef -->',
  '',
].join('\n');

test('a plain item with no [slug] sitting before an annotated item does not abort the scan', () => {
  const repo = sandboxRepo(SPRINT_BODY);
  const r = run(repo);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);

  // plan-one carries no annotation and must be skipped, not merely absent
  // because the script died before reaching it.
  assert.equal(j.items.some((i) => i.slug === 'plan-one'), false,
    'an un-annotated item must be skipped, not listed');

  // plan-two sits AFTER the slug-less plain line, so reaching it proves the
  // loop survived the no-match line rather than having stopped early.
  const planTwo = j.items.find((i) => i.slug === 'plan-two');
  assert.ok(planTwo, 'an annotated item after a slug-less line must still be read');
  assert.equal(planTwo.pr, '9');
  assert.equal(planTwo.branch, 'feature/plan-two');
  assert.equal(planTwo.head_sha, 'branch-not-found',
    'a sandbox with no origin branch must report the branch as not found');
  assert.equal(planTwo.needs_review, true);
});

test('the test fails against the unfixed script, read as exit code 1 with empty stdout', () => {
  const repo = sandboxRepo(SPRINT_BODY);

  const broken = tmp('unfixed-script');
  const brokenScript = path.join(broken, 'plot-review-status.sh');
  const original = fs.readFileSync(script, 'utf8');
  const reverted = original.replace(
    "tr -d '[]' || true)",
    "tr -d '[]')",
  );
  assert.notEqual(reverted, original, 'the fix line must be present to revert in this test');
  fs.writeFileSync(brokenScript, reverted);
  fs.chmodSync(brokenScript, 0o755);

  const env = { ...process.env };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  const r = spawnSync('bash', [brokenScript, 'a-sprint'], { encoding: 'utf8', cwd: repo, env });

  assert.equal(r.status, 1, 'the unguarded pipeline must abort the script under set -e');
  assert.equal(r.stdout, '', 'the script must emit no JSON once set -e has fired');
});
