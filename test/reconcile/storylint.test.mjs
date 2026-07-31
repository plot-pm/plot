// Contract test for skills/plot/scripts/plot-story-lint.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const lint = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-story-lint.sh');

function estate(stories) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-lint-'));
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  writeFileSync(path.join(dir, 'README.md'), '## Active Stories — test coverage notes\n\n- [good](docs/stories/good/STORY-good.md)\n');
  for (const [p, content] of Object.entries(stories)) {
    const full = path.join(dir, p);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  sh('git add -A && git commit -qm init');
  return dir;
}

function run(dir) {
  try {
    return { code: 0, out: execFileSync('bash', [lint], { cwd: dir, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: e.stdout?.toString() ?? '' };
  }
}

const fm = (status, extra = '') => `---\ntitle: x\nstatus: ${status}\n${extra}---\n\n# x\n`;

test('story-lint: clean estate exits 0', () => {
  const dir = estate({ 'docs/stories/good/STORY-good.md': fm('active') });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /story-lint: 0 finding/);
});

test('story-lint: S1 folder without STORY file', () => {
  const dir = estate({
    'docs/stories/good/STORY-good.md': fm('active'),
    'docs/stories/stub/notes.md': 'x',
  });
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /S1 .*stub/);
});

test('story-lint: S2 missing frontmatter', () => {
  const dir = estate({ 'docs/stories/good/STORY-good.md': '# no frontmatter\n' });
  const r = run(dir);
  assert.match(r.out, /S2 .*good/);
});

test('story-lint: S3 done but not archived', () => {
  const dir = estate({ 'docs/stories/good/STORY-good.md': fm('done') });
  const r = run(dir);
  assert.match(r.out, /S3 .*good/);
});

test('story-lint: done + archived date passes S3', () => {
  const dir = estate({ 'docs/stories/good/STORY-good.md': fm('done', 'archived: 2026-01-01\n') });
  const r = run(dir);
  assert.doesNotMatch(r.out, /S3/);
});

test('story-lint: shipped/copied STORY-template.md never creates a home (C1)', () => {
  const dir = estate({
    'docs/stories/good/STORY-good.md': fm('active'),
    'docs/templates/STORY-template.md': fm('draft'),
    'skills/story-tracking/STORY-template.md': fm('draft'),
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /story-lint: 0 finding/);
});

test('story-lint: archived story is scanned once, not twice (I1)', () => {
  const dir = estate({
    'docs/stories/good/STORY-good.md': fm('active'),
    'docs/stories/archived/old/STORY-old.md': '# no frontmatter\n',
  });
  const r = run(dir);
  assert.match(r.out, /story-lint: 1 finding/);
});

test('story-lint: S4 is path-based — common-word slugs still flagged (I2)', () => {
  // README contains the word "test" in prose but not the story path
  const dir = estate({
    'docs/stories/good/STORY-good.md': fm('active'),
    'docs/stories/test/STORY-test.md': fm('active'),
  });
  const r = run(dir);
  assert.match(r.out, /S4 .*STORY-test/);
});

test('story-lint: nested project (own CLAUDE.md, no index) is skipped, not false-flagged', () => {
  const dir = estate({
    'docs/stories/good/STORY-good.md': fm('active'),
    'fixtures/mini/CLAUDE.md': '# mini project\n',
    'fixtures/mini/docs/stories/thing/STORY-thing.md': fm('active'),
  });
  const r = run(dir);
  assert.equal(r.code, 0);
});

test('story-lint: S4 active story missing from index', () => {
  const dir = estate({
    'docs/stories/good/STORY-good.md': fm('active'),
    'docs/stories/hidden/STORY-hidden.md': fm('active'),
  });
  const r = run(dir);
  assert.match(r.out, /S4 .*hidden/);
});
