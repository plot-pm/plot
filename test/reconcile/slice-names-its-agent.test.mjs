// A SLICE NAMES THE AGENT IT NEEDS — the plan-declared selector, and the
// precedence between it and the flag.
//
// This is `a-slice-names-the-agent-it-needs`, the one slice of
// docs/plans/2026-09-15-a-slice-names-the-agent-it-needs.md. Its predecessor
// `a-charter-reaches-the-agent-it-declares` shipped `--agent <name>` in v2.18.0
// and an operator is the only thing that can type a flag: `plot-registryd` hands
// a queued slice to a free agent with no `--agent` anywhere in the path, so an
// unattended fleet ran every slice as the same undifferentiated worker.
//
// THE READING IS `PLOT_AGENT`, AND THAT IS THE POINT. Four readers ask
// `${PLOT_AGENT:-}` — `resolve_launch`, the capabilities block, the manifest and
// the export into the worker environment — so the whole feature is one
// assignment, and asserting on the variable asserts on all four. The chain from
// `PLOT_AGENT` to a built argv is `charter-reaches-launch.test.mjs`'s subject
// and is not re-tested here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const scripts = path.join(repoRoot, 'skills', 'plot', 'scripts');
const dispatch = path.join(scripts, 'plot-dispatch.sh');

const ctx = [];
after(() => { for (const t of ctx) fs.rmSync(t, { recursive: true, force: true }); });

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

/**
 * A repo holding one plan whose branch may declare a kind, and may hold a
 * charter of that name.
 *
 * `Worker command: none` so nothing is ever launched: these tests read a
 * VARIABLE, and a test that starts a detached agent to observe one is a test
 * that leaks processes — `dispatchwaits.test.mjs`'s rule, for its reason.
 */
function makeRepo({ agent = null, branch = 'feature/slice', charters = [], dialect = 'list' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-agentfield-'));
  ctx.push(tmp);
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n'
    + '- **Plan directory:** plans/\n'
    + '- **Worker command:** none\n');

  fs.mkdirSync(path.join(repo, 'plans'));
  // ONE DIALECT PER SECTION, NEVER BOTH. The parser decides a section's shape
  // from `(Branch:` in its first heading, so a fixture writing a `### ` heading
  // AND a list item has the heading win — the list line is not read at all, and
  // an annotation parked on it reads as absent. Measured while writing this
  // file: the first fixture did exactly that and four tests failed against a
  // parser that was correct.
  const note = agent === null ? '' : ` <!-- agent: ${agent} -->`;
  const body = dialect === 'heading'
    ? `## Slices\n\n### The slice (Branch: ${branch})${note}\n\nProse about the slice.\n`
    : `## Branches\n\n- \`${branch}\`${note} — the work.\n`;
  fs.writeFileSync(path.join(repo, 'plans', '2026-09-15-a-slice.md'),
    '# A slice\n\n## Status\n\n- **State:** Approved\n- **Type:** feature\n\n' + body);

  if (charters.length > 0) {
    fs.mkdirSync(path.join(repo, '.plot', 'charters'), { recursive: true });
    for (const name of charters) {
      fs.writeFileSync(path.join(repo, '.plot', 'charters', `${name}.json`),
        JSON.stringify({ name, model: 'opus' }, null, 2));
    }
  }

  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  return repo;
}

/**
 * Source the dispatcher's definitions, ask what the plan declares for a branch,
 * and report it.
 *
 * `PLOT_DISPATCH_SOURCED=1` takes the functions without running a dispatch —
 * `charter-reaches-launch.test.mjs`'s idiom, and the reason the guard sits below
 * both definitions in the file.
 */
const declaredFor = (repo, branch) => {
  const script = `
    cd ${JSON.stringify(repo)}
    PLOT_DISPATCH_SOURCED=1
    . "${dispatch}"
    if got=$(plan_declared_agent ${JSON.stringify(branch)}); then
      printf 'DECLARED=[%s]\\n' "$got"
    else
      printf 'DECLARED=<none>\\n'
    fi
  `;
  return execFileSync('bash', ['-c', script], { encoding: 'utf8', timeout: 60_000 });
};

