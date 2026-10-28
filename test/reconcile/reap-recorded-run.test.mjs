// Contract test for #2825: `--yes` now acts on the INTERSECTION of a recorded
// `--dry-run` and a fresh, narrow re-check — never a fresh full re-decision.
//
// THE DEFECT THIS FILE PINS. Before this wave, `--yes` re-decided every local
// branch/worktree/claim from scratch: a host-answer flip, a worktree's
// given-up cascade, or `origin/<default>` moving between two runs could make
// `--yes` delete a DIFFERENT set than the one `--dry-run` showed an operator.
// Each test below is a regression guard for one way a naive fix (e.g.
// remembering the would-rows as a bare set of names) still gets this wrong.
//
// WHY THE SUBSET ASSERTION, NOT EQUALITY. `--yes` may act on FEWER rows than
// the dry run named (a live refusal withdrew one), but never on a DIFFERENT
// row the dry run never showed, and never on MORE.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const reap = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reap.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const ctx = [];
after(() => {
  for (const t of ctx) fs.rmSync(t, { recursive: true, force: true });
});

const makeRepo = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-reap-recorded-'));
  ctx.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Repo\n\n## Plot Config\n\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
};

/** A worktree holding one committed, unmerged change — the squash-merge shape, the only shape that reaches `pr_merged`. */
const squashedWorktree = (repo, branch) => {
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'branch', branch);
  git(repo, 'worktree', 'add', '-q', wt, branch);
  fs.writeFileSync(path.join(wt, 'work.txt'), branch);
  git(wt, 'add', '-A');
  git(wt, 'commit', '-qm', `work on ${branch}`);
  return wt;
};

/** A `gh` on PATH answering `pr list` from a per-branch table; a branch absent answers `[]`. */
const stubGh = (tmp, prs) => {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(
    gh,
    `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv[0] !== 'pr' || argv[1] !== 'list') { process.exit(1); }
const table = ${JSON.stringify(prs)};
const head = argv[argv.indexOf('--head') + 1];
const li = argv.indexOf('--limit');
const limit = li === -1 ? 30 : Number(argv[li + 1]);
const all = table[head] || [];
process.stdout.write(JSON.stringify(all.slice(0, limit)));
`,
  );
  fs.chmodSync(gh, 0o755);
  return bin;
};

/** A `gh` that always exits non-zero — the unreachable/rate-limited host. */
const brokenGh = (tmp) => {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(gh, 0o755);
  return bin;
};

const envWith = (bin) => ({ ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` });

const dryRun = (repo, bin) => execFileSync('bash', [reap, '--dry-run'], { encoding: 'utf8', cwd: repo, env: envWith(bin) });
const yes = (repo, bin, ...args) =>
  execFileSync('bash', [reap, '--yes', ...args], { encoding: 'utf8', cwd: repo, env: envWith(bin) });

/**
 * A plan file DIRECTLY under `docs/plans/` — `listPlans()` only reads that
 * level, never `active/` — and DATE-PREFIXED: `planPathFor` (`phase-gate.ts`)
 * matches a slug only against a `YYYY-MM-DD-<slug>.md` basename.
 */
const plan = (repo, slug, branch) => {
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'docs', 'plans', `2026-10-28-${slug}.md`),
    `# ${slug}\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n- \`${branch}\` — the work\n`,
  );
};

test('the deleted set under --yes is a subset of the dry run’s would rows, even when the host answer flips', () => {
  const { tmp, repo } = makeRepo();
  const landed = 'bug/landed-before-flip';
  const stillOpen = 'bug/still-open';
  const landedWt = squashedWorktree(repo, landed);
  squashedWorktree(repo, stillOpen);
  const landedHead = git(landedWt, 'rev-parse', 'HEAD').trim();

  const bin = stubGh(tmp, { [landed]: [{ mergedAt: '2026-10-28T10:00:00Z', number: 1, headRefOid: landedHead }] });
  const dry = dryRun(repo, bin);
  assert.match(dry, new RegExp(`would.*${landed.replace('/', '\\/')}`), `dry run must plan the landed branch:\n${dry}`);
  assert.doesNotMatch(dry, new RegExp(`would.*${stillOpen.replace('/', '\\/')}`), `dry run must not plan the unlanded branch:\n${dry}`);

  // Push a brand-new branch to origin/main between the two runs — a fresh full
  // re-decision would see this change; the recorded intersection must not.
  const another = path.join(path.dirname(repo), 'plot-wt-another');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/after-the-dry-run', another, 'main');
  fs.writeFileSync(path.join(another, 'new.txt'), 'x');
  git(another, 'add', '-A');
  git(another, 'commit', '-qm', 'after the dry run');
  git(another, 'push', '-q', 'origin', 'feature/after-the-dry-run');

  const out = yes(repo, bin);
  assert.ok(!fs.existsSync(landedWt), 'the recorded landed worktree is removed');
  assert.doesNotMatch(
    out,
    /^(would|reaped|deleted)\s+feature\/after-the-dry-run\s/m,
    `a branch that appeared after the dry run is never ACTED ON by --yes:\n${out}`,
  );
});

