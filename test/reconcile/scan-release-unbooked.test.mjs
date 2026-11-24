// Contract test for section 6's docs/infra arm: the scan asks
// `board/plot-release-unbooked.mjs`, which asks `releaseUnbooked` over the
// newest release tag, and reports a `docs` or `infra` plan that the release
// still owes and that reads Delivered.
//
// The sandbox is a real repository whose origin/main carries a `v2.36.0`-shaped
// tag: a merge commit whose second parent removes three changesets. The
// changesets name a docs plan, a feature plan and a docs plan already
// Released. No sprint names the release, so the docs plan is owed through its
// changeset alone. The host is a `gh` stub on PATH that answers every list
// with `[]`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

const made = [];
const tmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `plot-${tag}-`));
  made.push(d);
  return d;
};
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const stubGh = () => {
  const dir = tmp('unbooked-gh');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
case "$*" in
  *" list"*) printf '%s' '[]' ;;
esac
exit 0
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return dir;
};

const write = (repo, rel, content) => {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

const plan = (title, phase, type, extra = []) =>
  [`# ${title}`, '', '## Status', '', `- **Phase:** ${phase}`, `- **Type:** ${type}`, ...extra, ''].join('\n');

const changeset = (planPath) =>
  ["---", "'plot': patch", '---', '', 'A change the release carries to its users.', '', '<!--', `plan: ${planPath}`, '-->', ''].join('\n');

const PLANS = {
  'plans/2026-11-01-docs-owed.md': plan('Docs owed', 'Delivered', 'docs'),
  'plans/2026-11-02-docs-unnamed.md': plan('Docs unnamed', 'Delivered', 'docs'),
  'plans/2026-11-03-feature-owed.md': plan('Feature owed', 'Delivered', 'feature'),
  'plans/2026-11-04-docs-booked.md': plan('Docs booked', 'Released', 'docs', ['- **Released:** 2026-11-20 (v2.36.0)']),
};

/**
 * A clone whose origin/main holds the release merge tagged `v2.36.0`.
 *
 * @param withPlans - whether origin/main carries the plans; where false the
 *   plans are a local commit only, so the bundle's plan read at origin/main fails.
 */
const fixture = (withPlans) => {
  const t = tmp('unbooked');
  const origin = path.join(t, 'origin.git');
  const repo = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', origin);
  git(t, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');
  git(repo, 'remote', 'add', 'store', origin);
  write(repo, 'CLAUDE.md', ['# Fixture', '', '## Plot Config', '',
    '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/',
    '- **Plan directory:** plans/', '- **Active index:** plans/active/',
    '- **Delivered index:** plans/delivered/', '- **Sprint directory:** sprints/', ''].join('\n'));
  write(repo, 'sprints/2026-W40-older.md', ['# Older', '', '## Status', '', '- **State:** Closed', '- **Release:** 2.35.0', ''].join('\n'));
  write(repo, '.changeset/docs-owed.md', changeset('plans/2026-11-01-docs-owed.md'));
  write(repo, '.changeset/feature-owed.md', changeset('plans/2026-11-03-feature-owed.md'));
  write(repo, '.changeset/docs-booked.md', changeset('plans/2026-11-04-docs-booked.md'));
  if (withPlans) for (const [rel, text] of Object.entries(PLANS)) write(repo, rel, text);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'work with changesets');
  git(repo, 'checkout', '-qb', 'changeset-release/main');
  for (const f of ['docs-owed', 'feature-owed', 'docs-booked']) git(repo, 'rm', '-q', `.changeset/${f}.md`);
  write(repo, 'VERSION', '2.36.0\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'release: 2.36.0');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #9 from plot-pm/changeset-release/main', 'changeset-release/main');
  git(repo, 'tag', 'v2.36.0');
  git(repo, 'push', '-q', 'store', 'main', '--tags');
  git(repo, 'fetch', '-q', 'store');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'refs/remotes/store/main');
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  if (!withPlans) {
    for (const [rel, text] of Object.entries(PLANS)) write(repo, rel, text);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'plans, not pushed');
  }
  return repo;
};

let repo;
let unreadable;
let gh;
before(() => {
  repo = fixture(true);
  unreadable = fixture(false);
  gh = stubGh();
});

let scanTmpdir;
const runScan = (cwd, ...flags) => {
  scanTmpdir ??= tmp('unbooked-tmpdir');
  const env = {
    ...process.env,
    TMPDIR: scanTmpdir,
    PLOT_BUDGET_HOME: scanTmpdir,
    PLOT_PR_INDEX_HOME: scanTmpdir,
    PATH: `${gh}:${process.env.PATH}`,
  };
  delete env.PLOT_REPO_ROOT;
  return execFileSync('bash', [scan, '--no-fetch', ...flags], { encoding: 'utf8', cwd, env });
};

const section6 = (out) => {
  const lines = out.split('\n');
  const at = lines.findIndex((l) => l.startsWith('== 6. '));
  assert.ok(at >= 0, `section 6 is missing from:\n${out}`);
  const end = lines.findIndex((l, i) => i > at && (l.startsWith('== ') || l === ''));
  return lines.slice(at + 1, end < 0 ? undefined : end);
};

const footer = (out, key) => Number(out.match(new RegExp(`\\b${key}=(\\d+)`))?.[1]);

test('a docs plan named only by a removed changeset of the newest tag is reported', () => {
  const lines = section6(runScan(repo));
  assert.ok(
    lines.includes('  2026-11-01-docs-owed.md — owed by v2.36.0 (Type: docs), plan still Delivered'),
    lines.join('\n'),
  );
});

test('a docs plan named by no release stays silent', () => {
  const lines = section6(runScan(repo));
  assert.equal(lines.filter((l) => l.includes('docs-unnamed')).length, 0, lines.join('\n'));
});

test('a docs plan already holding Released: stays silent', () => {
  const lines = section6(runScan(repo));
  assert.equal(lines.filter((l) => l.includes('docs-booked')).length, 0, lines.join('\n'));
});

test('a feature plan the rule owes is reported once, by the loop and not by the new arm', () => {
  const lines = section6(runScan(repo));
  const named = lines.filter((l) => l.includes('2026-11-03-feature-owed.md'));
  assert.equal(named.length, 1, lines.join('\n'));
  assert.doesNotMatch(named[0], /owed by v2\.36\.0/);
});

test('--offline still reports the docs plan', () => {
  const lines = section6(runScan(repo, '--offline'));
  assert.ok(lines.some((l) => l.startsWith('  2026-11-01-docs-owed.md — owed by v2.36.0')), lines.join('\n'));
});

test('unreleased_delivered= counts the new finding and attention= is unchanged', () => {
  const out = runScan(repo);
  // The loop reports feature-owed (no PR annotation); the new arm reports docs-owed.
  assert.equal(footer(out, 'unreleased_delivered'), 2, out.split('\n').at(-2));
  // Section 6 sits below the blocking marker: its findings never reach attention=.
  assert.equal(footer(out, 'attention'), 0, out.split('\n').at(-2));
});

test('an unaskable reading prints a not-evaluated line and not (none)', () => {
  const lines = section6(runScan(unreadable));
  assert.ok(lines.some((l) => l.startsWith('  (not evaluated — ')), lines.join('\n'));
  assert.ok(!lines.includes('  (none)'), lines.join('\n'));
  assert.equal(lines.filter((l) => l.includes('docs-owed')).length, 0, lines.join('\n'));
});
