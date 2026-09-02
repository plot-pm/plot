// Contract test for skills/plot/scripts/plot-host.sh — the Git-host adapter.
// Uses PATH-stubbed gh/bb executables: each stub records its argv and emits
// canned JSON, so the tests pin (a) backend resolution and (b) the exact
// argument mapping + output normalization per backend, fully offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
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
//
// The bb stub now also handles the capability check: it responds to `--version`
// with a Quatico-style version (no sha), and accepts `--help --json` without
// error. This is because the adapter now checks bb's --json capability before
// any PR call, and the old stub shape failed that check silently.
function makeStubs({ ghJson = '{}', bbJson = '{}', ghFail = null, bbFail = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-'));
  const ghStub = (json, fail) => {
    const argvFile = path.join(dir, 'gh.argv');
    const body = fail != null
      ? `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvFile}"\n` +
        (fail === '' ? '' : `printf '%s\\n' '${fail.replace(/'/g, `'\\''`)}' >&2\n`) +
        `exit 1\n`
      : `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvFile}"\n` +
        `printf '%s' '${json.replace(/'/g, `'\\''`)}'\n`;
    writeFileSync(path.join(dir, 'gh'), body);
    chmodSync(path.join(dir, 'gh'), 0o755);
    return argvFile;
  };
  const bbStub = (json, fail) => {
    const argvFile = path.join(dir, 'bb.argv');
    // bb stub handles the capability check: --version (Quatico-style) and --help --json
    const body = fail != null
      ? `#!/usr/bin/env bash
if [[ "\$*" == *"--version"* ]]; then echo "bb version 1.9.0"; exit 0; fi
if [[ "\$*" == *"--help"* ]]; then echo "bb pr list help"; exit 0; fi
printf '%s\\n' "$@" > "${argvFile}"
${fail === '' ? '' : `printf '%s\\n' '${fail.replace(/'/g, `'\\''`)}' >&2`}
exit 1
`
      : `#!/usr/bin/env bash
if [[ "\$*" == *"--version"* ]]; then echo "bb version 1.9.0"; exit 0; fi
if [[ "\$*" == *"--help"* ]]; then echo "bb pr list help"; exit 0; fi
printf '%s\\n' "$@" > "${argvFile}"
printf '%s' '${json.replace(/'/g, `'\\''`)}'
`;
    writeFileSync(path.join(dir, 'bb'), body);
    chmodSync(path.join(dir, 'bb'), 0o755);
    return argvFile;
  };
  return { dir, ghArgv: ghStub(ghJson, ghFail), bbArgv: bbStub(bbJson, bbFail) };
}

// A `bb` stub that REFUSES what the real `bb` refuses. The permissive stub above
// swallows any argument, which is how `--state all` stayed pinned as correct in
// this file for months while every real Bitbucket call failed: the test proved
// the adapter SENT the flag, never that `bb` understood it.
//
// Measured against bb 1.0.0 on 2026-08-18:
//   --state accepts open|merged|declined|superseded — no `all`, no `closed`
//   --limit does not exist at all
//
// It appends one line per invocation (`>>`) rather than overwriting, because
// `--state all` is expected to become SEVERAL calls; an overwriting stub would
// show only the last and hide a missing one.
//
// Also handles the capability check (--version, --help --json) like the
// adapter now expects.
function makeStrictBbStub({ json = '[]', perState = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-bb-'));
  const callsFile = path.join(dir, 'bb.calls');
  const cases = perState
    ? Object.entries(perState)
        .map(([s, v]) => `    ${s}) printf '%s' '${v.replace(/'/g, `'\\''`)}' ;;`)
        .join('\n')
    : '';
  const body = `#!/usr/bin/env bash
# Handle capability check
if [[ "$*" == *"--version"* ]]; then echo "bb version 1.9.0"; exit 0; fi
if [[ "$*" == *"--help"* ]]; then echo "bb pr list help"; exit 0; fi
printf '%s\\n' "$*" >> "${callsFile}"
state=open
while [ $# -gt 0 ]; do
  case "$1" in
    --state) state="$2"; shift 2 ;;
    --limit) echo "unknown flag: --limit" >&2; exit 1 ;;
    *) shift ;;
  esac
done
case "$state" in
  open|merged|declined|superseded) ;;
  *) echo "error: invalid --state '\${state}' (must be open, merged, declined, or superseded)" >&2; exit 1 ;;
esac
${cases ? `case "$state" in\n${cases}\n    *) printf '%s' '[]' ;;\nesac` : `printf '%s' '${json.replace(/'/g, `'\\''`)}'`}
`;
  writeFileSync(path.join(dir, 'bb'), body);
  chmodSync(path.join(dir, 'bb'), 0o755);
  return { dir, callsFile };
}

// A `gh` stub that tells the THREE call shapes apart and records every one of
// them. The existing `makeStubs` overwrites a single argv file and answers any
// argv with one canned payload, which cannot express this wave's question:
// the fallback makes up to two gh calls (`api rate_limit`, then either
// `pr view` or `api repos/...`), and the whole contract is about WHICH ones
// happened. An overwriting stub would show only the last and hide the choice.
//
// It appends one line per invocation (`>>`), like `makeStrictBbStub`, so a test
// can assert both what WAS called and what was NOT.
//
// WHO THE RECORD IS KEYED BY, in the tests that seed one.
//
// `budget_account` reads `gh`'s own config file and answers `unknown` where it
// cannot; `PLOT_BUDGET_ACCOUNT` is the override both it and the seeder read, so
// the key is stated once here rather than depending on whatever the machine
// running the suite happens to be logged in as.
const BUDGET_ACCOUNT = 'test-account';

// `graphqlRemaining` defaults to a full budget: a stub that had to be told
// "budget available" for every unrelated test would make the cheap path opt-in,
// which is the inverse of the contract under test.
//
// THE BUDGET IS EXPRESSED AS A RECORD, NOT AS `rate_limit`, AND THAT IS THE
// SLICE. These numbers used to reach the adapter only through the
// `gh api rate_limit` payload the stub emitted — the endpoint measured
// 2026-09-01 reporting 5000/5000 used 0 while the same account's response
// header read `Remaining: 1236, Used: 3764`, and reproduced 2026-09-02 reading
// 5000 against a header's 2732. So a test seeding it was pinning a gate that
// could not fire against a real host.
//
// It now writes the budget record every spender appends to — one line per
// bucket, `actual`, timestamped now — and points `PLOT_BUDGET_HOME` at it. The
// stub still answers `rate_limit`, because the `rate-limit` OP still reports
// it; nothing routes on it any more.
function makeStubsRateAware({
  graphqlRemaining = 5000,
  coreRemaining = 5000,
  graphqlJson = '{}',
  restJson = '{}',
  rateFail = null,
  restFail = null,
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-rate-'));
  const callsFile = path.join(dir, 'gh.calls');
  // The record lives beside the stubs and is passed through `PLOT_BUDGET_HOME`,
  // the one override both the shell appender and `budget-file.ts` read.
  const budgetHome = path.join(dir, 'budget-home');
  mkdirSync(budgetHome, { recursive: true });
  // `rateFail` means the budget CANNOT BE READ, and an unreadable budget is an
  // empty record rather than a record of zeroes — the two answer `unknown` and
  // `spent`, and #485's rule is that only the second may take the fallback.
  if (rateFail == null) {
    const at = Date.now();
    writeFileSync(
      path.join(budgetHome, 'budget.tsv'),
      [
        `b1\tgithub\t${BUDGET_ACCOUNT}\tcore\t${at - 1000}\t1\t5000\t${coreRemaining}\t-\tactual`,
        `b1\tgithub\t${BUDGET_ACCOUNT}\tgraphql\t${at}\t1\t5000\t${graphqlRemaining}\t-\tactual`,
        '',
      ].join('\n'),
    );
  }
  const q = (v) => String(v).replace(/'/g, `'\\''`);
  const rateBody = rateFail != null
    ? `printf '%s\\n' '${q(rateFail)}' >&2; exit 1`
    : `printf '%s' '${q(JSON.stringify({
        resources: {
          graphql: { remaining: graphqlRemaining, limit: 5000, reset: 1787858250 },
          core: { remaining: coreRemaining, limit: 5000, reset: 1787858165 },
        },
      }))}'`;
  const restBody = restFail != null
    ? `printf '%s\\n' '${q(restFail)}' >&2; exit 1`
    : `printf '%s' '${q(restJson)}'`;
  const body = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${callsFile}"
case "$1 $2" in
  "api rate_limit") ${rateBody} ;;
  "api graphql") ${rateBody} ;;
  *)
    case "$1" in
      api) ${restBody} ;;
      pr) printf '%s' '${q(graphqlJson)}' ;;
      repo) printf '%s' '{"defaultBranchRef":{"name":"main"},"nameWithOwner":"owner/repo"}' ;;
      *) printf '%s' '{}' ;;
    esac ;;
esac
`;
  writeFileSync(path.join(dir, 'gh'), body);
  chmodSync(path.join(dir, 'gh'), 0o755);
  return { dir, callsFile, budgetHome };
}

const callsOf = (file) =>
  existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];

// Like `run`, but for the cases where the adapter is expected to FAIL: returns
// the exit code and both streams instead of throwing, so a test can assert the
// code, the silence on stdout, and the message on stderr as three separate
// facts. The first two are the contract; the third is what makes it useful.
// THE RECORD IS NEVER THE OPERATOR'S. Every run is pointed at a budget home
// inside the stub's own directory — its seeded one where it has one, an empty
// one otherwise — so a suite run on a real machine neither reads that machine's
// spend nor appends a hundred lines of test traffic to it.
//
// `PLOT_BUDGET_ACCOUNT` is stated for the same reason: without it the key would
// be whatever `gh` config the machine holds, and a seeded record would be
// keyed to an account the adapter then does not ask about.
const budgetEnvFor = (stubs) => ({
  PLOT_BUDGET_HOME: stubs.budgetHome ?? path.join(stubs.dir, 'budget-home'),
  PLOT_BUDGET_ACCOUNT: BUDGET_ACCOUNT,
});

function runAllowFail(args, { env = {}, stubs }) {
  const res = spawnSync('bash', [adapter, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubs.dir}:${process.env.PATH}`,
      ...budgetEnvFor(stubs),
      ...env,
    },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function run(args, { env = {}, stubs }) {
  return execFileSync('bash', [adapter, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubs.dir}:${process.env.PATH}`,
      ...budgetEnvFor(stubs),
      ...env,
    },
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
  // NOT `--state all`: bb has no such state. See the strict-stub tests below.
  assert.ok(
    argvOf(stubs.bbArgv).every((a) => a !== 'all'),
    'pr-state must not send GitHub\'s `all` to bb',
  );
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

test('host: a RUNNING check reports pending, not green', () => {
  // The defect this replaces, and it pointed the reassuring way: GitHub sends
  // `conclusion: ""` for a check still running — an EMPTY STRING, not null —
  // and the reader was `(.conclusion // .state)`. jq's `//` substitutes only
  // null and false, so `$c` stayed `""`, matched none of the three tests, and
  // fell through to `green`.
  //
  // A running CI therefore read as a passed CI, permanently: measured on the
  // release PR while its `validate` job was in progress. WAITING ON A MACHINE
  // was empty for the same reason, every time it was looked at.
  //
  // The field is `status` besides — `state` never existed on a rollup entry, so
  // the fallback pointed nowhere even when it fired.
  const running = '[{"name":"validate","conclusion":"","status":"IN_PROGRESS"}]';
  const stubs = makeStubs({ ghJson: richGh(running) });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.checks, 'pending');
});

