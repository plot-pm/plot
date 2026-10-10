// Contract test for `plot-reconcile-scan.sh` reading `PrIndexStore` before it
// asks the host for the merged-PR list.
//
// WHAT THIS PINS. Sections 2, 3, 19, 20 and 21 ask one question of one list:
// *did a PR with this head merge?* The scan fetched that list with one
// `pr-list --state merged` per run. It now asks the PR index first, through
// `board/plot-pr-index-lookup.mjs`, and asks the host only when some branch
// the sections ask about has no MERGED row.
//
// THE ASSERTION THAT MATTERS IS A CALL COUNT. A scan that read the store and
// then asked the host anyway produces the same report, so every store-hit test
// here counts `--state merged` invocations and requires ZERO.
//
// THE OTHER DIRECTION IS PINNED TOO. A store never manufactures an answer: a
// missing row is a reason to ask, an OPEN row loses to the host, and an
// unreadable store gives exactly the report a run with no store gives.
//
// TESTS NEVER TOUCH THE OPERATOR'S OWN STORE. Every case sets
// `PLOT_PR_INDEX_HOME` to a temp dir, except the linked-worktree case, which
// writes into its own sandbox repository's common git dir.
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
 * A `gh` that answers the scan's list calls and records every invocation.
 *
 * `merged` is the host's merged page as `"<number> <head>"` lines. `reachable:
 * false` makes every call fail the way a 503 does, without a network.
 */
const stubGh = ({ merged = [], reachable = true } = {}) => {
  const dir = tmp('scanidx-gh');
  const log = path.join(dir, 'calls.log');
  const page = JSON.stringify(merged.map((l) => {
    const [n, head] = l.split(' ');
    return { number: Number(n), title: head, state: 'MERGED', headRefName: head };
  }));
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
${reachable ? '' : `echo 'HTTP 503: Service Unavailable' >&2; exit 1`}
case "$*" in
  *"--state merged"*) printf '%s' '${page}' ;;
  *"--state open"*)   printf '%s' '[]' ;;
  *"issue list"*)     printf '%s' '[]' ;;
esac
exit 0
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return {
    dir,
    calls: () => (fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l !== '')
      : []),
  };
};

const mergedCalls = (stub) => stub.calls().filter((l) => l.includes('--state merged'));

/** A merged row, with only the fields the store holds. */
const row = (number, head, state = 'MERGED') => ({
  number, head, state, draft: false,
  checks: 'green', review: 'approved', url: `https://example.test/pr/${number}`,
});

/** A store directory holding the github connector's file. */
// `v` DEFAULTS TO THE CURRENT `PR_INDEX_VERSION` and must be bumped with it. A
// store whose version this Plot does not recognise decodes as `null`, which
// means *ask the host* — so a stale default does not fail the decoder, it
// silently turns every store-hit test into a host-fallback test that still
// reports the right answer. The call counts below are the only assertion that
// catches it; they did, on the bump to 3 and again to 4. Written `v = 3` rather than `v: 3`,
// so a grep for the entity's literal form does not find it.
const storeWith = (rows, { complete = true, v = 4, raw = null } = {}) => {
  const dir = tmp('scanidx-store');
  fs.writeFileSync(path.join(dir, 'github.json'), raw !== null ? raw : JSON.stringify({
    v, connector: 'github', watermark: '2026-09-26T12:00:00Z', complete,
    at: new Date().toISOString(), rows,
  }));
  return dir;
};

