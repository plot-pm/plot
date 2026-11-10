// Contract test: CI runs the jobs the selection names, and `validate` still
// reports every pull request.
//
// `ci.yml`'s `select` job asks `plot-local-checks.mjs --ci` and maps the answer
// to one output per job. Each gated job runs unless its output is `false`, and
// `validate` accepts a skipped job only when the selection named it `false`.
//
// THE TWO SCRIPTS RUN HERE, NOT ONLY READ. The map step and `validate`'s last
// step are cut out of `ci.yml` as text and run under `bash` with the inputs
// GitHub would give them, so a test fails when the script misbehaves, not
// only when a word moves.
//
// Part of docs/plans/2026-10-30-ci-runs-what-the-change-touches.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const CI = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

/** The text of one top-level job, from its `  <name>:` line to the next job. */
const jobBlock = (name) => {
  const lines = CI.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `${name}: must be a top-level job`);
  const rest = lines.slice(start + 1).findIndex((l) => /^ {2}[A-Za-z_][A-Za-z0-9_-]*:/.test(l));
  return lines.slice(start, rest === -1 ? lines.length : start + 1 + rest).join('\n');
};

/** The `run: |` script of the step in `job` whose text matches `marker`. */
const stepScript = (job, marker) => {
  const block = jobBlock(job);
  const steps = block.slice(block.indexOf('\n    steps:')).split(/\n(?= {6}- )/);
  const step = steps.find((s) => marker.test(s));
  assert.ok(step, `${job}: no step matches ${marker}`);
  const lines = step.split('\n');
  const at = lines.findIndex((l) => /^ {8}run: \|$/.test(l));
  assert.notEqual(at, -1, `${job}: the step must carry a run: | block`);
  return lines
    .slice(at + 1)
    .filter((l) => l === '' || l.startsWith('          '))
    .map((l) => l.slice(10))
    .join('\n');
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ci-selection-'));

/**
 * Runs the map step with the given event, ask-step outcome and files.
 *
 * @returns the outputs it wrote, as an object.
 */
const map = ({ event = 'pull_request', asked = 'success', changed = '', selection = null }) => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'changed.txt'), changed);
    if (selection !== null) fs.writeFileSync(path.join(dir, 'selection.json'), selection);
    const env = {
      PATH: process.env.PATH,
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: path.join(dir, 'out'),
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary'),
      EVENT: event,
      ASKED: asked,
    };
    const res = spawnSync('bash', ['-c', stepScript('select', /id: map/)], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    return Object.fromEntries(
      fs
        .readFileSync(env.GITHUB_OUTPUT, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const JOBS = ['corpus', 'contracts', 'board', 'domain', 'fleet', 'e2e', 'macos', 'census'];

const answer = (over) =>
  JSON.stringify({ suites: [], checks: [], tests: [], corpus: false, corpusTests: [], untested: [], ...over });

const always = { suite: '.', command: './scripts/check-script-names.sh', tests: [], always: true };

test('a push, a dispatch and a failed ask select every job', () => {
  for (const [event, asked] of [
    ['push', 'skipped'],
    ['workflow_dispatch', 'skipped'],
    ['pull_request', 'failure'],
    ['pull_request', 'skipped'],
  ]) {
    const out = map({ event, asked });
    for (const job of JOBS) assert.equal(out[job], 'true', `${event}/${asked}: ${job}`);
    assert.equal(out.contracts_tests, '', `${event}/${asked}: the whole contract suite runs`);
    assert.equal(out.corpus_tests, '', `${event}/${asked}: the whole corpus tier runs`);
  }
});

test('an answer that is not JSON selects every job', () => {
  const out = map({ changed: 'x.sh\n', selection: 'not json\n' });
  for (const job of JOBS) assert.equal(out[job], 'true', job);
});

test('a plan-only change selects the corpus tier and no other job', () => {
  const out = map({
    changed: 'docs/plans/x.md\n',
    selection: answer({ suites: ['.', 'corpus'], checks: [always], corpus: true }),
  });
  assert.equal(out.corpus, 'true');
  assert.equal(out.corpus_tests, '');
  for (const job of ['contracts', 'board', 'domain', 'fleet', 'e2e', 'macos', 'census']) assert.equal(out[job], 'false', job);
});

test('a changeset or a document outside skills/ selects no job', () => {
  const out = map({
    changed: '.changeset/x.md\ndocs/notes.md\n',
    selection: answer({ checks: [always], untested: ['.changeset/x.md', 'docs/notes.md'] }),
  });
  for (const job of JOBS) assert.equal(out[job], 'false', job);
});

test('an untested path that is not markdown outside skills/ selects every job', () => {
  for (const untested of ['pnpm-lock.yaml', 'skills/plot/templates/plan.md']) {
    const out = map({ changed: `${untested}\n`, selection: answer({ checks: [always], untested: [untested] }) });
    for (const job of JOBS) assert.equal(out[job], 'true', `${untested}: ${job}`);
    assert.equal(out.contracts_tests, '', untested);
  }
});

test('a script named by contract tests selects those files, macOS for a .sh, and e2e', () => {
  const tests = ['test/reconcile/host.test.mjs', 'test/reconcile/reap.test.mjs'];
  const out = map({
    changed: 'skills/plot/scripts/plot-host.sh\n',
    selection: answer({
      checks: [{ suite: 'test/reconcile', command: 'node --test …', tests, always: false }, always],
      corpusTests: ['packages/domain/corpus/refs.corpus.test.ts'],
    }),
  });
  assert.equal(out.contracts, 'true');
  assert.equal(out.contracts_tests, tests.join(' '));
  assert.equal(out.corpus, 'true');
  assert.equal(out.corpus_tests, 'corpus/refs.corpus.test.ts');
  assert.equal(out.macos, 'true');
  assert.equal(out.e2e, 'true');
  assert.equal(out.census, 'true', 'a shipped script is part of the product the census counts');
  for (const job of ['board', 'domain', 'fleet']) assert.equal(out[job], 'false', job);
});

test('a domain check selects the board and the fleet, which import the domain', () => {
  const out = map({
    changed: 'packages/domain/src/rules/queue.ts\n',
    selection: answer({
      checks: [{ suite: 'packages/domain', command: 'vitest related …', tests: [], always: false }, always],
    }),
  });
  for (const job of ['domain', 'board', 'fleet', 'e2e', 'census']) assert.equal(out[job], 'true', job);
  for (const job of ['contracts', 'macos', 'corpus']) assert.equal(out[job], 'false', job);
});

test('a selected gate test selects macOS without a changed .sh', () => {
  const out = map({
    changed: 'test/reconcile/state-gate.test.mjs\n',
    selection: answer({
      checks: [
        { suite: 'test/reconcile', command: 'node --test …', tests: ['test/reconcile/state-gate.test.mjs'], always: false },
      ],
    }),
  });
  assert.equal(out.macos, 'true');
  assert.equal(out.census, 'false');
});

test('a census or fleet change selects the process census, and a board change does too', () => {
  for (const [suite, file] of [
    ['packages/fleet', 'packages/fleet/test/census/census-report.ts'],
    ['packages/board', 'packages/board/src/server/fleet.ts'],
  ]) {
    const out = map({
      changed: `${file}\n`,
      selection: answer({ checks: [{ suite, command: 'vitest related …', tests: [], always: false }, always] }),
    });
    assert.equal(out.census, 'true', file);
  }
});

test('a pull request into a sprint branch that changes packages/fleet selects both census halves', () => {
  // The map step reads the event and the changed files, never the base branch.
  const out = map({ event: 'pull_request', changed: 'packages/fleet/src/x.ts\n' });
  assert.equal(out.census, 'true');
  for (const job of ['census-head', 'census-base']) {
    const block = jobBlock(job);
    assert.doesNotMatch(
      block,
      /github\.base_ref\s*(==|!=)\s*'main'/,
      `${job}: no step may test the PR base against main`,
    );
    assert.match(block, /needs\.select\.outputs\.census != 'false'/, `${job}: the selection alone gates it`);
  }
});

// ── the gated jobs ──────────────────────────────────────────────────────────

for (const [job, output] of [
  ['corpus', 'corpus'],
  ['macos-shell-contract', 'macos'],
  ['census-head', 'census'],
  ['census-base', 'census'],
  ['helper-contracts', 'contracts'],
  ['board-integration', 'board'],
]) {
  test(`${job} needs select and gates and runs unless select named it false or reused it`, () => {
    const head = jobBlock(job).split('\n    steps:')[0];
    const census = job.startsWith('census-');
    const needs = census ? '[select, gates, checks]' : '[select, gates]';
    assert.ok(head.includes(`\n    needs: ${needs}\n`), `${job} must say needs: ${needs}`);
    const after = census ? " && needs.checks.result == 'success'" : '';
    assert.ok(
      head.includes(
        `    if: \${{ !cancelled() && needs.gates.result == 'success'${after} && needs.select.outputs.${output} != 'false' && needs.select.outputs.reuse_${output} == '' }}`,
      ),
      `${job} must run when gates ended success, unless needs.select.outputs.${output} is 'false' or reuse_${output} is set`,
    );
  });
}

test('checks starts beside the split jobs, after gates, and runs unless cancelled', () => {
  const head = jobBlock('checks').split('\n    steps:')[0];
  assert.match(head, /^ {4}needs: \[select, gates\]$/m);
  assert.match(head, /^ {4}if: \$\{\{ !cancelled\(\) && needs\.gates\.result == 'success' \}\}$/m);
});

test('gates needs select and runs unless cancelled', () => {
  const head = jobBlock('gates').split('\n    steps:')[0];
  assert.match(head, /^ {4}needs: select$/m);
  assert.match(head, /^ {4}if: \$\{\{ !cancelled\(\) \}\}$/m);
});

// ── validate: the one required check ────────────────────────────────────────

test('validate needs select, gates, checks and both split jobs, and runs unless cancelled', () => {
  const head = jobBlock('validate').split('\n    steps:')[0];
  assert.match(head, /^ {4}needs: \[select, gates, checks, helper-contracts, board-integration\]$/m);
  assert.match(head, /^ {4}if: \$\{\{ !cancelled\(\) \}\}$/m);
});

/** Runs validate's last step with the given results and selections. */
const aggregate = (env) =>
  spawnSync('bash', ['-c', stepScript('validate', /name: Require the selected jobs/)], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  }).status;

const green = {
  GATES: 'success',
  CHECKS: 'success',
  HELPER_CONTRACTS: 'success',
  HELPER_CONTRACTS_SELECTED: 'true',
  BOARD_INTEGRATION: 'success',
  BOARD_INTEGRATION_SELECTED: 'true',
};

test('validate passes when every job ended success', () => {
  assert.equal(aggregate(green), 0);
});

test('validate passes a skipped job only when the selection named it false', () => {
  const skipped = {
    ...green,
    HELPER_CONTRACTS: 'skipped',
    HELPER_CONTRACTS_SELECTED: 'false',
    BOARD_INTEGRATION: 'skipped',
    BOARD_INTEGRATION_SELECTED: 'false',
  };
  assert.equal(aggregate(skipped), 0);
  assert.equal(aggregate({ ...skipped, HELPER_CONTRACTS_SELECTED: 'true' }), 1, 'a selected job that skipped');
  assert.equal(aggregate({ ...skipped, BOARD_INTEGRATION_SELECTED: '' }), 1, 'a skip with no selection');
});

test('validate fails on a failed, cancelled or skipped gates job, selected or not', () => {
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.equal(aggregate({ ...green, GATES: result }), 1, `gates ${result}`);
  }
});

test('validate fails on a tier-2 job that gates skipped while select named it', () => {
  const skipped = { ...green, GATES: 'failure', CHECKS: 'skipped', HELPER_CONTRACTS: 'skipped', BOARD_INTEGRATION: 'skipped' };
  assert.equal(aggregate(skipped), 1);
  assert.equal(aggregate({ ...green, HELPER_CONTRACTS: 'skipped', HELPER_CONTRACTS_SELECTED: 'true' }), 1);
});

test('validate fails on a failed, cancelled or skipped checks job and on a failed split job', () => {
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.equal(aggregate({ ...green, CHECKS: result }), 1, `checks ${result}`);
    assert.equal(aggregate({ ...green, HELPER_CONTRACTS: result }), 1, `helper-contracts ${result}`);
    assert.equal(aggregate({ ...green, BOARD_INTEGRATION: result }), 1, `board-integration ${result}`);
  }
});

