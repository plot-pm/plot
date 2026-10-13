// THE `CI:` KEY CARRIES ITS INSTANCE, and the two are read apart.
//
// This is `the-ci-key-splits-into-scheme-and-instance`, slice 1 of
// docs/plans/2026-09-09-the-ci-key-carries-its-instance.md. Measured against a
// real Jenkins on 2026-09-09: `ci_backend()` returns the WHOLE `CI:` value
// lowercased, and every caller matches it against a bare word, so
// `` CI: Jenkins at `jenkins-ci-ewz…` `` answered `basis=unknown` where the
// adapter had `predicted: 60` ready. Only the bare word worked and no real
// repository writes it.
//
// THE FUNCTIONS ARE EXERCISED DIRECTLY, sourced out of the adapter. It is a
// dispatcher rather than a library, so it is sourced with a harmless op
// (`backend`) — that runs one `case` arm and leaves every function defined.
// The alternative was reading the split through `ci-limit`, which cannot
// separate this slice's parsing from slice 2's callers: the four call sites
// still ask `ci_backend()`, deliberately, so no op observes the new functions
// yet.
//
// A SEPARATE FILE because `test/reconcile/host.test.mjs` is the named
// regression surface for the bare-word contract and this slice must not edit
// it. It keeps passing untouched, which is what proves the spelling that
// already worked still works.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every directory this file creates, removed after its last test by the exact
// path mkdtempSync returned — never by a glob over the shared temp directory.
const made = [];
const scratch = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');

/**
 * A repository whose `## Plot Config` says exactly what a test declares.
 *
 * A REAL REPOSITORY IS NEEDED, not just an env var: `PLOT_CI` and the `CI` key
 * are two sources with two precedences, and the `Jenkins instance` key has no
 * env-only expression at all. Run from this checkout's root, `plot-config.sh`
 * reads THIS repository's keys — measured in host.test.mjs, whose no-CI tests
 * passed until Plot declared its own `CI` key. The absence and the value both
 * have to come from a repository saying so.
 */
const repoWith = (keys) => {
  const repo = scratch('plot-ci-scheme-');
  const lines = Object.entries(keys).map(([k, v]) => `- **${k}:** ${v}`).join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `## Plot Config\n\n${lines}\n`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
};

/**
 * Sources the adapter and prints one function's answer.
 *
 * `backend` is passed as the op because sourcing with NO argument reaches the
 * usage `die` and exits before any assertion can run. Stdout of the op itself
 * is discarded; only the expression's output is returned.
 */
const call = (expr, { repo = os.tmpdir(), env = {} } = {}) => {
  const res = spawnSync('bash', ['-c', `. "${adapter}" backend >/dev/null 2>&1; ${expr}`], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PLOT_HOST: 'github', ...env },
  });
  return { code: res.status, out: res.stdout.trim(), err: res.stderr };
};

// --- ci_scheme: all four real-world spellings -----------------------------

// THE FOUR SPELLINGS ARE ONE TEST because a `= "jenkins"` implementation that
// only ever saw this repository's own value passes any one of them alone. The
// three prose forms are the values measured across the Quatico estate; the
// bare word is the one that already worked and must keep working.
const JENKINS_SPELLINGS = [
  ['the bare word', 'jenkins'],
  ['a backticked host', 'Jenkins at `jenkins.example.com` (Bitbucket PRs trigger builds)'],
  ['a pipeline path', 'Jenkins pipelines in `.build/pipelines/` (one per service)'],
  ['an example list', 'Jenkins (e.g. continuous-build, nightly)'],
];

for (const [label, value] of JENKINS_SPELLINGS) {
  test(`ci_scheme: ${label} reads as jenkins`, () => {
    const got = call('ci_scheme', { repo: repoWith({ CI: value }) });
    assert.equal(got.out, 'jenkins', `\`CI: ${value}\` must name the scheme jenkins`);
  });
}

test('ci_scheme: a trailing note does not hide github-actions either', () => {
  // `:2692` opens a `case` with a bare `github-actions)` arm and has the same
  // defect — this repository escapes only by writing the word alone. Slice 2
  // moves that caller; the parsing that makes it possible is asserted here.
  const got = call('ci_scheme', { repo: repoWith({ CI: 'github-actions (see .github/workflows/ci.yml)' }) });
  assert.equal(got.out, 'github-actions');
});

test('ci_scheme: a repository that declares no CI answers empty', () => {
  // ABSENT IS NOT FALSE, and an empty scheme is what `ci_unaskable()` reads to
  // tell *nobody declared a CI system* from *the system has no connector*.
  const got = call('ci_scheme', { repo: repoWith({ 'Git host': 'github' }) });
  assert.equal(got.out, '');
});

// --- PLOT_CI is split like the config value -------------------------------

test('ci_scheme: PLOT_CI prose is split the same way the CI key is', () => {
  // `PLOT_CI` IS A PRODUCTION CONTRACT, not a test override —
  // `build-actions.ts:39` passes `{ PLOT_CI: SYSTEM }` as the dispatch
  // contract the arm reads. A connector's bare `SYSTEM` word and a person's
  // prose must reach ONE comparison, so the variable is split like the key.
  const got = call('ci_scheme', { env: { PLOT_CI: 'Jenkins at `jenkins.example.com`' } });
  assert.equal(got.out, 'jenkins');
});

test('ci_scheme: a bare PLOT_CI word still answers itself', () => {
  const got = call('ci_scheme', { env: { PLOT_CI: 'github-actions' } });
  assert.equal(got.out, 'github-actions');
});

test('ci_scheme: PLOT_CI overrides the CI key, as it always has', () => {
  const repo = repoWith({ CI: 'Jenkins at `jenkins.example.com`' });
  const got = call('ci_scheme', { repo, env: { PLOT_CI: 'github-actions' } });
  assert.equal(got.out, 'github-actions', 'env first, then the CI key — the precedence ci_backend() had');
});

// --- the exit code, not the emptiness -------------------------------------

test('ci_scheme exits 0 when it answers nothing', () => {
  // READ THE EXIT CODE, NOT THE EMPTINESS. An empty instance is an answer —
  // *this value names none* — so a caller must be able to tell it from a
  // function that failed. Both answer empty at exit 0 here.
  const repo = repoWith({ 'Git host': 'github' });
  const got = call('ci_scheme', { repo });
  assert.equal(got.code, 0, 'ci_scheme exits 0 while answering empty');
  assert.equal(got.out, '');
});