/**
 * Run `start_worker` for a branch and report the `PLOT_AGENT` it resolved.
 *
 * THE VARIABLE IS READ AFTER THE CALL, not reconstructed. `start_worker` exits
 * early here — `Worker command: none` — which is AFTER the assignment this
 * slice added and BEFORE anything is launched, so the reading is the real one
 * and no process escapes.
 */
const agentAfterStart = (repo, branch, env = {}) => {
  const script = `
    cd ${JSON.stringify(repo)}
    PLOT_DISPATCH_SOURCED=1
    . "${dispatch}"
    repo_root=$(git rev-parse --show-toplevel)
    worker_cmd_declined=1
    start_worker ${JSON.stringify(branch)} ${JSON.stringify(repo)} || true
    printf 'AGENT=[%s]\\n' "\${PLOT_AGENT:-}"
  `;
  return execFileSync('bash', ['-c', script],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } });
};

// ---------------------------------------------------------------------------
// THE PLAN IS READ
// ---------------------------------------------------------------------------

test('a slice naming a kind reports it, read from the plan', () => {
  const repo = makeRepo({ agent: 'reviewer' });
  assert.match(declaredFor(repo, 'feature/slice'), /DECLARED=\[reviewer\]/);
});

test('a slice naming no kind reports nothing — the whole estate today', () => {
  // ABSENCE IS NOT AN ERROR, and it is the common answer: every plan on the
  // estate carries no annotation. The parser emits no key, so this reads
  // presence and returns 1 — never `""`, which would send the launch looking
  // for a charter called "".
  const repo = makeRepo({ agent: null });
  assert.match(declaredFor(repo, 'feature/slice'), /DECLARED=<none>/);
});

test('the heading dialect declares a kind the same way', () => {
  // BOTH DIALECTS REACH DISPATCH, not merely the parser. A plan written in the
  // `### <name> (Branch: x)` shape carries its annotation on the HEADING, since
  // the parser reads a section in one dialect and ignores the other's lines
  // entirely — so a lookup that worked for list items only would silently
  // decline every plan in the newer shape.
  const repo = makeRepo({ agent: 'reviewer', dialect: 'heading' });
  assert.match(declaredFor(repo, 'feature/slice'), /DECLARED=\[reviewer\]/);
});

test('a branch no plan names reports nothing rather than failing', () => {
  // `--restart` runs on a branch a person names, which may belong to no plan at
  // all. A lookup that errored there would turn an ordinary restart into a
  // refusal.
  const repo = makeRepo({ agent: 'reviewer' });
  assert.match(declaredFor(repo, 'feature/unrelated'), /DECLARED=<none>/);
});

test('the annotation binds to ONE branch, not to the plan', () => {
  // THE REASON A GREP CANNOT ANSWER THIS. Both branches live in one file and one
  // declares a kind; `grep agent:` over the plan would hand the same kind to
  // both. The parser knows which line it sat on.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-agent2-'));
  ctx.push(tmp);
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Worker command:** none\n');
  fs.mkdirSync(path.join(repo, 'plans'));
  fs.writeFileSync(path.join(repo, 'plans', '2026-09-15-two.md'),
    '# Two slices\n\n## Status\n\n- **State:** Approved\n- **Type:** feature\n\n'
    + '## Branches\n\n'
    + '- `feature/reviewed` <!-- agent: reviewer --> — read it.\n'
    + '- `feature/built` — build it.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');

  assert.match(declaredFor(repo, 'feature/reviewed'), /DECLARED=\[reviewer\]/);
  assert.match(declaredFor(repo, 'feature/built'), /DECLARED=<none>/,
    'the branch beside it declares nothing and must inherit nothing');
});

