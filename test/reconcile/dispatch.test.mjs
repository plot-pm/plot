// Contract test for skills/plot/scripts/plot-dispatch.sh — worktree fan-out.
//
// This is the one script in the fleet that WRITES: it creates worktrees, pushes
// claim refs, and starts workers. Everything it writes must therefore be either
// idempotent or refused, and `--dry-run` must show exactly what would happen
// without doing any of it. These tests hold that line.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatch = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-dispatch.sh');

let tmp, repo;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function run(args, cwd = repo) {
  return execFileSync('bash', [dispatch, ...args], { encoding: 'utf8', cwd });
}

/**
 * Lay a desk out and hand it to a worker — the launch, reached through the verb
 * that still reaches it.
 *
 * **`--restart` IS NOW THE ONLY CALLER OF `start_worker`.** The fan-out stopped
 * being one on 2026-09-04: dispatch hands a slice to the registry and returns,
 * because `DESIGN-agent.md:157` settles that nothing starts a worker — the
 * registry spawns an agent, and spawning it IS starting its process.
 *
 * The launch machinery itself is unchanged, and so are the contracts every test
 * below asserts about it: one manifest per agent, the AGENT's pid rather than
 * the wrapper's, the session id reaching the worker, no manifest meaning no
 * worker. They are asked through `--restart` because that is where the code is
 * reached from, not because anything about it moved.
 *
 * `--offline` is what makes the fixture cheap: `reached_review` returns at once
 * without asking a host, so a fresh desk with no PR restarts.
 *
 * @param repoRoot the checkout to run in.
 * @param branch the branch to lay out and staff.
 * @param wt where the desk goes.
 * @returns what the run printed.
 */
/**
 * Lay a desk out, without staffing it — what dispatch used to do and no longer
 * does.
 *
 * `--status` and `--stop` READ DESKS, and the desks they read are the agents'
 * own: since 2026-09-04 an agent creates or resets its desk when it takes a
 * brief, so a fixture that means to have one makes it. That is the honest
 * shape — a desk with no agent is exactly what these verbs report on.
 *
 * @param repoRoot the checkout to run in.
 * @param branch the branch to lay out.
 * @param wt where the desk goes.
 * @returns the desk's path.
 */
function desk(repoRoot, branch, wt) {
  git(repoRoot, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
  git(wt, 'push', '-qu', 'origin', branch);
  return wt;
}

function staff(repoRoot, branch, wt) {
  git(repoRoot, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
  git(wt, 'push', '-qu', 'origin', branch);
  return execFileSync('bash', [dispatch, '--offline', '--restart', branch],
    { encoding: 'utf8', cwd: repoRoot, timeout: 30_000 });
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-01-fan.md'), `# Fan-out plan

## Status

- **Phase:** Approved
- **Type:** feature
- **Impl:** own branches

## Branches

### Implementation
- \`feature/one\` — first
- \`feature/two\` — second
- \`feature/skipped\` — not needed <!-- deferred: folded in -->
`);
  fs.symlinkSync('../2026-01-01-fan.md', path.join(repo, 'plans', 'active', 'fan.md'));
  // BRIEFS, BECAUSE THE GATE NOW REFUSES AT THE HAND-OVER. It used to refuse
  // the launch, so a briefless fixture still cut desks and claimed refs and
  // every fan-out assertion below held. Refused at the hand-over there is
  // nothing to assert about, so a fixture that means to be dispatched carries
  // its briefs — which is what a real plan does.
  const briefs = path.join(repo, '.plot', 'briefs');
  fs.mkdirSync(briefs, { recursive: true });
  fs.writeFileSync(path.join(briefs, 'one.md'), 'spec for one\n');
  fs.writeFileSync(path.join(briefs, 'two.md'), 'spec for two\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('dispatch: --dry-run lists eligible branches and creates nothing', () => {
  const out = run(['--dry-run', '--offline', 'fan']);
  assert.match(out, /feature\/one/);
  assert.match(out, /feature\/two/);
  // Deferred branches are never work.
  assert.doesNotMatch(out, /feature\/skipped/);

  // Nothing may exist yet: no worktrees, no refs, no working-tree changes.
  assert.equal(git(repo, 'worktree', 'list').trim().split('\n').length, 1);
  assert.equal(git(repo, 'ls-remote', '--heads', 'origin', 'feature/one').trim(), '');
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('dispatch: --dry-run reports the missing brief rather than refusing', () => {
  // A DIRECT script call cannot write a hand-off brief — a brief is
  // interpretation, and no script here invokes a skill. So it says so, in the
  // summary, and RUNS ANYWAY. --dry-run and --status are the normal way to look
  // before leaping (this repo used the bare script five times in one evening),
  // and a gate that blocks looking-before-leaping is a gate in the wrong place.
  const out = run(['--dry-run', '--offline', 'fan']);
  assert.match(out, /summary: .*brief=missing/,
    `the summary must report the gap:\n${out}`);
  // Still a working dry run — the report must not have cost it its job.
  assert.match(out, /feature\/one/);
  assert.equal(git(repo, 'ls-remote', '--heads', 'origin', 'feature/one').trim(), '');
});

test('dispatch: the script never invokes a skill', () => {
  // The plan's own first draft proposed `plot-dispatch.sh` calling
  // /plot-implement. That inverts the Manifesto's direction — scripts collect
  // and report, skills interpret — and it is not merely wrong but impossible:
  // bash has no way to reach a skill, which lives inside an agent session.
  // The brief is written by the plot-dispatch SKILL, one layer up.
  const src = fs.readFileSync(path.join(here, '..', '..', 'skills', 'plot',
    'scripts', 'plot-dispatch.sh'), 'utf8');
  // What counts as an invocation is a COMMAND POSITION, not a mention. The
  // script may name a skill in a comment (the reasoning above does) and may
  // TELL A HUMAN to run one — line 216 already prints "Review it, then:
  // /plot-approve <slug>", and that advice is the script doing its job. So the
  // assertion looks for a skill name where a command would go: at the start of
  // a statement, after a pipe, or inside a substitution.
  const code = src.split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .filter((l) => !/^\s*echo\s/.test(l))
    .join('\n');
  assert.doesNotMatch(code, /(^|[;&|(`]|\$\()\s*\/?plot-(implement|idea|approve|deliver|release)\b/m,
    'plot-dispatch.sh must not invoke a skill');
});

// ---------------------------------------------------------------------------
// The brief gate
// ---------------------------------------------------------------------------
//
// A brief is a branch's specification: the `Worker command`'s first instruction
// is "Read `.plot/briefs/<branch-suffix>.md` first — it is the specification".
// When the file is absent the worker reads nothing and improvises — measured
// 2026-08-20 as an agent running 2:12 against a 700-line wave with no spec.
//
// The defect was that the script DETECTED the gap (`brief=missing` in its
// footer) and started the worker anyway: a rule where a gate belongs. It became
// a gate, and on 2026-09-04 the gate MOVED — its rule unchanged, its position
// from the launch to the hand-over.
//
// THAT MOVE IS WHAT THESE TESTS NOW ASSERT. Dispatch prepares nothing: it cuts
// no desk, pushes no claim and starts no worker, so a refused slice leaves
// NOTHING rather than leaving a prepared desk nobody sat at. What used to be
// "prepared, not started" is now "not handed over", and `--no-brief` keeps its
// meaning exactly — it hands over without a brief and says so, in the tradition
// of `--allow-local`.

/** A repo whose plan has a real `Worker command`, with control over the brief. */
function repoForBrief(label, { brief, briefCommand } = {}) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-brief-${label}-`));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  // A real Worker command, so a start is genuinely ATTEMPTED — it drops a
  // sentinel and exits, letting a test tell a launched worker from a refused one.
  const sentinel = path.join(t, 'worker-ran');
  // `Brief command` is what a refused dispatch calls. Like the worker command
  // it is a real command that leaves a sentinel, so a test can tell "asked" from
  // "said it asked" — and it writes the brief the second dispatch must find.
  const briefRan = path.join(t, 'brief-ran');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + `- **Worker command:** touch ${sentinel}\n`
    + (briefCommand === undefined ? '' : `- **Brief command:** ${briefCommand}\n`));
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-b.md'),
    '# B\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/needs` — one\n');
  fs.symlinkSync('../2026-01-01-b.md', path.join(r, 'plans', 'active', 'b.md'));
  // `brief` is: undefined → no file; a string → that content; { mode } → written
  // then chmod'd (an unreadable brief). The suffix is the branch after its last /.
  let briefFile;
  if (brief !== undefined) {
    const dir = path.join(r, '.plot', 'briefs');
    fs.mkdirSync(dir, { recursive: true });
    briefFile = path.join(dir, 'needs.md');
    fs.writeFileSync(briefFile, typeof brief === 'object' ? brief.body : brief);
  }
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');
  // Restrict the mode AFTER commit — the gate reads the working-tree file, and a
  // 0o000 file cannot be `git add`ed. The dispatcher reads the checked-out copy.
  if (typeof brief === 'object' && brief.mode !== undefined) fs.chmodSync(briefFile, brief.mode);
  const wt = path.join(path.dirname(r), 'plot-wt-feature-needs');
  return {
    tmp: t, repo: r, sentinel, worktree: wt, briefRan,
    // The brief command is detached, so a test must wait for it exactly as it
    // waits for a worker.
    briefCommandRan: () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !fs.existsSync(briefRan)) execFileSync('sleep', ['0.1']);
      return fs.existsSync(briefRan);
    },
    // Give the detached worker a moment to touch its sentinel, if it was started.
    workerStarted: () => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !fs.existsSync(sentinel)) execFileSync('sleep', ['0.1']);
      return fs.existsSync(sentinel);
    },
    cleanup: () => {
      fs.rmSync(t, { recursive: true, force: true });
      fs.rmSync(wt, { recursive: true, force: true });
    },
  };
}

test('dispatch: a branch with no brief is not handed over, and nothing is prepared', () => {
  // THE GATE MOVED, AND WHAT IT LEAVES BEHIND MOVED WITH IT. It used to refuse
  // the launch after cutting a desk and pushing a claim, so a briefless branch
  // left a worktree nobody sat at. Refused at the hand-over it leaves nothing:
  // no desk, no ref, and a slice still sitting in the queue.
  const f = repoForBrief('none');
  const out = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /not handed over/, `the refusal must say what did not happen:\n${out}`);
  assert.doesNotMatch(out, /handed over feature\/needs/, `it must not claim the hand-over:\n${out}`);

  // NOTHING WAS PREPARED. Both of these were the OLD contract's assertions,
  // inverted — which is the whole of what this branch changed about a refusal.
  assert.doesNotMatch(git(f.repo, 'worktree', 'list'), /plot-wt-feature-needs/,
    'a refused slice leaves no desk');
  assert.equal(git(f.repo, 'ls-remote', '--heads', 'origin', 'feature/needs').trim(), '',
    'a refused slice leaves no claim, so it is still queued');
  assert.equal(f.workerStarted(), false, 'nothing may be started without a brief');

  // The message names the REF it looked at and the two ways forward.
  assert.match(out, /\.plot\/briefs\/needs\.md/, `must name the brief file:\n${out}`);
  assert.match(out, /origin\/main/, `must name the ref the agent will read:\n${out}`);
  assert.match(out, /plot-implement/i, `must offer writing the brief:\n${out}`);
  assert.match(out, /--no-brief/, `must offer the named escape:\n${out}`);
  f.cleanup();
});

test('dispatch: a branch WITH a brief is handed to the registry', () => {
  const f = repoForBrief('present', { brief: 'Real specification.\n' });
  const out = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });
  assert.match(out, /handed over feature\/needs → the registry/,
    `a brief present must hand the slice over:\n${out}`);
  assert.match(out, /summary: .*dispatched=1/, `the hand-over must be counted:\n${out}`);

  // AND IT STARTS NOTHING. `DESIGN-agent.md:157` — nothing starts a worker; the
  // registry spawns an agent, and spawning it IS starting its process.
  assert.equal(f.workerStarted(), false, 'dispatch hands work to the fleet; it does not staff it');
  f.cleanup();
});

test('dispatch: --no-brief hands over a briefless branch and says so', () => {
  // The named escape, and it keeps its meaning across the move. A gate with no
  // exit is one people route around by not using the tool — four briefs were
  // hand-written to beat auto-dispatch to the claim on 2026-08-27 for exactly
  // this reason. --no-brief hands it over AND says so in the log, so the
  // override is on the record rather than silent.
  const f = repoForBrief('escape');
  const out = execFileSync('bash', [dispatch, '--offline', '--no-brief', 'b'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });
  assert.match(out, /handed over feature\/needs/, `--no-brief must hand over despite no brief:\n${out}`);
  assert.match(out, /--no-brief/, `the override must be stated in the log:\n${out}`);
  assert.match(out, /summary: .*dispatched=1/, `the hand-over must be counted:\n${out}`);
  f.cleanup();
});

test('dispatch: a brief the worker cannot read is treated as missing, not present', () => {
  // A zero-byte or permission-denied file is not a specification. This is the
  // assertion a naive `[ -f ]` check fails: the file exists, but there is
  // nothing to read. An empty brief is the case measured — a claimed worktree
  // with a placeholder file that says nothing.
  const empty = repoForBrief('empty', { brief: '' });
  const out = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: empty.repo, timeout: 30_000 });
  assert.equal(empty.workerStarted(), false, 'an empty brief is not a specification');
  assert.match(out, /summary: .*started=0/, `an empty brief must not start a worker:\n${out}`);
  assert.match(out, /\.plot\/briefs\/needs\.md/, `must still name the file:\n${out}`);
  empty.cleanup();

  // A brief that exists ONLY in the operator's working tree is equally not a
  // specification — it is invisible to the worker, whose worktree is created
  // from origin/<main>. This is the direction that fails DANGEROUSLY: the file
  // is right there, so a filesystem check passes the gate and starts a worker
  // into an empty spec, which is the failure the gate exists to prevent.
  //
  // This replaced a permission-denied case on 2026-08-27. That case tested a
  // filesystem mode, and once the gate reads a git blob there is no mode to
  // deny — its fixture even had to chmod AFTER committing, because a 0o000 file
  // cannot be `git add`ed. That awkwardness was the defect showing through.
  const unpushed = repoForBrief('unpushed');
  fs.mkdirSync(path.join(unpushed.repo, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(unpushed.repo, '.plot', 'briefs', 'needs.md'),
    'a real brief, committed nowhere\n');
  const out2 = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: unpushed.repo, timeout: 30_000 });
  assert.equal(unpushed.workerStarted(), false, 'an unpushed brief is invisible to the worker');
  assert.match(out2, /summary: .*started=0/, `an unpushed brief must not start a worker:\n${out2}`);
  assert.match(out2, /origin\/main:\.plot\/briefs\/needs\.md/,
    `the refusal must name the ref it looked at, not a local path:\n${out2}`);
  unpushed.cleanup();
});

test('dispatch: the footer agrees with what happened', () => {
  // `brief=missing` must never print beside a non-zero `started` unless the
  // operator passed --no-brief. Today the footer reads
  // `... started=2 ... brief=missing` — the exact contradiction this removes:
  // the gap is detected, printed, and not acted on.
  const missing = repoForBrief('agree-missing');
  const outMissing = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: missing.repo, timeout: 30_000 });
  const footerMissing = outMissing.split('\n').find((l) => l.startsWith('summary: ')) ?? '';
  // A missing brief is not handed over, so `brief=missing` sits beside a
  // hand-over count of zero and a skip.
  assert.match(footerMissing, /brief=missing/, `the field must still be reported:\n${footerMissing}`);
  assert.match(footerMissing, /dispatched=0/,
    `brief=missing must not sit beside a hand-over:\n${footerMissing}`);
  assert.match(footerMissing, /skipped=1/,
    `the refused slice must be counted:\n${footerMissing}`);
  missing.cleanup();

  // With --no-brief the hand-over is licensed, so a non-zero count is honest.
  const escape = repoForBrief('agree-escape');
  const outEscape = execFileSync('bash', [dispatch, '--offline', '--no-brief', 'b'],
    { encoding: 'utf8', cwd: escape.repo, timeout: 30_000 });
  const footerEscape = outEscape.split('\n').find((l) => l.startsWith('summary: ')) ?? '';
  assert.match(footerEscape, /dispatched=1/,
    `--no-brief must let the hand-over count:\n${footerEscape}`);
  escape.cleanup();
});

