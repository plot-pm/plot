// Contract test for `plot-reconcile-scan.sh`'s "20a. Review bypass" section:
// a merged PR with no passing `plot/review` and no `review-bypass:` comment is
// evidence for a person to read. Two things must NOT be flagged — a PR that
// carries the bypass comment, and a merge that was never a PR at all — and one
// thing must clear once its status turns green.
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
 * A `gh` stub answering the merged-PR list and each PR's `pr view` reads.
 *
 * `merged` lists the merged page as `{number, head}`, returned in the RAW
 * `gh pr list --json number,title,state,headRefName,isDraft,url,updatedAt,
 * author,headRefOid,mergedAt` shape the plain arm of `plot-host.sh pr-list`
 * asks for — `plot-host.sh` itself renames `headRefName` to `head` before
 * `load_merged_pr_heads` ever reads it, so the stub must answer at the `gh`
 * layer, one level below that renaming.
 *
 * `prs` maps a PR number to `{ checks: 'green' | 'failing' | ..., comments:
 * [bodies] }` for the per-PR `pr view --json ...,statusCheckRollup` (read via
 * `plot-host.sh pr-state`) and `pr view --json comments` (`pr-comments`)
 * calls the section makes once a PR's checks are not green.
 */
const stubGh = ({ merged = [], prs = {} } = {}) => {
  const dir = tmp('bypass-gh');
  const log = path.join(dir, 'calls.log');
  const mergedPage = JSON.stringify(merged.map((m) => ({
    number: m.number, title: m.head, state: 'MERGED', headRefName: m.head,
    isDraft: false, url: '', updatedAt: '', author: { login: 'jwloka' },
    headRefOid: 'f'.repeat(40), mergedAt: '2026-10-01T00:00:00Z',
  })));
  // One rollup entry whose conclusion maps through `CHECKS_OF`: SUCCESS→green,
  // FAILURE→failing. No entries at all → "none", which also counts as
  // "not green" for this section's purpose.
  const rollupOf = (checks) => {
    if (checks === 'green') return [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }];
    if (checks === 'failing') return [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }];
    return [];
  };
  const prViewCases = Object.entries(prs).map(([num, info]) => `  "pr view ${num} --json number,state,isDraft,url,mergeCommit,headRefOid,statusCheckRollup")
    printf '%s' ${JSON.stringify(JSON.stringify({
      number: Number(num), state: 'MERGED', isDraft: false, url: '', mergeCommit: { oid: '' },
      headRefOid: 'f'.repeat(40), statusCheckRollup: rollupOf(prs[num].checks),
    }))}
    ;;
  "pr view ${num} --json comments")
    printf '%s' ${JSON.stringify(JSON.stringify({ comments: (info.comments ?? []).map((body) => ({ body })) }))}
    ;;`).join('\n');
  const script = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$*" in
  *"--state merged"*"--json number,title,state,headRefName"*) printf '%s' ${JSON.stringify(mergedPage)} ;;
  *"--state open"*) printf '%s' '[]' ;;
${prViewCases}
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

const runScan = (stub) => {
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

test('a raw commit on main, never a PR, is not flagged — there is nothing to ask the host about', () => {
  const stub = stubGh({ merged: [] });
  const out = runScan(stub);
  const sec = section(out);
  assert.match(sec, /\(none — no merged PR to examine\)|\(none — every examined merge carries a green status or a bypass note\)/);
  assert.equal(stub.calls().filter((l) => l.startsWith('pr view')).length, 0,
    'no PR to ask about means no pr-state or pr-comments call');
});

test('a merge with failing checks and no review-bypass comment is flagged', () => {
  const stub = stubGh({
    merged: [{ number: 101, head: 'feature/unreviewed' }],
    prs: { 101: { checks: 'failing', comments: ['looks fine to me'] } },
  });
  const out = runScan(stub);
  const sec = section(out);
  assert.match(sec, /origin\/feature\/unreviewed — PR #101 merged with checks=failing, no review-bypass: comment/);
  assert.equal(stub.calls().filter((l) => l === 'pr view 101 --json comments').length, 1,
    'comments are read once checks are confirmed not green');
});

test('a merge with no passing checks BUT a review-bypass: comment is not flagged', () => {
  const stub = stubGh({
    merged: [{ number: 102, head: 'feature/bypassed' }],
    prs: { 102: { checks: 'failing', comments: ['review-bypass: ci was flaky, verified by hand — jwloka'] } },
  });
  const out = runScan(stub);
  const sec = section(out);
  assert.doesNotMatch(sec, /PR #102/);
  assert.match(sec, /\(none — every examined merge carries a green status or a bypass note\)/);
});

test('a merge whose plot/review passed (checks=green) is not flagged, and no comments are read', () => {
  const stub = stubGh({
    merged: [{ number: 103, head: 'feature/reviewed' }],
    prs: { 103: { checks: 'green', comments: [] } },
  });
  const out = runScan(stub);
  const sec = section(out);
  assert.doesNotMatch(sec, /PR #103/);
  assert.match(sec, /\(none — every examined merge carries a green status or a bypass note\)/);
  assert.equal(stub.calls().filter((l) => l === 'pr view 103 --json comments').length, 0,
    'a green status never needs the comments call at all');
});