// ONE FIXTURE, read-only for every test. Two branches are asked about:
//   * `idea/solo` — named by an Approved plan, ref deleted at merge (PR #40);
//   * `feature/landed` — on origin, named by no plan (PR #50).
// The main checkout is the only worktree, and `main` is never asked about.
let repo;
before(() => {
  const t = tmp('scanidx');
  const origin = path.join(t, 'origin.git');
  repo = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', origin);
  git(t, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');
  git(repo, 'remote', 'add', 'store', origin);

  const w = (rel, content) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  w('CLAUDE.md', ['# Fixture', '', '## Plot Config', '',
    '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/',
    '- **Plan directory:** plans/', '- **Active index:** plans/active/',
    '- **Delivered index:** plans/delivered/', ''].join('\n'));
  w('plans/2026-01-10-solo.md', ['# Solo', '', '## Status', '',
    '- **Phase:** Approved', '- **Type:** feature', '', '## Branches', '',
    '- `idea/solo` — plan + impl, one PR', ''].join('\n'));
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  fs.symlinkSync('../2026-01-10-solo.md', path.join(repo, 'plans', 'active', 'solo.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');

  git(repo, 'checkout', '-q', '-b', 'feature/landed');
  w('landed.txt', 'done\n');
  git(repo, 'add', 'landed.txt');
  git(repo, 'commit', '-qm', 'landed');
  git(repo, 'checkout', '-q', 'main');

  git(repo, 'push', '-q', 'store', 'main', 'feature/landed');
  git(repo, 'fetch', '-q', 'store');
  for (const b of ['main', 'feature/landed']) {
    git(repo, 'update-ref', `refs/remotes/origin/${b}`, `refs/remotes/store/${b}`);
  }
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
});

/** Run the scan with a stubbed host and a store home (a fresh empty one by default). */
//
// A PRIVATE TMPDIR AND BUDGET HOME, shared by every run in this file: tests
// here compare two reports byte for byte, and section 25 counts what the temp
// directory holds, which other processes on the machine change between runs.
let scanTmpdir;
const runScan = (stub, { storeHome, cwd = repo, extraEnv = {} } = {}) => {
  scanTmpdir ??= tmp('scanidx-tmpdir');
  const env = {
    ...process.env,
    TMPDIR: scanTmpdir,
    PLOT_BUDGET_HOME: scanTmpdir,
    PATH: `${stub.dir}:${process.env.PATH}`,
    PLOT_PR_INDEX_HOME: storeHome ?? tmp('scanidx-empty'),
    ...extraEnv,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return execFileSync('bash', [scan, '--no-fetch'], { encoding: 'utf8', cwd, env });
};

const lineMatching = (out, re) => out.split('\n').filter((l) => re.test(l));

// THE CASE THE SLICE EXISTS FOR. Both asked branches have a MERGED row, so the
// scan must not ask the host for the merged list at all — and must still find
// both merged PRs.
test('a store answering every asked branch removes the merged-list call', () => {
  const baseline = stubGh({ merged: ['40 idea/solo', '50 feature/landed'] });
  const before = runScan(baseline);
  assert.equal(mergedCalls(baseline).length, 1, 'with no store the host page is asked once');

  const stub = stubGh({ merged: ['40 idea/solo', '50 feature/landed'] });
  const out = runScan(stub, { storeHome: storeWith([row(40, 'idea/solo'), row(50, 'feature/landed')]) });

  assert.deepEqual(mergedCalls(stub), [], 'every asked branch is answered — no merged-list call');
  assert.equal(stub.calls().length, baseline.calls().length - 1,
    `one host call fewer than without a store:\n${stub.calls().join('\n')}`);
  assert.equal(out, before, 'the report is the one the host page produced');
  assert.equal(lineMatching(out, /merged PR head: #40 \(idea\/solo\)/).length, 1);
  assert.equal(lineMatching(out, /origin\/feature\/landed — PR #50 merged/).length, 1);
});

// ABSENCE IS NOT PROOF. `complete: false` and no row for `feature/landed`: the
// host is asked, and its answer for that branch is the one reported.
test('an incomplete store lacking a branch\'s row gives the host\'s answer for it', () => {
  const stub = stubGh({ merged: ['50 feature/landed'] });
  const out = runScan(stub, { storeHome: storeWith([row(40, 'idea/solo')], { complete: false }) });

  assert.equal(mergedCalls(stub).length, 1, 'a branch the store lacks sends the scan to the host');
  assert.equal(lineMatching(out, /origin\/feature\/landed — PR #50 merged/).length, 1);
  // And the store's own MERGED row still counts: the host page here omits #40,
  // as a page cut at MERGED_PR_LIMIT would.
  assert.equal(lineMatching(out, /merged PR head: #40 \(idea\/solo\)/).length, 1,
    'a MERGED row the host page did not reach still testifies');
});

// TRUSTING A NON-TERMINAL ROW IS THE DEFECT. The store says #50 is OPEN; the
// host says it merged. The host decides.
test('an OPEN row for a PR the host reports MERGED gives the host\'s answer', () => {
  const stub = stubGh({ merged: ['40 idea/solo', '50 feature/landed'] });
  const out = runScan(stub, {
    storeHome: storeWith([row(40, 'idea/solo'), row(50, 'feature/landed', 'OPEN')]),
  });

  assert.equal(mergedCalls(stub).length, 1, 'an OPEN row answers nothing');
  assert.equal(lineMatching(out, /origin\/feature\/landed — PR #50 merged/).length, 1);
});

// AN UNREACHABLE HOST WITH NO STORE is today's `failed` state: section 3 is
// suppressed and the merged list is never asked. A store present beside the
// outage changes nothing, because the index is asked only where the host
// merged call would have been made.
test('an unreachable host gives today\'s report, with or without a store', () => {
  const none = stubGh({ reachable: false });
  const out = runScan(none);
  assert.match(out, /^PR state: FAILED — .*HTTP 503/m);
  assert.match(out.trim().split('\n').at(-1), /\bpr_source=failed\b/);
  assert.deepEqual(mergedCalls(none), [], 'a failed open list never reaches the merged list');
  assert.equal(lineMatching(out, /merged PR head:/).length, 0,
    'no merged PR may be reported from a host that did not answer');

  const withStore = stubGh({ reachable: false });
  const out2 = runScan(withStore, { storeHome: storeWith([row(40, 'idea/solo')]) });
  assert.equal(out2, out, 'the store does not turn an outage into answers');
});

// A STORE THAT CANNOT BE READ AS ONE is no store: the report is byte-identical
// to the run with none, and the host is asked exactly as before.
for (const [name, opts] of [
  ['a missing store', null],
  ['an unparseable store', { raw: '{ not json' }],
  ['an empty store file', { raw: '' }],
  ['a wrong-version store', { v: 1 }],
]) {
  test(`${name} gives exactly the report a run with no store gives`, () => {
    const baseline = stubGh({ merged: ['40 idea/solo', '50 feature/landed'] });
    const expected = runScan(baseline);

    const stub = stubGh({ merged: ['40 idea/solo', '50 feature/landed'] });
    const storeHome = opts === null
      ? tmp('scanidx-empty')
      : storeWith([row(40, 'idea/solo'), row(50, 'feature/landed')], opts);
    const out = runScan(stub, { storeHome });

    assert.equal(mergedCalls(stub).length, 1, `${name} must fall through to the host`);
    assert.deepEqual(stub.calls(), baseline.calls(), 'the same host calls as with no store');
    assert.equal(out, expected);
  });
}

// `--offline` asks nothing, the store included: its report is the one it gave
// before the store existed.
test('--offline reads no store and asks no host', () => {
  const stub = stubGh();
  scanTmpdir ??= tmp('scanidx-tmpdir');
  const env = { ...process.env, TMPDIR: scanTmpdir, PLOT_BUDGET_HOME: scanTmpdir, PATH: `${stub.dir}:${process.env.PATH}` };
  const plain = execFileSync('bash', [scan, '--offline'], {
    encoding: 'utf8', cwd: repo, env: { ...env, PLOT_PR_INDEX_HOME: tmp('scanidx-empty') },
  });
  const stored = execFileSync('bash', [scan, '--offline'], {
    encoding: 'utf8', cwd: repo,
    env: { ...env, PLOT_PR_INDEX_HOME: storeWith([row(40, 'idea/solo'), row(50, 'feature/landed')]) },
  });
  assert.deepEqual(stub.calls(), []);
  assert.equal(stored, plain);
});

// THE STORE IS FOUND FROM A LINKED WORKTREE. The bundle resolves
// `--git-common-dir`, never `--show-toplevel`, which would answer the desk —
// and `plot-reap.sh` removes desks. Run from a `git worktree add` desk with
// `PLOT_PR_INDEX_HOME` unset, the store under the common dir must answer.
test('a linked worktree reads the main checkout\'s store', () => {
  const desk = path.join(path.dirname(repo), 'desk');
  git(repo, 'worktree', 'add', '-q', '--detach', desk);
  try {
    const commonDir = git(desk, 'rev-parse', '--git-common-dir').trim();
    const storeHome = path.join(path.resolve(desk, commonDir), '.plot', 'state', 'index');
    fs.mkdirSync(storeHome, { recursive: true });
    fs.writeFileSync(path.join(storeHome, 'github.json'), JSON.stringify({
      v: 4, connector: 'github', watermark: null, complete: true,
      at: new Date().toISOString(), rows: [row(40, 'idea/solo'), row(50, 'feature/landed')],
    }));

    const stub = stubGh({ merged: ['40 idea/solo', '50 feature/landed'] });
    const out = runScan(stub, { cwd: desk, extraEnv: { PLOT_PR_INDEX_HOME: undefined } });

    assert.deepEqual(mergedCalls(stub), [],
      'the desk must resolve the same store as the main checkout — --show-toplevel would not');
    assert.equal(lineMatching(out, /merged PR head: #40 \(idea\/solo\)/).length, 1);
    fs.rmSync(path.join(storeHome, 'github.json'));
  } finally {
    git(repo, 'worktree', 'remove', '--force', desk);
  }
});