// ---------------------------------------------------------------------------
// What the gate does AFTER it fires: `Brief command`
// ---------------------------------------------------------------------------
//
// The gate above refuses and stops. That refusal is correct and stays; what it
// never had is a next step, which is why every brief on this estate was written
// by hand. `Brief command` is the next step — one config key, the shape
// `Idea command`, `Story command` and `Approve command` already use, asked to
// run `/plot-implement <slug>` because that skill already owns brief
// authorship.
//
// Two arms, and BOTH must name themselves in the log. A dispatch that refused
// for a missing brief must say what it did about it, or the operator is back to
// inferring — the exact failure the key exists to remove.

test('dispatch: a refused dispatch calls the configured Brief command', () => {
  // The first arm. The gate refuses as before — the worktree and claim stand,
  // no worker runs — and the run then SAYS what it did next, naming the command
  // it called. The stand-in command drops a sentinel, so the test can tell
  // "asked" from "said it asked".
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-briefcmd-'));
  const ran = path.join(t, 'brief-ran');
  const f = repoForBrief('ask', { briefCommand: `sh -c 'touch ${ran}' plot-brief` });
  const out = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  // The refusal's RULE is unchanged; only its position moved, from the launch
  // to the hand-over — so a refused slice is not handed over rather than
  // prepared-and-not-started.
  assert.match(out, /not handed over/, `the gate must still refuse:\n${out}`);
  assert.equal(f.workerStarted(), false, 'asking for a brief must not start a worker');
  assert.match(out, /summary: .*dispatched=0/, `nothing may be counted as handed over:\n${out}`);

  // And now it says what it did about it.
  assert.match(out, /Brief command/, `the run must name what it called:\n${out}`);
  const footer = out.split('\n').find((l) => l.startsWith('summary: ')) ?? '';
  assert.match(footer, /brief_asked=1/, `the ask must be counted:\n${footer}`);

  // The command really ran — detached, so wait for it.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !fs.existsSync(ran)) execFileSync('sleep', ['0.1']);
  assert.equal(fs.existsSync(ran), true, 'the Brief command must actually be invoked');

  f.cleanup();
  fs.rmSync(t, { recursive: true, force: true });
});

test('dispatch: with no Brief command it refuses by name and calls nothing', () => {
  // The second arm, and the reason `absent` is modelled as a named refusal
  // rather than an error. A project that has never set the key behaves exactly
  // as it did before — prepared, not started, no worker. What is new is that the
  // log says WHY nothing was called, instead of leaving the operator to notice
  // that nothing happened.
  const f = repoForBrief('unconfigured');
  const out = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /no-brief-command/,
    `the refusal must name itself, the way commission.ts names no-idea-command:\n${out}`);
  assert.match(out, /Brief command/, `it must name the key that is the fix:\n${out}`);
  assert.equal(f.workerStarted(), false, 'no brief still means no worker');
  const footer = out.split('\n').find((l) => l.startsWith('summary: ')) ?? '';
  assert.match(footer, /brief_asked=0/, `nothing was asked, so the footer counts zero:\n${footer}`);
  f.cleanup();
});

test('dispatch: `Brief command: none` is an answer, not a missing key', () => {
  // `none` reads the way it does for `Worker command`: asked, and answered "we
  // write them by hand". Running it would spawn `none: command not found` once
  // per briefless branch — a deliberate answer turned into N crashed processes.
  const f = repoForBrief('declined', { briefCommand: 'none' });
  const out = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });
  assert.match(out, /no-brief-command/, `none must refuse, never run:\n${out}`);
  const footer = out.split('\n').find((l) => l.startsWith('summary: ')) ?? '';
  assert.match(footer, /brief_asked=0/, `none asks nothing:\n${footer}`);
  f.cleanup();
});

test('dispatch: a brief written by the callback lands where the gate reads it', () => {
  // THE PROPERTY THE WHOLE KEY RESTS ON. A callback writing to a path the gate
  // does not read would produce a file, report success, and refuse the same
  // branch again on every pass — a loop that writes a brief per dispatch and
  // never starts a worker. That is exactly the failure the Naming slice found:
  // three briefs written under `feature-…` names no reader computes.
  //
  // The proof is not that a file appeared. It is that DISPATCHING THE SAME
  // BRANCH AGAIN STARTS IT. The gate reads `origin/<main>`, so only a brief
  // committed and pushed there can flip the second run.
  //
  // The stand-in command writes the brief itself rather than invoking an agent.
  // What is under test is the plumbing — the command runs, the path a writer
  // following the gate's own rule produces is the path the gate reads, and the
  // second dispatch starts. It also asserts the PROMPT arrived whole: a prompt
  // that word-split would make `$1` a fragment, and this test would otherwise
  // pass while the real command received garbage.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-brieflands-'));
  const writer = path.join(t, 'write-brief.sh');
  // The writer takes NO repo path: `request_brief` runs it with the repository
  // root as its cwd, and relying on that is the point — a command configured by
  // a project cannot be handed a path this script computed.
  fs.writeFileSync(writer, `#!/bin/sh
case "$1" in
  *'/plot-implement b'*) : ;;
  *) echo "prompt did not arrive whole: [$1]" >&2; exit 1 ;;
esac
mkdir -p .plot/briefs || exit 1
printf 'A real specification, written by the callback.\\n' > .plot/briefs/needs.md || exit 1
git add .plot/briefs/needs.md || exit 1
git -c user.email=t@e.invalid -c user.name=T -c commit.gpgsign=false commit -qm brief || exit 1
git push -q origin main || exit 1
`, { mode: 0o755 });

  const f = repoForBrief('lands', { briefCommand: `sh ${writer}` });

  // Pass one: refused, and the callback asked.
  const out1 = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: f.repo, timeout: 60_000 });
  assert.equal(f.workerStarted(), false, 'the refusal stands — asking does not start a worker');
  assert.match(out1, /summary: .*dispatched=0/, `nothing may be handed over on the first pass:\n${out1}`);

  // The callback is detached, so wait for the brief to reach the ref the gate
  // reads. That ref — not the working tree — is the whole assertion.
  const briefOnRef = () => {
    const p = spawnSync('git', ['-C', f.repo, 'cat-file', '-s', 'origin/main:.plot/briefs/needs.md'],
      { encoding: 'utf8' });
    return p.status === 0 && Number(p.stdout.trim()) > 0;
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !briefOnRef()) execFileSync('sleep', ['0.2']);
  assert.equal(briefOnRef(), true,
    'the callback must land the brief on origin/main, where the gate reads it');

  // NOTHING HAS TO BE UNDONE BETWEEN THE TWO PASSES, and that is the change
  // rather than an omission. Pass one used to claim the branch, and a claimed
  // branch is never offered again — so the test released the claim by hand to
  // reach the second pass at all. A refused slice now leaves nothing behind, so
  // the branch is still exactly where the queue had it, and the ONE difference
  // between the passes is the one this test is about: a brief on the ref.
  const out2 = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: f.repo, timeout: 60_000 });
  assert.match(out2, /handed over feature\/needs/,
    `dispatching again after the callback wrote the brief must hand the slice over:\n${out2}`);
  assert.match(out2, /summary: .*dispatched=1/, `the second pass must count it:\n${out2}`);

  f.cleanup();
  fs.rmSync(t, { recursive: true, force: true });
});

test('dispatch: a brief older than its plan is reported, never refused', () => {
  // STALENESS REPORTS AND NEVER GATES, and the measurement is why. Compared
  // 2026-09-01, all three live briefs were older than their plans and all three
  // were CORRECT — every plan edit between them was bookkeeping. A timestamp
  // gate would have refused 3 of 3 on the day it shipped, and a gate that
  // refuses everything is one people disable in its first week.
  //
  // It would also have missed the real case: the teardown brief was written
  // AFTER its plan and was still wrong, citing 80 `fs.rmSync` sites where the
  // tree held 76. The CODE moved, not the plan — so freshness against the plan
  // is the wrong input, and this is a hint that says it is a hint.
  const f = repoForBrief('stale', { brief: 'A brief, written before the plan moved.\n' });

  // Move the plan AFTER the brief, so the brief is strictly older. Sleep one
  // second: git commit timestamps have one-second resolution, and two commits
  // in the same second compare equal rather than older.
  execFileSync('sleep', ['1.1']);
  fs.appendFileSync(path.join(f.repo, 'plans', '2026-01-01-b.md'),
    '\n<!-- bookkeeping: a PR annotation, exactly the edit that made 3 of 3 look stale -->\n');
  git(f.repo, 'add', '-A');
  git(f.repo, '-c', 'user.email=t@e.invalid', '-c', 'user.name=T', '-c', 'commit.gpgsign=false',
    'commit', '-qm', 'plan bookkeeping');
  git(f.repo, 'push', '-q', 'origin', 'main');
  const planSha = git(f.repo, 'rev-parse', 'HEAD').trim();

  const out = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  // NEVER REFUSES. The slice is handed over, exactly as with a fresh brief.
  assert.match(out, /handed over feature\/needs/,
    `staleness must not block the hand-over:\n${out}`);
  assert.match(out, /summary: .*dispatched=1/, `a stale brief is still handed over:\n${out}`);

  // AND IT IS REPORTED, naming the plan commit it compared against so the
  // reader can look at that commit rather than guess which edit moved the plan.
  assert.match(out, /older than the plan/i, `the age must be reported:\n${out}`);
  assert.match(out, /hint/i, `the report must say it is a hint, not a verdict:\n${out}`);
  assert.ok(out.includes(planSha),
    `the report must name the plan commit it compared against (${planSha}):\n${out}`);
  f.cleanup();
});

test('dispatch: a brief NEWER than its plan says nothing', () => {
  // The report is printed only when there is something to report. A note on
  // every dispatch is a note the reader learns to skip, and then it is worth
  // nothing on the day the plan really did move.
  const f = repoForBrief('fresh');
  fs.mkdirSync(path.join(f.repo, '.plot', 'briefs'), { recursive: true });
  execFileSync('sleep', ['1.1']);
  fs.writeFileSync(path.join(f.repo, '.plot', 'briefs', 'needs.md'), 'Written after the plan.\n');
  git(f.repo, 'add', '-A');
  git(f.repo, '-c', 'user.email=t@e.invalid', '-c', 'user.name=T', '-c', 'commit.gpgsign=false',
    'commit', '-qm', 'brief');
  git(f.repo, 'push', '-q', 'origin', 'main');

  const out = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });
  assert.doesNotMatch(out, /older than the plan/i,
    `a brief newer than its plan must draw no note:\n${out}`);
  assert.match(out, /handed over feature\/needs/, 'a fresh brief is handed over as before');
  f.cleanup();
});

test('dispatch: hands over one eligible branch each, and creates nothing', () => {
  const out = run(['--offline', 'fan']);

  assert.match(out, /handed over feature\/one/);
  assert.match(out, /handed over feature\/two/);
  // Deferred branches are never work.
  assert.doesNotMatch(out, /feature\/skipped/);

  // NO DESK AND NO CLAIM. Both of these were assertions of the old contract,
  // inverted. The desk is the agent's to create when it takes the brief
  // (`DESIGN-agent.md:65`), and a pushed claim would take the slice straight
  // back out of the queue it is being put into.
  const worktrees = git(repo, 'worktree', 'list');
  assert.doesNotMatch(worktrees, /plot-wt-feature-one/,
    'the agent creates its own desk; dispatch cuts none');
  assert.equal(git(repo, 'ls-remote', '--heads', 'origin', 'feature/one').trim(), '',
    'an unclaimed branch is what says the slice is still queued');
});

test('dispatch: is idempotent — a second run hands the same slices over again', () => {
  // A dispatcher that dies mid-fan-out must be safe to re-run. The hand-over is
  // a REPORT rather than a write — the queue derives from the plans, the refs
  // and the briefs — so running it twice says the same thing twice and changes
  // nothing either time. That is a stronger idempotence than the old one, which
  // rested on adopting a desk it had already cut.
  const before = git(repo, 'worktree', 'list').trim().split('\n').length;
  const out = run(['--offline', 'fan']);
  const after = git(repo, 'worktree', 'list').trim().split('\n').length;
  assert.equal(after, before, 'a second run creates nothing, the same as the first');
  assert.match(out, /handed over feature\/one/);
});

