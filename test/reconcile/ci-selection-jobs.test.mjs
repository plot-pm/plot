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
const CI = fs.readFileSync(path.join(here, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');

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
    const res = spawnSync('bash', ['-c', stepScript('select', /id: map/)], { env, encoding: 'utf8' });
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

const JOBS = ['corpus', 'contracts', 'board', 'domain', 'fleet', 'e2e', 'macos'];

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
  for (const job of ['contracts', 'board', 'domain', 'fleet', 'e2e', 'macos']) assert.equal(out[job], 'false', job);
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
  for (const job of ['board', 'domain', 'fleet']) assert.equal(out[job], 'false', job);
});

test('a domain check selects the board and the fleet, which import the domain', () => {
  const out = map({
    changed: 'packages/domain/src/rules/queue.ts\n',
    selection: answer({
      checks: [{ suite: 'packages/domain', command: 'vitest related …', tests: [], always: false }, always],
    }),
  });
  for (const job of ['domain', 'board', 'fleet', 'e2e']) assert.equal(out[job], 'true', job);
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
});

// ── the gated jobs ──────────────────────────────────────────────────────────

for (const [job, output] of [
  ['corpus', 'corpus'],
  ['macos-shell-contract', 'macos'],
  ['helper-contracts', 'contracts'],
  ['board-integration', 'board'],
]) {
  test(`${job} needs select and runs unless select named it false`, () => {
    const head = jobBlock(job).split('\n    steps:')[0];
    assert.match(head, /^ {4}needs: select$/m);
    assert.ok(
      head.includes(`    if: \${{ !cancelled() && needs.select.outputs.${output} != 'false' }}`),
      `${job} must run unless needs.select.outputs.${output} is 'false'`,
    );
  });
}

test('checks starts beside the split jobs and runs unless cancelled', () => {
  const head = jobBlock('checks').split('\n    steps:')[0];
  assert.match(head, /^ {4}needs: select$/m);
  assert.match(head, /^ {4}if: \$\{\{ !cancelled\(\) \}\}$/m);
});

// ── validate: the one required check ────────────────────────────────────────

test('validate needs select, checks and both split jobs, and runs unless cancelled', () => {
  const head = jobBlock('validate').split('\n    steps:')[0];
  assert.match(head, /^ {4}needs: \[select, checks, helper-contracts, board-integration\]$/m);
  assert.match(head, /^ {4}if: \$\{\{ !cancelled\(\) \}\}$/m);
});

/** Runs validate's last step with the given results and selections. */
const aggregate = (env) =>
  spawnSync('bash', ['-c', stepScript('validate', /name: Require the selected jobs/)], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  }).status;

const green = {
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
  for (const job of ['checks', 'helper-contracts', 'board-integration']) {
    assert.ok(last.includes(`\${{ needs.${job}.result }}`), `the last step must read needs.${job}.result`);
  }
  assert.ok(last.includes('${{ needs.select.outputs.contracts }}'));
  assert.ok(last.includes('${{ needs.select.outputs.board }}'));
  assert.match(last, /^\s*if: \$\{\{ !cancelled\(\) \}\}/m);
});
