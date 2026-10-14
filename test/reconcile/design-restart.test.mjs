// Contract test for the restart entry (`board/plot-design.mjs restart <slug>`):
// a person's hand route onto a plan's spec run, against a sandbox origin, a
// `gh` stub, and the built bundle — one test per documented arm.
//
// The restart entry never writes `auto-design-in-flight.json` itself; it
// writes a mark file under `.plot/state/design/restart/` for fleetd's next
// spec pass to fold. Every test below asserts that split: the mark file's
// shape, and that the in-flight store is untouched.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const BUNDLE = path.join(SCRIPTS, 'board', 'plot-design.mjs');
const SLUG = 'alpha';
const PLAN_REL = `docs/plans/2026-10-12-${SLUG}.md`;
const BRANCH = `idea/${SLUG}-spec`;

const made = [];
const track = (dir) => {
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const PLAN = (designLine = 'Design:abc1234') => `${designLine}

# Alpha

## Spec

## Status

- **State:** Design
`;

/** A sandbox clone of a bare origin with the plan on main and `origin/HEAD` set. */
const makeRepo = (planBody) => {
  const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-design-restart-')));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, PLAN_REL), planBody);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  return { repo, origin };
};

/** Pushes `idea/<slug>-spec` to origin, with commits beyond the claim marker when `written`. */
const pushSpecBranch = (repo, { written = false } = {}) => {
  git(repo, 'checkout', '-qb', BRANCH);
  // An EMPTY commit — `isClaimMarker` requires the same tree as its parent, so
  // a claim marker carries no diff. A commit that touches a file is "work" by
  // this rule regardless of its subject.
  git(repo, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${BRANCH}`);
  if (written) {
    const planBody = PLAN().replace('## Spec\n\n', '## Spec\n\nSome decided text.\n\n');
    fs.writeFileSync(path.join(repo, PLAN_REL), planBody);
    git(repo, 'add', PLAN_REL);
    git(repo, 'commit', '-qm', 'spec: alpha');
  }
  git(repo, 'push', '-q', 'origin', BRANCH);
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'branch', '-qD', BRANCH);
};

/** A `gh` stub answering `pr view`/`pr list`/`pr create` for one fixed PR state. */
const makeGhStub = ({
  prView = null, // null | { number, state, isDraft, url, mergeCommit }
  mergedAt = null, // null | an ISO string, for `pr list --head ... --json mergedAt`
  createUrl = 'https://example.invalid/pr/99',
} = {}) => {
  const stubDir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-design-restart-stub-')));
  const viewBody = prView === null
    ? 'echo "no pull requests found for branch" >&2; exit 1'
    : `printf '%s' '${JSON.stringify({
        number: prView.number,
        state: prView.state,
        isDraft: prView.isDraft ?? false,
        url: prView.url ?? 'https://example.invalid/pr/' + prView.number,
        mergeCommit: prView.mergeCommit ?? null,
        headRefOid: 'deadbeef',
        statusCheckRollup: [],
      })}'`;
  const listBody = `printf '%s' '${JSON.stringify(mergedAt === null ? [] : [{ mergedAt }])}'`;
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/usr/bin/env bash
if [ "$1" = pr ] && [ "$2" = view ]; then
  ${viewBody}
elif [ "$1" = pr ] && [ "$2" = list ]; then
  ${listBody}
elif [ "$1" = pr ] && [ "$2" = create ]; then
  printf '%s' '${createUrl}'
elif [ "$1" = repo ] && [ "$2" = view ]; then
  printf 'main'
else
  printf '{}'
fi
`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
  return stubDir;
};

const childEnv = (stubDir) => {
  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH}`,
    PLOT_HOST: 'github',
    PLOT_BUDGET_HOME: stubDir,
    PLOT_PR_INDEX_HOME: stubDir,
  };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  return env;
};

const design = (repo, stubDir, args) =>
  spawnSync(process.execPath, [BUNDLE, ...args], { cwd: repo, encoding: 'utf8', env: childEnv(stubDir) });

const marksIn = (repo, slug) => {
  const dir = path.join(repo, '.plot', 'state', 'design', 'restart');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.startsWith(`${slug}.`));
};

const readMark = (repo, slug) => {
  const files = marksIn(repo, slug);
  assert.equal(files.length, 1, `exactly one mark file for ${slug}`);
  return JSON.parse(fs.readFileSync(path.join(repo, '.plot', 'state', 'design', 'restart', files[0]), 'utf8'));
};

const inFlightPath = (repo) => path.join(repo, '.plot', 'state', 'auto-design-in-flight.json');

test('design restart: an absent spec branch writes a start mark and never touches the in-flight store', () => {
  const { repo } = makeRepo(PLAN());
  const stubDir = makeGhStub();
  const r = design(repo, stubDir, ['restart', SLUG]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /restart: start/);
  const mark = readMark(repo, SLUG);
  assert.equal(mark.commit, 'abc1234');
  assert.equal(mark.answeredPr, undefined);
  assert.equal(mark.kind, 'start');
  assert.equal(fs.existsSync(inFlightPath(repo)), false, 'the in-flight store is never written by restart');
});