test('dispatch: a branch it cannot hand over is refused once, not forever', () => {
  // The loop used to re-ask `--next` after each claim (pull semantics). A branch
  // that could not be dispatched was never claimed, so `--next` kept returning
  // it and the first version spun forever printing "skipped".
  //
  // THE SHAPE OF THAT TRAP CHANGED WITH THE CLAIM. Dispatch claims nothing now,
  // so NO branch leaves the eligible set — which is why the fan-out reads the
  // list once instead of pulling. The property this test holds is the one that
  // outlived the mechanism: a branch dispatch cannot hand over is reported
  // exactly once and the run reaches its footer.
  //
  // THE UNHANDABLE BRANCH IS NOW A BRIEFLESS ONE. That is the live refusal —
  // an occupied worktree path used to be the cheapest way to make the fan-out
  // fail, and there is no worktree to occupy.
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-blocked-'));
  const o = path.join(blocked, 'origin.git');
  const r = path.join(blocked, 'repo');
  git(blocked, 'init', '--bare', '-q', '-b', 'main', o);
  git(blocked, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-b.md'),
    '# B\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n- `feature/blocked` — one\n');
  fs.symlinkSync('../2026-01-01-b.md', path.join(r, 'plans', 'active', 'b.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const out = execFileSync('bash', [dispatch, '--offline', 'b'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  const refusals = out.split('\n').filter((l) => /not handed over/.test(l));
  assert.equal(refusals.length, 1, `must refuse once, got ${refusals.length}`);
  assert.match(out, /summary: .*skipped=1/, 'the refusal is counted once');
  assert.match(out, /summary: /, 'must still reach the summary footer');

  fs.rmSync(blocked, { recursive: true, force: true });
});

// A plan in a given phase, in its own throwaway repo. Returns { repo, run }.
function repoWithPlan(statusBlock, label) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-gate-${label}-`));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-g.md'),
    `# G\n\n## Status\n\n${statusBlock}\n\n## Branches\n\n- \`feature/g\` — one\n`);
  fs.symlinkSync('../2026-01-01-g.md', path.join(r, 'plans', 'active', 'g.md'));
  // A brief, so the PHASE is what these tests measure. Without one the brief
  // gate refuses first and every phase would look alike.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'g.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');
  return { tmp: t, repo: r };
}

test('dispatch: refuses to fan out a Draft plan', () => {
  // The phase check must live in the SCRIPT, not only in the skill's prose.
  // Prose is a rule an agent can rationalise around, and calling the script
  // directly bypasses it entirely — this is the one place a user can do real
  // damage (branches and workers for an unapproved plan).
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Draft', 'draft');
  let failed = false, stderr = '';
  try {
    execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
      { encoding: 'utf8', cwd: r, timeout: 20_000 });
  } catch (e) {
    failed = true;
    stderr = String(e.stderr ?? '');
  }
  assert.ok(failed, 'must exit non-zero on a Draft plan');
  assert.match(stderr, /draft/i);
  assert.match(stderr, /plot-approve/, 'must say how to fix it, not just refuse');
  assert.equal(git(r, 'ls-remote', '--heads', 'origin', 'feature/g').trim(), '',
    'nothing may be claimed');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: fans out an Approved plan', () => {
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Approved', 'approved');
  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  assert.match(out, /handed over feature\/g/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: fails closed when the phase cannot be read', () => {
  // Unlike plot-phase-gate.sh (a PreToolUse hook, which must fail OPEN so a
  // broken gate never locks the repo), this is a command the user invoked.
  // If the phase is unreadable, starting several agents is the costly mistake
  // — so refuse. The damage is asymmetric, and so is the default.
  const { tmp, repo: r } = repoWithPlan('- **Type:** feature', 'nophase');
  let failed = false, stderr = '';
  try {
    execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
      { encoding: 'utf8', cwd: r, timeout: 20_000 });
  } catch (e) {
    failed = true;
    stderr = String(e.stderr ?? '');
  }
  assert.ok(failed, 'must refuse rather than guess');
  assert.match(stderr, /phase/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: --dry-run is also gated', () => {
  // A dry run creates nothing, but reporting "would dispatch 6 branches" for a
  // Draft plan is itself misleading — it reads as permission.
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Draft', 'dryrun');
  let failed = false;
  try {
    execFileSync('bash', [dispatch, '--offline', '--dry-run', 'g'],
      { encoding: 'utf8', cwd: r, timeout: 20_000 });
  } catch {
    failed = true;
  }
  assert.ok(failed, '--dry-run must respect the phase gate too');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: refuses a plan whose work is not on its own branches', () => {
  // Fan-out is meaningless for same-branch / other-repo / none. The message
  // must name the recorded answer, so the user learns why rather than just
  // being blocked.
  for (const [impl, expect] of [
    ['same branch', /same branch/i],
    ['other repo', /other repo/i],
    ['none', /nothing to implement/i],
  ]) {
    const { tmp, repo: r } = repoWithPlan(
      `- **Phase:** Approved\n- **Impl:** ${impl}`, `impl-${impl.replace(/\W/g, '')}`);
    let failed = false, stderr = '';
    try {
      execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
        { encoding: 'utf8', cwd: r, timeout: 20_000 });
    } catch (e) {
      failed = true;
      stderr = String(e.stderr ?? '');
    }
    assert.ok(failed, `Impl: ${impl} must be refused`);
    assert.match(stderr, expect);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dispatch: a pre-Plot-2 plan with no Impl answer still dispatches', () => {
  // Plans predating the ceremony questions never recorded an answer. Refusing
  // them would break existing repos on upgrade.
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Approved', 'noimpl');
  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  assert.match(out, /handed over feature\/g/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: refuses to run outside a git repository', () => {
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-not-repo-'));
  let failed = false;
  try {
    run(['--dry-run', 'fan'], notRepo);
  } catch (e) {
    failed = true;
    assert.match(String(e.stderr ?? ''), /not a git repository/i);
  }
  assert.ok(failed, 'must exit non-zero outside a repo');
  fs.rmSync(notRepo, { recursive: true, force: true });
});

test('dispatch: --status reports each worktree, its pid, and whether it lives', () => {
  // Detached workers are invisible without this: a user could otherwise only
  // read .plot-worker.log and the pid file by hand, and could not tell a
  // working worker from a dead one at all.
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Approved', 'status');
  desk(r, 'feature/g', path.join(path.dirname(r), 'plot-wt-feature-g'));

  const out = execFileSync('bash', [dispatch, '--status', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  assert.match(out, /feature\/g/);
  assert.match(out, /plot-wt-feature-g/);
  // Nothing was ever started here; that must read as "no worker", not as a
  // dead one — the difference matters when deciding to reap.
  assert.match(out, /no worker/i);
  assert.match(out, /summary: /);

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-g'), { recursive: true, force: true });
});

test('dispatch: --status distinguishes a live worker from a dead one', () => {
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Approved', 'alive');
  const wt = desk(r, 'feature/g', path.join(path.dirname(r), 'plot-wt-feature-g'));

  // An impossible-but-well-formed pid. Not 0: `kill -0 0` signals the caller's
  // whole process group and succeeds, so 0 reads as running.
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), '2147483646\n');
  fs.writeFileSync(path.join(wt, '.plot-worker.log'), 'started\nlast line here\n');
  const dead = execFileSync('bash', [dispatch, '--status', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  // No exit file, process gone: "ended (status unknown)". Deliberately not
  // "dead" — that reads as a crash, and a completed worker looked crashed.
  assert.match(dead, /ended|not running/i);
  assert.doesNotMatch(dead, /running \d/, 'a gone process must not read as running');
  assert.match(dead, /last line here/, 'must surface the last log line for triage');

  // Our own pid is certainly alive.
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), `${process.pid}\n`);
  const live = execFileSync('bash', [dispatch, '--status', 'g'],
    { encoding: 'utf8', cwd: r, timeout: 20_000 });
  assert.match(live, /running/i);

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

test('dispatch: --stop refuses without a branch and never kills everything', () => {
  // A --stop that could take no argument and mean "all" is one fat-finger away
  // from killing a whole fleet.
  const { tmp, repo: r } = repoWithPlan('- **Phase:** Approved', 'stop');
  let failed = false, stderr = '';
  try {
    execFileSync('bash', [dispatch, '--stop', 'g'], { encoding: 'utf8', cwd: r, timeout: 20_000 });
  } catch (e) {
    failed = true;
    stderr = String(e.stderr ?? '');
  }
  assert.ok(failed, '--stop must require an explicit branch');
  assert.match(stderr, /branch/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: branches sharing a last segment are two slices, handed over separately', () => {
  // `feature/api` and `bug/api` both end in "api". This test was written when
  // dispatch cut a desk per branch and a path built from the last segment alone
  // made the second branch adopt the first one's — `--stop bug/api` would then
  // stop the wrong worker. Dispatch cuts no desk now, so what is left to hold
  // is that the two are DIFFERENT WORK: each is offered, gated and handed over
  // on its own, and neither is silently folded into the other.
  //
  // THE PATH RULE ITSELF MOVED TO THE AGENT and is asserted where it now lives:
  // `deskreset.test.mjs` holds the desk the agent creates or resets.
  //
  // ONE BRIEF SERVES BOTH, AND THAT IS UNCHANGED AND NOT THIS BRANCH'S. Both
  // branches read `.plot/briefs/api.md` — `brief_path` has always been the
  // branch after its last `/`, and `/plot-implement` writes to the same rule.
  // It is a real collision, older than the hand-over gate and untouched by it.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-suffix-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-s.md'),
    '# S\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/api` — one\n- `bug/api` — a different thing entirely\n');
  fs.symlinkSync('../2026-01-01-s.md', path.join(r, 'plans', 'active', 's.md'));
  // ONE brief file, because `brief_path` keys on the last segment and both
  // branches end in `api`. That collision is this test's whole subject: the
  // brief they share must not make them share anything else.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'api.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const out = execFileSync('bash', [dispatch, '--offline', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });
  assert.match(out, /handed over feature\/api/);
  assert.match(out, /handed over bug\/api/, 'the second branch is its own slice');
  assert.match(out, /summary: dispatched=2/, 'two slices, counted as two');

  // AND NEITHER LEFT A DESK. The collision this test was written for is now
  // unreachable from here, because there is nothing to collide.
  assert.equal(git(r, 'worktree', 'list').trim().split('\n').length, 1,
    'dispatch cuts no desk, so no two branches can share one');

  fs.rmSync(t, { recursive: true, force: true });
});

test('dispatch: --max rejects a non-numeric value', () => {
  // Reverting this guard left the suite fully green, so nothing pinned it.
  // Without validation `--max abc` reaches arithmetic on a string.
  const { tmp: t, repo: r } = repoWithPlan('- **Phase:** Approved', 'maxguard');
  let failed = false, stderr = '';
  try {
    execFileSync('bash', [dispatch, '--offline', '--no-start', '--max', 'abc', 'g'],
      { encoding: 'utf8', cwd: r, timeout: 20_000 });
  } catch (e) {
    failed = true;
    stderr = String(e.stderr ?? '');
  }
  assert.ok(failed, '--max must reject a non-number');
  assert.match(stderr, /--max needs a number/);
  fs.rmSync(t, { recursive: true, force: true });
});

test('dispatch: --status tells a finished worker from a crashed one', () => {
  // Found by actually running a worker rather than testing with --no-start:
  // a worker that completed its job was reported as "dead", which reads as a
  // crash. `kill -0` can only distinguish running from not-running, so the
  // exit status has to be recorded when the process ends or the information
  // is gone.
  const { tmp: t, repo: r } = repoWithPlan('- **Phase:** Approved', 'exit');
  const wt = desk(r, 'feature/g', path.join(path.dirname(r), 'plot-wt-feature-g'));

  // Assert on the branch's OWN line. The summary footer contains every state
  // word ("finished=0 failed=0 …"), so a regex over the whole report matches
  // the counter rather than the verdict.
  const status = () => {
    const out = execFileSync('bash', [dispatch, '--status', 'g'],
      { encoding: 'utf8', cwd: r, timeout: 20_000 });
    return out.split('\n').find((l) => l.includes('feature/g')) ?? '';
  };

  // Finished cleanly: exit code 0 recorded, process gone.
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), '2147483646\n');
  fs.writeFileSync(path.join(wt, '.plot-worker.exit'), '0\n');
  const done = status();
  assert.match(done, /finished/i, 'a clean exit must not read as a crash');
  assert.doesNotMatch(done, /dead|crash/i);

  // Failed: non-zero exit recorded.
  fs.writeFileSync(path.join(wt, '.plot-worker.exit'), '3\n');
  assert.match(status(), /failed.*3|exit 3/i, 'a non-zero exit must say so, with the code');

  // No exit file at all — a worker from before this existed, or one killed
  // outright. Unknown is its own state; do not guess "finished".
  fs.rmSync(path.join(wt, '.plot-worker.exit'));
  const unknown = status();
  assert.doesNotMatch(unknown, /finished/i);

  // Still running.
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), `${process.pid}\n`);
  assert.match(status(), /running/i);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The `Started:` booking
// ---------------------------------------------------------------------------
//
// Dispatch starts real work, so it must record that it did — and record it
// WHERE THE BOARD LOOKS. The board reads the plan from the DEFAULT BRANCH,
// while plot-dispatch.sh finds the plan in its local working tree on whatever
// branch the dispatcher is standing on. Appending to the local file would book
// the start somewhere nobody reads, which is why every assertion below reads
// the plan back out of `origin/main` rather than off disk.
//
// Tested against a LOCAL BARE REMOTE, never a real host: a push has to
// genuinely succeed and genuinely fail for any of this to mean anything, and
// CI cannot reach a host.

/** A repo whose bare remote refuses (or accepts) pushes to main. */
function repoForBooking(label, { refuseMain = false } = {}) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-started-${label}-`));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-s.md'),
    '# S\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n'
    + '- **Approved:** 2026-01-01, alice, in-session\n\n## Branches\n\n- `feature/s` — one\n');
  fs.symlinkSync('../2026-01-01-s.md', path.join(r, 'plans', 'active', 's.md'));
  // A brief, so the BOOKING is what these tests measure rather than the brief
  // gate refusing ahead of it.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 's.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  if (refuseMain) {
    // Refuse only main. Claim pushes go to feature refs and must still pass —
    // otherwise this would test "nothing works", not "the booking failed".
    const hook = path.join(o, 'hooks', 'pre-receive');
    fs.writeFileSync(hook,
      '#!/bin/sh\nwhile read old new ref; do\n'
      + '  case "$ref" in refs/heads/main) echo "refusing main" >&2; exit 1 ;; esac\n'
      + 'done\nexit 0\n');
    fs.chmodSync(hook, 0o755);
  }
  return { tmp: t, repo: r, planOnMain: () => {
    git(r, 'fetch', '-q', 'origin', 'main');
    return git(r, 'show', 'origin/main:plans/2026-01-01-s.md');
  } };
}

test('dispatch: records Started: on the default branch, not the local tree', () => {
  // The naive implementation appends to the plan file in the working tree.
  // That commits the record to whatever branch the dispatcher stands on, and
  // the board — which reads the default branch — never sees it. This had to be
  // back-filled by hand twice on this repo on 2026-08-16.
  const { tmp: t, repo: r, planOnMain } = repoForBooking('lands');
  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });
  assert.match(out, /handed over feature\/s/);

  const onMain = planOnMain();
  assert.match(onMain, /- \*\*Started:\*\* \d{4}-\d{2}-\d{2}, .+, `feature\/s`/,
    `the record must be on the default branch, in /plot-implement's shape:\n${onMain}`);

  // It must land inside `## Status` — plot-plan-meta.sh reads the records from
  // there, so a line appended at the end of the document parses as nothing.
  const status = onMain.split(/^## /m).find((s) => s.startsWith('Status')) ?? '';
  assert.match(status, /Started:/, `Started: must be inside ## Status:\n${onMain}`);

  // And the dispatcher's own checkout must be untouched: it may hold the
  // user's uncommitted work, and switching it out to save a note would be the
  // kind of write this script otherwise refuses.
  assert.equal(git(r, 'status', '--porcelain').trim(), '');
  assert.doesNotMatch(fs.readFileSync(path.join(r, 'plans', '2026-01-01-s.md'), 'utf8'),
    /Started:/, 'the local working-tree copy must not be edited');

  // The disposable booking branch is disposable: gone locally and remotely.
  assert.doesNotMatch(git(r, 'branch', '-a'), /plot\/start-/);
  assert.equal(git(r, 'ls-remote', '--heads', 'origin', 'plot/start-s').trim(), '');

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-s'), { recursive: true, force: true });
});

test('dispatch: a failed booking leaves the hand-over standing', () => {
  // THE ASSERTION THAT MATTERS. By the time the booking runs the slice has been
  // handed over, and aborting on a note that could not be saved would leave
  // exactly the inconsistency the record exists to prevent: work in the fleet's
  // hands that the plan does not admit to.
  //
  // WHAT THE BOOKING QUALIFIES CHANGED WITH THE FAN-OUT. It used to report a
  // desk and a claim; a hand-over writes neither, so the run's own report IS
  // the state, and the test asserts that rather than a directory.
  const { tmp: t, repo: r, planOnMain } = repoForBooking('refused', { refuseMain: true });

  // Must not throw: a refused booking is not a failed dispatch.
  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });

  assert.match(out, /handed over feature\/s/, 'the hand-over must still be reported');
  assert.match(out, /summary: dispatched=1/, 'the summary must still report what it handed over');
  // --no-start suppresses WORKERS, not briefs. The brief is still owed either
  // way, so the gap is reported on a --no-start run exactly as on a full one.
  assert.match(out, /summary: .*brief=missing/,
    `a real run must report the missing brief in the SUMMARY, not per branch — a
caller reading only the last line is the case this exists for:\n${out}`);

  // And it must say so rather than failing silently.
  assert.match(out, /Started:.*(not|could not)/i,
    `the failure must be reported, not swallowed:\n${out}`);

  // No half-written record on main.
  assert.doesNotMatch(planOnMain(), /Started:/);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-s'), { recursive: true, force: true });
});

test('dispatch: --dry-run writes no branch, no commit and no push', () => {
  // This is the first write --dry-run has had to suppress that LEAVES THE
  // REPOSITORY, so it is pinned with a test rather than a comment. An earlier
  // dry-run test covers worktrees and claims; this one covers the booking.
  const { tmp: t, repo: r, planOnMain } = repoForBooking('dryrun');
  const head = git(r, 'rev-parse', 'origin/main').trim();

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });
  assert.match(out, /would dispatch feature\/s/);

  git(r, 'fetch', '-q', 'origin', 'main');
  assert.equal(git(r, 'rev-parse', 'origin/main').trim(), head,
    'the default branch must not have moved');
  assert.doesNotMatch(planOnMain(), /Started:/, 'no record may be written');
  assert.doesNotMatch(git(r, 'branch', '-a'), /plot\/start-/, 'no booking branch');
  assert.equal(git(r, 'ls-remote', '--heads', 'origin', 'plot/start-s').trim(), '',
    'nothing may be pushed');
  assert.equal(git(r, 'status', '--porcelain').trim(), '', 'no working-tree change');

  fs.rmSync(t, { recursive: true, force: true });
});

test('dispatch: re-dispatch does not re-record a branch it only re-adopted', () => {
  // Re-running a dispatch is safe by design (worktrees are adopted, claims
  // stay claimed). The record must inherit that: a second run books nothing,
  // or a plan re-dispatched three times would read as started three times and
  // the count would drift from the refs it is supposed to describe.
  const { tmp: t, repo: r, planOnMain } = repoForBooking('idempotent');
  execFileSync('bash', [dispatch, '--offline', '--no-start', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });
  const first = (planOnMain().match(/Started:/g) ?? []).length;
  assert.equal(first, 1, 'the first run records exactly one start');

  execFileSync('bash', [dispatch, '--offline', '--no-start', 's'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });
  const second = (planOnMain().match(/Started:/g) ?? []).length;
  assert.equal(second, 1, `a re-adopted branch must not be recorded again:\n${planOnMain()}`);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-s'), { recursive: true, force: true });
});

