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
