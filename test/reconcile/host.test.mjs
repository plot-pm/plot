// Contract test for skills/plot/scripts/plot-host.sh — the Git-host adapter.
// Uses PATH-stubbed gh/bb executables: each stub records its argv and emits
// canned JSON, so the tests pin (a) backend resolution and (b) the exact
// argument mapping + output normalization per backend, fully offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
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
// A STATE MAY ALSO FAIL, which is the shape #912 is made of. `bb pr list` has
// no `all` state, so the adapter calls once per state and some calls can fail
// while others answer — a partial answer, which no single-call host can
// produce. A `perState` value may therefore be either a payload string or
// `{ fail: '<stderr text>', code: N }`, so a test can say *this state throttled
// and the others answered* without a second stub.
function makeStrictBbStub({ json = '[]', perState = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-bb-'));
  const callsFile = path.join(dir, 'bb.calls');
  const quote = (s) => s.replace(/'/g, `'\\''`);
  const cases = perState
    ? Object.entries(perState)
        .map(([s, v]) =>
          typeof v === 'object' && v !== null && v.fail !== undefined
            ? `    ${s}) echo '${quote(v.fail)}' >&2; exit ${v.code ?? 1} ;;`
            : `    ${s}) printf '%s' '${quote(v)}' ;;`)
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

test('host: backend infers the host from the remote when nothing declares one', () => {
  // THE KEY IS A DECLARATION AND THE REMOTE IS EVIDENCE. `Git host` still wins;
  // this covers only the case where nobody said, which answered `github`
  // unconditionally until 2026-09-11 — so a Bitbucket repository that forgot
  // the key got GitHub's answer.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-remote-'));
  execFileSync('git', ['init', '-q', '.'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', 'git@bitbucket.org:x/y.git'], { cwd: dir });
  const out = execFileSync('bash', [adapter, 'backend'], { cwd: dir, encoding: 'utf8' });
  assert.equal(out.trim(), 'bitbucket');
  rmSync(dir, { recursive: true, force: true });
});

test('host: backend says so when nothing names a host', () => {
  // IT REPORTS AND DOES NOT REFUSE, and that is a measurement rather than a
  // preference. An earlier version exited 4 here and five contract tests went
  // red: a sandbox repository with no remote is a legitimate, common shape —
  // six suites build one — and every op needing a host in such a repo was
  // relying on this default. Refusing at the resolver punishes a caller for a
  // question it never asked.
  //
  // WHAT CHANGES IS THAT THE GUESS STOPS BEING SILENT. The value is still
  // usable so the exit stays 0; the provenance is not certain, so it is said.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-noremote-'));
  execFileSync('git', ['init', '-q', '.'], { cwd: dir });
  const res = spawnSync('bash', [adapter, 'backend'], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 0, 'a caller that needs a host still gets one');
  assert.equal(res.stdout.trim(), 'github');
  assert.match(res.stderr, /no 'Git host' key and no remote names one/,
    'the guess announces itself');
  rmSync(dir, { recursive: true, force: true });
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

// AN ABSENT CLI IS A TRANSPORT FAILURE WEARING A MISS'S WORDS. The shell says
// `bash: gh: command not found` when the binary is gone, and `is_lookup_miss`
// matched that on its bare `not found` alternative — so `pr-merged` answered
// `not-merged` where `plot-pr-merged.sh` answered `unaskable` about the same
// branch. Measured 2026-09-06 with `gh` off PATH.
//
// The DIRECTION is why it matters: `not-merged` reads to `rules/landed.ts` as
// `none` — the host spoke and said nothing merged — so `mayRemove` may permit a
// removal, where `unaskable` refuses. `plot-release-refs.sh` deletes remote refs
// on that answer and a deleted ref is not re-creatable.
test('host: an absent CLI is not a lookup miss', () => {
  const stubs = makeStubs({ ghFail: 'bash: gh: command not found' });
  const res = runAllowFail(['pr-merged', 'feature/nope'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(res.stdout.trim(), 'unknown', 'an absent binary cannot answer not-merged');
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
  assert.deepEqual(out, {
    number: 9, state: 'CLOSED', draft: false, url: 'https://example.test/pr/9', mergeCommit: '',
  });
});

// --- pr-state: both arms answer with the same KEY SET ----------------------
//
// `pr-state` was the one op whose Bitbucket arm dropped a key its GitHub arm
// emits: every GitHub path carried `mergeCommit`, all four Bitbucket paths
// omitted it. `plot-reconcile-scan.sh` reads it as `.mergeCommit // empty`, and
// `jq` cannot tell an ABSENT key from an empty one — so on Bitbucket every
// delivered plan reported `no merge commit → cannot resolve`, which reads as a
// host that answered rather than an arm that never asked.
//
// THE ASSERTION IS OVER KEYS, NOT VALUES. A value test has to be told that
// `mergeCommit` should be there, which is the knowledge that went missing in
// the first place; deriving the expectation from the GitHub arm is what stops
// the next added key from drifting the same way.

const keysOf = (json) => Object.keys(JSON.parse(json)).sort();

test('host: pr-state returns the same key set on both backends — merged PR', () => {
  const gh = makeStubs({
    ghJson: '{"number":7,"state":"MERGED","isDraft":false,"url":"https://example.test/pr/7",'
      + '"mergeCommit":{"oid":"abc1234"}}',
  });
  const bb = makeStubs({
    bbJson: '{"id":7,"state":"MERGED","links":{"html":{"href":"https://example.test/pr/7"}},'
      + '"merge_commit":{"hash":"def5678"}}',
  });
  const ghOut = run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs: gh });
  const bbOut = run(['pr-state', '7'], { env: { PLOT_HOST: 'bitbucket' }, stubs: bb });

  assert.deepEqual(keysOf(bbOut), keysOf(ghOut),
    'a caller reading .mergeCommit must not be able to tell the backends apart');
  assert.equal(JSON.parse(ghOut).mergeCommit, 'abc1234');
  assert.equal(JSON.parse(bbOut).mergeCommit, 'def5678',
    'Bitbucket names it merge_commit.hash, in the payload already fetched');
});

