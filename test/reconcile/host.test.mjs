// Contract test for skills/plot/scripts/plot-host.sh — the Git-host adapter.
// Uses PATH-stubbed gh/bb executables: each stub records its argv and emits
// canned JSON, so the tests pin (a) backend resolution and (b) the exact
// argument mapping + output normalization per backend, fully offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');

// `fail` makes a stub exit non-zero with a chosen stderr message — the ONLY
// way to reproduce the case this adapter now has to tell apart, because `gh`
// exits 1 for a lookup miss AND for a transport failure and puts the whole
// difference in its stderr. Measured against a real gh on 2026-08-17.
// `ghFail: ''` is a REAL case, not an absent one — a CLI that fails and says
// nothing — so the switch is `!= null`, never truthiness. Reading '' as "do not
// fail" would silently turn that test into an assertion about success.
function makeStubs({ ghJson = '{}', bbJson = '{}', ghFail = null, bbFail = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-'));
  const stub = (name, json, fail) => {
    const argvFile = path.join(dir, `${name}.argv`);
    const body = fail != null
      ? `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvFile}"\n` +
        (fail === '' ? '' : `printf '%s\\n' '${fail.replace(/'/g, `'\\''`)}' >&2\n`) +
        `exit 1\n`
      : `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvFile}"\n` +
        `printf '%s' '${json.replace(/'/g, `'\\''`)}'\n`;
    writeFileSync(path.join(dir, name), body);
    chmodSync(path.join(dir, name), 0o755);
    return argvFile;
  };
  return { dir, ghArgv: stub('gh', ghJson, ghFail), bbArgv: stub('bb', bbJson, bbFail) };
}

// Like `run`, but for the cases where the adapter is expected to FAIL: returns
// the exit code and both streams instead of throwing, so a test can assert the
// code, the silence on stdout, and the message on stderr as three separate
// facts. The first two are the contract; the third is what makes it useful.
function runAllowFail(args, { env = {}, stubs }) {
  const res = spawnSync('bash', [adapter, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function run(args, { env = {}, stubs }) {
  return execFileSync('bash', [adapter, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, ...env },
  });
}

const argvOf = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : null);

test('host: PLOT_HOST env resolves the backend', () => {
  const stubs = makeStubs();
  assert.equal(run(['backend'], { env: { PLOT_HOST: 'bitbucket' }, stubs }).trim(), 'bitbucket');
  assert.equal(run(['backend'], { env: { PLOT_HOST: 'github' }, stubs }).trim(), 'github');
});

test('host: pr-state github maps gh --json and normalizes', () => {
  const stubs = makeStubs({
    ghJson: '{"number":7,"state":"OPEN","isDraft":true,"url":"https://example.test/pr/7"}',
  });
  const out = JSON.parse(run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.deepEqual(out, { number: 7, state: 'OPEN', draft: true, url: 'https://example.test/pr/7', mergeCommit: '' });
  assert.deepEqual(argvOf(stubs.ghArgv), ['pr', 'view', '7', '--json', 'number,state,isDraft,url,mergeCommit']);
});

// A TRANSPORT FAILURE AND A LOOKUP MISS ARE TWO ANSWERS, AND THEY USED TO BE
// ONE. Both make `gh` exit 1; before this the adapter caught both with a single
// `|| echo '{"state":"NONE"}'` and exited 0. On 2026-08-17 GitHub returned 503
// all afternoon and every branch read as having no PR — wrong in the reassuring
// direction, which is the worst one.
test('host: a transport failure exits non-zero and prints nothing on stdout', () => {
  const stubs = makeStubs({ ghFail: 'error connecting to api.github.com: 503 Service Unavailable' });
  const res = runAllowFail(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.notEqual(res.code, 0, 'a failure the adapter could not classify must not exit 0');
  assert.equal(res.stdout.trim(), '', 'stdout must be empty — a parseable NONE would be a false answer');
  assert.match(res.stderr, /503/, "the host's own words reach the caller");
});

// The PAIRING that matters: a fix that exits non-zero on "no PR found" breaks
// every caller that branches on `state`, and passes the assertion above.
test('host: a lookup miss still exits 0 with state NONE', () => {
  const stubs = makeStubs({ ghFail: 'no pull requests found for branch "feature/nope"' });
  const res = runAllowFail(['pr-state', 'feature/nope'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.code, 0, 'a miss is an ANSWER, not a failure');
  assert.deepEqual(JSON.parse(res.stdout), {
    number: 0, state: 'NONE', draft: false, url: '', mergeCommit: '',
  });
});

// Bitbucket runs the same rule through the same helper — one place decides, so
// the two backends cannot drift into disagreeing about what silence means.
test('host: bitbucket separates the two the same way', () => {
  const miss = makeStubs({ bbFail: 'no pull requests found' });
  const missRes = runAllowFail(['pr-state', '9'], { env: { PLOT_HOST: 'bitbucket' }, stubs: miss });
  assert.equal(missRes.code, 0);
  assert.equal(JSON.parse(missRes.stdout).state, 'NONE');

  const down = makeStubs({ bbFail: 'could not resolve host: api.bitbucket.org' });
  const downRes = runAllowFail(['pr-state', '9'], { env: { PLOT_HOST: 'bitbucket' }, stubs: down });
  assert.notEqual(downRes.code, 0);
  assert.equal(downRes.stdout.trim(), '');
});

// An UNRECOGNISED message reports "cannot ask" rather than "no PR". The rule is
// an allowlist of miss-phrasings, not a blocklist of failures: a blocklist goes
// stale into SILENCE the first time the CLI rewords itself, and silence here is
// indistinguishable from a branch that genuinely has no PR.
test('host: an unrecognised failure is treated as transport, not as a miss', () => {
  const stubs = makeStubs({ ghFail: 'something nobody has seen before' });
  const res = runAllowFail(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.notEqual(res.code, 0, 'unknown failures must fail loudly, never quietly answer NONE');
});

// The THIRD case, and the one that is neither: a failure carrying no diagnostic
// at all. It reads as a miss — a transport failure is loud by nature, while
// silence is what a miss looks like through a CLI that does not explain itself.
// Asserted so the exception cannot be removed as an oversight: doing so would
// give every caller of a quiet or wrapped CLI a permanent "cannot ask".
test('host: a failure with no message at all still reads as a miss', () => {
  const stubs = makeStubs({ ghFail: '' });
  const res = runAllowFail(['pr-state', 'feature/nope'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.code, 0);
  assert.equal(JSON.parse(res.stdout).state, 'NONE');
});

test('host: pr-state bitbucket normalizes DECLINED to CLOSED', () => {
  const stubs = makeStubs({
    bbJson: '{"id":9,"state":"DECLINED","links":{"html":{"href":"https://example.test/pr/9"}}}',
  });
  const out = JSON.parse(run(['pr-state', '9'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.deepEqual(out, { number: 9, state: 'CLOSED', draft: false, url: 'https://example.test/pr/9' });
});

test('host: pr-create github maps flags in order', () => {
  const stubs = makeStubs();
  run(['pr-create', '--title', 'T', '--body', 'B', '--base', 'main', '--draft'],
    { env: { PLOT_HOST: 'github' }, stubs });
  assert.deepEqual(argvOf(stubs.ghArgv),
    ['pr', 'create', '--title', 'T', '--body', 'B', '--base', 'main', '--draft']);
});

test('host: pr-create bitbucket uses bb with same surface', () => {
  const stubs = makeStubs();
  run(['pr-create', '--title', 'T', '--draft'], { env: { PLOT_HOST: 'bitbucket' }, stubs });
  assert.deepEqual(argvOf(stubs.bbArgv), ['pr', 'create', '--title', 'T', '--body', '', '--draft']);
});

test('host: pr-merge github defaults to --merge, maps --squash/--delete-branch', () => {
  const stubs = makeStubs();
  run(['pr-merge', '5', '--squash', '--delete-branch'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.deepEqual(argvOf(stubs.ghArgv), ['pr', 'merge', '5', '--squash', '--delete-branch']);
  const stubs2 = makeStubs();
  run(['pr-merge', '5'], { env: { PLOT_HOST: 'github' }, stubs: stubs2 });
  assert.deepEqual(argvOf(stubs2.ghArgv), ['pr', 'merge', '5', '--merge']);
});

test('host: pr-list bitbucket flattens to number/title/state/head', () => {
  const stubs = makeStubs({
    bbJson: '[{"id":3,"title":"A","state":"OPEN","source":{"branch":{"name":"feature/a"}}}]',
  });
  const out = JSON.parse(run(['pr-list'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.deepEqual(out, { number: 3, title: 'A', state: 'OPEN', head: 'feature/a' });
  assert.deepEqual(argvOf(stubs.bbArgv), ['pr', 'list', '--state', 'open', '--json']);
});

test('host: pr-state lookup miss yields state NONE, exit 0', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-'));
  writeFileSync(path.join(dir, 'gh'), '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(path.join(dir, 'gh'), 0o755);
  const out = JSON.parse(execFileSync('bash', [adapter, 'pr-state', 'feature/nope'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  }));
  assert.equal(out.state, 'NONE');
});

test('host: invalid PLOT_HOST exits nonzero without calling either CLI', () => {
  const stubs = makeStubs();
  assert.throws(() =>
    run(['pr-state', '7'], { env: { PLOT_HOST: 'gitlab' }, stubs }));
  assert.equal(argvOf(stubs.ghArgv), null);
  assert.equal(argvOf(stubs.bbArgv), null);
});

test('host: Git host config key resolves the backend (bb alias too)', () => {
  const stubs = makeStubs();
  // config comes from a CLAUDE.md ## Plot Config in cwd
  const repo = mkdtempSync(path.join(tmpdir(), 'plot-host-cfg-'));
  writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Git host:** bitbucket\n');
  const out = execFileSync('bash', [adapter, 'backend'], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: '' },
  });
  assert.equal(out.trim(), 'bitbucket');
});

test('host: bb pr-state by branch resolves via pr-list filter (hit and miss)', () => {
  const stubs = makeStubs({
    bbJson: '[{"id":4,"state":"OPEN","source":{"branch":{"name":"feature/a"}},"links":{"html":{"href":"https://example.test/pr/4"}}}]',
  });
  const hit = JSON.parse(run(['pr-state', 'feature/a'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.deepEqual(hit, { number: 4, state: 'OPEN', draft: false, url: 'https://example.test/pr/4' });
  assert.deepEqual(argvOf(stubs.bbArgv), ['pr', 'list', '--state', 'all', '--json']);
  const miss = JSON.parse(run(['pr-state', 'feature/nope'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.equal(miss.state, 'NONE');
});

test('host: pr-body github maps to gh pr edit --body', () => {
  const stubs = makeStubs();
  run(['pr-body', '4', '--body', 'new text'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.deepEqual(argvOf(stubs.ghArgv), ['pr', 'edit', '4', '--body', 'new text']);
});

// --- pr-list --rich: check state for the agent view ------------------------
//
// The board needs to tell "a person is the blocker" from "a machine is busy".
// That distinction lives entirely in how the rollup is collapsed, so it is
// pinned here rather than in the board: the adapter is the one place that
// talks to the host (Principle 3), and a board that guessed would be wrong on
// a different host.

const richGh = (rollup, extra = '', merge = '') =>
  `[{"number":7,"title":"T","state":"OPEN","headRefName":"feature/x","isDraft":false,` +
  `"statusCheckRollup":${rollup},"reviewDecision":${extra || '""'},` +
  `${merge || '"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN"'}}]`;

test('host: pr-list --rich reports an EMPTY rollup as none, not green', () => {
  // The case that motivated the field: GitHub starts no workflows for bot PRs
  // until a human approves the run. "none" says a person is the blocker;
  // "green" would claim a passing CI that never ran.
  const stubs = makeStubs({ ghJson: richGh('[]') });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.checks, 'none');
});

test('host: pr-list --rich collapses the rollup to one of four states', () => {
  const cases = [
    ['[{"conclusion":"SUCCESS"}]', 'green'],
    ['[{"conclusion":null,"state":"PENDING"}]', 'pending'],
    ['[{"conclusion":null,"state":"IN_PROGRESS"}]', 'pending'],
    ['[{"conclusion":"FAILURE"}]', 'failing'],
  ];
  for (const [rollup, expected] of cases) {
    const stubs = makeStubs({ ghJson: richGh(rollup) });
    const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
    assert.equal(out.checks, expected, `${rollup} must read as ${expected}`);
  }
});

test('host: one red check among green ones counts red, not pending', () => {
  const stubs = makeStubs({
    ghJson: richGh('[{"conclusion":"SUCCESS"},{"conclusion":"FAILURE"},{"conclusion":null,"state":"PENDING"}]'),
  });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.checks, 'failing',
    'a failure anywhere outranks both green and still-running siblings');
});

test('host: ACTION_REQUIRED is failing, not pending — a human is the blocker', () => {
  // The same situation as an empty rollup seen from the other side: the run
  // exists but waits on a person. Calling it "pending" would file it under
  // "waiting on a machine", where nobody looks.
  const stubs = makeStubs({ ghJson: richGh('[{"conclusion":null,"state":"ACTION_REQUIRED"}]') });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.checks, 'failing');
});

test('host: pr-list --rich carries review state without interpreting it', () => {
  const stubs = makeStubs({ ghJson: richGh('[{"conclusion":"SUCCESS"}]', '"APPROVED"') });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.review, 'APPROVED');
  assert.equal(out.checks, 'green', 'review state must not affect the check verdict');

  // A repo that does not review through the host emits "" — informational, and
  // no consumer may turn it into a gate. Approved is approved either way.
  const none = makeStubs({ ghJson: richGh('[{"conclusion":"SUCCESS"}]', 'null') });
  const out2 = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs: none }));
  assert.equal(out2.review, '');
});

test('host: bitbucket --rich says unknown rather than inventing a verdict', () => {
  // `bb pr list` carries no check rollup. An honest gap beats a guess: the
  // consumer renders "unavailable", never green.
  const stubs = makeStubs({
    bbJson: '[{"id":9,"title":"T","state":"OPEN","source":{"branch":{"name":"feature/y"}}}]',
  });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.equal(out.checks, 'unknown');
  assert.equal(out.head, 'feature/y', 'the plain fields still normalize');
});

// --- pr-list --rich: mergeability, so `conflicts` is not `no checks` --------
//
// The distinction the board could not draw. GitHub starts no workflow for a PR
// that does not merge cleanly, so a conflicting PR reports an EMPTY rollup —
// `checks:"none"`, exactly like a bot PR whose run awaits a human click. One
// wants a rebase, the other a click, and `checks` alone cannot say which.
// Measured live on PR #149 and PR #160.

test('host: pr-list --rich reports CONFLICTING mergeability', () => {
  // The live shape from PR #149 and #160: mergeable=CONFLICTING,
  // mergeStateStatus=DIRTY, and a genuinely EMPTY rollup — GitHub does not
  // start CI for a conflicting PR. `checks` alone reads this as "none".
  const stubs = makeStubs({
    ghJson: richGh('[]', '', '"mergeable":"CONFLICTING","mergeStateStatus":"DIRTY"'),
  });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.mergeable, 'conflicting');
  assert.equal(out.checks, 'none',
    'checks stays honest about the empty rollup — mergeable is the field that says why');
});

test('host: a clean PR reports mergeable, and a conflict is not implied by an empty rollup', () => {
  // The pairing that matters: if every empty rollup reported `conflicting`,
  // the fix would be the same defect mirrored — a workflow awaiting a human
  // click would be sent for a rebase it does not need.
  const stubs = makeStubs({ ghJson: richGh('[]') });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.checks, 'none');
  assert.equal(out.mergeable, 'mergeable',
    'an empty rollup on a cleanly-merging branch is not a conflict');
});

test('host: mergeability GitHub has not computed yet is unknown, not clean', () => {
  // GitHub computes mergeability lazily: a PR opened seconds ago legitimately
  // reports UNKNOWN. Absent is not false — reading it as clean would claim a
  // merge nobody has tested.
  const stubs = makeStubs({
    ghJson: richGh('[{"conclusion":"SUCCESS"}]', '', '"mergeable":"UNKNOWN","mergeStateStatus":"UNKNOWN"'),
  });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.mergeable, 'unknown');
});

test('host: DIRTY corroborates a conflict even where mergeable does not say so', () => {
  // `mergeStateStatus` needs a scope some tokens lack, so it is consulted to
  // CORROBORATE and never to overrule. Where it IS present and says DIRTY, the
  // conflict is real regardless of what the lazier field has computed.
  const stubs = makeStubs({
    ghJson: richGh('[]', '', '"mergeable":"UNKNOWN","mergeStateStatus":"DIRTY"'),
  });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.mergeable, 'conflicting');
});

test('host: bitbucket reports unknown mergeability rather than claiming clean', () => {
  // The precedent two lines away in the adapter: `bb pr list` carries no
  // mergeability verdict, and the honest answer is that it cannot say. A
  // consumer must never render this as clean.
  const stubs = makeStubs({
    bbJson: '[{"id":9,"title":"T","state":"OPEN","source":{"branch":{"name":"feature/y"}}}]',
  });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.equal(out.mergeable, 'unknown');
});

test('host: pr-list without --rich is unchanged', () => {
  // The board is a new consumer; every existing caller must be untouched.
  const stubs = makeStubs({ ghJson: richGh('[{"conclusion":"SUCCESS"}]') });
  const out = JSON.parse(run(['pr-list'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.deepEqual(Object.keys(out).sort(), ['head', 'number', 'state', 'title']);
});

test('host: pr-list --rich names WHICH checks failed', () => {
  // `checks:"failing"` names a symptom and withholds which machine produced it.
  // On 2026-08-17 a markdown-only branch failed `validate` because the
  // Playwright CDN answered 403, and reaching that sentence took ten minutes of
  // opening logs — from a payload that already held the check name.
  //
  // The names come from the SAME response `checks` is computed from: no extra
  // call, no new permission, just a field that was being thrown away.
  const stubs = makeStubs({
    ghJson: JSON.stringify([{
      number: 5, title: 't', state: 'OPEN', headRefName: 'feature/x', isDraft: false,
      statusCheckRollup: [
        { name: 'validate', conclusion: 'FAILURE' },
        { name: 'lint', conclusion: 'SUCCESS' },
      ],
      mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null,
      url: 'https://example.test/pr/5',
    }]),
  });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.checks, 'failing');
  assert.deepEqual(out.failing_checks, ['validate']);
});

test('host: pr-list --rich reports no names when nothing failed', () => {
  // [] here means *nothing failed*, and `checks` says so too. The two fields
  // answer different questions and must be read together — an empty list is
  // never on its own a claim that the branch is green.
  const stubs = makeStubs({
    ghJson: JSON.stringify([{
      number: 6, title: 't', state: 'OPEN', headRefName: 'feature/y', isDraft: false,
      statusCheckRollup: [{ name: 'validate', conclusion: 'SUCCESS' }],
      mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null,
      url: 'https://example.test/pr/6',
    }]),
  });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.checks, 'green');
  assert.deepEqual(out.failing_checks, []);
});

test('host: pr-list --rich on bitbucket reports no names rather than inventing them', () => {
  // Bitbucket carries no check rollup at all, so `checks` is already `unknown`.
  // An honest gap beats an invented answer, and [] must render as *unavailable*
  // rather than as *nothing failed*.
  const stubs = makeStubs({
    bbJson: JSON.stringify([{
      id: 3, title: 't', state: 'OPEN', source: { branch: { name: 'feature/z' } },
      links: { html: { href: 'https://example.test/pr/3' } },
    }]),
  });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.equal(out.checks, 'unknown');
  assert.deepEqual(out.failing_checks, []);
});

test('host: runs reports a branch OWN recent runs, newest first', () => {
  // The third line of the evidence a failing check is reported with. What
  // proved the 2026-08-17 `403` transient was the history — the same branch had
  // been green two minutes earlier — and a real failure presents identically,
  // which is exactly why this reports and never concludes.
  const stubs = makeStubs({
    ghJson: JSON.stringify([
      { workflowName: 'CI', conclusion: 'failure', status: 'completed', startedAt: '2026-08-17T10:19:00Z', url: 'u2' },
      { workflowName: 'CI', conclusion: 'success', status: 'completed', startedAt: '2026-08-17T10:17:00Z', url: 'u1' },
    ]),
  });
  const out = run(['runs', 'feature/x', '--limit', '2'], { env: { PLOT_HOST: 'github' }, stubs })
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out.map((r) => r.conclusion), ['failure', 'success']);
  assert.equal(out[0].startedAt, '2026-08-17T10:19:00Z');
  assert.deepEqual(argvOf(stubs.ghArgv), [
    'run', 'list', '--branch', 'feature/x', '--limit', '2',
    '--json', 'workflowName,conclusion,status,startedAt,url',
  ]);
});

test('host: runs reports an in-flight run by its status, never as a conclusion', () => {
  // A run still going has no conclusion. Reporting "" would read as a verdict
  // nobody reached; the status is what is true about it.
  const stubs = makeStubs({
    ghJson: JSON.stringify([
      { workflowName: 'CI', conclusion: null, status: 'in_progress', startedAt: '2026-08-17T10:20:00Z', url: 'u3' },
    ]),
  });
  const out = JSON.parse(run(['runs', 'feature/x'], { env: { PLOT_HOST: 'github' }, stubs }).trim());
  assert.equal(out.conclusion, 'in_progress');
});

test('host: runs on bitbucket reports nothing rather than something invented', () => {
  // bb has no run listing. Empty renders as *unavailable* — never as *this
  // branch has never failed before*.
  const stubs = makeStubs({ bbJson: '[]' });
  assert.equal(run(['runs', 'feature/x'], { env: { PLOT_HOST: 'bitbucket' }, stubs }).trim(), '');
  assert.equal(argvOf(stubs.bbArgv), null);
});
