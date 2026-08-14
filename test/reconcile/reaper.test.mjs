// Contract test for the reaper: how plot-reconcile-scan.sh classifies an empty
// claimed branch.
//
// A claim is an empty branch pushed to take work atomically. Two very different
// situations leave that IDENTICAL artifact:
//
//   - the worker deliberately gave the branch up (plan annotated deferred:/moved:)
//   - the worker died (plan still shows a bare claimed:, or nothing)
//
// Git cannot tell them apart, so the reaper reads the plan annotation. This is
// the ONE deliberate exception to "no gate reads the annotation" — and it is
// safe precisely because a wrong annotation costs at most a missed cleanup,
// never lost or duplicated work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

let tmp, repo, report;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-reaper-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n- **Delivered index:** plans/delivered/\n');
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-01-claims.md'), `# Claims plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/abandoned\` — given up on purpose <!-- deferred: folded into another branch -->
- \`feature/orphaned\` — worker died mid-claim <!-- claimed: 2026-01-01T09:00Z, session-9 -->
`);
  fs.symlinkSync('../2026-01-01-claims.md', path.join(repo, 'plans', 'active', 'claims.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');

  // Two claims on the wire: empty branches, no commits of their own. Identical
  // in git; only the plan annotation distinguishes them.
  for (const b of ['feature/abandoned', 'feature/orphaned']) {
    git(repo, 'checkout', '-q', '-b', b);
    git(repo, 'push', '-q', '-u', 'origin', b);
    git(repo, 'checkout', '-q', 'main');
  }

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('reaper: an empty claim is not reported as an orphan branch', () => {
  // Before the reaper existed, an empty claim fell into the "ahead of main"
  // else-branch and was reported as an orphan — doubly wrong: it is not ahead,
  // and "orphan" hides that someone may be working there.
  // Match the verdict phrasing, not the word "orphan" — the fixture branch is
  // deliberately named feature/orphaned and section 5's heading contains
  // "orphaned", so a bare /orphan/ test matches its own fixture names.
  const verdictLines = report.split('\n').filter((l) => /→ orphan \(needs judgment\)/.test(l));
  assert.ok(!verdictLines.some((l) => /feature\/(abandoned|orphaned)/.test(l)),
    `claims must not get the orphan verdict:\n${verdictLines.join('\n')}`);
});

test('reaper: a deliberately abandoned claim is reapable, with the command', () => {
  assert.match(report, /feature\/abandoned.*abandoned claim/is);
  assert.match(report, /git push origin --delete feature\/abandoned/);
});

test('reaper: a bare claim needs judgment and gets no deletion command', () => {
  // A worker may simply be thinking. Never hand the human a delete command for
  // a claim that was not explicitly given up.
  const line = report.split('\n').find((l) => /feature\/orphaned/.test(l)) ?? '';
  assert.match(line, /needs judgment|unresolved|still claimed/i);
  const idx = report.indexOf('feature/orphaned');
  const following = report.slice(idx, idx + 300);
  assert.doesNotMatch(following.split('\n').slice(0, 2).join('\n'),
    /--delete feature\/orphaned/);
});

test('reaper: claims are counted separately in the summary footer', () => {
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /^summary: /);
  assert.match(footer, /claims=2/);
});

test('reaper: the sweep stays read-only', () => {
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
  assert.match(git(repo, 'ls-remote', '--heads', 'origin', 'feature/abandoned'),
    /feature\/abandoned/, 'scan must never delete a ref itself');
});
