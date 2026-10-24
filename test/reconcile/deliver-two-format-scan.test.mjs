// #2439: a plan carrying both front matter (`status:`/`phase:`) and a
// `## Status` block, delivered through the real `/plot-deliver`, printed
// `phase=flipped` and left the front matter at `Approved`. The reconcile
// scan then read the two fields independently and reported
// `status: 'Delivered' disagrees with phase: 'Approved'` — the write
// succeeded and the outcome did not.
//
// `deliver-phase-takes-effect.test.mjs` pins the writer's own round trip
// through `plot-plan-meta.sh`. THIS FILE PINS THE SCAN ITSELF: the brief's
// own warning is that a test re-reading the front matter can pass against a
// fix that is wrong in the way #944 hid, because the scan is a second,
// independent reader of the same two fields. Only running
// `plot-reconcile-scan.sh` for real proves the disagreement it is named for
// is gone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const deliver = path.resolve(here, '../../skills/plot/scripts/plot-deliver.sh');
const scan = path.resolve(here, '../../skills/plot/scripts/plot-reconcile-scan.sh');

const made = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A whole repo with one plan, delivered for real, then scanned for real.
 *
 * The scan reads the WORKING TREE, not `origin/main` — unlike the delivery
 * write, which lands in a disposable booking worktree. So the working copy
 * is fast-forwarded to `origin/main` after the delivery and before the scan
 * runs, the same way an operator would see the landed plan locally.
 *
 * @param planBody the whole plan file.
 * @returns the scan's stdout and the delivery's exit code.
 */
const deliverThenScan = (planBody) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deliver-scan-'));
  const remote = `${dir}-remote.git`;
  made.push(dir, remote);

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n'
    + '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n');
  const rel = path.join('docs', 'plans', '2026-01-01-twoformat.md');
  fs.writeFileSync(path.join(dir, rel), planBody);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'plan']);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
  execFileSync('git', ['-C', dir, 'push', '-q', 'origin', 'main']);
  execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);

  let deliverOut = '';
  let deliverCode = 0;
  try {
    deliverOut = execFileSync('bash', [deliver, 'twoformat'],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    deliverOut = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    deliverCode = e.status ?? 1;
  }

  // Fast-forward the working copy to what the delivery landed on origin/main
  // — the write happened in a booking worktree, so the local checkout does
  // not see it until this runs, same as a real operator's next pull.
  execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);
  execFileSync('git', ['-C', dir, 'merge', '-q', '--ff-only', 'origin/main']);

  let scanOut = '';
  try {
    scanOut = execFileSync('bash', [scan], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    scanOut = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }

  return { deliverOut, deliverCode, scanOut };
};

const twoFormatPlan = (phaseKeys) => [
  '---',
  ...phaseKeys,
  '---',
  '',
  '# A plan',
  '',
  '## Status',
  '',
  '- **Phase:** Approved',
  '- **Approved:** 2026-01-01, T, in-session',
  '',
  '## Changelog',
  '',
  '- Did a thing.',
  '',
].join('\n');

test('a plan with status: and phase: front matter plus a Status block: the scan reports no disagreement after delivery', () => {
  const r = deliverThenScan(twoFormatPlan(['status: Approved', 'phase: Approved']));

  assert.equal(r.deliverCode, 0, `the delivery should succeed:\n${r.deliverOut}`);
  assert.match(r.deliverOut, /phase=flipped/);
  assert.doesNotMatch(r.scanOut, /disagrees with phase/,
    'the scan should read front matter and the block as agreeing once both are flipped');
});

test('status: alone (no phase: key): the scan reports no disagreement after delivery', () => {
  const r = deliverThenScan(twoFormatPlan(['status: Approved']));

  assert.equal(r.deliverCode, 0, `the delivery should succeed:\n${r.deliverOut}`);
  assert.doesNotMatch(r.scanOut, /disagrees with phase/,
    'a fix keyed on phase: alone would fail this fixture');
});

test('phase: alone (no status: key): the scan reports no disagreement after delivery', () => {
  const r = deliverThenScan(twoFormatPlan(['phase: Approved']));

  assert.equal(r.deliverCode, 0, `the delivery should succeed:\n${r.deliverOut}`);
  assert.doesNotMatch(r.scanOut, /disagrees with phase/,
    'a fix keyed on status: alone would fail this fixture');
});

test('front matter already Delivered: a re-run is a no-op, not a refusal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deliver-scan-'));
  const remote = `${dir}-remote.git`;
  made.push(dir, remote);

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n'
    + '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n');
  const rel = path.join('docs', 'plans', '2026-01-01-already.md');
  const already = [
    '---',
    'status: Delivered',
    'phase: Delivered',
    '---',
    '',
    '# A plan',
    '',
    '## Status',
    '',
    '- **Phase:** Delivered',
    '- **Approved:** 2026-01-01, T, in-session',
    '- **Delivered:** 2026-01-02',
    '',
    '## Changelog',
    '',
    '- Did a thing.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, rel), already);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'plan']);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
  execFileSync('git', ['-C', dir, 'push', '-q', 'origin', 'main']);
  execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);

  let out = '';
  let code = 0;
  try {
    out = execFileSync('bash', [deliver, 'already'],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    code = e.status ?? 1;
  }

  assert.equal(code, 0, `a plan already delivered in both formats should no-op, not refuse:\n${out}`);
  execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);
  const onMain = execFileSync('git', ['-C', dir, 'show', `origin/main:${rel}`], { encoding: 'utf8' });
  assert.equal(onMain, already, 'a no-op delivery should not rewrite an already-delivered plan');
});