// The UNMERGED half of the contract: `""`, never absent and never null. This is
// the value `plot-reconcile-scan.sh` treats as "no merge commit" — the same
// word the GitHub arm gives for an open PR.
test('host: pr-state bitbucket gives mergeCommit "" for an unmerged PR', () => {
  const stubs = makeStubs({
    bbJson: '{"id":4,"state":"OPEN","links":{"html":{"href":"https://example.test/pr/4"}}}',
  });
  const out = JSON.parse(run(['pr-state', '4'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.equal(out.mergeCommit, '', 'an open PR has no merge commit, and says so with ""');
  assert.ok('mergeCommit' in out, 'the key is present even when the value is empty');
});

// The NUMERIC-MISS path. `host_miss_or_fail` prints a literal, and the literal
// is a fourth copy of the shape — so it gets its own assertion rather than
// riding on the success path's.
test('host: pr-state bitbucket numeric miss carries mergeCommit too', () => {
  const stubs = makeStubs({ bbFail: 'no pull requests found' });
  const res = runAllowFail(['pr-state', '9'], { env: { PLOT_HOST: 'bitbucket' }, stubs });
  assert.equal(res.code, 0);
  assert.deepEqual(JSON.parse(res.stdout), {
    number: 0, state: 'NONE', draft: false, url: '', mergeCommit: '',
  });
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
  assert.deepEqual(hit, {
    number: 4, state: 'OPEN', draft: false, url: 'https://example.test/pr/4', mergeCommit: '',
  });
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

// --- runs / run-for-sha: dispatched on the CI system ----------------------
//
// Both arms gated on `be` — the GIT HOST — until 2026-09-08. `CI` and
// `Git host` are independent `## Plot Config` keys, so that gate answered a
// question nobody asked: a Bitbucket team building on Jenkins got silence, and
// a GitHub team building on Jenkins got GitHub Actions runs for a repository
// whose CI is not GitHub Actions. These tests pin the dispatch, and pin that a
// backend with no arm exits 4 rather than printing an empty list.
//
// EVERY `runs` TEST NOW DECLARES `PLOT_CI`. That is the change of contract, not
// test noise: the op reads the CI key, and a repository that declares none is
// answering a different question from one whose CI holds no runs.

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
  const out = run(['runs', 'feature/x', '--limit', '2'],
    { env: { PLOT_HOST: 'github', PLOT_CI: 'github-actions' }, stubs })
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
  const out = JSON.parse(run(['runs', 'feature/x'],
    { env: { PLOT_HOST: 'github', PLOT_CI: 'github-actions' }, stubs }).trim());
  assert.equal(out.conclusion, 'in_progress');
});

test('host: runs matches a github-actions arm carrying a trailing note', () => {
  // ALL FOUR CALL SITES HAD THE BUG, not three. This arm matched a bare
  // `github-actions)` and missed `github-actions (see …)` exactly as the
  // Jenkins arms missed theirs — this repository escaped only because it writes
  // the word alone. So the GitHub arm moves with the others rather than being
  // left as the one that appeared to work.
  const stubs = makeStubs({
    ghJson: JSON.stringify([
      { workflowName: 'CI', conclusion: 'success', status: 'completed', startedAt: '2026-09-09T10:00:00Z', url: 'u1' },
    ]),
  });
  const out = JSON.parse(run(['runs', 'feature/x'], {
    env: { PLOT_HOST: 'github', PLOT_CI: 'github-actions (see .github/workflows/ci.yml)' },
    stubs,
  }).trim());
  assert.equal(out.conclusion, 'success');
  assert.ok(argvOf(stubs.ghArgv), 'the arm ran — gh was asked');
});

test('host: runs reaches the jenkins arm through a prose CI value', () => {
  // The Jenkins arm reports one state per branch as a history of one. What is
  // asserted here is that a prose `CI:` value REACHES it at all — before the
  // scheme split it fell past every arm and printed nothing, which reads as a
  // branch that has never run.
  const stubs = makeStubs();
  const res = runAllowFail(['runs', 'feature/x'], {
    env: {
      PLOT_HOST: 'github',
      PLOT_CI: 'Jenkins at `jenkins.example.com`',
      JENKINS_INSTANCE: '',
    },
    stubs,
  });
  assert.notEqual(res.code, 0, 'the jenkins arm was reached, and it refuses without an instance');
  assert.doesNotMatch(res.stderr, /github-actions/, 'it did not fall through to the GitHub arm');
});

test('host: run-for-sha reaches the jenkins arm through a prose CI value', () => {
  // THE CLAIM IS THE ROUTING, and it is unchanged: a prose `CI:` value must
  // still land in the jenkins arm. Falling past it would answer `null` — a
  // branch with no run for the sha, which is the guess this op exists to end.
  //
  // WHAT THE ARM SAYS CHANGED ON 2026-09-11, when it learned Jenkins' REST
  // route. This sandbox has no keychain credential for the stub host, so the
  // arm refuses on that — still exit 4, still *cannot be asked*, and still
  // proof the jenkins arm was the one reached.
  const stubs = makeStubs();
  const res = runAllowFail(['run-for-sha', 'feature/x', 'abc123'], {
    env: { PLOT_HOST: 'github', PLOT_CI: 'Jenkins (e.g. continuous-build, quaweb)' },
    stubs,
  });
  // ANY OF THE ARM'S OWN REFUSALS PROVES THE ROUTING, and which one fires
  // depends on how far the sandbox lets it get: no instance configured refuses
  // first, then a bare-host instance, then an absent keychain credential. The
  // github arm would answer `null` instead, which is what this guards against.
  assert.match(res.stderr, /no Jenkins instance is configured|names no job path|no Jenkins API credential/,
    'the jenkins arm was reached');
});

test('host: runs declaring github-actions on a bitbucket remote exits 4, never empty', () => {
  // THE SECOND CONDITION THE OLD GATE CONFLATED WITH THE FIRST. `gh run list`
  // reads the runs of the repository its remote names, so a repository that
  // declared `CI: github-actions` on a Bitbucket remote has named runs nothing
  // here can reach. That is unaskable — and the old arm printed nothing at
  // exit 0, which reads as *this branch has never failed before*.
  const stubs = makeStubs({ bbJson: '[]' });
  const res = runAllowFail(['runs', 'feature/x'],
    { env: { PLOT_HOST: 'bitbucket', PLOT_CI: 'github-actions' }, stubs });
  assert.equal(res.code, 4);
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /git host is 'bitbucket'/);
  assert.equal(argvOf(stubs.ghArgv), null, 'gh is not asked about a repository it cannot see');
});

// A repository that declares NO `CI` key at all. `PLOT_CI: ''` cannot express
// this: `ci_backend()` reads an empty override as *not set* and falls through to
// the config — which, run from this repo's own root, is this repo's `CI` key.
// Measured 2026-09-08: the two tests below passed until Plot declared its own,
// and then read `github-actions` from the checkout they were running in. The
// absence has to be a real repository saying nothing.
function makeNoCiRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), 'plot-host-nocI-'));
  writeFileSync(path.join(repo, 'CLAUDE.md'), '## Plot Config\n\n- **Git host:** github\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

const runInRepo = (args, { repo, stubs, env = {} }) => {
  const res = spawnSync('bash', [adapter, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, ...budgetEnvFor(stubs), ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
};

test('host: runs on a repository that declared no CI exits 4, not an empty list', () => {
  // NOT BEING ABLE TO ASK IS NOT AN EMPTY ANSWER. An empty run list means *this
  // branch has no runs*; a repository with no CI system has nothing that could
  // hold one. `resultOf` maps exit 4 onto `unaskable`, which is the word the
  // build port answers with — and `[]` would report *nothing has ever failed
  // here* about a question nobody asked.
  const stubs = makeStubs({ ghJson: '[]' });
  const res = runInRepo(['runs', 'feature/x'], { repo: makeNoCiRepo(), stubs, env: { PLOT_HOST: 'github' } });
  assert.equal(res.code, 4);
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /declares no CI system/);
  assert.equal(argvOf(stubs.ghArgv), null, 'the git host is not asked about a CI system nobody declared');
});

test('host: runs on CI none exits 4 the same way an absent key does', () => {
  // `none` is a repository saying explicitly what an absent key says by
  // omission. Both mean there is no build system to ask.
  const stubs = makeStubs({ ghJson: '[]' });
  const res = runAllowFail(['runs', 'feature/x'], { env: { PLOT_HOST: 'github', PLOT_CI: 'none' }, stubs });
  assert.equal(res.code, 4);
  assert.match(res.stderr, /declares no CI system/);
});

test('host: runs on a CI system with no connector exits 4 and names it', () => {
  // The line `ci-limit`'s `*)` arm already draws, one step earlier: that one
  // answers `unknown` for a connector nobody wrote an ESTIMATE for; this one
  // refuses for a connector that does not exist at all. GitLab is named next
  // in both places, so the list is open and neither validates it.
  const stubs = makeStubs({ ghJson: '[]' });
  const res = runAllowFail(['runs', 'feature/x'], { env: { PLOT_HOST: 'github', PLOT_CI: 'gitlab' }, stubs });
  assert.equal(res.code, 4);
  assert.match(res.stderr, /no connector for CI system 'gitlab'/);
  assert.equal(argvOf(stubs.ghArgv), null);
});

test('host: run-for-sha on a repository that declared no CI exits 4', () => {
  // The same rule as `runs`, and it matters more here: the BuildMonitor polls
  // this op, and empty output at exit 0 is its healthy *the run has not been
  // created yet* signal. A repository with no CI answering that would poll
  // forever waiting for a build nothing will start.
  const stubs = makeStubs({ ghJson: '[]' });
  const res = runInRepo(['run-for-sha', 'feature/x', 'abc123'],
    { repo: makeNoCiRepo(), stubs, env: { PLOT_HOST: 'github' } });
  assert.equal(res.code, 4);
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /declares no CI system/);
});

test('host: run-for-sha reads github-actions runs when the CI key names it', () => {
  // The unchanged half: a repository that declares github-actions on a GitHub
  // remote gets exactly today's answer, through the same `gh` call.
  const stubs = makeStubs({
    ghJson: JSON.stringify([
      { headSha: 'abc123', conclusion: 'failure', status: 'completed', startedAt: '2026-09-08T10:00:00Z', url: 'u1' },
    ]),
  });
  const out = JSON.parse(run(['run-for-sha', 'feature/x', 'abc123'],
    { env: { PLOT_HOST: 'github', PLOT_CI: 'github-actions' }, stubs }).trim());
  assert.equal(out.sha, 'abc123');
  assert.equal(out.conclusion, 'failure');
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

// ── A PARTIAL ANSWER IS NOT AN OUTAGE (#912) ─────────────────────────────────
//
// `bb pr list` has no `all` state, so the arm calls once per state and prints
// each state's rows as it goes. Until now the first failure left through
// `|| exit $?` AFTER the earlier rows were on stdout, and the transport threw
// them away on the non-zero code. An operator on `quaweb-website` saw nine
// branches labelled `commits, no PR ever opened`, two of them with live PRs.
//
// GITHUB CANNOT REACH THIS SHAPE and is pinned separately below: `--state all`
// goes to `gh` in one call, so a failure there means nothing was printed.

/** The exit code for an answer that is incomplete rather than absent. */
const PARTIAL_RC = 7;

const runPrList = (bb, args = ['pr-list', '--state', 'all']) =>
  spawnSync('bash', [adapter, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });

test('host: pr-list keeps the states that answered when one fails, and exits partial', () => {
  const bb = makeStrictBbStub({
    perState: {
      open: '[{"id":358,"title":"O","state":"OPEN","source":{"branch":{"name":"feature/o"}}}]',
      merged: '[{"id":300,"title":"M","state":"MERGED","source":{"branch":{"name":"feature/m"}}}]',
      declined: { fail: 'API rate limit exceeded for this account', code: 1 },
    },
  });
  const r = runPrList(bb);

  // THE ROWS SURVIVE. This is the whole defect: they were already on stdout and
  // the exit code threw them away.
  const rows = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => x.number).sort(), [300, 358],
    'the states that answered were discarded with the one that did not');

  // NOT 0, AND THAT IS LOAD-BEARING. `plot-fleet-scan.sh` reads this code
  // directly and branches on `rc -ne 0`; exiting 0 would report a complete
  // reading over a page missing a whole state, and would re-create the silent
  // empty list fixed on 2026-08-30.
  assert.equal(r.status, PARTIAL_RC, 'a partial answer must have its own code');
  assert.notEqual(r.status, 0, 'exiting 0 makes every existing reader report ok');
  for (const taken of [3, 4, 5, 6]) {
    assert.notEqual(r.status, taken,
      `${taken} already means something else, so a partial answer cannot reuse it`);
  }

  // NAMED, NEVER SILENT. A short list with no reason given is the quiet wrong
  // answer in a new place.
  assert.match(r.stderr, /declined/, 'the failed state is not named');

  // THE HOST'S REASON COMES FIRST. A reader acts on WHY the state failed; the
  // bookkeeping of WHICH one is context for it. Caught by the contract suite
  // 2026-09-18: an earlier draft printed `state 'open' failed` ahead of the
  // host's sentence, and `plot-reconcile-scan.sh` — which reads the first
  // stderr line into its error field — showed that instead of `HTTP 429`.
  // A message describing the wrong thing is #912's own failure mode.
  const firstLine = r.stderr.trim().split('\n')[0];
  assert.match(firstLine, /rate limit/i,
    'the host’s reason was buried under this helper’s own bookkeeping');
});

test('host: pr-list where NO state answers keeps the code it has today, by kind', () => {
  // A TOTAL OUTAGE MUST NOT READ AS A PARTIAL PAGE — #912 inverted. This
  // catches an implementation that turns every Bitbucket failure into the
  // partial code, which would tell a reader that some rows arrived when none
  // did.
  for (const [text, code] of [
    ['API rate limit exceeded for this account', 5],
    ['You have exceeded a secondary rate limit', 6],
    ['could not resolve host: api.bitbucket.org', 3],
  ]) {
    const bb = makeStrictBbStub({
      perState: {
        open: { fail: text, code: 1 },
        merged: { fail: text, code: 1 },
        declined: { fail: text, code: 1 },
      },
    });
    const r = runPrList(bb);
    assert.equal(r.status, code, `"${text}" must still exit ${code}`);
    assert.notEqual(r.status, PARTIAL_RC,
      'a run where nothing answered reported a partial answer');
    assert.equal(r.stdout.trim(), '', 'no state answered, so there are no rows');
  }
});

test('host: a single-state pr-list that fails is a failure, never a partial answer', () => {
  // THERE IS NO PARTIAL ANSWER WHEN ONE STATE WAS ASKED. Catches an
  // implementation keyed on "the loop ended" rather than on "some answered and
  // some did not".
  const bb = makeStrictBbStub({
    perState: { open: { fail: 'could not resolve host: api.bitbucket.org', code: 1 } },
  });
  const r = runPrList(bb, ['pr-list', '--state', 'open']);
  assert.equal(r.status, 3, 'one asked state that failed is a plain failure');
  assert.notEqual(r.status, PARTIAL_RC, 'a single state cannot answer partially');
  assert.notEqual(r.status, 0, 'a failed list must never exit 0');
});

test('host: every state answering still exits 0, with no partial verdict', () => {
  const bb = makeStrictBbStub({
    perState: {
      open: '[{"id":1,"title":"O","state":"OPEN","source":{"branch":{"name":"feature/o"}}}]',
      merged: '[]',
      declined: '[]',
    },
  });
  const r = runPrList(bb);
  assert.equal(r.status, 0, 'a whole answer is not partial, empty states included');
  assert.doesNotMatch(r.stderr, /missing:/, 'nothing was missing');
});

test('host: the GitHub arm makes ONE call and cannot answer partially', () => {
  // PINNED BECAUSE THE FIX MUST NOT REACH IT. `--state all` is passed straight
  // through to `gh`, so a failure there means nothing was printed and there is
  // no partial answer to express. This catches a refactor that hoisted the
  // collection logic across the backend branch.
  const stubs = makeStubs({ ghFail: 'could not resolve host: api.github.com' });
  const r = spawnSync('bash', [adapter, 'pr-list', '--state', 'all'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.equal(r.status, 3, 'the GitHub arm gained a partial code it cannot produce');
  assert.notEqual(r.status, PARTIAL_RC, 'a single-call host answered partially');
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

// --- the BRANCH arm carries mergeCommit as well ----------------------------
//
// THE BRANCH ARM IS A LIVE CONSUMER PATH, not tidiness. `plot-pr-state.sh:33`
// calls `pr-state "idea/${SLUG}"` — a branch, not a number — and `:47` reads
// `.mergeCommit // empty` from the answer. A fix touching only the numeric pair
// leaves that caller reading an absent key on every Bitbucket repository.

test('host: pr-state by branch carries the merge commit on bitbucket', () => {
  const bb = makeStrictBbStub({
    perState: {
      open: '[]',
      merged: '[{"id":9,"state":"MERGED","source":{"branch":{"name":"idea/a-plan"}},'
        + '"links":{"html":{"href":"https://example.test/pr/9"}},'
        + '"merge_commit":{"hash":"0f1e2d3"}}]',
    },
  });
  const out = JSON.parse(execFileSync('bash', [adapter, 'pr-state', 'idea/a-plan'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  }));
  assert.equal(out.state, 'MERGED');
  assert.equal(out.mergeCommit, '0f1e2d3');
  // The hash comes from the page already fetched. A second `bb` invocation to
  // re-ask for it would double the cost of a call measured at ~10s.
  assert.equal(callsOf(bb.callsFile).length, 2,
    'open then merged — and no third call to fetch the hash');
});

// The branch arm's NONE literal is the fourth copy of the shape, and the one
// furthest from the GitHub arm that defines it.
test('host: pr-state branch NONE carries mergeCommit on bitbucket', () => {
  const bb = makeStrictBbStub({ json: '[]' });
  const out = JSON.parse(execFileSync('bash', [adapter, 'pr-state', 'feature/nope'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  }));
  assert.deepEqual(out, {
    number: 0, state: 'NONE', draft: false, url: '', mergeCommit: '',
  });
});

// An OPEN PR found by branch: present and empty, like every other unmerged
// answer. `merge_commit` is absent from Bitbucket's payload here, so this pins
// that the `// ""` fallback is doing the work rather than a null leaking out.
test('host: pr-state branch gives "" for an open PR on bitbucket', () => {
  const bb = makeStrictBbStub({
    perState: {
      open: '[{"id":4,"state":"OPEN","source":{"branch":{"name":"feature/a"}},'
        + '"links":{"html":{"href":"https://example.test/pr/4"}}}]',
    },
  });
  const out = JSON.parse(execFileSync('bash', [adapter, 'pr-state', 'feature/a'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  }));
  assert.equal(out.mergeCommit, '');
  assert.notEqual(out.mergeCommit, null, 'a null would reach jq as absent does');
});

// --- issue-list github: the status is DERIVED from the state asked for -----
//
// GitHub has no workflow states — an issue is open or closed — and this op asks
// for open ones only. So the answer is the state the call already passes, read
// once by both the flag and the projection. A second literal would be a copy
// that a widened filter silently outdates, which is the whole reason the plan
// asked for a derivation rather than a hardcoded `To Do`.

test('host: issue-list github derives status from the --state it asks for', () => {
  const stubs = makeStubs({
    ghJson: JSON.stringify([
      { number: 226, title: 'The board tells the truth', url: 'https://example.test/issues/226', createdAt: '2026-08-20T09:00:00Z' },
    ]),
  });
  const res = spawnSync('bash', [adapter, 'issue-list'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.equal(res.status, 0, res.stderr);
  const row = JSON.parse(res.stdout.trim());
  assert.deepEqual(row, {
    number: 226, title: 'The board tells the truth',
    url: 'https://example.test/issues/226', createdAt: '2026-08-20T09:00:00Z',
    status: 'open', statusCategory: 'To Do',
  });
  // The projected status is the SAME word the call passed to `gh`, which is
  // what makes it derived rather than assumed.
  const argv = readFileSync(stubs.ghArgv, 'utf8').split('\n');
  const stateFlag = argv[argv.indexOf('--state') + 1];
  assert.equal(stateFlag, row.status);
});

test('host: issue-list github asks gh for no tracker state beyond what it projects', () => {
  // The same refusal the Jira arm asserts, on the backend that makes it
  // cheapest to breach: `--json assignees,labels` is one word away.
  const stubs = makeStubs({ ghJson: '[]' });
  spawnSync('bash', [adapter, 'issue-list'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  const argv = readFileSync(stubs.ghArgv, 'utf8').split('\n');
  const json = argv[argv.indexOf('--json') + 1];
  assert.equal(json, 'number,title,url,createdAt');
  for (const refused of ['assignees', 'labels', 'priority', 'milestone']) {
    assert.ok(!json.includes(refused), `issue-list must not request ${refused}`);
  }
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

test('host: issue-list bitbucket emits the {number,title,url,createdAt,status,statusCategory} contract', () => {
  const stub = makeBbIssueStub({ out: BB_LIST_ANSI });
  const res = runBb(['issue-list'], stub);
  assert.equal(res.status, 0, res.stderr);
  const rows = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows, [
    { number: 3, title: 'Fix the login redirect loop', url: '', createdAt: '', status: 'OPEN', statusCategory: 'To Do' },
    // The title with "by" in it survives whole — split on three spaces, not " by ".
    { number: 17, title: 'Add dark mode by default', url: '', createdAt: '', status: 'NEW', statusCategory: 'To Do' },
  ]);
  // url and createdAt are "" on bitbucket: bb issue list prints neither.
  // `status` is NOT "": the badge was already parsed here to find where the
  // title starts, and was thrown away. Keeping it costs no extra call.
});

test('host: issue-list bitbucket maps each state badge, and refuses to invent a category', () => {
  // ON HOLD, INVALID, DUPLICATE and WONTFIX have no obvious category, and ""
  // is the honest answer. WONTFIX is the case that matters: it is terminal
  // WITHOUT being done, so filing it as `Done` would put abandoned work beside
  // finished work on a board that groups on the category.
  const badges = [
    ['NEW', 'To Do'], ['OPEN', 'To Do'],
    ['RESOLVED', 'Done'], ['CLOSED', 'Done'],
    ['ON HOLD', ''], ['INVALID', ''], ['DUPLICATE', ''], ['WONTFIX', ''],
  ];
  const lines = badges
    .map(([badge], i) => `#\\033[32m00${i + 1}\\033[0m \\033[48;5;12m ${badge} \\033[0m    Title ${i + 1}   \\033[38;5;242mby Alice\\033[0m`)
    .join('\\n');
  const stub = makeBbIssueStub({ out: `${lines}\\n` });
  const res = runBb(['issue-list'], stub);
  assert.equal(res.status, 0, res.stderr);
  const rows = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(
    rows.map((r) => [r.status, r.statusCategory]),
    badges,
  );
  // The title survives the badge lift in every case — including the two-word
  // `ON HOLD`, which a single-word match would leave half in the title.
  assert.deepEqual(rows.map((r) => r.title), badges.map((_, i) => `Title ${i + 1}`));
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
//
// IT TELLS `job list` FROM `job view`, AND IT DID NOT UNTIL 2026-09-15. The
// stub branched on `group == "job"` alone and never read the subcommand, so
// both verbs returned the same array — and an implementation calling NEITHER
// verb was indistinguishable from one calling both. Every assertion about which
// verb ran is worthless against a verb-blind stub, so this teaches it the
// difference before any such assertion is written.
//
// `viewJson` DEFAULTS TO THE MULTIBRANCH CONTAINER, because that is what every
// test written before the shape probe existed is implicitly about: those tests
// pass a `jobsJson` of branch children and expect the branch map, which is the
// multibranch path. A default of `null` would have routed all of them through
// the plain-job arm.
function makeJenStub({
  jobsJson = '[]',
  authReachable = true,
  jobListExit = 0,
  viewJson = JSON.stringify({
    _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject',
    name: 'continuous-build-multi',
  }),
} = {}) {
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
sub=""
while [ $# -gt 0 ]; do
  case "$1" in
    -I) shift 2 ;;
    --json) shift ;;
    *) group="$1"; shift; sub="\${1:-}"; break ;;
  esac
done
if [ "$group" = auth ]; then
  printf '%s\\n' 'Keycloak:      signed in'
  printf '%s\\n' '${authLine}'
  exit 0
fi
# THE SUBCOMMAND DECIDES, which is the whole point of this stub's 2026-09-15
# change. \`job view\` answers for the CONFIGURED job; \`job list\` answers with
# its children. A stub conflating them cannot witness which verb an
# implementation used.
if [ "$group" = job ] && [ "$sub" = view ]; then
  printf '%s' '${String(viewJson ?? '').replace(/'/g, `'\\''`)}'
  exit 0
fi
if [ "$group" = job ] && [ "$sub" = list ]; then
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

test('host: a Jenkins refresh costs a fixed number of calls, whatever the branch count', () => {
  // Done-when 5, free by the spike: a multibranch job returns every branch in
  // one `job list`. Joining locally means the scan pays for Jenkins once per
  // refresh, never once per branch on the 5s pulse.
  //
  // COUNTED ON TOTAL `jen` INVOCATIONS, AND IT WAS COUNTED ON `'job list'`
  // UNTIL 2026-09-15. That filter is blind to every other verb: a per-branch
  // `job view` storm — three branches here, and against Jenkins' declared limit
  // of 60 in the field — passed it while making one call per branch. The budget
  // is what this test is about, so the budget is what it counts.
  //
  // THE EXPECTED TOTAL IS FIXED RATHER THAN BOUNDED, so a fourth call has to be
  // justified here by whoever adds it. Three: `auth status`, the `job view`
  // that reads the shape, and the one `job list` that reads every branch.
  const repo = makeJenkinsRepo();
  const heads = ['feature/green', 'feature/red', 'feature/unstable'];
  const hostStubs = makeStubs({ ghJson: ghRowsFor(heads) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen });
  const calls = callsOf(jen.callsFile);
  assert.equal(calls.length, 3,
    `a refresh of ${heads.length} branches must cost 3 jen calls, not one per branch\n`
    + calls.join('\n'));
  assert.equal(calls.filter((c) => c.includes('job list')).length, 1,
    'exactly one job list, regardless of branch count');
  assert.equal(calls.filter((c) => c.includes('job view')).length, 1,
    'the shape is read once per refresh, never once per branch');
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
  const calls = callsOf(jen.callsFile);
  const jobCall = calls.find((c) => c.includes('job list'));
  assert.match(jobCall, /-I ci\.test\b/, 'the -I slug is the instance value up to the first /');
  assert.match(jobCall, /job list webbloqs\/continuous-build-multi/,
    'the job path is the remainder of the instance value');
  // THE SHAPE PROBE ASKS ABOUT THE SAME JOB. Two verbs reading one coordinate
  // differently is how a reader answers about a job nobody configured.
  const viewCall = calls.find((c) => c.includes('job view'));
  assert.match(viewCall, /-I ci\.test\b/, 'the shape probe takes the same -I slug');
  assert.match(viewCall, /job view webbloqs\/continuous-build-multi/,
    'and asks about the configured job itself, not about a child of it');
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
  // COUNTED ON EVERY `jen` CALL, not on `'job list'`. The claim is that the arm
  // is INERT, and an arm that probed a job's shape before noticing CI is not
  // Jenkins would satisfy a `'job list'` filter while still reaching the host.
  assert.deepEqual(callsOf(jen.callsFile), [],
    'jen is not called at all when CI is not jenkins');
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

// --- the job's SHAPE decides the verb ---------------------------------------
//
// `job list` enumerates a container's CHILDREN. A `WorkflowMultiBranchProject`
// has one child per branch, so listing it yields the branch map above; a plain
// `WorkflowJob` has no children, so the same call yields `null` and the
// `type=="array"` guard reported `failed` — the word for an unreachable host.
//
// MEASURED LIVE 2026-09-15 on `Quatico.Webseite/quaweb-website`:
//
//   jen job list quaweb/continuous-deploy --json  ->  null
//   jen job view quaweb/continuous-deploy --json  ->  color blue,
//                                                     lastBuild #938 SUCCESS
//
// A healthy, signed-in, correctly declared pipeline read as *the connector
// cannot be asked*, and `runs` turned that into exit 4, which the build port
// converts to `unaskable` with the retry signal deliberately discarded.

// THE PLAIN JOB'S `job view` PAYLOAD, CAPTURED VERBATIM.
//
// Raw `--json` stdout, not a two-field summary — the habit `plot-host.sh:741`
// already models for `jen auth status`. A summary would have had to assert that
// `color` and `lastBuild.result` agree, and they are not structurally
// consistent: `color` is the job's CURRENT state (it goes `blue_anime` while a
// build runs) and `lastBuild.result` is the LAST FINISHED build's verdict.
//
// Instance: jenkins.example.com, job quaweb/continuous-deploy.
// Captured 2026-09-15. Trimmed to the fields this reader touches, with the
// shape of the rest left intact.
const JEN_VIEW_PLAIN = JSON.stringify({
  _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob',
  name: 'continuous-deploy',
  fullName: 'quaweb/continuous-deploy',
  color: 'blue',
  lastBuild: { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowRun', number: 938, result: 'SUCCESS', duration: 453365 },
});

// The multibranch container's OWN `job view` payload — the object whose
// `_class` decides, one level up from the children `job list` returns.
const JEN_VIEW_MULTI = JSON.stringify({
  _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject',
  name: 'continuous-build-multi',
  fullName: 'webbloqs/continuous-build-multi',
});

test('host: a multibranch container whose children are all WorkflowJob is still read as multibranch', () => {
  // THE SINGLE MOST LIKELY DEFECT, AND IT IS INVISIBLE TO EVERY OTHER GATE.
  //
  // A child's `_class` describes the CHILD. Measured live, every child of the
  // multibranch `quaweb/continuous-build` carries `...job.WorkflowJob` — and
  // `JEN_JOBS` above, written long before this slice, gives all five children
  // exactly that. So an implementation reading `.[0]._class` off the listing it
  // already performs finds `WorkflowJob`, calls the plain job a plain job, and
  // breaks the CI half that works today.
  //
  // This test is that scenario exactly: children all `WorkflowJob`, container
  // `WorkflowMultiBranchProject`, and the branch map must still appear.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/green', 'feature/red']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS, viewJson: JEN_VIEW_MULTI });
  const rows = rowsByHead(runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen }));
  assert.equal(rows.get('feature/green').checks, 'green',
    'the container is multibranch however its children are classed');
  assert.equal(rows.get('feature/red').checks, 'failing',
    'and every branch still joins its own colour');
  assert.equal(callsOf(jen.callsFile).filter((c) => c.includes('job list')).length, 1,
    'the multibranch path still makes its one listing');
});

test('host: the shape is read with `job view`, and the verb is witnessed on jen.calls', () => {
  // ASSERTED BEHAVIOURALLY, NEVER BY A SOURCE GREP. `grep -c 'job view'` over
  // `plot-host.sh` is satisfied by a COMMENT — and this function now carries
  // several. `jen.calls` is the record of what actually ran.
  //
  // THE STUB HAD TO LEARN THE DIFFERENCE FIRST. Until 2026-09-15 `makeJenStub`
  // branched on `group == "job"` and never read the subcommand, so both verbs
  // returned the same array and this assertion could not have been trusted.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/green']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS, viewJson: JEN_VIEW_MULTI });
  runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen });
  const calls = callsOf(jen.callsFile);
  const view = calls.filter((c) => c.includes('job view'));
  assert.equal(view.length, 1, `exactly one shape probe ran\n${calls.join('\n')}`);
  assert.match(view[0], /job view webbloqs\/continuous-build-multi/,
    'it asks about the configured job, which is the only object whose _class decides');
});

test('host: the stub tells `job list` from `job view` — the gate under every verb assertion', () => {
  // A META-TEST, AND IT EARNS ITS PLACE. Every assertion about which verb ran
  // is worthless if the stub answers both the same way, and that is precisely
  // what it did until this slice. If this test fails, the verb assertions above
  // are not measuring anything — so the stub's discrimination is pinned
  // directly rather than trusted.
  const jen = makeJenStub({ jobsJson: JEN_JOBS, viewJson: JEN_VIEW_PLAIN });
  const run = (args) => execFileSync('bash', ['-c', `"$1" $2`, '_', path.join(jen.dir, 'jen'), args],
    { encoding: 'utf8' });
  const listed = run('-I ci.test job list some/path --json');
  const viewed = run('-I ci.test job view some/path --json');
  assert.notEqual(listed, viewed, 'a verb-blind stub cannot witness which verb ran');
  assert.equal(JSON.parse(listed).length, 5, '`job list` answers with the children');
  assert.equal(JSON.parse(viewed)._class,
    'org.jenkinsci.plugins.workflow.job.WorkflowJob',
    '`job view` answers with the configured job itself');
});

test('host: a plain WorkflowJob reports its real state instead of failed', () => {
  // THE DEFECT, FROM THE OPERATOR'S SIDE. This job is healthy — `color blue`,
  // `lastBuild #938 SUCCESS` — and Plot called it `failed`, which is the word
  // for a Jenkins nobody can reach.
  //
  // NO `job list` FOLLOWS. Listing a job with no children is what returned
  // `null` in the first place, so the plain arm must not make that call at all.
  const repo = makeJenkinsRepo({ instance: 'ci.test/quaweb/continuous-deploy' });
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['continuous-deploy']) });
  const jen = makeJenStub({ jobsJson: 'null', viewJson: JEN_VIEW_PLAIN });
  const rows = rowsByHead(runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen }));
  assert.equal(rows.get('continuous-deploy').checks, 'green',
    'a blue plain pipeline is green, not failed');
  const calls = callsOf(jen.callsFile);
  assert.equal(calls.filter((c) => c.includes('job view')).length, 1);
  assert.equal(calls.filter((c) => c.includes('job list')).length, 0,
    'a plain job has no children to list — that call is what returned null');
});

test('host: runs on a plain job emits a line rather than exiting 4', () => {
  // WITHOUT THIS GATE EVERY OTHER ONE CAN PASS WHILE THE PORT STILL ANSWERS
  // `unaskable`. `plot-host.sh` reads `.map[$branch]`, and a plain job has no
  // branch key at all — so a reader that fixed `jenkins_build_map` and left the
  // key shape alone would emit nothing here, exit 4, and
  // `build-shell.ts:130-145` would turn that into `unaskable` with
  // `refusal: null`, discarding the retry signal by design.
  //
  // The key is the job path's last segment, which is the name the instance
  // declares and the name a caller asks by.
  const repo = makeJenkinsRepo({ instance: 'ci.test/quaweb/continuous-deploy' });
  const hostStubs = makeStubs({ ghJson: '[]' });
  const jen = makeJenStub({ jobsJson: 'null', viewJson: JEN_VIEW_PLAIN });
  const res = runJenkinsAllowFail(['runs', 'continuous-deploy'], { repo, hostStubs, jen });
  assert.equal(res.code, 0, `a readable plain job must not exit 4\n${res.stderr}`);
  const row = JSON.parse(res.stdout.trim());
  assert.equal(row.conclusion, 'green', 'the state Jenkins reported, not a refusal');
  assert.equal(row.workflow, 'quaweb/continuous-deploy',
    'the job is named, because that is what a reader opens');
});

test('host: a shape nobody measured reports unknown, never failed', () => {
  // EXACTLY TWO SHAPES ARE READ, and the third answer is honest rather than
  // convenient. A `FreeStyleProject` HAS a `color` and would be readable — this
  // still reports `unknown` rather than guessing at it.
  //
  // `unknown` AND `failed` ARE DIFFERENT CLAIMS. `failed` says Jenkins did not
  // answer; here it answered clearly and said something this reader has never
  // been taught to read. Reporting that as `failed` is the same lie this slice
  // removes for plain jobs.
  const repo = makeJenkinsRepo({ instance: 'ci.test/quaweb/legacy' });
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['legacy']) });
  const jen = makeJenStub({
    jobsJson: 'null',
    viewJson: JSON.stringify({ _class: 'hudson.model.FreeStyleProject', name: 'legacy', color: 'blue' }),
  });
  const res = runJenkinsAllowFail(['pr-list', '--rich'], { repo, hostStubs, jen });
  assert.equal(res.code, 0, 'an unreadable shape must not blank the PR list');
  assert.equal(rowsByHead(res.stdout).get('legacy').checks, 'unknown',
    'a shape nobody measured is unknown — the host answered, and we cannot read it');
});

