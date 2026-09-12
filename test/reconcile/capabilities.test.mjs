// A CHARTER BOUNDS WHAT AN AGENT MAY TOUCH — `capabilities`, from the charter
// to the harness's own flag.
//
// This is `a-charter-bounds-what-an-agent-may-touch`, the only slice of
// docs/plans/2026-09-12-a-charter-bounds-what-an-agent-may-touch.md. Measured
// that day: `CharterSchema` carried `capabilities` with its interface field,
// its TSDoc and its `.strict()` refusal all in place, and `grep -rn
// PLOT_CAPABILITIES` over the scripts and templates returned NOTHING. The field
// was declared and no reader existed.
//
// THE FAILURE IT FIXES IS A REVIEWER THAT EDITS WHAT IT REVIEWS. Every
// differentiation Plot could express before this was PROSE, and CLAUDE.md's own
// test settles what prose makes it: *can you answer "did I complete this?"
// without doing the work?* An agent asked in prose not to edit can answer yes
// without it being true.
//
// THREE SUBJECTS, BECAUSE THE SLICE HAS THREE PARTS: the export, the shipped
// template's handling of it, and the warning an agent gets when its charter
// declares a capability the prompt ignores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const scripts = path.join(repoRoot, 'skills', 'plot', 'scripts');
const bundle = path.join(scripts, 'board', 'plot-prompt.mjs');
const template = path.join(repoRoot, 'skills', 'plot', 'templates', 'worker-prompt.sh');

/** A repo root holding charters in each of the four readings. */
const sandbox = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-caps-'));
  fs.mkdirSync(path.join(root, '.plot', 'charters'), { recursive: true });
  const charter = (name, body) =>
    fs.writeFileSync(path.join(root, '.plot', 'charters', `${name}.json`),
      typeof body === 'string' ? body : JSON.stringify(body));
  charter('reviewer', { name: 'reviewer', prompt: 'p.sh', capabilities: ['read-only'] });
  charter('two', { name: 'two', prompt: 'p.sh', capabilities: ['read-only', 'no-network'] });
  charter('plain', { name: 'plain', prompt: 'p.sh' });
  charter('typo', { name: 'x', prompt: 'p', modle: 'opus' });
  charter('broken', 'not json {');
  charter('runfact', { name: 'x', prompt: 'p', pid: '4242' });
  return root;
};