// ---------------------------------------------------------------------------
// THE PRECEDENCE
// ---------------------------------------------------------------------------

test('a dispatch of a slice naming `reviewer` selects it with no --agent', () => {
  // THE WHOLE POINT OF THE SLICE: no flag is typed and the charter is still
  // selected, which is the case an unattended fleet is always in.
  const repo = makeRepo({ agent: 'reviewer', charters: ['reviewer'] });
  const out = agentAfterStart(repo, 'feature/slice', { PLOT_AGENT: '' });
  assert.match(out, /AGENT=\[reviewer\]/, out);
  assert.match(out, /declares agent 'reviewer'/, out);
});

test('--agent on the command line overrides the field', () => {
  // A FLAG TYPED ON THIS RUN IS THE MORE SPECIFIC ANSWER than a field written
  // when the plan was drafted — the order `--agent` already applies to an
  // inherited `PLOT_AGENT`. The guard is `[ -z "${PLOT_AGENT:-}" ]`, so a set
  // variable stops the plan being read at all.
  const repo = makeRepo({ agent: 'reviewer', charters: ['reviewer', 'auditor'] });
  const out = agentAfterStart(repo, 'feature/slice', { PLOT_AGENT: 'auditor' });
  assert.match(out, /AGENT=\[auditor\]/, out);
  assert.doesNotMatch(out, /declares agent/,
    `an overridden field must not be reported as selected\n${out}`);
});

test('a slice naming no agent leaves PLOT_AGENT empty', () => {
  // THE BYTE-IDENTICAL CASE, and it is the whole estate: zero plans carry the
  // annotation, so every dispatch must still export nothing and reach the
  // repo's own `Worker command`. v2.18.0 established the property and this
  // slice must not weaken it.
  const repo = makeRepo({ agent: null });
  const out = agentAfterStart(repo, 'feature/slice', { PLOT_AGENT: '' });
  assert.match(out, /AGENT=\[\]/, out);
  assert.doesNotMatch(out, /declares agent/, out);
});

test('a free agent has no branch and reads no plan', () => {
  // `--start` calls `start_worker` with an EMPTY branch, which is the one call
  // site that cannot have a plan. It must not search for one.
  const repo = makeRepo({ agent: 'reviewer', charters: ['reviewer'] });
  const out = agentAfterStart(repo, '', { PLOT_AGENT: '' });
  assert.match(out, /AGENT=\[\]/, out);
});

// ---------------------------------------------------------------------------
// A MISSING CHARTER IS REPORTED, NEVER REFUSED
// ---------------------------------------------------------------------------

test('a named charter this clone lacks dispatches anyway and names what it looked for', () => {
  // A DELIBERATE ASYMMETRY. `resolve_launch` refuses a charter it cannot
  // BELIEVE and a harness not on PATH, and both stay. A charter that does not
  // EXIST is the adoption case — a plan written where `reviewer` is declared,
  // dispatched on a clone that declares nothing — and refusing it would make
  // that plan undispatchable on every such clone.
  const repo = makeRepo({ agent: 'reviewer', charters: [] });
  const out = agentAfterStart(repo, 'feature/slice', { PLOT_AGENT: '' });
  assert.match(out, /AGENT=\[reviewer\]/,
    `the kind still travels — the fallback is the LAUNCH, not the declaration\n${out}`);
  assert.match(out, /no charter answers to that name/, out);
  assert.match(out, /reviewer\.json/,
    `the run must name the path it looked at, not merely the name\n${out}`);
  assert.doesNotMatch(out, /refusing to start/,
    `a missing charter is reported and never refused\n${out}`);
});

test('a charter that IS present is not reported as missing', () => {
  const repo = makeRepo({ agent: 'reviewer', charters: ['reviewer'] });
  const out = agentAfterStart(repo, 'feature/slice', { PLOT_AGENT: '' });
  assert.doesNotMatch(out, /no charter answers/, out);
  assert.match(out, /its plan selected the charter/, out);
});
