// Contract test for `plot-dispatch.sh`'s prerequisite gate — the refusal a
// branch earns by declaring `<!-- waits: <branch> -->`.
//
// THE GATE EXISTS BECAUSE THE PROSE DID NOT WORK. `plot-dispatch.sh` gates on
// the plan's PHASE, so an Approved plan's waiting slice read as eligible and was
// dispatched anyway — twice, measured 2026-09-02. The second run hit its own
// prerequisite gate inside the worker, wrote a PLOT-BLOCKED marker, and left the
// branch claimed holding nothing but its claim commit. A paragraph in a brief is
// a rule; this is the gate. See CLAUDE.md § Gates Over Rules.
//
// THE QUESTION IS PUT TO PULL REQUESTS, NEVER TO THE REFS, and the test named
// `reaped` below is why. `plot-release-refs.sh` deletes the remote refs of a
// delivered plan's merged branches, so a prerequisite that SUCCEEDED eventually
// has no ref at all. A gate reading refs would hold its dependent forever
// because its dependency succeeded — correct work producing a permanent block,
// which is the worst failure available here.
//
// `NONE` AND SILENCE ARE DIFFERENT ANSWERS, and the two tests at the end hold
// them apart. A host that answered and has never seen a PR for the branch is
// `blocked`: a typo, which resolves by editing the plan. A host that could not
// be asked is `waiting`: silence is neither permission to start nor proof of a
// typo, and telling an operator to fix a correct plan is its own defect.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const dispatch = path.join(scripts, 'plot-dispatch.sh');

const ctx = [];
after(() => { for (const t of ctx) fs.rmSync(t, { recursive: true, force: true }); });

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

// A repo with an origin and one plan whose single branch may carry a `waits:`
// annotation. `Worker command: none` so nothing is ever launched: this file
// tests a REFUSAL, and a test that starts a detached agent to prove one did not
// happen is a test that leaks processes.
function makeRepo({ waitsOn = null, deferred = null, branch = 'feature/dependent' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-waits-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n'
    + '- **Plan directory:** plans/\n'
    + '- **Main branch:** main\n'
    + '- **Worker command:** none\n');
  fs.mkdirSync(path.join(repo, 'plans'), { recursive: true });
  const notes = [
    waitsOn ? `<!-- waits: ${waitsOn} -->` : '',
    deferred ? `<!-- deferred: ${deferred} -->` : '',
  ].filter(Boolean).join(' ');
  fs.writeFileSync(path.join(repo, 'plans', '2026-09-02-dependent.md'),
    '# Dependent plan\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n'
    + '- **Impl:** own branches\n\n'
    + '## Branches\n\n### Only\n\n'
    + `- \`${branch}\` ${notes} — the dependent work\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  ctx.push(tmp);
  return repo;
}

// A `gh` shim on PATH, controlling what the host says about the PREREQUISITE.
//
// The scripts under test stay the real ones: `plot-host.sh` calls `gh` by bare
// name, so replacing the binary is what makes the four host answers reachable
// without copying a single Plot script.
//
//   state: 'MERGED'    the prerequisite landed
//   state: 'OPEN'      it exists and has not landed
//   state: null        `gh pr view` finds nothing → NONE, a name nobody used
//   unreachable: true  `gh` fails outright → the host could not be asked
//
// IT ANSWERS ABOUT THE PREREQUISITE ALONE, and every other branch reports no PR.
// A shim answering MERGED to everything makes `feature/dependent` itself read
// merged, its slice `complete`, and the fan-out empty for a reason that has
// nothing to do with the gate — measured while writing this file.
function ghShim({ prereq = 'bug/the-prerequisite', state = null, unreachable = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-waits-gh-'));
  ctx.push(dir);
  const answer = unreachable
    // A TRANSPORT FAILURE, not a miss. The wording matters: `plot-host.sh`
    // classifies "no pull requests found" as an ANSWER (state NONE) and
    // anything else as a failure, which is precisely the distinction under
    // test — so this must not accidentally spell the miss.
    ? '      echo "error connecting to api.github.com" >&2; exit 1 ;;\n'
    : state
      ? `      printf '%s' '{"number":42,"state":"${state}","isDraft":false,`
        + `"url":"https://example.invalid/pr/42","mergeCommit":{"oid":"deadbee"}}' ;;\n`
      : '      echo "no pull requests found" >&2; exit 1 ;;\n';
  fs.writeFileSync(path.join(dir, 'gh'),
    '#!/usr/bin/env bash\n'
    + 'if [ "$1 $2" = "pr view" ]; then\n'
    + '  case "$3" in\n'
    + `    ${prereq})\n`
    + answer
    + '    *) echo "no pull requests found" >&2; exit 1 ;;\n'
    + '  esac\n'
    + 'fi\n'
    + 'echo "{}"\n');
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return dir;
}

// `--offline` is deliberately ABSENT from every run below. The gate answers
// `unreachable` offline — a flag promising no network must not put a question —
// so an offline run could never distinguish a merged prerequisite from a
// missing one, which is the whole of what these tests measure.
function run(repo, args, { gh = null } = {}) {
  const env = { ...process.env };
  if (gh) env.PATH = `${gh}:${env.PATH}`;
  // `PLOT_HOST_FORCE_REST` unset: the default `gh pr view` route is the one the
  // shim above implements.
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync('bash', [dispatch, ...args],
      { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    status = e.status ?? 1;
    stdout = (e.stdout ?? '') + (e.stderr ?? '');
  }
  return { stdout, status };
}

// --- The refusal -----------------------------------------------------------

test('waits: an unmerged prerequisite is refused BY NAME', () => {
  const repo = makeRepo({ waitsOn: 'bug/the-prerequisite' });
  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh: ghShim({ state: 'OPEN' }) });

  assert.match(stdout, /skipped feature\/dependent \(waiting on bug\/the-prerequisite\)/,
    `the refusal must name the branch AND what it waits on:\n${stdout}`);
  // The whole defect this replaces was an EMPTY set: `dispatched=0` with
  // nothing said about what was filtered out.
  assert.doesNotMatch(stdout, /would dispatch feature\/dependent/,
    `a waiting branch must not be offered:\n${stdout}`);
  assert.match(stdout, /summary: dispatched=0 .*skipped=1/,
    `and the footer must count it as skipped:\n${stdout}`);
});

