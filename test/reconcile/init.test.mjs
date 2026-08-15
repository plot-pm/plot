// Contract test for skills/plot/scripts/plot-detect-repo.sh — the adoption
// probe. It answers "what is this repo like?" so /plot-init can PROPOSE
// settings rather than interview the user about things already visible.
//
// It is strictly READ-ONLY: a probe that edits the repo it is inspecting
// would be unusable as the first thing a stranger runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const detect = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-detect-repo.sh');

let tmp;
function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function probe(cwd) {
  return JSON.parse(execFileSync('bash', [detect], { encoding: 'utf8', cwd }));
}
/** A repo with the given files, committed. */
function repoWith(files, { remote, commits = [] } = {}) {
  const r = fs.mkdtempSync(path.join(tmp, 'repo-'));
  git(r, 'init', '-q', '-b', 'main');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(r, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(r, p), content);
  }
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', commits[0] ?? 'init');
  for (const c of commits.slice(1)) git(r, 'commit', '-q', '--allow-empty', '-m', c);
  if (remote) git(r, 'remote', 'add', 'origin', remote);
  return r;
}

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-init-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('detect: reports the git host from the origin URL', () => {
  const gh = repoWith({ 'a.txt': 'x' }, { remote: 'git@github.com:acme/thing.git' });
  assert.equal(probe(gh).git_host, 'github');
  const bb = repoWith({ 'a.txt': 'x' }, { remote: 'https://bitbucket.org/acme/thing.git' });
  assert.equal(probe(bb).git_host, 'bitbucket');
  const none = repoWith({ 'a.txt': 'x' });
  assert.equal(probe(none).git_host, '');
});

test('detect: finds Definition-of-Done candidates in package.json scripts', () => {
  const r = repoWith({
    'package.json': JSON.stringify({
      scripts: { test: 'vitest', lint: 'eslint .', build: 'tsc', unrelated: 'echo hi' },
    }),
  });
  const d = probe(r);
  assert.ok(d.dod_candidates.includes('test'), 'test is a DoD candidate');
  assert.ok(d.dod_candidates.includes('lint'));
  assert.ok(!d.dod_candidates.includes('unrelated'), 'only recognised gate names');
});

test('detect: infers the ticket scheme from commit subjects', () => {
  const r = repoWith({ 'a.txt': 'x' }, {
    commits: ['QUACDS-12 first thing', 'QUACDS-13 second thing', 'no ticket here'],
  });
  assert.equal(probe(r).ticket_prefix, 'QUACDS');
  // A repo without tickets must report absence, not guess.
  const plain = repoWith({ 'a.txt': 'x' }, { commits: ['just a commit'] });
  assert.equal(probe(plain).ticket_prefix, '');

  // A SINGLE stray key is not a scheme. Without this the detector would
  // propose a ticket prefix to a repo that has none, and the user would
  // have to notice and undo it — exactly the kind of confident-but-wrong
  // proposal that makes people stop trusting the whole probe.
  const stray = repoWith({ 'a.txt': 'x' }, {
    commits: ['ONEOFF-1 mentioned once', 'normal commit', 'another normal one'],
  });
  assert.equal(probe(stray).ticket_prefix, '', 'one occurrence is not a scheme');
});

test('detect: lists pre-existing planning systems without judging them', () => {
  const r = repoWith({
    'docs/plans/2026-01-01-old.md': '# old',
    'docs/stories/README.md': '# stories',
    '.omc/notes.md': 'x',
  });
  const d = probe(r);
  assert.ok(d.existing_systems.includes('docs/plans'));
  assert.ok(d.existing_systems.includes('docs/stories'));
  assert.ok(d.existing_systems.includes('.omc'));
});

test('detect: names the hub doc, and reports both when both exist', () => {
  assert.equal(probe(repoWith({ 'CLAUDE.md': '# hub' })).hub_docs, 'CLAUDE.md');
  assert.equal(probe(repoWith({ 'AGENTS.md': '# hub' })).hub_docs, 'AGENTS.md');
  const both = probe(repoWith({ 'CLAUDE.md': '# a', 'AGENTS.md': '# b' })).hub_docs;
  assert.match(both, /CLAUDE\.md/);
  assert.match(both, /AGENTS\.md/);
  assert.equal(probe(repoWith({ 'x.txt': 'x' })).hub_docs, '');
});