test("validate's last step reads each job's result and carries its own if: !cancelled()", () => {
  const block = jobBlock('validate');
  const last = block.slice(block.lastIndexOf('\n      - '));
  for (const job of ['gates', 'checks', 'helper-contracts', 'board-integration']) {
    assert.ok(last.includes(`\${{ needs.${job}.result }}`), `the last step must read needs.${job}.result`);
  }
  assert.ok(last.includes('${{ needs.select.outputs.contracts }}'));
  assert.ok(last.includes('${{ needs.select.outputs.board }}'));
  assert.match(last, /^\s*if: \$\{\{ !cancelled\(\) \}\}/m);
});

// ── select records what the run tested ──────────────────────────────────────
// Part of docs/plans/2026-11-09-ci-reuses-green-runs.md.

/** The step in `job` whose text matches `marker`, as text. */
const stepText = (job, marker) => {
  const block = jobBlock(job);
  return block.slice(block.indexOf('\n    steps:')).split(/\n(?= {6}- )/).find((s) => marker.test(s));
};

const git = (cwd, ...args) => {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim();
};

/** A repository whose HEAD is a pull request merge: `HEAD^1` the base, `HEAD^2` the head. */
const mergeRepo = (dir) => {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'ci@example.invalid');
  git(dir, 'config', 'user.name', 'ci');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'topic');
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'b.md'), 'b\n');
  fs.writeFileSync(path.join(dir, 'c.sh'), 'c\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'head');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'topic');
  return { base: git(dir, 'rev-parse', 'HEAD^1'), head: git(dir, 'rev-parse', 'HEAD^2') };
};

