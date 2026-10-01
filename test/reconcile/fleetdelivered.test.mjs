// Contract test for the half of plot-fleet-scan.sh that decides WHICH plans
// the pulse reports on, and what it says about each one's phase.
//
// Two things are pinned here, and both are the kind that fail silently:
//
//   * the RELEASE SCOPE — a plan at `Delivered` appears until it is `Released`,
//     whatever its age, and a released plan does not. The scan used to read
//     `docs/plans/active` alone, so a plan left the view the instant it was
//     delivered; a 24-hour window on the `Delivered:` record replaced that, and
//     on 2026-10-01 it hid 15 of the 25 plans 2.22.0 was about to ship.
//
//   * the plan's own PHASE, reported per plan so a consumer can compose it with
//     each branch's git state. The pulse discarded everything plot-plan-meta.sh
//     returned except the waves.
//
// Every test builds its own repo, so one test's fixture is never another's answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const pad = (n) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` for a moment `hoursAgo` in the past, in LOCAL time. */
function dateHoursAgo(hoursAgo) {
  const d = new Date(Date.now() - hoursAgo * 3600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A repo with one active plan and any number of delivered ones.
 *
 * Each delivered spec is `{ slug, delivered, mtimeHoursAgo }`. `delivered` is
 * written into the plan's `Delivered:` record verbatim (pass "" for the
 * empty-record case); `mtimeHoursAgo` back-dates the symlink so the pre-filter
 * can be exercised independently of the record.
 */
function makeRepo(delivered = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-delivered-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  const write = (rel, content) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };

  write('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`);

  write('plans/2026-01-01-live.md', `# A live plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/live-one\` — in flight
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.symlinkSync('../2026-01-01-live.md', path.join(repo, 'plans', 'active', 'live.md'));
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });

  for (const d of delivered) {
    write(`plans/2026-01-01-${d.slug}.md`, `# ${d.slug}

## Status

- **Phase:** ${d.phase ?? 'Delivered'}
- **Type:** ${d.type ?? 'feature'}
- **Delivered:** ${d.delivered}

## Branches

- \`feature/${d.slug}-one\` — landed
`);
    const link = path.join(repo, 'plans', 'delivered', `${d.slug}.md`);
    fs.symlinkSync(`../2026-01-01-${d.slug}.md`, link);
    if (d.mtimeHoursAgo !== undefined) {
      const at = new Date(Date.now() - d.mtimeHoursAgo * 3600_000);
      // The TARGET, not the link: the scan follows the symlink deliberately, so
      // a plan edited after delivery still admits.
      fs.utimesSync(path.join(repo, 'plans', `2026-01-01-${d.slug}.md`), at, at);
    }
  }

  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
}

const pulse = (repo) => JSON.parse(
  execFileSync('bash', [scan, '--offline', '--json'], { encoding: 'utf8', cwd: repo }));

const files = (doc) => doc.plans.map((p) => p.file);

