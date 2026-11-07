// Contract test for scripts/check-card-presentation.sh — the gate that holds
// card-presentation.ts to the CardFacts types and the board's UI helpers. It
// pins the refusal on a seeded reading import, the two allowed sources, the
// comment exemption, and a missing file failing rather than passing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = path.join(here, '..', '..', 'scripts', 'check-card-presentation.sh');
const FILE = 'packages/board/src/app/lib/card-presentation.ts';

const run = (dir) => spawnSync('bash', [gate, dir], { encoding: 'utf8' });

const withFixture = (text, check) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-card-presentation-'));
  try {
    mkdirSync(path.dirname(path.join(dir, FILE)), { recursive: true });
    if (text !== null) writeFileSync(path.join(dir, FILE), text);
    check(run(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const ALLOWED =
  "import type { CardFacts } from '@plot-pm/domain/entities/card-facts';\n" +
  "import { cn } from '../components/ui/cn.js';\n";

test('an import of a reading exits 1 and names the file, line and specifier', () => {
  withFixture(ALLOWED + "import { checksVerdict } from '@plot-pm/domain';\n", (r) => {
    assert.equal(r.status, 1);
    assert.match(r.stdout, /card-presentation\.ts:3: @plot-pm\/domain/);
  });
});

test('a relative import outside the UI helpers exits 1', () => {
  withFixture(ALLOWED + "import { planHref } from './plan.js';\n", (r) => {
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\.\/plan\.js/);
  });
});

test('a dynamic import and a require are read too', () => {
  withFixture(ALLOWED + "const m = await import('../../contract/schema.js');\n", (r) => assert.equal(r.status, 1));
  withFixture(ALLOWED + "const m = require('node:fs');\n", (r) => assert.equal(r.status, 1));
});

test('the CardFacts types, the UI helpers and a commented import pass', () => {
  withFixture(ALLOWED + "// import { x } from '@plot-pm/domain';\n/* import { y } from './z.js'; */\n", (r) => {
    assert.equal(r.status, 0, r.stdout);
  });
});

test('a missing file fails rather than passing vacuously', () => {
  withFixture(null, (r) => assert.equal(r.status, 1));
});

test('the checked-in tree passes', () => {
  const r = spawnSync('bash', [gate], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});