test('waits: the refusal names the escape rather than being a dead end', () => {
  // A gate with no exit is one people route around by never annotating at all,
  // which costs the fleet the annotation and the gate together.
  const repo = makeRepo({ waitsOn: 'bug/the-prerequisite' });
  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh: ghShim({ state: 'OPEN' }) });
  assert.match(stdout, /--allow-waiting/, `the refusal must name its escape:\n${stdout}`);
});

test('waits: --allow-waiting dispatches anyway, and SAYS SO', () => {
  const repo = makeRepo({ waitsOn: 'bug/the-prerequisite' });
  const { stdout } = run(repo, ['--dry-run', '--allow-waiting', 'dependent'],
    { gh: ghShim({ state: 'OPEN' }) });

  assert.match(stdout, /would dispatch feature\/dependent/,
    `--allow-waiting must actually let it through:\n${stdout}`);
  // An override nobody can see in the output is an override nobody can audit.
  assert.match(stdout, /waits on bug\/the-prerequisite.*--allow-waiting/,
    `the override must be on the record:\n${stdout}`);
});

// --- The clauses a naive implementation passes without ---------------------

test('waits: a MERGED prerequisite behaves exactly as no annotation does', () => {
  // A dependency that never clears is a deadlock, so the cleared case is
  // asserted rather than assumed.
  const repo = makeRepo({ waitsOn: 'bug/the-prerequisite' });
  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh: ghShim({ state: 'MERGED' }) });

  assert.match(stdout, /would dispatch feature\/dependent/,
    `a cleared prerequisite must not hold the branch:\n${stdout}`);
  assert.doesNotMatch(stdout, /waiting on/, `and nothing may still be waiting:\n${stdout}`);
});