test('release scope: a plan delivered an hour ago appears in the pulse', (t) => {
  const { tmp, repo } = makeRepo([{ slug: 'fresh', delivered: dateHoursAgo(1) }]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.ok(files(pulse(repo)).includes('2026-01-01-fresh.md'),
    'work must not disappear at the moment it becomes finished');
});

test('release scope: an old delivery still appears, because it has not shipped', (t) => {
  // The case the 24-hour window got wrong: a plan delivered months ago and never
  // released is still part of what the next release ships.
  const { tmp, repo } = makeRepo([{ slug: 'ancient', delivered: '2026-01-02' }]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const got = files(pulse(repo));
  assert.ok(got.includes('2026-01-01-ancient.md'), `missing: ${got}`);
  assert.ok(got.includes('2026-01-01-live.md'));
});

test('release scope: a released plan never appears, however recent', (t) => {
  // The other half, and the one that makes the first mean something: a test
  // asserting only "delivered plans appear" passes with no bound at all, which
  // would turn the Agents tab into an archive. The bound is the phase.
  const { tmp, repo } = makeRepo([
    { slug: 'shipped', delivered: dateHoursAgo(1), phase: 'Released' },
    { slug: 'pending', delivered: dateHoursAgo(1) },
  ]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const got = files(pulse(repo));
  assert.ok(!got.includes('2026-01-01-shipped.md'), `a released plan must leave: ${got}`);
  assert.ok(got.includes('2026-01-01-pending.md'), `a delivered one must stay: ${got}`);
});

test('release scope: a delivered docs or infra plan never appears, because it never ships', (t) => {
  // /plot-release records `Released` only for feature and bug plans: a docs or
  // infra plan is live when it merges, so `Delivered` is its last phase. Held
  // to the release scope, the six such plans on this estate stayed in DONE
  // after the release they shipped in (measured 2026-10-01, v2.22.0).
  const { tmp, repo } = makeRepo([
    { slug: 'manual', delivered: dateHoursAgo(1), type: 'docs' },
    { slug: 'pipeline', delivered: dateHoursAgo(1), type: 'infra' },
    { slug: 'fix', delivered: dateHoursAgo(1), type: 'bug' },
  ]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const got = files(pulse(repo));
  assert.ok(!got.includes('2026-01-01-manual.md'), `a delivered docs plan must leave: ${got}`);
  assert.ok(!got.includes('2026-01-01-pipeline.md'), `a delivered infra plan must leave: ${got}`);
  assert.ok(got.includes('2026-01-01-fix.md'), `a delivered bug plan must stay: ${got}`);
});

test('release scope: a delivered plan with an EMPTY Delivered: record appears', (t) => {
  // The phase decides membership; the record no longer does. A missing record
  // is a bookkeeping fault plot-reconcile-scan.sh reports, and hiding the plan
  // would also hide it from the release it belongs to.
  const { tmp, repo } = makeRepo([{ slug: 'nodate', delivered: '' }]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.ok(files(pulse(repo)).includes('2026-01-01-nodate.md'));
});

test('release scope: file times decide nothing', (t) => {
  // A fresh clone stamps every file with one checkout time; a week-old mtime is
  // a file nobody touched since. Neither may move a plan in or out.
  const now = Date.now() / 1000;
  const { tmp, repo } = makeRepo([
    { slug: 'staleweek', delivered: dateHoursAgo(1), mtimeHoursAgo: 24 * 7 },
    { slug: 'cloneold', delivered: '2026-01-02' },
  ]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.utimesSync(path.join(repo, 'plans', '2026-01-01-cloneold.md'), now, now);
  const got = files(pulse(repo));
  assert.ok(got.includes('2026-01-01-staleweek.md'), `stale mtime hid a plan: ${got}`);
  assert.ok(got.includes('2026-01-01-cloneold.md'), `fresh mtime hid a plan: ${got}`);
});

test('release scope: --next never names a branch from a delivered plan', (t) => {
  // --next answers "what may a worker claim", and a delivered plan answers
  // nothing to it: even an untaken branch under one is work somebody decided
  // was finished. Naming one would send a dispatcher at completed work.
  const { tmp, repo } = makeRepo([{ slug: 'fresh', delivered: dateHoursAgo(1) }]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const picked = execFileSync('bash', [scan, '--offline', '--next'],
    { encoding: 'utf8', cwd: repo }).trim();
  assert.equal(picked, 'feature/live-one');
});

test('scan: file_mtime reads a real time on this platform', (t) => {
  // A DIRECT assertion, because the failure mode is silent in the worst way.
  // The first implementation read the mtime as `stat -f %m || stat -c %Y`, and
  // on GNU coreutils `-f` is a valid flag meaning *file system status* — so it
  // SUCCEEDS with a filesystem report, never falls through, and the mtime reads
  // as zero. Every delivered plan was then excluded on Linux while macOS was
  // green, and the symptom was an empty DONE group rather than an error.
  //
  // `file_mtime` still dates a desk's newest change. Asserted against the real
  // script rather than a copy: a copy would have been just as wrong.
  const { tmp, repo } = makeRepo();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // The function is lifted out of the script rather than the script being run:
  // sourcing it would execute the whole scan. The extraction failing is itself
  // a signal — the function was renamed or reshaped, and this test must be
  // looked at rather than silently skipped.
  const src = fs.readFileSync(scan, 'utf8').match(/^file_mtime\(\)[\s\S]*?\n}$/m);
  assert.ok(src, 'file_mtime() not found in plot-fleet-scan.sh — has it been renamed?');
  const probe = `set -uo pipefail\n${src[0]}\nfile_mtime "$1"`;
  const out = execFileSync('bash', ['-c', probe, 'probe', path.join(repo, 'CLAUDE.md')],
    { encoding: 'utf8' }).trim();
  assert.match(out, /^\d+$/, `file_mtime must return epoch seconds, got: ${JSON.stringify(out)}`);
  // And it must be a plausible time rather than a filesystem block count.
  const secondsAgo = Date.now() / 1000 - Number(out);
  assert.ok(secondsAgo >= 0 && secondsAgo < 3600,
    `file_mtime returned an implausible time (${secondsAgo}s ago)`);
});

test('pulse: each plan carries its own phase, verbatim', (t) => {
  // The half of a row's phase git cannot answer. Reported, never interpreted:
  // which column a row reads is composed one layer up (Manifesto Principle 3),
  // so the value here is the normalized plan state and nothing else.
  const { tmp, repo } = makeRepo([{ slug: 'fresh', delivered: dateHoursAgo(1) }]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const doc = pulse(repo);
  const byFile = Object.fromEntries(doc.plans.map((p) => [p.file, p.phase]));
  assert.equal(byFile['2026-01-01-live.md'], 'approved');
  assert.equal(byFile['2026-01-01-fresh.md'], 'delivered');
  // No board vocabulary here — `Design`/`Development` are the consumer's words.
  assert.ok(!JSON.stringify(doc).includes('Development'));
});
