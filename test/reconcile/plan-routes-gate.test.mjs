// Contract test for scripts/check-plan-routes.sh — the gate that keeps every
// `/plan/<name>` href built by `planRoute` in the domain's plan-reference rule.
// It pins the refusal and its file:line output, the rule file's exemption, and
// the two shapes that build nothing: a quoted route prefix and a comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = path.join(here, '..', '..', 'scripts', 'check-plan-routes.sh');

const run = (dir) => spawnSync('bash', [gate, dir], { encoding: 'utf8' });

const fixture = (files) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-plan-routes-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
};

const RULE = 'packages/domain/src/rules/plan-reference.ts';

test('a template-literal /plan/ href outside the rule exits 1 and names the file and line', () => {
  const dir = fixture({
    [RULE]: 'export const planRoute = (f: string) => `/plan/${f}`;\n',
    'packages/board/src/app/Card.tsx': 'const a = 1;\nconst href = `/plan/${name}`;\n',
  });
  try {
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /packages\/board\/src\/app\/Card\.tsx:2:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a quoted /plan/ joined with + exits 1', () => {
  const dir = fixture({
    [RULE]: '',
    'packages/board/src/server/x.ts': "const h = '/plan/' + name;\n",
  });
  try {
    assert.equal(run(dir).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the rule file, a route-table prefix and a comment pass', () => {
  const dir = fixture({
    [RULE]: 'export const planRoute = (f: string) => `/plan/${f}`;\n',
    'packages/board/src/server/index.ts': "const t = [{ prefix: '/plan/', label: 'Plan' }];\n",
    'packages/board/src/app/y.ts': '// builds `/plan/${x}` in prose\n * `/plan/${x}`\n',
  });
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the checked-in tree passes', () => {
  const r = spawnSync('bash', [gate], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});
