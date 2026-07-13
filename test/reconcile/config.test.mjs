// Contract test for skills/plot/scripts/plot-config.sh — the Plot Config
// accessor. Specification by example: the CLAUDE.md written below is the
// supported config grammar; the assertions state exactly what each line
// yields. Runs in a temp dir (not a git repo → the accessor falls back to
// the working directory) so the host repo's own CLAUDE.md can't interfere.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const accessor = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-config.sh');

let tmp;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-config-'));
  fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), `# Some project

Plan directory: not/config/prose — outside the section, must never match.

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- Plan directory: plans/
  - **Delivered index:** \`plans/delivered/\`
<!-- - **Main branch:** develop -->

## Other Section

- **Active index:** wrong/section/ — must never match.
`);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function get(key, def = '') {
  return execFileSync('bash', [accessor, 'get', key, def], { encoding: 'utf8', cwd: tmp }).trimEnd();
}

test('config: bold list form', () => {
  assert.equal(get('Branch prefixes'), 'idea/, feature/, bug/, docs/, infra/');
});

test('config: plain list form', () => {
  assert.equal(get('Plan directory'), 'plans/');
});

test('config: indented + backtick-quoted value', () => {
  assert.equal(get('Delivered index'), 'plans/delivered/');
});

test('config: key is case-insensitive', () => {
  assert.equal(get('plan DIRECTORY'), 'plans/');
});

test('config: HTML-commented example lines never match', () => {
  assert.equal(get('Main branch', 'DEFAULT'), 'DEFAULT');
});

test('config: prose outside the section never matches', () => {
  // "Plan directory:" appears in prose before the section and "Active index"
  // in a later section — only the Plot Config section counts.
  assert.equal(get('Active index', 'DEFAULT'), 'DEFAULT');
});

test('config: missing key falls back to default (empty default ok)', () => {
  assert.equal(get('Sprint directory'), '');
  assert.equal(get('Sprint directory', 'docs/sprints/'), 'docs/sprints/');
});

test('config: missing CLAUDE.md falls back to default', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-config-bare-'));
  try {
    const out = execFileSync('bash', [accessor, 'get', 'Plan directory', 'docs/plans/'],
      { encoding: 'utf8', cwd: bare }).trimEnd();
    assert.equal(out, 'docs/plans/');
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

// Real-world config style found in an adopting repo (cpq-cds): values written
// as backtick-quoted markdown with trailing prose notes, and a branch-prefix
// list whose first item is both backticked and annotated. Backticks (markdown
// decoration) and `(...)` (prose) are stripped; multi-value lists are kept
// whole rather than truncated to the first backtick span.
test('config: real-world backtick + prose values (cpq-cds style)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-config-cpq-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# cpq-cds

## Plot Config

- **Plan directory:** \`docs/plans/\` (date-prefixed \`YYYY-MM-DD-<slug>.md\`, never moved once created)
- **Sprint directory:** \`docs/sprints/\` (ISO week-prefixed \`YYYY-Www-<slug>.md\`, committed directly to main)
- **Branch prefixes:** \`idea/\` (plans), \`feature/\`, \`bug/\`, \`docs/\`, \`infra/\` (implementation)
`);
    const g = (k, d = '') =>
      execFileSync('bash', [accessor, 'get', k, d], { encoding: 'utf8', cwd: dir }).trimEnd();
    // Backtick-quoted value with trailing prose that itself contains a
    // backticked token — the prose and all backticks are stripped.
    assert.equal(g('Plan directory'), 'docs/plans/');
    assert.equal(g('Sprint directory'), 'docs/sprints/');
    // Multi-value list, first item backticked AND annotated with prose: must
    // yield the whole list, never truncate to the first span (`idea/`).
    assert.equal(g('Branch prefixes'), 'idea/, feature/, bug/, docs/, infra/');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