test('host: an unreachable Jenkins still reports failed, and never probes a shape', () => {
  // UNCHANGED BY THIS SLICE, and pinned because the shape probe sits near the
  // auth gate. Auth is decided FIRST: a Jenkins that cannot be reached must not
  // be asked what shape its jobs are, and `failed` remains the right word.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/green']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS, viewJson: JEN_VIEW_MULTI, authReachable: false });
  const res = runJenkinsAllowFail(['pr-list', '--rich'], { repo, hostStubs, jen });
  assert.equal(res.code, 0);
  assert.equal(rowsByHead(res.stdout).get('feature/green').checks, 'unknown',
    'rows degrade to unknown, as they always have');
  assert.deepEqual(callsOf(jen.callsFile).filter((c) => c.includes('job ')), [],
    'an unreachable Jenkins is asked no job question at all');
});

// THE MULTIBRANCH MAP, PINNED AS BYTES.
//
// Captured from `jenkins_build_map`'s own stdout on `origin/main` before this
// slice touched the function, driven by the `JEN_JOBS` fixture and the instance
// `ci.test/webbloqs/continuous-build-multi`. 572 bytes.
//
// A GOLDEN STRING RATHER THAN A FIXTURE COMPARISON, because "byte-identical" is
// a claim about bytes. A `deepEqual` over parsed JSON passes when the key order
// changes, when `jq -c`'s spacing changes, and when `from_entries` reorders the
// branches — none of which a consumer reading this payload with `sed` would
// survive, and `plot-host.sh` has such consumers.
const JENKINS_MAP_GOLDEN_MAIN = '{"status":"ok","map":{'
  + '"feature/green":{"color":"blue","checks":"green","job":"webbloqs/continuous-build-multi/feature/green"},'
  + '"feature/red":{"color":"red","checks":"failing","job":"webbloqs/continuous-build-multi/feature/red"},'
  + '"feature/unstable":{"color":"yellow","checks":"failing","job":"webbloqs/continuous-build-multi/feature/unstable"},'
  + '"feature/disabled":{"color":"disabled","checks":"none","job":"webbloqs/continuous-build-multi/feature/disabled"},'
  + '"feature/running":{"color":"blue_anime","checks":"pending","job":"webbloqs/continuous-build-multi/feature/running"}}}';

test('host: the multibranch branch map is byte-identical to origin/main', () => {
  // The slice's central promise: a plain job becomes readable and the half that
  // already worked does not move a byte.
  //
  // THE FUNCTION'S OWN STDOUT IS COMPARED, not a row that survived a join.
  // `plot-host.sh` has no sourced guard and dispatches on `$1`, so the function
  // is lifted out of the real source by `awk` and run alone. Reading the
  // SOURCE FILE is what makes this a gate: a copy of the function pasted into
  // this test would pass forever.
  const fnRunner = `
    set -uo pipefail
    awk '/^jenkins_build_map\\(\\) \\{/{f=1} f{print} f&&/^}$/{exit}' "$1" > "$2/fn.sh"
    . "$2/fn.sh"
    jenkins_build_map "$3"
  `;
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-golden-'));
  const jen = makeJenStub({ jobsJson: JEN_JOBS, viewJson: JEN_VIEW_MULTI });
  const out = execFileSync('bash',
    ['-c', fnRunner, '_', adapter, dir, 'ci.test/webbloqs/continuous-build-multi'],
    { encoding: 'utf8', env: { ...process.env, PATH: `${jen.dir}:${process.env.PATH}` } });

  // THE TRAILING NEWLINE IS PART OF THE CAPTURE and deliberately trimmed from
  // both sides: `printf`/`jq -c` end the payload with one, and a comparison
  // that included it would be asserting about the shell rather than about the
  // map.
  assert.equal(out.trimEnd(), JENKINS_MAP_GOLDEN_MAIN,
    'the multibranch payload must match origin/main byte for byte');
  // AND THE PROBE RAN, so this is the post-slice function rather than a copy of
  // the old one that would trivially match.
  assert.equal(callsOf(jen.callsFile).filter((c) => c.includes('job view')).length, 1,
    'the shape was probed — otherwise this asserts nothing about the new reader');
  rmSync(dir, { recursive: true, force: true });
});

test('host: a bare-host instance names no job, so no shape is probed', () => {
  // AN INSTANCE WITH NO JOB PATH HAS NOTHING TO VIEW. `job view` with an empty
  // path would ask about the instance rather than about a job, so the probe is
  // skipped and the root listing — the behaviour a bare-host instance has
  // always had — is what runs.
  const repo = makeJenkinsRepo({ instance: 'ci.test' });
  const hostStubs = makeStubs({ ghJson: ghRowsFor(['feature/green']) });
  const jen = makeJenStub({ jobsJson: JEN_JOBS, viewJson: JEN_VIEW_MULTI });
  const rows = rowsByHead(runJenkins(['pr-list', '--rich'], { repo, hostStubs, jen }));
  assert.equal(rows.get('feature/green').checks, 'green',
    'the root listing still joins, exactly as before');
  assert.deepEqual(callsOf(jen.callsFile).filter((c) => c.includes('job view')), [],
    'there is no job to view, so no shape probe is made');
});

// --- runs / run-for-sha: the Jenkins arms -----------------------------------
//
// A Jenkins repository asking for runs reached `gh` or nothing until
// 2026-09-08 — the connector had nothing to call. These pin what it reaches
// now, and what it honestly cannot answer yet.

test('host: runs on a Jenkins repository reaches jenkins_build_map, never gh', () => {
  // Done-when 2. `gh` is not asked at all: a repository whose CI is Jenkins has
  // no GitHub Actions run to report, and a GitHub answer here would be about a
  // pipeline that does not build this code.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: '[]' });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const out = runJenkins(['runs', 'feature/red'], { repo, hostStubs, jen });
  const row = JSON.parse(out.trim());
  assert.equal(row.conclusion, 'failing', "Jenkins red is the map's own word");
  assert.equal(row.workflow, 'webbloqs/continuous-build-multi/feature/red',
    'the job is named, because that is what a reader opens');
  assert.equal(argvOf(hostStubs.ghArgv), null, 'gh is never asked about a Jenkins pipeline');
  // COUNTED ON TOTAL `jen` INVOCATIONS — `runs` pays the same fixed price
  // `pr-list --rich` pays, and a filter on `'job list'` could not see a second
  // verb being added per branch.
  const runsCalls = callsOf(jen.callsFile);
  assert.equal(runsCalls.length, 3,
    `runs costs the same 3 jen calls pr-list --rich costs\n${runsCalls.join('\n')}`);
  assert.equal(runsCalls.filter((c) => c.includes('job list')).length, 1,
    'one call, the same one pr-list --rich makes');
});

