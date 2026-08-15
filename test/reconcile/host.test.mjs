// Contract test for skills/plot/scripts/plot-host.sh — the Git-host adapter.
// Uses PATH-stubbed gh/bb executables: each stub records its argv and emits
// canned JSON, so the tests pin (a) backend resolution and (b) the exact
// argument mapping + output normalization per backend, fully offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');

function makeStubs({ ghJson = '{}', bbJson = '{}' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-host-'));
  const stub = (name, json) => {
    const argvFile = path.join(dir, `${name}.argv`);
    writeFileSync(
      path.join(dir, name),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvFile}"\nprintf '%s' '${json.replace(/'/g, `'\\''`)}'\n`,
    );
    chmodSync(path.join(dir, name), 0o755);
    return argvFile;
  };
  return { dir, ghArgv: stub('gh', ghJson), bbArgv: stub('bb', bbJson) };
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

const richGh = (rollup, extra = '') =>
  `[{"number":7,"title":"T","state":"OPEN","headRefName":"feature/x","isDraft":false,` +
  `"statusCheckRollup":${rollup},"reviewDecision":${extra || '""'}}]`;

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

test('host: pr-list without --rich is unchanged', () => {
  // The board is a new consumer; every existing caller must be untouched.
  const stubs = makeStubs({ ghJson: richGh('[{"conclusion":"SUCCESS"}]') });
  const out = JSON.parse(run(['pr-list'], { env: { PLOT_HOST: 'github' }, stubs }));
  assert.deepEqual(Object.keys(out).sort(), ['head', 'number', 'state', 'title']);
});