/** Ask the bundle what an agent may do; never throws, so the code is readable. */
const ask = (root, agent) => {
  try {
    const out = execFileSync('node', [bundle, '--capabilities', root, agent],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
};

// ---------------------------------------------------------------------------
// THE READING
// ---------------------------------------------------------------------------

test('capabilities: a declared list is printed, one name per line', () => {
  const r = sandbox();
  const got = ask(r, 'two');
  assert.equal(got.code, 0, got.err);
  assert.deepEqual(got.out.split('\n').filter(Boolean), ['read-only', 'no-network']);
});

test('capabilities: an agent naming no capabilities prints nothing and does not fault', () => {
  // ABSENT IS NOT FALSE. A charter naming no capabilities is UNSTATED — not
  // "deny nothing" expressed as a decision — so it prints nothing and exits 0.
  const r = sandbox();
  const got = ask(r, 'plain');
  assert.equal(got.code, 0, got.err);
  assert.equal(got.out, '');
});

test('capabilities: no charter on this clone prints nothing — the estate today', () => {
  const r = sandbox();
  const got = ask(r, 'nobody-declared-this');
  assert.equal(got.code, 0, got.err);
  assert.equal(got.out, '');
});

test('capabilities: nothing named an agent prints nothing', () => {
  const r = sandbox();
  const got = ask(r, '');
  assert.equal(got.code, 0, got.err);
  assert.equal(got.out, '');
});

// READ THE EXIT CODE, NOT THE EMPTINESS. Three readings above print nothing and
// none of them is a fault; these three also print nothing on stdout and every
// one is. A caller testing `[ -z "$caps" ]` cannot tell them apart, which is why
// the bundle exits 3 and the dispatcher reads `$?`.
for (const [agent, why] of [
  ['broken', /not JSON/],
  ['typo', /modle|Unrecognized|unknown/i],
  ['runfact', /run facts/],
]) {
  test(`capabilities: an unreadable charter (${agent}) refuses rather than answering empty`, () => {
    const r = sandbox();
    const got = ask(r, agent);
    assert.equal(got.code, 3, `an unbelievable charter must exit 3, got ${got.code}`);
    assert.match(got.err, why);
    // THE REASON NEVER REACHES STDOUT. A caller reads stdout into a list and
    // splits on newlines; a reason printed there becomes a capability NAME and
    // is passed to the harness as one.
    assert.equal(got.out, '', 'the refusal is stderr — stdout is the list, and only the list');
  });
}

test('capabilities: the default prompt line is unchanged by the new subcommand', () => {
  // `plot-worker-loop.sh` parses that line POSITIONALLY, and its last field is
  // `${rest#*\t}` — the whole tail. A fourth field would land inside the agent
  // name it prints, so the second question is a subcommand rather than a column.
  const r = sandbox();
  const out = execFileSync('node', [bundle, r, 'reviewer'], { encoding: 'utf8' });
  assert.equal(out, 'declared\tp.sh\treviewer\n');
});

// ---------------------------------------------------------------------------
// THE EXPORT
// ---------------------------------------------------------------------------

/**
 * Launch a worker whose `Worker command` records its own environment, and
 * report what it saw.
 *
 * The subject is the REAL launch path: `--restart` is the only caller of
 * `start_worker`, and the export must survive the env prefix, the `nohup`, and
 * the single-quoted `sh -c` wrapper between here and the command.
 */
const launched = (agent, charterBody) => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-capexport-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  const git = (cwd, ...a) => execFileSync('git', a, { encoding: 'utf8', cwd });
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');

  const seen = path.join(t, 'seen');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + `- **Worker command:** sh -c 'if [ -n "\${PLOT_CAPABILITIES+set}" ]; then printf "SET:%s" "$PLOT_CAPABILITIES" > ${seen}; else printf UNSET > ${seen}; fi'\n`);
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-c.md'),
    '# C\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n## Branches\n\n- `feature/caps` — one\n');
  fs.symlinkSync('../2026-01-01-c.md', path.join(r, 'plans', 'active', 'c.md'));
  fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(r, '.plot', 'briefs', 'caps.md'), 'spec\n');
  if (charterBody !== null) {
    fs.mkdirSync(path.join(r, '.plot', 'charters'), { recursive: true });
    fs.writeFileSync(path.join(r, '.plot', 'charters', `${agent}.json`),
      JSON.stringify(charterBody));
  }
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  const wt = path.join(t, 'wt-caps');
  git(r, 'worktree', 'add', '-q', '-b', 'feature/caps', wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', 'plot: claim');
  git(wt, 'push', '-qu', 'origin', 'feature/caps');

  const dispatch = path.join(scripts, 'plot-dispatch.sh');
  const env = { ...process.env };
  delete env.PLOT_AGENT;
  if (agent !== null) env.PLOT_AGENT = agent;
  let out = '';
  try {
    out = execFileSync('bash', [dispatch, '--offline', '--restart', 'feature/caps'],
      { encoding: 'utf8', cwd: r, timeout: 60_000, env });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !fs.existsSync(seen)) execFileSync('sleep', ['0.2']);
  const recorded = fs.existsSync(seen) ? fs.readFileSync(seen, 'utf8') : null;
  return { out, recorded, cleanup: () => fs.rmSync(t, { recursive: true, force: true }) };
};

test('export: a declared capability reaches the worker command', () => {
  const got = launched('reviewer', { name: 'reviewer', prompt: 'p.sh', capabilities: ['read-only'] });
  try {
    assert.equal(got.recorded, 'SET:read-only',
      `the launched command must see the list\ndispatch said:\n${got.out}`);
  } finally { got.cleanup(); }
});

test('export: an agent with NO charter exports nothing at all — not an empty string', () => {
  // THE ASSERTION THE PLAN ASKS FOR BY NAME. An implementation that always
  // exports the variable makes every prompt file's `[ -n "$PLOT_CAPABILITIES" ]`
  // probe meaningless, and "nothing on the estate changes until a charter
  // exists" stops holding. `${VAR+set}` is what tells unset from empty.
  const got = launched(null, null);
  try {
    assert.equal(got.recorded, 'UNSET',
      `no charter must mean no variable\ndispatch said:\n${got.out}`);
  } finally { got.cleanup(); }
});

