// plot-ask.mjs plangate: the dispatch phase and Impl: gate, one case per arm.
// Each arm asserts the exit code and the next-command hint on stderr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ask = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'board', 'plot-ask.mjs');

const run = (meta, extra = ['--ref-resolved']) =>
  spawnSync('node', [ask, 'plangate', '--slug', 'g', '--source', 'origin/main@abc:docs/plans/g.md',
    '--default-branch', 'main', ...extra], { input: meta, encoding: 'utf8' });

const record = (phase, impl = 'own-branches') =>
  JSON.stringify({ file: 'docs/plans/g.md', phase, impl });

const arms = [
  ['approved on its own branches', record('approved'), 0, ''],
  ['draft', record('draft'), 1, /\/plot-approve g/],
  ['delivered', record('delivered'), 1, /\/plot-idea/],
  ['released', record('released'), 1, /\/plot-idea/],
  ['no phase', record('NONE'), 1, /phase/i],
  ['an unknown phase', record('weird'), 1, /State:.*\/plot-approve g/],
  ['Impl: same branch', record('approved', 'same-branch'), 1, /\/plot-implement g/],
  ['Impl: other repo', record('approved', 'other-repo'), 1, /implementation repo/],
  ['Impl: none', record('approved', 'none'), 1, /nothing to implement/i],
  ['an unrecognised Impl:', record('approved', 'sideways'), 1, /own branches, same branch, other repo, none/],
];

for (const [name, meta, code, hint] of arms) {
  test(`plangate: ${name} exits ${code}${hint ? ' and names the next step' : ''}`, () => {
    const r = run(meta);
    assert.equal(r.status, code, r.stderr);
    assert.equal(r.stdout, '');
    if (hint) assert.match(r.stderr, hint);
  });
}

test('plangate: an empty document is unreadable and refused', () => {
  const r = run('');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /phase/i);
});

test('plangate: an unresolved ref is refused unless --allow-local is named', () => {
  assert.equal(run(record('approved'), []).status, 1);
  assert.equal(run(record('approved'), ['--allow-local']).status, 0);
});

test('plangate: a missing --slug is a usage error', () => {
  const r = spawnSync('node', [ask, 'plangate', '--default-branch', 'main'], { input: '', encoding: 'utf8' });
  assert.equal(r.status, 2);
});
