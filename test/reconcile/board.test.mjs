// Contract test for skills/plot/scripts/plot-update-board.sh — the GitHub
// Projects board updater. The happy path needs a real board, so it is not
// what these tests pin. They pin everything around it, which is where the
// failure actually lived (#98: new implementation PRs never reached *Ready*
// and nothing failed loudly, because a board update that never happens is
// indistinguishable from a board nobody configured).
//
// Three properties, per the plan's Coverage section:
//   1. argument handling      — missing arguments exit 1; four arguments do not
//   2. graceful degradation   — every unreachable-board path exits 0 + warns
//   3. the caller-set assertion — each status has a caller somewhere in skills/
//
// `gh` is PATH-stubbed and every run happens inside a throwaway git repo, so
// the tests are fully offline and never touch the host repo's board cache.
//
// Assert per line, never with a whole-output regex: this suite has been fooled
// three times by patterns matching across report lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const updater = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-update-board.sh');
const skillsDir = path.join(repoRoot, 'skills');

const ARGS = ['https://example.test/pr/1', 'Ready', 'acme', '7'];

// A `gh` stub whose behaviour is scripted per subcommand. `fail` names the
// subcommands that should exit non-zero; everything else answers with canned
// JSON good enough for the step that consumes it. Each invocation appends its
// argv to a log, so tests can assert which steps were reached.
function sandbox({ fail = [], statusOptions = [{ name: 'Ready', id: 'opt-ready' }] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-board-'));
  const bin = path.join(dir, 'bin');
  const repo = path.join(dir, 'repo');
  const log = path.join(dir, 'gh.log');
  execSync(`mkdir -p ${JSON.stringify(bin)} ${JSON.stringify(repo)}`);
  execSync('git init -q -b main && git config user.email t@t && git config user.name t', {
    cwd: repo,
    stdio: 'pipe',
  });

  const fields = JSON.stringify({ fields: [{ name: 'Status', id: 'field-status', options: statusOptions }] });
  const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  writeFileSync(
    path.join(bin, 'gh'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      'sub="$2"',
      `for f in ${fail.map(quote).join(' ')}; do`,
      '  if [ "$sub" = "$f" ]; then echo "stub: $sub failed" >&2; exit 1; fi',
      'done',
      'case "$sub" in',
      "  view) printf '%s' 'project-node-id' ;;",
      "  item-add) printf '%s' 'item-node-id' ;;",
      `  field-list) printf '%s' ${quote(fields)} ;;`,
      '  *) : ;;',
      'esac',
    ].join('\n'),
  );
  chmodSync(path.join(bin, 'gh'), 0o755);
  return { dir, bin, repo, log };
}

// Runs the updater with only the stub dir on PATH plus the system essentials,
// so a real `gh` on the developer's machine can never be reached.
//
// Uses spawnSync rather than execFileSync: every degradation path exits 0 with
// a warning, and execFileSync only surfaces stderr on the throwing (non-zero)
// branch — the exact output these tests exist to pin would be discarded.
function run(args, sb, { cwd = sb.repo } = {}) {
  const r = spawnSync('bash', [updater, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${sb.bin}:/usr/bin:/bin` },
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const ghCalls = (sb) => (existsSync(sb.log) ? readFileSync(sb.log, 'utf8').trim().split('\n').filter(Boolean) : []);

// Per-line assertion helper: exactly one stderr line must match, so a pattern
// cannot accidentally span two lines of output.
function assertLine(stderr, re, message) {
  const hits = stderr.split('\n').filter((l) => re.test(l));
  assert.equal(hits.length, 1, `${message}\nexpected exactly one line matching ${re}, got:\n${stderr}`);
}

// --- 1. Argument handling ---------------------------------------------------

test('update-board: no arguments exit 1', () => {
  const sb = sandbox();
  const r = run([], sb);
  assert.equal(r.code, 1);
  assertLine(r.stderr, /Usage: plot-update-board\.sh/, 'usage message on stderr');
  assert.deepEqual(ghCalls(sb), [], 'must not reach gh before arguments are validated');
});

for (const n of [1, 2, 3]) {
  test(`update-board: ${n} argument(s) exit 1`, () => {
    const sb = sandbox();
    const r = run(ARGS.slice(0, n), sb);
    assert.equal(r.code, 1);
    assertLine(r.stderr, /Usage: plot-update-board\.sh/, 'usage message on stderr');
    assert.deepEqual(ghCalls(sb), [], 'must not reach gh before arguments are validated');
  });
}

test('update-board: an empty argument is missing, not present', () => {
  const sb = sandbox();
  const r = run(['https://example.test/pr/1', '', 'acme', '7'], sb);
  assert.equal(r.code, 1);
  assertLine(r.stderr, /Usage: plot-update-board\.sh/, 'usage message on stderr');
});

test('update-board: four arguments do not exit 1', () => {
  const sb = sandbox();
  const r = run(ARGS, sb);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '', 'a resolvable board warns about nothing');
});

test('update-board: four arguments drive the full gh sequence', () => {
  const sb = sandbox();
  run(ARGS, sb);
  const subs = ghCalls(sb).map((c) => c.split(' ')[1]);
  assert.deepEqual(subs, ['view', 'item-add', 'field-list', 'item-edit']);
});

test('update-board: the status argument selects the matching option id', () => {
  const sb = sandbox({
    statusOptions: [
      { name: 'Planning', id: 'opt-planning' },
      { name: 'Ready', id: 'opt-ready' },
      { name: 'Done', id: 'opt-done' },
    ],
  });
  run(['https://example.test/pr/1', 'Done', 'acme', '7'], sb);
  const edit = ghCalls(sb).find((c) => c.split(' ')[1] === 'item-edit');
  assert.ok(edit, 'item-edit was reached');
  assert.match(edit, /--single-select-option-id opt-done\b/);
});

// --- 2. Graceful degradation ------------------------------------------------
//
// The load-bearing behaviour: the script is called from skills that must not
// fail when no board is configured. Every one of these paths exits 0.

test('update-board: unresolvable project exits 0 with a warning', () => {
  const sb = sandbox({ fail: ['view'] });
  const r = run(ARGS, sb);
  assert.equal(r.code, 0);
  assertLine(r.stderr, /^Warning: Could not resolve project acme\/7\b/, 'warns about the project');
  assert.equal(r.stdout, '', 'warnings go to stderr, never stdout');
});

test('update-board: unresolvable project stops before touching the board', () => {
  const sb = sandbox({ fail: ['view'] });
  run(ARGS, sb);
  const subs = ghCalls(sb).map((c) => c.split(' ')[1]);
  assert.deepEqual(subs, ['view'], 'no item-add after the project failed to resolve');
});

test('update-board: failed item-add exits 0 with a warning', () => {
  const sb = sandbox({ fail: ['item-add'] });
  const r = run(ARGS, sb);
  assert.equal(r.code, 0);
  assertLine(
    r.stderr,
    /^Warning: Could not add https:\/\/example\.test\/pr\/1 to project acme\/7$/,
    'warns about the PR it could not add',
  );
});

test('update-board: failed field-list exits 0 with a warning', () => {
  const sb = sandbox({ fail: ['field-list'] });
  const r = run(ARGS, sb);
  assert.equal(r.code, 0);
  assertLine(r.stderr, /^Warning: Could not list fields for project acme\/7$/, 'warns about the field list');
});

test('update-board: a project without a Status field exits 0 with a warning', () => {
  const sb = sandbox();
  // Rewrite the stub's field-list answer to a board that has no Status field.
  const gh = path.join(sb.bin, 'gh');
  writeFileSync(gh, readFileSync(gh, 'utf8').replace(/"name":"Status"/, '"name":"Iteration"'));
  const r = run(ARGS, sb);
  assert.equal(r.code, 0);
  assertLine(r.stderr, /^Warning: No Status field found in project acme\/7$/, 'warns about the missing field');
});

test('update-board: an unknown status option exits 0 with a warning', () => {
  const sb = sandbox({ statusOptions: [{ name: 'Backlog', id: 'opt-backlog' }] });
  const r = run(ARGS, sb);
  assert.equal(r.code, 0);
  assertLine(
    r.stderr,
    /^Warning: Status option 'Ready' not found in project acme\/7$/,
    'warns about the unknown status',
  );
});

test('update-board: a failing item-edit exits 0 with a warning', () => {
  const sb = sandbox({ fail: ['item-edit'] });
  const r = run(ARGS, sb);
  assert.equal(r.code, 0);
  assertLine(
    r.stderr,
    /^Warning: Could not set status 'Ready' for https:\/\/example\.test\/pr\/1$/,
    'warns about the status it could not set',
  );
});

test('update-board: a missing gh exits 0 rather than killing its caller', () => {
  const sb = sandbox();
  execSync(`rm ${JSON.stringify(path.join(sb.bin, 'gh'))}`);
  const r = run(ARGS, sb);
  assert.equal(r.code, 0, 'no gh on PATH is the unconfigured case, not an error');
  assertLine(r.stderr, /^Warning: Could not resolve project acme\/7\b/, 'warns about the project');
});

test('update-board: degrades the same way outside a git repo', () => {
  const sb = sandbox({ fail: ['view'] });
  const r = run(ARGS, sb, { cwd: sb.dir });
  assert.equal(r.code, 0);
  assertLine(r.stderr, /^Warning: Could not resolve project acme\/7\b/, 'warns about the project');
});

test('update-board: caches project metadata inside the git dir, not the worktree', () => {
  const sb = sandbox();
  run(ARGS, sb);
  const cache = path.join(sb.repo, '.git', 'plot-board-cache-acme-7.json');
  assert.ok(existsSync(cache), 'cache written under .git/');
  assert.deepEqual(JSON.parse(readFileSync(cache, 'utf8')).fieldId, 'field-status');
  assert.deepEqual(
    readdirSync(sb.repo).filter((f) => f !== '.git'),
    [],
    'nothing is written into the working tree',
  );
});

test('update-board: a cached project skips the resolve and field-list calls', () => {
  const sb = sandbox();
  run(ARGS, sb);
  execSync(`rm ${JSON.stringify(sb.log)}`);
  run(ARGS, sb);
  const subs = ghCalls(sb).map((c) => c.split(' ')[1]);
  assert.deepEqual(subs, ['item-add', 'item-edit'], 'second run reuses the cache');
});

// --- 3. The caller-set assertion --------------------------------------------
//
// This is a test about skills, not about the script. The defect behind #98 was
// never in plot-update-board.sh — it was in nobody calling it for *Ready*.
//
// It asserts the status *set*, not skill-to-status pairs. Pairing
// plot-approve → Ready would be stricter, but Plot 2 moved branch creation
// from /plot-approve to /plot-implement: a pair-based test would have gone red
// for that legitimate move while staying silent about the transition actually
// disappearing. A set-based assertion survives renames and reorganisation and
// still fails the moment a status has no caller at all.

// Every status argument passed to plot-update-board.sh anywhere under skills/,
// as a list of {file, status}. Statuses are read from the invocation's second
// argument, in whatever quoting the skill happens to use.
function callerInvocations() {
  const grep = execFileSync(
    'grep',
    ['-rn', '--include=*.md', 'plot-update-board\\.sh', skillsDir],
    { encoding: 'utf8' },
  );
  const found = [];
  for (const line of grep.split('\n')) {
    if (!line.trim()) continue;
    const [file, , ...rest] = line.split(':');
    const text = rest.join(':');
    // <script> <pr-url> <status> <owner> <number> — the status is argument 2.
    const m = text.match(/plot-update-board\.sh\s+\S+\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
    if (!m) continue;
    const status = m[1] ?? m[2] ?? m[3];
    // Skip the script's own usage string and any placeholder-only reference.
    if (status.startsWith('<')) continue;
    found.push({ file: path.relative(repoRoot, file), status });
  }
  return found;
}

for (const status of ['Planning', 'Ready', 'Done']) {
  test(`update-board: status '${status}' has at least one caller under skills/`, () => {
    const callers = callerInvocations().filter((c) => c.status === status);
    assert.ok(
      callers.length > 0,
      `no skill invokes plot-update-board.sh with '${status}'.\n` +
        `Found instead:\n${callerInvocations().map((c) => `  ${c.file}: ${c.status}`).join('\n')}`,
    );
  });
}

test('update-board: the caller scan actually finds invocations', () => {
  // Guards the three tests above against passing vacuously if the grep, the
  // argument shape, or the skills layout ever changes underneath them.
  assert.ok(callerInvocations().length >= 3, 'the caller scan found invocations to classify');
});

// --- Portability -------------------------------------------------------------

test('update-board: uses no bash-4-only constructs (macOS ships bash 3.2)', () => {
  const src = readFileSync(updater, 'utf8');
  const banned = [
    [/\bdeclare\s+-A\b/, 'declare -A (associative arrays)'],
    [/\blocal\s+-A\b/, 'local -A (associative arrays)'],
    [/\bmapfile\b/, 'mapfile'],
    [/\breadarray\b/, 'readarray'],
    [/\$\{[A-Za-z_][A-Za-z0-9_]*\^\^?\}/, '${var^^} (bash 4 case conversion)'],
    [/\$\{[A-Za-z_][A-Za-z0-9_]*,,?\}/, '${var,,} (bash 4 case conversion)'],
    [/&>>/, '&>> (bash 4 append redirect)'],
  ];
  for (const [re, what] of banned) {
    assert.equal(re.test(src), false, `plot-update-board.sh uses ${what}, unavailable in bash 3.2`);
  }
});
