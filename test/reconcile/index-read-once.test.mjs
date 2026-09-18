// Contract test for the index the reconcile sweep reads ONCE.
//
// The defect: `symlinked_from` answered *does a symlink in this index point at
// this plan?* by walking the whole directory and forking `readlink` + `sed` per
// link, and it was called twice per plan. Over 297 plans and 366 links that is
// 130,128 forks per sweep. Two more sites walked the same directories: section
// 4's `active/` loop and section 5's dangling-link loop.
//
// THE FORK COUNT IS THE DELIVERABLE, NOT THE SPEEDUP. Two replacements were
// written while this was planned and both were slower than they looked — one
// forked a subshell per lookup (53.3 s), one forked per link (22.7 s). Neither
// is distinguishable from the fast shape by reading the diff, and a Done-when
// saying *faster* would have passed on both. So `forks are bounded` below
// counts process creations through a PATH shim, which is load-independent,
// where a timing assertion is flaky by construction: a fork costs 38 ms on a
// loaded machine and nearer 2 ms on an idle one.
//
// The other four tests are the rules a three-lens panel established by building
// fixtures. Each is a case where a WRONG index still produces a byte-identical
// report on the estate this was measured on, so a before/after diff passes and
// the index is broken anyway.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const scan = path.join(scripts, 'plot-reconcile-scan.sh');

