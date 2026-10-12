// Flow test: the approved spike of a Design plan passes every gate that stands
// between a plan and a worker's commit, and no other branch of that plan does.
//
// The path under test: the `<!-- spike -->` annotation and the `Spike
// approved:` record -> plot-plan-meta.sh -> the dispatch plan gate
// (plot-ask.mjs plangate) -> the phase gate on a commit. Each gate is asked
// about the spike branch and about a sibling branch of the same plan, because a
// gate that admitted the whole plan would pass the spike alone.
//
// No worker is started: the gates are the subject, and they decide from the
// plan on the shared ref.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, sh, SCRIPTS, planMeta, instantiatePlan, flipState } from './helpers.mjs';

const SPIKE = 'feature/the-spike';
const SIBLING = 'feature/the-rest';

let sb, rel, meta;

const setSlices = (text) =>
  text.replace(
    /## (Slices|Branches|Waves)[\s\S]*?(?=\n## |\n<!--|$)/,
    `## Slices\n\n### Prove it\n- \`${SPIKE}\` — the spike <!-- spike -->\n\n### Build it\n- \`${SIBLING}\` — the rest\n\n`,
  );

before(() => {
  sb = makeSandbox({ name: 'spike-dispatch' });
  rel = instantiatePlan(sb.work, { date: '2026-10-12', slug: 'spiked', title: 'Spiked' });
  const file = path.join(sb.work, rel);
  let text = flipState(fs.readFileSync(file, 'utf8'), 'Draft', 'Design');
  text = setSlices(text).replace(/- \*\*Type:\*\* [^\n]*/, (m) => `${m}\n- **Spike approved:** 2026-10-12, alice`);
  fs.writeFileSync(file, text);
  sh(sb.work, 'git add -A && git commit -qm plan && git push -q origin main');
  meta = JSON.stringify(planMeta(sb.work, rel));
});
after(() => sb.cleanup());

const plangate = (branch) => {
  const args = [
    path.join(SCRIPTS, 'board', 'plot-ask.mjs'), 'plangate',
    '--slug', 'spiked', '--default-branch', 'main', '--source', 'origin/main', '--ref-resolved',
    ...(branch ? ['--branch', branch] : []),
  ];
  try {
    execFileSync('node', args, { cwd: sb.work, input: meta, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stderr: '' };
  } catch (e) {
    return { code: e.status, stderr: String(e.stderr) };
  }
};

const gateOn = (branch) => {
  sh(sb.work, `git checkout -q -B ${branch} origin/main`);
  fs.mkdirSync(path.join(sb.work, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sb.work, 'src', 'x.txt'), `${branch}\n`);
  sh(sb.work, 'git add src/x.txt');
  const input = JSON.stringify({ tool_input: { command: 'git commit -m work' } });
  try {
    execFileSync('bash', [path.join(SCRIPTS, 'plot-phase-gate.sh')], { cwd: sb.work, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stderr: '' };
  } catch (e) {
    return { code: e.status, stderr: String(e.stderr) + String(e.stdout) };
  }
};

test('plangate: the spike branch of a Design plan passes', () => {
  assert.equal(plangate(SPIKE).code, 0);
});

test('plangate: a sibling branch of the same plan is refused as spike-only', () => {
  const out = plangate(SIBLING);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /only its spike/, out.stderr);
  assert.match(out.stderr, /\/plot-approve spiked/, out.stderr);
});

// The phase gate finds the plan by the branch's slug, so the branch under test
// carries the plan's slug. It is the spike in one plan text and a sibling of the
// spike in the other.
test('phase gate: a commit passes on the approved spike branch and refuses on a sibling', () => {
  const branch = 'feature/spiked';
  const file = path.join(sb.work, rel);
  const original = fs.readFileSync(file, 'utf8');
  const publish = (text) => {
    sh(sb.work, 'git checkout -q -f main');
    fs.writeFileSync(file, text);
    sh(sb.work, 'git add -A && git commit -qm plan && git push -q origin main');
  };
  const asSpike = original.replace(`- \`${SPIKE}\` — the spike <!-- spike -->`, `- \`${branch}\` — the spike <!-- spike -->`);
  publish(asSpike);
  assert.equal(gateOn(branch).code, 0);
  publish(asSpike.replace(`- \`${branch}\` — the spike <!-- spike -->`, `- \`${branch}\` — a sibling`)
    .replace(`- \`${SIBLING}\` — the rest`, `- \`${SIBLING}\` — the spike <!-- spike -->`));
  const sibling = gateOn(branch);
  assert.notEqual(sibling.code, 0);
  assert.match(sibling.stderr, /still Design/, sibling.stderr);
});