test('host: runs on Jenkins leaves startedAt and url empty rather than inventing them', () => {
  // ONE STATE REPORTED AS A HISTORY OF ONE, and the empty fields are the honest
  // shape of it. `jen job list` carries no timestamp and no build URL; a
  // timestamp this arm made up would read to every caller as a measurement.
  // Jenkins HAS a history and a URL per build, over its REST API — reading them
  // is the connector slice's, not this one's.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: '[]' });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const row = JSON.parse(runJenkins(['runs', 'feature/green'], { repo, hostStubs, jen }).trim());
  assert.equal(row.conclusion, 'green');
  assert.equal(row.startedAt, '');
  assert.equal(row.url, '');
});

test('host: runs on Jenkins reports nothing for a branch the job does not build', () => {
  // A branch Jenkins holds no job for HAS no run, and that is an answer rather
  // than a refusal — the same distinction `runs` draws everywhere. Exit 0,
  // empty: the pipeline was asked and it has nothing for this branch.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: '[]' });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const res = runJenkinsAllowFail(['runs', 'feature/never-built'], { repo, hostStubs, jen });
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '');
});

test('host: runs on an unreachable Jenkins exits 4 rather than printing nothing', () => {
  // UNREACHABLE IS NOT EMPTY EITHER, and this op has no row to carry the word.
  // `pr-list --rich` can mark its rows `unknown` and keep them; here the exit
  // code is the only way to say *cannot verify*, and exit 0 with no output
  // would read as *this branch has never run*.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: '[]' });
  const jen = makeJenStub({ jobsJson: JEN_JOBS, authReachable: false });
  const res = runJenkinsAllowFail(['runs', 'feature/red'], { repo, hostStubs, jen });
  assert.equal(res.code, 4);
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /jenkins unreachable/);
});

test('host: runs on Jenkins with no instance configured exits 3, naming the three repairs', () => {
  // EXIT 3, NOT 4, and the difference is which person acts. A `CI: jenkins`
  // repository CAN be asked about builds — it has simply not said where, and
  // that is a config error one person fixes. Exit 4 would report it as a
  // standing absence and nobody would look.
  const repo = makeJenkinsRepo();
  writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Git host:** github\n- **CI:** jenkins\n');
  const hostStubs = makeStubs({ ghJson: '[]' });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const res = runJenkinsAllowFail(['runs', 'feature/red'],
    { repo, hostStubs, jen, extraEnv: { JENKINS_INSTANCE: '' } });
  assert.equal(res.code, 3);
  assert.match(res.stderr, /Jenkins instance/);
  assert.match(res.stderr, /JENKINS_INSTANCE/);
});

test('host: run-for-sha on Jenkins without a credential exits 4, never empty', () => {
  // THIS TEST ASSERTED `names no commit` UNTIL 2026-09-11. That refusal was
  // honest for the transport it had — `jen` carries no sha — and what changed
  // is the transport: `plot-host.sh` now reads Jenkins' REST API at
  // `actions[].lastBuiltRevision.SHA1`.
  //
  // THE PROPERTY WORTH KEEPING IS THE DIRECTION OF THE FAILURE. Jenkins' REST
  // API takes basic auth with an API token from the login keychain, which this
  // sandbox has none of — and an absent credential must answer *cannot be
  // asked*, never *this branch has no run for the sha*. Silence at exit 0 is
  // the one answer that would cost a merge.
  const repo = makeJenkinsRepo();
  const hostStubs = makeStubs({ ghJson: '[]' });
  const jen = makeJenStub({ jobsJson: JEN_JOBS });
  const res = runJenkinsAllowFail(['run-for-sha', 'feature/red', 'abc123'], { repo, hostStubs, jen });
  assert.equal(res.code, 4);
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /no Jenkins API credential|names no job path/);
  // COUNTED ON EVERY `jen` CALL. `run-for-sha` reaches Jenkins by curl against
  // REST, so it must reach `jen` by no verb at all — a `job view` here would be
  // the shape probe leaking into a path the plan scoped out explicitly.
  assert.deepEqual(callsOf(jen.callsFile), [],
    'the sha route does not go through `jen` at all, which carries no commit');
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

// The measured shape, status block included. `Internal Approving` is a REAL
// instance's workflow word and the reason two fields exist: it is not in any
// three-value vocabulary, so a board grouping on the name alone fragments
// across projects that spell one stage differently.
const JIRA_SEARCH_OK = JSON.stringify({
  issues: [
    { key: 'PROJ-123', fields: {
      summary: 'Tickets reach the inbox', created: '2026-08-20T09:00:00.000+0000',
      status: { name: 'Internal Approving', statusCategory: { name: 'In Progress' } },
    } },
    { key: 'PROJ-99', fields: {
      summary: 'An older ticket', created: '2026-08-10T09:00:00.000+0000',
      status: { name: 'To Do', statusCategory: { name: 'To Do' } },
    } },
  ],
});

test('host: issue-list jira emits the {number,title,url,createdAt,status,statusCategory} contract, key as number', () => {
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const res = runJira(['issue-list'], stub);
  assert.equal(res.status, 0, res.stderr);
  const rows = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows, [
    { number: 'PROJ-123', title: 'Tickets reach the inbox', url: 'https://acme.atlassian.net/browse/PROJ-123', createdAt: '2026-08-20T09:00:00.000+0000', status: 'Internal Approving', statusCategory: 'In Progress' },
    { number: 'PROJ-99', title: 'An older ticket', url: 'https://acme.atlassian.net/browse/PROJ-99', createdAt: '2026-08-10T09:00:00.000+0000', status: 'To Do', statusCategory: 'To Do' },
  ]);
  // `number` is the Jira KEY, a string — #447 taught plot-plan-meta.sh to read it.
  assert.equal(typeof rows[0].number, 'string');
});

test('host: issue-list jira asks for status and NOT the whole fields block', () => {
  // The easy over-reach: `fields=*all`, or the whole Jira fields block, which
  // would carry assignee, labels and priority into a domain that refuses them.
  // The entity's refusal survives this slice narrowly — its subject is a
  // write-back loop, and a read of the status is not one — so the request must
  // name exactly the fields the contract publishes.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  runJira(['issue-list'], stub);
  const argv = readFileSync(stub.argvFile, 'utf8').split('\n');
  const fields = argv.find((l) => l.startsWith('fields='));
  assert.equal(fields, 'fields=summary,created,status');
  for (const refused of ['assignee', 'labels', 'priority', '*all', '*navigable']) {
    assert.ok(!fields.includes(refused), `issue-list must not request ${refused}`);
  }
});

test('host: issue-list jira projects no tracker state beyond the two status keys', () => {
  // The same refusal on the OUTPUT side. A request that named only the right
  // fields could still be widened later; this asserts the projection's key set
  // itself, so adding `assignee` to the entity fails here rather than shipping.
  const body = JSON.stringify({
    issues: [{ key: 'PROJ-1', fields: {
      summary: 's', created: '2026-09-01T00:00:00.000+0000',
      status: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
      // Present in the payload and deliberately NOT projected.
      assignee: { displayName: 'Alice' }, labels: ['urgent'], priority: { name: 'High' },
    } }],
  });
  const stub = makeJiraCurlStub({ body });
  const res = runJira(['issue-list'], stub);
  assert.equal(res.status, 0, res.stderr);
  const row = JSON.parse(res.stdout.trim());
  assert.deepEqual(
    Object.keys(row).sort(),
    ['createdAt', 'number', 'status', 'statusCategory', 'title', 'url'],
  );
});

