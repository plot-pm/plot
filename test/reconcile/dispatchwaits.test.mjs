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
function makeRepo({ waitsOn = null, deferred = null, branch = 'feature/dependent', sibling = null, siblingNote = '', otherPlan = null } = {}) {
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
    ...[].concat(waitsOn ?? []).map((w) => `<!-- waits: ${w} -->`),
    deferred ? `<!-- deferred: ${deferred} -->` : '',
  ].filter(Boolean).join(' ');
  fs.writeFileSync(path.join(repo, 'plans', '2026-09-02-dependent.md'),
    '# Dependent plan\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n'
    + '- **Impl:** own branches\n\n'
    + '## Branches\n\n### Only\n\n'
    + (sibling ? `- \`${sibling}\` ${siblingNote} — a slice nobody has started\n` : '')
    + `- \`${branch}\` ${notes} — the dependent work\n`);
  // A SECOND PLAN, holding the prerequisite as one of ITS slices.
  if (otherPlan) {
    fs.writeFileSync(path.join(repo, 'plans', '2026-09-02-another-plan.md'),
      `# Another plan\n\n## Status\n\n- **Phase:** ${otherPlan.phase}\n- **Type:** feature\n`
      + '- **Impl:** own branches\n\n## Branches\n\n### Only\n\n'
      + `- \`${otherPlan.slice}\` — a slice nobody has started\n`);
  }
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

  // The shim must name THIS prerequisite: it answers about one branch and
  // reports no PR for every other, so leaving `prereq` at its default would
  // make the host say NONE about `bug/reaped-after-merge` and the branch read
  // `blocked` — the right answer to a different question.
  const { stdout } = run(repo, ['--dry-run', 'dependent'],
    { gh: ghShim({ prereq: 'bug/reaped-after-merge', state: 'MERGED' }) });
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

test('waits: a sibling slice the host has no PR for reads WAITING, not blocked (#1305)', () => {
  // The plan names the prerequisite as a slice, so `NONE` means nobody started
  // it yet. Only a name the plan does not contain is a typo.
  const repo = makeRepo({ waitsOn: 'feature/first', sibling: 'feature/first' });
  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh: ghShim({ prereq: 'feature/first', state: null }) });

  assert.match(stdout, /skipped feature\/dependent \(waiting on feature\/first\)/,
    `a named sibling with no PR is a wait:\n${stdout}`);
  assert.doesNotMatch(stdout, /blocked/, `and never a typo:\n${stdout}`);
});

// The scan's own line for the dependent branch, from a slug run of its plan.
const scanSlug = (repo, gh) => {
  const env = { ...process.env, PATH: `${gh}:${process.env.PATH}` };
  return execFileSync('bash', [path.join(scripts, 'plot-fleet-scan.sh'), 'dependent'],
    { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
};

test('waits: a slice of ANOTHER plan with no PR reads WAITING in dispatch and in the slug scan', () => {
  // A slug run reads one plan; the set a `waits:` name is looked up in is the
  // whole estate's, as on the board's full scan.
  const repo = makeRepo({ waitsOn: 'feature/other-slice', otherPlan: { phase: 'Approved', slice: 'feature/other-slice' } });
  const gh = ghShim({ prereq: 'feature/other-slice', state: null });
  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh });

  assert.match(stdout, /skipped feature\/dependent \(waiting on feature\/other-slice\)/,
    `a slice of another plan with no PR is a wait:\n${stdout}`);
  assert.doesNotMatch(stdout, /blocked/, `and never a typo:\n${stdout}`);
  const scan = scanSlug(repo, gh);
  assert.match(scan, /feature\/dependent — waiting on feature\/other-slice/, scan);
  assert.doesNotMatch(scan, /no PR found/, scan);
});

test('waits: a slice of a DELIVERED plan with no PR reads BLOCKED — nobody will start it', () => {
  const repo = makeRepo({ waitsOn: 'feature/other-slice', otherPlan: { phase: 'Delivered', slice: 'feature/other-slice' } });
  const gh = ghShim({ prereq: 'feature/other-slice', state: null });
  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh });

  assert.match(stdout, /skipped feature\/dependent \(blocked — no PR found for feature\/other-slice\)/, stdout);
  assert.match(scanSlug(repo, gh), /feature\/dependent — blocked — no PR found for feature\/other-slice/);
});

