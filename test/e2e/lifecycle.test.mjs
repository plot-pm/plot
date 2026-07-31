// Flow tests: the plan lifecycle's script choreography in sandbox repos.
// Each flow states what it proves BEYOND the unit tests (test/reconcile/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  makeSandbox, stubHost, runScript, planMeta,
  instantiatePlan, recordApproval, recordStarted, annotatePr, runGate, sh,
} from './helpers.mjs';

// ── Flow a: pr + own branches, CLASSIC config (pre-Plot-2 compat) ────────────
// Proves: shipped template → parser roundtrip with fields ABSENT; the
// documented approve-record edit lands on origin/main and the parser sees it;
// gate transitions from block to allow on the SAME repo state; annotation →
// plot-impl-status resolves through the host stub (first-ever coverage).
test('flow a: classic pr flow — template roundtrip, approve record, gate flip, impl-status', () => {
  const sb = makeSandbox({ name: 'a', config: '- **Plan directory:** docs/plans/\n' });
  const stub = stubHost(`
    if (argv.includes('view')) {
      process.stdout.write(JSON.stringify({ number: 12, state: 'MERGED', isDraft: false, url: 'https://example.test/pr/12' }));
    } else { process.stdout.write('{}'); }
  `);
  try {
    // idea phase: plan from the SHIPPED template, no ceremony fields filled
    const rel = instantiatePlan(sb.work, { date: '2026-07-30', slug: 'flow-a', title: 'Flow A' });
    sh(sb.work, 'git checkout -qb idea/flow-a && git add -A && git commit -qm "plot: Flow A" && git push -qu origin idea/flow-a');
    let meta = planMeta(sb.work, rel, stub);
    assert.equal(meta.phase, 'draft');
    assert.equal(meta.review, 'NONE');       // pre-Plot-2 plan parses clean
    assert.equal(meta.impl, 'NONE');

    // approve: merge simulated by landing the plan on main + the record edit
    sh(sb.work, 'git checkout -q main && git merge -q --no-ff idea/flow-a -m merge');
    recordApproval(sb.work, rel, { channel: 'plan-PR #12 merged' });
    sh(sb.work, 'git add -A && git commit -qm "plot: approve flow-a" && git push -q origin main');
    meta = planMeta(sb.work, rel, stub);
    assert.equal(meta.phase, 'approved');
    assert.match(meta.approved_raw, /plan-PR #12 merged/);

    // implement: branch + Started; gate must ALLOW code commits now
    sh(sb.work, 'git checkout -qb feature/flow-a origin/main');
    fs.mkdirSync(path.join(sb.work, 'src'), { recursive: true });
    fs.writeFileSync(path.join(sb.work, 'src/a.js'), 'x');
    sh(sb.work, 'git add -A');
    assert.equal(runGate(sb.work, 'git commit -m impl'), 0, 'approved plan must not block');
    recordStarted(sb.work, rel, { branch: 'feature/flow-a' });
    sh(sb.work, 'git add -A && git commit -qm impl && git push -qu origin feature/flow-a');
    meta = planMeta(sb.work, rel, stub);
    assert.equal(meta.started_raw.length, 1);

    // deliver: annotate → #12, push to main, impl-status resolves via stub
    sh(sb.work, 'git checkout -q main');
    annotatePr(sb.work, rel, 'feature/flow-a', '#12');
    sh(sb.work, 'git add -A && git commit -qm "plot: link PR" && git push -q origin main');
    const status = JSON.parse(runScript('plot-impl-status.sh', ['flow-a'], { cwd: sb.work, stub }));
    assert.equal(status.prs.length, 1);
    assert.equal(status.prs[0].state, 'MERGED');
    assert.ok(stub.calls().some((c) => c.startsWith('gh pr view 12')));

    // deliver mechanics: symlink moves active → delivered; phase flips
    sh(sb.work, 'git mv docs/plans/active/flow-a.md docs/plans/delivered/flow-a.md');
    const f = path.join(sb.work, rel);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('- **Phase:** Approved', '- **Phase:** Delivered'));
    sh(sb.work, 'git add -A && git commit -qm "plot: deliver"');
    meta = planMeta(sb.work, rel, stub);
    assert.equal(meta.phase, 'delivered');
    assert.ok(fs.lstatSync(path.join(sb.work, 'docs/plans/delivered/flow-a.md')).isSymbolicLink());
  } finally {
    sb.cleanup();
  }
});