test('waits: a prerequisite that merged and was then REAPED still clears', () => {
  // THE CASE WHERE CORRECT WORK OTHERWISE PRODUCES A PERMANENT BLOCK.
  // `plot-release-refs.sh` deletes the remote refs of a delivered plan's merged
  // branches, so this repo holds NO ref by that name — locally or on origin —
  // while the host still reports the merged PR. A gate reading refs answers
  // "never existed" and blocks forever; this one asks the host and clears.
  const repo = makeRepo({ waitsOn: 'bug/reaped-after-merge' });
  assert.equal(git(repo, 'ls-remote', '--heads', 'origin', 'bug/reaped-after-merge').trim(), '',
    'the fixture must hold no ref for the prerequisite — that is the case');

  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh: ghShim({ state: 'MERGED' }) });
  assert.match(stdout, /would dispatch feature\/dependent/,
    `a reaped-but-merged prerequisite must clear:\n${stdout}`);
  assert.doesNotMatch(stdout, /blocked/,
    `and a missing ref must never read as a missing PR:\n${stdout}`);
});

test('waits: a prerequisite the host has never seen a PR for reads BLOCKED', () => {
  const repo = makeRepo({ waitsOn: 'bug/typo-nobody-created' });
  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh: ghShim({ prereq: 'bug/typo-nobody-created', state: null }) });

  assert.match(stdout, /skipped feature\/dependent \(blocked — no PR found for bug\/typo-nobody-created\)/,
    `a name the host answered about and never saw is a typo, not a wait:\n${stdout}`);
  // The two words send an operator to different places: `blocked` to the plan
  // file, `waiting` to the calendar. Collapsing them wastes one of the trips.
  assert.doesNotMatch(stdout, /waiting on/,
    `and it must not be reported as a wait:\n${stdout}`);
});

test('waits: an unreachable host HOLDS the slice, and does not block it', () => {
  // Silence is never permission to start, and it is equally not proof of a
  // typo. `blocked` here would tell an operator to go and fix a plan that is
  // correct.
  const repo = makeRepo({ waitsOn: 'bug/the-prerequisite' });
  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh: ghShim({ unreachable: true }) });

  assert.match(stdout, /skipped feature\/dependent \(waiting on bug\/the-prerequisite\)/,
    `an unreachable host must hold the branch:\n${stdout}`);
  assert.doesNotMatch(stdout, /blocked/,
    `and must never accuse the plan of a typo:\n${stdout}`);
});

// --- The annotation next door ---------------------------------------------

test('waits: `deferred:` is untouched, and the two do not interfere', () => {
  // `deferred:` is a JUDGEMENT — somebody gave the branch up — and `waits:` is
  // a fact a script can check. They are parsed off one line by one parser, so
  // one branch carrying both is the case where a shared regex would swallow a
  // neighbour's value. A deferred branch is never work, whatever it waits on.
  const repo = makeRepo({ waitsOn: 'bug/the-prerequisite', deferred: 'folded into the next slice' });
  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh: ghShim({ state: 'MERGED' }) });

  assert.doesNotMatch(stdout, /would dispatch feature\/dependent/,
    `a deferred branch is never dispatched, cleared prerequisite or not:\n${stdout}`);
  // And it is reported as DEFERRED — silently, by never being offered — rather
  // than as waiting on something that has already landed.
  assert.doesNotMatch(stdout, /waiting on|blocked/,
    `a deferred branch must not acquire a wait it does not have:\n${stdout}`);
});

test('waits: a branch declaring nothing is asked nothing', () => {
  // The population is 6 plans in 188. A gate that cost every other branch a
  // host round trip would be paid by the 182 that declare nothing — so the
  // absence of the annotation must short-circuit before the host is reached.
  // Proved by giving the shim NO `gh` at all: a run that asks would fail.
  const repo = makeRepo({});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-waits-nogh-'));
  ctx.push(dir);
  fs.writeFileSync(path.join(dir, 'gh'),
    '#!/usr/bin/env bash\necho "gh must not be called for an unannotated branch" >&2\nexit 9\n');
  fs.chmodSync(path.join(dir, 'gh'), 0o755);

  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh: dir });
  assert.match(stdout, /would dispatch feature\/dependent/,
    `an unannotated branch dispatches as it always did:\n${stdout}`);
  assert.doesNotMatch(stdout, /waiting on|blocked/,
    `and acquires no wait:\n${stdout}`);
});
