// Flow tests: the PARALLEL FLEET choreography in sandbox repos.
//
// The unit tests (test/reconcile/) check each script against a hand-built
// fixture. These check that the scripts actually feed each other on real refs:
// a plan written from the shipped template is read with waves, --next names a
// branch from it, dispatch claims that exact branch, the pulse then sees the
// claim, and the merge queue orders what comes out.
//
// The wave transition is the part no unit test can reach: "wave 1 merges →
// wave 2 becomes eligible" is a property of git state changing between two
// runs of a stateless command, which only a flow test can stage.
//
// Like lifecycle.test.mjs, this deliberately does NOT mechanize prose-only
// skill behaviour (coaching, triage, refusal wording) — only the seams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox, runScript, planMeta, sh } from './helpers.mjs';

const CONFIG = '- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n';

/** An approved, wave-structured plan, pushed to origin. Returns its rel path. */
function wavePlan(work, { slug = 'fleet-flow', date = '2026-08-14' } = {}) {
  const rel = `docs/plans/${date}-${slug}.md`;
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(work, rel), `# Fleet flow

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** ${date}, alice, in-session

## Branches

### Tracer
- \`feature/seam\` — proves the seam

### Implementation
- \`feature/api\` — endpoint
- \`feature/ui\` — form
- \`feature/dropped\` — folded in <!-- deferred: covered by feature/api -->
`);
  fs.symlinkSync(`../${date}-${slug}.md`, path.join(work, 'docs', 'plans', 'active', `${slug}.md`));
  // A brief per branch, named as `brief_path` names it — the branch's last
  // segment. A slice with no brief is not handed over, and these flows are
  // about the hand-over rather than about the gate in front of it.
  fs.mkdirSync(path.join(work, '.plot', 'briefs'), { recursive: true });
  for (const b of ['seam', 'api', 'ui']) {
    fs.writeFileSync(path.join(work, '.plot', 'briefs', `${b}.md`), `# Brief: ${b}\n`);
  }
  sh(work, 'git add -A && git commit -qm plan && git push -q origin main');
  return rel;
}

test('flow f: wave gating — a blocked wave yields no work until wave 1 merges', () => {
  // Proves the transition end to end on real refs: the SAME stateless command
  // gives a different answer once git changes, with nothing carried between
  // runs. This is the core claim of the whole design.
  const sb = makeSandbox({ name: 'fleet-waves', config: CONFIG });
  const rel = wavePlan(sb.work);

  // The shipped parser must see the wave structure the plan declares.
  const meta = planMeta(sb.work, rel);
  assert.equal(meta.waves.length, 2, 'Tracer + Implementation');
  assert.deepEqual(meta.waves[0].branches.map((b) => b.branch), ['feature/seam']);
  assert.ok(meta.waves[1].branches.find((b) => b.branch === 'feature/dropped').deferred);

  // Wave 1 open: only its branch is offered, and wave 2 is blocked.
  const first = runScript('plot-fleet-scan.sh', ['--offline', '--next', 'fleet-flow'],
    { cwd: sb.work }).trim();
  assert.equal(first, 'feature/seam');
  const before = runScript('plot-fleet-scan.sh', ['--offline', 'fleet-flow'], { cwd: sb.work });
  assert.match(before, /Implementation — blocked/);

  // Land wave 1 for real.
  sh(sb.work, 'git checkout -qb feature/seam && echo seam > seam.txt && git add -A && git commit -qm seam && git push -qu origin feature/seam');
  sh(sb.work, 'git checkout -q main && git merge -q --no-ff -m merge feature/seam && git push -q origin main');

  // Same command, new answer — derived, not remembered.
  const after = runScript('plot-fleet-scan.sh', ['--offline', 'fleet-flow'], { cwd: sb.work });
  assert.match(after, /Tracer — complete/);
  assert.match(after, /Implementation — eligible/);

  // And the deferred branch is never offered as work.
  const eligible = runScript('plot-fleet-scan.sh', ['--offline', '--list-eligible', 'fleet-flow'],
    { cwd: sb.work }).trim().split('\n').sort();
  assert.deepEqual(eligible, ['feature/api', 'feature/ui']);

  sb.cleanup();
});

test('flow g: dispatch hands over exactly what --next offered, and it stays queued', () => {
  // The seam between the two commands, and BOTH HALVES OF IT MOVED. Dispatch
  // used to claim the branch the scan named, and the scan then reported it
  // `claimed`; that was the whole exclusion, because nothing else assigned.
  //
  // The registry is the assignment lock now, so dispatch pushes no claim — and
  // the queue is DERIVED: an eligible slice with a brief and no claim IS
  // queued. Claiming here would take the slice straight back out of the queue
  // it was being put into, which is why the branch must still read `open` and
  // must still be on offer afterwards. That is the inversion this asserts.
  const sb = makeSandbox({ name: 'fleet-claim', config: CONFIG });
  wavePlan(sb.work, { slug: 'claimflow' });

  const offered = runScript('plot-fleet-scan.sh', ['--offline', '--next', 'claimflow'],
    { cwd: sb.work }).trim();
  const out = runScript('plot-dispatch.sh', ['--offline', '--max', '1', 'claimflow'],
    { cwd: sb.work });

  // IT HANDED OVER THE BRANCH THE SCAN NAMED. The two commands still have to
  // agree about which slice is next; only what dispatch does with it changed.
  assert.match(out, new RegExp(`handed over ${offered.replace('/', '\\/')}`),
    `the hand-over must name the branch --next offered:\n${out}`);

  // NO CLAIM REF. Both of the old assertions, inverted.
  assert.equal(sh(sb.work, `git ls-remote --heads origin ${offered}`).trim(), '',
    'a hand-over pushes no claim — the ref is what would take it out of the queue');
  const pulse = runScript('plot-fleet-scan.sh', ['--offline', 'claimflow'], { cwd: sb.work });
  assert.doesNotMatch(pulse, new RegExp(`${offered.replace('/', '\\/')} — claimed`),
    'nothing claimed it, so the pulse must not say claimed');

  // AND IT IS STILL ON OFFER, which is what "still queued" means when the queue
  // is derived. The old test asserted the exact opposite.
  const second = runScript('plot-fleet-scan.sh', ['--offline', '--next', 'claimflow'],
    { cwd: sb.work }).trim();
  assert.equal(second, offered,
    'a handed-over slice is still queued until the registry assigns it');

  sb.cleanup();
});