test('export: a charter naming no capabilities exports nothing at all', () => {
  // The same assertion one reading over: `capabilities: []` is UNSTATED, and an
  // empty export would read to the prompt file as a bound that names no tools.
  const got = launched('plain', { name: 'plain', prompt: 'p.sh' });
  try {
    assert.equal(got.recorded, 'UNSET',
      `an empty list must mean no variable\ndispatch said:\n${got.out}`);
  } finally { got.cleanup(); }
});

test('export: an unreadable charter refuses the launch rather than running unbounded', () => {
  // A REFUSAL IS NOT A FALLBACK, `resolve_prompt_file`'s rule carried over. The
  // fallback would RUN — successfully — under a scope nobody asked for.
  const got = launched('typo', { name: 'x', prompt: 'p', modle: 'opus' });
  try {
    assert.equal(got.recorded, null, 'no worker may start on a charter that cannot be read');
    assert.match(got.out, /refusing to start/, got.out);
    assert.match(got.out, /charter/i, got.out);
  } finally { got.cleanup(); }
});

// ---------------------------------------------------------------------------
// THE TEMPLATE, AND THE WARNING
// ---------------------------------------------------------------------------

/**
 * Source the template with `claude` shimmed onto PATH, and report what it built.
 *
 * The idiom is `session-id.test.mjs`'s, for its reason: a test that rebuilt the
 * command here would pass while the file a worker sources stayed wrong.
 */
