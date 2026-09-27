// Contract test for `plot-impl-status.sh` reading `PrIndexStore` before the host.
//
// WHAT THIS PINS. The helper answers *did this plan's PRs merge?* and used to
// answer it only by asking the host — one `pr-list --state merged` plus one
// `pr-state` per branch. It now consults the PR index first and asks the host
// only for what the store cannot answer.
//
// THE ASSERTION THAT MATTERS IS A CALL COUNT, NOT AN ANSWER. Every test here
// that only checked the OUTPUT would pass against a reader that reads nothing:
// the host fallback produces the same JSON, correctly, which is the whole point
// of keeping it. Measured while writing this branch — the first draft narrowed
// the store read on `result.outcome === 'answered'`, a field `PortResult` does
// not carry, so the test was never true, every read fell through to `null`, and
// the bundle answered `ask` for a store it had just parsed. Output-only tests
// were green throughout. So the store-hit test counts `gh` invocations and
// requires ZERO.
//
// THE OTHER DIRECTION IS EQUALLY PINNED. A store must never manufacture an
// answer: an unreachable host with no store reports nothing rather than
// "merged" or "not merged", and a store row the host contradicts loses.
//
// TESTS NEVER TOUCH THE OPERATOR'S OWN STORE. Every case sets
// `PLOT_PR_INDEX_HOME` to a temp dir. Without it these would write fixture PRs
// into `.git/.plot/state/index/`, which a live board reads and serves.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const implStatus = path.join(root, 'skills', 'plot', 'scripts', 'plot-impl-status.sh');
const bundle = path.join(root, 'skills', 'plot', 'scripts', 'board', 'plot-pr-index-lookup.mjs');

const ctx = [];
after(() => { for (const t of ctx) fs.rmSync(t, { recursive: true, force: true }); });

const tmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `plot-${tag}-`));
  ctx.push(d);
  return d;
};

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A `gh` that answers the helper's calls AND records every invocation.
 *
 * The log is the subject of half this file: a call the helper did not need to
 * make is the defect, and it is invisible in the output.
 *
 * `reachable: false` makes every call exit non-zero, which is how an
 * unreachable host is reproduced without a network.
 */
function stubGh({ mergedHeads = [], states = {}, reachable = true } = {}) {
  const dir = tmp('ghstub');
  const log = path.join(dir, 'calls.log');
  const rows = JSON.stringify(mergedHeads.map((h, i) => ({
    number: 900 + i, headRefName: h, state: 'MERGED', title: h,
  })));
  // `states` overrides the state a given PR number reports, so a test can make
  // the host disagree with the store.
  const caseArms = Object.entries(states)
    .map(([n, s]) => `    ${n}) st='${s}' ;;`)
    .join('\n');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
${reachable ? '' : 'exit 1'}
if [[ "$*" == *"pr view"* ]]; then
  n=""
  for a in "$@"; do case "$a" in [0-9]*) n="$a"; break ;; esac; done
  st='MERGED'
  case "\${n:-0}" in
${caseArms}
  esac
  printf '{"number":%s,"state":"%s","isDraft":false,"url":"https://example.test/pr/%s","mergeCommit":{"oid":"abc"}}' "\${n:-0}" "$st" "\${n:-0}"
  exit 0
fi
if [[ "$*" == *"pr list"* ]]; then printf '%s' '${rows.replace(/'/g, `'\\''`)}'; exit 0; fi
printf '%s' '{}'
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return {
    dir,
    calls: () => (fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l !== '')
      : []),
  };
}

/** A store directory holding one connector's file, written verbatim. */
function storeWith(rows, { complete = true, v = 2, raw = null } = {}) {
  const dir = tmp('prindex');
  const body = raw !== null ? raw : JSON.stringify({
    v,
    connector: 'github',
    watermark: '2026-09-26T12:00:00Z',
    complete,
    at: new Date().toISOString(),
    rows,
  });
  fs.writeFileSync(path.join(dir, 'github.json'), body);
  return dir;
}

/** A merged row, with only the fields the store actually holds. */
const mergedRow = (number, head) => ({
  number, head, state: 'MERGED', draft: false,
  checks: 'green', review: 'approved', url: `https://example.test/pr/${number}`,
});