test('dispatch: a plan with no ## Status section is refused, not appended to', () => {
  // plot-plan-meta.sh reads Started: records out of `## Status`. A line placed
  // anywhere else parses as nothing — a record that exists on disk and not in
  // the data, which is worse than no record because it looks written. So a
  // malformed plan is a refusal with a reason, not a best-effort append.
  //
  // Reachable in practice: the phase gate reads the phase from front matter
  // too, so a front-matter plan passes the gate with no `## Status` heading.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-nostatus-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-n.md'),
    '---\nphase: Approved\nimpl: own branches\n---\n\n# N\n\n## Branches\n\n- `feature/n` — one\n');
  fs.symlinkSync('../2026-01-01-n.md', path.join(r, 'plans', 'active', 'n.md'));
  // A brief, so the missing `## Status` is what this measures.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'n.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'n'],
    { encoding: 'utf8', cwd: r, timeout: 30_000 });

  // The fan-out still stands — a malformed plan is not a reason to unwind work.
  assert.match(out, /handed over feature\/n/);
  assert.match(out, /Started:.*(not|could not)/i, `must report the missing record:\n${out}`);

  // And nothing may have been smuggled onto main outside `## Status`.
  git(r, 'fetch', '-q', 'origin', 'main');
  assert.doesNotMatch(git(r, 'show', 'origin/main:plans/2026-01-01-n.md'), /Started:/);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-n'), { recursive: true, force: true });
});

test('dispatch: a real worker that exits records its status', () => {
  // Every other test uses --no-start, which is exactly why the original bug
  // survived: with no worker ever run, nothing exercised the exit-recording
  // wrapper. This one starts a real process.
  //
  // Two traps this pins: a `Worker command` ending in `exit N` would kill the
  // wrapper shell before the code was written (hence the subshell), and the
  // exit-file path travels as an env var so no quoting level mangles it.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-realworker-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + '- **Worker command:** echo ran; exit 0\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-w.md'),
    '# W\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/real` — one\n');
  fs.symlinkSync('../2026-01-01-w.md', path.join(r, 'plans', 'active', 'w.md'));
  // A brief PER BRANCH, named the way `brief_path` names it — the branch's last
  // segment. The gate refuses a briefless slice, so a file matching neither
  // branch would have both refused and every count below zero.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'alpha.md'), 'spec\n');
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'beta.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const wt = path.join(path.dirname(r), 'plot-wt-feature-real');
  staff(r, 'feature/real', wt);

  // Give the detached worker a moment; it only echoes and exits.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !fs.existsSync(path.join(wt, '.plot-worker.exit'))) {
    execFileSync('sleep', ['0.2']);
  }
  assert.ok(fs.existsSync(path.join(wt, '.plot-worker.exit')),
    'the wrapper must record an exit code even when the command calls exit');
  assert.equal(fs.readFileSync(path.join(wt, '.plot-worker.exit'), 'utf8').trim(), '0');

  const line = execFileSync('bash', [dispatch, '--status', 'w'], { encoding: 'utf8', cwd: r })
    .split('\n').find((l) => l.includes('feature/real')) ?? '';
  assert.match(line, /finished/, `a clean exit must read as finished, got: ${line}`);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

test('dispatch: .plot-worker.pid records the AGENT process, not the wrapper', () => {
  // The bug this pins: `plot-dispatch.sh` recorded `$!` of the backgrounded
  // `sh -c` WRAPPER, so the panel named the dispatcher's shell rather than the
  // agent doing the work — every field read correctly off the wrong process.
  // The wrapper knows its own child; it must write the child's pid.
  //
  // HOW THE AGENT PROVES ITS OWN PID. The Worker command is
  // `sh -c 'echo $$ > sentinel; exec sleep …'`. `exec` replaces that `sh` with
  // `sleep` WITHOUT changing the pid, so the `$$` written a line earlier is
  // exactly the pid the OS gives the running agent — captured at launch, so the
  // check does not depend on the detached process surviving into the assertion
  // (under a test harness it is reaped when the dispatcher exits). The record
  // must equal that sentinel and differ from the wrapper's pid.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-agentpid-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  const sentinel = path.join(t, 'agent.pid');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + `- **Worker command:** sh -c 'echo $$ > ${sentinel}; exec sleep 20'\n`);
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-w.md'),
    '# W\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/real` — one\n');
  fs.symlinkSync('../2026-01-01-w.md', path.join(r, 'plans', 'active', 'w.md'));
  // A brief, so the worker actually launches — the gate refuses a briefless start.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'real.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const wt = path.join(path.dirname(r), 'plot-wt-feature-real');
  staff(r, 'feature/real', wt);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline
    && !(fs.existsSync(sentinel) && fs.existsSync(path.join(wt, '.plot-worker.pid')))) {
    execFileSync('sleep', ['0.1']);
  }
  assert.ok(fs.existsSync(sentinel), 'the agent command must have run and reported its own pid');
  const agentPid = fs.readFileSync(sentinel, 'utf8').trim();
  assert.match(agentPid, /^\d+$/, `agent pid must be numeric, got: ${agentPid}`);

  // The record must NAME THE AGENT — the pid the running `sleep` actually holds,
  // which is what the panel, `--status` and the scan describe. This is the bug's
  // exact shape: the record used to be the wrapper's pid, one process removed.
  const recorded = fs.readFileSync(path.join(wt, '.plot-worker.pid'), 'utf8').trim();
  assert.equal(recorded, agentPid,
    `.plot-worker.pid must name the agent (${agentPid}), not the wrapper (got ${recorded})`);

  // The wrapper's pid is kept separately — it is what writes .plot-worker.exit,
  // and that must keep working. Two pids with two names beats one with the
  // wrong meaning.
  const wrapperFile = path.join(wt, '.plot-worker.wrapper.pid');
  assert.ok(fs.existsSync(wrapperFile), 'the wrapper pid must be kept for exit detection');
  const wrapperPid = fs.readFileSync(wrapperFile, 'utf8').trim();
  assert.notEqual(recorded, wrapperPid, 'the agent pid must differ from the wrapper pid');

  // The wrapper still records the exit code when the agent ends — the
  // exit-recording the brief says must keep working. The agent is either reaped
  // with the dispatcher or still running; kill by the recorded pid to be sure,
  // then the wrapper's `wait` must return and write the code.
  try { process.kill(Number(recorded), 'SIGTERM'); } catch { /* already gone */ }
  const exitDeadline = Date.now() + 10_000;
  while (Date.now() < exitDeadline && !fs.existsSync(path.join(wt, '.plot-worker.exit'))) {
    execFileSync('sleep', ['0.2']);
  }
  assert.ok(fs.existsSync(path.join(wt, '.plot-worker.exit')),
    'the wrapper must record an exit code after the agent stops');

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

test('dispatch: .plot-worker.wrapper.pid names the agent\'s ACTUAL parent', () => {
  // The bug this pins, measured on three of three live workers 2026-08-30: the
  // file named the dispatcher's subshell rather than the wrapper.
  //
  //   wrapper.pid=7357    the agent's real ppid=7358
  //   wrapper.pid=71953   71954
  //   wrapper.pid=92947   92949
  //
  // The dispatcher wrote `echo $!` beside the spawn, and `$!` names the last job
  // THIS shell backgrounded — with an env-var prefix before `nohup`, bash forks a
  // subshell for the AND-list, so `$!` reported that subshell. The wrapper now
  // writes its own `$$`.
  //
  // THE ASSERTION IS PARENTHOOD, NOT INEQUALITY. The pre-existing test above only
  // checks the wrapper pid differs from the agent's, and the buggy value differed
  // too — it was one process further up the same chain. Only `ppid` distinguishes
  // them, so that is what this reads: the recorded pid must BE the agent's parent.
  //
  // Why it matters beyond tidiness: a process group built on a wrong wrapper
  // would signal `plot-dispatch.sh` while the wrapper and its monitors carried
  // on — which is why this lands before anything is built on the record.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wrappid-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  const sentinel = path.join(t, 'agent.pid');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    // THE AGENT REPORTS ITS OWN PARENT, at launch, into the sentinel.
    //
    // The obvious form of this test — read `ps -o ppid=` on the live agent — is
    // unreliable under the harness for the reason this repo already recorded
    // ("detached-worker pid tests need a launch-time sentinel"): the detached
    // process is not guaranteed to be alive when the assertion runs. Measured
    // here, the dispatch call itself took 21 s, because `execFileSync` waits for
    // the inherited stdout pipe to CLOSE and the wrapper's monitor children hold
    // it — by which time a `sleep 20` agent has long exited and `ps` answers
    // nothing.
    //
    // `$PPID` in the agent's own shell is the SAME fact, captured a moment
    // earlier and immune to that race: it is the pid of whatever process forked
    // this one, which is precisely the wrapper. Written before `exec`, so it
    // survives the agent being reaped.
    + `- **Worker command:** sh -c 'echo "$$ $PPID" > ${sentinel}; exec sleep 20'\n`);
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-wp.md'),
    '# WP\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/wrappid` — one\n');
  fs.symlinkSync('../2026-01-01-wp.md', path.join(r, 'plans', 'active', 'wp.md'));
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'wrappid.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const wt = path.join(path.dirname(r), 'plot-wt-feature-wrappid');
  staff(r, 'feature/wrappid', wt);

  const wrapperFile = path.join(wt, '.plot-worker.wrapper.pid');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline
    && !(fs.existsSync(sentinel) && fs.existsSync(wrapperFile))) {
    execFileSync('sleep', ['0.1']);
  }
  assert.ok(fs.existsSync(wrapperFile), 'the wrapper must record its own pid');
  const wrapperPid = fs.readFileSync(wrapperFile, 'utf8').trim();
  assert.match(wrapperPid, /^\d+$/, `wrapper pid must be numeric, got: ${wrapperPid}`);

  // The agent wrote its own pid and its own parent's pid before `exec` replaced
  // the shell, so both are launch-time facts that survive it being reaped.
  const [agentPid, ppid] = fs.readFileSync(sentinel, 'utf8').trim().split(/\s+/);
  assert.match(ppid, /^\d+$/, `the agent must report a numeric parent, got: ${ppid}`);

  // THE ASSERTION. The recorded wrapper pid must BE that parent. The buggy value
  // was the agent's grandparent — numerically close, one process removed, and
  // indistinguishable from the correct answer by any check but this one.
  assert.equal(wrapperPid, ppid,
    `.plot-worker.wrapper.pid (${wrapperPid}) must be the agent's actual parent (${ppid}), `
    + 'not an intervening subshell');

  // And it is genuinely a different process from the agent — the property the
  // sibling test above checks, kept here so this test stands alone.
  assert.notEqual(wrapperPid, agentPid, 'the wrapper is not the agent');

  try { process.kill(Number(agentPid), 'SIGTERM'); } catch { /* already gone */ }
  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The work-in-flight report
// ---------------------------------------------------------------------------
//
// Waves are a WITHIN-PLAN ordering. A correctly eligible branch can still name
// a file an agent has open on a different plan's branch, and nothing in the
// wave model represents that. Dispatch therefore reports which branches already
// hold which files — measured from LOCAL refs and worktrees, because the
// collision that blocked a dispatch on 2026-08-16 lived in an unpushed commit
// and uncommitted work is invisible to refs entirely.
//
// It REPORTS and refuses nothing: nothing on the candidate side is predicted,
// so there is no prediction worth acting on. Every assertion below exists
// because a weaker implementation passes without it.

/**
 * A repo with a two-branch plan, plus a helper to plant work in flight on a
 * branch of any name (including one from a different plan entirely).
 */
function repoWithInFlight(label) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-inflight-${label}-`));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-f.md'),
    '# F\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n'
    + '\n## Branches\n\n- `feature/candidate` — the one being dispatched\n');
  fs.symlinkSync('../2026-01-01-f.md', path.join(r, 'plans', 'active', 'f.md'));
  // The candidate's brief. The gate refuses a briefless slice, and these tests
  // are about the in-flight REPORT — a refusal here would answer a different
  // question than the one they ask.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'candidate.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const worktrees = [];

  /** A branch with a worktree, holding `files` in a COMMIT that is never pushed. */
  function committedWork(branch, files) {
    const wt = path.join(path.dirname(r), `plot-wt-${branch.replace(/\//g, '-')}`);
    git(r, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
    git(wt, 'config', 'user.email', 'test@example.invalid');
    git(wt, 'config', 'user.name', 'Plot Test');
    git(wt, 'config', 'commit.gpgsign', 'false');
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true });
      fs.writeFileSync(path.join(wt, f), body);
    }
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', `work on ${branch}`);
    worktrees.push(wt);
    return wt;
  }

  /** A branch with a worktree holding `files` UNCOMMITTED — no ref carries these. */
  function uncommittedWork(branch, files) {
    const wt = path.join(path.dirname(r), `plot-wt-${branch.replace(/\//g, '-')}`);
    git(r, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true });
      fs.writeFileSync(path.join(wt, f), body);
    }
    worktrees.push(wt);
    return wt;
  }

  /**
   * A branch holding `files` in a commit, with NO WORKTREE anywhere.
   *
   * For the candidate's own branch specifically. `committedWork` gives a branch
   * a worktree, and a worktree holding unlanded work is what the held-branch
   * gate refuses — so using it on the CANDIDATE makes the candidate un-offerable
   * and the report is never reached. The property under test (a branch is not
   * reported as blocking itself) is about `committed_files`, which reads refs
   * and needs no worktree at all.
   */
  function committedWorkNoWorktree(branch, files) {
    const tmpwt = path.join(t, `mk-${branch.replace(/\//g, '-')}`);
    git(r, 'worktree', 'add', '-q', '-b', branch, tmpwt, 'origin/main');
    git(tmpwt, 'config', 'user.email', 'test@example.invalid');
    git(tmpwt, 'config', 'user.name', 'Plot Test');
    git(tmpwt, 'config', 'commit.gpgsign', 'false');
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(tmpwt, f)), { recursive: true });
      fs.writeFileSync(path.join(tmpwt, f), body);
    }
    git(tmpwt, 'add', '-A');
    git(tmpwt, 'commit', '-qm', `work on ${branch}`);
    // The commit stays on the branch; the desk goes away. `git worktree remove`
    // rather than rm, so git's own registry forgets it too — a registered
    // worktree whose directory is missing is a different state.
    git(r, 'worktree', 'remove', '--force', tmpwt);
    return tmpwt;
  }

  /** A branch claimed but holding nothing: an EMPTY commit, like a real claim. */
  function bareClaim(branch) {
    const wt = path.join(path.dirname(r), `plot-wt-${branch.replace(/\//g, '-')}`);
    git(r, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
    git(wt, 'config', 'user.email', 'test@example.invalid');
    git(wt, 'config', 'user.name', 'Plot Test');
    git(wt, 'config', 'commit.gpgsign', 'false');
    git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
    worktrees.push(wt);
    return wt;
  }

  function cleanup() {
    for (const wt of worktrees) fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-candidate'),
      { recursive: true, force: true });
    fs.rmSync(t, { recursive: true, force: true });
  }

  return { tmp: t, repo: r, committedWork, uncommittedWork, committedWorkNoWorktree,
    bareClaim, cleanup };
}

test('dispatch: reports files held in an UNPUSHED commit', () => {
  // THE EXACT CASE FROM 2026-08-16: committed, clean worktree, the remote ref
  // holding only the claim. An implementation reading `origin/*` reports
  // nothing here and passes every looser test in this file.
  const f = repoWithInFlight('unpushed');
  f.committedWork('bug/other-plan', { 'App.tsx': 'x\n', 'AgentList.tsx': 'y\n' });

  // Prove the premise: the work exists on no remote ref.
  assert.equal(git(f.repo, 'ls-remote', '--heads', 'origin', 'bug/other-plan').trim(), '',
    'the fixture must keep the work unpushed, or this tests nothing');

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /in flight: bug\/other-plan holds/,
    `unpushed work must be reported:\n${out}`);
  assert.match(out, /App\.tsx/, `the held file must be named:\n${out}`);
  assert.match(out, /AgentList\.tsx/, `every held file must be named:\n${out}`);
  f.cleanup();
});