/** Runs the record step in `cwd` with the selection outputs `sel`. */
const record = (cwd, runner, sel) =>
  spawnSync('bash', ['-c', stepScript('select', /id: record/)], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      RUNNER_TEMP: runner,
      GITHUB_OUTPUT: path.join(runner, 'out'),
      GITHUB_STEP_SUMMARY: path.join(runner, 'summary'),
      ...sel,
    },
  });

test('the record holds the merge base, the head, the changed paths and the selection', () => {
  const dir = tmp();
  try {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    const runner = path.join(dir, 'runner');
    fs.mkdirSync(runner);
    const { base, head } = mergeRepo(repo);
    const sel = {
      CORPUS: 'false', CORPUS_TESTS: '', CONTRACTS: 'true', CONTRACTS_TESTS: 'test/reconcile/x.test.mjs',
      BOARD: 'false', DOMAIN: 'false', FLEET: 'false', E2E: 'true', MACOS: 'true', CENSUS: 'false',
    };
    const res = record(repo, runner, sel);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(fs.readFileSync(path.join(runner, 'out'), 'utf8'), `name=ci-inputs-${base}-${head}\n`);
    const rec = JSON.parse(fs.readFileSync(path.join(runner, 'ci-inputs', 'ci-inputs.json'), 'utf8'));
    assert.deepEqual(rec, {
      version: 1,
      base,
      head,
      changed: ['c.sh', 'docs/b.md'],
      selection: {
        corpus: 'false', corpus_tests: '', contracts: 'true', contracts_tests: 'test/reconcile/x.test.mjs',
        board: 'false', domain: 'false', fleet: 'false', e2e: 'true', macos: 'true', census: 'false',
      },
    });
    const upload = stepText('select', /name: Upload the record/);
    assert.match(upload, /^ {10}path: \$\{\{ runner\.temp \}\}\/ci-inputs\/ci-inputs\.json$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a run whose HEAD is no merge records nothing and names no artifact', () => {
  const dir = tmp();
  try {
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'ci@example.invalid');
    git(dir, 'config', 'user.name', 'ci');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'one');
    const runner = fs.mkdtempSync(path.join(dir, 'runner-'));
    const res = record(dir, runner, {});
    assert.notEqual(res.status, 0);
    assert.ok(!fs.existsSync(path.join(runner, 'out')) || !fs.readFileSync(path.join(runner, 'out'), 'utf8').includes('name='));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing record changes no result: both steps continue on error and no job reads their outcome', () => {
  for (const marker of [/id: record/, /name: Upload the record/]) {
    assert.match(stepText('select', marker), /^ {8}continue-on-error: true$/m, `${marker} must continue on error`);
  }
  const upload = stepText('select', /name: Upload the record/);
  assert.ok(!/^ {8}id:/m.test(upload), 'the upload step carries no id, so nothing can read its outcome');
  const select = jobBlock('select');
  const header = select.split('\n    steps:')[0];
  assert.ok(!header.includes('steps.record'), "select's outputs must not carry the record");
  const others = select.slice(select.indexOf('\n    steps:')).split(/\n(?= {6}- )/).filter((s) => !/id: record|name: Upload the record/.test(s));
  for (const step of others) assert.ok(!step.includes('steps.record'), `a step other than the upload reads the record: ${step.split('\n')[0]}`);
  const rest = CI.slice(CI.indexOf(select) + select.length);
  assert.ok(!rest.includes('steps.record') && !rest.includes('ci-inputs'), 'no other job reads the record');
});

// ── select reuses the green jobs of an earlier run on the same base ─────────
// Part of docs/plans/2026-11-09-ci-reuses-green-runs.md. The read step runs
// against a fake `gh` that answers from files and logs every call, in a real
// repository whose HEAD is a pull request merge.

const REUSE_BUNDLE = path.join(ROOT, 'skills', 'plot', 'scripts', 'board', 'plot-ci-reuse.mjs');

// One log line per call: the path, then each \`-f\` field.
const FAKE_GH = `#!/usr/bin/env bash
shift
target= expr= fields=
while [ $# -gt 0 ]; do
  case $1 in
    --method) shift 2 ;;
    -f) fields="$fields $2"; shift 2 ;;
    --jq) expr=$2; shift 2 ;;
    *) target=$1; shift ;;
  esac
done
echo "$target$fields" >> "$FAKE_GH_DIR/log"
file="$FAKE_GH_DIR/$(printf '%s' "$target" | tr '/' '_')"
[ -f "$file" ] || exit 1
if [ -n "$expr" ]; then jq -c "$expr" "$file"; else cat "$file"; fi
`;

// The local-checks stub: every changed path is untested, so a markdown path
// outside skills/ selects no job and any other path selects every job.
const LOCAL_CHECKS_STUB = `import fs from 'node:fs';
const files = process.argv[process.argv.indexOf('--files') + 1];
const untested = fs.readFileSync(files, 'utf8').split('\\n').filter((l) => l !== '');
process.stdout.write(JSON.stringify({ suites: [], checks: [], tests: [], corpus: false, corpusTests: [], untested }));
`;

const SELECTED = {
  CORPUS: 'true', CORPUS_TESTS: '', CONTRACTS: 'true', CONTRACTS_TESTS: '',
  BOARD: 'true', DOMAIN: 'true', FLEET: 'true', E2E: 'true', MACOS: 'true', CENSUS: 'true',
};
const RECORDED = Object.fromEntries(Object.entries(SELECTED).map(([k, v]) => [k.toLowerCase(), v]));

const GREEN_JOBS = ['select', 'gates', 'checks', 'corpus', 'macos-shell-contract', 'helper-contracts', 'board-integration',
  'census-head', 'census-base', 'census-compare', 'validate'].map((name) => ({ name, conclusion: 'success' }));

/**
 * A pull request repository: `base` on main, `h1` and then `h2` on the topic
 * branch (both documents only), and HEAD the merge of `h2` into `base`. The
 * scripts the read step calls sit beside it.
 */
const reuseRepo = (dir) => {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'ci@example.invalid');
  git(dir, 'config', 'user.name', 'ci');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'topic');
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'b.md'), 'b\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'h1');
  const h1 = git(dir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'docs', 'c.md'), 'c\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'h2');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'topic');
  const base = git(dir, 'rev-parse', 'HEAD^1');
  const head = git(dir, 'rev-parse', 'HEAD^2');
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'ci-job-map.jq'), path.join(dir, 'scripts', 'ci-job-map.jq'));
  const board = path.join(dir, 'skills', 'plot', 'scripts', 'board');
  fs.mkdirSync(board, { recursive: true });
  fs.copyFileSync(REUSE_BUNDLE, path.join(board, 'plot-ci-reuse.mjs'));
  fs.writeFileSync(path.join(board, 'plot-local-checks.mjs'), LOCAL_CHECKS_STUB);
  return { base, head, h1 };
};