const argv = (capabilities) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-captmpl-'));
  const seen = path.join(dir, 'argv');
  try {
    fs.writeFileSync(path.join(dir, 'claude'),
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > ${JSON.stringify(seen)}\n`);
    fs.chmodSync(path.join(dir, 'claude'), 0o755);
    const env = {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      PLOT_BRANCH: 'feature/x',
      PLOT_WORKTREE: dir,
    };
    // A dispatched worker runs this suite, so its OWN variables are in the
    // environment; deleting them is what makes the absent cases observable.
    delete env.PLOT_SESSION_ID;
    delete env.PLOT_SESSION_FLAG;
    delete env.PLOT_CAPABILITIES;
    if (capabilities !== null) env.PLOT_CAPABILITIES = capabilities;
    const err = path.join(dir, 'err');
    execFileSync('bash', ['-c', `set -uo pipefail; . "$1" 2>${JSON.stringify(err)}`, '_', template],
      { encoding: 'utf8', env, timeout: 30_000 });
    return {
      argv: fs.readFileSync(seen, 'utf8').split('\n').filter((l) => l !== ''),
      err: fs.existsSync(err) ? fs.readFileSync(err, 'utf8') : '',
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('template: no capabilities passes no tool flag at all', () => {
  // Today's estate, and it must stay byte-identical: nothing changes until a
  // charter exists.
  const got = argv(null);
  assert.equal(got.argv.includes('--disallowedTools'), false,
    `an unbounded agent gets no flag\n${got.argv.join(' ')}`);
  assert.equal(got.argv.includes(''), false,
    'and no stray empty argument — bash 3.2 expands an empty array to one');
  assert.deepEqual(got.argv.slice(-2), ['--permission-mode', 'bypassPermissions'],
    'the permission mode still arrives last');
});

test('template: a mapped capability becomes a deny flag', () => {
  const got = argv('read-only');
  const at = got.argv.indexOf('--disallowedTools');
  assert.notEqual(at, -1, `the mapped capability must reach claude\n${got.argv.join(' ')}`);
  assert.ok(got.argv[at + 1]?.length > 0, 'and carries the tools it denies');
});

test('template: the deny form is used, never the allow form', () => {
  // MEASURED 2026-09-12, and this is the assertion that pins it.
  // `--allowedTools` does not REMOVE a tool — it shapes permission to call one,
  // and the last line of the template grants that permission anyway. An
  // allow-list here would ship a gate that does not gate.
  const got = argv('read-only');
  assert.equal(got.argv.includes('--allowedTools'), false,
    `--allowedTools cannot bound an agent under bypassPermissions\n${got.argv.join(' ')}`);
});

test('template: the example mapping denies code execution, not just Write and Edit', () => {
  // THE MEASURED HOLE. With `Write`, `Edit`, `Bash` and `NotebookEdit` all
  // denied under bypassPermissions, a sandbox agent overwrote the target file
  // anyway — through an MCP plugin's Python REPL, reporting that `open(p, 'w')`
  // is a filesystem write like any other. Disabling a named write tool removes
  // one interface to the filesystem; it does not remove the filesystem.
  //
  // A test asserting only that `Write` is absent passes on an unsound bound,
  // which is why this asserts on the execution surface.
  const got = argv('read-only');
  const at = got.argv.indexOf('--disallowedTools');
  const denied = (got.argv[at + 1] ?? '').split(/[\s,]+/).filter(Boolean);
  for (const tool of ['Write', 'Edit']) {
    assert.ok(denied.includes(tool), `the example must deny ${tool}\ngot: ${denied.join(' ')}`);
  }
  // A shell is code execution wearing its own name, and a subagent is a second
  // agent that inherits none of this bound.
  assert.ok(denied.includes('Bash'), `the example must deny a shell\ngot: ${denied.join(' ')}`);
  assert.ok(denied.some((t) => /^(Agent|Task|Workflow)$/.test(t)),
    `the example must deny delegation — a subagent inherits no bound\ngot: ${denied.join(' ')}`);
});

test('template: says what the bound does NOT cover', () => {
  // NO SCOPE IS NOT A SILENT SCOPE, one field over. If covering every tool that
  // executes code is not expressible in one flag, the template says so rather
  // than reading stronger than it is — a bound that looks total and is not is
  // worse than a bound that names its own edge.
  const t = fs.readFileSync(template, 'utf8');
  assert.match(t, /MCP|plugin|executes? code|code execution/i,
    'the template must name the surface a tool-name deny-list cannot reach');
});

test('warning: a capability the prompt does not map is named on stderr', () => {
  // THE SLICE'S THIRD DELIVERABLE, and the one with no natural test: an
  // implementation that exports the variable and stops is indistinguishable
  // from a complete one until a reviewer silently runs unbounded.
  const got = argv('no-network');
  assert.match(got.err, /no-network/,
    `an unmapped capability must be named\nstderr was: ${got.err}`);
  assert.match(got.err, /unbounded/i,
    `and must say what it costs\nstderr was: ${got.err}`);
  // It WARNS and still launches: Plot invents no fallback scope, because a
  // scope nobody wrote is a scope nobody agreed to.
  assert.deepEqual(got.argv.slice(-2), ['--permission-mode', 'bypassPermissions'],
    'the run proceeds — the warning is a report, not a refusal');
});

test('warning: a mapped capability warns about nothing', () => {
  const got = argv('read-only');
  assert.doesNotMatch(got.err, /no mapping/,
    `a mapped capability is silent\nstderr was: ${got.err}`);
});

test('template: is a sourceable bash file, under both bash versions', () => {
  execFileSync('bash', ['-n', template]);
  if (fs.existsSync('/bin/bash')) execFileSync('/bin/bash', ['-n', template]);
});

// ---------------------------------------------------------------------------
// THE SCOPE GUARD
// ---------------------------------------------------------------------------

test('matchQueue is untouched — this slice bounds an agent and does not route to one', () => {
  // Catches scope creep into the assignment lock. `matchQueue` is *"the
  // assignment lock and there is only one"* — one slice to one agent, never the
  // same slice twice, held by the shape of the pass rather than a check it could
  // forget. Making a slice ASK for a capability is a second feature.
  const queue = path.join(repoRoot, 'packages', 'domain', 'src', 'rules', 'queue.ts');
  if (!fs.existsSync(queue)) return; // the rule moved; the guard is the diff below
  const src = fs.readFileSync(queue, 'utf8');
  assert.doesNotMatch(src, /capabilit/i,
    'matchQueue must not learn about capabilities — routing is a separate feature');
});