test('design restart: a claim-only branch deletes the ref first, then writes a start mark', () => {
  const { repo, origin } = makeRepo(PLAN());
  pushSpecBranch(repo, { written: false });
  assert.notEqual(git(repo, 'ls-remote', '--heads', origin, BRANCH).trim(), '', 'the claim-only branch exists before restart');
  const stubDir = makeGhStub();
  const r = design(repo, stubDir, ['restart', SLUG]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /restart: start/);
  assert.equal(git(repo, 'ls-remote', '--heads', origin, BRANCH).trim(), '', 'the claim-only branch was deleted on origin');
  readMark(repo, SLUG);
});

test('design restart: work with no PR and a written spec opens a draft PR', () => {
  const { repo } = makeRepo(PLAN());
  pushSpecBranch(repo, { written: true });
  const stubDir = makeGhStub({ prView: null });
  const r = design(repo, stubDir, ['restart', SLUG]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /restart: pr-opened — https:\/\/example\.invalid\/pr\/99/);
  const mark = readMark(repo, SLUG);
  assert.equal(mark.commit, 'abc1234');
  assert.equal(mark.kind, 'pr-opened', 'fleetd folds this mark as a success, not a restart');
});

test('design restart: a claim-only branch with no PR deletes the ref unconditionally', () => {
  // `written: false` resolves `claimTip` to `claim-only` — the SAME commit
  // count `design.ts`'s `written` check reads, so a `work`-arm branch always
  // has `written === true`. The `work` arm's "pr null, unwritten" sub-case is
  // therefore unreachable in practice; this exercises the claim-only arm,
  // which deletes without ever consulting `prMerged`.
  const { repo, origin } = makeRepo(PLAN());
  pushSpecBranch(repo, { written: false });
  const stubDir = makeGhStub({ prView: null, mergedAt: null });
  const r = design(repo, stubDir, ['restart', SLUG]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /restart: start/);
  assert.equal(git(repo, 'ls-remote', '--heads', origin, BRANCH).trim(), '', 'the empty-spec branch was deleted');
  readMark(repo, SLUG);
});

test('design restart: a closed PR deletes the ref only once confirmed not-merged', () => {
  const { repo, origin } = makeRepo(PLAN());
  // `written: true` — the CLOSED-PR merge check lives in the `work` arm; a
  // claim-only branch (no commits beyond the claim) never reaches it.
  pushSpecBranch(repo, { written: true });
  const stubDir = makeGhStub({ prView: { number: 7, state: 'CLOSED' }, mergedAt: null });
  const r = design(repo, stubDir, ['restart', SLUG]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(git(repo, 'ls-remote', '--heads', origin, BRANCH).trim(), '', 'a closed, unmerged PR still lets the ref be deleted');
  const mark = readMark(repo, SLUG);
  assert.equal(mark.answeredPr, 7);
});

test('design restart: a closed PR the host cannot confirm unmerged refuses, and deletes nothing', () => {
  const { repo, origin } = makeRepo(PLAN());
  pushSpecBranch(repo, { written: true });
  const stubDir = makeGhStub({ prView: { number: 7, state: 'CLOSED' }, mergedAt: '2026-10-01T00:00:00Z' });
  const r = design(repo, stubDir, ['restart', SLUG]);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /refused merged/);
  assert.notEqual(git(repo, 'ls-remote', '--heads', origin, BRANCH).trim(), '', 'the branch was not deleted');
  assert.equal(marksIn(repo, SLUG).length, 0, 'no mark is written on refusal');
});

test('design restart: an open PR refuses by name', () => {
  const { repo } = makeRepo(PLAN());
  pushSpecBranch(repo, { written: true });
  const stubDir = makeGhStub({ prView: { number: 9, state: 'OPEN' } });
  const r = design(repo, stubDir, ['restart', SLUG]);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /refused open-pr/);
  assert.equal(marksIn(repo, SLUG).length, 0);
});

test('design restart: a merged PR refuses by name', () => {
  const { repo } = makeRepo(PLAN());
  pushSpecBranch(repo, { written: true });
  const stubDir = makeGhStub({ prView: { number: 11, state: 'MERGED' } });
  const r = design(repo, stubDir, ['restart', SLUG]);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /refused merged/);
  assert.equal(marksIn(repo, SLUG).length, 0);
});

test('design restart: an unreadable branch refuses unknown', () => {
  const { repo } = makeRepo(PLAN());
  const stubDir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-design-restart-stub-')));
  fs.writeFileSync(path.join(stubDir, 'gh'), '#!/usr/bin/env bash\necho "rate limit exceeded" >&2\nexit 1\n');
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
  pushSpecBranch(repo, { written: true });
  const r = design(repo, stubDir, ['restart', SLUG]);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /refused unknown/);
  assert.equal(marksIn(repo, SLUG).length, 0);
});

test('design restart: status prints nothing for a plan with no recorded spec-run activity', () => {
  const { repo } = makeRepo(PLAN());
  const stubDir = makeGhStub();
  const r = design(repo, stubDir, ['status']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(r.stdout, '', 'designStatusLines is pinned to return \'\' for an all-empty state');
});

test('design restart: status reports a refusal recorded in the design state file', () => {
  const { repo } = makeRepo(PLAN());
  const statePath = path.join(repo, '.plot', 'state', 'auto-design-in-flight.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ running: {}, refusals: { [SLUG]: 'open-pr' } }));
  const stubDir = makeGhStub();
  const r = design(repo, stubDir, ['status']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, new RegExp(SLUG));
});
