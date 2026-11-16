// Contract test: plot-reconcile-scan.sh section 3 reads the plans' deferred
// markers through board/plot-given-up.mjs (branchGivenUpBy), for the unmerged
// arm and for the claim arm. Needs the built bundle (`pnpm build:board`).
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

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const plan = (title, phase, lines) => `# ${title}\n\n## Status\n\n- **Phase:** ${phase}\n- **Type:** feature\n\n## Branches\n\n${lines.join('\n')}\n`;

const pushBranch = (b, withWork) => {
  git(repo, 'checkout', '-q', '-b', b);
  git(repo, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${b}`);
  if (withWork) {
    fs.writeFileSync(path.join(repo, `${b.replace('/', '-')}.txt`), 'work\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', `work on ${b}`);
  }
  git(repo, 'push', '-q', '-u', 'origin', b);
  git(repo, 'checkout', '-q', 'main');
};

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deferred-keeps-'));
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

  // A delivered plan keeps two refs; one of them an empty claim.
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-01-kept.md'), plan('Kept', 'Delivered', [
    '- `feature/kept-work` — kept <!-- deferred: 2026-02-03, the ref stays -->',
    '- `feature/kept-claim` — gave up <!-- deferred: 2026-02-03, nobody took it -->',
  ]));
  fs.symlinkSync('../2026-01-01-kept.md', path.join(repo, 'plans', 'delivered', 'kept.md'));
  // An Active plan defers one branch and a second Active plan schedules it.
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-02-live-a.md'), plan('Live A', 'Approved', [
    '- `feature/live` — dropped here <!-- deferred: 2026-02-04, moved on -->',
    '- `feature/undated` — dropped <!-- deferred: no date given -->',
  ]));
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-03-live-b.md'), plan('Live B', 'Approved', [
    '- `feature/live` — picked up again',
  ]));
  fs.symlinkSync('../2026-01-02-live-a.md', path.join(repo, 'plans', 'active', 'live-a.md'));
  fs.symlinkSync('../2026-01-03-live-b.md', path.join(repo, 'plans', 'active', 'live-b.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');

  pushBranch('feature/kept-work', true);
  pushBranch('feature/kept-claim', false);
  pushBranch('feature/live', true);
  pushBranch('feature/undated', true);
  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const section3 = () => report.slice(report.indexOf('== 3.'), report.indexOf('== 4.'));

test('a branch a delivered plan defers is listed as kept, with plan and date', () => {
  assert.match(section3(), /-- kept by a deferred or moved slice \(a plan keeps this ref; not stale\) --/);
  assert.match(section3(), /origin\/feature\/kept-work — kept by 2026-01-01-kept\.md \(deferred 2026-02-03\) → not stale/);
});

test('a kept branch prints no orphan line and no delete command', () => {
  const lines = section3().split('\n');
  assert.ok(!lines.some((l) => /feature\/kept-work/.test(l) && /orphan \(needs judgment\)/.test(l)));
  assert.doesNotMatch(section3(), /git push origin --delete feature\/kept-work/);
});

test('a kept branch does not count toward stale=', () => {
  // Of the three unmerged branches only feature/live is an orphan.
  assert.match(report.trim().split('\n').at(-1), /stale=1\b/);
});

test('a branch an Active-index plan schedules stays an orphan', () => {
  assert.match(section3(), /origin\/feature\/live — ahead of main, no open PR → orphan \(needs judgment\)/);
});

test('a reason with no leading date prints undated', () => {
  assert.match(section3(), /origin\/feature\/undated — kept by 2026-01-02-live-a\.md \(deferred undated\)/);
});

test('an empty claim deferred only in a delivered plan is an abandoned claim', () => {
  assert.match(section3(), /feature\/kept-claim — abandoned claim/);
  assert.match(section3(), /git push origin --delete feature\/kept-claim/);
});

test('without the bundle every branch keeps its other classification', () => {
  const copy = path.join(tmp, 'scripts');
  fs.cpSync(path.join(path.dirname(scan)), copy, { recursive: true });
  fs.rmSync(path.join(copy, 'board', 'plot-given-up.mjs'));
  const out = execFileSync('bash', [path.join(copy, 'plot-reconcile-scan.sh'), '--offline'], { encoding: 'utf8', cwd: repo });
  assert.match(out, /origin\/feature\/kept-work — ahead of main, no open PR → orphan \(needs judgment\)/);
  assert.doesNotMatch(out, /kept by a deferred or moved slice/);
});