/** The fake host: run 30 is this run, 23 another pull request, 22 has only an expired record, 21 the green source, 20 an older base, 19 older still. */
const fakeHost = (dir, { base, h1, recordHead = h1 }) => {
  const api = path.join(dir, 'api');
  fs.mkdirSync(api);
  const put = (target, value) => fs.writeFileSync(path.join(api, target.replace(/\//g, '_')), JSON.stringify(value));
  const runRow = (id, prs, headSha) => ({ id, head_sha: headSha, conclusion: 'success', pull_requests: prs.map((number) => ({ number })) });
  put('repos/o/r/actions/workflows/ci.yml/runs', {
    workflow_runs: [runRow(30, [7], h1), runRow(23, [9], h1), runRow(22, [7], h1), runRow(21, [7], recordHead), runRow(20, [7], h1), runRow(19, [7], h1)],
  });
  put('repos/o/r/actions/runs/22/artifacts', {
    artifacts: [
      { id: 5, name: `ci-inputs-${base}-${h1}`, expired: true },
      { id: 6, name: 'census-head', expired: false },
    ],
  });
  put('repos/o/r/actions/runs/21/artifacts', { artifacts: [{ id: 7, name: `ci-inputs-${base}-${recordHead}`, expired: false }] });
  put('repos/o/r/actions/runs/20/artifacts', { artifacts: [{ id: 8, name: `ci-inputs-${'9'.repeat(40)}-${h1}`, expired: false }] });
  put('repos/o/r/actions/runs/19/artifacts', { artifacts: [] });
  put('repos/o/r/actions/runs/21/jobs', { jobs: GREEN_JOBS });
  const zipDir = path.join(dir, 'zip');
  fs.mkdirSync(zipDir);
  fs.writeFileSync(
    path.join(zipDir, 'ci-inputs.json'),
    JSON.stringify({ version: 1, base, head: recordHead, changed: ['docs/b.md'], selection: RECORDED }),
  );
  // `zip` appends `.zip` to a name without it, so the archive is renamed after.
  const zipped = spawnSync('zip', ['-q', '-j', path.join(zipDir, 'record.zip'), path.join(zipDir, 'ci-inputs.json')]);
  assert.equal(zipped.status, 0, 'zip must be installed');
  fs.renameSync(path.join(zipDir, 'record.zip'), path.join(api, 'repos_o_r_actions_artifacts_7_zip'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  return { api, bin };
};

/** Runs a select step by its marker in `repo`, with the fake host on PATH. */
const selectStep = (marker, { repo, runner, api, bin, env = {} }) =>
  spawnSync('bash', ['-c', stepScript('select', marker)], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_GH_DIR: api,
      RUNNER_TEMP: runner,
      GITHUB_OUTPUT: path.join(runner, 'out'),
      GITHUB_STEP_SUMMARY: path.join(runner, 'summary'),
      API_RETRY_SECONDS: '0',
      REPO: 'o/r',
      EVENT: 'pull_request',
      HEAD_REF: 'infra/x',
      PR_NUMBER: '7',
      RUN_ID: '30',
      RUN_ATTEMPT: '1',
      RUN_URL: 'https://github.com/o/r/actions/runs',
      ...SELECTED,
      ...env,
    },
  });

const outputs = (runner) => {
  const file = path.join(runner, 'out');
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
};

/** A fixture with the repository, the fake host and an empty runner directory. */
const reuseFixture = (over = {}) => {
  const dir = tmp();
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const shas = reuseRepo(repo);
  const host = fakeHost(dir, { ...shas, ...over });
  const runner = path.join(dir, 'runner');
  fs.mkdirSync(runner);
  return { dir, repo, runner, ...host, ...shas };
};

const READ = /id: reuse_read/;
const DECIDE = /id: reuse$/m;
const WARN = /name: Warn on a failed reuse read/;
const KEYS = ['corpus', 'macos', 'contracts', 'board', 'census'];

test('the read stays inside its budget: it stops at the first other base and downloads only a base-matching record', () => {
  const fx = reuseFixture();
  try {
    const res = selectStep(READ, fx);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const log = fs.readFileSync(path.join(fx.api, 'log'), 'utf8').trim().split('\n');
    assert.equal(log[0], 'repos/o/r/actions/workflows/ci.yml/runs event=pull_request status=completed branch=infra/x per_page=20');
    assert.deepEqual(
      log.slice(1).map((l) => l.split(' ')[0]),
      [
        'repos/o/r/actions/runs/22/artifacts',
        'repos/o/r/actions/runs/21/artifacts',
        'repos/o/r/actions/artifacts/7/zip',
        'repos/o/r/actions/runs/21/jobs',
        'repos/o/r/actions/runs/20/artifacts',
      ],
      'no call for this run, another pull request, an expired record or a run past the base move',
    );
    const readings = JSON.parse(fs.readFileSync(path.join(fx.runner, 'reuse', 'readings.json'), 'utf8'));
    assert.deepEqual(readings.runs.map((r) => r.id), [22, 21, 20]);
    assert.equal(readings.runs[0].record, null, 'an expired record is no record');
    assert.equal(readings.runs[1].record.base, fx.base);
    assert.equal(readings.runs[1].jobs['board-integration'], 'success');
    assert.deepEqual(KEYS.map((k) => readings.runs[1].jobMap[k]), KEYS.map(() => false), 'a documents-only push selects no job');
    assert.equal(readings.runs[2].record.base, '9'.repeat(40));
    assert.equal(readings.runs[2].jobs, null);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('a documents-only push reuses the last green run on the same base, and the summary names the source', () => {
  const fx = reuseFixture();
  try {
    assert.equal(selectStep(READ, fx).status, 0);
    const res = selectStep(DECIDE, fx);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const out = outputs(fx.runner);
    for (const key of KEYS) assert.equal(out[`reuse_${key}`], `reused:${fx.h1}`, key);
    const notices = res.stdout.split('\n').filter((l) => l.startsWith('::notice title=reused::'));
    assert.equal(notices.length, KEYS.length, 'one notice per reused job');
    assert.ok(notices.includes(`::notice title=reused::board-integration reused from run 21 at ${fx.h1}`));
    const summary = fs.readFileSync(path.join(fx.runner, 'summary'), 'utf8');
    assert.ok(summary.includes('[21](https://github.com/o/r/actions/runs/21)'), summary);
    assert.ok(summary.includes(`\`${fx.h1}\``) && summary.includes(`\`${fx.base}\``) && summary.includes('| success |'));
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('each reusable job that runs carries a reason in the summary', () => {
  const fx = reuseFixture();
  try {
    assert.equal(selectStep(READ, { ...fx, env: { RUN_ATTEMPT: '2' } }).status, 0);
    assert.equal(selectStep(DECIDE, fx).status, 0);
    const out = outputs(fx.runner);
    for (const key of KEYS) assert.equal(out[`reuse_${key}`], '', `a re-run reuses no ${key}`);
    const summary = fs.readFileSync(path.join(fx.runner, 'summary'), 'utf8');
    assert.equal(summary.split('\n').filter((l) => l.includes('| runs: re-run |')).length, KEYS.length, summary);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('a head that cannot be fetched gives no diff, and that run is no source', () => {
  const fx = reuseFixture({ recordHead: 'f'.repeat(40) });
  try {
    const res = selectStep(READ, fx);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const readings = JSON.parse(fs.readFileSync(path.join(fx.runner, 'reuse', 'readings.json'), 'utf8'));
    assert.equal(readings.runs[1].jobMap, null);
    assert.equal(selectStep(DECIDE, fx).status, 0);
    const out = outputs(fx.runner);
    for (const key of KEYS) assert.equal(out[`reuse_${key}`], '', key);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('a failed read fails its step, writes a warning naming the call, and leaves the decision unrun', () => {
  const fx = reuseFixture();
  try {
    fs.rmSync(path.join(fx.api, 'repos_o_r_actions_workflows_ci.yml_runs'));
    const res = selectStep(READ, fx);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /gh api attempt 3 of 3 failed/, 'three attempts');
    const warn = selectStep(WARN, fx);
    assert.equal(warn.status, 0);
    assert.match(warn.stdout, /^::warning::reuse read failed at the run list: every selected job runs$/m);
    assert.match(fs.readFileSync(path.join(fx.runner, 'summary'), 'utf8'), /Reuse read failed at the run list/);
    assert.match(stepText('select', DECIDE), /if: \$\{\{ github\.event_name == 'pull_request' && steps\.reuse_read\.outcome == 'success' \}\}/);
    assert.deepEqual(outputs(fx.runner), {});
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('a failed bundle writes no reuse output, and the job outputs read the decision only after a success', () => {
  const fx = reuseFixture();
  try {
    fs.mkdirSync(path.join(fx.runner, 'reuse'));
    fs.writeFileSync(path.join(fx.runner, 'reuse', 'readings.json'), 'not json');
    const res = selectStep(DECIDE, fx);
    assert.notEqual(res.status, 0);
    assert.deepEqual(outputs(fx.runner), {});
    assert.match(selectStep(WARN, fx).stdout, /^::warning::reuse read failed at the decision: every selected job runs$/m);
    const header = jobBlock('select').split('\n    steps:')[0];
    for (const key of KEYS) {
      assert.ok(
        header.includes(`      reuse_${key}: \${{ steps.reuse.outcome == 'success' && steps.reuse.outputs.reuse_${key} || '' }}`),
        `reuse_${key} must read the decision only after it succeeded`,
      );
    }
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('main and the dispatch never reuse: the steps run on pull_request only and the bundle answers empty', () => {
  for (const marker of [READ, DECIDE, WARN]) {
    assert.match(stepText('select', marker), /^ {8}if: \$\{\{ github\.event_name == 'pull_request' && /m, `${marker}`);
  }
  for (const marker of [READ, DECIDE]) assert.match(stepText('select', marker), /^ {8}continue-on-error: true$/m);
  const fx = reuseFixture();
  try {
    assert.equal(selectStep(READ, fx).status, 0);
    const readings = path.join(fx.runner, 'reuse', 'readings.json');
    for (const event of ['push', 'workflow_dispatch']) {
      const value = JSON.parse(fs.readFileSync(readings, 'utf8'));
      fs.writeFileSync(readings, JSON.stringify({ ...value, event }));
      fs.rmSync(path.join(fx.runner, 'out'), { force: true });
      assert.equal(selectStep(DECIDE, fx).status, 0);
      for (const key of KEYS) assert.equal(outputs(fx.runner)[`reuse_${key}`], '', `${event}: ${key}`);
    }
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('select holds actions: read beside contents: read, and no other job reads the Actions API', () => {
  const header = jobBlock('select').split('\n    steps:')[0];
  assert.match(header, /^ {4}permissions:\n {6}contents: read\n {6}actions: read$/m);
  assert.match(CI, /^permissions:\n {2}contents: read$/m, 'the workflow-level block stays contents: read');
});

test('one job map answers both diffs: the map step and the read step run scripts/ci-job-map.jq', () => {
  assert.match(stepScript('select', /id: map/), /-f scripts\/ci-job-map\.jq/);
  assert.doesNotMatch(stepScript('select', /id: map/), /def under/, 'the map step holds no copy of the program');
  assert.match(stepScript('select', READ), /-f scripts\/ci-job-map\.jq/);
  const res = spawnSync(
    'jq',
    ['-c', '--rawfile', 'changed', '/dev/null', '-f', path.join(ROOT, 'scripts', 'ci-job-map.jq')],
    { input: answer({ checks: [always], untested: ['pnpm-lock.yaml'] }), encoding: 'utf8' },
  );
  assert.equal(res.status, 0, res.stderr);
  const map = JSON.parse(res.stdout);
  for (const job of JOBS) assert.equal(map[job], true, job);
  assert.equal(map.widened_by, 'pnpm-lock.yaml');
});

test('each reusable job skips on its reuse value; census-compare too, and gates, checks and validate read none', () => {
  assert.ok(jobBlock('census-compare').split('\n    steps:')[0].includes("&& needs.select.outputs.census != 'false' && needs.select.outputs.reuse_census == '' }}"));
  for (const job of ['gates', 'checks', 'validate']) {
    const head = jobBlock(job).split('\n    steps:')[0];
    assert.doesNotMatch(head, /reuse_/, `${job} must not test a reuse output`);
  }
  assert.doesNotMatch(jobBlock('gates'), /reuse_/);
  assert.doesNotMatch(jobBlock('checks'), /reuse_/);
});

const SHA40 = '0123456789abcdef0123456789abcdef01234567';

test('validate accepts a reused job and nothing looser', () => {
  const reused = {
    ...green,
    HELPER_CONTRACTS: 'skipped',
    HELPER_CONTRACTS_REUSED: `reused:${SHA40}`,
    BOARD_INTEGRATION: 'skipped',
    BOARD_INTEGRATION_REUSED: `reused:${SHA40}`,
  };
  assert.equal(aggregate(reused), 0);
  for (const bad of ['reused:', 'reused:abc', `reused:${SHA40.toUpperCase()}`, `x${SHA40}`]) {
    assert.equal(aggregate({ ...reused, BOARD_INTEGRATION_REUSED: bad }), 1, `skipped with ${bad}`);
  }
  assert.equal(aggregate({ ...reused, HELPER_CONTRACTS: 'failure' }), 1, 'failure with a reuse value');
  assert.equal(aggregate({ ...reused, HELPER_CONTRACTS: 'cancelled' }), 1, 'cancelled with a reuse value');
});

test('a reused job passes only behind green gates', () => {
  const reused = { ...green, BOARD_INTEGRATION: 'skipped', BOARD_INTEGRATION_REUSED: `reused:${SHA40}` };
  assert.equal(aggregate(reused), 0);
  assert.equal(aggregate({ ...reused, GATES: 'failure' }), 1);
});

test("validate's last step reads both reuse outputs", () => {
  const block = jobBlock('validate');
  const last = block.slice(block.lastIndexOf('\n      - '));
  assert.ok(last.includes('HELPER_CONTRACTS_REUSED: ${{ needs.select.outputs.reuse_contracts }}'));
  assert.ok(last.includes('BOARD_INTEGRATION_REUSED: ${{ needs.select.outputs.reuse_board }}'));
});