test('dispatch: reports files held UNCOMMITTED in a worktree', () => {
  // No ref holds these at all, so this fails against any implementation built
  // on refs alone — including one that correctly reads LOCAL refs.
  const f = repoWithInFlight('uncommitted');
  f.uncommittedWork('bug/editing-now', { 'Sidebar.tsx': 'in progress\n' });

  // Prove the premise: the branch carries no commit of its own.
  assert.equal(
    git(f.repo, 'rev-list', '--count', 'origin/main..bug/editing-now').trim(), '0',
    'the fixture must keep the work uncommitted, or this tests nothing');

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /in flight: bug\/editing-now holds/,
    `uncommitted work must be reported:\n${out}`);
  assert.match(out, /Sidebar\.tsx/, `the held file must be named:\n${out}`);
  f.cleanup();
});

test('dispatch: reports nothing when nothing is in flight', () => {
  // A report that always prints something teaches the reader to skip it, and
  // then it is worth nothing on the day it matters.
  //
  // The fixture carries a branch that EXISTS and holds nothing — a bare claim,
  // which is an empty commit. Without it the loop has no branch to reach the
  // empty-files check at all and this passes for the wrong reason: an
  // implementation printing "holds (nothing)" for every claimed branch would
  // still go green, and that is the exact noise being guarded against.
  const f = repoWithInFlight('quiet');
  f.bareClaim('bug/just-claimed');

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /would dispatch feature\/candidate/, 'the candidate is still listed');
  assert.doesNotMatch(out, /in flight/,
    `nothing is held, so nothing may be reported:\n${out}`);
  assert.doesNotMatch(out, /just-claimed/,
    `an empty claim holds no files and must stay silent:\n${out}`);
  f.cleanup();
});

test('dispatch: still starts everything — the report refuses nothing', () => {
  // An earlier draft of this plan had dispatch SKIP a colliding candidate.
  // That only makes sense with a prediction worth trusting, and there is none:
  // a skip built on this measurement alone would block the pairs that ran fine.
  const f = repoWithInFlight('refusenothing');
  f.committedWork('bug/other-plan', { 'App.tsx': 'x\n' });

  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /in flight: bug\/other-plan holds/, 'it must still report');
  assert.match(out, /^handed over feature\/candidate/m,
    `and it must still hand the slice over:\n${out}`);
  assert.match(out, /summary: dispatched=1/, 'the summary must count the hand-over');
  assert.doesNotMatch(out, /skipped feature\/candidate/, 'nothing may be refused');
  f.cleanup();
});

test('dispatch: consults no candidate-side prediction', () => {
  // The two rejected drafts — a `merge-tree` comparison against a branch that
  // does not yet exist, and a `Touches:` self-declaration in the plan — both
  // pass a loose test. This one fails against either: the report must be
  // byte-identical whether or not the plan describes the candidate's files.
  const bare = repoWithInFlight('nopredict-bare');
  bare.committedWork('bug/other-plan', { 'App.tsx': 'x\n' });
  const withoutDecl = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: bare.repo, timeout: 30_000 });

  const declared = repoWithInFlight('nopredict-declared');
  declared.committedWork('bug/other-plan', { 'App.tsx': 'x\n' });
  // Describe the candidate's files as loudly as any rejected design would have:
  // a Touches: field, a scope-guard glob, and the colliding path spelled out.
  const plan = path.join(declared.repo, 'plans', '2026-01-01-f.md');
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace(
    '- `feature/candidate` — the one being dispatched\n',
    '- `feature/candidate` — the one being dispatched\n'
    + '  - Touches: `App.tsx`, `AgentList.tsx`\n'
    + '  - Scope guard: `**`\n'));
  git(declared.repo, 'add', '-A');
  git(declared.repo, 'commit', '-qm', 'declare the candidate files');
  git(declared.repo, 'push', '-q', 'origin', 'main');
  const withDecl = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: declared.repo, timeout: 30_000 });

  // Compare only the in-flight lines: the worktree paths differ between the
  // two throwaway repos, so the full output cannot be equal by construction.
  const inFlight = (s) => s.split('\n').filter((l) => l.includes('in flight')).join('\n');
  assert.equal(inFlight(withDecl), inFlight(withoutDecl),
    `a candidate-side declaration must change nothing:\n${withDecl}\n---\n${withoutDecl}`);
  // And it must not have started predicting a collision from the declaration.
  assert.doesNotMatch(withDecl, /collid|conflict|would clash/i,
    'nothing may be predicted about the candidate');

  bare.cleanup();
  declared.cleanup();
});

test('dispatch: the generated board artifact is never reported', () => {
  // Every board branch rebuilds it, so including it would make every board
  // pair look like a collision — exactly the noise `.gitattributes -merge`
  // exists to remove. Its conflicts are settled by rebuilding, never by reading.
  const f = repoWithInFlight('artifact');
  f.committedWork('bug/board-work', {
    'skills/plot/scripts/board/board-server.mjs': 'generated\n',
    'packages/board/src/App.tsx': 'source\n',
  });

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /in flight: bug\/board-work holds/, 'the real source is still reported');
  assert.match(out, /packages\/board\/src\/App\.tsx/);
  assert.doesNotMatch(out, /board-server\.mjs/,
    `the generated bundle must be excluded:\n${out}`);
  f.cleanup();
});

test('dispatch: a rebased branch reports only its own files', () => {
  // Diffing against origin/main instead of the branch's OWN merge-base
  // attributes every commit the branch picked up from main to the branch
  // itself. On a busy day that is the whole repo, and the report is noise on
  // its first use. Here: main moves after the branch was cut.
  const f = repoWithInFlight('rebased');
  f.committedWork('bug/older-branch', { 'Mine.tsx': 'mine\n' });

  // main gains a file the branch never touched.
  fs.writeFileSync(path.join(f.repo, 'SomeoneElse.tsx'), 'theirs\n');
  git(f.repo, 'add', '-A');
  git(f.repo, 'commit', '-qm', 'unrelated work on main');
  git(f.repo, 'push', '-q', 'origin', 'main');

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /Mine\.tsx/, `the branch's own file must be reported:\n${out}`);
  assert.doesNotMatch(out, /SomeoneElse\.tsx/,
    `a file that only moved on main is not this branch's work:\n${out}`);
  f.cleanup();
});

test('dispatch: the candidate is never reported as blocking itself', () => {
  // A candidate can already have a local branch holding work — an earlier
  // session that prepared it, or a worktree adopted rather than created. A
  // report that did not exclude the candidate would name it as work in flight
  // against its own dispatch, which reads as a collision with itself.
  //
  // The branch is prepared LOCALLY and never claimed on the remote: a claimed
  // branch is not eligible, so `--next` would return nothing, the loop would
  // never run, and the assertion would pass without the report being reached.
  const f = repoWithInFlight('selfexclude');
  // NO WORKTREE for the candidate. The held-branch gate refuses a candidate
  // whose worktree holds unlanded work, which would make it un-offerable and
  // the report unreachable — a different property, tested separately. What is
  // under test here is `committed_files`, which reads refs and wants no desk.
  f.committedWorkNoWorktree('feature/candidate', { 'Own.tsx': 'my own work\n' });
  assert.equal(git(f.repo, 'ls-remote', '--heads', 'origin', 'feature/candidate').trim(), '',
    'the candidate must stay unclaimed, or dispatch never reaches the report');

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });
  assert.match(out, /would dispatch feature\/candidate/,
    `the candidate must still be offered, or this tests nothing:\n${out}`);
  assert.doesNotMatch(out, /in flight: feature\/candidate/,
    `a branch must not block its own dispatch:\n${out}`);
  assert.doesNotMatch(out, /Own\.tsx/,
    `the candidate's own files are not work in flight against it:\n${out}`);
  f.cleanup();
});

test('dispatch: the real run reports too, not only --dry-run', () => {
  // The dry run is where an operator looks first, but the real run is where
  // the decision is actually taken — and where a fan-out of several branches
  // makes the report worth the most.
  const f = repoWithInFlight('realrun');
  f.committedWork('bug/other-plan', { 'App.tsx': 'x\n' });

  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });
  const lines = out.split('\n');
  const at = lines.findIndex((l) => l.startsWith('handed over feature/candidate'));
  assert.ok(at >= 0, `must have handed the slice over:\n${out}`);
  assert.match(lines[at + 1] ?? '', /in flight: bug\/other-plan holds App\.tsx/,
    `the report belongs directly under the branch it qualifies:\n${out}`);
  f.cleanup();
});

test('dispatch: the report is bounded, and says what it left out', () => {
  // Found by running this against the real repo rather than a fixture: the
  // first version printed 13 branches under ONE candidate, one of them naming
  // 18 paths. That is the same "ignored by the third time" failure the design
  // warns about, arriving as volume instead of as false positives.
  //
  // Both caps are plain truncation with the remainder COUNTED — never a
  // judgment about which branch or file matters. Nothing here can know that,
  // and pretending to would be the candidate-side prediction this refuses.
  const f = repoWithInFlight('bounded');
  // The wide branch is named so it sorts FIRST and therefore survives the
  // branch cap. Named last it lands at position 11, gets truncated away, and
  // the file-cap assertions below silently test nothing — which is how the
  // first version of this test failed.
  const wide = {};
  for (let i = 0; i < 9; i++) wide[`Wide${i}.tsx`] = 'x\n';
  f.committedWork('bug/aaa-wide', wide);
  // Ten more, so the branch cap (8) is exceeded.
  for (let i = 0; i < 10; i++) {
    f.committedWork(`bug/many-${i}`, { [`File${i}.tsx`]: 'x\n' });
  }

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 60_000 });
  const lines = out.split('\n').filter((l) => l.includes('in flight'));

  // The branch cap: 8 branch lines plus one line saying how many were omitted.
  const omitted = lines.filter((l) => /more branches/.test(l));
  assert.equal(omitted.length, 1, `exactly one overflow line:\n${out}`);
  assert.equal(lines.length - omitted.length, 8,
    `at most 8 branches may be listed:\n${out}`);
  assert.match(omitted[0], /and 3 more branches/,
    `the omitted COUNT must be exact — 11 branches, 8 shown:\n${omitted[0]}`);
  assert.match(omitted[0], /plot-fleet/,
    'it must say where the full picture lives, not just that it truncated');

  // The file cap, on the branch that exceeds it.
  const wideLine = lines.find((l) => l.includes('bug/aaa-wide')) ?? '';
  assert.notEqual(wideLine, '',
    `the wide branch must survive the branch cap, or the file cap is untested:\n${out}`);
  assert.match(wideLine, /\(\+3 more\)/,
    `9 files, 6 shown, so exactly 3 must be counted:\n${wideLine}`);
  assert.equal((wideLine.match(/Wide\d\.tsx/g) ?? []).length, 6,
    `exactly 6 paths may be named:\n${wideLine}`);

  f.cleanup();
});

test('dispatch: a report under both caps is never truncated', () => {
  // The caps must not fire on ordinary state — the common case is a handful of
  // branches, and an overflow line there would be noise about nothing.
  const f = repoWithInFlight('unbounded');
  f.committedWork('bug/small', { 'A.tsx': 'x\n', 'B.tsx': 'y\n' });

  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'f'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });
  assert.match(out, /in flight: bug\/small holds A\.tsx, B\.tsx$/m,
    `a short list must be printed whole, with no suffix:\n${out}`);
  assert.doesNotMatch(out, /more branches|\(\+\d+ more\)/,
    `nothing may be truncated here:\n${out}`);
  f.cleanup();
});

// ---------------------------------------------------------------------------
// The summary states WHY nothing started
// ---------------------------------------------------------------------------
//
// `started=0` has always been in the footer. What was missing is the reason
// beside it: the "no 'Worker command' configured" message lived in PER-BRANCH
// output, after the fan-out had already happened, and on 2026-08-17 it was
// printed and missed five times — worktrees sat claimed with nobody working on
// them while the last line a caller read said `started=0` with no explanation.
//
// A caller reading only the summary is the case this exists for. Every
// assertion below therefore checks the SUMMARY BLOCK specifically: a per-branch
// message passes any test that greps the whole output, which is exactly how the
// defect survived.