/** A repo with a bare origin holding one plan, whose section is given verbatim. */
function repoWithPlan(sectionBody) {
  const t = tmp('implidx');
  const origin = path.join(t, 'origin.git');
  const repo = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', origin);
  git(t, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    '# Repo\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Git host:** github\n',
  );
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'docs', 'plans', '2026-09-26-a-plan.md'),
    ['# A plan', '', '## Status', '', '- **State:** Approved', '', sectionBody, ''].join('\n'),
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return repo;
}

function statusOf(repo, { stub, storeHome, cwd = repo } = {}) {
  const env = {
    ...process.env,
    PATH: `${stub.dir}:${process.env.PATH}`,
    PLOT_HOST: 'github',
    // ALWAYS SET, even to a directory with no store: an unset value would let
    // the adapter resolve the operator's real `.git/.plot/state/index/`.
    PLOT_PR_INDEX_HOME: storeHome ?? tmp('empty'),
  };
  return JSON.parse(execFileSync('bash', [implStatus, 'a-plan'], { encoding: 'utf8', cwd, env }));
}

const byBranch = (j) => Object.fromEntries((j.prs || []).map((p) => [p.branch, p]));

// THE CASE THE SLICE EXISTS FOR, and the only test here that could catch a
// reader that reads nothing. Two annotated branches, both MERGED in the store:
// the helper must answer from it and touch the host ZERO times.
test('a fully merged plan is answered from the store with no host call', () => {
  const repo = repoWithPlan([
    '## Slices', '',
    '### One (Branch: feature/one, PR: #447)', '',
    'The first.', '',
    '### Two (Branch: feature/two, PR: #448)', '',
    'The second.',
  ].join('\n'));
  const stub = stubGh();
  const store = storeWith([mergedRow(447, 'feature/one'), mergedRow(448, 'feature/two')]);
  const j = statusOf(repo, { stub, storeHome: store });

  assert.deepEqual(
    stub.calls(), [],
    'a plan every one of whose PRs is MERGED in the store must not ask the host at all',
  );
  const got = byBranch(j);
  assert.equal(got['feature/one'].number, 447);
  assert.equal(got['feature/one'].state, 'MERGED');
  assert.equal(got['feature/two'].number, 448);
  assert.equal(got['feature/two'].state, 'MERGED');
});

// An un-annotated branch resolves by HEAD, which the store can also answer —
// the arm that replaces `pr-list --state merged` rather than `pr-state`.
test('an un-annotated branch resolves from the store by head, with no host call', () => {
  const repo = repoWithPlan([
    '## Slices', '', '### Only (Branch: feature/unannotated)', '', 'No PR written down.',
  ].join('\n'));
  const stub = stubGh({ mergedHeads: ['feature/unannotated'] });
  const store = storeWith([mergedRow(901, 'feature/unannotated')]);
  const j = statusOf(repo, { stub, storeHome: store });

  assert.deepEqual(stub.calls(), [], 'a head the store knows must not cost a pr-list');
  assert.equal(byBranch(j)['feature/unannotated'].number, 901);
});

// TRUSTING A NON-TERMINAL ROW IS THE DEFECT. An OPEN row can be stale in either
// direction, so the host decides — and here the host says MERGED.
test('a store row that is OPEN gives the host the last word', () => {
  const repo = repoWithPlan([
    '## Slices', '', '### Only (Branch: feature/one, PR: #447)', '', 'One.',
  ].join('\n'));
  const stub = stubGh();
  const store = storeWith([
    { ...mergedRow(447, 'feature/one'), state: 'OPEN' },
  ]);
  const j = statusOf(repo, { stub, storeHome: store });

  assert.ok(stub.calls().length > 0, 'a non-terminal row must be re-asked, not trusted');
  assert.equal(byBranch(j)['feature/one'].state, 'MERGED', "the host's answer wins");
});

// The mirror: a row the store calls MERGED is kept even though this stub would
// have said CLOSED. That is the terminal licence, stated as a test rather than
// only as a comment — a merged PR cannot revert.
test('a MERGED row is trusted and the host is never asked to contradict it', () => {
  const repo = repoWithPlan([
    '## Slices', '', '### Only (Branch: feature/one, PR: #447)', '', 'One.',
  ].join('\n'));
  const stub = stubGh({ states: { 447: 'CLOSED' } });
  const store = storeWith([mergedRow(447, 'feature/one')]);
  const j = statusOf(repo, { stub, storeHome: store });

  assert.deepEqual(stub.calls(), []);
  assert.equal(byBranch(j)['feature/one'].state, 'MERGED');
});