test('host: issue-list jira reports an absent status as "", never a guessed one', () => {
  // Absent is not false. A ticket whose status Jira did not state must arrive
  // as "" — a default of `To Do` would claim a stage the tracker never named.
  const body = JSON.stringify({ issues: [{ key: 'PROJ-7', fields: { summary: 's', created: '' } }] });
  const stub = makeJiraCurlStub({ body });
  const res = runJira(['issue-list'], stub);
  assert.equal(res.status, 0, res.stderr);
  const row = JSON.parse(res.stdout.trim());
  assert.equal(row.status, '');
  assert.equal(row.statusCategory, '');
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

// --- `Ticket prefixes` scopes the inbox to this repository -------------------
//
// The defect: `assignee = currentUser() AND resolution = EMPTY` scopes by PERSON
// and by STATE, and by nothing else. On a shared Jira instance a reporter's board
// showed twelve issues, one of them belonging to a different customer entirely.
// Jira has no notion of the repository a board serves — that mapping lives only
// in this repo's config, which is why a KEY is the fix and not a JQL function.
//
// The key holds a LIST. A repository mapping to several Jira projects is the
// normal case: filtering on adoption's single seeded prefix would hide the work
// that genuinely belongs, under a heading claiming nobody had planned it.
//
// Every test below reads the JQL out of the recorded curl argv — the query is
// sent as `--data-urlencode jql=…`, so the argv line IS the assertion subject.

// The JQL the adapter sends, lifted from the recorded argv. `--data-urlencode`
// passes `jql=<query>` as one argument, so the line carries the whole query.
function jqlOf(stub) {
  const line = readFileSync(stub.argvFile, 'utf8').split('\n').find((l) => l.startsWith('jql='));
  return line === undefined ? null : line.slice('jql='.length);
}

// TODAY'S QUERY, byte for byte. Written out rather than derived, because the
// upgrade-safety assertion below is only worth anything if this side is a
// literal: a constant shared with the implementation would move with it.
const JQL_UNSCOPED = 'assignee = currentUser() AND resolution = EMPTY ORDER BY created DESC';

// A repository that declares NO `Ticket prefixes`. An env override cannot
// express this — an empty override reads as *not set* and falls through to the
// config, which run from this repo's own root is THIS repo's config. The same
// trap `makeNoCiRepo` was written for, one key along: the absence has to be a
// real repository saying nothing.
function makeTicketPrefixRepo(prefixLine) {
  const repo = mkdtempSync(path.join(tmpdir(), 'plot-host-prefixes-'));
  const config = `## Plot Config\n\n- **Git host:** github\n${prefixLine ?? ''}`;
  writeFileSync(path.join(repo, 'CLAUDE.md'), config);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

// `runJira`, but from a chosen repository root so `plot-config.sh` reads that
// repo's `## Plot Config` rather than the checkout the suite runs in.
function runJiraIn(repo, args, stub, extraEnv = {}) {
  return spawnSync('bash', [adapter, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, ...JIRA_ENV, ...extraEnv },
  });
}

test('host: issue-list jira scopes the JQL by project when Ticket prefixes is set', () => {
  const repo = makeTicketPrefixRepo('- **Ticket prefixes:** PROJ-A, PROJ-B\n');
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const res = runJiraIn(repo, ['issue-list'], stub);
  assert.equal(res.status, 0, res.stderr);
  const jql = jqlOf(stub);
  assert.match(jql, /AND project IN \(PROJ-A, PROJ-B\)/, 'the declared projects scope the inbox');
  // The person and state scopes SURVIVE — this narrows the inbox, never replaces it.
  assert.match(jql, /assignee = currentUser\(\)/);
  assert.match(jql, /resolution = EMPTY/);
  // ORDER BY stays LAST: JQL requires it after every clause, so an `IN` appended
  // to the end of the default string would be a syntax error Jira rejects.
  assert.match(jql, /ORDER BY created DESC$/, 'ORDER BY closes the query');
});

test('host: issue-list jira sends TODAY\'S query byte-for-byte when the key is absent', () => {
  // THE UPGRADE-SAFETY PROPERTY, and the assertion that fails if the clause is
  // appended unconditionally. A default that started filtering on an undeclared
  // key would empty every existing board's inbox on upgrade — a WORSE failure
  // than the one being fixed, because it looks like *no tickets* rather than
  // like the wrong ones.
  const repo = makeTicketPrefixRepo(null);
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const res = runJiraIn(repo, ['issue-list'], stub);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(jqlOf(stub), JQL_UNSCOPED, 'an undeclared key changes nothing at all');
});

test('host: issue-list jira lets PLOT_JIRA_JQL win over Ticket prefixes', () => {
  // Teams already worked around this bug with their own JQL. An override that
  // stopped overriding would break exactly the people who noticed it first.
  const repo = makeTicketPrefixRepo('- **Ticket prefixes:** PROJ-A, PROJ-B\n');
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const res = runJiraIn(repo, ['issue-list'], stub, { PLOT_JIRA_JQL: 'project = MINE ORDER BY created DESC' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(jqlOf(stub), 'project = MINE ORDER BY created DESC', 'the override is the whole query');
  assert.ok(!jqlOf(stub).includes('PROJ-A'), 'the key never edits an explicit override');
});

test('host: issue-list jira reads a one-element Ticket prefixes as a valid IN clause', () => {
  // What adoption's seed writes: `plot-detect-repo.sh` takes `head -1`, so a
  // freshly adopted repo holds exactly one prefix. This catches a join that
  // emits `IN (PROJ-A,)` — valid-looking to a reader, rejected by Jira.
  const repo = makeTicketPrefixRepo('- **Ticket prefixes:** PROJ-A\n');
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const res = runJiraIn(repo, ['issue-list'], stub);
  assert.equal(res.status, 0, res.stderr);
  assert.match(jqlOf(stub), /AND project IN \(PROJ-A\) ORDER BY/, 'one element carries no trailing comma');
});

test('host: issue-list jira reads a comma-separated Ticket prefixes with or without spaces', () => {
  // `PROJ-A, PROJ-B` and `PROJ-A,PROJ-B` must reach the SAME query. This is the
  // estate's first list-valued key with a consumer, so the parsing is stated
  // here rather than inherited.
  const spaced = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const tight = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  runJiraIn(makeTicketPrefixRepo('- **Ticket prefixes:** PROJ-A,  PROJ-B\n'), ['issue-list'], spaced);
  runJiraIn(makeTicketPrefixRepo('- **Ticket prefixes:** PROJ-A,PROJ-B\n'), ['issue-list'], tight);
  assert.equal(jqlOf(spaced), jqlOf(tight), 'whitespace around the commas is not part of the value');
  assert.match(jqlOf(tight), /IN \(PROJ-A, PROJ-B\)/);
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
  // `mergeCommit: ''` although the PR is MERGED: this stub's payload carries no
  // `merge_commit`, which is the shape a PR merged outside the host's merge
  // button has. The key is present because the arm always emits it; the value
  // is empty because there is nothing honest to put in it.
  assert.deepEqual(out, {
    number: 7, state: 'MERGED', draft: false, url: 'https://bb.test/pr/7', mergeCommit: '',
  });
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

test('host: ci-limit reads the SCHEME of a prose CI value, for all three spellings', () => {
  // THE DEFECT THIS PLAN WAS OPENED FOR. A `CI:` key is prose in every
  // repository that declares one, and `ci_backend()` handed the whole value to
  // a `case` matching a bare word — so a Jenkins with a `predicted` ceiling of
  // 60 fell into the `*)` arm and reported `basis: unknown`. Measured
  // 2026-09-09 against a reachable instance: only the bare word matched.
  const stubs = makeStubs();
  for (const spelling of [
    'jenkins',
    'Jenkins at `jenkins.example.com`',
    'Jenkins (e.g. continuous-build, quaweb)',
  ]) {
    const out = JSON.parse(
      run(['ci-limit'], { env: { PLOT_HOST: 'github', PLOT_CI: spelling }, stubs }).trim(),
    );
    assert.equal(out.basis, 'predicted', `${spelling} is a configured Jenkins`);
    assert.equal(out.limit, 60);
    assert.equal(out.connector, 'jenkins', 'the payload carries the scheme, not the prose');
  }
});

test('host: ci-limit reports the scheme as the connector, never the whole value', () => {
  // A SECOND DEFECT, not a rendering nicety. `build-shell.ts` filters readings
  // by `reading.connector === shell.system`, and the system is a bare word — so
  // a prose connector is discarded before any caller sees it, and the port
  // defines that empty answer as "a connector that meters nothing".
  const stubs = makeStubs();
  const out = JSON.parse(
    run(['ci-limit'], {
      env: { PLOT_HOST: 'github', PLOT_CI: 'github-actions (see .github/workflows/ci.yml)' },
      stubs,
    }).trim(),
  );
  assert.equal(out.connector, 'github-actions');
});

test('host: ci-limit still answers unknown for a connector nobody estimated', () => {
  // The `*)` arm SURVIVES — it means "no estimate written for this connector",
  // which is a different answer from "the value did not parse". The fix is that
  // Jenkins stops falling into it, not that it goes away.
  const stubs = makeStubs();
  const out = JSON.parse(
    run(['ci-limit'], {
      env: { PLOT_HOST: 'github', PLOT_CI: 'GitLab CI at `gitlab.acme.dev`' },
      stubs,
    }).trim(),
  );
  assert.equal(out.connector, 'gitlab');
  assert.equal(out.basis, 'unknown');
  assert.equal(out.limit, null);
});

test('host: no ci_backend survives — the split left one reader of the CI key', () => {
  // A STRUCTURAL ASSERTION, because this is what a behavioural one cannot say.
  // `ci_backend()` returned the WHOLE `CI:` value and every caller compared it
  // against a bare word. After the split it has no callers, and a function
  // retained for a hypothetical reader invites the next caller to match on the
  // prose value again — which is the bug this fixed.
  const src = readFileSync(adapter, 'utf8');
  const hits = src.match(/ci_backend/g) ?? [];
  assert.equal(hits.length, 0, `ci_backend is deleted; found ${hits.length} reference(s)`);
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

// WHY `plot-pr-merged.sh` STILL ASKS `gh` ITSELF — the measurement, pinned.
//
// `plot-host.sh pr-merged` answers `merged`/`not-merged`/`unknown`, which reads
// like the three readings `rules/landed.ts` takes. It is not: the ABSENT-CLI
// case, which the shell helper answers `unaskable`, arrives here as
// `not-merged`.
//
// The cause is `is_lookup_miss`, and it is not a typo. A missing CLI makes the
// shell say `bash: gh: command not found`, and that text matches the same
// `not found` the adapter uses to recognise a genuine "no pull requests found".
// One phrase, two conditions, and the adapter cannot tell them apart.
//
// THE DIRECTION IS WHAT MAKES IT A BLOCKER. `not-merged` reads to
// `rules/landed.ts` as `none` — the host SPOKE and said nothing merged — so
// `mayRemove` is free to permit a removal. The shell helper's `unaskable`
// refuses. Routing the lookup as it stands would therefore convert a KEEP into
// a REMOVE on `plot-release-refs.sh`, whose deletions are not re-creatable.
//
// AN ABSENT CLI IS NOT A LOOKUP MISS, AND THIS TEST WAS INVERTED THE DAY IT
// STOPPED BEING TRUE.
//
// It read `not-merged` and pinned CURRENT behaviour, with its own note saying
// it *"fails the day `pr-merged` learns to tell an absent CLI from an empty
// result — which is exactly when the exemption should be deleted and the
// lookups routed."* That landed on 2026-09-06: `is_lookup_miss` now excludes
// the shell's own `command not found`, which it had been matching on its bare
// `not found` alternative.
//
// Measured before and after, with `gh` off PATH:
//
//   before   plot-host.sh pr-merged → not-merged   _plot_merged_lookup → unaskable
//   after    plot-host.sh pr-merged → unknown      _plot_merged_lookup → unaskable
//
// The direction was why it mattered: `not-merged` reads to `rules/landed.ts` as
// `none` — the host spoke and said nothing merged — so `mayRemove` may permit a
// removal where `unaskable` refuses, and `plot-release-refs.sh` deletes remote
// refs on that answer.
test('host: an absent CLI answers unknown, never not-merged', () => {
  // `command not found` is what a shell says about a missing binary, and it is
  // the stderr a real absent `gh` produces.
  const stubs = makeStubs({ ghFail: 'bash: gh: command not found' });
  const out = run(['pr-merged', 'some-branch'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(
    out.trim(),
    'unknown',
    'a host that cannot be asked must not answer not-merged',
  );
});

// The half that DOES work, pinned beside it so the gap above is not read as
// "pr-merged cannot report unknown at all". A failure the adapter does not
// recognise as a miss is `unknown` on exit 0, exactly as its header promises.
test('host: pr-merged reports an unrecognised failure as unknown', () => {
  const stubs = makeStubs({ ghFail: 'dial tcp: connection refused' });
  const out = run(['pr-merged', 'some-branch'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.equal(out.trim(), 'unknown', 'silence from the host is never permission');
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

// ── the budget knows which bucket it spent ──────────────────────────────────
//
// GITHUB METERS `core` AND `graphql` AS INDEPENDENT POOLS, 5000 each, and until
// this slice the record filed every GitHub call against one bucket named `api`.
// Measured 2026-09-01 from the response headers of one account at one moment:
//
//   core (REST)  5000 limit, 4990 remaining, 10 used
//   graphql      5000 limit,    0 remaining, 5000 used
//
// A single reading over that pair reports plenty of room while every `gh pr`
// call is refused — and refuses calls that would have gone to the pool with
// 4990 left.
//
// THE TRUTH IS THE RESPONSE HEADER, NOT `gh api rate_limit`. Measured
// 2026-09-01 and reproduced 2026-09-02, seconds apart on one account: the
// endpoint reported `graphql 5000/5000 used 0` while the header on a real call
// read `Remaining: 2732, Used: 2268`. The header reading is free (the call was
// going to happen anyway), current (it describes the call that just happened)
// and self-naming (`X-RateLimit-Resource` says which pool).

// Reads the budget record a run wrote, as decoded fields.
const recordOf = (stubs) => {
  const file = path.join(stubs.budgetHome ?? path.join(stubs.dir, 'budget-home'), 'budget.tsv');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [format, connector, account, bucket, at, spent, limit, remaining, reset, basis] =
        line.split('\t');
      return { format, connector, account, bucket, at, spent, limit, remaining, reset, basis };
    });
};

// A `gh` stub that answers `api … --include` with a HEADER BLOCK, so a test can
// express what a real response carries. The status line is what the adapter
// keys the split on, and the headers are CRLF-terminated exactly as `gh` prints
// them — a body split on a bare `\n` blank line would take the first blank line
// inside a pretty-printed payload instead.
function makeRestHeaderStub({ headers = {}, restJson = '{}', fail = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-rest-hdr-'));
  const callsFile = path.join(dir, 'gh.calls');
  const budgetHome = path.join(dir, 'budget-home');
  mkdirSync(budgetHome, { recursive: true });
  const q = (v) => String(v).replace(/'/g, `'\\''`);
  const hdr = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}\\r`)
    .join('\n');
  const body = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${callsFile}"
case "$1" in
  repo) printf '%s' '{"defaultBranchRef":{"name":"main"},"nameWithOwner":"owner/repo"}'; exit 0 ;;
esac
${fail != null ? `printf '%s\\n' '${q(fail)}' >&2; exit 1` : ''}
if [[ "$*" == *"--include"* ]]; then
  printf 'HTTP/2.0 200 OK\\r\\n'
  printf '${hdr}\\n'
  printf '\\r\\n'
fi
printf '%s' '${q(restJson)}'
`;
  writeFileSync(path.join(dir, 'gh'), body);
  chmodSync(path.join(dir, 'gh'), 0o755);
  writeFileSync(path.join(dir, 'bb'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(path.join(dir, 'bb'), 0o755);
  return { dir, callsFile, budgetHome };
}

const REST_PR = JSON.stringify({
  number: 7,
  state: 'open',
  draft: false,
  html_url: 'https://example.test/pr/7',
  merged: false,
  merge_commit_sha: null,
});

test('host: a REST call records the bucket its own header names', () => {
  // THE BUCKET NAMES ITSELF. `X-RateLimit-Resource` says `core`, and the
  // adapter files the spend there rather than under one undifferentiated pool.
  const stubs = makeRestHeaderStub({
    headers: {
      'X-Ratelimit-Limit': '5000',
      'X-Ratelimit-Remaining': '4990',
      'X-Ratelimit-Reset': '1788269670',
      'X-Ratelimit-Resource': 'core',
    },
    restJson: REST_PR,
  });
  run(['pr-state', '7'], { env: { PLOT_HOST: 'github', PLOT_HOST_FORCE_REST: '1' }, stubs });
  const rows = recordOf(stubs).filter((r) => r.bucket === 'core');
  assert.ok(rows.length >= 1, `a core line must be written; record was:\n${JSON.stringify(recordOf(stubs), null, 2)}`);
  const row = rows.at(-1);
  assert.equal(row.remaining, '4990', 'the header’s own number, not the endpoint’s');
  assert.equal(row.limit, '5000');
  assert.equal(row.basis, 'actual', 'the connector said it, about the call that just happened');
});

test('host: the harvest costs no extra request', () => {
  // THE OBJECTION THAT JUSTIFIED `rate_limit` DOES NOT APPLY HERE. `--include`
  // adds a header block to a request the adapter was already making, so the
  // reading is free — where `gh api rate_limit` was one call per lookup against
  // the very pool it reported on.
  const stubs = makeRestHeaderStub({
    headers: { 'X-Ratelimit-Limit': '5000', 'X-Ratelimit-Remaining': '4990', 'X-Ratelimit-Resource': 'core' },
    restJson: REST_PR,
  });
  run(['pr-state', '7'], { env: { PLOT_HOST: 'github', PLOT_HOST_FORCE_REST: '1' }, stubs });
  const calls = callsOf(stubs.callsFile).filter((c) => !c.startsWith('repo '));
  assert.equal(calls.length, 1, `one request, not two; calls were:\n${calls.join('\n')}`);
  assert.match(calls[0], /--include/, 'the same request, with its headers asked for');
  assert.ok(!calls.some((c) => c.includes('rate_limit')), 'nothing asks that endpoint to route');
});

test('host: the harvested body reaches the caller unchanged', () => {
  // STDOUT IS THE BODY AND NOTHING ELSE. The header block is split off inside
  // the adapter, so every caller parses exactly what it parsed before —
  // `--verbose` was the alternative and writes the whole exchange to stdout.
  const stubs = makeRestHeaderStub({
    headers: { 'X-Ratelimit-Limit': '5000', 'X-Ratelimit-Remaining': '4990', 'X-Ratelimit-Resource': 'core' },
    restJson: REST_PR,
  });
  const out = run(['pr-state', '7'], {
    env: { PLOT_HOST: 'github', PLOT_HOST_FORCE_REST: '1' },
    stubs,
  });
  assert.deepEqual(JSON.parse(out), {
    number: 7, state: 'OPEN', draft: false, url: 'https://example.test/pr/7', mergeCommit: '',
  });
  assert.doesNotMatch(out, /X-Ratelimit|HTTP\//i, 'no header may reach a caller’s parse');
});

test('host: a stripped header records unknown, never a number', () => {
  // `unknown` IS NEVER `free`. A proxy or an enterprise instance that removes
  // the headers has not reported a full budget and has not reported an empty
  // one — and the call is still recorded, because it still spent.
  const stubs = makeRestHeaderStub({ headers: {}, restJson: REST_PR });
  run(['pr-state', '7'], { env: { PLOT_HOST: 'github', PLOT_HOST_FORCE_REST: '1' }, stubs });
  const row = recordOf(stubs).filter((r) => r.bucket === 'core').at(-1);
  assert.ok(row, 'a call that spent is recorded even where it reported nothing');
  assert.equal(row.basis, 'unknown');
  assert.equal(row.remaining, '-', 'the absent marker, never a zero standing in for it');
  assert.notEqual(row.remaining, '0', 'silence must not read as exhaustion');
});

test('host: an unparseable header records unknown, never a number', () => {
  // A limit that is not a number is no reading at all, and the WHOLE reading is
  // dropped rather than half-kept: a bucket name beside an absent count would
  // file a spend against a pool the record then reports as unknown.
  const stubs = makeRestHeaderStub({
    headers: { 'X-Ratelimit-Limit': 'lots', 'X-Ratelimit-Remaining': 'some', 'X-Ratelimit-Resource': 'core' },
    restJson: REST_PR,
  });
  run(['pr-state', '7'], { env: { PLOT_HOST: 'github', PLOT_HOST_FORCE_REST: '1' }, stubs });
  const row = recordOf(stubs).filter((r) => r.bucket === 'core').at(-1);
  assert.equal(row.basis, 'unknown');
  assert.equal(row.limit, '-');
});

test('host: a GraphQL call is recorded against graphql, not against core', () => {
  // `gh pr list` IS `gh`'S GRAPHQL WRAPPER and exposes no headers — there is no
  // flag that adds them and `--verbose` writes the exchange to stdout. So the
  // argv names the bucket, which is enough for the split that matters, and the
  // numbers stay absent because nothing measured them.
  const stubs = makeStubsRateAware({ graphqlJson: '[]' });
  run(['pr-list'], { env: { PLOT_HOST: 'github' }, stubs });
  const written = recordOf(stubs).filter((r) => r.at > '0' && r.basis === 'unknown');
  assert.ok(
    written.some((r) => r.bucket === 'graphql'),
    `a pr-list call spends graphql; record was:\n${JSON.stringify(recordOf(stubs), null, 2)}`,
  );
  assert.ok(
    !written.some((r) => r.bucket === 'api'),
    'the undifferentiated pool is gone — it described neither of the two',
  );
});

test('host: a spent GraphQL bucket does not stop a REST call', () => {
  // THE DONE-WHEN, WORDED AS THE PLAN WORDS IT. The two are budgeted by name,
  // so the board keeps answering from the pool with 4990 left instead of
  // pausing on the one with 0.
  const stubs = makeStubsRateAware({
    graphqlRemaining: 0,
    coreRemaining: 4990,
    restJson: REST_PR,
  });
  const out = JSON.parse(run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.state, 'OPEN', 'the REST pool answered while GraphQL was spent');
  const calls = callsOf(stubs.callsFile);
  assert.ok(calls.some((c) => c.startsWith('api repos/')), 'and it answered over REST');
});

test('host: a spent REST bucket does not stop a GraphQL call', () => {
  // AND THE REVERSE, which is the half a one-directional fix would miss.
  const stubs = makeStubsRateAware({
    graphqlRemaining: 4990,
    coreRemaining: 0,
    graphqlJson: JSON.stringify({
      number: 7, state: 'OPEN', isDraft: false, url: 'https://example.test/pr/7',
    }),
  });
  const out = JSON.parse(run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(out.state, 'OPEN');
  const calls = callsOf(stubs.callsFile);
  assert.ok(calls.some((c) => c.startsWith('pr view')), 'a spent core pool says nothing about graphql');
});

test('host: the gate answers from the headers, not from rate_limit', () => {
  // THE ASSERTION THE SLICE IS NAMED FOR. `X-RateLimit-Remaining: 0` on the
  // graphql bucket routes to REST, and `gh api rate_limit` says 5000 at that
  // exact moment — measured 2026-09-01 and reproduced 2026-09-02, three
  // readings running.
  //
  // The stub answers `rate_limit` with a FULL budget on purpose: an adapter
  // that still read that endpoint would take the cheap path and this test
  // would fail. That inversion is the whole point.
  const stubs = makeStubsRateAware({ graphqlRemaining: 0, coreRemaining: 5000, restJson: REST_PR });
  writeFileSync(
    path.join(stubs.budgetHome, 'budget.tsv'),
    `b1\tgithub\t${BUDGET_ACCOUNT}\tgraphql\t${Date.now()}\t1\t5000\t0\t-\tactual\n`,
  );
  run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs });
  const calls = callsOf(stubs.callsFile);
  assert.ok(calls.some((c) => c.startsWith('api repos/')), 'the header said 0, so REST answered');
  assert.ok(
    !calls.some((c) => c === 'api rate_limit'),
    'the endpoint that reported 5000 against a header of 0 is not asked at all',
  );
});

test('host: an empty record keeps the cheap path — unknown is not spent', () => {
  // #485'S RULE AT THE POINT WHERE IT BITES. A record with no graphql line yet
  // reports `unknown`, and reading that as exhausted would send every branch
  // down the ~186-call path forever, on a fresh checkout, for nothing.
  const stubs = makeStubsRateAware({
    graphqlJson: JSON.stringify({
      number: 7, state: 'OPEN', isDraft: false, url: 'https://example.test/pr/7',
    }),
  });
  writeFileSync(path.join(stubs.budgetHome, 'budget.tsv'), '');
  run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs });
  const calls = callsOf(stubs.callsFile);
  assert.ok(calls.some((c) => c.startsWith('pr view')), 'no reading is not an empty bucket');
  assert.ok(!calls.some((c) => c.startsWith('api repos/')), 'and must not take the expensive path');
});

test('host: a predicted reading may not close the gate', () => {
  // ONLY AN `actual` READING IS EVIDENCE A POOL IS EMPTY. A prediction is the
  // adapter's estimate of a CEILING and carries no spend against it, so a
  // `predicted 0` is not a measurement of exhaustion — taking the expensive
  // path on it would be routing on a guess.
  const stubs = makeStubsRateAware({
    graphqlJson: JSON.stringify({
      number: 7, state: 'OPEN', isDraft: false, url: 'https://example.test/pr/7',
    }),
  });
  writeFileSync(
    path.join(stubs.budgetHome, 'budget.tsv'),
    `b1\tgithub\t${BUDGET_ACCOUNT}\tgraphql\t${Date.now()}\t1\t5000\t0\t-\tpredicted\n`,
  );
  run(['pr-state', '7'], { env: { PLOT_HOST: 'github' }, stubs });
  assert.ok(
    callsOf(stubs.callsFile).some((c) => c.startsWith('pr view')),
    'a guess must not route',
  );
});

test('host: spend-rate with no --bucket sums every bucket the account has', () => {
  // AN OMITTED `--bucket` MEANS EVERY BUCKET, which is what *what am I
  // spending?* asks — the question the board's cadence divides by. An account
  // spends both pools, so naming one would ignore the traffic on the other.
  const stubs = makeStubsRateAware({});
  const at = Date.now();
  writeFileSync(
    path.join(stubs.budgetHome, 'budget.tsv'),
    [
      `b1\tgithub\t${BUDGET_ACCOUNT}\tcore\t${at - 60000}\t1\t5000\t4990\t-\tactual`,
      `b1\tgithub\t${BUDGET_ACCOUNT}\tgraphql\t${at - 30000}\t1\t5000\t0\t-\tactual`,
      '',
    ].join('\n'),
  );
  const all = JSON.parse(run(['spend-rate'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.equal(all.spent, 2, 'both pools count toward what the account is spending');
  const one = JSON.parse(
    run(['spend-rate', '--bucket', 'graphql'], { env: { PLOT_HOST: 'github' }, stubs }),
  );
  assert.equal(one.spent, 1, 'a named bucket reports only its own');
  assert.equal(one.remaining, 0, 'and its own reading, which the sum cannot give');
});

test('host: an unreadable call does not erase the reading before it', () => {
  // MEASURED 2026-09-02 AGAINST THE LIVE HOST. `limit` harvested
  // `graphql 4391/5000 actual`, one `pr-state` followed — `gh pr view` is a
  // GraphQL wrapper that exposes no headers, so it records a spend and no
  // numbers — and the bucket then read `remaining: null`. Every `gh pr` call
  // writes such a line, so the routing gate would never again see a spent pool:
  // the exact blindness this slice removes, reintroduced from the other side.
  const stubs = makeStubsRateAware({ graphqlJson: '[]' });
  const at = Date.now();
  writeFileSync(
    path.join(stubs.budgetHome, 'budget.tsv'),
    [
      `b1\tgithub\t${BUDGET_ACCOUNT}\tgraphql\t${at - 2000}\t1\t5000\t0\t-\tactual`,
      `b1\tgithub\t${BUDGET_ACCOUNT}\tgraphql\t${at - 1000}\t1\t-\t-\t-\tunknown`,
      '',
    ].join('\n'),
  );
  const rate = JSON.parse(
    run(['spend-rate', '--bucket', 'graphql'], { env: { PLOT_HOST: 'github' }, stubs }),
  );
  assert.equal(rate.remaining, 0, 'the measurement survives a later call that reported nothing');
  assert.equal(rate.basis, 'actual');
  assert.equal(rate.spent, 2, 'and the unreadable call still counts as a spend');
});

// --- issue-status: THE ONE WRITE TO A TRACKER -------------------------------
//
// The amendment this op records. CLAUDE.md said *"The two issue ops READ and
// never write"* until the tracker got its own port; the sentence is amended
// rather than quietly broken, and what it now says is narrow: Plot writes a
// STATUS to the tracker it was told about, and writes nothing else. No ticket
// is created, none is closed, no comment, label or assignee is touched.
//
// JIRA ONLY, and exit 4 elsewhere — this adapter cannot be asked, which is
// neither a failure nor a silent success. The other vendor's projects surface
// is written by `plot-update-board.sh` under its own credentials, which is why
// the tracker port has two connectors rather than one arm with a branch.
//
// The stub here APPENDS rather than overwrites, because the op makes two calls:
// it looks the transition up before performing it, and both are worth asserting.

/**
 * A `curl` stub that answers a different body per call and appends its argv.
 *
 * @param bodies - one `{body, status}` per call, in order; the last repeats.
 */
function makeJiraSequenceStub(bodies) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-jira-seq-'));
  const argvFile = path.join(dir, 'curl.argv');
  const countFile = path.join(dir, 'curl.count');
  const encoded = bodies
    .map((b) => `${Buffer.from(b.body ?? '{}', 'utf8').toString('base64')}:${b.status ?? 200}`)
    .join(' ');
  writeFileSync(
    path.join(dir, 'curl'),
    `#!/usr/bin/env bash
printf -- '--- call\\n' >> "${argvFile}"
printf '%s\\n' "$@" >> "${argvFile}"
n=0; [ -f "${countFile}" ] && n=$(cat "${countFile}")
printf '%s' "$((n + 1))" > "${countFile}"
set -- ${encoded}
shift "$n" 2>/dev/null || { while [ $# -gt 1 ]; do shift; done; }
[ $# -gt 0 ] || set -- "$(printf '%s' '{}' | base64):200"
printf '%s' "$(printf '%s' "\${1%%:*}" | base64 -d)"
printf '\\n%s' "\${1##*:}"
`,
  );
  chmodSync(path.join(dir, 'curl'), 0o755);
  return { dir, argvFile };
}

/** The transitions payload Jira answers a lookup with. */
const JIRA_TRANSITIONS = JSON.stringify({
  transitions: [
    { id: '11', name: 'To Do', to: { name: 'To Do' } },
    { id: '21', name: 'Start Progress', to: { name: 'In Progress' } },
    { id: '31', name: 'Done', to: { name: 'Done' } },
  ],
});

test('host: issue-status transitions the issue and says it wrote', () => {
  const stub = makeJiraSequenceStub([
    { body: JIRA_TRANSITIONS },
    { body: '', status: 204 },
  ]);
  const res = runJira(['issue-status', 'PROJ-123', 'Done'], stub);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'written');

  const calls = readFileSync(stub.argvFile, 'utf8').split('--- call').filter(Boolean);
  assert.equal(calls.length, 2, 'the transition is looked up, then performed');
  // THE LOOKUP IS A READ. It must not carry a method or a body.
  for (const write of ['-X', '--request', '-d', '--data']) {
    assert.ok(!calls[0].split('\n').includes(write), `the lookup must not send ${write}`);
  }
  // The write names the id the lookup returned, not a guessed one.
  assert.match(calls[1], /^-X$/m);
  assert.match(calls[1], /^POST$/m);
  assert.match(calls[1], /"transition":\{"id":"31"\}/);
});

test('host: issue-status looks the transition id up rather than guessing it', () => {
  // IDS ARE PER WORKFLOW AND PER ISSUE. A hardcoded id writes a status to the
  // wrong column silently, and the same status name carries a different id in
  // the next project.
  const stub = makeJiraSequenceStub([
    { body: JSON.stringify({ transitions: [{ id: '907', name: 'Ship it', to: { name: 'Done' } }] }) },
    { body: '', status: 204 },
  ]);
  const res = runJira(['issue-status', 'PROJ-1', 'Done'], stub);
  assert.equal(res.status, 0, res.stderr);
  // Matched on the DESTINATION state, not only the transition's own name.
  const calls = readFileSync(stub.argvFile, 'utf8').split('--- call').filter(Boolean);
  assert.match(calls[1], /"id":"907"/);
});

test('host: issue-status answers no-target where the workflow offers no such move', () => {
  // A REPEATED WRITE IS THE ORDINARY CASE, and Jira answers it by naming no
  // such transition — an issue already in the state has no transition to it.
  // Reporting that as a failure would make idempotence look like an outage.
  const stub = makeJiraSequenceStub([{ body: JIRA_TRANSITIONS }]);
  const res = runJira(['issue-status', 'PROJ-123', 'Cancelled'], stub);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'no-target');
  const calls = readFileSync(stub.argvFile, 'utf8').split('--- call').filter(Boolean);
  assert.equal(calls.length, 1, 'nothing is written when there is nowhere to write it');
});

test('host: issue-status exits 4 where the declared tracker is not this one', () => {
  // NOT A FAILURE AND NOT A SILENT SUCCESS. This adapter cannot be asked, which
  // is the answer a repository tracking elsewhere is entitled to.
  const stub = makeJiraSequenceStub([{ body: JIRA_TRANSITIONS }]);
  const res = runJira(['issue-status', 'PROJ-1', 'Done'], stub, { PLOT_TRACKER: 'github-issues' });
  assert.equal(res.status, 4);
  assert.equal(res.stdout.trim(), '');
});

test('host: issue-status writes a status and nothing else', () => {
  // THE WRITE IS ONE FACT AND STAYS ONE. No comment endpoint, no assignee, no
  // label, no delete — a plan referencing an issue is Plot's record.
  const stub = makeJiraSequenceStub([{ body: JIRA_TRANSITIONS }, { body: '', status: 204 }]);
  runJira(['issue-status', 'PROJ-123', 'Done'], stub);
  const argv = readFileSync(stub.argvFile, 'utf8');
  for (const path_ of ['/comment', '/assignee', '/label', '/worklog', '/attachments']) {
    assert.ok(!argv.includes(path_), `issue-status must not reach ${path_}`);
  }
  for (const verb of ['PUT', 'DELETE', 'PATCH']) {
    assert.ok(!argv.split('\n').includes(verb), `issue-status must not send ${verb}`);
  }
});

test('host: issue-status reports a refused write as a failure, never as written', () => {
  // An auth gap, a permission the account lacks, a 5xx — all exit 3 with empty
  // stdout. A write that did not happen must never report that it did.
  const stub = makeJiraSequenceStub([
    { body: JIRA_TRANSITIONS },
    { body: '{"errorMessages":["You do not have permission"]}', status: 403 },
  ]);
  const res = runJira(['issue-status', 'PROJ-123', 'Done'], stub);
  assert.notEqual(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('host: issue-status reports a failed lookup as a failure, never as no-target', () => {
  // The lookup breaking and the workflow offering no such move are different
  // facts. Collapsing them would report an outage as a status already set.
  const stub = makeJiraSequenceStub([{ body: '{}', status: 500 }]);
  const res = runJira(['issue-status', 'PROJ-123', 'Done'], stub);
  assert.notEqual(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

// ---------------------------------------------------------------------------
// The credential is read where a repository keeps it.
//
// The refusal named JIRA_EMAIL and JIRA_API_TOKEN without ever looking where a
// repository puts them, so an operator holding working credentials — measured
// 2026-09-17, a 200 from /rest/api/3/myself with the same pair — was sent to
// create a second token.
//
// THE FIXTURE IS A REAL GIT REPOSITORY, because the lookup resolves the root
// with `git rev-parse --show-toplevel`. A bare temp directory would fall back to
// `.` and pass for the wrong reason.
// ---------------------------------------------------------------------------

/** A git repo whose `.env` holds whatever a test needs it to. */
function jiraEnvRepo(envBody) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-dotenv-'));
  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  if (envBody !== null) writeFileSync(path.join(dir, '.env'), envBody);
  return dir;
}

/**
 * Jira with the two credential variables ABSENT from the environment.
 *
 * Built by DELETING the keys rather than setting them empty: `${JIRA_EMAIL:-}`
 * reads both the same way, but the ledger and any future reader may not, and a
 * test that pins "unset" must not quietly pin "empty".
 */
function runJiraNoCreds(args, stub, cwd, extraEnv = {}) {
  const env = { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, ...JIRA_ENV, ...extraEnv };
  delete env.JIRA_EMAIL;
  delete env.JIRA_API_TOKEN;
  return spawnSync('bash', [adapter, ...args], { encoding: 'utf8', cwd, env });
}

const DOTENV_TOKEN = 'tok-from-dotenv-s3cr3t';
const DOTENV_EMAIL = 'dotenv-user@acme.test';

test('host: an unset pair with a .env carrying both is used, and the source is named', () => {
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const dir = jiraEnvRepo(`JIRA_EMAIL=${DOTENV_EMAIL}\nJIRA_API_TOKEN=${DOTENV_TOKEN}\n`);
  const res = runJiraNoCreds(['issue-list'], stub, dir);
  assert.equal(res.status, 0, `the call must proceed (stderr: ${res.stderr})`);
  // NAMING THE SOURCE IS A REQUIREMENT, not a nicety: two tokens may exist, and
  // an operator debugging a 401 must be able to tell which one was used.
  assert.match(res.stderr, /read from \.env/,
    'a credential picked up silently is worse than one that announces itself');
  // And it really was used — the adapter passes it to curl's --user.
  const argv = readFileSync(stub.argvFile, 'utf8');
  assert.ok(argv.includes(`${DOTENV_EMAIL}:${DOTENV_TOKEN}`), 'the pair reaches --user');
});

test('host: the .env value appears in no output stream', () => {
  // A log line added later is exactly how such a value escapes, so the absence
  // is asserted rather than assumed from reading the code.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const dir = jiraEnvRepo(`JIRA_EMAIL=${DOTENV_EMAIL}\nJIRA_API_TOKEN=${DOTENV_TOKEN}\n`);
  const res = runJiraNoCreds(['issue-list'], stub, dir);
  assert.ok(!res.stdout.includes(DOTENV_TOKEN), 'the token must not reach stdout');
  assert.ok(!res.stderr.includes(DOTENV_TOKEN), 'the token must not reach stderr');
  assert.ok(!res.stdout.includes(DOTENV_EMAIL), 'nor the email, which is half the credential');
  assert.ok(!res.stderr.includes(DOTENV_EMAIL));
});

test('host: the environment wins and the .env is not consulted', () => {
  // Behaviour byte-identical to today where both are set. Pinned by giving the
  // .env a DIFFERENT pair: if the file were read, curl would carry its values.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const dir = jiraEnvRepo(`JIRA_EMAIL=${DOTENV_EMAIL}\nJIRA_API_TOKEN=${DOTENV_TOKEN}\n`);
  const res = spawnSync('bash', [adapter, 'issue-list'], {
    encoding: 'utf8', cwd: dir,
    env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH}`, ...JIRA_ENV },
  });
  assert.equal(res.status, 0);
  const argv = readFileSync(stub.argvFile, 'utf8');
  assert.ok(argv.includes('me@acme.test:tok-secret'), 'the exported pair is what is used');
  assert.ok(!argv.includes(DOTENV_TOKEN), 'the file was not read');
  assert.doesNotMatch(res.stderr, /read from \.env/, 'and nothing claims it was');
});

test('host: no .env leaves the refusal exactly as it was', () => {
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const res = runJiraNoCreds(['issue-list'], stub, jiraEnvRepo(null));
  assert.equal(res.status, 3, 'an auth gap is a config error, never an empty inbox');
  assert.match(res.stderr, /Jira needs JIRA_EMAIL and JIRA_API_TOKEN in the environment/);
  assert.equal(res.stdout.trim(), '', 'and an unauthenticated Jira prints no list');
});

test('host: a .env carrying neither variable leaves the refusal unchanged', () => {
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const dir = jiraEnvRepo('SOMETHING_ELSE=1\n# a comment\n');
  const res = runJiraNoCreds(['issue-list'], stub, dir);
  assert.equal(res.status, 3);
  assert.match(res.stderr, /Jira needs JIRA_EMAIL and JIRA_API_TOKEN/);
});

test('host: half a credential in .env is refused, not partially adopted', () => {
  // Half a Basic pair authenticates nothing, so adopting the email alone would
  // turn today's honest refusal into a 401 further in — the exact failure this
  // change exists to remove.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  for (const body of [`JIRA_EMAIL=${DOTENV_EMAIL}\n`, `JIRA_API_TOKEN=${DOTENV_TOKEN}\n`]) {
    const res = runJiraNoCreds(['issue-list'], stub, jiraEnvRepo(body));
    assert.equal(res.status, 3, `a lone variable must not be adopted: ${body.trim()}`);
    assert.doesNotMatch(res.stderr, /read from \.env/);
  }
});

test('host: the .env parse handles every shape the gate names', () => {
  // EVERY COMBINATION, not one of each. An earlier fixture held a quoted value
  // and a trailed value and never one that is BOTH — and quoted-and-trailed is
  // the case that broke two drafts of this parse: stripping quotes before
  // whitespace leaves ["tok"] intact, because the `"$` anchor misses, and a
  // quoted value reaching `curl -u` is the 401 this change removes.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const shapes = [
    ['plain', `JIRA_EMAIL=${DOTENV_EMAIL}\nJIRA_API_TOKEN=${DOTENV_TOKEN}\n`],
    ['export-prefixed', `export JIRA_EMAIL=${DOTENV_EMAIL}\nexport JIRA_API_TOKEN=${DOTENV_TOKEN}\n`],
    ['double-quoted', `JIRA_EMAIL="${DOTENV_EMAIL}"\nJIRA_API_TOKEN="${DOTENV_TOKEN}"\n`],
    ['single-quoted', `JIRA_EMAIL='${DOTENV_EMAIL}'\nJIRA_API_TOKEN='${DOTENV_TOKEN}'\n`],
    ['trailing-whitespace', `JIRA_EMAIL=${DOTENV_EMAIL}   \nJIRA_API_TOKEN=${DOTENV_TOKEN}   \n`],
    ['quoted AND trailed', `JIRA_EMAIL="${DOTENV_EMAIL}"  \nJIRA_API_TOKEN="${DOTENV_TOKEN}"   \n`],
    ['leading indentation', `  JIRA_EMAIL=${DOTENV_EMAIL}\n  export JIRA_API_TOKEN=${DOTENV_TOKEN}\n`],
    // The file's OTHER lines must not derail the read: an unquoted JSON object
    // is what aborted `set -a; . ./.env` in zsh, and a `=` or `#` inside a
    // neighbouring value must not be treated as structure.
    ['beside unquoted JSON', `CFG={"json":"unquoted"}\nJIRA_EMAIL=${DOTENV_EMAIL}\nJIRA_API_TOKEN=${DOTENV_TOKEN}\n`],
    ['beside = and # values', `A=has=equals\nB=with#hash\nEMPTY=\n\n# comment\nJIRA_EMAIL=${DOTENV_EMAIL}\nJIRA_API_TOKEN=${DOTENV_TOKEN}\n`],
  ];
  for (const [label, body] of shapes) {
    const res = runJiraNoCreds(['issue-list'], stub, jiraEnvRepo(body));
    assert.equal(res.status, 0, `${label} must parse (stderr: ${res.stderr})`);
    const argv = readFileSync(stub.argvFile, 'utf8');
    assert.ok(argv.includes(`${DOTENV_EMAIL}:${DOTENV_TOKEN}`),
      `${label}: the value must reach --user stripped of quotes and whitespace`);
  }
});

test('host: a name that merely starts the wanted one is not read', () => {
  // `JIRA_EMAIL_BACKUP=` must not answer for `JIRA_EMAIL`. The `=` in the sed
  // pattern is what anchors it, and a fixture proves the anchor rather than the
  // intention.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const dir = jiraEnvRepo(`JIRA_EMAIL_BACKUP=wrong@acme.test\nJIRA_API_TOKEN_OLD=wrong-tok\n`);
  const res = runJiraNoCreds(['issue-list'], stub, dir);
  assert.equal(res.status, 3, 'a prefix match is not a match');
});

test('host: nothing but the two named variables is imported', () => {
  // The read is per-variable and evaluates nothing — never `source`, which
  // would pull in every unrelated name in the file. Pinned by a .env whose
  // other entry would change the adapter's behaviour if it were imported.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const dir = jiraEnvRepo(
    `PLOT_TRACKER=jira https://WRONG.atlassian.net\nJIRA_EMAIL=${DOTENV_EMAIL}\nJIRA_API_TOKEN=${DOTENV_TOKEN}\n`);
  const res = runJiraNoCreds(['issue-list'], stub, dir);
  assert.equal(res.status, 0);
  const argv = readFileSync(stub.argvFile, 'utf8');
  assert.ok(!argv.includes('WRONG.atlassian.net'), 'an unrelated variable must not be imported');
  assert.ok(argv.includes('acme.atlassian.net'), 'the environment still decides the base URL');
});

// --- the ledger, which is what the widening owns -----------------------------

test('host: the budget ledger records no email, and reads it from the file', () => {
  // THE GATE READS THE LEDGER, not the code. Every other gate here reads what
  // the adapter PRINTS, and what it WRITES is the half that was missed — a
  // reading of stdout and stderr says nothing about a file.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const dir = jiraEnvRepo(`JIRA_EMAIL=${DOTENV_EMAIL}\nJIRA_API_TOKEN=${DOTENV_TOKEN}\n`);
  const home = mkdtempSync(path.join(tmpdir(), 'plot-host-ledger-'));
  const res = runJiraNoCreds(['issue-list'], stub, dir, { HOME: home, PLOT_BUDGET_OFF: '' });
  assert.equal(res.status, 0, `the call must proceed (stderr: ${res.stderr})`);

  const ledger = path.join(home, '.plot', 'state', 'budget.tsv');
  assert.ok(existsSync(ledger), 'the call is recorded');
  const text = readFileSync(ledger, 'utf8');
  assert.ok(text.includes('\tjira\t'), 'as a jira line');
  assert.ok(!text.includes(DOTENV_EMAIL),
    `the email is half a Basic credential and must not persist:\n${text}`);
});

test('host: two accounts stay distinguishable in the ledger', () => {
  // THE ACCOUNT IS A MATCH KEY, NOT A LABEL — `plot-budget.sh:250` is
  // `if ($2 != want_c || $3 != want_a) next`, and `spend-rate` publishes it. A
  // CONSTANT redaction would merge distinct accounts' rate windows, and one
  // machine's ledger holds three. So the redaction must be one-to-one.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const home = mkdtempSync(path.join(tmpdir(), 'plot-host-ledger2-'));
  const accountsFor = (email) => {
    const dir = jiraEnvRepo(`JIRA_EMAIL=${email}\nJIRA_API_TOKEN=${DOTENV_TOKEN}\n`);
    runJiraNoCreds(['issue-list'], stub, dir, { HOME: home, PLOT_BUDGET_OFF: '' });
  };
  accountsFor('one@acme.test');
  accountsFor('two@acme.test');
  const lines = readFileSync(path.join(home, '.plot', 'state', 'budget.tsv'), 'utf8')
    .split('\n').filter((l) => l.includes('\tjira\t'));
  const accounts = new Set(lines.map((l) => l.split('\t')[2]));
  assert.equal(accounts.size, 2, `two accounts must key differently, got: ${[...accounts]}`);
  for (const a of accounts) {
    assert.ok(!a.includes('@'), `a ledger account carries no address: ${a}`);
  }
});

test('host: the same account keys the same way across calls', () => {
  // A key that changed per call would defeat the rate window as surely as a
  // constant would merge it — `sameKey` matches on this field.
  const stub = makeJiraCurlStub({ body: JIRA_SEARCH_OK });
  const home = mkdtempSync(path.join(tmpdir(), 'plot-host-ledger3-'));
  const dir = jiraEnvRepo(`JIRA_EMAIL=${DOTENV_EMAIL}\nJIRA_API_TOKEN=${DOTENV_TOKEN}\n`);
  runJiraNoCreds(['issue-list'], stub, dir, { HOME: home, PLOT_BUDGET_OFF: '' });
  runJiraNoCreds(['issue-list'], stub, dir, { HOME: home, PLOT_BUDGET_OFF: '' });
  const lines = readFileSync(path.join(home, '.plot', 'state', 'budget.tsv'), 'utf8')
    .split('\n').filter((l) => l.includes('\tjira\t'));
  assert.equal(lines.length, 2, 'both calls recorded');
  assert.equal(lines[0].split('\t')[2], lines[1].split('\t')[2], 'and under one stable key');
});

// --- the per-branch sweep (#333) --------------------------------------------
//
// A `bb` stub that serves the REST endpoint rather than `bb pr list`, and
// REFUSES the listing outright. That refusal is the point: a fix that widened
// the page instead of asking per branch would call `pr list` and this stub
// would fail it, so the tests below cannot pass by accident.
//
// `prs` maps a branch name to the pull requests it has, in the endpoint's own
// envelope shape. A branch absent from the map answers `size: 0` — an honest
// absence — and a branch named in `fail` refuses with a chosen message and code.
//
// EACH PAYLOAD IS WRITTEN TO A FILE AND `cat`ed, NEVER EMBEDDED AS A TOKEN.
// Linux caps a single argument at `MAX_ARG_STRLEN` (128 KB) and macOS does not,
// so the 886-row payload the cost test needs — 148 KB once quoted — ran here
// and produced ZERO rows on CI, with the call count still correct because the
// calls were made and only their output was lost. Measured 2026-09-20 against
// run 35533420716. A file has no such ceiling and the stub stays one process.
function makeSweepBbStub({ prs = {}, fail = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-sweep-'));
  const callsFile = path.join(dir, 'bb.calls');
  const payloadFor = (key, rows) => {
    const f = path.join(dir, `payload-${Buffer.from(key).toString('hex').slice(0, 40)}.json`);
    writeFileSync(f, JSON.stringify({ size: rows.length, values: rows }));
    return f;
  };
  const body = `#!/usr/bin/env bash
if [[ "$*" == *"--version"* ]]; then echo "bb version 1.9.0"; exit 0; fi
if [[ "$*" == *"--help"* ]]; then echo "bb pr list help"; exit 0; fi
printf '%s\\n' "$*" >> ${JSON.stringify(callsFile)}
# THE LISTING IS REFUSED. A sweep must never reach for it.
if [ "$1" != "api" ]; then echo "stub: bb pr list must not be called on a sweep" >&2; exit 9; fi
path="$2"
${Object.entries(fail).map(([frag, v]) =>
  `if [[ "$path" == *${JSON.stringify(frag)}* ]]; then echo ${JSON.stringify(v.said ?? 'error: HTTP 500')} >&2; exit ${v.code ?? 1}; fi`).join('\n')}
${Object.entries(prs).map(([key, rows]) =>
  `if [[ "$path" == *${JSON.stringify(key)}* ]]; then cat ${JSON.stringify(payloadFor(key, rows))}; exit 0; fi`).join('\n')}
printf '%s' '{"size":0,"values":[]}'
`;
  writeFileSync(path.join(dir, 'bb'), body);
  chmodSync(path.join(dir, 'bb'), 0o755);
  return { dir, callsFile };
}

// One REST pull request object, in the shape the endpoint returns. The field
// names are Bitbucket's, not the adapter's — the whole point of the `--rich`
// question the plan called its decisive risk is that these six map onto what
// the arm emits.
const restPr = (id, branch, state = 'MERGED') => ({
  id, title: `PR ${id}`, state,
  source: { branch: { name: branch } },
  draft: false,
  links: { html: { href: `https://bitbucket.org/x/${id}` } },
  // BITBUCKET'S OWN SPELLING, which the arm renames to `updatedAt`. Carried on
  // the fixture so the rename is asserted rather than assumed: a row reaching
  // the store under Bitbucket's name would leave the watermark permanently
  // null, and the store would be unadvanceable for a reason nothing reported.
  updated_on: `2026-09-20T12:00:0${id % 10}+00:00`,
});

const sweepCalls = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean);
const sweepComplete = (stderr) => /pr-list sweep complete/.test(stderr);

test('host: a branch whose merged PR is older than the first page is found', () => {
  // THE MEASURED CASE, and the assertion a fix that merely widens the page
  // fails. On `quatico/quaweb-website` the repository holds 886 merged pull
  // requests and `bb pr list` returns 50; PR 902 on
  // `feature/ki-anwendungen-unter-angebote` is one of the 836 a listing cannot
  // reach, and the endpoint answers `size: 1 | values: 1 | ids: 902` for it in
  // one call. The stub refuses `bb pr list` entirely, so a page-widening fix
  // cannot pass this.
  const branch = 'feature/ki-anwendungen-unter-angebote';
  const bb = makeSweepBbStub({ prs: { [`MERGED%22%20AND%20source.branch.name=%22feature%2Fki`]: [restPr(902, branch)] } });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000', '--rich',
    '--branch', branch, '--branch', 'feature/no-pr-here'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const rows = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows.length, 1, 'exactly the one branch that has a PR emits a row');
  assert.equal(rows[0].number, 902, 'PR 902 — invisible to a listing — is found');
  assert.equal(rows[0].head, branch, 'the row is keyed by the branch the join indexes on');
  assert.equal(rows[0].state, 'MERGED');
});

test('host: the sweep request path carries its leading slash', () => {
  // `bb api` concatenates "${BB_API}${path}", so a path without the leading
  // slash yields `…/2.0repositories/…` and an HTTP 403 that reads exactly like
  // a missing scope. A previous plan was rejected for inferring a scope problem
  // from this symptom, so the slash is pinned rather than trusted.
  const bb = makeSweepBbStub();
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'merged', '--rich', '--branch', 'x'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const calls = sweepCalls(bb.callsFile);
  assert.equal(calls.length, 1, 'one state, one branch, one call');
  assert.match(calls[0], /^api \/repositories\//,
    'the path starts with a slash — without it this is a 403 that reads as a scope error');
});

test('host: the sweep encodes a branch name that contains a slash', () => {
  // `feature/x` is the ordinary shape here. An unencoded `/` inside the `q=`
  // value ends the filter early, so the query would ask about `feature` and
  // answer about the wrong branch — or about none at all.
  const bb = makeSweepBbStub();
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'merged', '--rich',
    '--branch', 'feature/ki-anwendungen-unter-angebote'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const call = sweepCalls(bb.callsFile)[0];
  assert.match(call, /feature%2Fki-anwendungen-unter-angebote/, 'the slash is percent-encoded');
  assert.ok(!/name=%22feature\//.test(call), 'no raw slash survives inside the q= value');
  assert.match(call, /%20AND%20/, 'the space between the two filter terms is encoded too');
});

test('host: a branch name cannot break out of the q= filter', () => {
  // A `"` inside a branch name would close the filter's quoted value early, the
  // same class of defect as the unencoded slash but against the QUERY GRAMMAR
  // rather than the URL — and a branch name is free text. Encoded to %22, so the
  // filter still reads one value and the host is asked about a branch that
  // simply does not exist.
  const bb = makeSweepBbStub();
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'merged', '--rich',
    '--branch', 'weird"name'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const call = sweepCalls(bb.callsFile)[0];
  assert.match(call, /weird%22name/, 'the quote is encoded, not passed through');
  assert.ok(!/name="/.test(call), 'no raw quote reaches the request line');
  // WHAT THIS DOES AND DOES NOT BUY. Encoding keeps the quote inert as a URL
  // character; Bitbucket still decodes `q=` before parsing it, so a name
  // genuinely containing one yields a malformed filter the host REFUSES. That
  // is the safe direction and the one the sweep already handles: a refused
  // query fails its state, no completeness is claimed, and nothing is answered
  // about the wrong branch. `git check-ref-format` forbids `"` in a ref name,
  // so this is unreachable through git and pinned against a future caller that
  // passes a name from somewhere else.
});

test('host: an honest absence is a complete answer, not a failure', () => {
  // `size: 0` means this branch has no pull request in this state — an EXACT
  // answer, and the distinction `plot-fleet-scan.sh:876` protects. The sweep
  // exits 0, emits no row for that branch, and still states its completeness:
  // an answer of "none" is an answer.
  const bb = makeSweepBbStub();
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000', '--rich',
    '--branch', 'a', '--branch', 'b'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, 'an empty answer is not an error');
  assert.equal(res.stdout.trim(), '', 'no branch had a PR, so no row is emitted');
  assert.ok(sweepComplete(res.stderr), 'a sweep that answered for every branch says so');
});

test('host: a refused sweep is distinguishable from an empty one', () => {
  // The other half, and one without the other passes a fix that reads every
  // outage as "no PR". The `merged` state refuses; the rows of the states that
  // answered survive on stdout, the exit code is the PARTIAL one, and the
  // completeness claim is WITHHELD — absence is no longer derivable for a
  // branch whose merged query never ran.
  const bb = makeSweepBbStub({
    prs: { 'OPEN%22%20AND%20source.branch.name=%22live': [restPr(5, 'live', 'OPEN')] },
    fail: { MERGED: { said: 'error: HTTP 500 — server error', code: 1 } },
  });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000', '--rich',
    '--branch', 'live', '--branch', 'other'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 7, 'a partial sweep exits PR_LIST_PARTIAL_RC, never 0');
  const rows = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows.length, 1, 'the states that answered still serve their rows');
  assert.equal(rows[0].number, 5);
  assert.ok(!sweepComplete(res.stderr), 'a partial sweep makes NO completeness claim');
  assert.match(res.stderr, /missing: merged/, 'and it names which state went unanswered');
});

test('host: a totally refused sweep keeps the failure code, never the partial one', () => {
  // A genuine outage must never read as a partial page. Every state refuses, so
  // the code is the failure's own — `pr_list_failed`'s 3 for an unclassified
  // failure — and nothing is claimed.
  const bb = makeSweepBbStub({ fail: { pullrequests: { said: 'error: HTTP 403 — Forbidden', code: 1 } } });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000', '--rich',
    '--branch', 'a'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 3, 'a total outage keeps the code it has always had');
  assert.equal(res.stdout.trim(), '', 'a failed sweep prints no rows');
  assert.ok(!sweepComplete(res.stderr), 'and makes no completeness claim');
  assert.match(res.stderr, /no state answered/, 'it says this is not a partial answer');
});

test('host: the host failure text survives the sweep and is classified once', () => {
  // A throttled host must reach the caller as THROTTLED, and the classification
  // must happen exactly once. Measured while building this: classifying inside
  // the per-branch query AND again around the sweep made the second pass read
  // the first pass's prose, and an `HTTP 429` became "the host failed the
  // request and said nothing" — the reader sent to check a login that was fine.
  const bb = makeSweepBbStub({
    fail: { pullrequests: { said: 'error: HTTP 429 — Rate limit for this resource has been exceeded', code: 1 } },
  });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'merged', '--limit', '1000', '--rich',
    '--branch', 'a'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 6, 'a burst refusal keeps its own exit code through the sweep');
  assert.match(res.stderr, /Rate limit for this resource has been exceeded/,
    "the host's own sentence reaches the reader, not a re-classification of it");
});

test('host: sweep calls are proportional to tracked branches, not to PR history', () => {
  // THE COST PROPERTY, stated with both measured numbers. The repository holds
  // 886 merged pull requests and the board tracks 11 branches; the sweep makes
  // branches × states calls and NOT ONE MORE, so its cost is constant in pull
  // request count. A fix that is correct and still scales with PR history fails
  // here: the stub serves 886 merged PRs and the call count stays 33.
  const eleven = Array.from({ length: 11 }, (_, i) => `feature/branch-${i}`);
  // Every one of the 886 lives on one branch, so a listing would return them all.
  const many = Array.from({ length: 886 }, (_, i) => restPr(1000 + i, eleven[0]));
  const bb = makeSweepBbStub({ prs: { 'MERGED%22%20AND%20source.branch.name=%22feature%2Fbranch-0': many } });
  const args = ['pr-list', '--state', 'all', '--limit', '1000', '--rich'];
  for (const b of eleven) args.push('--branch', b);
  const res = spawnSync('bash', [adapter, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const calls = sweepCalls(bb.callsFile);
  assert.equal(calls.length, 33, '11 branches × 3 states = 33 calls, whatever the PR history holds');
  assert.equal(res.stdout.trim().split('\n').filter(Boolean).length, 886,
    'and every row the host had for a tracked branch is served');
});

test('host: a payload larger than one argv slot still reaches stdout', () => {
  // A REAL DEFECT, AND THE WORST SHAPE IT COULD TAKE. The sweep first joined its
  // per-branch answers with `jq --argjson add "$payload"`, which hands a whole
  // branch's rows to `jq` through argv — and Linux caps ONE argument at
  // `MAX_ARG_STRLEN` (128 KB) where macOS has no ceiling at all.
  //
  // Measured 2026-09-20 in a Debian container: a branch carrying 886 merged
  // pull requests is a 147 KB payload, `jq` died with "Argument list too long",
  // the accumulator came back empty, and the sweep exited 0 while printing NO
  // ROWS and still stating its completeness. A confident "no pull requests"
  // over a branch that had 886 — the fabricated verdict this whole slice exists
  // to remove, rebuilt one layer inside the fix. It passed on macOS and failed
  // only where CI and every board actually run.
  //
  // The answers are spooled to a file and joined once instead. This pins the
  // SIZE rather than the mechanism: a future accumulator that reintroduces an
  // argv hop fails here regardless of how it spells it.
  const branch = 'feature/huge';
  const key = 'MERGED%22%20AND%20source.branch.name=%22feature%2Fhuge';
  // Padded titles take one branch's payload well past 128 KB on its own, so the
  // limit is crossed by a SINGLE query rather than by the total.
  const rows = Array.from({ length: 400 }, (_, i) => ({
    ...restPr(2000 + i, branch),
    title: `PR ${2000 + i} ${'x'.repeat(400)}`,
  }));
  const bb = makeSweepBbStub({ prs: { [key]: rows } });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'merged', '--limit', '1000', '--rich',
    '--branch', branch], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!/Argument list too long/i.test(res.stderr), 'no payload travels through argv');
  assert.equal(res.stdout.trim().split('\n').filter(Boolean).length, rows.length,
    'every row survives a payload larger than one argument may be');
  // THE HALF THAT MAKES IT A BUG RATHER THAN A SHORTFALL: the old shape claimed
  // completeness over the rows it had just lost.
  assert.match(res.stderr, /sweep complete/, 'and the completeness claim covers rows that actually arrived');
});

test('host: the sweep states its completeness, and names both counts', () => {
  // THE CONTRACT `plot-fleet-scan.sh` READS to write `.list-complete`. Its
  // wording is pinned on both sides: the scan matches the phrase, and a reader
  // shown the claim can check it against the counts.
  const bb = makeSweepBbStub();
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000', '--rich',
    '--branch', 'a', '--branch', 'b', '--branch', 'c'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const line = res.stderr.split('\n').find((l) => /sweep complete/.test(l));
  assert.ok(line, 'a whole sweep says so');
  assert.match(line, /3 branches asked/, 'it names how many branches it asked about');
  assert.match(line, /3 of 3 states answered/, 'and how many states answered');
});

test('host: a sweep makes no page-truncation claim', () => {
  // The page detector's rule is about a LISTING that can report neither a total
  // nor a cursor. A sweep's row count has no page semantics at all — two rows
  // from eleven branches is a complete answer, not a short one — so running the
  // detector here would print "possibly truncated" immediately before the arm
  // states the answer was whole, which is the adapter contradicting itself.
  const bb = makeSweepBbStub({ prs: { 'MERGED%22%20AND%20source.branch.name=%22a': [restPr(1, 'a')] } });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000', '--rich',
    '--branch', 'a', '--branch', 'b'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(truncationReports(res.stderr).length, 0, 'a sweep is not a page and claims no truncation');
  assert.ok(sweepComplete(res.stderr), 'it makes the stronger claim instead');
  assert.ok(!/ignores --limit/.test(res.stderr), 'and owes no fixed-page warning either');
});

test('host: naming no branch leaves the listing exactly as it was', () => {
  // THE OPT-IN. Four callers pass no branches today, and every one of them must
  // see the behaviour it has always seen — which is what lets the truncation
  // tests above pass unedited. The strict stub refuses `bb api`, so a sweep
  // leaking onto this path would fail here.
  const bb = makeStrictBbStub({ perState: { open: '[]', merged: bbFullPage(50), declined: '[]' } });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim().split('\n').filter(Boolean).length, 50, 'the listing still serves its page');
  assert.equal(truncationReports(res.stderr).length, 1, 'and the page detector still fires on it');
  assert.ok(!sweepComplete(res.stderr), 'a listing makes no sweep claim');
});

test('host: the GitHub arm is untouched by --branch', () => {
  // The sweep is Bitbucket's answer to a Bitbucket asymmetry: `gh pr list`
  // takes `--state all` in ONE call and honours `--limit`, so it has neither
  // the truncation this fixes nor a reason to pay 33 calls for 11 branches.
  // Passing branches there must change nothing at all.
  const stubs = makeStubs({ ghJson: JSON.stringify([{ number: 7, title: 't', state: 'MERGED', headRefName: 'a' }]) });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'all', '--limit', '1000',
    '--branch', 'a', '--branch', 'b'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.equal(res.status, 0, res.stderr);
  const argv = readFileSync(stubs.ghArgv, 'utf8');
  assert.match(argv, /--state\nall/, 'gh still gets one --state all call');
  assert.ok(!/--branch/.test(argv), 'and is never handed the branch list');
  assert.ok(!sweepComplete(res.stderr), 'the GitHub arm makes no sweep claim');
  const rows = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows[0].number, 7, 'its rows are unchanged');
});

test('host: the sweep emits every --rich field the arm promises', () => {
  // THE PLAN'S DECISIVE RISK, resolved in its favour by the adapter lens and
  // pinned here: the REST envelope must supply what `--rich` emits, or the
  // slice scopes down and says which field it dropped. Nothing was dropped.
  const bb = makeSweepBbStub({ prs: { 'MERGED%22%20AND%20source.branch.name=%22a': [restPr(11, 'a')] } });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'merged', '--limit', '1000', '--rich',
    '--branch', 'a'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const row = JSON.parse(res.stdout.trim());
  assert.deepEqual(Object.keys(row).sort(),
    ['checks', 'draft', 'failing_checks', 'head', 'mergeable', 'number', 'review', 'state', 'title',
      'updatedAt', 'url'].sort(),
    'the field set is exactly what the listing arm emits');
  assert.equal(row.url, 'https://bitbucket.org/x/11', 'url comes from .links.html.href');
  // THE HOST'S STAMP UNDER THE ADAPTER'S NAME. Bitbucket says `updated_on` and
  // GitHub says `updatedAt`; one name reaches a consumer, or a store keyed on
  // either would hold half the rows' freshness and advance by none of it.
  assert.equal(row.updatedAt, '2026-09-20T12:00:01+00:00',
    'updated_on is carried through under the adapter\'s one name');
  assert.equal(row.draft, false);
  assert.equal(row.checks, 'unknown', 'Bitbucket carries no rollup — honest, not green');
  assert.deepEqual(row.failing_checks, []);
});

test('host: the sweep folds DECLINED into CLOSED, as the listing does', () => {
  // The state mapping is the arm's, not the endpoint's, and both paths must
  // produce one vocabulary — a consumer joining rows from either cannot be made
  // to tell which path produced them.
  const bb = makeSweepBbStub({ prs: { 'DECLINED%22%20AND%20source.branch.name=%22a': [restPr(12, 'a', 'DECLINED')] } });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'declined', '--limit', '1000', '--rich',
    '--branch', 'a'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout.trim()).state, 'CLOSED', 'DECLINED folds to CLOSED');
});

