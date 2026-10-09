// Contract test for the failure `the-reaper-becomes-a-command` fixes: the OLD
// `plot-reap.sh` held four `node --input-type=module` heredocs that imported
// the domain rules from a path derived from the SCRIPT'S OWN CHECKOUT
// (`RULE_PATH`, `<checkout>/packages/domain/src/rules/*.ts`). A published npm
// install of the plot plugin ships `skills/plot/scripts/` with no `packages/`
// tree beside it, so every heredoc failed, the fail-safe turned the failure
// into "rule could not be asked", and the reaper kept every tree — silently,
// because the fallback read as a cautious "keep" rather than a crash.
//
// `reap.ts` is bundled by esbuild into one self-contained `plot-reap.mjs`, and
// `scriptDir` (its line resolving `path.dirname(import.meta.url)`) is derived
// from the BUNDLE'S OWN location on disk, never from a `packages/` sibling —
// so the fix is structural, not a path that happens to still resolve in this
// checkout. This test proves it by running the launcher and its bundle from a
// copy of `skills/plot/scripts/` with no `packages/` ancestor anywhere on the
// filesystem above it, against a real reapable worktree, and asserting it
// reaches the real verdict rather than the old failure's blanket "keep".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsSrc = path.join(here, '..', '..', 'skills', 'plot', 'scripts');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const ctx = [];
after(() => {
  for (const t of ctx) fs.rmSync(t, { recursive: true, force: true });
});

let npmLayout, repo, reapOut;

before(() => {
  // A copy of the shipped scripts directory under a tmp root that holds
  // nothing named `packages` at any level — the shape `npm install` produces,
  // and the shape the old heredocs' `RULE_PATH` could never resolve under.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-reap-npm-layout-'));
  ctx.push(tmp);
  npmLayout = path.join(tmp, 'node_modules', '@plot-pm', 'plugin', 'skills', 'plot', 'scripts');
  fs.mkdirSync(npmLayout, { recursive: true });
  fs.cpSync(scriptsSrc, npmLayout, { recursive: true });
  assert.ok(!tmp.includes('packages'), 'the tmp root itself must not contain "packages"');
  assert.ok(
    !fs.existsSync(path.join(tmp, 'packages')),
    'the npm layout must hold no packages/ sibling anywhere above the scripts',
  );

  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Repo\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');

  // One worktree whose branch is already merged into main — the reaper's
  // simplest `would` verdict, and the one the old fail-safe could never
  // reach, since every rule-ask failed before it got this far.
  const branch = 'feature/npm-layout-check';
  const wt = path.join(tmp, 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'branch', branch);
  git(repo, 'worktree', 'add', '-q', wt, branch);
  fs.writeFileSync(path.join(wt, 'work.txt'), branch);
  git(wt, 'add', '-A');
  git(wt, 'commit', '-qm', `work on ${branch}`);
  git(repo, 'merge', '-q', '--no-ff', '-m', `merge ${branch}`, branch);
  git(repo, 'push', '-q', 'origin', 'main');

  reapOut = execFileSync('bash', [path.join(npmLayout, 'plot-reap.sh'), '--dry-run'], {
    encoding: 'utf8',
    cwd: repo,
  });
});

test('a reapable worktree is reported `would`, not the fail-safe `keep`', () => {
  assert.match(reapOut, /would\s+feature\/npm-layout-check/, `expected a real verdict:\n${reapOut}`);
  assert.ok(
    !reapOut.includes('rule could not be asked'),
    `the fail-safe must not fire when run from an npm-layout copy:\n${reapOut}`,
  );
});