// A DRAFT IS ASKED ABOUT WHATEVER ITS STATE SAYS. A draft PR is by definition
// one still being changed, and the gate downstream reads `draft`.
test('a draft row is re-asked rather than answered from', () => {
  const repo = repoWithPlan([
    '## Slices', '', '### Only (Branch: feature/one, PR: #447)', '', 'One.',
  ].join('\n'));
  const stub = stubGh();
  const store = storeWith([{ ...mergedRow(447, 'feature/one'), draft: true }]);
  statusOf(repo, { stub, storeHome: store });
  assert.ok(stub.calls().length > 0, 'a draft row must not settle the question');
});

// ABSENCE STAYS ABSENCE. No store, and a host that cannot be reached: the
// helper must report nothing rather than "merged" or "not merged". This is the
// case a delivery gate reads, and an empty result invented here reads to it as
// "this plan has no PRs" — the 2026-08-27 failure, in the other direction.
test('an unreachable host with no store answers nothing, never an invented state', () => {
  const repo = repoWithPlan([
    '## Slices', '', '### Only (Branch: feature/one, PR: #447)', '', 'One.',
  ].join('\n'));
  const stub = stubGh({ reachable: false });
  const j = statusOf(repo, { stub });

  assert.deepEqual(j.prs, [], 'an unresolvable branch is reported by its ABSENCE from prs');
  assert.equal(j.error, undefined, 'and not as an error that a caller might swallow');
  assert.ok(stub.calls().length > 0, 'with no store it must genuinely have tried the host');
});

// A ROW MISSING FROM AN INCOMPLETE STORE IS NOT PROOF THAT NO PR EXISTS. The
// `complete` latch exists for exactly this reader.
test('a branch with no row falls back to the host', () => {
  const repo = repoWithPlan([
    '## Slices', '', '### Only (Branch: feature/one, PR: #447)', '', 'One.',
  ].join('\n'));
  const stub = stubGh();
  const store = storeWith([mergedRow(999, 'feature/other')], { complete: false });
  const j = statusOf(repo, { stub, storeHome: store });

  assert.ok(stub.calls().length > 0, 'a missing row must ask, never answer "no PR"');
  assert.equal(byBranch(j)['feature/one'].state, 'MERGED');
});

// A DECODER THAT THREW WOULD BREAK EVERY DELIVERY ON A STALE CHECKOUT. Measured
// on this machine 2026-09-26: the live store read `v: 1` while the schema said
// 2, because the running board was built from an older artifact. That is the
// ordinary state of a checkout mid-upgrade, and it must cost one host call and
// nothing else.
for (const [name, opts] of [
  ['a missing store', { storeHome: undefined }],
  ['an unparseable store', { raw: 'not json at all' }],
  ['an empty store', { raw: '' }],
  ['a wrong-version store', { v: 1 }],
]) {
  test(`${name} gives exactly today's output`, () => {
    const repo = repoWithPlan([
      '## Slices', '', '### Only (Branch: feature/one, PR: #447)', '', 'One.',
    ].join('\n'));
    const stub = stubGh();
    const storeHome = 'storeHome' in opts && opts.storeHome === undefined
      ? undefined
      : storeWith([mergedRow(447, 'feature/one')], opts);
    const j = statusOf(repo, { stub, storeHome });

    assert.ok(stub.calls().length > 0, `${name} must fall through to the host`);
    assert.equal(byBranch(j)['feature/one'].state, 'MERGED');
    assert.equal(byBranch(j)['feature/one'].number, 447);
  });
}

