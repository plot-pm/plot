// Contract test for skills/plot/scripts/plot-brief-name-gate.sh — the gate that
// refuses a hand-off brief added or renamed to `<prefix>-<slug>.md`, a name no
// reader computes. Builds throwaway git repos and drives the gate the way
// Claude Code does: hook JSON on stdin, in the repository.
//
// THE PASS CASES CARRY AS MUCH WEIGHT AS THE REFUSALS. Every agent in the fleet
// commits through this hook, so a false refusal blocks the fleet. Each pass
// case below names the naive implementation it catches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const gate = path.join(scripts, 'plot-brief-name-gate.sh');

const brief = '# Implementation brief\n';

// A repo with `committed` in HEAD, then `files` written and staged on top
// (unless `stage` is false).
const repo = ({ committed = {}, files = {}, stage = true, config } = {}) => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plot-brief-name-gate-'));
  const dir = path.join(tmp, 'repo');
  mkdirSync(dir, { recursive: true });
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  const write = (rel, body) => {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  if (config !== undefined) write('CLAUDE.md', `# X\n\n## Plot Config\n\n${config}\n`);
  for (const [rel, body] of Object.entries(committed)) write(rel, body);
  sh('git add -A && git commit -qm init --allow-empty');
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  if (stage) sh('git add -A');
  return { dir, sh };
};

const run = (dir, command = 'git commit -m x', input) =>
  spawnSync('bash', [gate], {
    cwd: dir,
    input: input ?? JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  });

test('brief-name gate: adding <prefix>-<slug>.md is refused and names the computed path', () => {
  const { dir } = repo({ files: { '.plot/briefs/infra-x.md': brief } });
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /\.plot\/briefs\/infra-x\.md/);
  assert.match(r.stderr, /git mv \.plot\/briefs\/infra-x\.md \.plot\/briefs\/x\.md/, 'the refusal prints the rename');
});

test('brief-name gate: every default prefix is refused', () => {
  for (const p of ['idea', 'feature', 'bug', 'docs', 'infra']) {
    const { dir } = repo({ files: { [`.plot/briefs/${p}-a-slug.md`]: brief } });
    const r = run(dir);
    assert.equal(r.status, 2, `${p}- must block (stderr: ${r.stderr})`);
    assert.match(r.stderr, /\.plot\/briefs\/a-slug\.md/);
  }
});

test('brief-name gate: a git mv to a misnamed path is refused, read as a rename', () => {
  // A test that only staged new files would pass an implementation reading
  // --diff-filter=A. This is a real `git mv`, which the index holds as R100.
  const { dir, sh } = repo({ committed: { '.plot/briefs/good.md': brief } });
  sh('git mv .plot/briefs/good.md .plot/briefs/feature-good.md');
  assert.match(sh('git diff --cached --name-status -M').toString(), /^R100/, 'the fixture is a rename');
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /\.plot\/briefs\/good\.md/);
});

test('brief-name gate: a git mv that repairs a misnamed brief passes', () => {
  const { dir, sh } = repo({ committed: { '.plot/briefs/bug-x.md': brief } });
  sh('git mv .plot/briefs/bug-x.md .plot/briefs/x.md');
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
});

test('brief-name gate: adding <slug>.md passes', () => {
  const { dir } = repo({ files: { '.plot/briefs/a-brief-is-named-by-the-rule.md': brief } });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});

test('brief-name gate: a brief for a branch that does not exist passes', () => {
  // Catches a membership check: this repo has no branch and no plan named x.
  const { dir, sh } = repo({ files: { '.plot/briefs/a-branch-nobody-cut.md': brief } });
  assert.equal(sh('git branch --list "*a-branch-nobody-cut*"').toString().trim(), '');
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
});

test('brief-name gate: a modify of an existing misnamed brief passes', () => {
  // Catches a check reading every staged path under .plot/briefs/. A legacy
  // repository must stay able to edit the file on its way to repairing it.
  const { dir } = repo({
    committed: { '.plot/briefs/feature-legacy.md': brief },
    files: { '.plot/briefs/feature-legacy.md': `${brief}more\n` },
  });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
});

