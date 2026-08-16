// Contract test for the half of plot-fleet-scan.sh that decides WHICH plans
// the pulse reports on, and what it says about each one's phase.
//
// Two things are pinned here, and both are the kind that fail silently:
//
//   * the delivered WINDOW — a plan delivered inside a rolling 24 h still
//     appears, an older one does not. The scan used to read `docs/plans/active`
//     alone, so a plan left the view the instant it was delivered: five plans
//     delivered in one day named eight branches between them, and DONE showed
//     one, because delivery and merge are minutes apart and only whichever
//     branch happened to sit in the gap survived.
//
//   * the plan's own PHASE, reported per plan so a consumer can compose it with
//     each branch's git state. The pulse discarded everything plot-plan-meta.sh
//     returned except the waves.
//
// Every test builds its own repo: the window is read from the filesystem clock,
// and a shared fixture would make one test's mtime another test's answer.
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
 * `YYYY-MM-DD HH:MM` for a moment `hoursAgo` in the past, in LOCAL time.
 *
 * A record that names a TIME is what makes the rolling window testable to the
 * hour: a bare date names no time, so it is deliberately anchored at the end of
 * its day and cannot distinguish 23 hours from 25.
 */
function stampHoursAgo(hoursAgo) {
  const d = new Date(Date.now() - hoursAgo * 3600_000);
  return `${dateHoursAgo(hoursAgo)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

- **Phase:** Delivered
- **Type:** feature
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

test('delivered window: a plan delivered inside 24 h still appears in the pulse', (t) => {
  const { tmp, repo } = makeRepo([{ slug: 'fresh', delivered: dateHoursAgo(1) }]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.ok(files(pulse(repo)).includes('2026-01-01-fresh.md'),
    'work must not disappear at the moment it becomes finished');
});

test('delivered window: an old delivery does NOT appear', (t) => {
  // The other half, and the one that makes the first mean something: a test
  // asserting only "delivered plans appear" passes with no bound at all, which
  // would turn the Agents tab into an archive.
  const { tmp, repo } = makeRepo([{ slug: 'ancient', delivered: '2026-01-02' }]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const got = files(pulse(repo));
  assert.ok(!got.includes('2026-01-01-ancient.md'), `unexpectedly present: ${got}`);
  // …and the active plan is untouched by the filtering.
  assert.ok(got.includes('2026-01-01-live.md'));
});

test('delivered window: the bound is 24 h ROLLING, not the calendar day', (t) => {
  // 23 hours in, 25 hours out — the assertion a day-boundary implementation
  // cannot pass: "delivered today" would drop the 23-hour plan whenever those
  // 23 hours crossed midnight, and keep the 25-hour one whenever they did not.
  //
  // Written with TIMED records, because that is the only way to state a
  // 23-vs-25-hour distinction at all. A bare date names no time, and is
  // anchored at the end of its day for exactly that reason.
  const { tmp, repo } = makeRepo([
    { slug: 'justinside', delivered: stampHoursAgo(23) },
    { slug: 'justoutside', delivered: stampHoursAgo(25) },
  ]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const got = files(pulse(repo));
  assert.ok(got.includes('2026-01-01-justinside.md'), `23 h must be inside: ${got}`);
  assert.ok(!got.includes('2026-01-01-justoutside.md'), `25 h must be outside: ${got}`);
});

test('delivered window: a bare date is anchored at the END of its day', (t) => {
  // The detail that makes "rolling" true rather than merely stated. Every
  // `Delivered:` record in this repo is a bare date, so anchoring at 00:00
  // would measure from up to a day BEFORE the delivery — a plan delivered at
  // 23:50 would be an hour from expiry the moment it was written, and gone ten
  // minutes later mid-session. Anchoring at 23:59:59 over-admits by at most the
  // delivery day, which is the safe direction.
  //
  // So yesterday's bare date is still inside (its day ended under 24 h ago) and
  // the day before that is not.
  const { tmp, repo } = makeRepo([
    { slug: 'yesterday', delivered: dateHoursAgo(24) },
    { slug: 'dayb4', delivered: dateHoursAgo(24 * 3) },
  ]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const got = files(pulse(repo));
  assert.ok(got.includes('2026-01-01-yesterday.md'),
    `a bare date must not expire before its own day is over: ${got}`);
  assert.ok(!got.includes('2026-01-01-dayb4.md'), `three days back must be outside: ${got}`);
});

test('delivered window: a plan with an EMPTY Delivered: record never appears', (t) => {
  // Not hypothetical — `docs/plans/delivered/reconcile-scan-accuracy.md` is in
  // this repo's delivered index today with an empty record. No date means no
  // membership in any window, the same rule the waiting age follows. Showing it
  // always would create the one row that can never age out of DONE, and it
  // would hide a bookkeeping fault plot-reconcile-scan.sh exists to report.
  const { tmp, repo } = makeRepo([{ slug: 'nodate', delivered: '' }]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const got = files(pulse(repo));
  assert.ok(!got.includes('2026-01-01-nodate.md'), `no date, no row: ${got}`);
});

test('delivered window: a stale mtime never excludes a plan the record admits', (t) => {
  // The pre-filter is an OPTIMISATION and may only over-admit. This plan was
  // delivered an hour ago and its file has not been touched in a week — a real
  // shape wherever the record is written by one commit and the file by another.
  // Without this assertion the cheap signal silently becomes the rule, and the
  // saving is paid for with wrong answers.
  const { tmp, repo } = makeRepo([
    { slug: 'staleweek', delivered: dateHoursAgo(1), mtimeHoursAgo: 24 * 7 },
  ]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.ok(files(pulse(repo)).includes('2026-01-01-staleweek.md'),
    'the Delivered: record has the last word, not the mtime');
});

test('delivered window: a fresh clone still answers correctly', (t) => {
  // On a fresh clone or a CI worktree every file carries the same checkout
  // timestamp, so the pre-filter admits ALL of them. That is the safe
  // direction — the result stays correct and only the saving is lost — but only
  // if the record still excludes the old, which is what this pins.
  const now = Date.now() / 1000;
  const { tmp, repo } = makeRepo([
    { slug: 'clonefresh', delivered: dateHoursAgo(2) },
    { slug: 'cloneold', delivered: '2026-01-02' },
  ]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // One uniform mtime across every plan file, as a checkout produces.
  for (const f of fs.readdirSync(path.join(repo, 'plans'))) {
    const p = path.join(repo, 'plans', f);
    if (fs.statSync(p).isFile()) fs.utimesSync(p, now, now);
  }
  const got = files(pulse(repo));
  assert.ok(got.includes('2026-01-01-clonefresh.md'));
  assert.ok(!got.includes('2026-01-01-cloneold.md'),
    `an admitted-by-mtime plan must still be excluded by its record: ${got}`);
});

test('delivered window: --next never names a branch from a delivered plan', (t) => {
  // --next answers "what may a worker claim", and a delivered plan answers
  // nothing to it: even an untaken branch under one is work somebody decided
  // was finished. Naming one would send a dispatcher at completed work.
  const { tmp, repo } = makeRepo([{ slug: 'fresh', delivered: dateHoursAgo(1) }]);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const picked = execFileSync('bash', [scan, '--offline', '--next'],
    { encoding: 'utf8', cwd: repo }).trim();
  assert.equal(picked, 'feature/live-one');
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
