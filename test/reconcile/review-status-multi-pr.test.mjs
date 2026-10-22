// Contract test for `plot-review-status.sh` reporting every PR a `pr:`
// annotation names. `grep -oE 'pr: #[0-9]+' | grep -oE '[0-9]+'` matches the
// literal `pr: #` once per annotation, so `<!-- pr: #3645, #3649 -->` reported
// `3645` alone and silently dropped `3649` (ewz-kus-portal, issue #2346).
//
// The fix reads the `pr:` field's own text — bounded by the next `key:` or
// the comment end — then pulls every `#<number>` from that text only, so a
// number in `branch:`/`review_sha:` never leaks in.
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

function sandboxRepo(sprintBody) {
  const t = tmp('review-status-multi-pr');
  const repo = path.join(t, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repo, 'docs', 'sprints'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'sprints', '2026-10-22-a-sprint.md'), sprintBody);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  return repo;
}

function run(repo, scriptPath = script) {
  const env = { ...process.env };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  return spawnSync('bash', [scriptPath, 'a-sprint'], { encoding: 'utf8', cwd: repo, env });
}

const SPRINT_BODY = [
  '# A sprint',
  '',
  '## Items',
  '',
  '- [ ] [two-prs] a two-PR item with trailing keys <!-- pr: #1, #2, branch: feature/x, review_sha: abc123 -->',
  'a plain line with no checkbox at all',
  '- [ ] [no-pr] an item with no pr: key <!-- branch: feature/y -->',
  '- [ ] [one-pr] a single-PR item <!-- pr: #9, branch: feature/one-pr, review_sha: deadbeef -->',
  '',
].join('\n');

test('a comma list followed by other keys reports every PR, not just the first', () => {
  const repo = sandboxRepo(SPRINT_BODY);
  const r = run(repo);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);

  const twoPrs = j.items.find((i) => i.slug === 'two-prs');
  assert.ok(twoPrs, 'the two-PR item must be reported');
  assert.equal(twoPrs.pr, '1', 'pr keeps the first number for existing consumers');
  assert.deepEqual(twoPrs.prs, ['1', '2'],
    'prs must name every PR the annotation lists, not just the one adjacent to "pr:"');
  assert.equal(twoPrs.branch, 'feature/x',
    'branch: must read its own value, not a leaked PR-field number');
});

test('no pr: key still reports "none" and an empty prs array', () => {
  const repo = sandboxRepo(SPRINT_BODY);
  const r = run(repo);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);

  const noPr = j.items.find((i) => i.slug === 'no-pr');
  assert.ok(noPr, 'the no-pr item must be reported');
  assert.equal(noPr.pr, 'none');
  assert.deepEqual(noPr.prs, []);
});

test('a plain line before an item does not stop the scan from reaching a later single-PR item', () => {
  const repo = sandboxRepo(SPRINT_BODY);
  const r = run(repo);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);

  const onePr = j.items.find((i) => i.slug === 'one-pr');
  assert.ok(onePr, 'an item after a plain non-checklist line must still be read');
  assert.equal(onePr.pr, '9');
  assert.deepEqual(onePr.prs, ['9']);
});

test('comma-with-space, no-space, and space-only PR lists all parse to the same two numbers', () => {
  const body = [
    '# A sprint',
    '',
    '## Items',
    '',
    '- [ ] [space-comma] <!-- pr: #1, #2 -->',
    '- [ ] [no-space] <!-- pr: #1,#2 -->',
    '- [ ] [space-only] <!-- pr: #1 #2 -->',
    '',
  ].join('\n');
  const repo = sandboxRepo(body);
  const r = run(repo);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);

  for (const slug of ['space-comma', 'no-space', 'space-only']) {
    const item = j.items.find((i) => i.slug === slug);
    assert.ok(item, `${slug} must be reported`);
    assert.deepEqual(item.prs, ['1', '2'], `${slug} must report both PR numbers`);
  }
});

test('a repeated pr: key collects numbers from every occurrence, de-duplicated, in order', () => {
  const body = [
    '# A sprint',
    '',
    '## Items',
    '',
    '- [ ] [repeated] <!-- pr: #1, branch: feature/z, pr: #2, pr: #1 -->',
    '',
  ].join('\n');
  const repo = sandboxRepo(body);
  const r = run(repo);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);

  const item = j.items.find((i) => i.slug === 'repeated');
  assert.ok(item);
  assert.deepEqual(item.prs, ['1', '2'], 'a repeated pr: key must contribute its numbers, with duplicates removed');
});

test('the test fails against the unfixed script, read as only the first PR of a comma list', () => {
  const repo = sandboxRepo(SPRINT_BODY);

  const broken = tmp('unfixed-multi-pr-script');
  const brokenScript = path.join(broken, 'plot-review-status.sh');
  const original = fs.readFileSync(script, 'utf8');
  const fixedLine = /PRS=\$\(echo "\$ANNOTATION" \| awk '[^\n]*' \|\| echo ""\)/;
  assert.match(original, fixedLine, 'the fix line must be present to revert in this test');
  const reverted = original.replace(
    fixedLine,
    'PRS=$(echo "$ANNOTATION" | grep -oE \'pr: #[0-9]+\' | grep -oE \'[0-9]+\' || echo "")',
  );
  assert.notEqual(reverted, original, 'the fix line must be present to revert in this test');
  fs.writeFileSync(brokenScript, reverted);
  fs.chmodSync(brokenScript, 0o755);

  const r = run(repo, brokenScript);

  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  const twoPrs = j.items.find((i) => i.slug === 'two-prs');
  assert.ok(twoPrs);
  assert.deepEqual(twoPrs.prs, ['1'],
    'the unfixed extraction must drop the second PR, proving this test catches the regression');
});
