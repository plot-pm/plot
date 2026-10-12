// Flow test: the approved spike of a Design plan is the one branch the fleet
// offers, and no other branch of that plan is offered or started.
//
// The path under test, each step through the shipped entry point:
//   1. `board/plot-approve.mjs --spike --who` records `Spike approved:` and
//      leaves the plan in Design.
//   2. `plot-fleet-scan.sh --list-eligible` and `--next` offer the spike alone.
//   3. `plot-dispatch.sh --dry-run` predicts the spike alone; the real run asks
//      the `Brief command` (a stub here) for the spike's brief alone.
//   4. The phase gate passes a commit on the spike branch and refuses one on a
//      sibling branch.
// A second plan adds a sibling to the spike's slice after the approval, with a
// plan-only commit: the scan and dispatch then offer neither branch.
//
// No worker is started. The `Brief command` is a stub that records the branch
// it was asked about, because the real one is an agent session.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, sh, SCRIPTS, instantiatePlan, flipState } from './helpers.mjs';

const SPIKE = 'feature/the-spike';
const REST = 'feature/the-rest';
const SHARED_SPIKE = 'feature/shared-spike';
const SHARED_SIBLING = 'feature/shared-sibling';

let sb, asked, briefStub;

/** The environment every script runs under: no worker's leftovers. */
const env = () => {
  const e = { ...process.env };
  delete e.PLOT_REPO_ROOT;
  delete e.PLOT_UNATTENDED;
  return e;
};