test('flow h: a second dispatcher repeats the hand-over and builds nothing twice', () => {
  // TWO DISPATCHERS RACING WAS THE SCENARIO CLAIM-BY-REF EXISTED FOR, and the
  // race is no longer theirs to lose. The registry assigns, and it hands one
  // slice to one agent — so what two dispatchers do is say the same thing
  // twice, which is safe because the hand-over is a REPORT and not a write.
  //
  // That is a stronger idempotence than the old one, which rested on adopting
  // a desk the first run had already cut. Nothing is adopted here because
  // nothing was made.
  const sb = makeSandbox({ name: 'fleet-race', config: CONFIG });
  wavePlan(sb.work, { slug: 'raceflow' });

  const wtCount = () => sh(sb.work, 'git worktree list').trim().split('\n').length;
  const before = wtCount();

  const first = runScript('plot-dispatch.sh', ['--offline', '--max', '1', 'raceflow'],
    { cwd: sb.work });
  assert.match(first, /handed over feature\/seam/);

  const second = runScript('plot-dispatch.sh', ['--offline', '--max', '1', 'raceflow'],
    { cwd: sb.work });
  assert.match(second, /handed over feature\/seam/,
    'the slice is still queued, so the second run hands over the same one');

  // NEITHER RUN BUILT ANYTHING. The desk is the agent's to cut when it takes
  // the brief; two dispatchers must not leave two behind — measured 2026-09-02,
  // 2 agents holding 11 worktrees is what that used to cost.
  assert.equal(wtCount(), before, 'no dispatch may create a worktree, let alone two');
  assert.equal(sh(sb.work, 'git ls-remote --heads origin feature/seam').trim(), '',
    'and neither may claim the branch');

  sb.cleanup();
});

test('flow i: the phase gate refuses a Draft plan before anything is created', () => {
  // The gate lives in the script, so it must hold even when the script is
  // called directly — which is exactly how a user bypasses skill prose.
  const sb = makeSandbox({ name: 'fleet-gate', config: CONFIG });
  const rel = 'docs/plans/2026-08-14-draftflow.md';
  fs.mkdirSync(path.join(sb.work, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(sb.work, rel),
    '# Draft\n\n## Status\n\n- **Phase:** Draft\n- **Impl:** own branches\n\n## Branches\n\n- `feature/x` — one\n');
  fs.symlinkSync('../2026-08-14-draftflow.md',
    path.join(sb.work, 'docs', 'plans', 'active', 'draftflow.md'));
  sh(sb.work, 'git add -A && git commit -qm draft && git push -q origin main');

  let refused = false;
  try {
    runScript('plot-dispatch.sh', ['--offline', '--no-start', 'draftflow'], { cwd: sb.work });
  } catch { refused = true; }
  assert.ok(refused, 'a Draft plan must not be dispatched');
  assert.equal(sh(sb.work, 'git ls-remote --heads origin feature/x').trim(), '',
    'nothing may be claimed when the gate refuses');

  sb.cleanup();
});

test('flow j: merge queue orders finished branches and predicts their collision', () => {
  // The end of the fleet: several branches finish at once, and the queue says
  // in what order they can land. The collision must be reported against the
  // branch AHEAD in the queue — not against main, which each of them merges
  // into cleanly on its own.
  const sb = makeSandbox({ name: 'fleet-queue', config: CONFIG });
  fs.mkdirSync(path.join(sb.work, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(sb.work, 'shared.txt'), 'base\n');
  const rel = 'docs/plans/2026-08-14-queueflow.md';
  fs.writeFileSync(path.join(sb.work, rel),
    '# Q\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n'
    + '- `feature/alone` — own file\n- `feature/first` — touches shared\n- `feature/second` — touches shared too\n');
  fs.symlinkSync('../2026-08-14-queueflow.md',
    path.join(sb.work, 'docs', 'plans', 'active', 'queueflow.md'));
  sh(sb.work, 'git add -A && git commit -qm plan && git push -q origin main');

  sh(sb.work, 'git checkout -qb feature/alone && echo a > alone.txt && git add -A && git commit -qm a && git push -qu origin feature/alone && git checkout -q main');
  sh(sb.work, 'git checkout -qb feature/first && echo FIRST > shared.txt && git add -A && git commit -qm f && git push -qu origin feature/first && git checkout -q main');
  sh(sb.work, 'git checkout -qb feature/second && echo SECOND > shared.txt && git add -A && git commit -qm s && git push -qu origin feature/second && git checkout -q main');

  const out = runScript('plot-merge-queue.sh', ['--offline', 'queueflow'], { cwd: sb.work });
  assert.match(out, /feature\/alone — clean/);
  assert.match(out, /conflicts with feature\/(first|second)/,
    'the collision must name the branch ahead in the queue');
  assert.match(out, /summary: ready=2 conflicts=1/);

  // Nothing may have moved: the order is the product, not the merge.
  const mainCount = sh(sb.work, 'git rev-list --count origin/main').trim();
  assert.equal(mainCount, '2', 'origin/main must not advance');

  sb.cleanup();
});
