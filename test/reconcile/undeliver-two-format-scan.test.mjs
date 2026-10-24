// #2439: `plot-undeliver.sh` flips front matter alongside the `## Status`
// block. One flag covered both `status:` and `phase:`, so only the first key
// flipped and the reconcile scan reported
// `status: 'Approved' disagrees with phase: 'Delivered'` as attention.
//
// This file runs the real undeliver and then the real scan, and asserts the
// scan's own summary: `attention=0`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const undeliver = path.resolve(here, '../../skills/plot/scripts/plot-undeliver.sh');
const scan = path.resolve(here, '../../skills/plot/scripts/plot-reconcile-scan.sh');

const made = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const env = () => {
  const e = { ...process.env };
  delete e.PLOT_UNATTENDED;
  delete e.PLOT_REPO_ROOT;
  return e;
};

const run = (args, cwd) => {
  try {
    return { code: 0, out: execFileSync('bash', args, { cwd, env: env(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

const rel = path.join('docs', 'plans', '2026-01-01-twoformat.md');

/**
 * Commits one delivered plan into a fresh repo, runs undeliver on it, then
 * runs the scan offline.
 *
 * @param frontMatter the front-matter lines between the fences.
 * @returns the undeliver result, the scan result, and the plan as written.
 */
const undeliverThenScan = (frontMatter) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-undeliver-scan-'));
  made.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n'
    + '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n');
  fs.writeFileSync(path.join(dir, rel), [
    '---',
    ...frontMatter,
    '---',
    '',
    '# A plan',
    '',
    '## Status',
    '',
    '- **State:** Delivered',
    '- **Approved:** 2026-01-01, T, in-session',
    '- **Delivered:** 2026-01-02',
    '',
    '## Changelog',
    '',
    '- Did a thing.',
    '',
  ].join('\n'));
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'plan']);

  const u = run([undeliver, 'twoformat', '--why', 'delivered too early', '--on', '2026-01-03'], dir);
  const plan = fs.readFileSync(path.join(dir, rel), 'utf8');
  execFileSync('git', ['-C', dir, 'commit', '-qam', 'undeliver']);
  const s = run([scan, '--offline'], dir);
  return { u, s, plan };
};

test('status: and phase: both Delivered: undeliver flips both, and the scan reports attention=0', () => {
  const r = undeliverThenScan(['status: Delivered', 'phase: Delivered']);

  assert.equal(r.u.code, 0, `undeliver should succeed:\n${r.u.out}`);
  assert.match(r.plan, /^status: Approved$/m);
  assert.match(r.plan, /^phase: Approved$/m);
  assert.equal(r.s.code, 0, `the scan should exit 0:\n${r.s.out}`);
  assert.doesNotMatch(r.s.out, /disagrees with phase/);
  assert.match(r.s.out, /summary:.*\battention=0\b/);
});

test('quoted values: undeliver flips both and keeps the quotes', () => {
  const r = undeliverThenScan(['status: "Delivered"', "phase: 'Delivered'"]);

  assert.equal(r.u.code, 0, `undeliver should succeed:\n${r.u.out}`);
  assert.match(r.plan, /^status: "Approved"$/m);
  assert.match(r.plan, /^phase: 'Approved'$/m);
  assert.equal(r.s.code, 0, `the scan should exit 0:\n${r.s.out}`);
  assert.match(r.s.out, /summary:.*\battention=0\b/);
});