// --- the window: pr-list --since (the delta slice) --------------------------
//
// One `gh pr list --state all` over 933 pull requests takes 29 811 ms with the
// fields the board needs. The same call with `--search "updated:>"` over one
// day takes 943 ms for 3 rows — factor 32, with every expensive field still
// included, which is why the answer is a narrower CALL rather than a cache in
// front of the same one.
//
// WHAT THESE PIN is the translation and nothing above it. Whether to send a
// window is `prWindowFor`'s decision and is asserted in the domain; what the
// adapter owes is that a stamp becomes the right host filter, that it composes
// with the state filter Bitbucket already carries, and that a backend which
// cannot narrow SAYS so rather than answering in full silently.

test('host: --since becomes a gh --search window, and nothing else changes', () => {
  const stubs = makeStubs({ ghJson: '[]' });
  const res = spawnSync('bash', [adapter, 'pr-list', '--rich', '--state', 'all',
    '--limit', '1000', '--since', '2026-09-20T18:42:10Z'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.equal(res.status, 0, res.stderr);
  const argv = argvOf(stubs.ghArgv);
  // THE STAMP TRAVELS BYTE-FOR-BYTE. A caller that re-rendered it would send
  // its own clock's spelling of the host's value, and a client two seconds fast
  // excludes the PRs updated in that gap from every later window — forever,
  // because the window never reopens.
  assert.ok(argv.includes('--search'), 'the window reaches gh as a search');
  assert.equal(argv[argv.indexOf('--search') + 1], 'updated:>2026-09-20T18:42:10Z');
  // The rest of the call is untouched: same state, same limit, same fields.
  assert.ok(argv.includes('--state') && argv[argv.indexOf('--state') + 1] === 'all');
  assert.ok(argv.includes('--limit') && argv[argv.indexOf('--limit') + 1] === '1000');
});

test('host: no --since means the call gh has always been sent', () => {
  // THE DONE-WHEN, asserted as an ABSENCE. A `--search` with an empty value
  // would reach GitHub as `updated:>`, which is a syntax error the host may
  // answer with everything or with nothing — and either reading is worse than
  // the full call this is meant to preserve.
  const stubs = makeStubs({ ghJson: '[]' });
  const res = spawnSync('bash', [adapter, 'pr-list', '--rich', '--state', 'all', '--limit', '1000'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!argvOf(stubs.ghArgv).includes('--search'), 'no window, no search');
});

test('host: --since with an empty value is refused, never sent', () => {
  // The one shape that "works" and asks the wrong question. A caller whose
  // watermark was null would send exactly this.
  const stubs = makeStubs({ ghJson: '[]' });
  const res = spawnSync('bash', [adapter, 'pr-list', '--rich', '--since', ''], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.notEqual(res.status, 0, 'an empty window is a caller bug and fails loudly');
  assert.equal(res.stdout.trim(), '', 'and prints nothing, so no reader sees an empty list');
});

test('host: --since is carried on the plain (non-rich) gh call too', () => {
  // THREE CALL SITES, ONE WINDOW. The arm branches on rich × Jenkins into three
  // gh invocations, and `pr_list_call`'s own header makes the argument: a fix
  // applied by hand at some of them is a fix that drifts, and the arm that
  // drifts is the one nobody's repo exercises.
  const stubs = makeStubs({ ghJson: '[]' });
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'open',
    '--since', '2026-09-20T18:42:10Z'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs.dir}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  assert.equal(res.status, 0, res.stderr);
  const argv = argvOf(stubs.ghArgv);
  assert.equal(argv[argv.indexOf('--search') + 1], 'updated:>2026-09-20T18:42:10Z');
});

test('host: --since composes with the sweep q=, rather than replacing it', () => {
  // THE DONE-WHEN. Bitbucket takes ONE `q=` parameter, so a second one would
  // silently win or lose depending on the host's parsing — and either way the
  // state clause this query is built around is the term at risk.
  const bb = makeSweepBbStub();
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'merged', '--rich',
    '--branch', 'feature/x', '--since', '2026-09-20T18:42:10Z'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const call = sweepCalls(bb.callsFile)[0];
  // ALL THREE TERMS SURVIVE, joined by the conjunction the first two already use.
  assert.match(call, /state=%22MERGED%22/, 'the state clause is intact');
  assert.match(call, /source.branch.name=%22feature%2Fx%22/, 'the branch clause is intact');
  // THE OPERATOR TRAVELS LITERALLY AND THE VALUE IS ENCODED, which is the same
  // split the two clauses above already use: `state=` and `AND` are query
  // grammar, `%22MERGED%22` is a value. Encoding `>=` would break the filter
  // rather than protect it.
  assert.match(call, /%20AND%20updated_on>=%22/,
    'the window is a third term joined by AND, not a second q=');
  assert.equal(call.match(/q=/g).length, 1, 'exactly one q= parameter');
});

test('host: the sweep encodes the stamp, so a colon cannot end the filter', () => {
  // AN ISO STAMP IS NOT URL-SAFE, the same rule the branch name follows two
  // tests up: `:` and `-` are outside `url_encode`'s safe set, and the block
  // header records what an unencoded value costs — a `/` ends the filter early,
  // so the query asks about one thing and answers about another.
  const bb = makeSweepBbStub();
  const res = spawnSync('bash', [adapter, 'pr-list', '--state', 'merged', '--rich',
    '--branch', 'x', '--since', '2026-09-20T18:42:10Z'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  const call = sweepCalls(bb.callsFile)[0];
  assert.match(call, /%222026-09-20T18%3A42%3A10Z%22/, 'the colons are encoded inside the value');
  assert.ok(!/18:42:10/.test(call), 'no raw colon survives inside the q= value');
});

test('host: a bitbucket LISTING says it cannot narrow, and answers in full', () => {
  // THE DISCOVERY THIS SLICE MADE. `bb pr list` takes --state, --author, --json
  // and --jq and has NO query flag — verified against bb 1.9.0, which answers
  // `unknown flag: --query`. So the bulk listing cannot carry a window at all.
  //
  // SAID RATHER THAN SWALLOWED, for the reason `--limit` is said one block up:
  // a caller that asked for a window and got a full listing must not read the
  // answer as a delta. It would advance its watermark over a window it never
  // applied — harmless this pass, since a full listing holds every row a narrow
  // one would, and wrong the moment the caller uses the flag to decide whether
  // its answer was complete.
  const bb = makeStrictBbStub({ json: '[]' });
  const res = spawnSync('bash', [adapter, 'pr-list', '--rich', '--state', 'open',
    '--since', '2026-09-20T18:42:10Z'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bb.dir}:${process.env.PATH}`, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /since/i, 'the shortfall is reported, never swallowed');
  // AND THE FLAG NEVER REACHES `bb`, which would refuse it. The strict stub is
  // what makes this an assertion rather than a hope.
  assert.ok(!callsOf(bb.callsFile).some((c) => c.includes('--since')));
  assert.ok(!callsOf(bb.callsFile).some((c) => c.includes('--query')));
});
