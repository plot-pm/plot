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

  // Two claims on the wire: branches carrying only a CLAIM COMMIT. Identical
  // in git; only the plan annotation distinguishes them. The commit is what
  // makes the claim exclusive — a branch merely pointing at main does not
  // diverge, so a second dispatcher's push would silently succeed.
  for (const b of ['feature/abandoned', 'feature/orphaned']) {
    git(repo, 'checkout', '-q', '-b', b);
    git(repo, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${b}`);
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

test('reaper: a fresh bare claim is not called stale', () => {
  // A worker may simply be thinking. Reporting a minutes-old claim as stale
  // invites deleting live work.
  const line = report.split('\n').find((l) => /feature\/orphaned/.test(l)) ?? '';
  assert.doesNotMatch(line, /stale/i);
  assert.match(line, /needs judgment/i);
});

test('reaper: a claim older than the threshold is flagged stale, with its age', () => {
  // Distinguishing "thinking" from "dead" needs TIME, not just the annotation.
  // Threshold: `Claim stale after` (hours).
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-stale-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n- **Claim stale after:** 24\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-s.md'),
    '# S\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n- `feature/old` — taken long ago <!-- claimed: 2026-01-01T09:00Z, session-1 -->\n');
  fs.symlinkSync('../2026-01-01-s.md', path.join(r, 'plans', 'active', 's.md'));
  git(r, 'add', '-A');
  // Date the base commit 30 days back: a claim with no commits of its own
  // inherits that age, which is exactly what a long-idle claim looks like.
  const old = new Date(Date.now() - 30 * 864e5).toISOString();
  execFileSync('git', ['commit', '-qm', 'plan'], {
    cwd: r, env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old },
  });
  git(r, 'push', '-q', 'origin', 'main');

  // A real claim has NO commit of its own — it points at the same commit as
  // main. Its age is therefore the age of that commit, which is what a
  // long-idle claim looks like: the worker took the branch and never pushed.
  // (An earlier version of this test gave the claim its own empty commit,
  // which made it "ahead of main" and thus not a claim at all.)
  git(r, 'checkout', '-q', '-b', 'feature/old');
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'plot: claim feature/old'], {
    cwd: r, env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old },
  });
  git(r, 'push', '-q', '-u', 'origin', 'feature/old');
  git(r, 'checkout', '-q', 'main');

  const out = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: r });
  const line = out.split('\n').find((l) => /feature\/old/.test(l)) ?? '';
  assert.match(line, /stale/i, 'a month-old claim must read as stale');
  assert.match(line, /\d+d/, 'must state the age so the human can judge');
  // Still no deletion command: staleness is evidence, not permission.
  const idx = out.indexOf('feature/old');
  assert.doesNotMatch(out.slice(idx, idx + 200).split('\n').slice(0, 2).join('\n'),
    /--delete feature\/old/);
  fs.rmSync(t, { recursive: true, force: true });
});

test('reaper: a real commit titled like a claim marker is NOT a claim', () => {
  // Claim detection matched the commit SUBJECT alone, so a human commit titled
  // "plot: claim handling refactor" — carrying real files — read as an empty
  // claim. With a `deferred:` annotation the reaper then offered to DELETE a
  // branch holding real, unmerged work. Subject alone is not evidence; a claim
  // marker is also EMPTY (its tree equals its parent's).
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-subject-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n- **Delivered index:** plans/delivered/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-s.md'),
    '# S\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n'
    + '- `bug/humantitle` — real work, unlucky commit title <!-- deferred: descoped -->\n'
    + '- `feature/genuine` — a true claim <!-- deferred: descoped -->\n');
  fs.symlinkSync('../2026-01-01-s.md', path.join(r, 'plans', 'active', 's.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  // Real work whose subject happens to start with the marker text.
  git(r, 'checkout', '-q', '-b', 'bug/humantitle');
  fs.writeFileSync(path.join(r, 'src.txt'), 'real code\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plot: claim handling refactor');
  git(r, 'push', '-q', '-u', 'origin', 'bug/humantitle');
  git(r, 'checkout', '-q', 'main');

  // Control: a genuine, empty claim marker.
  git(r, 'checkout', '-q', '-b', 'feature/genuine');
  git(r, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/genuine');
  git(r, 'push', '-q', '-u', 'origin', 'feature/genuine');
  git(r, 'checkout', '-q', 'main');

  const out = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: r });

  // Assert PER LINE. A dot-all regex spanning the whole report matches across
  // entries — "bug/humantitle" on one line and "abandoned claim" on another —
  // so it would pass or fail on report ordering rather than on the verdict.
  const verdict = (br) =>
    out.split('\n').find((l) => l.includes(br) && l.includes('→')) ?? '';

  // The control must still be reapable — the fix must not blunt real detection.
  assert.match(verdict('feature/genuine'), /abandoned claim/);
  // The impostor must not be, and above all must get no deletion command.
  assert.doesNotMatch(verdict('bug/humantitle'), /abandoned claim/);
  assert.doesNotMatch(out, /--delete bug\/humantitle/,
    'never offer to delete a branch holding real unmerged work');

  fs.rmSync(t, { recursive: true, force: true });
});
