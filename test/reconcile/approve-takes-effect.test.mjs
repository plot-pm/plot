// Contract test for an approval a later reader can actually see.
//
// #933, filed from a real approval that silently did nothing: the plan carried
// BOTH front matter and a `## Status` block, `/plot-approve` wrote
// `State: Approved` into the block, reported all seven steps clean, and
// `plot-fleet-scan.sh` went on answering `Wave 1 - unapproved, eligible=0`.
// Editing the two front-matter lines by hand made it `eligible=1` immediately.
//
// THE WRITER AND THE READER ARE BOTH REAL, AND NOTHING HERE RE-IMPLEMENTS
// EITHER. `plot-approve.sh` performs the approval and `plot-fleet-scan.sh`
// answers the question, exactly as `deliver-phase-takes-effect.test.mjs` does
// and for its stated reason: a test that copies the rule passes while the
// scripts stay broken. The plan's own words for this clause are `perform the
// approval; do not edit a fixture into the answer`.
//
// IT IS THE ONLY CLAUSE THAT CAN SEE THE DEFECT. The estate-wide "every plan
// parses byte-identically" gate is a regression lock: zero plans here carry
// both shapes, so it is satisfied by construction and this failure is invisible
// to it.
//
// The host CLI is PATH-stubbed the way `approve.test.mjs` stubs it — the
// approval merges a plan PR, which is the one irreversible step, and a contract
// test must not need a network to run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const approve = path.join(SCRIPTS, 'plot-approve.sh');
const scan = path.join(SCRIPTS, 'plot-fleet-scan.sh');

let stubDir, statePath;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A plan carrying TWO phase records, which is the reporter's exact shape.
 *
 * Front matter says `Draft` and nothing ever updates it; the `## Status` block
 * says `Draft` too, and that is the line `/plot-approve` rewrites. They agree
 * at the start and disagree the moment the approval lands — which is the whole
 * defect.
 *
 * @param branch the one branch the plan names, so the scan has a wave to judge.
 */
const bothShapesPlan = (branch) => `---
status: Draft
phase: Draft
type: bug
---

# A plan carrying two phase records

## Status

- **State:** Draft
- **Type:** bug
- **Review:** pr
- **Impl:** own branches
- **Approved:**

## Branches

### Wave one

- \`${branch}\` — do the thing
`;

/** The same plan with ONE record, in the block — what nearly every plan looks like. */
const statusOnlyPlan = (branch) => `# A plan carrying one phase record

## Status

- **State:** Draft
- **Type:** bug
- **Review:** pr
- **Impl:** own branches
- **Approved:**

## Branches

### Wave one

- \`${branch}\` — do the thing
`;