/** A repo with a one-branch approved plan and whatever Plot Config you pass. */
function repoWithConfig(label, extraConfig = '') {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-worker-${label}-`));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + extraConfig);
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-w.md'),
    '# W\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n'
    + '\n## Branches\n\n- `feature/alpha` — one\n- `feature/beta` — two\n');
  fs.symlinkSync('../2026-01-01-w.md', path.join(r, 'plans', 'active', 'w.md'));
  // A brief PER BRANCH, named the way `brief_path` names it — the branch's
  // last segment. A file matching neither branch would have both refused,
  // and every count below would read zero for the wrong reason.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'alpha.md'), 'spec\n');
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'beta.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const cleanup = () => {
    for (const b of ['feature-alpha', 'feature-beta']) {
      fs.rmSync(path.join(path.dirname(r), `plot-wt-${b}`), { recursive: true, force: true });
    }
    fs.rmSync(t, { recursive: true, force: true });
  };
  return { tmp: t, repo: r, cleanup };
}

/**
 * The summary block: the footer line and any prose line immediately above it.
 *
 * The window is kept at two lines although the fan-out no longer prints a prose
 * line, because that is exactly what the tests below assert — a block that
 * could show one, shown not to.
 */
function summaryBlock(out) {
  const lines = out.split('\n');
  const i = lines.findIndex((l) => l.startsWith('summary:'));
  assert.ok(i >= 0, `no summary footer in:\n${out}`);
  return lines.slice(Math.max(0, i - 1), i + 1).join('\n');
}

test('dispatch: a structural zero is carried as a field, never explained', () => {
  // THE PROSE LINE WENT WHEN ITS SUBJECT DID. It explained a zero that had a
  // cause worth naming: desks prepared, no `Worker command`, so nobody was sat
  // at them. Dispatch starts no worker at all now, so `started=0` is structural
  // — the line would print on every run, always true and never informative.
  //
  // `--dry-run` was held to this rule from the start (see the sibling below);
  // the fan-out has become the same case, so it is held to it too.
  const f = repoWithConfig('unconfigured');
  const out = execFileSync('bash', [dispatch, '--offline', 'w'],
    { encoding: 'utf8', cwd: f.repo, timeout: 60_000 });

  const block = summaryBlock(out);
  assert.doesNotMatch(block, /workers started/,
    `a zero nothing could have changed explains nothing:\n${out}`);

  // THE FIELD STILL TRAVELS. How this repo is configured stays a fact about the
  // repo, even where it no longer explains a count.
  assert.match(block, /summary: .*started=0 .*worker=unconfigured/,
    `the machine field must carry it:\n${out}`);
  assert.match(block, /summary: .*dispatched=2/,
    `both slices must be handed over:\n${out}`);
  f.cleanup();
});

test('dispatch: a configured Worker command never claims the config is missing', () => {
  // The regression that matters: a summary line that always fires would be the
  // same one-label-two-states defect in the other direction.
  const f = repoWithConfig('configured', '- **Worker command:** true\n');
  const out = execFileSync('bash', [dispatch, '--offline', 'w'],
    { encoding: 'utf8', cwd: f.repo, timeout: 60_000 });

  assert.match(out, /summary: .*worker=configured/, `expected worker=configured:\n${out}`);
  assert.doesNotMatch(out, /no `Worker command` configured/,
    `a configured repo must never be told its config is missing:\n${out}`);
  f.cleanup();
});

test('dispatch: `Worker command: none` is an ANSWER, not a missing key', () => {
  // Empty is a first-class answer, and recording it is what stops the skill
  // asking at every fan-out. `none` must therefore read differently from an
  // absent key — otherwise nothing downstream can tell "asked and declined"
  // from "never asked", which is the whole point of writing it down.
  const f = repoWithConfig('declined', '- **Worker command:** none\n');
  const out = execFileSync('bash', [dispatch, '--offline', 'w'],
    { encoding: 'utf8', cwd: f.repo, timeout: 60_000 });

  assert.match(out, /summary: .*worker=declined/, `expected worker=declined:\n${out}`);
  assert.doesNotMatch(out, /no `Worker command` configured/,
    `a repo that answered must not be nagged as unconfigured:\n${out}`);

  // And `none` must never be RUN. A worker per branch failing with
  // "none: command not found" would turn a deliberate answer into N crashes.
  for (const b of ['feature-alpha', 'feature-beta']) {
    const wt = path.join(path.dirname(f.repo), `plot-wt-${b}`);
    assert.ok(!fs.existsSync(path.join(wt, '.plot-worker.pid')),
      `no worker may be started for '${b}' when the answer was none`);
  }
  f.cleanup();
});

test('dispatch: --no-start stays its own state, never a missing config', () => {
  // --no-start must keep meaning exactly what it says and must not imply
  // anything new. It is the inspect-first workflow, used deliberately every
  // time on 2026-08-17; reporting its zero as a configuration gap would read
  // as a defect and push a user off the workflow they chose.
  //
  // WHAT IT SUPPRESSES MOVED WITH THE FAN-OUT. It used to prepare desks and
  // withhold the workers; dispatch prepares nothing and starts nothing, so the
  // flag now withholds the hand-over itself. The state word is unchanged, and
  // that is the point — `suppressed` still says a person chose this.
  const f = repoWithConfig('nostart');
  const out = execFileSync('bash', [dispatch, '--offline', '--no-start', 'w'],
    { encoding: 'utf8', cwd: f.repo, timeout: 60_000 });

  const block = summaryBlock(out);
  assert.match(block, /summary: .*started=0 .*worker=suppressed/,
    `--no-start is its own state:\n${out}`);
  assert.doesNotMatch(block, /no `Worker command` configured/,
    `--no-start must not be reported as a config gap:\n${out}`);
  f.cleanup();
});

test('dispatch: --dry-run does not explain a zero it could never have been', () => {
  // A dry run starts nothing BY CONSTRUCTION, so "no workers started" here is
  // true and carries no information — and a line that always prints teaches the
  // reader to skip it on the run where it matters. Only the machine field
  // travels.
  const f = repoWithConfig('dryrun');
  const out = execFileSync('bash', [dispatch, '--offline', '--dry-run', 'w'],
    { encoding: 'utf8', cwd: f.repo, timeout: 30_000 });

  assert.match(out, /summary: .*worker=unconfigured/, `the field still travels:\n${out}`);
  assert.doesNotMatch(out, /workers started/,
    `a dry run prepares nothing, so it explains nothing:\n${out}`);
  f.cleanup();
});

test('dispatch: the summary footer stays machine-countable', () => {
  // Every consumer in this repo reads the footer, never the prose. The reason
  // is therefore carried as a `key=value` field like every other, and the
  // footer must remain the LAST line — the prose sits above it, the way the
  // failed-booking note already does.
  const f = repoWithConfig('footer');
  const out = execFileSync('bash', [dispatch, '--offline', 'w'],
    { encoding: 'utf8', cwd: f.repo, timeout: 60_000 });

  const lines = out.split('\n').filter((l) => l !== '');
  const last = lines[lines.length - 1];
  assert.match(last, /^summary: (\w+=\S+ ?)+$/,
    `the footer must be last and pure key=value:\n${out}`);
  f.cleanup();
});

// ---------------------------------------------------------------------------
// The question is the SKILL's, never the script's
// ---------------------------------------------------------------------------

test('dispatch: the script asks no interactive question', () => {
  // A bash script cannot put a question to a human inside an agent session, and
  // the plan's own first draft proposed exactly that. The prompt belongs in
  // skills/plot-dispatch/SKILL.md, where interpretation is allowed.
  const src = fs.readFileSync(path.join(here, '..', '..', 'skills', 'plot',
    'scripts', 'plot-dispatch.sh'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /\bread\s+-p\b|\bAskUserQuestion\b|\bask_question\b/,
    'plot-dispatch.sh must not prompt — the skill asks');
});

test('plot-dispatch skill: asks at the first dispatch, and suggests nothing', () => {
  const skill = fs.readFileSync(path.join(here, '..', '..', 'skills',
    'plot-dispatch', 'SKILL.md'), 'utf8');

  // It asks, and it asks HERE.
  assert.match(skill, /How does this project run an agent headless\?/,
    'the skill must carry the question');
  assert.match(skill, /Never ask this at `\/plot-init`/,
    'the skill must say where the question does NOT belong');

  // It asks rather than suggests. An example becomes a template, and then Plot
  // has hardcoded agent tooling it is not supposed to know (Principle 5). The
  // prompt block is checked rather than the whole file: the Configuration
  // section legitimately documents the format for someone who came looking.
  const prompt = skill.slice(
    skill.indexOf('How does this project run an agent headless?') - 400,
    skill.indexOf('How does this project run an agent headless?') + 200);
  assert.doesNotMatch(prompt, /claude |codex |aider |cursor |-p "/i,
    `no example command may appear in the prompt:\n${prompt}`);

  // Empty is first-class, and recorded so it is not re-asked.
  assert.match(skill, /\*\*Worker command:\*\* none/,
    'an empty answer must be recorded as `none`');
});

test('plot-init: never raises the worker question', () => {
  // At adoption the question meets a need the answerer does not have. It gets a
  // shrug, the key is written empty, and nobody revisits it — an
  // answered-and-wrong config is harder to fix than a missing one, because
  // nothing later notices it was never really decided.
  const init = fs.readFileSync(path.join(here, '..', '..', 'skills',
    'plot-init', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(init, /Worker command/,
    'adoption must not ask how this project runs an agent headless');
});

// --- The phase gate reads what was SHARED, not the working tree -------------
//
// Both directions were reproduced in a sandbox 2026-08-18. The working tree is
// the least trustworthy surface in a repo with several agents in it: it carries
// whatever branch was last checked out plus whatever is uncommitted, and
// neither is a fact anyone else shares.

// A repo whose plan is `sharedPhase` on origin/main. `localPhase`, when given,
// is committed to a branch that is checked out and never pushed — the
// local-only edit the gate must ignore. `noRemote` drops the remote entirely.
function repoWithSharedPlan({ sharedPhase, localPhase = null, label, noRemote = false }) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-shared-${label}-`));
  const r = path.join(t, 'repo');
  const plan = (phase) =>
    `# G\n\n## Status\n\n- **Phase:** ${phase}\n- **Type:** feature\n- **Impl:** own branches\n\n## Branches\n\n- \`feature/g\` — one\n`;

  if (noRemote) {
    fs.mkdirSync(r, { recursive: true });
    git(r, 'init', '-q', '-b', 'main', '.');
  } else {
    const o = path.join(t, 'origin.git');
    git(t, 'init', '--bare', '-q', '-b', 'main', o);
    git(t, 'clone', '-q', o, r);
  }
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-g.md'), plan(sharedPhase));
  fs.symlinkSync('../2026-01-01-g.md', path.join(r, 'plans', 'active', 'g.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  if (!noRemote) git(r, 'push', '-q', 'origin', 'main');

  // The local-only divergence: committed on another branch, never pushed.
  if (localPhase) {
    git(r, 'checkout', '-q', '-b', 'other-agent-branch');
    fs.writeFileSync(path.join(r, 'plans', '2026-01-01-g.md'), plan(localPhase));
    git(r, 'commit', '-qam', 'local-only phase change');
  }
  return { tmp: t, repo: r };
}

// stderr is captured on BOTH paths: --allow-local announces itself on stderr
// while exiting 0, so a helper that only kept stderr from the failure path
// could not tell an announced escape from a silent one.
function tryRun(args, cwd) {
  const r = spawnSync('bash', [dispatch, ...args], { encoding: 'utf8', cwd });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

test('dispatch: a local-only approval is refused', () => {
  // The serious direction. Draft on origin/main, Approved only on a local
  // branch that was never pushed. Manifesto P2 is "plans are approved before
  // implementation" — a gate that accepts an approval nobody else can see
  // enforces "someone typed Approved in this filesystem", and agents fan out
  // on work nothing reviewed.
  const { tmp, repo: r } = repoWithSharedPlan({
    sharedPhase: 'Draft', localPhase: 'Approved', label: 'localonly',
  });
  const got = tryRun(['--dry-run', '--offline', 'g'], r);
  assert.notEqual(got.code, 0, 'an unpushed approval must not open the gate');
  assert.match(got.err, /still Draft/);
  // The refusal names the ref it read — "still Draft" alone once sent an
  // operator looking at a file that already said Approved.
  assert.match(got.err, /origin\/main/);
  assert.equal(git(r, 'ls-remote', '--heads', 'origin', 'feature/g').trim(), '',
    'nothing may be claimed for an unapproved plan');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: a shared approval is not hidden by a parked checkout', () => {
  // The mirror direction: Approved on origin/main, the checkout parked on
  // another branch carrying an older Draft copy — how a concurrent agent's
  // `git checkout` blocked two correctly-approved plans in one session.
  const { tmp, repo: r } = repoWithSharedPlan({
    sharedPhase: 'Approved', localPhase: 'Draft', label: 'parked',
  });
  assert.equal(git(r, 'branch', '--show-current').trim(), 'other-agent-branch');
  const got = tryRun(['--dry-run', '--offline', 'g'], r);
  assert.equal(got.code, 0, `a shared approval must dispatch:\n${got.err ?? ''}`);
  assert.match(got.out, /feature\/g/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: refuses when origin/<main> cannot be resolved, and names the escape', () => {
  // FAIL CLOSED, unlike plot-phase-gate.sh. The divergence is deliberate and
  // the reason is blast radius: dispatch refusing costs one fan-out you retry;
  // the hook refusing costs every commit in the repository. There is no
  // fallback to the working tree — that would reintroduce the bug exactly
  // where nothing can catch it.
  const { tmp, repo: r } = repoWithSharedPlan({
    sharedPhase: 'Approved', label: 'noremote', noRemote: true,
  });
  const got = tryRun(['--dry-run', '--offline', 'g'], r);
  assert.notEqual(got.code, 0, 'an unresolvable ref must not fall back to the working tree');
  assert.match(got.err, /cannot resolve 'origin\/main'/);
  // The escape is named at the moment the operator needs it.
  assert.match(got.err, /--allow-local/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch: --allow-local is the explicit escape, and says it took it', () => {
  const { tmp, repo: r } = repoWithSharedPlan({
    sharedPhase: 'Approved', label: 'allowlocal', noRemote: true,
  });
  const got = tryRun(['--dry-run', '--offline', '--allow-local', 'g'], r);
  assert.equal(got.code, 0, `--allow-local must dispatch:\n${got.err ?? ''}`);
  assert.match(got.out, /feature\/g/);
  // Never silent: an operator must be able to tell the gate read the working tree.
  assert.match(got.err ?? '', /--allow-local/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// THE HELD-BRANCH GATE
// ---------------------------------------------------------------------------
//
// THE MEASUREMENT these tests encode: on 2026-08-20 `--dry-run` reported
// `claimed=0` across a fleet with four live agents and offered two branches
// that were already implemented, tested and green — in worktrees beside the
// repo, one local commit each, never pushed — as dispatchable.
//
// `plot-fleet-scan.sh` derives every state from `origin/<branch>`, so a branch
// with no remote ref has no claim, and no claim reads `eligible`. The scan is
// right about what it reads. The worktree is on the other side of the machine,
// and plot-dispatch.sh was already enumerating worktrees for its collision
// report — it could see what a branch TOUCHED and not that someone HELD it.
//
// The fixture below therefore plants work the way the failure arrived: a
// worktree with a LOCAL commit and NO REMOTE REF. An implementation reading
// `origin/*` — which is the obvious one, and the one the scan uses — sees an
// unclaimed branch here and passes nothing in this block.

/**
 * A repo with a one-branch plan whose branch can be given a worktree in any of
 * the three states that matter: unmerged work, merged work, or none at all.
 */
function repoWithHeldBranch(label) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `plot-held-${label}-`));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-h.md'),
    '# H\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n'
    + '\n## Branches\n\n- `feature/held` — the one under test\n');
  fs.symlinkSync('../2026-01-01-h.md', path.join(r, 'plans', 'active', 'h.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const wt = path.join(path.dirname(r), 'plot-wt-feature-held');
  const worktrees = [];

  function configure(w) {
    git(w, 'config', 'user.email', 'test@example.invalid');
    git(w, 'config', 'user.name', 'Plot Test');
    git(w, 'config', 'commit.gpgsign', 'false');
  }

  /**
   * A worktree holding a commit that is NOT in main and NOT pushed — the exact
   * shape of the measured failure.
   */
  function heldWithWork() {
    git(r, 'worktree', 'add', '-q', '-b', 'feature/held', wt, 'origin/main');
    configure(wt);
    fs.writeFileSync(path.join(wt, 'work.txt'), 'implemented and green\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', 'the work an agent already did');
    worktrees.push(wt);
    return wt;
  }

  /**
   * A LEFTOVER worktree: its work landed in main and the directory was never
   * removed. Several of these existed on the machine that measured the bug, so
   * a gate that fires here fires on exactly the branches that are safe.
   */
  function heldButMerged() {
    git(r, 'worktree', 'add', '-q', '-b', 'feature/held', wt, 'origin/main');
    configure(wt);
    fs.writeFileSync(path.join(wt, 'landed.txt'), 'this already merged\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', 'work that landed');
    // Land it: main now contains the branch tip, so the tip is an ancestor.
    git(wt, 'push', '-q', 'origin', 'HEAD:main');
    git(r, 'fetch', '-q', 'origin');
    worktrees.push(wt);
    return wt;
  }

  /**
   * A worktree cut minutes ago with NO COMMIT YET, holding modified files.
   *
   * The shape that got past the first version of this gate. Measured on the
   * plot repo: `plot-wt-a-branch-row-carries-its-link` held six modified files
   * for a live agent and carried no commit, so its branch pointed at whatever
   * main was when the worktree was cut — `ahead=0, behind=N`, which
   * `--is-ancestor` reads as "already landed", identically to a merged
   * leftover. No walk of the history separates the two; only the files do.
   */
  function heldUncommitted() {
    git(r, 'worktree', 'add', '-q', '-b', 'feature/held', wt, 'origin/main');
    configure(wt);
    // Main moves on AFTER the worktree is cut, which is what puts the branch
    // behind rather than level — exactly the live-agent shape.
    fs.writeFileSync(path.join(r, 'moved-on.txt'), 'main advanced\n');
    git(r, 'add', '-A');
    git(r, 'commit', '-qm', 'main moves on');
    git(r, 'push', '-q', 'origin', 'main');
    git(r, 'fetch', '-q', 'origin');
    // The agent is mid-edit: files changed, nothing committed.
    fs.writeFileSync(path.join(wt, 'in-progress.txt'), 'being edited right now\n');
    worktrees.push(wt);
    return wt;
  }

  function cleanup() {
    for (const w of worktrees) fs.rmSync(w, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(t, { recursive: true, force: true });
  }

  return { tmp: t, repo: r, wt, heldWithWork, heldButMerged, heldUncommitted, cleanup };
}

test('dispatch: refuses a branch whose worktree holds unmerged work', () => {
  const f = repoWithHeldBranch('refuse');
  f.heldWithWork();

  // Prove the premise, or this test passes for the wrong reason: the work is
  // on NO remote ref, so nothing claim-shaped exists for the scan to find.
  assert.equal(git(f.repo, 'ls-remote', '--heads', 'origin', 'feature/held').trim(), '',
    'the fixture must keep the work unpushed, or this tests the wrong bug');
  assert.equal(git(f.repo, 'rev-list', '--count', 'origin/main..feature/held').trim(), '1',
    'the fixture must hold one unmerged commit');

  const got = tryRun(['--offline', '--no-start', 'h'], f.repo);
  assert.equal(got.code, 0, `the gate refuses a branch, not the run:\n${got.err}`);
  assert.match(got.out, /^skipped feature\/held/m,
    `a held branch must be refused:\n${got.out}`);
  assert.doesNotMatch(got.out, /^dispatched feature\/held/m,
    `it must not be dispatched:\n${got.out}`);
  assert.match(got.out, /summary: .*skipped=1/,
    `and counted as skipped:\n${got.out}`);
  assert.match(got.out, /summary: .*dispatched=0/,
    `nothing was dispatched:\n${got.out}`);

  f.cleanup();
});

test('dispatch: the refusal names the worktree path', () => {
  // The operator's next action is to LOOK at the desk. A refusal that does not
  // say which one sends them to `git worktree list` to guess.
  const f = repoWithHeldBranch('names');
  f.heldWithWork();

  const got = tryRun(['--offline', '--no-start', 'h'], f.repo);
  assert.ok(got.out.includes(f.wt),
    `the refusal must name the worktree path (${f.wt}):\n${got.out}`);

  f.cleanup();
});

test('dispatch: the gate never claims on the operator behalf', () => {
  // A claim ref for a worktree this script did not create is a record in git
  // nobody asked for, and a stale claim is worse than an absent one — the
  // reaper cannot tell it from a real one.
  const f = repoWithHeldBranch('noclaim');
  f.heldWithWork();
  const before = git(f.repo, 'rev-parse', 'feature/held').trim();

  tryRun(['--offline', '--no-start', 'h'], f.repo);

  assert.equal(git(f.repo, 'ls-remote', '--heads', 'origin', 'feature/held').trim(), '',
    'the gate must push no claim');
  assert.equal(git(f.repo, 'rev-parse', 'feature/held').trim(), before,
    'and must add no commit to the held branch');

  f.cleanup();
});

test('dispatch: --dry-run refuses a held branch identically', () => {
  // A dry run that offers what a real run would refuse is worse than no dry
  // run: it is the same wrong answer with a reassurance attached. This is the
  // measured failure — the bug arrived through `--dry-run` output.
  const f = repoWithHeldBranch('dryrun');
  f.heldWithWork();

  const got = tryRun(['--dry-run', '--offline', 'h'], f.repo);
  assert.match(got.out, /^skipped feature\/held/m,
    `--dry-run must refuse it too:\n${got.out}`);
  assert.doesNotMatch(got.out, /would dispatch feature\/held/,
    `--dry-run must not offer a branch the real run refuses:\n${got.out}`);
  assert.ok(got.out.includes(f.wt), `and must name the worktree:\n${got.out}`);
  // The footer was hardcoded `skipped=0` before the gate existed.
  assert.match(got.out, /summary: .*skipped=1/,
    `the dry-run footer must count the refusal:\n${got.out}`);
  assert.match(got.out, /summary: .*dispatched=0/, 'and offer nothing');

  f.cleanup();
});

test('dispatch: a leftover worktree on a MERGED branch is still dispatched', () => {
  // Several of these sat on the machine that measured the bug (6 of 36
  // worktrees). Refusing them would make the gate fire on exactly the branches
  // that are safe — the fastest way to teach an operator to route around it.
  const f = repoWithHeldBranch('merged');
  f.heldButMerged();

  // Prove the premise: the tip really is in main.
  const merged = spawnSync('git',
    ['merge-base', '--is-ancestor', 'feature/held', 'origin/main'],
    { cwd: f.repo, encoding: 'utf8' });
  assert.equal(merged.status, 0, 'the fixture must land the work in main');

  const got = tryRun(['--dry-run', '--offline', 'h'], f.repo);
  assert.doesNotMatch(got.out, /^skipped feature\/held/m,
    `a merged tip is not a hold:\n${got.out}`);
  assert.match(got.out, /would dispatch feature\/held/,
    `a leftover worktree on merged work stays dispatchable:\n${got.out}`);

  f.cleanup();
});

test('dispatch: --allow-local does not override the held-branch refusal', () => {
  // That flag is the named escape for a repo whose origin/<main> cannot be
  // resolved. It says something about reading a PHASE and nothing whatever
  // about whether a human is mid-edit in a worktree.
  const f = repoWithHeldBranch('allowlocal');
  f.heldWithWork();

  const got = tryRun(['--dry-run', '--offline', '--allow-local', 'h'], f.repo);
  assert.match(got.out, /^skipped feature\/held/m,
    `--allow-local must not unlock a held branch:\n${got.out}`);
  assert.doesNotMatch(got.out, /would dispatch feature\/held/,
    `and must not offer it:\n${got.out}`);

  f.cleanup();
});

test('dispatch: a branch with no worktree is unaffected', () => {
  // The gate needs BOTH halves. A local branch on its own is not a hold —
  // plenty exist for other reasons — so without a worktree nothing changes.
  const f = repoWithHeldBranch('nowt');
  // A local branch carrying unmerged work, but NO worktree anywhere.
  git(f.repo, 'branch', 'feature/held', 'origin/main');

  const got = tryRun(['--dry-run', '--offline', 'h'], f.repo);
  assert.match(got.out, /would dispatch feature\/held/,
    `no worktree means no hold:\n${got.out}`);
  assert.match(got.out, /summary: .*skipped=0/,
    `and nothing to skip:\n${got.out}`);

  f.cleanup();
});

test('dispatch: refuses a worktree holding UNCOMMITTED work and no commit', () => {
  // THE SHAPE THAT GOT PAST THE FIRST VERSION of this gate, measured on the
  // plot repo itself: a worktree cut minutes ago for a live agent, six files
  // modified, nothing committed. Its branch points at the main tip of the
  // moment it was cut, so `--is-ancestor` answers "already landed" — the same
  // answer it gives for the merged leftover the gate must NOT refuse.
  //
  // A tip-based check passes every other test in this block and fails this one,
  // which is the whole reason it is here.
  const f = repoWithHeldBranch('uncommitted');
  f.heldUncommitted();

  // Prove the premise, both halves. The branch has no commit of its own...
  assert.equal(git(f.repo, 'rev-list', '--count', 'origin/main..feature/held').trim(), '0',
    'the fixture must carry no commit, or it tests the committed shape again');
  // ...and its tip IS an ancestor of main, so history alone calls it landed.
  const ancestor = spawnSync('git',
    ['merge-base', '--is-ancestor', 'feature/held', 'origin/main'],
    { cwd: f.repo, encoding: 'utf8' });
  assert.equal(ancestor.status, 0,
    'the fixture must be ancestor-clean, or the tip check would catch it anyway');
  // ...but the working tree is dirty, which is the only distinguishing fact.
  assert.notEqual(git(f.wt, 'status', '--porcelain').trim(), '',
    'the fixture must hold uncommitted work');

  const got = tryRun(['--dry-run', '--offline', 'h'], f.repo);
  assert.match(got.out, /^skipped feature\/held/m,
    `an agent mid-edit holds the branch:\n${got.out}`);
  assert.doesNotMatch(got.out, /would dispatch feature\/held/,
    `it must not be offered:\n${got.out}`);
  assert.ok(got.out.includes(f.wt), `and the worktree must be named:\n${got.out}`);

  f.cleanup();
});

test('dispatch: finds a worktree at a path dispatch would not have chosen', () => {
  // THE POPULATION THIS GATE EXISTS FOR is worktrees dispatch did NOT create —
  // those are the ones carrying no claim ref. And they are not named by
  // dispatch's rule. Measured on the plot repo: every hand-made worktree drops
  // the branch TYPE, so `bug/a-branch-row-carries-its-link` sat in
  // `plot-wt-a-branch-row-carries-its-link` where dispatch's own flattening
  // says `plot-wt-bug-a-branch-row-carries-its-link`.
  //
  // A first version of the gate rebuilt the path from the branch name and
  // therefore missed a worktree with six modified files in it — passing every
  // other test in this block, because every other fixture uses dispatch's
  // naming. The gate must ASK GIT which worktree holds the branch.
  const f = repoWithHeldBranch('oddpath');
  // Deliberately NOT ../plot-wt-feature-held: a name a human would pick.
  const odd = path.join(path.dirname(f.repo), 'my-checkout-of-held');
  git(f.repo, 'worktree', 'add', '-q', '-b', 'feature/held', odd, 'origin/main');
  git(odd, 'config', 'user.email', 'test@example.invalid');
  git(odd, 'config', 'user.name', 'Plot Test');
  git(odd, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(odd, 'work.txt'), 'implemented and green\n');
  git(odd, 'add', '-A');
  git(odd, 'commit', '-qm', 'work at an unconventional path');

  // Prove the premise: the path dispatch WOULD have guessed does not exist.
  assert.equal(fs.existsSync(path.join(path.dirname(f.repo), 'plot-wt-feature-held')), false,
    'the fixture must not sit at the conventional path, or it tests nothing');

  const got = tryRun(['--dry-run', '--offline', 'h'], f.repo);
  assert.match(got.out, /^skipped feature\/held/m,
    `a hold is a hold wherever the worktree lives:\n${got.out}`);
  assert.ok(got.out.includes(odd),
    `and the refusal must name the REAL path, not a guessed one:\n${got.out}`);

  fs.rmSync(odd, { recursive: true, force: true });
  f.cleanup();
});

test('dispatch: the launch writes an agent manifest keyed on a session id', () => {
  // THE MANIFEST IS THE IDENTITY THAT OUTLIVES THE WORKTREE. Everything else the
  // dispatcher writes about a worker lives INSIDE the worktree — the pid file,
  // the exit file, the log — so an agent that finishes one branch and takes
  // another loses all of it. This file sits in the repo and is keyed on the
  // session, so it survives the branch being merged away.
  //
  // Asserted from a REAL launch rather than by calling the helper, because the
  // ordering is half the contract: the manifest must exist before the worker
  // could have done anything, and only a real run proves that.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-manifest-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  // A command carrying a double quote, because this repo's real one is 1,500
  // characters full of them and the manifest must stay valid JSON.
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + '- **Worker command:** echo "with a quote"; exit 0\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-m.md'),
    '# M\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/manifest` — one\n');
  fs.symlinkSync('../2026-01-01-m.md', path.join(r, 'plans', 'active', 'm.md'));
  // A brief, so the worker actually launches — the gate refuses a briefless start.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'manifest.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  staff(r, 'feature/manifest', path.join(path.dirname(r), 'plot-wt-feature-manifest'));

  const dir = path.join(r, '.plot', 'agents');
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  assert.equal(names.length, 1, `one manifest per launched worker, got ${names.join(',')}`);

  const m = JSON.parse(fs.readFileSync(path.join(dir, names[0]), 'utf8'));

  // The filename IS the session id: that is how the board finds a transcript.
  assert.equal(`${m.session}.json`, names[0],
    'the manifest is named for the session it records');
  assert.match(m.session, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'the session id is lowercase and uuid-shaped — the runtime writes it lowercase');

  // EVERY FIELD TRACES TO LAUNCH-TIME KNOWLEDGE. This is the acceptance
  // criterion, asserted in both directions: what is present, and what must not
  // be because the dispatcher cannot know it.
  assert.equal(m.branch, 'feature/manifest');
  // `realpathSync`, because the dispatcher records the RESOLVED path and must:
  // macOS `/var` is a symlink to `/private/var`, and the runtime derives its
  // transcript directory from the real cwd. A manifest holding the symlink path
  // would slug to a directory that does not exist and the join would fail
  // silently — the exact failure this manifest exists to prevent.
  assert.equal(m.worktree,
    fs.realpathSync(path.join(path.dirname(r), 'plot-wt-feature-manifest')));
  assert.equal(m.command, 'echo "with a quote"; exit 0',
    'the command survives its quotes into valid JSON');
  assert.match(m.startedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  // The process facts the manifest carries are the ones the DISPATCHER STARTED:
  // the agent's own pid, plus the wrapper and all three monitors it spawned
  // beside it. The wrapper stamps them at spawn so the registry can name every
  // process it is responsible for — and answer liveness in one pass.
  //
  // The line this test draws is unchanged, and it is `started` against `guessed`:
  // model and context are still absent, because those the dispatcher cannot know
  // and a manifest claiming them would be a guess. A pid of a process it forked
  // itself is not a guess, which is why the group is admitted and they are not.
  // `attempts` and `resumeId` join on the same criterion the comment above
  // states. Both are facts the dispatcher KNOWS at launch rather than guesses:
  // it sets the attempt counter itself, and the resume handle is the session id
  // it just generated. They are separate fields on purpose — `session` is the
  // transcript join key and stays fixed across a branch hop, while the resume
  // handle's lifetime is the open question, and `attempts` is the supervisor's
  // counter rather than a share of `relaunches`, so a person's manual restarts
  // cannot exhaust an automatic budget.
  assert.deepEqual(Object.keys(m).sort(),
    ['agentMonitorPid', 'attempts', 'branch', 'buildMonitorPid', 'command', 'pid',
      'resumeId', 'session', 'startedAt', 'workerMonitorPid', 'worktree', 'wrapperPid'],
    'launch-time facts plus every process the dispatcher started: no model, no context it could only guess');
});

test('dispatch: the manifest pid is the AGENT pid, matching .plot-worker.pid', () => {
  // A manifest carries a pid at spawn — the wave's first acceptance criterion.
  // It must be the AGENT's pid, the same value `.plot-worker.pid` records, not
  // the wrapper's: the registry checks liveness against it, so a wrapper pid
  // would answer about the wrong process exactly as the old panel bug did.
  //
  // The agent proves its own pid the way the `.plot-worker.pid` test does:
  // `exec sleep` replaces the shell without changing the pid, so `$$` captured a
  // line earlier IS the running agent's pid — stable even when the detached
  // process is reaped as the dispatcher exits under the test harness.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-mpid-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  const sentinel = path.join(t, 'agent.pid');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + `- **Worker command:** sh -c 'echo $$ > ${sentinel}; exec sleep 20'\n`);
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-mp.md'),
    '# MP\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/mpid` — one\n');
  fs.symlinkSync('../2026-01-01-mp.md', path.join(r, 'plans', 'active', 'mp.md'));
  // A brief, so the worker actually launches — the gate refuses a briefless start.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'mpid.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const wt = path.join(path.dirname(r), 'plot-wt-feature-mpid');
  staff(r, 'feature/mpid', wt);

  const dir = path.join(r, '.plot', 'agents');
  const [name] = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  // The wrapper writes both the pid file and the manifest pid; wait for both.
  const deadline = Date.now() + 10_000;
  const manifestHasPid = () => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')).pid !== ''; }
    catch { return false; }
  };
  while (Date.now() < deadline
    && !(fs.existsSync(sentinel) && fs.existsSync(path.join(wt, '.plot-worker.pid')) && manifestHasPid())) {
    execFileSync('sleep', ['0.1']);
  }

  const agentPid = fs.readFileSync(sentinel, 'utf8').trim();
  const pidFile = fs.readFileSync(path.join(wt, '.plot-worker.pid'), 'utf8').trim();
  const m = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  assert.equal(pidFile, agentPid, '.plot-worker.pid names the agent (sanity)');
  assert.equal(m.pid, agentPid,
    `the manifest pid must name the agent (${agentPid}), got ${m.pid}`);

  try { process.kill(Number(agentPid), 'SIGTERM'); } catch { /* already gone */ }
  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

test('dispatch: the manifest names the wrapper and all three monitors, at spawn', () => {
  // THE DEFECT. The manifest recorded the process the registry started LEAST
  // ambiguously — the agent — and none of the others the registry also started.
  // Measured on the estate 2026-08-30: 1 manifest, 76 monitor processes, 0 of
  // them nameable from the registry.
  //
  //   plot-dispatch.sh  (7357)
  //     └── wrapper     (7358)             ← in no manifest
  //           ├── WorkerMonitor    (7364)  ← in no manifest
  //           ├── AgentMonitor     (7365)  ← in no manifest
  //           └── plot-worker-loop (7366)  ← "pid": "7366"
  //
  // `DESIGN-agent.md` gives the registry *no worktree is left behind*; the same
  // sentence is owed for processes, and nothing could find one to reap.
  //
  // AT SPAWN, NEVER DISCOVERED LATER. The group is written by the wrapper as part
  // of the same stamp that writes the pid — not by a later sweep of `ps` for a
  // command pattern, which is how `plot-reap.sh:162` came to recognise no
  // worktree at all. This test kills the agent and then reads the manifest: if
  // the record depended on the processes still being there, it would be gone.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-group-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  const sentinel = path.join(t, 'agent.pid');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + `- **Worker command:** sh -c 'echo "$$ $PPID" > ${sentinel}; exec sleep 20'\n`);
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-g.md'),
    '# G\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/group` — one\n');
  fs.symlinkSync('../2026-01-01-g.md', path.join(r, 'plans', 'active', 'g.md'));
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'group.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const wt = path.join(path.dirname(r), 'plot-wt-feature-group');
  staff(r, 'feature/group', wt);

  const dir = path.join(r, '.plot', 'agents');
  const [name] = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !(fs.existsSync(sentinel) && read().pid !== '')) {
    execFileSync('sleep', ['0.1']);
  }

  const [agentPid, wrapperPpid] = fs.readFileSync(sentinel, 'utf8').trim().split(/\s+/);

  // KILL THE AGENT FIRST, then read. The record must survive the processes it
  // names — that is what "written at spawn" means, as opposed to a value some
  // later reader recomputes by looking for them.
  try { process.kill(Number(agentPid), 'SIGTERM'); } catch { /* already gone */ }

  const m = read();
  assert.equal(m.pid, agentPid, 'the agent pid (sanity)');
  assert.equal(m.wrapperPid, wrapperPpid,
    `the manifest must name the wrapper (${wrapperPpid}), the agent's actual parent`);
  assert.match(m.workerMonitorPid, /^\d+$/,
    `the manifest must name the WorkerMonitor, got: ${m.workerMonitorPid}`);
  assert.match(m.agentMonitorPid, /^\d+$/,
    `the manifest must name the AgentMonitor, got: ${m.agentMonitorPid}`);
  // THE THIRD MONITOR IS NOT AN AFTERTHOUGHT. `plot-dispatch.sh` calls the
  // BuildMonitor "born the same way and for the same reason" as its two
  // siblings; it was captured into `bmon` and then never written, so the
  // manifest named three of four spawned processes while the changeset claimed
  // every one.
  assert.match(m.buildMonitorPid, /^\d+$/,
    `the manifest must name the BuildMonitor, got: ${m.buildMonitorPid}`);

  // FIVE DISTINCT PROCESSES. A group whose members collapsed onto one pid would
  // pass every numeric check above and name nothing useful.
  const group = [m.pid, m.wrapperPid, m.workerMonitorPid, m.agentMonitorPid,
    m.buildMonitorPid];
  assert.equal(new Set(group).size, 5, `five distinct processes, got: ${group.join(' ')}`);

  fs.rmSync(t, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

test('dispatch: the session id reaches the worker as PLOT_SESSION_ID', () => {
  // The manifest points at a transcript, and the transcript only lands there if
  // the runtime is told which session it is. The dispatcher mints the id — this
  // repo's Worker command carries no `--session-id` — so the ONE thing that
  // makes the join possible is that a command can read it back.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sessenv-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  const seen = path.join(t, 'seen-session');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + `- **Worker command:** printf '%s' "$PLOT_SESSION_ID" > ${seen}\n`);
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-e.md'),
    '# E\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/env` — one\n');
  fs.symlinkSync('../2026-01-01-e.md', path.join(r, 'plans', 'active', 'e.md'));
  // A brief, so the worker actually launches — the gate refuses a briefless start.
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'env.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const wt = path.join(path.dirname(r), 'plot-wt-feature-env');
  staff(r, 'feature/env', wt);

  // The worker only writes one file and exits; wait for it rather than sleeping
  // a guessed interval.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !fs.existsSync(path.join(wt, '.plot-worker.exit'))) {
    execFileSync('sleep', ['0.1']);
  }

  const dir = path.join(r, '.plot', 'agents');
  const [name] = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  const m = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  assert.equal(fs.readFileSync(seen, 'utf8').trim(), m.session,
    'the worker saw the same session id the manifest records');
});
// ---------------------------------------------------------------------------
// THE GATE — a worker whose manifest cannot be written is never launched
// ---------------------------------------------------------------------------
//
// Both writes used to be `|| true`, so a worker whose manifest could not be
// written started anyway and was invisible to the registry for its whole life.
// An agent outside the registry cannot be seen, stopped, restarted or reaped
// through the board, and it holds a claim nobody can release — which is why the
// gate REFUSES rather than launching. A worker that cannot be registered is
// worse than one that never started, because the second state is visible, and
// the worktree and claim survive either way so the operator can retry.
//
// The gate sits BEFORE the spawn, and that ordering is the whole design: the
// manifest is written ~75 lines ahead of the launch, so this has a launch to
// PREVENT rather than a process to kill. An earlier draft said *assert after
// launch, then kill*; the test below pins the difference by asserting that no
// worker was ever spawned, not that one started and died.

/**
 * A self-contained repo whose plan has one branch, a brief, and a `Worker
 * command` that touches `sentinel` the instant it runs. Returns the paths a
 * gate test needs. The sentinel is the whole measurement: a launch is proved by
 * the file appearing, and a refusal by it never appearing.
 */
function gateRepo() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gate-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  const sentinel = path.join(t, 'worker-ran');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + `- **Worker command:** touch ${sentinel}\n`);
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-g.md'),
    '# G\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/gated` — one\n');
  fs.symlinkSync('../2026-01-01-g.md', path.join(r, 'plans', 'active', 'g.md'));
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'gated.md'), 'spec\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');
  return { tmp: t, repo: r, sentinel, agents: path.join(r, '.plot', 'agents') };
}