test('detect: reports whether Plot Config already exists', () => {
  assert.equal(probe(repoWith({ 'CLAUDE.md': '# hub\n' })).has_plot_config, false);
  assert.equal(
    probe(repoWith({ 'CLAUDE.md': '# hub\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n' }))
      .has_plot_config, true);
});

test('detect: reports the commit-subject style so agents can match it', () => {
  // Arlo-style notations differ per repo (F: vs F -). An adopted reviewer
  // agent that checks the wrong one flags correct commits as violations.
  const colon = repoWith({ 'a.txt': 'x' }, { commits: ['F: fix the thing', 'R: rename it'] });
  assert.equal(probe(colon).commit_style, 'arlo-colon');
  const dash = repoWith({ 'a.txt': 'x' }, { commits: ['F - fix the thing', 'R - rename it'] });
  assert.equal(probe(dash).commit_style, 'arlo-dash');
  const conv = repoWith({ 'a.txt': 'x' }, { commits: ['feat: a thing', 'fix: another'] });
  assert.equal(probe(conv).commit_style, 'conventional');
});

test('detect: is read-only — the probed repo is untouched', () => {
  const r = repoWith({ 'a.txt': 'x', 'package.json': '{"scripts":{"test":"vitest"}}' });
  const before = git(r, 'status', '--porcelain');
  probe(r);
  assert.equal(git(r, 'status', '--porcelain'), before);
  assert.equal(git(r, 'status', '--porcelain').trim(), '', 'nothing may be created');
});

test('detect: survives a repo with nothing in it', () => {
  // The first thing a stranger runs must not crash on a bare repo.
  const r = fs.mkdtempSync(path.join(tmp, 'bare-'));
  git(r, 'init', '-q', '-b', 'main');
  const d = probe(r);
  assert.equal(d.git_host, '');
  assert.deepEqual(d.dod_candidates, []);
  assert.equal(d.hub_docs, '');
});

test('detect: language hint counts word occurrences, not lines', () => {
  // `grep -c` counts matching LINES, so a hub doc with several German words
  // on one line scored 1 and was reported as English. The hint only nudges
  // template wording, but a detector that is wrong on an obvious case
  // undermines confidence in the ones that matter.
  const de = repoWith({
    'CLAUDE.md': '# Hub\n\nUnd nicht mehr, das sollte werden und muss.\n',
  });
  assert.equal(probe(de).language_hint, 'de');
  const en = repoWith({
    'CLAUDE.md': '# Hub\n\nThis project uses the following conventions.\n',
  });
  assert.equal(probe(en).language_hint, 'en');
});

test('detect: a hostname merely containing "github" is not GitHub', () => {
  // The globs were substring matches: `*bitbucket.*` matched
  // git.mybitbucket.internal.example.com, and a path segment could spoof the
  // host entirely. A detector that calls itself conservative must not guess
  // from a substring — the value feeds a proposal the user is asked to trust.
  const spoof = repoWith({ 'a.txt': 'x' },
    { remote: 'https://evil.example.com/notgithub.com.evil/x.git' });
  assert.equal(probe(spoof).git_host, '', 'a path segment must not decide the host');
  const selfhosted = repoWith({ 'a.txt': 'x' },
    { remote: 'https://git.mybitbucket.internal.example.com/team/x.git' });
  assert.equal(probe(selfhosted).git_host, '', 'a self-hosted lookalike is not bitbucket.org');
  // Real ones still resolve, in each supported URL form.
  assert.equal(probe(repoWith({ 'a.txt': 'x' }, { remote: 'git@github.com:a/b.git' })).git_host, 'github');
  assert.equal(probe(repoWith({ 'a.txt': 'x' }, { remote: 'https://bitbucket.org/a/b.git' })).git_host, 'bitbucket');
});

test('detect: finds quality gates in workspace packages, not only the root', () => {
  // A monorepo root often carries no gates of its own. Reading only the root
  // reports "no quality gates" — and the Definition of Done is the single
  // question /plot-init insists on, so an empty answer there is the worst
  // possible miss.
  const r = repoWith({
    'package.json': JSON.stringify({ workspaces: ['packages/*'], scripts: { postinstall: 'x' } }),
    'packages/api/package.json': JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .' } }),
  });
  const d = probe(r);
  assert.ok(d.dod_candidates.includes('test'), `expected test among ${JSON.stringify(d.dod_candidates)}`);
  assert.ok(d.dod_candidates.includes('lint'));
});