test('host: an empty conclusion on a CONCLUDED check still reads its status', () => {
  // The pairing: a fix that simply preferred `.status` would report every
  // finished check by the word GitHub uses for its lifecycle (`COMPLETED`)
  // rather than by its outcome, turning failures green. The conclusion wins
  // wherever it says anything.
  const failed = '[{"name":"validate","conclusion":"FAILURE","status":"COMPLETED"}]';
  const stubs = makeStubs({ ghJson: richGh(failed) });
  const out = JSON.parse(run(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.checks, 'failing');
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

// --- bb --state vocabulary -------------------------------------------------
//
// bb speaks a different --state vocabulary than gh, and the adapter used to
// translate only in the READING direction (DECLINED→CLOSED on the way out)
// while sending the caller's GitHub word unchanged on the way in. These run
// against makeStrictBbStub, which refuses what bb 1.0.0 refuses.

test('host: pr-list --state all issues one bb call per real state', () => {
  const bb = makeStrictBbStub({
    perState: {
      open: '[{"id":1,"title":"O","state":"OPEN","source":{"branch":{"name":"feature/o"}}}]',
      merged: '[{"id":2,"title":"M","state":"MERGED","source":{"branch":{"name":"feature/m"}}}]',
      declined: '[{"id":3,"title":"D","state":"DECLINED","source":{"branch":{"name":"feature/d"}}}]',
    },
  });
  const out = execFileSync('bash', [adapter, 'pr-list', '--state', 'all'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  const rows = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

  // All three states arrive — the defect returned only the last one.
  assert.deepEqual(rows.map((r) => r.state).sort(), ['CLOSED', 'MERGED', 'OPEN']);
  assert.deepEqual(rows.map((r) => r.number).sort(), [1, 2, 3]);

  const calls = callsOf(bb.callsFile);
  assert.equal(calls.length, 3, 'one call per state, not one call with three flags');
  assert.ok(calls.some((c) => c.includes('--state open')));
  assert.ok(calls.some((c) => c.includes('--state merged')));
  assert.ok(calls.some((c) => c.includes('--state declined')));
  assert.ok(!calls.some((c) => c.includes('--state all')), 'bb has no `all` state');
});

test('host: pr-list --state closed sends bb its own word, declined', () => {
  const bb = makeStrictBbStub({ json: '[]' });
  execFileSync('bash', [adapter, 'pr-list', '--state', 'closed'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  const calls = callsOf(bb.callsFile);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('--state declined'));
  assert.ok(!calls[0].includes('closed'));
});

// The board calls with --limit 300. bb has no --limit and errors on it, so the
// adapter must not forward it — and must say the cap cannot be honoured rather
// than serving a short page as if it were the whole set.
test('host: --limit never reaches bb, and the shortfall is reported', () => {
  const bb = makeStrictBbStub({ json: '[]' });
  const res = spawnSync('bash', [adapter, 'pr-list', '--rich', '--state', 'all', '--limit', '300'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!callsOf(bb.callsFile).some((c) => c.includes('--limit')));
  assert.match(res.stderr, /limit/i);
});

// An unknown state is a caller bug. Returning an empty list would read as
// "no PRs matched", which is the quiet wrong answer this adapter avoids.
test('host: an unknown --state fails loudly instead of returning nothing', () => {
  const bb = makeStrictBbStub({ json: '[]' });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'bogus'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.notEqual(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('host: pr-state by branch resolves without bb rejecting the call', () => {
  const bb = makeStrictBbStub({
    perState: {
      open: '[{"id":4,"state":"OPEN","source":{"branch":{"name":"feature/a"}},"links":{"html":{"href":"https://example.test/pr/4"}}}]',
    },
  });
  const out = JSON.parse(execFileSync('bash', [adapter, 'pr-state', 'feature/a'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  }));
  assert.equal(out.number, 4);
  assert.equal(out.state, 'OPEN');
});

// --- pr-state stops asking once it has an answer ---------------------------
//
// Resolving one branch to one PR walked all three states unconditionally, so
// every lookup cost three network round trips whether or not the first one
// answered. Measured against a real Bitbucket on 2026-08-18: ~10s per `bb`
// call, so 25.7s per pr-state — and the board's fleet scan, which calls it
// once per branch, exceeded its own timeout on a five-branch plan.
//
// The states are walked open → merged → declined and the filter takes the
// FIRST match, so a later state can never overturn an earlier one. Stopping
// at the first hit is therefore free: same answer, fewer calls.

test('host: pr-state stops at the first state that answers', () => {
  const bb = makeStrictBbStub({
    perState: {
      open: '[{"id":4,"state":"OPEN","source":{"branch":{"name":"feature/a"}},"links":{"html":{"href":"https://example.test/pr/4"}}}]',
      merged: '[{"id":9,"state":"MERGED","source":{"branch":{"name":"feature/a"}},"links":{"html":{"href":"https://example.test/pr/9"}}}]',
    },
  });
  const out = JSON.parse(execFileSync('bash', [adapter, 'pr-state', 'feature/a'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  }));
  // The open PR wins, as it did before — this is a cost fix, not a behaviour one.
  assert.equal(out.number, 4);
  assert.equal(out.state, 'OPEN');
  assert.equal(callsOf(bb.callsFile).length, 1, 'must not ask merged/declined once open answered');
});

// The saving must not cost coverage: a branch whose only PR was declined is
// still found, it just pays for all three calls.
test('host: pr-state still reaches a declined PR, at full cost', () => {
  const bb = makeStrictBbStub({
    perState: {
      declined: '[{"id":7,"state":"DECLINED","source":{"branch":{"name":"feature/d"}},"links":{"html":{"href":"https://example.test/pr/7"}}}]',
    },
  });
  const out = JSON.parse(execFileSync('bash', [adapter, 'pr-state', 'feature/d'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  }));
  assert.equal(out.number, 7);
  assert.equal(out.state, 'CLOSED');
  assert.equal(callsOf(bb.callsFile).length, 3);
});

// A branch with no PR at all is the other full-cost case, and it must still
// report NONE rather than treating the empty first page as a transport failure.
test('host: pr-state reports NONE after exhausting every state', () => {
  const bb = makeStrictBbStub({ json: '[]' });
  const out = JSON.parse(execFileSync('bash', [adapter, 'pr-state', 'feature/nope'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  }));
  assert.equal(out.state, 'NONE');
  assert.equal(callsOf(bb.callsFile).length, 3);
});

// --- issue-view: one issue, with its body, and never a write ---------------
//
// The op the board's *Create plan* action reads. `issue-list` runs on a timer
// for every open issue and deliberately omits bodies; this asks for the one
// issue somebody just pointed at, so its cadence is a human's.
//
// The exit codes are deliberately the SAME ONES `issue-list` uses — 4 for a
// host that cannot be asked, non-zero for a lookup that failed — because a
// consumer already maps those and must not need a second table.

test('host: issue-view returns one issue object, body included', () => {
  const gh = makeStubs({
    ghJson: '{"number":228,"title":"The scan asks once per branch","body":"Measured: 18.3s.","url":"https://example.test/issues/228"}',
  });
  const out = JSON.parse(execFileSync('bash', [adapter, 'issue-view', '228'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${gh.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  }));
  assert.equal(out.number, 228);
  assert.equal(out.title, 'The scan asks once per branch');
  // THE BODY IS THE POINT — it is the problem statement /plot-idea receives.
  assert.equal(out.body, 'Measured: 18.3s.');
  assert.equal(out.url, 'https://example.test/issues/228');

  const argv = readFileSync(gh.ghArgv, 'utf8').trim().split('\n');
  assert.deepEqual(argv.slice(0, 3), ['issue', 'view', '228']);
  // READ-ONLY, asserted rather than assumed: no subcommand here may write to
  // the tracker. Plot reads the tracker and never writes to it, and a plan
  // referencing an issue is Plot's record rather than the tracker's.
  for (const write of ['comment', 'edit', 'close', 'reopen', 'label', 'lock']) {
    assert.ok(!argv.includes(write), `issue-view must not ${write}`);
  }
});

test('host: issue-view fills absent fields rather than emitting null', () => {
  // An issue with no body is a real case — a title-only issue — and it must
  // arrive as "" so a consumer renders nothing rather than the word "null".
  const gh = makeStubs({ ghJson: '{"number":9,"title":"Terse","body":null,"url":null}' });
  const out = JSON.parse(execFileSync('bash', [adapter, 'issue-view', '9'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${gh.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  }));
  assert.equal(out.body, '');
  assert.equal(out.url, '');
});

// NOTE: the old test here asserted `issue-view exits 4 on bitbucket — bb has no
// issue read`. That refusal was true when written and stopped being true after
// bb gained issue commands, so bitbucket now ANSWERS. The bitbucket issue tests
// live below, against a stub bb that emits captured 0.6.0 output.

test('host: issue-view exits non-zero with empty stdout when the lookup fails', () => {
  // AN OUTAGE IS NOT AN ANSWER. A failed read must not arrive as an issue with
  // an empty body — that would have the board plan against nothing.
  const gh = makeStubs({ ghFail: 'HTTP 503: Service Unavailable' });
  const res = spawnSync('bash', [adapter, 'issue-view', '228'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${gh.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.notEqual(res.status, 0);
  assert.notEqual(res.status, 4, '503 is an outage, not a host that cannot be asked');
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /503/);
});

test('host: issue-view treats a missing issue as a failure, not an empty body', () => {
  // Deliberately NOT the miss/fail split `pr-state` makes. An issue number
  // reaching this op was read off `issue-list` moments earlier, so "it does not
  // exist" means the tracker moved — a fact worth surfacing rather than a blank
  // to plan on.
  const gh = makeStubs({ ghFail: 'could not find issue #999' });
  const res = spawnSync('bash', [adapter, 'issue-view', '999'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${gh.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.notEqual(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

// --- bitbucket issue-list / issue-view: parse bb's text, pinned to 0.6.0 ----
//
// bb gained `issue list` and `issue view`, so the adapter that refused them for
// a year now ANSWERS by parsing their output — bb has no --json for issues.
// Every fixture below is the MEASURED bb 0.6.0 shape (read from craftamap/bb at
// the 0.6.0 tag on 2026-08-26): the list row is `#%03d <STATE>  <title>   by
// <reporter>` with ANSI colour on the id/state/reporter, the header is ` ::
// Showing N of M issues in ORG/SLUG`, and bb writes its ERRORS to STDOUT,
// colour-coded, exiting 1 for everything.
//
// A stub bb that emits chosen text with a chosen exit code and answers
// `--version`. The parse is exercised against fixture text, never a live call —
// this repo is on GitHub and bb refuses it outright.
function makeBbIssueStub({ out = '', code = 0, version = 'bb version 0.6.0 (deadbeef)' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-bbissue-'));
  const body = `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then printf '%s\\n' '${version.replace(/'/g, `'\\''`)}'; exit 0; fi
# issue list / issue view both print the fixture on STDOUT (where bb puts both
# its data AND its errors) and exit with the chosen code.
printf '%b' '${out.replace(/'/g, `'\\''`)}'
exit ${code}
`;
  writeFileSync(path.join(dir, 'bb'), body);
  chmodSync(path.join(dir, 'bb'), 0o755);
  return { dir };
}

// The measured 0.6.0 list, ANSI and all. Note issue #17's title contains the
// word "by" — the reporter is split on the THREE-space separator, so a naive
// `s/ by .*//` would truncate it and this fixture is what catches that.
const BB_LIST_ANSI =
  '\\033[34m :: \\033[0mShowing 2 of 2 issues in acme/widget\\n' +
  '#\\033[32m003\\033[0m \\033[48;5;12m OPEN \\033[0m    Fix the login redirect loop   \\033[38;5;242mby Alice\\033[0m\\n' +
  '#\\033[32m017\\033[0m \\033[48;5;55m NEW \\033[0m     Add dark mode by default   \\033[38;5;242mby Bob\\033[0m\\n';

const BB_VIEW_ANSI =
  '\\033[1mFix the login redirect loop\\033[0m\\n' +
  '\\033[48;5;12m OPEN \\033[0m • \\033[38;5;242mAlice opened 2026-08-01T10:00:00+00:00\\033[0m\\n' +
  'Type: bug • Priority: major • Assignee: Alice\\n' +
  'The redirect after login loops forever.\\n\\nSteps: log in, watch the URL bounce.\\n' +
  '\\033[38;5;242mView this issue on Bitbucket.org: https://bitbucket.org/acme/widget/issues/3\\033[0m\\n';

// bb's error shape: `An error occurred: <message>` on STDOUT, ANSI-coded, exit 1.
const bbError = (msg) =>
  `\\033[31m:: \\033[0m\\033[1mAn error occurred: \\033[0m${msg}\\n`;

function runBb(args, stub, extraEnv = {}) {
  return spawnSync('bash', [adapter, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket', ...extraEnv },
  });
}

test('host: issue-list bitbucket emits the {number,title,url,createdAt} contract', () => {
  const stub = makeBbIssueStub({ out: BB_LIST_ANSI });
  const res = runBb(['issue-list'], stub);
  assert.equal(res.status, 0, res.stderr);
  const rows = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows, [
    { number: 3, title: 'Fix the login redirect loop', url: '', createdAt: '' },
    // The title with "by" in it survives whole — split on three spaces, not " by ".
    { number: 17, title: 'Add dark mode by default', url: '', createdAt: '' },
  ]);
  // url and createdAt are "" on bitbucket: bb issue list prints neither.
});

test('host: issue-list bitbucket never parses an ANSI error as an issue', () => {
  // Done-when 6. bb writes errors to STDOUT; a stdout-is-data implementation
  // would emit `An error occurred: …` as a title. The wording here is
  // unrecognised, so it must be a failure — exit 3, empty stdout.
  const stub = makeBbIssueStub({ out: bbError('429 Rate limit for this resource has been exceeded'), code: 1 });
  const res = runBb(['issue-list'], stub);
  assert.notEqual(res.status, 0);
  assert.equal(res.stdout.trim(), '', 'an error message must never reach stdout as an issue');
  assert.doesNotMatch(res.stdout, /An error occurred/);
});

test('host: issue-list --limit N truncates after parsing (bb has no --limit)', () => {
  // Done-when 7. bb issue list has no --limit, so the adapter honours the
  // caller's bound itself, after parsing.
  const stub = makeBbIssueStub({ out: BB_LIST_ANSI });
  const res = runBb(['issue-list', '--limit', '1'], stub);
  assert.equal(res.status, 0, res.stderr);
  const rows = res.stdout.trim().split('\n').filter(Boolean);
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0]).number, 3);
});

test('host: issue-list bitbucket exits 4 when the tracker is DISABLED', () => {
  // Done-when 3. Bitbucket answers 404 for a repo whose issue tracker is off;
  // that is *cannot be asked*, not an empty list.
  const stub = makeBbIssueStub({ out: bbError('404 Not Found'), code: 1 });
  const res = runBb(['issue-list'], stub);
  assert.equal(res.status, 4);
  assert.equal(res.stdout.trim(), '');
});

test('host: issue-list bitbucket exits 4 for "Are you sure this is a bitbucket repo?"', () => {
  // The measured wording for a repo bb cannot resolve at all — also *cannot be
  // asked*, so 4 rather than a confident empty list.
  const stub = makeBbIssueStub({ out: bbError('Are you sure this is a bitbucket repo?'), code: 1 });
  const res = runBb(['issue-list'], stub);
  assert.equal(res.status, 4);
});

test('host: issue-list bitbucket defaults an UNRECOGNISED error to 3, never 4', () => {
  // Done-when 5 — the assertion a naive implementation fails. Mapping any
  // failure to 4 turns a broken call into "no tickets"; the safe default is 3.
  const stub = makeBbIssueStub({ out: bbError('the server did something entirely new'), code: 1 });
  const res = runBb(['issue-list'], stub);
  assert.equal(res.status, 3, 'an unrecognised error is a failed call, not "no tickets"');
  assert.notEqual(res.status, 4);
});

test('host: issue-list bitbucket reports an enabled-but-empty tracker as answered', () => {
  // The third distinct outcome: the tracker answered and there are none. Exit 0,
  // empty stdout — NOT exit 4 (cannot ask) and NOT exit 3 (failed).
  const stub = makeBbIssueStub({
    out: '\\033[34m :: \\033[0mShowing 0 of 0 issues in acme/widget\\n',
  });
  const res = runBb(['issue-list'], stub);
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('host: issue-list bitbucket pins bb 0.6.0 and fails loudly on a version it has not seen', () => {
  // Done-when 2. The parse is declared against 0.6.0; a version it was not
  // tested on fails rather than mis-reading a column that may have moved.
  const stub = makeBbIssueStub({ out: BB_LIST_ANSI, version: 'bb version 0.7.0 (feed)' });
  const res = runBb(['issue-list'], stub);
  assert.notEqual(res.status, 0);
  assert.equal(res.status, 3);
  assert.match(res.stderr, /0\.6\.0/);
  assert.equal(res.stdout.trim(), '', 'no rows parsed against an untested format');
});

test('host: issue-view bitbucket returns {number,title,body,url} from bb view text', () => {
  const stub = makeBbIssueStub({ out: BB_VIEW_ANSI });
  const res = runBb(['issue-view', '3'], stub);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.number, 3);
  assert.equal(out.title, 'Fix the login redirect loop');
  // THE BODY IS THE POINT — the problem statement /plot-idea receives. The two
  // metadata head lines and the footer are stripped; the body between survives.
  assert.equal(out.body, 'The redirect after login loops forever.\n\nSteps: log in, watch the URL bounce.');
  // url comes from the view's footer — bb prints one there even though the list
  // does not.
  assert.equal(out.url, 'https://bitbucket.org/acme/widget/issues/3');
});

test('host: issue-view bitbucket exits 4 when the tracker is disabled', () => {
  const stub = makeBbIssueStub({ out: bbError('404 Not Found'), code: 1 });
  const res = runBb(['issue-view', '5'], stub);
  assert.equal(res.status, 4);
  assert.equal(res.stdout.trim(), '');
});

test('host: issue-view bitbucket defaults an unrecognised error to 3', () => {
  const stub = makeBbIssueStub({ out: bbError('a novel failure'), code: 1 });
  const res = runBb(['issue-view', '5'], stub);
  assert.equal(res.status, 3);
});

test('host: bitbucket issue ops never write to the tracker', () => {
  // READ-ONLY, asserted: bb also exposes create/update/delete/comment, and Plot
  // deliberately uses none of them — a plan referencing an issue is Plot's
  // record, not the tracker's. The stub records its argv so the assertion is on
  // what was actually invoked.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-bbwrite-'));
  const argvFile = path.join(dir, 'bb.argv');
  writeFileSync(path.join(dir, 'bb'), `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then printf 'bb version 0.6.0\\n'; exit 0; fi
printf '%s\\n' "$@" >> "${argvFile}"
printf '%b' '${BB_LIST_ANSI.replace(/'/g, `'\\''`)}'
`);
  chmodSync(path.join(dir, 'bb'), 0o755);
  spawnSync('bash', [adapter, 'issue-list'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  spawnSync('bash', [adapter, 'issue-view', '3'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  const argv = existsSync(argvFile) ? readFileSync(argvFile, 'utf8') : '';
  for (const write of ['create', 'update', 'delete', 'comment', 'edit']) {
    assert.ok(!argv.split('\n').includes(write), `issue ops must not ${write}`);
  }
});

// --- pr-list --rich: the Jenkins arm (CI: jenkins) -------------------------
//
// `checks` on a Jenkins repo is a fact the git host cannot supply: `gh`/`bb`
// carry a GitHub/Bitbucket check rollup, and a team that runs CI on Jenkins has
// none. So when `CI: jenkins` is declared, the adapter joins a multibranch
// job's per-branch build colour onto the host's PR rows, keyed on branch name.
//
// The spike (2026-08-26, jen 0.2.0) settled the shape: ONE `job list --json`
// call returns every branch as `{_class,name,color}`, names arrive
// percent-encoded, and the colour vocabulary is blue|red|yellow|disabled plus
// a documented `*_anime` suffix while a build runs.
//
// `CI` and `Git host` are INDEPENDENT keys, so the arm runs over whichever
// backend produced the rows. These tests pass the job payload through a stubbed
// `jen`; the stub answers `job list` regardless of the path and the tests assert
// the join, the `-I` slug, and the single call.
//
// THE MULTIBRANCH JOB PATH is the one Jenkins coordinate the plan did not carry:
// the plan said "the job path derives from the branch name", but a multibranch
// job's CONTAINER path (`webbloqs/continuous-build-multi`) cannot derive from a
// branch name like `bugfix/foo` — the branch is a CHILD of that container. The
// brief forbids a new `Jenkins job path` config KEY, so the container is read
// off the `Jenkins instance` value: `<slug>/<job/path>`, split on the first `/`
// (`-I <slug>`, `job list <job/path>`). A bare-host instance lists at root. This
// is the open point resolved without a new key — see the PR.
function makeJenkinsRepo({ instance = 'ci.test/webbloqs/continuous-build-multi', gitHost = 'github' } = {}) {
  const repo = mkdtempSync(path.join(tmpdir(), 'plot-host-jen-'));
  writeFileSync(path.join(repo, 'CLAUDE.md'),
    `## Plot Config\n\n- **Git host:** ${gitHost}\n- **CI:** jenkins\n- **Jenkins instance:** ${instance}\n`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

// A `jen` stub: records argv (one line per invocation), emits the job-list
// fixture for `job list`, and reproduces the auth-status behaviour for `auth
// status` — including that jen exits 0 while printing NOT reachable, the trap
// Done-when 4 exists for. `authReachable:false` prints the failure wording and
// STILL exits 0.
function makeJenStub({ jobsJson = '[]', authReachable = true, jobListExit = 0 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-jenbin-'));
  const callsFile = path.join(dir, 'jen.calls');
  const authLine = authReachable
    ? 'Jenkins auth:  OK — someone@example.test'
    : 'Jenkins auth:  NOT reachable';
  const body = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${callsFile}"
# jen [-I slug] [--json] <group> <sub> [path] — consume -I's VALUE too, or the
# slug is mistaken for the group.
group=""
while [ $# -gt 0 ]; do
  case "$1" in
    -I) shift 2 ;;
    --json) shift ;;
    *) group="$1"; break ;;
  esac
done
if [ "$group" = auth ]; then
  printf '%s\\n' 'Keycloak:      signed in'
  printf '%s\\n' '${authLine}'
  exit 0
fi
if [ "$group" = job ]; then
  printf '%s' '${jobsJson.replace(/'/g, `'\\''`)}'
  exit ${jobListExit}
fi
exit 0
`;
  writeFileSync(path.join(dir, 'jen'), body);
  chmodSync(path.join(dir, 'jen'), 0o755);
  return { dir, callsFile };
}

// gh/bb stubs live in a SEPARATE dir from the jen stub; a run needs both on
// PATH. This merges two stub dirs into one PATH prefix.
function runJenkins(args, { repo, hostStubs, jen, extraEnv = {} }) {
  return execFileSync('bash', [adapter, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${jen.dir}:${hostStubs.dir}:${process.env.PATH}`,
      PLOT_HOST: '',
      ...extraEnv,
    },
  });
}

function runJenkinsAllowFail(args, { repo, hostStubs, jen, extraEnv = {} }) {
  const res = spawnSync('bash', [adapter, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${jen.dir}:${hostStubs.dir}:${process.env.PATH}`,
      PLOT_HOST: '',
      ...extraEnv,
    },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

// The measured colour vocabulary, one branch per colour. Slashes arrive
// percent-encoded — every name containing one did, 27 of 45 in the spike.
const JEN_JOBS = JSON.stringify([
  { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'feature%2Fgreen', color: 'blue' },
  { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'feature%2Fred', color: 'red' },
  { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'feature%2Funstable', color: 'yellow' },
  { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'feature%2Fdisabled', color: 'disabled' },
  { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'feature%2Frunning', color: 'blue_anime' },
]);

// gh rows for every join case, so one job-list fixture drives many assertions.
const ghRowsFor = (heads) =>
  JSON.stringify(heads.map((h, i) => ({
    number: 100 + i, title: h, state: 'OPEN', headRefName: h, isDraft: false,
    statusCheckRollup: [], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    reviewDecision: null, url: `https://example.test/pr/${100 + i}`,
  })));

const rowsByHead = (out) => {
  const m = new Map();
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    m.set(r.head, r);
  }
  return m;
};

test('host: Jenkins blue reports green (success), red reports failing and names the job', () => {
  // Done-when 1: pass/fail come from Jenkins, and a failure names the job in
  // failing_checks — the same detail the GitHub arm keeps. `blue` is `green`,
  // the adapter's (and the board's) success word — the plan's prose said
  // "passing", but the board's checkWord() renders any word but its four as
  // `unknown`, so the STATE is what the plan settles, not the label.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/green', 'feature/red']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const rows = rowsByHead(runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen }));

  assert.equal(rows.get('feature/green').checks, 'green');
  assert.deepEqual(rows.get('feature/green').failing_checks, []);
  assert.equal(rows.get('feature/red').checks, 'failing');
  assert.deepEqual(rows.get('feature/red').failing_checks,
    ['webbloqs/continuous-build-multi/feature/red'],
    'a failing Jenkins branch names its FULLY-QUALIFIED job, so a reader knows which build to open');
});

test('host: Jenkins yellow (UNSTABLE) reports failing, not passing', () => {
  // Done-when 7. Jenkins frames UNSTABLE as *not red*; mapping it to passing
  // would read green on a board used to decide readiness for a branch whose
  // tests failed. It is failing, deliberately.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/unstable']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const rows = rowsByHead(runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen }));
  assert.equal(rows.get('feature/unstable').checks, 'failing');
  assert.deepEqual(rows.get('feature/unstable').failing_checks,
    ['webbloqs/continuous-build-multi/feature/unstable']);
});

test('host: a running Jenkins build (*_anime) reports pending', () => {
  // Done-when 8. The `_anime` suffix is Jenkins' documented convention for a
  // build in progress. A running build is neither pass nor fail yet — pending,
  // exactly as the GitHub arm reports an in-progress check.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/running']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const rows = rowsByHead(runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen }));
  assert.equal(rows.get('feature/running').checks, 'pending');
  assert.deepEqual(rows.get('feature/running').failing_checks, [],
    'a running build has not failed — no job name to report yet');
});

test('host: a disabled Jenkins job reports none, not failing', () => {
  // Done-when 2: absent is not failed. `disabled` (and an absent job) mean no
  // build to report — `none`, the same honest gap the GitHub arm keeps for an
  // empty rollup, never `failing`.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/disabled']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const rows = rowsByHead(runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen }));
  assert.equal(rows.get('feature/disabled').checks, 'none');
});

test('host: a branch with no Jenkins job at all reports none', () => {
  // Done-when 2, the other half: a PR whose branch has no job in the multibranch
  // listing is `none` — no build exists, not a failed one.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/never-built']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const rows = rowsByHead(runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen }));
  assert.equal(rows.get('feature/never-built').checks, 'none');
  assert.deepEqual(rows.get('feature/never-built').failing_checks, []);
});

test('host: a slashed branch name joins after decoding the percent-encoding', () => {
  // Done-when 6, the 60% miss. Jenkins returns `feature%2Fred`; Plot's head is
  // `feature/red`. An equality join without decoding misses every slashed branch
  // AS none — indistinguishable from having no build. This is the whole point of
  // the arm being tested on encoded names.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/red']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const rows = rowsByHead(runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen }));
  assert.equal(rows.get('feature/red').checks, 'failing',
    'the slashed branch must join its red build, not fall through to none');
});

test('host: one job-list call serves every branch — no per-branch call', () => {
  // Done-when 5, free by the spike: a multibranch job returns every branch in
  // one `job list`. Joining locally means the scan pays for Jenkins once per
  // refresh, never once per branch on the 5s pulse.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/green', 'feature/red', 'feature/unstable']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen });
  const calls = callsOf(jen.callsFile).filter((c) => c.includes('job list'));
  assert.equal(calls.length, 1, 'exactly one job list, regardless of branch count');
});

test('host: the Jenkins arm splits the instance into an -I slug and a job path', () => {
  // `Jenkins instance: ci.test/webbloqs/continuous-build-multi` splits on the
  // FIRST `/`: `-I ci.test` (the instance slug jen's -I takes) and
  // `job list webbloqs/continuous-build-multi` (the multibranch container). This
  // is how the container path travels without a forbidden new config key.
  const repo = makeJenkinsRepo({ instance: 'ci.test/webbloqs/continuous-build-multi' });
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/green']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen });
  const jobCall = callsOf(jen.callsFile).find((c) => c.includes('job list'));
  assert.match(jobCall, /-I ci\.test\b/, 'the -I slug is the instance value up to the first /');
  assert.match(jobCall, /job list webbloqs\/continuous-build-multi/,
    'the job path is the remainder of the instance value');
});

test('host: an unreachable Jenkins marks rows unknown and does NOT blank the list', () => {
  // The brief's reconciliation of Done-when 4. `jen auth status` prints
  // `Jenkins auth: NOT reachable` and EXITS 0 — so `$?` cannot detect it; the
  // wording must. And one dead Jenkins must not blank the whole PR list, which
  // is what a hard exit 3 would do (fleet.ts rejects a non-zero pr-list and
  // keeps the last good map). So the rows survive as `checks:"unknown"` — the
  // fifth state the adapter already documents for exactly this — and the op
  // still exits 0 so the list is emitted.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/green', 'feature/red']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS, authReachable: false });
  const res = runJenkinsAllowFail(['pr-list', '--rich'], { repo, hostStubs, jen });
  assert.equal(res.code, 0, 'a dead Jenkins must not blank the whole PR list');
  const rows = rowsByHead(res.stdout);
  assert.equal(rows.get('feature/green').checks, 'unknown');
  assert.equal(rows.get('feature/red').checks, 'unknown');
  assert.match(res.stderr, /jenkins/i, 'the failure is named on stderr, never swallowed');
});

test('host: CI jenkins but no instance configured exits 3 — the op cannot proceed', () => {
  // The other side of Done-when 4: exit 3 is right when the OP itself cannot
  // run. A `CI: jenkins` repo with no `Jenkins instance` is a misconfiguration,
  // not a transient outage — there is no instance to ask, and degrading rows to
  // `unknown` would hide a config error that only a person can fix.
  const repo = mkdtempSync(path.join(tmpdir(), 'plot-host-jen-noinst-'));
  writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Git host:** github\n- **CI:** jenkins\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/green']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const res = runJenkinsAllowFail(['pr-list', '--rich'], { repo, hostStubs, jen });
  assert.equal(res.code, 3, 'no instance is a config error the op cannot proceed past');
  assert.match(res.stderr, /instance/i);
});

test('host: a repo without CI jenkins reads its GitHub rollup exactly as today', () => {
  // Done-when 3: the arm is inert unless `CI: jenkins` is declared. A GitHub
  // repo with a real rollup still collapses it the same way, and `jen` is never
  // called.
  const repo = mkdtempSync(path.join(tmpdir(), 'plot-host-nojen-'));
  writeFileSync(path.join(repo, 'CLAUDE.md'), '## Plot Config\n\n- **Git host:** github\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const hostStubs = makeStubs({
    ghJson: JSON.stringify([{
      number: 7, title: 't', state: 'OPEN', headRefName: 'feature/x', isDraft: false,
      statusCheckRollup: [{ name: 'validate', conclusion: 'FAILURE' }],
      mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null,
      url: 'https://example.test/pr/7',
    }]),
  });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const out = runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen });
  const row = JSON.parse(out.trim());
  assert.equal(row.checks, 'failing');
  assert.deepEqual(row.failing_checks, ['validate']);
  assert.equal(callsOf(jen.callsFile).filter((c) => c.includes('job list')).length, 0,
    'jen is not called when CI is not jenkins');
});

test('host: the Jenkins arm rides on the Bitbucket backend too — CI is orthogonal', () => {
  // `CI` and `Git host` are independent keys. A Bitbucket repo with Jenkins gets
  // its PR list from `bb` (checks:"unknown") and its `checks` from `jen`, joining
  // two hosts in one --rich row. The arm must not be bolted to the GitHub branch.
  const repo = makeJenkinsRepo({ gitHost: 'bitbucket' });
  const hostStubs = makeStubs({
    bbJson: JSON.stringify([{
      id: 3, title: 't', state: 'OPEN', source: { branch: { name: 'feature/red' } },
      links: { html: { href: 'https://example.test/pr/3' } },
    }]),
  });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const out = runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen });
  const row = JSON.parse(out.trim());
  assert.equal(row.head, 'feature/red', 'the Bitbucket row still normalizes');
  assert.equal(row.checks, 'failing', 'Jenkins fills what bb leaves unknown');
  assert.deepEqual(row.failing_checks, ['webbloqs/continuous-build-multi/feature/red']);
});

// --- Jira issue-list / issue-view: REST, no CLI, pinned to the contract ------
//
// `Tracker: jira` sends the two issue ops through Jira's REST API, DISPATCHED ON
// `Tracker` and INDEPENDENT of `Git host` — a Bitbucket repo tracking in Jira is
// the normal enterprise case. There is no Jira instance here, so every test
// drives a stubbed `curl` that emits a chosen body and HTTP status, reproducing
// the adapter's `-w '\n%{http_code}'` shape. The stub also RECORDS its argv, so
// the read-only rule and the token-not-in-the-URL rule are asserted, not assumed.
//
// The THREE OUTCOMES are the point, and the story's name is the reason: an empty
// inbox says *you have no tickets*. So an auth failure, a network failure and an
// HTTP error must all be exit 3 with empty stdout — never an empty list. There is
// NO exit-4 for Jira (a configured Jira CAN be asked), unlike the bitbucket arm.

// A `curl` stub: prints a body then a status line (the adapter's -w shape) and
// records argv one line per arg. `status` is the HTTP code; `curlExit` lets a
// test simulate a transport failure (curl itself failing: DNS, TLS, refused).
function makeJiraCurlStub({ body = '{}', status = 200, curlExit = 0 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-jira-'));
  const argvFile = path.join(dir, 'curl.argv');
  // The body is base64'd into the stub so an arbitrary JSON payload (quotes,
  // newlines, unicode) survives the shell heredoc without escaping games.
  const b64 = Buffer.from(body, 'utf8').toString('base64');
  const stubBody = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${argvFile}"
${curlExit !== 0 ? `exit ${curlExit}\n` : ''}printf '%s' "$(printf '%s' '${b64}' | base64 -d)"
printf '\\n%s' '${status}'
`;
  writeFileSync(path.join(dir, 'curl'), stubBody);
  chmodSync(path.join(dir, 'curl'), 0o755);
  return { dir, argvFile };
}

// The env every Jira call needs: the tracker scheme+URL and the auth pair.
// `PLOT_TRACKER` carries `jira <baseUrl>`, the same shape config would hold.
const JIRA_ENV = {
  PLOT_TRACKER: 'jira https://acme.atlassian.net',
  JIRA_EMAIL: 'me@acme.test',
  JIRA_API_TOKEN: 'tok-secret',
  // Keep PLOT_HOST empty so the arm proves it dispatches on Tracker, not backend.
  PLOT_HOST: '',
};

function runJira(args, stub, extraEnv = {}) {
  return spawnSync('bash', [adapter, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, ...JIRA_ENV, ...extraEnv },
  });
}

const JIRA_SEARCH_OK = JSON.stringify({
  issues: [
    { key: 'PROJ-123', fields: { summary: 'Tickets reach the inbox', created: '2026-08-20T09:00:00.000+0000' } },
    { key: 'PROJ-99', fields: { summary: 'An older ticket', created: '2026-08-10T09:00:00.000+0000' } },
  ],
});

test('host: issue-list jira emits the {number,title,url,createdAt} contract, key as number', () => {
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const res = runJira(['issue-list'], stub);
  assert.equal(res.status, 0, res.stderr);
  const rows = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows, [
    { number: 'PROJ-123', title: 'Tickets reach the inbox', url: 'https://acme.atlassian.net/browse/PROJ-123', createdAt: '2026-08-20T09:00:00.000+0000' },
    { number: 'PROJ-99', title: 'An older ticket', url: 'https://acme.atlassian.net/browse/PROJ-99', createdAt: '2026-08-10T09:00:00.000+0000' },
  ]);
  // `number` is the Jira KEY, a string — #447 taught plot-plan-meta.sh to read it.
  assert.equal(typeof rows[0].number, 'string');
});

test('host: issue-list jira dispatches on Tracker, independent of the git host', () => {
  // A Bitbucket repo tracking in Jira: PLOT_HOST=bitbucket, but the issue op must
  // still go to Jira's REST API, never to `bb`. The proof is that a `bb` stub is
  // never invoked — curl carries the whole call.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const res = runJira(['issue-list'], stub, { PLOT_HOST: 'bitbucket' });
  assert.equal(res.status, 0, res.stderr);
  const rows = res.stdout.trim().split('\n').filter(Boolean);
  assert.equal(rows.length, 2, 'the Jira arm answers even under Git host: bitbucket');
});

test('host: issue-list jira sends Basic auth via --user, never the token in the URL', () => {
  // The token must not land in argv as part of the URL (it would leak into any
  // process listing). --user carries it, and the URL is the plain REST path.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  runJira(['issue-list'], stub);
  const argv = readFileSync(stub.argvFile, 'utf8');
  assert.match(argv, /^--user$/m);
  assert.match(argv, /^me@acme\.test:tok-secret$/m, 'Basic credentials go through --user');
  // The URL argument is the REST path with NO embedded credentials.
  const urlLine = argv.split('\n').find((l) => l.startsWith('https://'));
  assert.equal(urlLine, 'https://acme.atlassian.net/rest/api/2/search/jql');
  assert.ok(!urlLine.includes('tok-secret'), 'the token is never in the URL');
});

test('host: issue-list jira reads only — never a POST or a write verb', () => {
  // READ-ONLY, asserted. curl defaults to GET; the adapter must never pass
  // -X POST/PUT/DELETE or -d/--data (a write body). --data-urlencode is a GET
  // query param under -G and is allowed; a bare -d would change the method.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  runJira(['issue-list'], stub);
  const argv = readFileSync(stub.argvFile, 'utf8').split('\n');
  for (const write of ['-X', '--request', '-d', '--data', '--data-binary', '--data-raw']) {
    assert.ok(!argv.includes(write), `issue-list must not send ${write} (that would write)`);
  }
});

test('host: issue-list jira honours --limit as maxResults', () => {
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  runJira(['issue-list', '--limit', '7'], stub);
  const argv = readFileSync(stub.argvFile, 'utf8');
  assert.match(argv, /^maxResults=7$/m, '--limit becomes the Jira maxResults page bound');
});

test('host: issue-list jira reports an empty inbox as an answered 0, not a failure', () => {
  // The third outcome, and the one that must NOT be confused with the others:
  // the tracker answered and there are none. Exit 0, empty stdout.
  const stub = makeJiraCurlStub({ body: '{"issues":[]}' });
  const res = runJira(['issue-list'], stub);
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('host: issue-list jira treats an auth failure as exit 3, NEVER an empty inbox', () => {
  // THE FAILURE THIS STORY IS NAMED FOR. A 401 must not read as *you have no
  // tickets* — it exits 3 with empty stdout and Jira's own message on stderr.
  const stub = makeJiraCurlStub({
    body: '{"errorMessages":["Client must be authenticated to access this resource."],"errors":{}}',
    status: 401,
  });
  const res = runJira(['issue-list'], stub);
  assert.equal(res.status, 3, 'an auth failure is the question failing, not an empty answer');
  assert.notEqual(res.status, 4, 'a configured Jira CAN be asked — there is no exit 4 here');
  assert.equal(res.stdout.trim(), '', 'no empty list may reach the board as "no tickets"');
  assert.match(res.stderr, /401/);
});

test('host: issue-list jira treats a 5xx outage as exit 3', () => {
  const stub = makeJiraCurlStub({ body: '{"errorMessages":["Internal server error"]}', status: 503 });
  const res = runJira(['issue-list'], stub);
  assert.equal(res.status, 3);
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /503/);
});

test('host: issue-list jira treats a transport failure (curl non-zero) as exit 3', () => {
  // DNS/TLS/connection-refused: curl itself exits non-zero and prints no HTTP
  // status. A network failure is not an empty inbox.
  const stub = makeJiraCurlStub({ curlExit: 6 });
  const res = runJira(['issue-list'], stub);
  assert.equal(res.status, 3);
  assert.equal(res.stdout.trim(), '');
});

test('host: issue-list jira exits 3 when JIRA_API_TOKEN is absent — not an empty inbox', () => {
  // A missing token is a CONFIG error the op cannot proceed past. Degrading to
  // an empty list would wear the exact mask this story removes.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const res = runJira(['issue-list'], stub, { JIRA_API_TOKEN: '' });
  assert.equal(res.status, 3);
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /JIRA_API_TOKEN|authenticated/i);
});

test('host: issue-list jira exits 3 when no base URL is configured', () => {
  // `Tracker: jira` with no URL cannot be asked at all — a config error, exit 3.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const res = runJira(['issue-list'], stub, { PLOT_TRACKER: 'jira' });
  assert.equal(res.status, 3);
  assert.equal(res.stdout.trim(), '');
});

test('host: issue-view jira returns {number,title,body,url} with a plain-string body', () => {
  // v2, not v3: `description` is a plain string here, the problem statement
  // /plot-idea receives — not an ADF tree to walk.
  const stub = makeJiraCurlStub({
    body: JSON.stringify({
      key: 'PROJ-123',
      fields: { summary: 'Tickets reach the inbox', description: 'The inbox is blank where it matters.\n\nMake Jira answerable.' },
    }),
  });
  const res = runJira(['issue-view', 'PROJ-123'], stub);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.number, 'PROJ-123');
  assert.equal(out.title, 'Tickets reach the inbox');
  assert.equal(out.body, 'The inbox is blank where it matters.\n\nMake Jira answerable.');
  assert.equal(out.url, 'https://acme.atlassian.net/browse/PROJ-123');
  // The URL argument targets the v2 issue endpoint keyed by the Jira key.
  const argv = readFileSync(stub.argvFile, 'utf8').split('\n');
  assert.ok(argv.includes('https://acme.atlassian.net/rest/api/2/issue/PROJ-123'));
});

test('host: issue-view jira fills a null description as "" rather than the word null', () => {
  const stub = makeJiraCurlStub({
    body: JSON.stringify({ key: 'PROJ-5', fields: { summary: 'Terse', description: null } }),
  });
  const res = runJira(['issue-view', 'PROJ-5'], stub);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).body, '');
});

test('host: issue-view jira treats a missing key (404) as a failure, not an empty body', () => {
  // The key was read off issue-list moments ago, so a 404 means the tracker
  // moved under the board — a fact worth surfacing, not a blank to plan on.
  const stub = makeJiraCurlStub({
    body: '{"errorMessages":["Issue does not exist or you do not have permission to see it."],"errors":{}}',
    status: 404,
  });
  const res = runJira(['issue-view', 'PROJ-999'], stub);
  assert.equal(res.status, 3);
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /404/);
});

test('host: issue-view jira reads only — never a write verb', () => {
  const stub = makeJiraCurlStub({
    body: JSON.stringify({ key: 'PROJ-1', fields: { summary: 's', description: 'b' } }),
  });
  runJira(['issue-view', 'PROJ-1'], stub);
  const argv = readFileSync(stub.argvFile, 'utf8').split('\n');
  for (const write of ['-X', '--request', '-d', '--data', '--data-binary', '--data-raw']) {
    assert.ok(!argv.includes(write), `issue-view must not send ${write}`);
  }
});

test('host: an absent Tracker leaves the GitHub issue arm exactly as it was', () => {
  // Done-when 2 / Done-when 7: the Jira arm is opt-in. With no Tracker key, a
  // GitHub repo resolves through `gh issue list` unchanged, and curl is never
  // called. Proven by a gh stub answering while the curl stub records nothing.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-notracker-'));
  writeFileSync(path.join(dir, 'gh'),
    '#!/usr/bin/env bash\nprintf \'%s\' \'[{"number":7,"title":"gh issue","url":"https://gh.test/7","createdAt":"2026-08-01T00:00:00Z"}]\'\n');
  chmodSync(path.join(dir, 'gh'), 0o755);
  const curlArgv = path.join(dir, 'curl.argv');
  writeFileSync(path.join(dir, 'curl'), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${curlArgv}"\n`);
  chmodSync(path.join(dir, 'curl'), 0o755);
  const res = spawnSync('bash', [adapter, 'issue-list'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PLOT_HOST: 'github', PLOT_TRACKER: '' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout.trim()).number, 7, 'the GitHub arm answers unchanged');
  assert.ok(!existsSync(curlArgv), 'curl is never called when Tracker is absent');
});

// --- bb capability check: --json support ------------------------------------
//
// Two tools share the name `bb`. craftamap/bb (a Go binary, 0.6.0) does NOT
// support `--json` for PR commands. Quatico's `bb` (a shell wrapper) does.
// The adapter must check the capability BEFORE passing `--json`, and exit 3
// with a reason naming WHICH bb answered when it cannot.
//
// These tests use PATH-stubbed binaries — one that rejects --json, one that
// accepts it, one that exits non-zero, one that segfaults.

// Make a bb stub that behaves like craftamap 0.6.0 — rejects --json
function makeCraftamapBbStub() {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-craftamap-'));
  // Rejects --json with the craftamap error message
  const body = `#!/usr/bin/env bash
if [[ "\$*" == *"--version"* ]]; then
  echo "bb version 0.6.0 (abc1234)"
  exit 0
fi
if [[ "\$*" == *"--json"* ]]; then
  echo "Error: unknown flag: --json" >&2
  exit 1
fi
echo "[]"
`;
  writeFileSync(path.join(dir, 'bb'), body);
  chmodSync(path.join(dir, 'bb'), 0o755);
  return { dir };
}

// Make a bb stub that behaves like Quatico's bb — supports --json
function makeQuaticoBbStub({ json = '[]' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-quatico-'));
  const body = `#!/usr/bin/env bash
if [[ "\$*" == *"--version"* ]]; then
  echo "bb version 1.9.0"
  exit 0
fi
# Accept --json and respond
printf '%s' '${json.replace(/'/g, `'\\''`)}'
`;
  writeFileSync(path.join(dir, 'bb'), body);
  chmodSync(path.join(dir, 'bb'), 0o755);
  return { dir };
}

// Make a bb stub that segfaults — simulates craftamap under 429
function makeSegfaultingBbStub() {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-segfault-'));
  // kill -11 sends SIGSEGV to self
  const body = `#!/usr/bin/env bash
if [[ "\$*" == *"--version"* ]]; then
  echo "bb version 0.6.0 (abc1234)"
  exit 0
fi
kill -11 $$
`;
  writeFileSync(path.join(dir, 'bb'), body);
  chmodSync(path.join(dir, 'bb'), 0o755);
  return { dir };
}

test('host: a bb without --json produces exit 3 with a named reason', () => {
  // Done-when 1: craftamap 0.6.0, which rejects --json, must not silently
  // return an empty list. It must exit 3 with a reason naming WHICH bb.
  const stub = makeCraftamapBbStub();
  const res = spawnSync('bash', [adapter, 'pr-list'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 3, 'must exit 3 when bb cannot do --json');
  assert.equal(res.stdout.trim(), '', 'stdout must be empty — no fabricated list');
  assert.match(res.stderr, /craftamap.*0\.6\.0|does not support --json/i,
    'the reason must name the bb that answered');
});

test('host: a capable bb behaves exactly as before', () => {
  // Done-when 2: a Quatico bb with --json support must work unchanged.
  const stub = makeQuaticoBbStub({
    json: '[{"id":5,"title":"Test PR","state":"OPEN","source":{"branch":{"name":"feature/x"}}}]',
  });
  const res = spawnSync('bash', [adapter, 'pr-list'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout.trim());
  assert.equal(out.number, 5);
  assert.equal(out.head, 'feature/x');
});

test('host: the reason names WHICH bb answered', () => {
  // Done-when 3: two tools share the name, so a version number alone does not
  // identify one. The diagnostic must include "craftamap" or a path.
  const stub = makeCraftamapBbStub();
  const res = spawnSync('bash', [adapter, 'pr-state', '1'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 3);
  // Must mention craftamap AND 0.6.0 (or the full path, or similar identifying info)
  assert.match(res.stderr, /craftamap/i, 'must identify the product');
  assert.match(res.stderr, /0\.6\.0/, 'must include the version');
});

test('host: a segfaulting CLI is a failure, not an empty answer', () => {
  // Done-when 4: craftamap 0.6.0 panics under a 429 (SIGSEGV). A segfault
  // during the capability check must be caught and reported, never swallowed.
  const stub = makeSegfaultingBbStub();
  const res = spawnSync('bash', [adapter, 'pr-list'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  // The exact exit code depends on how the segfault is handled, but it must
  // NOT be 0 with an empty list (which would be "no PRs found")
  assert.notEqual(res.status, 0, 'a segfault must not read as success');
  // And stdout must be empty or missing — never a fabricated answer
  if (res.stdout.trim()) {
    assert.throws(() => JSON.parse(res.stdout), 'no parseable output');
  }
});

test('host: the capability check is per-CAPABILITY, not per-version', () => {
  // Done-when 4b: craftamap 0.6.0 and Quatico 1.0.0 are different products.
  // A version floor cannot express "does this binary support --json". The
  // check must test the FLAG, not compare numbers.
  //
  // Proven by: a "high version" bb that still rejects --json is rejected.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-highver-'));
  const body = `#!/usr/bin/env bash
if [[ "\$*" == *"--version"* ]]; then
  echo "bb version 99.0.0"  # High version number
  exit 0
fi
if [[ "\$*" == *"--json"* ]]; then
  echo "Error: unknown flag: --json" >&2
  exit 1
fi
echo "[]"
`;
  writeFileSync(path.join(dir, 'bb'), body);
  chmodSync(path.join(dir, 'bb'), 0o755);
  const res = spawnSync('bash', [adapter, 'pr-list'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 3, 'a high version without --json is still rejected');
  assert.match(res.stderr, /does not support --json/i);
});

test('host: the capability is established once per run, not per call', () => {
  // Done-when 5: five call sites must not become five probes. The check runs
  // ONCE, then caches the result.
  //
  // Proven by: a stub that counts --help invocations, called for two PR ops.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-once-'));
  const countFile = path.join(dir, 'help.count');
  writeFileSync(countFile, '0');
  // This stub counts how many times --help is passed (the capability probe)
  const body = `#!/usr/bin/env bash
if [[ "\$*" == *"--version"* ]]; then
  echo "bb version 1.9.0"
  exit 0
fi
if [[ "\$*" == *"--help"* ]]; then
  count=$(cat "${countFile}")
  echo $((count + 1)) > "${countFile}"
  echo "bb pr list help"
  exit 0
fi
printf '%s' '[]'
`;
  writeFileSync(path.join(dir, 'bb'), body);
  chmodSync(path.join(dir, 'bb'), 0o755);

  // Run pr-list — this should trigger ONE capability check
  spawnSync('bash', [adapter, 'pr-list'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });

  const helpCount = parseInt(readFileSync(countFile, 'utf8').trim(), 10);
  assert.equal(helpCount, 1, 'capability check must run exactly once');
});

// --- pr-list truncation: a partial Bitbucket page must say it is partial -----
//
// #333. `bb pr list` has NO --limit and returns a fixed page (50 at 1.0.0). The
// adapter drops the caller's --limit and warns, then serves the page. Past 50
// PRs per state that page is a PARTIAL set, and a caller joining it locally reads
// every branch beyond it as "no PR" — the fabricated verdict the scan refuses
// everywhere else. Measured 2026-08-26 against quatico/quaweb-website: 50 merged
// PRs (ids 836→787) against a repo numbering to 836, ~780 invisible.
//
// The repair lives INSIDE pr-list — both consumers (plot-fleet-scan.sh:474 and
// fleet.ts:1552) join a bulk list, so a fix in one leaves the other partial. It
// is the HONEST-TRUNCATED half: bb cannot prove completeness (no total, no
// cursor, no honoured limit), so a non-empty bb page for a --limit call is
// POSSIBLY TRUNCATED and the adapter says so. Closing the ~780-PR gap per-id is
// unaffordable (~10s per bb call, no bulk primitive), so no per-branch fallback
// is shipped — see the PR's report against Done-when item 3.
//
// The report goes to STDERR, not a stdout sentinel: fleet.ts parses EVERY stdout
// line as a PrRecord with an unchecked cast, so a sentinel line would enter its
// join as a phantom {number:undefined} — a NEW silent corruption while fixing an
// old one, and Done-when 5 forbids touching fleet.ts to guard against it. stderr
// is the channel item 7 asks for and the one an untouched caller already drops.
//
// Detection is against the REQUESTED LIMIT being unprovable, NEVER the constant
// 50: the rule names no page size, so a future bb returning 100 is still caught.

// A strict bb stub whose page is a FULL page of `pageSize` rows for `state` — the
// shape a truncated bb list has. Reuses makeStrictBbStub's refusal of --limit and
// unknown states; the rows are generated so the page count is controllable.
function bbFullPage(pageSize, state = 'MERGED') {
  const rows = Array.from({ length: pageSize }, (_, i) => ({
    id: 1000 - i, title: `PR ${1000 - i}`, state,
    source: { branch: { name: `feature/pr-${1000 - i}` } },
  }));
  return JSON.stringify(rows);
}

// A truncation report is a machine-parseable stderr line. Assert its shape so a
// future caller (a scan taught to read it) has a contract, not a coincidence.
const truncationReports = (stderr) =>
  stderr.split('\n').filter((l) => /possibly truncated/i.test(l));

test('host: bitbucket reports a non-empty --limit page as possibly truncated', () => {
  // The measured failure. bb returns a full page for `merged`; because bb ignores
  // --limit and cannot report a total, the page is possibly truncated and the
  // adapter says so on stderr, naming the state and the count (items 4, 7).
  const bb = makeStrictBbStub({
    perState: { open: '[]', merged: bbFullPage(50), declined: '[]' },
  });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  // Every row bb returned still arrives on stdout, unchanged and un-augmented.
  const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 50, 'every row bb returned is still served');
  assert.ok(lines.every((r) => typeof r.number === 'number' && r.head), 'PR rows keep their shape');
  assert.ok(!lines.some((r) => r.truncated === true),
    'no stdout sentinel — a phantom PrRecord would corrupt fleet.ts');
  // The report is on stderr, names the state, and carries the count.
  const reports = truncationReports(res.stderr);
  assert.equal(reports.length, 1, 'exactly the truncated state is reported');
  assert.match(reports[0], /merged/, 'the report names which state was truncated');
  assert.match(reports[0], /\b50\b/, 'the report carries how many rows came back');
});

test('host: bitbucket truncation is detected against the ignored limit, not the constant 50', () => {
  // Item 1, the assertion a naive `count == 50` fix fails. A future bb whose page
  // size is 100 returns a full page of 100; that is STILL possibly truncated, and
  // a detector keyed to 50 would report it complete — this plan's own defect
  // restored. The rule names no page size, so 100 is caught exactly as 50 is.
  const bb = makeStrictBbStub({
    perState: { open: '[]', merged: bbFullPage(100), declined: '[]' },
  });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const reports = truncationReports(res.stderr);
  assert.equal(reports.length, 1, 'a 100-row page is truncated too — the detector must not name 50');
  assert.match(reports[0], /\b100\b/);
});

test('host: bitbucket does NOT report an empty state as truncated', () => {
  // A state that returned nothing had nothing to truncate. Reporting it would
  // cost a future caller needless per-id lookups for a genuinely empty state.
  const bb = makeStrictBbStub({
    perState: { open: '[]', merged: '[]', declined: '[]' },
  });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), '', 'an all-empty list emits no rows');
  assert.equal(truncationReports(res.stderr).length, 0, 'an empty page is not truncated');
});

test('host: bitbucket without a --limit does not report truncation', () => {
  // The signal is "the caller asked for more than one page and bb ignored it". A
  // caller that asked for no limit accepted the host's default page and is owed no
  // truncation report — no existing no-limit caller's result changes.
  const bb = makeStrictBbStub({
    perState: { open: bbFullPage(50, 'OPEN'), merged: '[]', declined: '[]' },
  });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'open'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(truncationReports(res.stderr).length, 0, 'no --limit, no truncation claim');
});

test('host: only a non-empty state is reported, and it is named', () => {
  // Per-state granularity. On bb NO non-empty page is provably complete (no
  // total, no cursor), so a state with even one row IS possibly truncated — the
  // rule the plan settles. The state that returned NOTHING had nothing to hide
  // and is not reported. So `merged` (full) is named and `declined`/`open`
  // (empty) are silent — a per-call flag would report all three, and a future
  // caller would re-fetch the two empty states for nothing.
  const bb = makeStrictBbStub({
    perState: { open: '[]', merged: bbFullPage(50), declined: '[]' },
  });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const reports = truncationReports(res.stderr);
  assert.equal(reports.length, 1, 'only the non-empty state is reported');
  assert.match(reports[0], /merged/, 'the report names which state');
  assert.doesNotMatch(reports[0], /declined/, 'an empty state is not reported');
});

test('host: the stdout stream stays a clean PR list an untouched scan can join', () => {
  // Item 5: the scan is untouched, so stdout must be exactly what it was — one PR
  // per line, no marker line for the scan's sed to trip over. The report living
  // on stderr (which the scan drops with 2>/dev/null) is what keeps this true.
  const bb = makeStrictBbStub({
    perState: { open: '[]', merged: bbFullPage(50), declined: '[]' },
  });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  for (const line of res.stdout.trim().split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    assert.equal(typeof row.number, 'number', 'every stdout line is a real PR row');
    assert.ok(row.head, 'every stdout line carries a head');
  }
});

test('host: GitHub reports no truncation on the common path and makes no extra call', () => {
  // Item 6: a host that honours --limit is complete by construction when it
  // returns fewer than the limit. GitHub must make no extra host call — asserted
  // by the single gh invocation — and report nothing on the common path.
  const stubs = makeStubs({
    ghJson: JSON.stringify([
      { number: 7, title: 'A', state: 'MERGED', headRefName: 'feature/a' },
    ]),
  });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(truncationReports(res.stderr).length, 0, '1 < 1000 proves the list is whole');
  const argv = argvOf(stubs.ghArgv);
  assert.deepEqual(argv.slice(0, 2), ['pr', 'list'], 'the single gh pr list call, no extra probe');
});

test('host: a GitHub page AT the requested limit is reported possibly truncated', () => {
  // The symmetric case, and why the rule is "against the requested limit": gh
  // HONOURS --limit, so a page returning exactly the limit may hide more. This is
  // the branch a future bb with --limit support would also take — the reason the
  // wording is not "50".
  const rows = Array.from({ length: 5 }, (_, i) => ({
    number: 100 + i, title: `t${i}`, state: 'MERGED', headRefName: `feature/f${i}`,
  }));
  const stubs = makeStubs({ ghJson: JSON.stringify(rows) });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'merged', '--limit', '5'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.equal(res.status, 0, res.stderr);
  const reports = truncationReports(res.stderr);
  assert.equal(reports.length, 1, 'a gh page returning exactly the requested limit may be truncated');
  assert.match(reports[0], /\b5\b/);
});

test('host: a GitHub page UNDER the requested limit is silent', () => {
  // The pairing: fewer rows than the limit proves the host had no more, so the
  // common path (a 1000 limit, a handful of PRs) reports nothing.
  const rows = Array.from({ length: 3 }, (_, i) => ({
    number: 100 + i, title: `t${i}`, state: 'MERGED', headRefName: `feature/f${i}`,
  }));
  const stubs = makeStubs({ ghJson: JSON.stringify(rows) });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'merged', '--limit', '1000'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(truncationReports(res.stderr).length, 0, '3 < 1000 proves the list is whole');
});

test('host: --rich reports truncation too and keeps the rich rows clean', () => {
  // The board calls --rich. Truncation must be reported on the rich path as well,
  // or the board's PR timer (fleet.ts) joins a partial list with no signal. The
  // rich rows are still emitted whole on stdout.
  const bb = makeStrictBbStub({
    perState: { open: '[]', merged: bbFullPage(50), declined: '[]' },
  });
  const res = spawnSync('bash', [adapter, 'pr-list', '--rich', '--state', 'all', '--limit', '1000'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(truncationReports(res.stderr).length, 1, '--rich must report truncation too');
  const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 50);
  assert.ok(lines.every((r) => r.checks === 'unknown'), 'rich rows still normalize');
});

// ── rate-limit ──────────────────────────────────────────────────────────────
//
// GITHUB HAS TWO BUDGETS AND ONE ERROR MESSAGE. GraphQL and REST/core are
// metered separately — measured 4503/5000 and 4997/5000 in the same instant on
// 2026-08-27 — so exhausting one says nothing about the other. Before this op
// a rate-limited caller could not tell that a second path was available, and
// `gh pr create` failing on GraphQL while `gh api repos/.../pulls` succeeded
// was a real, repeated experience in this repo.
//
// The op REPORTS and does not decide. The fallback that acts on it is a later
// wave, so these tests pin the reporting contract only.

test('host: rate-limit github reports both budgets separately', () => {
  const stubs = makeStubs({
    ghJson: JSON.stringify({
      resources: {
        graphql: { remaining: 12, limit: 5000, reset: 1787858250 },
        core: { remaining: 4997, limit: 5000, reset: 1787858165 },
      },
    }),
  });
  const out = JSON.parse(run(['rate-limit'], { env: { PLOT_HOST: 'github' }, stubs }));
  // The point of the op: a spent GraphQL budget WITH REST still available is
  // reported as exactly that, rather than as one undifferentiated "limited".
  assert.equal(out.graphql.remaining, 12);
  assert.equal(out.core.remaining, 4997);
  assert.equal(out.graphql.limit, 5000);
  assert.equal(out.graphql.reset, 1787858250);
  assert.deepEqual(argvOf(stubs.ghArgv), ['api', 'rate_limit']);
});

test('host: rate-limit reads both budgets spent differently from one spent', () => {
  const stubs = makeStubs({
    ghJson: JSON.stringify({
      resources: {
        graphql: { remaining: 0, limit: 5000, reset: 1787858250 },
        core: { remaining: 0, limit: 5000, reset: 1787858165 },
      },
    }),
  });
  const out = JSON.parse(run(['rate-limit'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.graphql.remaining, 0);
  assert.equal(out.core.remaining, 0);
  // Both zero is a DIFFERENT state from one zero: there is no path left to fall
  // back to. A caller must be able to tell them apart, which it can only do if
  // the two numbers are reported independently rather than reduced to a flag.
});

// UNKNOWN IS NOT ZERO, and this is the assertion that keeps it that way.
// Zero means SPENT. A caller that reads "the host could not be asked" as
// "exhausted" takes the expensive fallback path forever — so a host that cannot
// answer must say so in a word that is not a number.
test('host: a host that cannot answer reports unknown, never zero', () => {
  const stubs = makeStubs({ ghFail: 'error connecting to api.github.com: 503 Service Unavailable' });
  const res = runAllowFail(['rate-limit'], { env: { PLOT_HOST: 'github' }, stubs });
  const out = JSON.parse(res.stdout);
  assert.equal(out.graphql.remaining, 'unknown');
  assert.equal(out.core.remaining, 'unknown');
  assert.notEqual(out.graphql.remaining, 0, 'unknown must not be reported as a spent budget');
  assert.match(res.stderr, /503/, "the host's own words reach the caller");
});

// Bitbucket has ONE budget and no way to query it. The op must still answer —
// this is informational, and a caller that cannot read the budget proceeds on
// the default path rather than erroring out.
test('host: rate-limit bitbucket reports unknown and asks nothing', () => {
  const stubs = makeStubs();
  const out = JSON.parse(run(['rate-limit'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.equal(out.graphql.remaining, 'unknown');
  assert.equal(out.core.remaining, 'unknown');
  assert.equal(argvOf(stubs.bbArgv), null, 'bb reports no rate information — do not ask it');
});

// ── the REST fallback ───────────────────────────────────────────────────────
//
// GITHUB METERS GRAPHQL AND REST SEPARATELY, so a spent GraphQL bucket leaves a
// full REST one. `gh pr view` spends GraphQL; `gh api` spends REST. When the
// first budget is gone the second is sitting there unused, and the same
// question can still be answered — degraded and more expensive, but answered.
//
// REST IS A FALLBACK AND NOT THE DEFAULT, and the reason is measured rather
// than stylistic. For 93 branches: ONE GraphQL call (`pr-list` with the check
// rollup) versus ~186 REST calls, because REST's list endpoint returns
// `mergeable_state: null` and no rollup, so full data costs two calls per PR.
// A blanket "use REST whenever possible" trades one cheap call for a hundred
// and eighty. That is the tempting fix and it is wrong.
//
// WHAT THIS BUYS, HONESTLY. A second path when one bucket is GENUINELY spent —
// a real state a long-running board reaches. It does NOT buy immunity from
// throttling: the outage this repo actually had on 2026-08-27 was GitHub's
// SECONDARY limit (concurrency — eight workers against a cap of seven), during
// which both buckets read 5000/5000 with used=0. `rate_limit` cannot report
// that, so no budget check would have predicted it. Backing off on the 403
// itself is a separate change the plan names and does not schedule here.

// The first Done-when: with GraphQL at zero the state still arrives, and it
// arrives THROUGH REST. Asserting "no error was thrown" would pass against an
// adapter that answered from nowhere — the argv is what proves the route.
test('host: pr-state falls back to REST when the GraphQL budget is spent', () => {
  const stubs = makeStubsRateAware({
    graphqlRemaining: 0,
    coreRemaining: 4997,
    restJson: JSON.stringify({
      number: 7, state: 'open', draft: false,
      html_url: 'https://example.test/pr/7', merged: false, merge_commit_sha: null,
    }),
  });
  const out = JSON.parse(run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.deepEqual(out, {
    number: 7, state: 'OPEN', draft: false, url: 'https://example.test/pr/7', mergeCommit: '',
  });
  const calls = callsOf(stubs.callsFile);
  assert.ok(
    calls.some((c) => c.startsWith('api repos/')),
    `the REST path must have answered; calls were:\n${calls.join('\n')}`,
  );
  assert.ok(
    !calls.some((c) => c.startsWith('pr view')),
    'the GraphQL path must not be attempted once its budget is known to be gone',
  );
});

// THE ASSERTION A NAIVE IMPLEMENTATION FAILS. An adapter that always uses REST
// satisfies the test above and makes every scan ~186 calls instead of one. The
// cheap path staying default is the whole reason this is a fallback.
test('host: pr-state does NOT use REST while GraphQL has budget', () => {
  const stubs = makeStubsRateAware({
    graphqlRemaining: 4998,
    coreRemaining: 4997,
    graphqlJson: JSON.stringify({
      number: 7, state: 'OPEN', isDraft: false, url: 'https://example.test/pr/7',
    }),
  });
  const out = JSON.parse(run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.state, 'OPEN');
  const calls = callsOf(stubs.callsFile);
  assert.ok(
    calls.some((c) => c.startsWith('pr view')),
    `the cheap GraphQL path must still be the default; calls were:\n${calls.join('\n')}`,
  );
  assert.ok(
    !calls.some((c) => c.startsWith('api repos/')),
    'REST is the exception — asking it with budget in hand costs ~186 calls per scan',
  );
});

// UNKNOWN IS NOT ZERO — inherited from #485's rule, at the point where it now
// has teeth. A host that cannot be asked about its budget must NOT be read as
// exhausted, or the adapter takes the expensive path forever, on every branch,
// for as long as the budget query keeps failing.
test('host: an unreadable budget keeps the cheap path, never the fallback', () => {
  const stubs = makeStubsRateAware({
    rateFail: 'error connecting to api.github.com: 503 Service Unavailable',
    graphqlJson: JSON.stringify({
      number: 7, state: 'OPEN', isDraft: false, url: 'https://example.test/pr/7',
    }),
  });
  const out = JSON.parse(run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.state, 'OPEN');
  const calls = callsOf(stubs.callsFile);
  assert.ok(
    !calls.some((c) => c.startsWith('api repos/')),
    'unknown must not be treated as spent — that is #485’s rule, and this is where it bites',
  );
});

// THE TWO PATHS PRODUCE THE SAME VOCABULARY. A caller must not be able to tell
// which route answered, or the adapter's contract forks in two. This is
// stricter than it looks: `plot-fleet-scan.sh` reads the state with a regex
// over the JSON TEXT (`sed -n 's/.*"state":"\([A-Z]*\)".*/\1/p'`), so a
// lowercase REST `state` would read as no answer at all rather than as a wrong
// one.
//
// REST'S `state` IS NOT GRAPHQL'S, and this is the trap. A merged PR reports
// `state: "closed"` over REST, with the merge in a SEPARATE `merged` boolean;
// GraphQL says `MERGED` outright. An adapter that just uppercases `.state`
// reports every merged PR as CLOSED — the same confusion `plot-reap.sh` was
// built around.
test('host: the REST fallback and the GraphQL path speak one vocabulary', () => {
  const viaRest = JSON.parse(run(['pr-state', '7'], {
    env: { PLOT_HOST: 'github' },
    stubs: makeStubsRateAware({
      graphqlRemaining: 0,
      restJson: JSON.stringify({
        number: 7, state: 'closed', draft: false, merged: true,
        html_url: 'https://example.test/pr/7',
        merge_commit_sha: '6302e85b7123790c8f7419831ed1500957bcf571',
      }),
    }),
  }));
  const viaGraphql = JSON.parse(run(['pr-state', '7'], {
    env: { PLOT_HOST: 'github' },
    stubs: makeStubsRateAware({
      graphqlRemaining: 4998,
      graphqlJson: JSON.stringify({
        number: 7, state: 'MERGED', isDraft: false,
        url: 'https://example.test/pr/7',
        mergeCommit: { oid: '6302e85b7123790c8f7419831ed1500957bcf571' },
      }),
    }),
  }));
  assert.deepEqual(viaRest, viaGraphql, 'a caller must not be able to tell which route answered');
  assert.equal(viaRest.state, 'MERGED', "REST's lowercase `closed` + `merged:true` is MERGED");
});

// A branch name is not a PR number, and REST needs a different endpoint for it
// (`?head=owner:branch`) whose rows carry `merged_at` instead of a `merged`
// boolean — measured against this repo 2026-08-28, where PR #494's list row
// has `has("merged") == false`. Reading only `.merged` there reports every
// merged branch as CLOSED.
test('host: the REST fallback resolves a branch name, not just a number', () => {
  const stubs = makeStubsRateAware({
    graphqlRemaining: 0,
    restJson: JSON.stringify([{
      number: 494, state: 'closed', draft: false,
      merged_at: '2026-08-28T06:21:03Z',
      html_url: 'https://example.test/pr/494',
      merge_commit_sha: 'd8305bc9ba52cc74872b1788ec67647de72d4134',
    }]),
  });
  const out = JSON.parse(run(['pr-state', 'feature/watched'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.state, 'MERGED', '`merged_at` is the list form’s merge signal');
  assert.equal(out.number, 494);
  assert.equal(out.mergeCommit, 'd8305bc9ba52cc74872b1788ec67647de72d4134');
});

// A branch with no PR is an ANSWER over REST too: the endpoint returns an empty
// array, which is evidence rather than a failure. It must read NONE, exactly as
// the GraphQL path's lookup miss does.
test('host: the REST fallback reports NONE for a branch with no PR', () => {
  const stubs = makeStubsRateAware({ graphqlRemaining: 0, restJson: '[]' });
  const res = runAllowFail(['pr-state', 'feature/nope'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.code, 0, 'an empty list ARRIVED — that is a miss, not a failure');
  assert.deepEqual(JSON.parse(res.stdout), {
    number: 0, state: 'NONE', draft: false, url: '', mergeCommit: '',
  });
});

// A REST call that genuinely fails must not become a reassuring NONE. This is
// the same rule the GraphQL path has had since 2026-08-17, when GitHub returned
// 503 all afternoon and every branch read as having no PR — wrong in the
// reassuring direction, which is the worst one.
test('host: a failing REST fallback exits non-zero rather than answering NONE', () => {
  const stubs = makeStubsRateAware({
    graphqlRemaining: 0,
    restFail: 'error connecting to api.github.com: 503 Service Unavailable',
  });
  const res = runAllowFail(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.notEqual(res.code, 0, 'a transport failure on the fallback is still a failure');
  assert.equal(res.stdout.trim(), '', 'a parseable NONE would be a false answer');
  assert.match(res.stderr, /503/, "the host's own words reach the caller");
});

// BITBUCKET IS UNAFFECTED — a listed test, not an omission. Bitbucket has ONE
// budget, so there is no second one to fall back to, and `bb` reports no rate
// information at all. Issue #228 was filed from a Bitbucket repo, so a reader
// will reasonably expect that backend covered; it is out of scope by
// measurement, and this pins that the fallback adds no cost there.
test('host: pr-state bitbucket is unaffected — no budget query, no REST', () => {
  const stubs = makeStubs({
    bbJson: '{"id":7,"state":"MERGED","draft":false,"links":{"html":{"href":"https://bb.test/pr/7"}}}',
  });
  const out = JSON.parse(run(['pr-state', '7'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.deepEqual(out, { number: 7, state: 'MERGED', draft: false, url: 'https://bb.test/pr/7' });
  assert.equal(argvOf(stubs.ghArgv), null, 'the GitHub CLI is not touched on a Bitbucket repo');
});

// --- pr-list: THREE OUTCOMES, KEPT APART -----------------------------------
//
// `issue-list` states the rule in full and has held it since it was written:
// an empty list means the host answered and there are none; a non-zero exit
// with empty stdout means the question failed; exit 4 means this host cannot
// be asked at all.
//
// `pr-list` collapsed the first two until 2026-08-30. The call was unchecked —
// `_gh_raw="$(gh pr list …)"` under `set -uo pipefail` with NO `-e` — so a
// failed `gh` continued with `_gh_raw` empty, `jq` emitted nothing, and the
// caller received an empty list. Reproduced against a nonexistent repo:
// `exit=1`, stdout empty, indistinguishable from *there are no PRs*.
//
// WHAT IT COST, measured 2026-08-30: `#513` was merged, and minutes later the
// fleet scan reported its branch `open` and counted it among the unfinished,
// with `merge_detect=pr-merge` in the summary — which reads as *the host was
// asked and answered*. What had actually happened was
// `GraphQL: API rate limit already exceeded for user ID 870334`, and nothing
// in the output was a warning.
//
// `pr-list` is ONE GraphQL call in place of ~186 REST calls, a deliberate and
// good trade whose consequence is that throttling takes out EVERY PR answer at
// once rather than degrading row by row. So the whole fleet read unmerged,
// every wave stayed blocked, and the board showed a busy estate with nothing
// eligible — indistinguishable from work genuinely in flight.

test('host: a failed pr-list exits non-zero and prints nothing on stdout', () => {
  const stubs = makeStubs({ ghFail: 'GraphQL: API rate limit already exceeded for user ID 870334.' });
  const res = runAllowFail(['pr-list'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.notEqual(res.code, 0, 'a failed list must not exit 0 — the scan checks the code');
  assert.equal(res.stdout.trim(), '',
    'stdout must be empty: an empty list is a parseable answer, and this is not one');
  assert.match(res.stderr, /rate limit/i, "the host's own words reach the caller");
});

// THE ASSERTION THAT CARRIES THE SLICE. Without it the fix could be "treat
// empty as throttled", which trades a silent wrong answer for a noisy one and
// breaks every repo that genuinely has no open PRs.
test('host: an EMPTY pr-list is an answer — exit 0, no rows', () => {
  const stubs = makeStubs({ ghJson: '[]' });
  const res = runAllowFail(['pr-list'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.code, 0, 'a host that answered "none" answered');
  assert.equal(res.stdout.trim(), '', 'no rows, because there are none');
  assert.equal(res.stderr.trim(), '', 'and nothing to warn about');
});

// The same rule on the --rich path, which is the one the fleet scan uses. The
// two arms build different GraphQL queries and each had its own unchecked
// call, so one fixed arm proves nothing about the other.
test('host: a failed pr-list --rich fails too', () => {
  const stubs = makeStubs({ ghFail: 'GraphQL: API rate limit already exceeded for user ID 870334.' });
  const res = runAllowFail(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.notEqual(res.code, 0, '--rich is the path the fleet scan takes');
  assert.equal(res.stdout.trim(), '', 'and it must be as silent as the plain one');
});

test('host: an empty pr-list --rich is still an answer', () => {
  const stubs = makeStubs({ ghJson: '[]' });
  const res = runAllowFail(['pr-list', '--rich'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.code, 0, 'a repo with no PRs is not a broken host');
  assert.equal(res.stdout.trim(), '', 'zero rows');
});

// BITBUCKET TOO. `bb pr list` is called once PER STATE for `--state all`, and
// a failure in any of them leaves that state's rows missing from a list the
// caller reads as whole — the same collapse, spread across several calls.
test('host: a failed bitbucket pr-list exits non-zero and prints nothing', () => {
  const stubs = makeStubs({ bbFail: 'An error occurred: connection refused' });
  const res = runAllowFail(['pr-list'], { env: { PLOT_HOST: 'bitbucket' }, stubs });
  assert.notEqual(res.code, 0, 'bitbucket collapses the same two outcomes');
  assert.equal(res.stdout.trim(), '', 'and must be as silent about it');
});

// --- the WORD, because throttled and failed need different responses --------
//
// `bb_issue_exit_code` is the model: the exit code cannot split the cases, so
// the WORDING does, and the split falls one way only — an unrecognised error
// is never given the more specific name. Here `throttled` is the specific one:
// it says *ask again later*, where `failed` says *something is broken*. A
// scan reporting `throttled` tells an operator to wait; one reporting `failed`
// tells them to look. Guessing `throttled` from an unrecognised message would
// counsel patience for an outage that patience will not fix.
test('host: pr-list names a rate limit as THROTTLED, not merely failed', () => {
  const stubs = makeStubs({ ghFail: 'GraphQL: API rate limit already exceeded for user ID 870334.' });
  const res = runAllowFail(['pr-list'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.code, 5, 'exit 5 is "the host refused to answer for now"');
  assert.match(res.stderr, /throttled/i, 'and the word is in the message a human reads');
});

test('host: pr-list names any OTHER failure plainly, never as throttled', () => {
  const stubs = makeStubs({ ghFail: 'error connecting to api.github.com: 503 Service Unavailable' });
  const res = runAllowFail(['pr-list'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.code, 3, 'an unrecognised failure keeps the generic code');
  assert.doesNotMatch(res.stderr, /throttled/i,
    'guessing "throttled" would counsel waiting out an outage that waiting will not fix');
});

// A SECONDARY LIMIT IS A DIFFERENT LIMIT, and until 2026-09-02 it shared the
// spent quota's exit code. The outage measured on 2026-08-27 was GitHub's
// concurrent-request throttling — eight workers against a cap of seven — and
// both budgets read 5000/5000 while every call was refused; it reports itself
// as a 403 naming abuse detection.
//
// THE TWO CEILINGS RECOVER MINUTES APART. A spent quota returns at the reset,
// a secondary limit clears in seconds, so one exit code for both counsels a
// wait of minutes for a limit that has already gone — and says nothing about
// the one lever that helps, which is running fewer calls at once.
//
// THIS ASSERTION READ `res.code, 5` UNTIL 2026-09-02, and that was the defect
// being pinned rather than the behaviour.
test('host: pr-list reads a secondary-limit 403 as SECONDARY, not as a spent quota', () => {
  const stubs = makeStubs({
    ghFail: 'HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
  });
  const res = runAllowFail(['pr-list'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.code, 6, 'exit 6 is "the host refused a burst", not exit 5');
  assert.match(res.stderr, /burst/i, 'and the word is in the message a human reads');
});

// THE 2026-08-27 WORDING ITSELF, which names abuse detection and never says
// "secondary". Matching only the newer phrasing would miss the message that
// actually bit this repo.
test('host: pr-list reads an abuse-detection 403 as SECONDARY', () => {
  const stubs = makeStubs({
    ghFail: 'HTTP 403: You have triggered an abuse detection mechanism.',
  });
  const res = runAllowFail(['pr-list'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.code, 6, 'the limit that actually bit this repo is the secondary one');
});

// THE DISTINCTION, ASSERTED AS A DIFFERENCE. Either assertion above passes on
// its own against a script that answers one code for both; only this one fails.
test('host: pr-list gives the two limits DIFFERENT exit codes', () => {
  const quota = runAllowFail(['pr-list'], {
    env: { PLOT_HOST: 'github' },
    stubs: makeStubs({ ghFail: 'GraphQL: API rate limit already exceeded for user ID 870334.' }),
  });
  const secondary = runAllowFail(['pr-list'], {
    env: { PLOT_HOST: 'github' },
    stubs: makeStubs({ ghFail: 'HTTP 403: You have exceeded a secondary rate limit.' }),
  });
  assert.notEqual(quota.code, secondary.code,
    'one word for two ceilings is what the banner could not tell apart');
});

// ── limit ───────────────────────────────────────────────────────────────────
//
// WHAT IS THIS CONNECTOR'S LIMIT, AND HOW WELL DOES IT KNOW IT?
//
// The op that supersedes `rate-limit`, and the reason is one measurement.
// 2026-09-01, quiet moment, same account, seconds apart:
//
//   gh api rate_limit     graphql: 5000/5000, used 0
//   a real call's header  X-Ratelimit-Remaining: 1236, Used: 3764
//
// 3764 calls spent, reported as zero. `graphql_budget_spent()` reads that
// endpoint and tests `-eq 0`, so it has never been able to fire. These tests
// pin the header path and, above all, that a connector reporting nothing
// records `unknown` and never a number.

// A `gh` stub that answers `api graphql --include` with HEADERS, which is the
// only shape this op reads. `makeStubs` emits one canned body and cannot
// express a header block followed by a payload.
//
// The header NAMES ARE `gh`'S OWN CASING (`X-Ratelimit-Limit`), not GitHub's
// documented `X-RateLimit-Limit`. That difference is the bug this stub exists
// to catch: a case-sensitive match reads a present header as absent, and the
// op then reports `unknown` against a host that answered perfectly.
function makeHeaderStub({ headers = {}, fail = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-limit-'));
  const callsFile = path.join(dir, 'gh.calls');
  const lines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const body = fail != null
    ? `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${callsFile}"\nprintf '%s\\n' '${String(fail).replace(/'/g, `'\\''`)}' >&2\nexit 1\n`
    : `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${callsFile}"
cat <<'HDR'
HTTP/2.0 200 OK
${lines}

{"data":{"viewer":{"login":"someone"}}}
HDR
`;
  writeFileSync(path.join(dir, 'gh'), body);
  chmodSync(path.join(dir, 'gh'), 0o755);
  // bb must exist on PATH for the backend-resolution paths that probe it.
  writeFileSync(path.join(dir, 'bb'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(path.join(dir, 'bb'), 0o755);
  return { dir, callsFile };
}

const GITHUB_HEADERS = {
  'X-Ratelimit-Limit': '5000',
  'X-Ratelimit-Remaining': '1236',
  'X-Ratelimit-Reset': '1788269670',
  'X-Ratelimit-Resource': 'graphql',
  'X-Ratelimit-Used': '3764',
};

test('host: limit reads the response headers, not the rate_limit endpoint', () => {
  const stubs = makeHeaderStub({ headers: GITHUB_HEADERS });
  const out = JSON.parse(run(['limit'], { env: { PLOT_HOST: 'github' }, stubs }).trim());
  assert.deepEqual(out, {
    connector: 'github',
    bucket: 'graphql',
    limit: 5000,
    remaining: 1236,
    reset: 1788269670,
    basis: 'actual',
  });
  // THE CALL IT MADE IS THE ASSERTION. `api rate_limit` was measured reporting
  // 5000 while these headers read 1236, so asking it would report the wrong
  // number no matter how the answer were mapped.
  const calls = readFileSync(stubs.callsFile, 'utf8');
  assert.match(calls, /--include/, 'the headers are what carry the reading');
  assert.doesNotMatch(calls, /rate_limit/, 'that endpoint has never been able to answer this');
});

test('host: limit names the bucket the response itself spent', () => {
  // A response reports the bucket IT spent, in `X-RateLimit-Resource`.
  // Reporting `core` from a GraphQL response would invent a reading nobody
  // took — which is what `rate_limit` does by answering for both at once.
  const stubs = makeHeaderStub({
    headers: { ...GITHUB_HEADERS, 'X-Ratelimit-Resource': 'core' },
  });
  const out = JSON.parse(run(['limit'], { env: { PLOT_HOST: 'github' }, stubs }).trim());
  assert.equal(out.bucket, 'core');
});

test('host: limit reports unknown, never a number, when the headers are stripped', () => {
  // A proxy or an enterprise instance that removes them. The call answered and
  // said nothing about a limit, which is not the same fact as a full budget.
  const stubs = makeHeaderStub({ headers: {} });
  const out = JSON.parse(run(['limit'], { env: { PLOT_HOST: 'github' }, stubs }).trim());
  assert.equal(out.basis, 'unknown');
  assert.equal(out.limit, null);
  assert.notEqual(out.limit, 0, 'unknown is not a spent budget');
});

test('host: limit exits 3 where the host could not be asked at all', () => {
  // *Could not ask* and *asked, and it reports no limit* are different facts.
  // The `rate-limit` op above collapses them by printing `unknown` on a failed
  // call; this one does not, because the port maps exit 3 to `failed`.
  const stubs = makeHeaderStub({ fail: 'error connecting to api.github.com: 503' });
  const res = runAllowFail(['limit'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.code, 3);
  assert.equal(res.stdout.trim(), '', 'a failed call must not print a reading');
});

test('host: limit answers bitbucket from experience, tagged predicted', () => {
  // Bitbucket meters and sends no `X-RateLimit-*`. A PREDICTION IS NOT A
  // FAILURE — the adapter is telling the truth about what it knows, and a
  // caller reads the basis to decide how much to trust it.
  const stubs = makeStubs();
  const out = JSON.parse(run(['limit'], { env: { PLOT_HOST: 'bitbucket' }, stubs }).trim());
  assert.equal(out.connector, 'bitbucket');
  assert.equal(out.basis, 'predicted');
  assert.ok(out.limit > 0, 'a prediction carries a ceiling');
  assert.equal(out.remaining, null, 'a connector reporting no limit reports no spend either');
  assert.equal(argvOf(stubs.bbArgv), null, 'bb has nothing to answer — do not ask it');
});

test('host: ci-limit answers jenkins predicted, and it is a separate axis', () => {
  // CI does not follow the git host: this repo is GitHub + Actions, `ekzweb` is
  // Bitbucket + Jenkins. Jenkins reports no rate limit at all, which is the
  // `predicted` case the design names.
  const stubs = makeStubs();
  const out = JSON.parse(
    run(['ci-limit'], { env: { PLOT_HOST: 'github', PLOT_CI: 'jenkins' }, stubs }).trim(),
  );
  assert.equal(out.connector, 'jenkins');
  assert.equal(out.basis, 'predicted');
  assert.ok(out.limit > 0);
});

test('host: ci-limit reports a connector it has no estimate for as unknown', () => {
  // The list is OPEN — GitLab and Trello are named as next — so nothing here
  // validates the name. A connector nobody has written an estimate for answers
  // `unknown`, which is the honest word and not a default borrowed from GitHub.
  const stubs = makeStubs();
  const out = JSON.parse(
    run(['ci-limit'], { env: { PLOT_HOST: 'github', PLOT_CI: 'gitlab' }, stubs }).trim(),
  );
  assert.equal(out.connector, 'gitlab');
  assert.equal(out.basis, 'unknown');
  assert.equal(out.limit, null);
});

test('host: ci-limit prints nothing where no CI connector is configured', () => {
  // Nothing to meter. An EMPTY answer, not a limit of zero — and the caller can
  // tell the two apart because one is no line and the other is a number.
  const stubs = makeStubs();
  const out = run(['ci-limit'], { env: { PLOT_HOST: 'github', PLOT_CI: 'none' }, stubs });
  assert.equal(out.trim(), '');
});

// ── one router chooses the path ─────────────────────────────────────────────
//
// `gh_route` is the one place that decides REST versus GraphQL for the GitHub
// connector. The tests below are of two kinds, and the split is deliberate.
//
// The BEHAVIOURAL ones assert the route by what the stub was called with,
// because that is the only thing a caller could observe and the only thing
// that matters. Asserting the function's stdout would test an internal.
//
// The STRUCTURAL one is the Done-when the plan words as *"asserted by there
// being one implementation, not by review"* — so it greps the source. That is
// an unusual test and it earns its place: a reviewer can be convinced that a
// second decision site is fine, and this cannot be.

test('host: the cheap path is the default — a full budget routes to GraphQL', () => {
  // THE REGRESSION THIS GUARDS. Gathering the decision into a router is the
  // kind of change that flips a default by accident, and the flip is expensive
  // rather than wrong-looking: ~186 REST calls against one GraphQL call for a
  // 93-branch scan. So the default is pinned by the call that was made.
  const stubs = makeStubsRateAware({
    graphqlRemaining: 5000,
    graphqlJson: JSON.stringify({
      number: 7, state: 'OPEN', isDraft: false,
      url: 'https://example.test/pr/7', mergeCommit: { oid: '' },
    }),
  });
  run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs });
  const calls = callsOf(stubs.callsFile);
  assert.ok(calls.some((c) => c.startsWith('pr view')), 'GraphQL is the default route');
  assert.ok(
    !calls.some((c) => c.startsWith('api repos/')),
    'a full budget must not reach the REST path',
  );
});

test('host: PLOT_HOST_FORCE_REST routes without reading the budget', () => {
  // The re-entry after a rate refusal sets this, and the budget read it skips
  // is the point: the caller already knows GraphQL was refused, so asking
  // `rate_limit` whether it might work is a call spent to learn nothing.
  const stubs = makeStubsRateAware({
    restJson: JSON.stringify({
      number: 7, state: 'open', draft: false,
      html_url: 'https://example.test/pr/7', merged: false, merge_commit_sha: null,
    }),
  });
  const out = JSON.parse(run(['pr-state', '7'], {
    env: { PLOT_HOST: 'github', PLOT_HOST_FORCE_REST: '1' },
    stubs,
  }));
  assert.equal(out.state, 'OPEN');
  const calls = callsOf(stubs.callsFile);
  assert.ok(calls.some((c) => c.startsWith('api repos/')), 'forced onto REST');
  assert.ok(
    !calls.some((c) => c === 'api rate_limit'),
    'a route already decided asks no budget',
  );
});

test('host: a GraphQL-only op stays on GraphQL even under PLOT_HOST_FORCE_REST', () => {
  // THE ROUTER ANSWERS FOR WHAT THIS SCRIPT HAS, NOT FOR WHAT GITHUB OFFERS.
  // GitHub serves `pr list` over REST perfectly well; this script has not
  // written that path. Answering `rest` for `pr-merged` would name a route
  // that does not exist, and the op would then either take the GraphQL path
  // anyway — making the router decorative — or fail.
  //
  // So the honest answer is `graphql`, and the force switch does not move it.
  // Writing the missing REST paths is new capability and belongs to no slice
  // in this plan.
  const stubs = makeStubsRateAware({
    graphqlRemaining: 0,
    graphqlJson: JSON.stringify([{ mergedAt: '2026-09-01T00:00:00Z' }]),
  });
  const out = run(['pr-merged', 'some-branch'], {
    env: { PLOT_HOST: 'github', PLOT_HOST_FORCE_REST: '1' },
    stubs,
  });
  assert.equal(out.trim(), 'merged');
  const calls = callsOf(stubs.callsFile);
  assert.ok(calls.some((c) => c.startsWith('pr list')), 'the only route it has');
});

test('host: a GraphQL-only op spends no budget read to be routed', () => {
  // Consulting the router must not cost anything for the ten ops that cannot
  // act on the answer. The router's `pr-state` arm reads `rate_limit`; every
  // other arm returns without asking, and this pins that — otherwise
  // "every op consults the router" would have added a call per op to a script
  // whose whole subject is spending fewer of them.
  const stubs = makeStubsRateAware({
    graphqlJson: JSON.stringify([{ mergedAt: null }]),
  });
  run(['pr-merged', 'some-branch'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.ok(
    !callsOf(stubs.callsFile).some((c) => c === 'api rate_limit'),
    'routing an op with one transport reads no budget',
  );
});

test('host: bitbucket never reaches the router', () => {
  // ONE ROUTER PER CONNECTOR. REST-versus-GraphQL is a GitHub distinction, and
  // a Bitbucket run must not read a GitHub budget to be told there is no fork.
  // The assertion is that `gh` was never invoked at all.
  const stubs = makeStubs({
    bbJson: '{"id":7,"state":"OPEN","draft":false,"links":{"html":{"href":"https://example.test/pr/7"}}}',
  });
  run(['pr-state', '7'], { env: { PLOT_HOST: 'bitbucket' }, stubs });
  assert.equal(argvOf(stubs.ghArgv), null, 'a bitbucket run asks gh nothing');
});

test('host: no caller learns which transport ran', () => {
  // The plan settles that the transport is the connector's business. Both
  // routes must therefore produce the same payload, field for field — a
  // difference of even one key would let a caller detect the route and start
  // depending on it.
  const graphql = makeStubsRateAware({
    graphqlRemaining: 5000,
    graphqlJson: JSON.stringify({
      number: 7, state: 'MERGED', isDraft: false,
      url: 'https://example.test/pr/7', mergeCommit: { oid: 'abc123' },
    }),
  });
  const rest = makeStubsRateAware({
    graphqlRemaining: 0,
    restJson: JSON.stringify({
      number: 7, state: 'closed', draft: false,
      html_url: 'https://example.test/pr/7', merged: true, merge_commit_sha: 'abc123',
    }),
  });
  const viaGraphql = run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs: graphql });
  const viaRest = run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs: rest });
  assert.deepEqual(JSON.parse(viaGraphql), JSON.parse(viaRest));
  // And nothing names the route. `MERGED` is the vocabulary both must speak —
  // REST says `closed` with the merge in a separate field, and an adapter that
  // merely uppercased `.state` would report a merged PR as CLOSED.
  assert.equal(JSON.parse(viaRest).state, 'MERGED');
  assert.doesNotMatch(viaRest, /rest|graphql/i, 'the route never reaches stdout');
});

// THE STRUCTURAL ASSERTION. The plan's Done-when is *"every op consults the
// router, and no op re-derives the choice… asserted by there being one
// implementation, not by review"*. A behavioural test cannot say that: it can
// prove the route taken on the paths it exercises and says nothing about a
// second decision site on a path it does not.
//
// So this reads the source. Two facts, and both are countable:
//
//   `graphql_budget_spent` is CALLED once   — one budget consultation
//   `PLOT_HOST_FORCE_REST` is READ once     — one override consultation
//
// Both counts are of the router's own body. The re-entry at the bottom of
// `pr-state` SETS the variable for a child process, which is not a read and
// not a decision — it is how the second path is reached without a second copy
// of the REST code.
test('host: exactly one site decides the route', () => {
  const src = readFileSync(adapter, 'utf8');
  // Comments carry the argument for the design and mention both names
  // repeatedly; stripping them is what makes the count a count of CODE.
  const code = src
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  const budgetCalls = code.match(/(?<![\w-])graphql_budget_spent(?!\(\))/g) ?? [];
  assert.equal(
    budgetCalls.length, 1,
    `the budget is consulted at one site; found ${budgetCalls.length}`,
  );

  const forceReads = code.match(/\$\{PLOT_HOST_FORCE_REST[^}]*\}/g) ?? [];
  assert.equal(
    forceReads.length, 1,
    `the override is read at one site; found ${forceReads.length}`,
  );

  // And both live inside `gh_route`. A single site in the wrong function would
  // satisfy the counts above and defeat the purpose.
  const router = code.slice(code.indexOf('gh_route() {'));
  const routerBody = router.slice(0, router.indexOf('\n}\n') + 3);
  assert.ok(routerBody.includes('graphql_budget_spent'), 'the budget read is in the router');
  assert.ok(routerBody.includes('PLOT_HOST_FORCE_REST'), 'the override read is in the router');
});
