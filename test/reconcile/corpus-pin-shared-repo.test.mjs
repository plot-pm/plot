// THE CORPUS NEVER WRITES A REF THE SHARED REPOSITORY OWNS.
//
// Slice 1 of docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md. On
// 2026-09-04 and 2026-10-03 `refs.corpus.test.ts`'s `beforeAll` wrote
// `refs/remotes/origin/HEAD` in the shared repository and relied on `afterAll`
// to restore it; a run killed in between left the corruption behind (#1259).
//
// These tests run `pinClone` from `packages/domain/corpus/pin-clone.ts`, the
// one function that `beforeAll` calls, against a fixture repository standing in
// for ROOT. The kill test stops it after each of its steps and compares every
// ref of the fixture, `origin/HEAD` included, before and after.
//
// Against the sequence on main (`update-ref` then `symbolic-ref
// refs/remotes/origin/HEAD` in ROOT), the kill after `source` reads
// `origin/plot-corpus-pin` where `origin/main` was, and the test fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = path.join(here, '..', '..', 'packages', 'domain', 'corpus', 'pin-clone.ts');
const { PIN, PIN_STEPS, pinClone } = await import(pathToFileURL(helper).href);

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd }).trim();
const rmTree = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** A bare origin with two branches, and a checkout of it with `origin/HEAD` set: the stand-in for ROOT. */
const sharedRepo = (label) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `plot-corpus-shared-${label}-`));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const seed = path.join(root, 'seed');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, seed);
  fs.writeFileSync(path.join(seed, 'CLAUDE.md'), '# fixture\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  git(seed, 'push', '-q', 'origin', 'main');
  fs.writeFileSync(path.join(seed, 'feature.txt'), 'work\n');
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'work');
  git(seed, 'push', '-q', 'origin', 'HEAD:feature/work');
  git(root, 'clone', '-q', origin, work);
  return { root, work };
};

/** Every ref of a repository with its target, symrefs spelled out: one string to compare. */
const refList = (cwd) => git(cwd, 'for-each-ref', '--format=%(refname) %(objectname) %(symref)');

const symref = (cwd) => git(cwd, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');

/**
 * Runs `pinClone(work)` in a child process under `under`. With `stopAt`, the
 * child blocks after that step and is killed with SIGKILL, so the kill lands
 * exactly between two steps rather than at a timed guess.
 */
const runPin = (work, under, { stopAt } = {}) =>
  new Promise((resolve) => {
    const program = `
      const { pinClone } = await import(${JSON.stringify(pathToFileURL(helper).href)});
      const done = pinClone(${JSON.stringify(work)}, {
        under: ${JSON.stringify(under)},
        step: (name) => {
          process.stdout.write('step ' + name + '\\n');
          if (name === ${JSON.stringify(stopAt ?? '')}) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
        },
      });
      process.stdout.write('done ' + JSON.stringify(done) + '\\n');
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', program]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stopAt && stdout.includes(`step ${stopAt}\n`)) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const backstop = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('exit', (code, signal) => {
      clearTimeout(backstop);
      const line = stdout.split('\n').find((l) => l.startsWith('done '));
      resolve({ code, signal, stdout, stderr, done: line ? JSON.parse(line.slice(5)) : undefined });
    });
  });

for (const stopAt of PIN_STEPS) {
  test(`corpus pin: killed after "${stopAt}" leaves every shared ref untouched`, async () => {
    const { root, work } = sharedRepo(`killed-${stopAt}`);
    const under = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-corpus-under-'));
    const before = refList(work);

    const result = await runPin(work, under, { stopAt });
    assert.equal(result.signal, 'SIGKILL', `the child was killed after "${stopAt}":\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.done, undefined, 'and never finished');

    assert.equal(symref(work), 'origin/main', 'origin/HEAD still names origin/main');
    assert.equal(refList(work), before, 'every ref of the shared repository is byte-identical');

    rmTree(under);
    rmTree(root);
  });
}

test('corpus pin: a completed run pins the clone and writes nothing shared', () => {
  const { root, work } = sharedRepo('completed');
  const under = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-corpus-under-'));
  const before = refList(work);
  const mainSha = git(work, 'rev-parse', 'refs/remotes/origin/main');

  const pinned = pinClone(work, { under });

  assert.equal(refList(work), before, 'the shared repository is byte-identical');
  assert.equal(pinned.main, 'main');
  assert.equal(pinned.pinned, mainSha);
  assert.equal(git(pinned.clone, 'rev-parse', `refs/remotes/origin/${PIN}`), mainSha, 'the clone carries origin/plot-corpus-pin');
  assert.equal(
    git(pinned.clone, 'rev-parse', 'refs/remotes/origin/feature/work'),
    git(work, 'rev-parse', 'refs/remotes/origin/feature/work'),
    'the clone carries the shared repository\'s remote-tracking branches, not only its local ones',
  );
  assert.equal(symref(pinned.clone), 'origin/main', 'the clone\'s origin/HEAD names the real default branch');
  assert.match(fs.readFileSync(path.join(pinned.clone, 'CLAUDE.md'), 'utf8'), /## Plot Config\s*\n- \*\*Main branch:\*\* plot-corpus-pin\n/);

  // The fetch `plot-fleet-scan.sh` makes: it succeeds and moves nothing.
  const clonedRefs = refList(pinned.clone);
  git(pinned.clone, 'fetch', '-q', '--prune', 'origin', PIN, '+refs/heads/*:refs/remotes/origin/*');
  assert.equal(refList(pinned.clone), clonedRefs, 'the scan\'s fetch from the frozen source changes no ref');

  rmTree(under);
  rmTree(root);
});

test('corpus pin: two parallel runs do not collide (#1319)', async () => {
  const { root, work } = sharedRepo('parallel');
  const under = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-corpus-under-'));
  const before = refList(work);
  const headBefore = symref(work);

  const [first, second] = await Promise.all([runPin(work, under), runPin(work, under)]);
  assert.equal(first.code, 0, `first run failed:\n${first.stderr}`);
  assert.equal(second.code, 0, `second run failed:\n${second.stderr}`);
  assert.notEqual(first.done.dir, second.done.dir, 'each run made its own directory');

  // Each clone holds exactly the refs one run alone writes: the same names at
  // the same SHAs, and no ref naming the other run's directory.
  const firstRefs = refList(first.done.clone);
  const secondRefs = refList(second.done.clone);
  assert.equal(firstRefs, secondRefs, 'the two clones hold identical ref lists');
  assert.match(firstRefs, new RegExp(`refs/remotes/origin/${PIN} `));
  assert.ok(!firstRefs.includes(second.done.dir) && !secondRefs.includes(first.done.dir));

  assert.equal(symref(work), headBefore, 'the shared origin/HEAD is unchanged');
  assert.equal(refList(work), before, 'every shared ref is byte-identical');

  rmTree(under);
  rmTree(root);
});
