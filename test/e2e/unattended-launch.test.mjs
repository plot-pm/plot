// Flow test: the launch paths declare that nobody is watching.
//
// Wave 1 (#230) built the behaviour — PLOT_UNATTENDED and the per-question
// shapes. Nothing set it. This suite covers the signal half: the two places
// that launch an agent with no person attached must put the variable into that
// agent's environment.
//
// Why this is a flow test and not a grep. The measurement in
// skills/plot/docs/unattended.md is what makes a prose check worthless here:
//
//   Under `claude -p`, AskUserQuestion is not registered at all. The agent
//   notices, writes what it would have asked into its prose, and exits 0.
//
// So a worker launched WITHOUT the variable does not hang and does not fail —
// it improvises and reports success. There is no runtime symptom to assert
// against. The only thing that can go wrong observably is the variable failing
// to ARRIVE, and it can fail to arrive for reasons no reading of CLAUDE.md
// reveals: plot-config.sh rewrites the value it parses (it strips backticks and
// parenthetical prose), and plot-dispatch.sh re-wraps that value in `sh -c`.
// Both transforms sit between the text a human edits and the process that runs.
// So we assert from the launch path, by running it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, runScript, sh, REPO_ROOT, SCRIPTS } from './helpers.mjs';

const PLAN_CONFIG = '- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n';

/** An approved single-wave plan on origin, so dispatch has something eligible. */
function dispatchablePlan(work, { slug = 'unattended-flow', date = '2026-08-19' } = {}) {
  const rel = `docs/plans/${date}-${slug}.md`;
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(work, rel), `# Unattended flow

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** ${date}, alice, in-session

## Branches

### Implementation
- \`feature/solo\` — the one branch a worker is started on
`);
  fs.symlinkSync(`../${date}-${slug}.md`, path.join(work, 'docs', 'plans', 'active', `${slug}.md`));
  sh(work, 'git add -A && git commit -qm plan && git push -q origin main');
  return rel;
}

/**
 * A `Worker command` that is not an agent but a recorder: it dumps the
 * environment it was launched with, so the test can read what actually
 * arrived rather than what the config appears to say.
 *
 * `prefix` is what a repo puts in front of its command. Passing '' models the
 * pre-wave-2 config, which is how this test proves it can see the difference.
 */
function recorderConfig(dumpFile, prefix = 'PLOT_UNATTENDED=1 ') {
  return `${PLAN_CONFIG}- **Worker command:** ${prefix}sh -c 'env > ${dumpFile}'\n`;
}

/** Dispatch one worker in a fresh sandbox and return the environment it got. */
function launchAndCaptureEnv(name, prefix) {
  const sb = makeSandbox({ name, config: '' });
  const dump = path.join(sb.root, 'worker-env.txt');
  fs.writeFileSync(
    path.join(sb.work, 'CLAUDE.md'),
    `# Sandbox\n\n## Plot Config\n\n${recorderConfig(dump, prefix)}\n`,
  );
  // dispatchablePlan commits and pushes; the config edit rides along with it.
  dispatchablePlan(sb.work);
  try {
    // No --no-start: starting the worker is the whole point of this test.
    runScript('plot-dispatch.sh', ['--offline', '--max', '1', 'unattended-flow'], { cwd: sb.work });

    // The worker is detached, so wait for the recorder to land its file.
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(dump) && Date.now() < deadline) {
      sh(sb.work, 'sleep 0.2');
    }
    assert.ok(fs.existsSync(dump), 'dispatch never started a worker (no environment dump was written)');
    return fs.readFileSync(dump, 'utf8');
  } finally {
    sb.cleanup();
  }
}

test('a dispatched worker is launched with PLOT_UNATTENDED set', () => {
  // The DoD's first line, asserted where it is decidable: the environment of
  // the process dispatch actually started.
  const env = launchAndCaptureEnv('unattended-dispatch', 'PLOT_UNATTENDED=1 ');

  assert.match(env, /^PLOT_UNATTENDED=1$/m,
    'a dispatched worker ran WITHOUT PLOT_UNATTENDED — it would improvise at every question site and still exit 0');

  // Sanity: the recorder really was the dispatched worker, not a stray shell.
  assert.match(env, /^PLOT_BRANCH=feature\/solo$/m, 'the dump did not come from the dispatched worker');
});

test('control: the same launch path without the prefix yields a worker that has no idea', () => {
  // Without this, the test above proves only that `sh -c` propagates an
  // assignment — it would stay green for a repo whose Worker command never set
  // the variable. This pins the difference the config edit actually makes, and
  // it is also the state every Plot-adopting repo is in by default: dispatch
  // adds nothing of its own, because the variable is a repo's declaration to
  // make (Principle 4/5), not Plot's to impose.
  const env = launchAndCaptureEnv('unattended-control', '');

  assert.doesNotMatch(env, /^PLOT_UNATTENDED=/m,
    'dispatch injected PLOT_UNATTENDED itself — the variable must come from the repo\'s Worker command, not from Plot');
  assert.match(env, /^PLOT_BRANCH=feature\/solo$/m, 'the dump did not come from the dispatched worker');
});