test('a worktree row whose tip moved after the record is refused by name (tip changed)', () => {
  // A new commit on top of a merged branch always trips the ordinary
  // unpushed-commits gate first (reap-failed-readings.test.mjs already pins
  // that), so it cannot reach the record-specific `tip-changed` refusal. The
  // only way the record's pinned tip and the live tip disagree WITHOUT also
  // tripping the live gate is a tip that MOVES BUT STAYS an ancestor of main
  // — e.g. the branch ref reset to its own parent, still fully landed.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/tip-resets';
  git(repo, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(repo, 'first.txt'), '1');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'first');
  fs.writeFileSync(path.join(repo, 'second.txt'), '2');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'second');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', branch, '-m', `merge ${branch}`);
  git(repo, 'push', '-q', 'origin', 'main');
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'worktree', 'add', '-q', wt, branch);
  const bin = stubGh(tmp, {});

  const dry = dryRun(repo, bin);
  assert.match(dry, new RegExp(`would.*${branch.replace('/', '\\/')}`), `dry run must plan the landed desk:\n${dry}`);

  // Reset the branch ref to its own parent — still an ancestor of main, so
  // the live merge/unpushed gates both still pass, but the tip the record
  // pinned no longer matches.
  git(wt, 'reset', '-q', '--hard', 'HEAD~1');

  const out = yes(repo, bin);
  assert.ok(fs.existsSync(wt), 'a worktree whose tip moved since the record survives --yes');
  assert.match(out, /not in the recorded dry run:.*tip-changed/, `the refusal must name the tip change:\n${out}`);
});

test('a branch checked out in a new worktree after the record survives (checked-out read live)', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'bug/checked-out-after';
  const wt = squashedWorktree(repo, branch);
  const head = git(wt, 'rev-parse', 'HEAD').trim();
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-10-28T10:00:00Z', number: 3, headRefOid: head }] });

  const dry = dryRun(repo, bin);
  assert.match(dry, /would.*checked-out-after/, `dry run must plan the branch:\n${dry}`);

  // Remove the worktree but keep the branch, then check it out again in a
  // second worktree — the record cannot know this, so the live read must.
  git(repo, 'worktree', 'remove', '--force', wt);
  const second = path.join(path.dirname(repo), 'plot-wt-second-checkout');
  git(repo, 'worktree', 'add', '-q', second, branch);

  const out = yes(repo, bin);
  assert.ok(fs.existsSync(second), 'a branch checked out again after the dry run survives --yes');
  assert.match(out, /checked out/, `the refusal must say it is checked out:\n${out}`);
});

test('a hand-removed row from the record file is kept, never acted on', () => {
  const { tmp, repo } = makeRepo();
  const kept = 'bug/hand-removed';
  const other = 'bug/stays-recorded';
  const keptWt = squashedWorktree(repo, kept);
  const otherWt = squashedWorktree(repo, other);
  const keptHead = git(keptWt, 'rev-parse', 'HEAD').trim();
  const otherHead = git(otherWt, 'rev-parse', 'HEAD').trim();
  const bin = stubGh(tmp, {
    [kept]: [{ mergedAt: '2026-10-28T10:00:00Z', number: 4, headRefOid: keptHead }],
    [other]: [{ mergedAt: '2026-10-28T10:00:00Z', number: 5, headRefOid: otherHead }],
  });

  dryRun(repo, bin);
  const recordPath = path.join(repo, '.git', '.plot', 'state', 'reap-dry-run.json');
  const snapshot = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  // The record stores each worktree's REALPATH (macOS resolves /var to
  // /private/var), so the hand-edit must filter on that form, not the
  // unresolved path this test built the fixture with.
  const keptReal = fs.realpathSync(keptWt);
  snapshot.rows = snapshot.rows.filter((r) => r.identity !== kept && r.identity !== keptReal);
  fs.writeFileSync(recordPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  yes(repo, bin);
  assert.ok(fs.existsSync(keptWt), 'a worktree removed from the record by hand survives --yes');
  assert.ok(!fs.existsSync(otherWt), 'a worktree still in the record is still reaped');
});

test('a hand-added "PR merged" row is kept when the host now answers not-merged', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'bug/hand-added-row';
  const wt = squashedWorktree(repo, branch);
  // Record a dry run with NOTHING merged, so the branch is never in the
  // dry run's `would` rows — then hand-write a row claiming it was.
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: null, number: 6 }] });
  const dry = dryRun(repo, bin);
  assert.doesNotMatch(dry, /would.*hand-added-row/, `must not be planned yet:\n${dry}`);

  const recordPath = path.join(repo, '.git', '.plot', 'state', 'reap-dry-run.json');
  const snapshot = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const tipSha = git(wt, 'rev-parse', 'HEAD').trim();
  snapshot.rows.push({ kind: 'branch', identity: branch, tipSha, reason: 'PR merged (squash)' });
  fs.writeFileSync(recordPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  // The host still answers not-merged — re-asked live, exactly as the dry run asked.
  const out = yes(repo, bin);
  assert.ok(fs.existsSync(wt), 'a hand-added "PR merged" row cannot force a delete the host no longer confirms');
  assert.match(out, /no merged PR/, `the live refusal must still be the reason:\n${out}`);
});

