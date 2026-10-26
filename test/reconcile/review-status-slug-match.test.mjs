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

  // plan-one carries no annotation, so it is skipped on that ground alone —
  // the die this test guards against would instead have stopped the loop one
  // line earlier, at the slug-less plain item, before plan-two is ever read.
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

test('a sprint built from the template produces items: []', () => {
  const templatePath = path.join(root, 'skills', 'plot', 'templates', 'sprint.md');
  const templateLine = fs.readFileSync(templatePath, 'utf8')
    .split('\n')
    .find((l) => l.includes('Format:') && l.includes('<!--'));
  assert.ok(templateLine, 'the template must still carry its scope-change format comment line');

  const body = [
    '# A sprint',
    '',
    '## Items',
    '',
    templateLine,
    '',
  ].join('\n');

  const repo = sandboxRepo(body);
  const r = run(repo);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.items, [], 'the template comment line must never be read as a sprint item');
});

test('a plan-less item with a pr: annotation appears keyed by its own text, not dropped', () => {
  const body = [
    '# A sprint',
    '',
    '## Items',
    '',
    '- [ ] [plan-two] a plan item with an annotation <!-- pr: #9, branch: feature/plan-two, review_sha: deadbeef -->',
    '- [ ] EWZKUS-3869 a plan-less item <!-- pr: #3663, branch: feature/ewzkus-3869 -->',
    '',
  ].join('\n');

  const repo = sandboxRepo(body);
  const r = run(repo);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);

  const planTwo = j.items.find((i) => i.slug === 'plan-two');
  assert.ok(planTwo, 'a plan item with [slug] and an annotation must still work exactly as before');
  assert.equal(planTwo.pr, '9');
  assert.equal(planTwo.branch, 'feature/plan-two');
  assert.equal(planTwo.needs_review, true);

  const planLess = j.items.find((i) => i.slug === 'EWZKUS-3869 a plan-less item');
  assert.ok(planLess, 'a plan-less annotated item must appear, keyed by its own key/text');
  assert.equal(planLess.pr, '3663');
  assert.equal(planLess.branch, 'feature/ewzkus-3869');
  assert.equal(planLess.head_sha, 'branch-not-found');
  assert.equal(planLess.needs_review, true);

  assert.equal(j.items.length, 2, 'no item must be dropped and none merged into another');
});

test('a non-checklist line carrying bracket characters that look like a slug is never reported as an item', () => {
  const body = [
    '# A sprint',
    '',
    '## Items',
    '',
    'Some prose mentioning [not-a-slug] in passing.',
    '[not-a-slug] <!-- pr: #1, branch: feature/not-a-slug -->',
    '- [ ] [plan-two] a plan item with an annotation <!-- pr: #9, branch: feature/plan-two, review_sha: deadbeef -->',
    '',
  ].join('\n');

  const repo = sandboxRepo(body);
  const r = run(repo);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);

  assert.equal(j.items.some((i) => i.slug === 'not-a-slug'), false,
    'a non-checklist line must never be read as an item, with or without an HTML comment');
  assert.equal(j.items.length, 1, 'only the real checklist item must be reported');
});

test('an unknown sprint slug prints the error JSON rather than dying under set -e', () => {
  const repo = sandboxRepo(SPRINT_BODY);
  const r = spawnSync('bash', [script, 'no-such-sprint'], {
    encoding: 'utf8',
    cwd: repo,
    env: { ...process.env, PLOT_UNATTENDED: undefined, PLOT_REPO_ROOT: undefined },
  });

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.error, 'Sprint file not found');
  assert.deepEqual(j.items, []);
});

test('a checked or unchecked checkbox is never read as the item\'s [slug]', () => {
  const body = [
    '# A sprint',
    '',
    '## Items',
    '',
    '- [x] a checked item with an annotation <!-- pr: #9, branch: feature/foo -->',
    '- [ ] [plan-two] a plan item with an annotation <!-- pr: #1, branch: feature/plan-two -->',
    '',
  ].join('\n');

  const repo = sandboxRepo(body);
  const r = run(repo);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);

  assert.equal(j.items.some((i) => i.slug === 'x'), false,
    'the checkbox mark must never be read as a [slug]');
  const checked = j.items.find((i) => i.pr === '9');
  assert.ok(checked, 'the checked item must still be reported');
  assert.equal(checked.slug, 'a checked item with an annotation',
    'with no [slug], the checked item falls back to its own text, same as an unchecked one');

  const planTwo = j.items.find((i) => i.slug === 'plan-two');
  assert.ok(planTwo, 'an explicit [slug] on an unchecked item must still work');
});

test('the test passes against the unfixed script, which exits 1 with empty stdout', () => {
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
