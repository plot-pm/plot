// A Design plan whose spike branch merged is not drift: section 1 (phase vs
// index) and section 2 (merged-but-not-delivered) both skip a `design` plan, so
// the sweep stays quiet while the plan iterates and confirms its slices. The
// control plan is identical except for its phase, so a sweep that stopped
// skipping `design` fails here rather than passing on an empty estate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

let tmp, report;

const plan = (phase, branch) => `# A plan

## Status

- **State:** ${phase}
- **Type:** feature

## Branches

### First
- \`${branch}\` — the spike <!-- spike -->
`;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-design-spike-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  const w = (rel, content) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  w('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`);
  w('plans/2026-10-12-design-plan.md', plan('Design', 'feature/design-spike'));
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'checkout', '-q', '-b', 'feature/design-spike');
  w('src/spike.txt', 'spike\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'the spike');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from o/feature/design-spike', 'feature/design-spike');
  git(repo, 'push', '-q', 'origin', 'main', 'feature/design-spike');

  const env = { ...process.env };
  delete env.PLOT_REPO_ROOT;
  delete env.PLOT_UNATTENDED;
  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo, env });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const section = (n) => report.split(`== ${n}. `)[1].split('\n== ')[0];

test('scan: a merged spike of a Design plan is neither drift nor merged-but-not-delivered', () => {
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /\bdrift=0\b/, footer);
  assert.match(footer, /\bmerged_not_delivered=0\b/, footer);
  assert.doesNotMatch(section(1), /design-plan/, section(1));
  assert.doesNotMatch(section(2), /design-plan/, section(2));
});