// THE STORE IS FOUND FROM A LINKED WORKTREE. `prIndexFile()` resolves
// `--git-common-dir`, never `--show-toplevel` — the latter answers the DESK,
// and `plot-reap.sh` removes desks. A test run only in the main checkout cannot
// tell the two apart, which is why this one runs from a `git worktree add`.
test('a linked worktree reads the main checkout\'s store', () => {
  const repo = repoWithPlan([
    '## Slices', '', '### Only (Branch: feature/one, PR: #447)', '', 'One.',
  ].join('\n'));
  const desk = path.join(path.dirname(repo), 'desk');
  git(repo, 'worktree', 'add', '-q', '--detach', desk);

  // The store is written where the COMMON git dir would put it, and the helper
  // is run from the desk. Resolving `--show-toplevel` there would look inside
  // the desk and find nothing — which reads as "ask the host", so the assertion
  // is again the CALL COUNT rather than the answer.
  const commonDir = git(desk, 'rev-parse', '--git-common-dir').trim();
  const storeHome = path.join(path.resolve(desk, commonDir), '.plot', 'state', 'index');
  fs.mkdirSync(storeHome, { recursive: true });
  fs.writeFileSync(path.join(storeHome, 'github.json'), JSON.stringify({
    v: 2, connector: 'github', watermark: null, complete: true,
    at: new Date().toISOString(), rows: [mergedRow(447, 'feature/one')],
  }));

  const stub = stubGh();
  // PLOT_PR_INDEX_HOME is deliberately NOT set here: the point is that the
  // adapter's own `--git-common-dir` resolution finds this file from the desk.
  const j = JSON.parse(execFileSync('bash', [implStatus, 'a-plan'], {
    encoding: 'utf8',
    cwd: desk,
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  }));

  assert.deepEqual(
    stub.calls(), [],
    'the desk must resolve the same store as the main checkout — --show-toplevel would not',
  );
  assert.equal(byBranch(j)['feature/one'].number, 447);
});

// A CROSS-REPO ANNOTATION NAMES ANOTHER REPOSITORY'S PR, and this store holds
// only this checkout's. Answering `owner/repo#12` from here would report a
// foreign PR as ours — and the number could collide with a local one, which is
// how it would go unnoticed.
test('a cross-repo annotation is never answered from this store', () => {
  const repo = repoWithPlan([
    '## Branches', '',
    '- `feature/elsewhere` — lives in another repo → other/repo#447',
  ].join('\n'));
  const stub = stubGh();
  // A local row carrying the SAME number, which a number-only lookup would hit.
  const store = storeWith([mergedRow(447, 'feature/elsewhere')]);
  statusOf(repo, { stub, storeHome: store });

  // `-R`, NOT `--repo`. `plot-host.sh` is the adapter that translates Plot's
  // vocabulary into each CLI's, and `gh` spells the pin `-R owner/repo`. A test
  // asserting on the host CLI's argv must speak the host CLI's flags.
  assert.ok(
    stub.calls().some((c) => c.includes('-R other/repo')),
    'the cross-repo branch must be asked of the host, with its repo named',
  );
});

// The bundle ships beside the script. A checkout whose artifact is missing must
// degrade to today's behaviour rather than failing — an npm install, an unbuilt
// tree or a node that will not run all produce this.
test('the shipped bundle exists, and the helper works without it', () => {
  assert.ok(fs.existsSync(bundle), 'plot-pr-index-lookup.mjs must be built and committed');

  const repo = repoWithPlan([
    '## Slices', '', '### Only (Branch: feature/one, PR: #447)', '', 'One.',
  ].join('\n'));
  const stub = stubGh();
  const store = storeWith([mergedRow(447, 'feature/one')]);

  // A `node` THAT WILL NOT RUN, rather than a PATH stripped of it. Stripping
  // the PATH also removes `dirname`, `git` and everything else the helper
  // needs, so it reproduces a broken machine rather than an unbuilt checkout —
  // measured here first, and it failed at line 24 on `dirname` having proved
  // nothing about the bundle. Shadowing `node` with a stub that exits non-zero
  // is the narrow version of the same condition.
  const shim = tmp('badnode');
  fs.writeFileSync(path.join(shim, 'node'), '#!/usr/bin/env bash\nexit 127\n');
  fs.chmodSync(path.join(shim, 'node'), 0o755);

  const j = JSON.parse(execFileSync('bash', [implStatus, 'a-plan'], {
    encoding: 'utf8',
    cwd: repo,
    env: {
      ...process.env,
      PATH: `${shim}:${stub.dir}:${process.env.PATH}`,
      PLOT_HOST: 'github',
      PLOT_PR_INDEX_HOME: store,
    },
  }));

  assert.equal(
    byBranch(j)['feature/one'].state, 'MERGED',
    'a bundle that cannot run must fall through to the host, not fail the helper',
  );
  assert.ok(
    stub.calls().length > 0,
    'and the host must genuinely have been asked — a store it could not read answers nothing',
  );
});