let tmp, repo, report, forkLog;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const plan = (slug, date, state) =>
  `# ${slug}\n\n## Status\n\n- **State:** ${state}\n- **Type:** feature\n\n`
  + `## Slices\n\n### One (Branch: feature/${slug})\n\n- \`feature/${slug}\` — work\n`;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-index-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + '- **Delivered index:** plans/delivered/\n');
  const plans = path.join(repo, 'plans');
  const active = path.join(plans, 'active');
  const delivered = path.join(plans, 'delivered');
  fs.mkdirSync(active, { recursive: true });
  fs.mkdirSync(delivered, { recursive: true });

  const write = (date, slug, state) =>
    fs.writeFileSync(path.join(plans, `${date}-${slug}.md`), plan(slug, date, state));

  // --- RULE 1: `*.md` IS A FILTER ------------------------------------------
  // `symlinked_from` globbed `"$dir"/*.md`, so a link whose NAME does not end
  // `.md` was invisible whatever it pointed at. A bare `ls -l "$dir"` applies
  // no filter and answers *linked* where the old code answers *not linked* —
  // shrinking `index_drift=` and, where the phase disagrees, emitting a section
  // 1 row naming a path that is not an index entry. These directories are
  // demonstrably not curated: the real `plans/active/` holds `.omc`.
  //
  // This plan is Draft and its ONLY link is a non-`.md` name in active/. The
  // filter must hide that link, so the plan reads as linked from NOWHERE.
  write('2026-01-01', 'filtered-out', 'Draft');
  fs.symlinkSync('../2026-01-01-filtered-out.md', path.join(active, 'filtered-out.txt'));
  // A directory in the index, which is what `.omc` is on the real estate.
  fs.mkdirSync(path.join(active, '.omc'), { recursive: true });

  // --- RULE 2: FIRST MATCH WINS --------------------------------------------
  // The walk returned the first glob match and stopped. Three plans on the real
  // estate carry two links each within `delivered/`; all three are delivered
  // and therefore NOT in drift, so a byte-identity diff passes while the index
  // prints the wrong link path. Here the plan is DRAFT with both links in
  // `delivered/`, which forces the drift row to print — and the row names the
  // link, so last-wins is visible as `zz-` instead of `aa-`.
  write('2026-01-02', 'two-links', 'Draft');
  fs.symlinkSync('../2026-01-02-two-links.md', path.join(delivered, 'aa-two-links.md'));
  fs.symlinkSync('../2026-01-02-two-links.md', path.join(delivered, 'zz-two-links.md'));

  // --- RULE 3: THE LINK PATH IS PRINTED, NOT A BOOLEAN ---------------------
  // Section 1's `fix:` names the link file. An index keyed only by target
  // answers *is it linked?* and loses *which link*.
  write('2026-01-03', 'wrong-index', 'Delivered');
  fs.symlinkSync('../2026-01-03-wrong-index.md', path.join(active, 'wrong-index.md'));

  // --- RULE 4 / dangling: `ls -l` shows a link that resolves to nothing -----
  // `[ -L ]` accepted it, so it must still be reported — at attention level,
  // because a broken pointer is not a browsing gap. The message prints what
  // `readlink` printed, which is the RAW target and not its basename.
  write('2026-01-04', 'present', 'Approved');
  fs.symlinkSync('../2026-01-04-present.md', path.join(active, 'present.md'));
  fs.symlinkSync('../2026-01-99-vanished.md', path.join(active, 'dangling.md'));

  // A plan linked from BOTH indexes — 83 such on the real estate. Two separate
  // indexes must each answer for their own directory.
  write('2026-01-05', 'both', 'Approved');
  fs.symlinkSync('../2026-01-05-both.md', path.join(active, 'both.md'));
  fs.symlinkSync('../2026-01-05-both.md', path.join(delivered, 'both.md'));

  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans and index');
  git(repo, 'push', '-q', 'origin', 'main');

  // --- The fork counter ----------------------------------------------------
  // A shim directory ahead of the real PATH. Every call to one of the commands
  // the old walkers forked appends a line, then execs the real binary — so the
  // scan behaves identically and the count is exact. It catches a fork from ANY
  // site, which is what makes it a gate on the whole sweep rather than on one
  // function.
  const shimDir = path.join(tmp, 'shim');
  fs.mkdirSync(shimDir, { recursive: true });
  forkLog = path.join(tmp, 'forks.log');
  for (const cmd of ['readlink', 'basename']) {
    const real = execFileSync('bash', ['-lc', `command -v ${cmd} || true`],
      { encoding: 'utf8' }).trim().split('\n').filter((p) => p && !p.startsWith(shimDir))[0];
    if (!real) continue;
    fs.writeFileSync(path.join(shimDir, cmd),
      `#!/bin/sh\necho "${cmd} $*" >> "${forkLog}"\nexec ${real} "$@"\n`);
    fs.chmodSync(path.join(shimDir, cmd), 0o755);
  }

  report = execFileSync('bash', [scan, '--offline'], {
    encoding: 'utf8',
    cwd: repo,
    env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` },
  });
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('index: forks are bounded — the per-plan lookup creates no process', () => {
  // THE REGRESSION THIS LOCKS. The old shape forked `readlink` once per link
  // examined, twice per plan, plus a `basename` per plan. With 6 plans and 7
  // links that is dozens here and 130,128 on the real estate; the replacement
  // reads both directories with one `ls` each and forks NEITHER command.
  //
  // Bounded rather than exactly zero: the sweep's other twenty sections are
  // free to fork for their own reasons, and pinning zero would make this test
  // fail on an unrelated change. What it refuses is a count that SCALES — any
  // re-introduced per-plan or per-link fork lands far above this ceiling.
  const lines = fs.existsSync(forkLog)
    ? fs.readFileSync(forkLog, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  const readlinks = lines.filter((l) => l.startsWith('readlink ')).length;
  assert.equal(readlinks, 0,
    `no site may fork readlink; the index is read once:\n${lines.join('\n')}`);
  assert.ok(lines.length <= 4,
    `the index path must fork nothing per plan or per link, saw ${lines.length}:\n`
    + lines.join('\n'));
});

test('index: a non-`.md` link is invisible — the glob is a filter', () => {
  // RULE 1. Dropping the filter makes this plan read as linked from `active/`,
  // which removes its `index_drift=` row. That is a SILENT change: the count
  // shrinks and nothing says why.
  const idx = report.slice(report.indexOf('== 9.'));
  assert.match(idx, /2026-01-01-filtered-out\.md/,
    `a plan whose only link is named .txt is linked from nowhere:\n${idx}`);
  // And the link must never be named as if it were an index entry.
  assert.doesNotMatch(report, /filtered-out\.txt/,
    'a non-`.md` link is not an index entry and must not be printed as one');
});

test('index: the FIRST link wins, not the last', () => {
  // RULE 2. Both links point at one plan. `[ -n "${IDX[$t]:-}" ] || IDX[$t]=$l`
  // keeps `aa-`; an unconditional `IDX[$t]=$l` keeps `zz-` and the report names
  // a different file in a command a person is invited to run.
  const section = report.slice(report.indexOf('== 1.'), report.indexOf('== 2.'));
  assert.match(section, /aa-two-links\.md/,
    `first-wins: the drift row must name the first link:\n${section}`);
  assert.doesNotMatch(section, /zz-two-links\.md/,
    `last-wins would name the second link:\n${section}`);
});

test('index: a drift row prints the link PATH in its fix command', () => {
  // RULE 3. An index keyed only by target basename answers *is it linked?* and
  // cannot produce this line at all.
  const section = report.slice(report.indexOf('== 1.'), report.indexOf('== 2.'));
  assert.match(section, /fix: git rm plans\/active\/wrong-index\.md/,
    `the fix must name the link file, not just the plan:\n${section}`);
});

test('index: a dangling link is still reported, with the target readlink prints', () => {
  // The index is built from `ls -l`, which shows a link whose target does not
  // exist exactly as `[ -L ]` accepted it. Storing the basename instead of the
  // raw target would change this message — and with zero dangling links on the
  // estate, a before/after diff cannot catch that.
  const section = report.slice(report.indexOf('== 5.'), report.indexOf('== 6.'));
  assert.match(section, /plans\/active\/dangling\.md — symlink target missing: \.\.\/2026-01-99-vanished\.md/,
    `the dangling link keeps its path and its raw target:\n${section}`);
  assert.match(report, /attention=1/,
    'a broken pointer is attention-level, not convenience');
});

test('index: a plan linked from both directories is seen in both', () => {
  // Two separate indexes, one per directory — 83 plans on the real estate are
  // linked from both, and a single merged index would answer one question for
  // two directories.
  const drift = report.slice(report.indexOf('== 1.'), report.indexOf('== 2.'));
  assert.doesNotMatch(drift, /2026-01-05-both\.md/,
    `an Approved plan linked from active/ is not in drift:\n${drift}`);
  const idx = report.slice(report.indexOf('== 9.'));
  assert.doesNotMatch(idx, /2026-01-05-both\.md/,
    `a plan linked from both indexes is not unlinked:\n${idx}`);
});

test('index: an absent index directory produces no error and no finding', () => {
  // The Done-when names this case. A repo whose `delivered/` has never been
  // created must sweep cleanly — `[ -d ]` guards the read and the glob's
  // no-match is swallowed.
  const bare = path.join(tmp, 'bare');
  git(tmp, 'clone', '-q', path.join(tmp, 'origin.git'), bare);
  fs.rmSync(path.join(bare, 'plans', 'delivered'), { recursive: true, force: true });
  const out = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: bare });
  assert.match(out, /^summary: /m, `the sweep completes:\n${out}`);
  assert.doesNotMatch(out, /No such file or directory/,
    `a missing index directory is silent, not an error:\n${out}`);
});
