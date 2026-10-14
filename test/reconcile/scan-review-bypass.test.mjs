// Contract test for `plot-reconcile-scan.sh`'s "20a. Review bypass" section.
// The section prints the answer of `board/plot-review-bypass.mjs`, which reads
// each merged PR's `plot/review` status per context and decides through
// `reviewBypasses`. Needs the built bundle: `pnpm build:board`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

const ctx = [];
const tmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `plot-${tag}-`));
  ctx.push(d);
  return d;
};
after(() => { for (const d of ctx) fs.rmSync(d, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A `gh` stub answering the merged-PR list, each PR's `pr view` read and the
 * commit-status read `plot-host.sh pr-review` makes.
 *
 * `prs` maps a PR number to `{ head, state, comments: [bodies], unreadable }`.
 * `state` is the newest `plot/review` status on the PR's head, or absent for
 * none. CI is never modelled: a PR whose CI is green and whose `plot/review`
 * is missing must still be reported, which is the shape of #1687.
 */
const stubGh = ({ prs = {} } = {}) => {
  const dir = tmp('bypass-gh');
  const log = path.join(dir, 'calls.log');
  const mergedPage = JSON.stringify(Object.entries(prs).map(([number, p]) => ({
    number: Number(number), title: p.head, state: 'MERGED', headRefName: p.head,
    isDraft: false, url: '', updatedAt: '', author: { login: 'jwloka' },
    headRefOid: `sha${number}`, mergedAt: '2026-10-01T00:00:00Z',
  })));
  const cases = Object.entries(prs).map(([num, p]) => `  "pr view ${num} --json headRefOid,comments")
    ${p.unreadable ? 'echo "HTTP 502" >&2; exit 1' : `printf '%s' ${JSON.stringify(JSON.stringify({
      headRefOid: `sha${num}`, comments: (p.comments ?? []).map((body) => ({ body })),
    }))}`}
    ;;
  "api repos/{owner}/{repo}/commits/sha${num}/statuses")
    printf '%s' ${JSON.stringify(JSON.stringify(p.state === undefined ? [
      { context: 'ci/build', state: 'success' },
    ] : [
      { context: 'ci/build', state: 'success' }, { context: 'plot/review', state: p.state },
    ]))}
    ;;`).join('\n');
  const script = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$*" in
  *"--state merged"*"--json number,title,state,headRefName"*) printf '%s' ${JSON.stringify(mergedPage)} ;;
  *"--state open"*) printf '%s' '[]' ;;
${cases}
esac
exit 0
`;
  fs.writeFileSync(path.join(dir, 'gh'), script);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return {
    dir,
    calls: () => (fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l !== '')
      : []),
  };
};

let repo;
let scanTmpdir;
before(() => {
  const t = tmp('bypass-repo');
  const origin = path.join(t, 'origin.git');
  repo = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', origin);
  git(t, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  // `origin`'s URL only needs to look like a GitHub remote so `PR_SOURCE`
  // resolves to `gh` — nothing is ever pushed there over the network. The
  // real transport is `store`, a second remote pointing at the local bare
  // repo; `origin`'s remote-tracking refs are then mirrored from `store`'s,
  // matching scan-index.test.mjs's established pattern.
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');
  git(repo, 'remote', 'add', 'store', origin);

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# Fixture', '', '## Plot Config', '',
    '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/',
    '- **Plan directory:** plans/', '- **Active index:** plans/active/',
    '- **Delivered index:** plans/delivered/', ''].join('\n'));
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');

  // A raw commit on main — never a PR at all. Section 20a must report nothing
  // for it; there is no PR number to even ask about.
  fs.writeFileSync(path.join(repo, 'direct.txt'), 'pushed straight to main\n');
  git(repo, 'add', 'direct.txt');
  git(repo, 'commit', '-qm', 'a raw commit, never a PR');

  // Three remote-tracking branches under a configured prefix — `all_branches`
  // (and so `merged_asked_branches`) reads `git branch -r`, so each PR this
  // file examines needs a real `origin/feature/<name>` ref, even though the
  // branch's own content never matters (section 20a reads the gh stub, not
  // the diff).
  const branches = ['feature/unreviewed', 'feature/bypassed', 'feature/reviewed'];
  for (const b of branches) {
    git(repo, 'branch', b, 'main');
  }

  git(repo, 'push', '-q', 'store', 'main', ...branches);
  git(repo, 'fetch', '-q', 'store');
  for (const b of ['main', ...branches]) {
    git(repo, 'update-ref', `refs/remotes/origin/${b}`, `refs/remotes/store/${b}`);
  }
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
});

const runScan = (stub, since = '2026-09-01T00:00:00Z') => {
  const claude = path.join(repo, 'CLAUDE.md');
  const base = fs.readFileSync(claude, 'utf8').split('\n').filter((l) => !l.includes('Review required since'));
  fs.writeFileSync(claude, [...base.filter((l, i, a) => i < a.length - 1 || l !== ''),
    ...(since ? [`- **Review required since:** ${since}`] : []), ''].join('\n'));
  scanTmpdir ??= tmp('bypass-tmpdir');
  const env = {
    ...process.env,
    TMPDIR: scanTmpdir,
    PLOT_BUDGET_HOME: scanTmpdir,
    PATH: `${stub.dir}:${process.env.PATH}`,
    PLOT_PR_INDEX_HOME: tmp('bypass-empty-store'),
  };
  return execFileSync('bash', [scan, '--no-fetch'], { encoding: 'utf8', cwd: repo, env });
};

const section = (out) => {
  const lines = out.split('\n');
  const start = lines.findIndex((l) => l.startsWith('== 20a.'));
  const end = lines.findIndex((l, i) => i > start && /^== \d/.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
};

const reported = (sec) => sec.split('\n').filter((l) => l.startsWith('  PR #'));

test('with no Review required since key the section says so and asks the host nothing', () => {
  const stub = stubGh({ prs: { 100: { head: 'feature/unreviewed' } } });
  const out = runScan(stub, '');
  assert.match(section(out), /\(not evaluated — no `Review required since` key is set/);
  assert.equal(stub.calls().filter((l) => l.startsWith('pr view')).length, 0);
  assert.match(out.trim().split('\n').at(-1), / review_bypass=0 /);
});

test('green CI, no plot/review status and no comment, merged after the cutoff, is reported (the #1687 shape)', () => {
  const stub = stubGh({ prs: { 101: { head: 'feature/unreviewed', comments: ['looks fine to me'] } } });
  const out = runScan(stub);
  assert.deepEqual(reported(section(out)),
    ['  PR #101 merged with no passing plot/review and no review-bypass: comment']);
  assert.match(out.trim().split('\n').at(-1), / review_bypass=1 /);
});

test('a failing plot/review with no bypass comment is reported', () => {
  const out = runScan(stubGh({ prs: { 104: { head: 'feature/unreviewed', state: 'failure' } } }));
  assert.equal(reported(section(out)).length, 1);
});

test('a bypass comment clears a missing review', () => {
  const out = runScan(stubGh({ prs: { 102: { head: 'feature/bypassed',
    comments: ['review-bypass: reviewer stuck, verified by hand — jwloka'] } } }));
  const sec = section(out);
  assert.equal(reported(sec).length, 0);
  assert.match(sec, /\(none — every examined merge carries a passing plot\/review or a bypass note\)/);
});

test('a passing plot/review is not reported', () => {
  const out = runScan(stubGh({ prs: { 103: { head: 'feature/reviewed', state: 'success' } } }));
  assert.equal(reported(section(out)).length, 0);
});

test('a PR whose read failed is named as unread and the section never says none', () => {
  const out = runScan(stubGh({ prs: {
    105: { head: 'feature/unreviewed', unreadable: true },
    106: { head: 'feature/reviewed', state: 'success' },
  } }));
  const sec = section(out);
  assert.match(sec, /unread PR #105 — the host read failed/);
  assert.doesNotMatch(sec, /\(none/);
  assert.equal(reported(sec).length, 0, 'an unread PR is not counted as a bypass');
});