/**
 * True once `sentinel` exists, waiting up to `ms` for a DETACHED worker to reach
 * it. A refusal is proved by exhausting this wait: the worker is spawned into
 * the background, so an immediate check would report "no worker" even for a
 * launch that simply had not run yet.
 */
function workerRan(sentinel, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !fs.existsSync(sentinel)) execFileSync('sleep', ['0.1']);
  return fs.existsSync(sentinel);
}

test('dispatch: a branch whose manifest cannot be written spawns no worker', () => {
  // Item 5. The write is made to fail the way it fails in the field — the
  // directory cannot be written — rather than by stubbing the writer, because
  // what is under test is the check at the RESOLVED path, and only a real run
  // resolves it.
  const { tmp: t, repo: r, sentinel, agents } = gateRepo();
  // THE DESK IS LAID FIRST, because the launch is reached through `--restart`
  // now — see `staff`. The gate under test is the manifest write inside
  // `start_worker`, which is unmoved; only its caller changed.
  const wt = path.join(path.dirname(r), 'plot-wt-feature-gated');
  git(r, 'worktree', 'add', '-q', '-b', 'feature/gated', wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/gated');
  git(wt, 'push', '-qu', 'origin', 'feature/gated');
  // `mkdir -p` on an existing directory SUCCEEDS, so the registry has to exist
  // and be unwritable: that is precisely the state where the old `|| true` let
  // a launch through. Creating it read-only would make `mkdir -p` the failure
  // instead, and the gate must hold for the write, not only the mkdir.
  fs.mkdirSync(agents, { recursive: true });
  fs.chmodSync(agents, 0o500);
  try {
    const out = spawnSync('bash', [dispatch, '--offline', '--restart', 'feature/gated'],
      { encoding: 'utf8', cwd: r, timeout: 30_000 });

    // NO WORKER WAS EVER SPAWNED — not one that started and died. The sentinel
    // is touched by the command's first act, so its absence after a full wait
    // is proof the command never ran at all.
    assert.equal(workerRan(sentinel), false,
      'the Worker command must never run when its manifest could not be written');

    // The dispatch NAMES THE PATH IT COULD NOT WRITE. A refusal that says only
    // "could not start" sends the operator reading the script to learn where it
    // looked, and the whole defect was a path nobody could see.
    const said = out.stdout + out.stderr;
    assert.ok(said.includes(agents),
      `the refusal must name the registry path it could not write, got: ${said}`);

    // THE WORKTREE AND CLAIM SURVIVE. The operator fixes the cause and retries;
    // a gate that also tore down the desk would turn a permissions slip into
    // lost setup.
    assert.ok(fs.existsSync(wt),
      'the worktree remains, so a retry costs nothing once the cause is fixed');
  } finally {
    // Restore the mode before the harness cleans up, or the directory cannot be
    // removed.
    fs.chmodSync(agents, 0o700);
  }
});

test('dispatch: the ordinary path says nothing new about the manifest', () => {
  // Item 6. A fix that prints a warning on every successful dispatch trains the
  // reader to skip the line, and item 5's message is only useful if it is rare.
  // So the successful path is asserted to be SILENT about the manifest, not
  // merely correct.
  const { repo: r, sentinel, agents } = gateRepo();
  const out = staff(r, 'feature/gated', path.join(path.dirname(r), 'plot-wt-feature-gated'));

  assert.equal(workerRan(sentinel), true, 'the launch path still starts its worker');
  assert.equal(fs.readdirSync(agents).filter((n) => n.endsWith('.json')).length, 1,
    'and still writes exactly one manifest');

  // Nothing about manifests, registries or the path reaches a successful run's
  // output. Asserted against the words the gate would use, since those are the
  // ones that would leak.
  assert.doesNotMatch(out, /manifest/i, 'a successful dispatch says nothing about manifests');
  assert.doesNotMatch(out, /registry/i, 'nor about the registry');
  assert.ok(!out.includes(agents), 'nor names the registry path');
});

// ---------------------------------------------------------------------------
// WHERE THE WORKTREES LIVE — the `Worktree root:` config key
// ---------------------------------------------------------------------------
//
// The root is a `## Plot Config` key, and the `plot-wt-` prefix is a PROPERTY
// OF THE ROOT rather than a constant: a shared root (the default, beside the
// repo) prefixes because it shares a directory with unrelated projects; a
// dedicated root does not, because the directory already says what these are.
// Two conventions coexist permanently, by design. These tests hold both halves,
// and the one that matters most: a repo declaring NOTHING is untouched.

/**
 * A self-contained repo with a one-branch plan, whose CLAUDE.md carries the
 * given extra config lines. Returns { tmp, repo }. Same idiom as the
 * session-env test above; kept local so each root test gets a clean estate.
 */
function rootRepo(extraConfig = '') {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wtroot-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + extraConfig);
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-root.md'),
    '# Root\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/one` — one\n');
  fs.symlinkSync('../2026-01-01-root.md', path.join(r, 'plans', 'active', 'root.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');
  return { tmp: t, repo: r };
}

