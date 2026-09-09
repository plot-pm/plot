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

test('detect: counts the ticket prefix it saw, and does not decide it', () => {
  // THE COUNT IS THE READING AND THE SCHEME IS THE PROPOSAL. This file used
  // to hold `awk '$1 >= 2'`, so *one occurrence is not a scheme* was a
  // threshold no test could reach. It is `proposeTicket`'s now — asserted in
  // packages/domain/test/stack.test.ts — and what is asserted here is that
  // the probe reports what it measured.
  const r = repoWith({ 'a.txt': 'x' }, {
    commits: ['QUACDS-12 first thing', 'QUACDS-13 second thing', 'no ticket here'],
  });
  const d = probe(r);
  assert.equal(d.ticket_prefix, 'QUACDS');
  assert.equal(d.ticket_prefix_count, 2, 'the count travels with the prefix');
  assert.equal(d.subjects_read, 3, 'and the sample it was read from');

  // A repo without tickets must report absence, not guess.
  const plain = repoWith({ 'a.txt': 'x' }, { commits: ['just a commit'] });
  assert.equal(probe(plain).ticket_prefix, '');
  assert.equal(probe(plain).ticket_prefix_count, 0);

  // A SINGLE stray key is REPORTED, with its count of one. The probe no
  // longer suppresses it — suppressing was the decision — and the rule is
  // what refuses to propose from one occurrence.
  const stray = repoWith({ 'a.txt': 'x' }, {
    commits: ['ONEOFF-1 mentioned once', 'normal commit', 'another normal one'],
  });
  assert.equal(probe(stray).ticket_prefix, 'ONEOFF');
  assert.equal(probe(stray).ticket_prefix_count, 1,
    'one occurrence is reported as one, and the rule decides what that means');
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

test('detect: counts each commit notation and names no winner', () => {
  // Arlo-style notations differ per repo (F: vs F -). An adopted reviewer
  // agent that checks the wrong one flags correct commits as violations — so
  // the probe measures how many subjects match each, and `proposeCommitStyle`
  // decides which wins and whether any clears the bar.
  const colon = repoWith({ 'a.txt': 'x' }, { commits: ['F: fix the thing', 'R: rename it'] });
  assert.equal(probe(colon).commit_style_counts.colon, 2);
  assert.equal(probe(colon).commit_style_counts.dash, 0);
  const dash = repoWith({ 'a.txt': 'x' }, { commits: ['F - fix the thing', 'R - rename it'] });
  assert.equal(probe(dash).commit_style_counts.dash, 2);
  const conv = repoWith({ 'a.txt': 'x' }, { commits: ['feat: a thing', 'fix: another'] });
  assert.equal(probe(conv).commit_style_counts.conventional, 2);
});

test('detect: reports no style word at all', () => {
  // The field left behind is the second answer this removes. A collector that
  // stops deciding must also stop reporting the decision.
  const d = probe(repoWith({ 'a.txt': 'x' }, { commits: ['feat: a thing', 'fix: another'] }));
  assert.ok(!('commit_style' in d), 'commit_style is the rule\'s answer, not the probe\'s');
  assert.ok(!('language_hint' in d), 'language_hint likewise');
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

test('detect: counts German word occurrences, not lines', () => {
  // `grep -c` counts matching LINES, so a hub doc with several German words
  // on one line scored 1 and was reported as English. The count is the
  // reading; `proposeLanguage` turns it into `de` or `en`, and answers
  // neither where there was no hub doc to sample at all.
  const de = repoWith({
    'CLAUDE.md': '# Hub\n\nUnd nicht mehr, das sollte werden und muss.\n',
  });
  assert.ok(probe(de).german_words >= 3,
    `expected several German words, got ${probe(de).german_words}`);
  const en = repoWith({
    'CLAUDE.md': '# Hub\n\nThis project uses the following conventions.\n',
  });
  assert.equal(probe(en).german_words, 0);
  // No hub doc is not the same reading as an English one.
  assert.equal(probe(repoWith({ 'x.txt': 'x' })).german_words, 0);
  assert.equal(probe(repoWith({ 'x.txt': 'x' })).hub_docs, '');
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

test('detect: reads the Jenkins host a self-describing doc names', () => {
  // THE SLUG HALF OF `Jenkins instance`, and the half that is measurable. The
  // container path is a fact about the Jenkins job tree, so adoption asks it.
  const r = repoWith({
    'README.md':
      '# quaweb-website\n' +
      'Builds: https://jenkins-ci-webbloqs.internal.quatico.dev/job/quaweb/\n' +
      'See jenkins-ci-webbloqs.internal.quatico.dev for status.\n',
    '.build/pipelines/website/release/Jenkinsfile': 'pipeline {}\n',
  });
  assert.equal(probe(r).jenkins_host, 'jenkins-ci-webbloqs.internal.quatico.dev');
});

test('detect: a repository naming no Jenkins reports no host', () => {
  // The normal case. A `Jenkinsfile` says Jenkins builds this without saying
  // WHICH Jenkins, so an empty reading is what adoption asks from.
  const r = repoWith({
    'README.md': '# thing\nNothing about CI here.\n',
    'Jenkinsfile': 'pipeline {}\n',
  });
  assert.equal(probe(r).jenkins_host, '');
});

test('detect: the host is read from self-describing files, never every markdown', () => {
  // MEASURED 2026-09-09 ON PLOT ITSELF. A `*.md` corpus reported
  // `jenkins-ci-webbloqs.internal.quatico.dev` for a repository that runs no
  // Jenkins, read out of a plan citing the host as another repo's example. A
  // proposal from that reading points the connector at a stranger's server,
  // which answers `NOT reachable` — indistinguishable from a Jenkins that is
  // down.
  const r = repoWith({
    'README.md': '# thing\nNo CI named here.\n',
    'docs/plans/a-plan.md': 'Measured in quaweb: jenkins-ci-webbloqs.internal.quatico.dev\n',
  });
  assert.equal(probe(r).jenkins_host, '',
    'a hostname quoted as evidence in a plan is not this repository\'s Jenkins');
});

test('detect: the most repeated host wins where a doc names two', () => {
  const r = repoWith({
    'README.md':
      'Primary: jenkins-main.example.dev\n' +
      'Also jenkins-main.example.dev again.\n' +
      'Legacy was jenkins-old.example.dev once.\n',
  });
  assert.equal(probe(r).jenkins_host, 'jenkins-main.example.dev');
});

test('detect: an untracked Jenkins hostname cannot answer for the repository', () => {
  // BOUNDED BY GIT, never a tree walk — the same rule the Jenkinsfile search
  // takes. An unstaged fixture is not the repository describing itself.
  const r = repoWith({ 'README.md': '# thing\n' });
  fs.writeFileSync(path.join(r, 'README.local.md'), 'jenkins-ghost.example.dev\n');
  assert.equal(probe(r).jenkins_host, '');
});