/** Runs a shipped script; returns its exit code and both streams. */
const run = (file, args) => {
  const [cmd, argv] = file.endsWith('.mjs') ? ['node', [file, ...args]] : ['bash', [file, ...args]];
  try {
    const stdout = execFileSync(cmd, argv, { cwd: sb.work, env: env(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
};

const scan = (...args) => run(path.join(SCRIPTS, 'plot-fleet-scan.sh'), ['--offline', ...args]);
const dispatch = (...args) => run(path.join(SCRIPTS, 'plot-dispatch.sh'), ['--offline', ...args]);
const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** A Design plan reviewed in-session, with the given `## Slices` body, pushed to origin. */
const designPlan = (slug, slices) => {
  const rel = instantiatePlan(sb.work, {
    date: '2026-10-12', slug, title: slug,
    fields: { Type: 'feature', Review: 'in-session', Impl: 'own branches' },
  });
  const file = path.join(sb.work, rel);
  const text = flipState(fs.readFileSync(file, 'utf8'), 'Draft', 'Design')
    .replace(/## Slices[\s\S]*?(?=\n## )/, `## Slices\n\n${slices}\n`);
  fs.writeFileSync(file, text);
  sh(sb.work, `git add docs/plans && git commit -qm ${JSON.stringify(`plan ${slug}`)} && git push -q origin main`);
  return rel;
};

const approveSpike = (slug) => {
  const out = run(path.join(SCRIPTS, 'board', 'plot-approve.mjs'), ['--spike', '--who', 'alice', slug]);
  assert.equal(out.code, 0, `${out.stdout}\n${out.stderr}`);
  sh(sb.work, 'git checkout -q main && git pull -q --ff-only origin main');
};

/** Waits for the stub to record its call; the dispatcher detaches it. */
const askedBranches = () => {
  const deadline = Date.now() + 20_000;
  while (!fs.existsSync(asked) && Date.now() < deadline) {
    execFileSync('sleep', ['0.2']);
  }
  return fs.existsSync(asked) ? lines(fs.readFileSync(asked, 'utf8')) : [];
};

before(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-e2e-spike-stub-'));
  asked = path.join(root, 'asked.log');
  briefStub = path.join(root, 'brief-stub.sh');
  fs.writeFileSync(briefStub, `#!/usr/bin/env bash\nprintf '%s\\n' "$PLOT_BRIEF_BRANCH" >> ${JSON.stringify(asked)}\n`, { mode: 0o755 });
  sb = makeSandbox({
    name: 'spike-dispatch',
    config: [
      '- **Plan directory:** docs/plans/',
      '- **Active index:** docs/plans/active/',
      '- **Delivered index:** docs/plans/delivered/',
      '- **People:** alice = Alice A',
      `- **Brief command:** bash ${briefStub}`,
    ].join('\n'),
  });
  const cleanup = sb.cleanup;
  sb.cleanup = () => { cleanup(); fs.rmSync(root, { recursive: true, force: true }); };

  designPlan('spiked', `### Prove it\n- \`${SPIKE}\` — the spike <!-- spike -->\n\n### Build it\n- \`${REST}\` — the rest\n`);
  approveSpike('spiked');

  // The second plan is approved with its spike alone in the slice, then a
  // plan-only commit adds a sibling to that slice: the approval checked the
  // slice once, and nothing checks it again.
  const rel = designPlan('shared', `### Prove it\n- \`${SHARED_SPIKE}\` — the spike <!-- spike -->\n\n### Build it\n- \`feature/shared-rest\` — the rest\n`);
  approveSpike('shared');
  const file = path.join(sb.work, rel);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace(`- \`${SHARED_SPIKE}\` — the spike <!-- spike -->`, `- \`${SHARED_SPIKE}\` — the spike <!-- spike -->\n- \`${SHARED_SIBLING}\` — a sibling`));
  sh(sb.work, 'git add docs/plans && git commit -qm "add a sibling to the spike slice" && git push -q origin main');
});
after(() => sb.cleanup());

test('approve: --spike records Spike approved: and leaves the plan in Design', () => {
  const plan = sh(sb.work, 'git show origin/main:docs/plans/2026-10-12-spiked.md');
  assert.match(plan, /- \*\*Spike approved:\*\* \d{4}-\d{2}-\d{2}, alice, in-session/, plan);
  assert.match(plan, /- \*\*(State|Phase):\*\* Design/, plan);
  assert.doesNotMatch(plan, /- \*\*Approved:\*\* \d/, plan);
});

test('scan: --list-eligible and --next offer the spike and no other branch', () => {
  const listed = scan('--list-eligible', 'spiked');
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(lines(listed.stdout), [SPIKE]);
  assert.equal(scan('--next', 'spiked').stdout.trim(), SPIKE);
});

test('dispatch: --dry-run predicts the spike alone', () => {
  const out = dispatch('--dry-run', 'spiked');
  assert.equal(out.code, 0, `${out.stdout}\n${out.stderr}`);
  assert.match(out.stdout, new RegExp(`would dispatch ${SPIKE}\\b`), out.stdout);
  assert.doesNotMatch(out.stdout, new RegExp(REST), out.stdout);
  assert.match(out.stdout, /summary: dispatched=1 /, out.stdout);
});

test('dispatch: the real run asks the Brief command for the spike brief alone and hands nothing over without it', () => {
  const out = dispatch('spiked');
  assert.equal(out.code, 0, `${out.stdout}\n${out.stderr}`);
  assert.match(out.stdout, /not handed over — no brief at/, out.stdout);
  assert.doesNotMatch(out.stdout, /handed over feature\//, out.stdout);
  assert.doesNotMatch(out.stdout, new RegExp(REST), out.stdout);
  assert.deepEqual(askedBranches(), [SPIKE]);
});

test('scan and dispatch: a sibling in the spike slice leaves both branches unoffered', () => {
  const listed = scan('--list-eligible', 'shared');
  assert.deepEqual(lines(listed.stdout), [], listed.stdout);
  const out = dispatch('--dry-run', 'shared');
  assert.equal(out.code, 0, `${out.stdout}\n${out.stderr}`);
  assert.doesNotMatch(out.stdout, /would dispatch/, out.stdout);
  assert.match(out.stdout, /summary: dispatched=0 /, out.stdout);
});

// The phase gate finds the plan by the branch's slug, so the branch under test
// carries the plan's slug. It is the spike in one plan text and a sibling of the
// spike in the other; the `Spike approved:` record the bundle wrote stays.
test('phase gate: a commit passes on the approved spike branch and refuses on a sibling', () => {
  const branch = 'feature/spiked';
  const file = path.join(sb.work, 'docs/plans/2026-10-12-spiked.md');
  sh(sb.work, 'git checkout -q -f main && git pull -q --ff-only origin main');
  const approved = fs.readFileSync(file, 'utf8');
  const publish = (text) => {
    sh(sb.work, 'git checkout -q -f main');
    fs.writeFileSync(file, text);
    sh(sb.work, 'git add docs/plans && git commit -qm plan && git push -q origin main');
  };
  const gateOn = () => {
    sh(sb.work, `git checkout -q -B ${branch} origin/main`);
    fs.mkdirSync(path.join(sb.work, 'src'), { recursive: true });
    fs.writeFileSync(path.join(sb.work, 'src', 'x.txt'), `${Date.now()}\n`);
    sh(sb.work, 'git add src/x.txt');
    const input = JSON.stringify({ tool_input: { command: 'git commit -m work' } });
    try {
      execFileSync('bash', [path.join(SCRIPTS, 'plot-phase-gate.sh')], { cwd: sb.work, env: env(), input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { code: 0, stderr: '' };
    } catch (e) {
      return { code: e.status, stderr: String(e.stderr) + String(e.stdout) };
    }
  };
  const asSpike = approved.replace(`- \`${SPIKE}\` — the spike <!-- spike -->`, `- \`${branch}\` — the spike <!-- spike -->`);
  publish(asSpike);
  assert.equal(gateOn().code, 0);
  publish(asSpike.replace(`- \`${branch}\` — the spike <!-- spike -->`, `- \`${branch}\` — a sibling`)
    .replace(`- \`${REST}\` — the rest`, `- \`${REST}\` — the spike <!-- spike -->`));
  const sibling = gateOn();
  assert.notEqual(sibling.code, 0);
  assert.match(sibling.stderr, /still Design/, sibling.stderr);
});