test('a hand-added "PR merged" row is kept when the host answers rate-limited', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'bug/hand-added-throttled';
  const wt = squashedWorktree(repo, branch);
  const workingBin = stubGh(tmp, { [branch]: [{ mergedAt: null, number: 7 }] });
  dryRun(repo, workingBin);

  const recordPath = path.join(repo, '.git', '.plot', 'state', 'reap-dry-run.json');
  const snapshot = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const tipSha = git(wt, 'rev-parse', 'HEAD').trim();
  snapshot.rows.push({ kind: 'branch', identity: branch, tipSha, reason: 'PR merged (squash)' });
  fs.writeFileSync(recordPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  const brokenBin = brokenGh(tmp);
  const out = yes(repo, brokenBin);
  assert.ok(fs.existsSync(wt), 'a hand-added "PR merged" row cannot force a delete when the host cannot answer');
  assert.match(out, /could not answer/, `the refusal must say the host could not answer:\n${out}`);
});

test('a recorded worktree row whose desk gained an uncommitted file after the dry run is kept, with the worktree kind’s own reason', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/landed-then-dirtied';
  git(repo, 'checkout', '-q', '-b', branch);
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', branch, '-m', `merge ${branch}`);
  git(repo, 'push', '-q', 'origin', 'main');
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'worktree', 'add', '-q', wt, branch);
  const bin = stubGh(tmp, {});

  const dry = dryRun(repo, bin);
  assert.match(dry, new RegExp(`would.*${branch.replace('/', '\\/')}`), `dry run must plan the landed desk:\n${dry}`);

  fs.writeFileSync(path.join(wt, 'uncommitted.txt'), 'oops');

  const out = yes(repo, bin);
  assert.ok(fs.existsSync(wt), 'a desk that gained an uncommitted file after the dry run survives --yes');
  assert.match(out, /uncommitted/i, `the worktree kind's own refusal must be named:\n${out}`);
});

test('--yes --plan-slug <slug> with no record removes that plan’s landed desk and branch, and leaves another plan’s landed desk alone', () => {
  const { tmp, repo } = makeRepo();
  const inPlan = 'bug/in-the-plan';
  const notInPlan = 'bug/not-in-the-plan';
  const inPlanWt = squashedWorktree(repo, inPlan);
  const notInPlanWt = squashedWorktree(repo, notInPlan);
  const inPlanHead = git(inPlanWt, 'rev-parse', 'HEAD').trim();
  const notInPlanHead = git(notInPlanWt, 'rev-parse', 'HEAD').trim();
  const bin = stubGh(tmp, {
    [inPlan]: [{ mergedAt: '2026-10-28T10:00:00Z', number: 8, headRefOid: inPlanHead }],
    [notInPlan]: [{ mergedAt: '2026-10-28T10:00:00Z', number: 9, headRefOid: notInPlanHead }],
  });
  plan(repo, 'the-plan-slug', inPlan);

  // No --dry-run at all: --plan-slug needs no record.
  const out = yes(repo, bin, '--plan-slug', 'the-plan-slug');
  assert.ok(!fs.existsSync(inPlanWt), 'the named plan’s landed desk is removed with no record');
  assert.ok(fs.existsSync(notInPlanWt), 'a landed desk belonging to no named plan is left alone');
  assert.doesNotMatch(out, /no recorded dry run/);
});

test('a bare --yes with no record removes nothing and prints the --dry-run command', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'bug/no-record-at-all';
  const wt = squashedWorktree(repo, branch);
  const head = git(wt, 'rev-parse', 'HEAD').trim();
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-10-28T10:00:00Z', number: 10, headRefOid: head }] });

  const out = yes(repo, bin);
  assert.ok(fs.existsSync(wt), 'with no record a bare --yes acts on nothing');
  assert.match(out, /no recorded dry run.*--dry-run/, `must print the --dry-run command:\n${out}`);
});
