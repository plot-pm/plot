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
  assert.deepEqual(out, { number: 7, state: 'OPEN', draft: true, url: 'https://example.test/pr/7' });
  assert.deepEqual(argvOf(stubs.ghArgv), ['pr', 'view', '7', '--json', 'number,state,isDraft,url']);
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