test('waits: a DEFERRED sibling with no PR reads BLOCKED — nobody will start it', () => {
  const repo = makeRepo({ waitsOn: 'feature/first', sibling: 'feature/first', siblingNote: '<!-- deferred: given up -->' });
  const gh = ghShim({ prereq: 'feature/first', state: null });
  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh });

  assert.match(stdout, /skipped feature\/dependent \(blocked — no PR found for feature\/first\)/, stdout);
  assert.match(scanSlug(repo, gh), /feature\/dependent — blocked — no PR found for feature\/first/);
});

test('waits: a slice set that cannot be read HOLDS the slice at waiting, and does not block it', () => {
  // ABSENT IS NOT FALSE. A copy of the scripts whose scan fails `--slice-names`
  // and answers every other question as the real one does.
  const repo = makeRepo({ waitsOn: 'feature/other-slice', otherPlan: { phase: 'Approved', slice: 'feature/other-slice' } });
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-waits-scripts-'));
  ctx.push(copy);
  fs.cpSync(scripts, copy, { recursive: true });
  fs.renameSync(path.join(copy, 'plot-fleet-scan.sh'), path.join(copy, 'plot-fleet-scan.real.sh'));
  fs.writeFileSync(path.join(copy, 'plot-fleet-scan.sh'),
    '#!/usr/bin/env bash\n'
    + 'for a in "$@"; do [ "$a" = --slice-names ] && { echo "scan unavailable" >&2; exit 3; }; done\n'
    + 'exec bash "$(dirname "$0")/plot-fleet-scan.real.sh" "$@"\n');
  fs.chmodSync(path.join(copy, 'plot-fleet-scan.sh'), 0o755);
  const env = { ...process.env, PATH: `${ghShim({ prereq: 'feature/other-slice', state: null })}:${process.env.PATH}` };
  let stdout = '';
  try {
    stdout = execFileSync('bash', [path.join(copy, 'plot-dispatch.sh'), '--dry-run', 'dependent'],
      { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    stdout = (e.stdout ?? '') + (e.stderr ?? '');
  }

  assert.match(stdout, /skipped feature\/dependent \(waiting on feature\/other-slice\)/,
    `an unread slice set must hold the branch:\n${stdout}`);
  assert.match(stdout, /--slice-names gave no answer/, `and the refusal names why:\n${stdout}`);
  assert.doesNotMatch(stdout, /blocked/, `and must never accuse the plan of a typo:\n${stdout}`);
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
  //
  // PROVED BY A SHIM THAT REFUSES ONE QUESTION, not by removing `gh`. The scan
  // asks the host about the plan's OWN branches on every run, so a shim failing
  // every call reports the host as unreachable, the branch reads `unknown`
  // rather than `open`, and the fan-out is empty for a reason that has nothing
  // to do with the annotation — measured while writing this file. So ordinary
  // calls are answered and only a `pr view` naming a branch this plan does not
  // declare — which is what a prerequisite lookup looks like — fails loudly.
  const repo = makeRepo({});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-waits-nogh-'));
  ctx.push(dir);
  fs.writeFileSync(path.join(dir, 'gh'),
    '#!/usr/bin/env bash\n'
    + 'if [ "$1 $2" = "pr view" ]; then\n'
    + '  case "$3" in\n'
    + '    feature/dependent) echo "no pull requests found" >&2; exit 1 ;;\n'
    + '    *) echo "gh must not be asked about a prerequisite: $3" >&2; exit 9 ;;\n'
    + '  esac\n'
    + 'fi\n'
    + 'echo "{}"\n');
  fs.chmodSync(path.join(dir, 'gh'), 0o755);

  const { stdout } = run(repo, ['--dry-run', 'dependent'], { gh: dir });
  assert.match(stdout, /would dispatch feature\/dependent/,
    `an unannotated branch dispatches as it always did:\n${stdout}`);
  assert.doesNotMatch(stdout, /waiting on|blocked/,
    `and acquires no wait:\n${stdout}`);
});

// --- Two prerequisites -----------------------------------------------------
//
// THE PARSER EMITS A LIST, and `waits_pairs` must read every name in it. The
// old pattern `"waits_on":"[^"]*"` does not match an array, so a dispatch left
// unmigrated reads every slice as waiting on nothing and dispatches a held one
// (#1153). `[merged, unmerged]` is the case that catches that: a dispatch that
// reads nothing, or only the first name, lets it through.

// A `gh` shim answering per prerequisite: `answers` maps a branch to `MERGED`
// or `OPEN`. Every other branch reports no PR, for the reason `ghShim` gives.
const ghShimMany = (answers) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-waits-gh-'));
  ctx.push(dir);
  const arms = Object.entries(answers).map(([prereq, state]) =>
    `    ${prereq}) printf '%s' '{"number":42,"state":"${state}","isDraft":false,`
    + `"url":"https://example.invalid/pr/42","mergeCommit":{"oid":"deadbee"}}' ;;\n`).join('');
  fs.writeFileSync(path.join(dir, 'gh'),
    '#!/usr/bin/env bash\n'
    + 'if [ "$1 $2" = "pr view" ]; then\n'
    + '  case "$3" in\n'
    + arms
    + '    *) echo "no pull requests found" >&2; exit 1 ;;\n'
    + '  esac\n'
    + 'fi\n'
    + 'echo "{}"\n');
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return dir;
};

test('waits: [merged, unmerged] is refused and names only the unmerged one', () => {
  const repo = makeRepo({ waitsOn: ['bug/first', 'bug/second'] });
  const { stdout } = run(repo, ['--dry-run', 'dependent'],
    { gh: ghShimMany({ 'bug/first': 'MERGED', 'bug/second': 'OPEN' }) });

  assert.match(stdout, /skipped feature\/dependent \(waiting on bug\/second\)/,
    `the refusal must name the prerequisite that has not merged:\n${stdout}`);
  assert.doesNotMatch(stdout, /waiting on bug\/first/,
    `a merged prerequisite is not named:\n${stdout}`);
  assert.doesNotMatch(stdout, /would dispatch feature\/dependent/,
    `a branch with one unmerged prerequisite must not be offered:\n${stdout}`);
  assert.match(stdout, /summary: dispatched=0 .*skipped=1/, stdout);
});

test('waits: [unmerged, merged] is refused too — the order does not decide', () => {
  const repo = makeRepo({ waitsOn: ['bug/first', 'bug/second'] });
  const { stdout } = run(repo, ['--dry-run', 'dependent'],
    { gh: ghShimMany({ 'bug/first': 'OPEN', 'bug/second': 'MERGED' }) });

  assert.match(stdout, /skipped feature\/dependent \(waiting on bug\/first\)/, stdout);
  assert.doesNotMatch(stdout, /would dispatch feature\/dependent/, stdout);
});

test('waits: [merged, merged] dispatches', () => {
  const repo = makeRepo({ waitsOn: ['bug/first', 'bug/second'] });
  const { stdout } = run(repo, ['--dry-run', 'dependent'],
    { gh: ghShimMany({ 'bug/first': 'MERGED', 'bug/second': 'MERGED' }) });

  assert.match(stdout, /would dispatch feature\/dependent/,
    `two cleared prerequisites must not hold the branch:\n${stdout}`);
  assert.doesNotMatch(stdout, /waiting on|blocked/, stdout);
});

test('waits: two unmerged prerequisites refuse the branch ONCE and count it once', () => {
  const repo = makeRepo({ waitsOn: ['bug/first', 'bug/second'] });
  const { stdout } = run(repo, ['--dry-run', 'dependent'],
    { gh: ghShimMany({ 'bug/first': 'OPEN', 'bug/second': 'OPEN' }) });

  assert.equal((stdout.match(/skipped feature\/dependent /g) ?? []).length, 1,
    `one refusal line per branch, not per prerequisite:\n${stdout}`);
  assert.match(stdout, /summary: dispatched=0 .*skipped=1/, stdout);
});

test('waits: --allow-waiting names every unmerged prerequisite it overrides', () => {
  const repo = makeRepo({ waitsOn: ['bug/first', 'bug/second'] });
  const { stdout } = run(repo, ['--dry-run', '--allow-waiting', 'dependent'],
    { gh: ghShimMany({ 'bug/first': 'OPEN', 'bug/second': 'OPEN' }) });

  assert.match(stdout, /waits on bug\/first .*--allow-waiting/, stdout);
  assert.match(stdout, /waits on bug\/second .*--allow-waiting/, stdout);
  assert.match(stdout, /would dispatch feature\/dependent/, stdout);
});