test('brief-name gate: a prefix word without the dash passes', () => {
  // Catches a startswith(prefix) that forgot the `-`.
  const { dir } = repo({
    files: {
      '.plot/briefs/bugfix-parser.md': brief,
      '.plot/briefs/feature.md': brief,
      '.plot/briefs/infrastructure-map.md': brief,
    },
  });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
});

test('brief-name gate: a prefixed name outside the briefs directory passes', () => {
  const { dir } = repo({
    files: {
      'docs/feature-x.md': brief,
      '.plot/briefs/sub/feature-x.md': brief,
      '.plot/briefs/feature-x.txt': brief,
    },
  });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
});

test('brief-name gate: a brief written and committed in one chained command is refused', () => {
  // The hook fires before `git add` runs, so the index alone does not hold it.
  const { dir } = repo({ files: { '.plot/briefs/feature-x.md': brief }, stage: false });
  const r = run(dir, 'git add .plot/briefs/feature-x.md && git commit -m "plot: brief"');
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /\.plot\/briefs\/x\.md/);
  assert.match(r.stderr, /mv \.plot\/briefs\/feature-x\.md/);
});

test('brief-name gate: git add -A in the same command is read too', () => {
  const { dir } = repo({ files: { '.plot/briefs/bug-y.md': brief }, stage: false });
  const r = run(dir, 'git add -A && git commit -m x');
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
});

test('brief-name gate: a chained git mv to a misnamed path is refused', () => {
  const { dir } = repo({ committed: { '.plot/briefs/good.md': brief } });
  const r = run(dir, 'git mv .plot/briefs/good.md .plot/briefs/docs-good.md && git commit -m x');
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
});

test('brief-name gate: a chained add of an already-committed misnamed brief is a modify and passes', () => {
  const { dir } = repo({
    committed: { '.plot/briefs/feature-legacy.md': brief },
    files: { '.plot/briefs/feature-legacy.md': `${brief}more\n` },
    stage: false,
  });
  const r = run(dir, 'git add .plot/briefs/feature-legacy.md && git commit -m x');
  assert.equal(r.status, 0, r.stderr);
});

test('brief-name gate: the prefixes come from config', () => {
  const { dir } = repo({
    config: '- **Branch prefixes:** `feat/`, `fix/`',
    files: { '.plot/briefs/fix-x.md': brief, '.plot/briefs/bug-y.md': brief },
  });
  const r = run(dir);
  assert.equal(r.status, 2, `fix- must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /fix-x\.md/);
  assert.doesNotMatch(r.stderr, /bug-y\.md/, 'bug/ is not configured here');
});

test('brief-name gate: a config with no Branch prefixes key falls back to the default', () => {
  // Absent is not false: a missing key never means "refuse nothing".
  const { dir } = repo({
    config: '- **Plan directory:** docs/plans/',
    files: { '.plot/briefs/feature-x.md': brief },
  });
  const r = run(dir);
  assert.equal(r.status, 2, r.stderr);
});

test('brief-name gate: a command that is not a commit passes', () => {
  const { dir } = repo({ files: { '.plot/briefs/feature-x.md': brief } });
  const r = run(dir, 'git status');
  assert.equal(r.status, 0);
});

test('brief-name gate: fails open on invalid hook JSON', () => {
  const { dir } = repo({ files: { '.plot/briefs/feature-x.md': brief } });
  const r = run(dir, undefined, '{not json');
  assert.equal(r.status, 0, r.stderr);
});

test('brief-name gate: fails open outside a git repository', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-brief-name-gate-nogit-'));
  mkdirSync(path.join(dir, '.plot', 'briefs'), { recursive: true });
  writeFileSync(path.join(dir, '.plot', 'briefs', 'feature-x.md'), brief);
  const r = run(dir, 'git add -A && git commit -m x');
  assert.equal(r.status, 0, r.stderr);
});