// ── Flow b: in-session + same branch + the full hold lifecycle ───────────────
// Proves: the gate's REAL product behavior across the lifecycle — blocks code
// on a Draft same-branch plan, allows the plan-only commit, hold blocks a
// non-prefix branch, the documented approve edit (record + hold removal)
// flips both gates on identical repo state.
test('flow b: same-branch draft blocks code, hold lifecycle, approval flips the gate', () => {
  const sb = makeSandbox({
    name: 'b',
    config: '- **Plan directory:** docs/plans/\n- **Plan PRs:** never\n- **Tracker:** jira https://example.test\n',
  });
  try {
    // plan rides the work branch
    sh(sb.work, 'git checkout -qb feature/flow-b');
    const rel = instantiatePlan(sb.work, {
      date: '2026-07-30', slug: 'flow-b', title: 'Flow B',
      fields: { Review: 'in-session', Impl: 'here, same branch' },
    });
    sh(sb.work, 'git add -A');
    assert.equal(runGate(sb.work, 'git commit -m plan'), 0, 'plan-only commit must pass while Draft');
    sh(sb.work, 'git commit -qm "plot: Flow B plan"');

    // review hold on a ticket-slugged branch (non-prefix): write → block → clear
    sh(sb.work, 'git checkout -q main && git checkout -qb TICKET-9-side');
    fs.writeFileSync(path.join(sb.work, 'side.js'), 'x');
    fs.mkdirSync(path.join(sb.work, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(sb.work, '.plot/hold'), 'TICKET-9-side plan in review\n');
    sh(sb.work, 'git add -A');
    assert.equal(runGate(sb.work, 'git commit -m impl'), 2, 'hold must block code commit');
    fs.rmSync(path.join(sb.work, '.plot/hold'));
    sh(sb.work, 'git add -A');
    assert.equal(runGate(sb.work, 'git commit -m impl'), 0, 'cleared hold must unblock');
    sh(sb.work, 'git commit -qm side && git checkout -qf feature/flow-b');

    // code while Draft → blocked, including the compound staging pattern
    fs.mkdirSync(path.join(sb.work, 'src'), { recursive: true });
    fs.writeFileSync(path.join(sb.work, 'src/b.js'), 'x');
    assert.equal(runGate(sb.work, 'git add -A && git commit -m impl'), 2, 'draft same-branch plan must block code');
    sh(sb.work, 'git add -A');

    // approval recorded in-file → same command now passes
    recordApproval(sb.work, rel, { channel: 'in-session' });
    sh(sb.work, 'git add -A');
    assert.equal(runGate(sb.work, 'git commit -m impl'), 0, 'approved plan must unblock');
    const meta = planMeta(sb.work, rel);
    assert.equal(meta.review, 'in-session');
    assert.equal(meta.impl, 'same-branch');
    assert.match(meta.approved_raw, /in-session/);
  } finally {
    sb.cleanup();
  }
});

// ── Flow c: direct flow in a knowledge repo — layout mechanics only ──────────
// Proves: template + symlink + parser work committed straight to the default
// branch with no branch/PR machinery. (The REFUSALS — no idea branch, sprint
// decline — are prose gates: Layer-2 promptfoo cases, not driver assertions.)
test('flow c: direct-to-main plan lifecycle in a Plan PRs: never repo', () => {
  const sb = makeSandbox({ name: 'c', config: '- **Plan PRs:** never\n- **Tracker:** jira https://example.test\n' });
  try {
    const rel = instantiatePlan(sb.work, {
      date: '2026-07-30', slug: 'flow-c', title: 'Flow C',
      fields: { Review: 'in-session', Impl: 'nowhere' },
    });
    recordApproval(sb.work, rel);
    sh(sb.work, 'git add -A && git commit -qm "plot: Flow C" && git push -q origin main');
    const meta = planMeta(sb.work, rel);
    assert.equal(meta.phase, 'approved');
    assert.equal(meta.impl, 'none');   // "nowhere" normalizes
    assert.equal(sh(sb.work, 'git branch -r').includes('idea/'), false);
  } finally {
    sb.cleanup();
  }
});

// ── Flow d: split-home — plan repo + impl repo, cross-repo resolution ────────
// Proves: `→ owner/repo#N` annotations round-trip through plot-impl-status →
// plot-host `--repo` (argv pinned); deliver-side verification needs zero
// local-repo PRs. First-ever coverage of the cross-repo path.
test('flow d: split-home cross-repo PR resolution via the host adapter', () => {
  const sb = makeSandbox({
    name: 'd',
    config: '- **Plan directory:** docs/plans/\n- **Plan PRs:** never\n- **Implementation home:** example/impl-repo\n',
  });
  const stub = stubHost(`
    if (argv.includes('-R') && argv.includes('example/impl-repo')) {
      process.stdout.write(JSON.stringify({ number: 7, state: 'MERGED', isDraft: false, url: 'https://example.test/impl/7' }));
    } else { process.stdout.write('{}'); }
  `);
  try {
    const rel = instantiatePlan(sb.work, {
      date: '2026-07-30', slug: 'flow-d', title: 'Flow D',
      fields: { Review: 'in-session', Impl: 'other repo' },
    });
    recordApproval(sb.work, rel);
    // Branches section names the impl repo's branch; annotation carries repo#N
    const f = path.join(sb.work, rel);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(
      /- `feature\/<slug>` — <description>/,
      '- `feature/flow-d` — the slice (repo: example/impl-repo)',
    ));
    annotatePr(sb.work, rel, 'feature/flow-d', 'example/impl-repo#7');
    sh(sb.work, 'git add -A && git commit -qm "plot: Flow D" && git push -q origin main');

    const status = JSON.parse(runScript('plot-impl-status.sh', ['flow-d'], { cwd: sb.work, stub }));
    assert.equal(status.prs.length, 1);
    assert.equal(status.prs[0].repo, 'example/impl-repo');
    assert.equal(status.prs[0].state, 'MERGED');
    assert.ok(
      stub.calls().some((c) => c.includes('-R example/impl-repo') && c.includes('pr view 7')),
      `expected cross-repo gh call, got: ${stub.calls().join(' | ')}`,
    );
  } finally {
    sb.cleanup();
  }
});