before(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-effect-stub-'));
  statePath = path.join(stubDir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({ number: 42, state: 'OPEN', draft: false }));
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/usr/bin/env bash
exec node "${stubDir}/gh.mjs" "$@"
`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
  fs.writeFileSync(path.join(stubDir, 'gh.mjs'), `
import fs from 'node:fs';
const argv = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'));
if (argv[0] === 'pr' && argv[1] === 'view') {
  process.stdout.write(JSON.stringify({
    number: state.number, state: state.state, isDraft: state.draft,
    url: 'https://example.invalid/pr/' + state.number, mergeCommit: null,
  }));
} else if (argv[0] === 'pr' && argv[1] === 'merge') {
  state.state = 'MERGED';
  fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(state));
  process.stdout.write('merged');
} else if (argv[0] === 'pr' && argv[1] === 'list') {
  process.stdout.write('[]');
} else if (argv[0] === 'repo' && argv[1] === 'view') {
  process.stdout.write('main');
} else {
  process.stdout.write('{}');
}
`);
});

after(() => fs.rmSync(stubDir, { recursive: true, force: true }));

/**
 * Approve a plan for real, then ask the scan what it sees.
 *
 * The scan runs OFFLINE: it derives waves from git refs and plan files, and the
 * host question it would otherwise ask is about PR state, which this test does
 * not vary. Keeping it offline makes the assertion about the phase and nothing
 * else.
 *
 * @param planBody the whole plan file, so each test states its own shape.
 * @returns the approval output and the scan's JSON before and after it.
 */
const approveThenScan = (planBody) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-effect-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  try {
    git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
    git(tmp, 'clone', '-q', origin, repo);
    git(repo, 'config', 'user.email', 'test@example.invalid');
    git(repo, 'config', 'user.name', 'Plot Test');
    git(repo, 'config', 'commit.gpgsign', 'false');

    fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
      '## Plot Config\n\n- **Plan directory:** docs/plans/\n'
      + '- **Active index:** docs/plans/active/\n');
    fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
    const rel = 'docs/plans/2026-09-17-two-records.md';
    fs.writeFileSync(path.join(repo, rel), planBody);
    fs.symlinkSync('../2026-09-17-two-records.md',
      path.join(repo, 'docs', 'plans', 'active', 'two-records.md'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'plan');
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');

    const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, PLOT_HOST: 'github' };
    const runScan = () => JSON.parse(execFileSync('bash', [scan, '--json', '--offline'],
      { cwd: repo, encoding: 'utf8', env }));

    const before = runScan();

    let out = '';
    let code = 0;
    try {
      out = execFileSync('bash', [approve, 'two-records'],
        { cwd: repo, encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      code = e.status ?? 1;
    }

    git(repo, 'fetch', '-q', 'origin', 'main');
    const onMain = git(repo, 'show', `origin/main:${rel}`);
    return { out, code, before, after: runScan(), onMain };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

/** The scan's verdict for the plan's one wave, whatever shape the payload takes. */
const waveOf = (scanJson) => {
  const plan = (scanJson.plans ?? [])[0];
  assert.ok(plan, `the scan reported no plan:\n${JSON.stringify(scanJson, null, 2)}`);
  const wave = (plan.waves ?? [])[0];
  assert.ok(wave, `the plan reported no wave:\n${JSON.stringify(plan, null, 2)}`);
  return wave;
};

test('an approval on a two-record plan is visible to the scan', () => {
  // THE CLAUSE THAT PROVES THE FIX. Against the old precedence this run wrote
  // `State: Approved`, reported every step clean, and left the scan answering
  // `unapproved, eligible=0` — the parser read the front matter no transition
  // had touched.
  const r = approveThenScan(bothShapesPlan('bug/two-records-work'));

  assert.equal(r.code, 0, `the approval should succeed:\n${r.out}`);

  // The precondition that makes the assertion mean anything: the plan was NOT
  // eligible beforehand, so a scan that answered `eligible=1` for some other
  // reason would fail here rather than pass silently.
  assert.notEqual(waveOf(r.before).verdict, 'eligible',
    'a Draft plan must not be eligible — otherwise this proves nothing');

  // THE WRITER WROTE THE CANONICAL FIELD AND ONLY IT. Front matter is left at
  // `Draft`, which is precisely the disagreement the parser now resolves the
  // other way.
  assert.match(r.onMain, /- \*\*State:\*\* Approved/, 'the approval did not write State:');
  assert.match(r.onMain, /^status: Draft$/m, 'front matter should be untouched by the writer');

  // AND AN INDEPENDENT READER SEES IT.
  assert.equal(waveOf(r.after).verdict, 'eligible',
    'the scan cannot see the approval — the parser is reading a field nobody writes');
});

test('an approval on a one-record plan is visible exactly as before', () => {
  // The no-regression half, covering every plan in this repository: one record,
  // in the block, writer and parser agreeing all along.
  const r = approveThenScan(statusOnlyPlan('bug/one-record-work'));

  assert.equal(r.code, 0, `the approval should succeed:\n${r.out}`);
  assert.notEqual(waveOf(r.before).verdict, 'eligible');
  assert.equal(waveOf(r.after).verdict, 'eligible');
});