test('this repo\'s own Worker command carries the variable through the parser', () => {
  // CLAUDE.md is the repo's real config, and plot-config.sh is the only thing
  // that reads it. Asserting the parsed value — not the file's text — is what
  // catches a well-meant edit that adds backticks or a parenthetical, both of
  // which plot-config.sh strips.
  const parsed = String(
    runScript('plot-config.sh', ['get', 'Worker command', ''], { cwd: REPO_ROOT }),
  ).trim();

  assert.ok(parsed.length > 0, 'this repo has no Worker command configured');
  assert.match(parsed, /(^|\s)PLOT_UNATTENDED=1(\s|$)/,
    'the Worker command launches an agent with nobody attached but never says so');

  // The assignment must PREFIX the command, or it is an argument to it rather
  // than an environment variable for it.
  assert.match(parsed, /^PLOT_UNATTENDED=1\s+\S/,
    'PLOT_UNATTENDED must prefix the command so the shell treats it as an assignment');

  // The marker instruction answers a different question and must survive: the
  // variable says "nobody can answer, take your documented path", the marker
  // says "I stopped anyway, and here is why". plot-worker-state.sh reads it to
  // report `waiting`.
  assert.match(parsed, /PLOT-BLOCKED/,
    'the PLOT-BLOCKED marker instruction was dropped; a stopped worker becomes indistinguishable from a finished one');
});

test('the ralph sprint loop exports the variable before any claude invocation', () => {
  const script = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'ralph-plot-sprint', 'ralph-sprint.sh'), 'utf8');
  const lines = script.split('\n');

  const exportLine = lines.findIndex((l) => /^\s*export\s+PLOT_UNATTENDED=1\s*$/.test(l));
  assert.ok(exportLine >= 0, 'ralph-sprint.sh runs `claude -p` in a loop but never declares it unattended');

  // An export that lands after a call site covers nothing. The loop and the
  // wrap-up are separate invocations, which is why this is exported once at
  // the top rather than prefixed onto each one.
  const firstInvocation = lines.findIndex((l) => /RALPH_SPRINT_CLAUDE\s/.test(l) && !/^\s*#/.test(l) && !/:-/.test(l));
  if (firstInvocation >= 0) {
    assert.ok(exportLine < firstInvocation,
      `export PLOT_UNATTENDED (line ${exportLine + 1}) must precede the first claude invocation (line ${firstInvocation + 1})`);
  }
});

test('PLOT_UNATTENDED does not convert a refusal into a pass', () => {
  // The one rule that must not bend, asserted against a real gate rather than
  // against prose: the phase gate blocks implementation commits while the plan
  // is Draft. Set or unset, it must refuse identically — an unattended runner's
  // power has to stay strictly smaller than an operator's.
  const sb = makeSandbox({ name: 'unattended-gate', config: PLAN_CONFIG });
  try {
    const rel = 'docs/plans/2026-08-19-still-a-draft.md';
    fs.mkdirSync(path.join(sb.work, 'docs', 'plans', 'active'), { recursive: true });
    fs.writeFileSync(path.join(sb.work, rel), `# Still a draft

## Status

- **Phase:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Branches

### Implementation
- \`feature/gated\` — must not be committable while the plan is Draft
`);
    fs.symlinkSync('../2026-08-19-still-a-draft.md',
      path.join(sb.work, 'docs', 'plans', 'active', 'still-a-draft.md'));
    sh(sb.work, 'git add -A && git commit -qm plan && git push -q origin main');

    // The gate keys the plan off the BRANCH's slug, so the branch must be
    // named for the plan or nothing is in scope and the gate allows by design.
    sh(sb.work, 'git checkout -q -b feature/still-a-draft');
    fs.writeFileSync(path.join(sb.work, 'src.txt'), 'implementation, not a plan edit\n');
    sh(sb.work, 'git add src.txt');

    // The gate is a PreToolUse hook: JSON on stdin, exit 2 blocks.
    const runGateWith = (env) => {
      try {
        execFileSync('bash', [path.join(SCRIPTS, 'plot-phase-gate.sh')], {
          cwd: sb.work,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          input: JSON.stringify({ tool_input: { command: 'git commit -q -m "feat: code"' } }),
          env: { ...process.env, ...env },
        });
        return 'allowed';
      } catch (e) {
        return e.status === 2 ? 'refused' : `error(${e.status})`;
      }
    };

    const attended = runGateWith({ PLOT_UNATTENDED: '' });
    const unattended = runGateWith({ PLOT_UNATTENDED: '1' });

    // Control first: if the gate does not fire attended, the comparison below
    // would pass for the wrong reason.
    assert.equal(attended, 'refused',
      'control: the gate must block a code commit on a Draft plan');
    assert.equal(unattended, attended,
      `the gate behaved differently with PLOT_UNATTENDED set (unset: ${attended}, set: ${unattended}) — the variable answers "may I ask?", never "may I proceed?"`);
  } finally {
    sb.cleanup();
  }
});