// THE ASSERTION THAT KEEPS 26 CHECKOUTS WORKING. A repo that never adopts the
// key dispatches exactly where it does today, prefix intact. An implementation
// that silently relocates them passes every other assertion in this file, so
// this is asserted directly and first.
test('dispatch: a repo declaring nothing keeps the legacy root and prefix', () => {
  const { tmp: t, repo: r } = rootRepo();
  try {
    const out = execFileSync('bash', [dispatch, '--dry-run', '--offline', 'root'],
      { encoding: 'utf8', cwd: r });
    // Beside the repo, with the prefix.
    const beside = path.join(path.dirname(r), 'plot-wt-feature-one');
    assert.match(out, new RegExp(`would dispatch feature/one → \\S*/plot-wt-feature-one`),
      `default dispatch must be beside the repo with the prefix:\n${out}`);
    assert.doesNotMatch(out, /\.worktrees/, 'nothing configured must not invent a nested root');
    void beside;
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
  }
});

// A DEDICATED ROOT RELOCATES AND DROPS THE PREFIX. The directory name becomes
// the flattened branch, because the directory itself already says these are
// Plot's.
test('dispatch: a relative Worktree root nests the worktrees and drops the prefix', () => {
  const { tmp: t, repo: r } = rootRepo('- **Worktree root:** .worktrees/\n');
  try {
    const out = execFileSync('bash', [dispatch, '--dry-run', '--offline', 'root'],
      { encoding: 'utf8', cwd: r });
    // Under the repo, in .worktrees/, named for the flattened branch — no prefix.
    assert.match(out, /would dispatch feature\/one → \S*\/\.worktrees\/feature-one\b/,
      `a dedicated root must nest and drop the prefix:\n${out}`);
    assert.doesNotMatch(out, /plot-wt-/, 'the prefix has no job under a dedicated root');
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
  }
});

// AN ABSOLUTE ROOT IS TAKEN AS GIVEN, not appended to the repo root.
test('dispatch: an absolute Worktree root is honoured as given', () => {
  const abs = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-absroot-'));
  const { tmp: t, repo: r } = rootRepo(`- **Worktree root:** ${abs}\n`);
  try {
    const out = execFileSync('bash', [dispatch, '--dry-run', '--offline', 'root'],
      { encoding: 'utf8', cwd: r });
    // The exact directory, not <repo>/<abs>.
    assert.match(out, new RegExp(`would dispatch feature/one → ${abs.replace(/[/\\.]/g, '\\$&')}/feature-one\\b`),
      `an absolute root must be used verbatim:\n${out}`);
    assert.doesNotMatch(out, new RegExp(`${r.replace(/[/\\.]/g, '\\$&')}.*${abs.replace(/[/\\.]/g, '\\$&')}`),
      'an absolute root must not be appended to the repo root');
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
    fs.rmSync(abs, { recursive: true, force: true });
  }
});

// A NESTED WORKTREE DOES NOT DIRTY THE REPO, and its files do not answer the
// marker grep — asserted IN a real dispatch, not only in the scratch probe the
// plan measured. `.worktrees/` in `.gitignore` plus `--exclude-standard` is the
// whole mitigation; this proves it holds after the dispatcher actually creates
// a worktree there and plants both an untracked file and a PLOT-BLOCKED marker.
test('dispatch: a nested worktree stays invisible to git status and the marker grep', () => {
  const { tmp: t, repo: r } = rootRepo('- **Worktree root:** .worktrees/\n');
  try {
    fs.writeFileSync(path.join(r, '.gitignore'), '.worktrees/\n');
    git(r, 'add', '.gitignore');
    git(r, 'commit', '-qm', 'ignore worktrees');

    // A real run under the nested root, for the BOOKING it performs — that is
    // what plants a `.plot-start-*` worktree there and what the next assertion
    // is about.
    execFileSync('bash', [dispatch, '--offline', '--no-start', 'root'],
      { encoding: 'utf8', cwd: r });

    // THE DESK IS CUT HERE, at the path the configured root resolves to.
    // Dispatch cuts none — the agent does, when it takes the brief — but it
    // cuts it exactly here, and where it lands is what this test is about: a
    // desk INSIDE the repo, which is the arrangement the two greps below have
    // to stay blind to.
    const wt = path.join(r, '.worktrees', 'feature-one');
    git(r, 'worktree', 'add', '-q', '-b', 'feature/one', wt, 'origin/main');
    assert.ok(fs.existsSync(wt), 'the fixture must have made a worktree under .worktrees/');

    // AFTER A BOOKING, NO `.plot-start-*` REMAINS UNDER THE ROOT. The removal at
    // book_start ends `|| true`, so its success is asserted rather than trusted —
    // under a nested root a leftover would sit inside the repo. (Gitignored, so
    // invisible to status, which is exactly why the absence is checked on disk.)
    const leftovers = fs.readdirSync(path.join(r, '.worktrees'))
      .filter((n) => n.startsWith('.plot-start-'));
    assert.deepEqual(leftovers, [], `a booking worktree leaked under the root: ${leftovers}`);

    // Plant the two things the objection worried about: an untracked file and a
    // blocked marker, both INSIDE the nested worktree.
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'untracked\n');
    fs.writeFileSync(path.join(wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: is this seen?\n');

    // git status sees nothing — the ignored directory is excluded.
    assert.equal(git(r, 'status', '--porcelain').trim(), '',
      'a nested worktree must not make the main repo dirty');

    // The marker grep, run the way plot-reconcile does, finds nothing.
    let markerHit = '';
    try {
      markerHit = execFileSync('git',
        ['grep', '-lIE', '--untracked', '--exclude-standard', 'PLOT-BLOCKED:', '--', '.'],
        { encoding: 'utf8', cwd: r });
    } catch (err) {
      // git grep exits 1 with no match — that is the PASS here.
      markerHit = err.stdout ?? '';
    }
    assert.equal(markerHit.trim(), '',
      'a marker inside a nested, ignored worktree must not answer the grep');
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
  }
});
