// A CHARTER REACHES THE AGENT IT DECLARES — the selector, the interpolation,
// and the probe that makes the chain observable.
//
// This is `a-charter-reaches-the-agent-it-declares`, the one slice of
// docs/plans/2026-09-14-a-charter-reaches-the-agent-it-declares.md. Measured
// that day: the charter mechanism had 16 readers for `harness`, 14 each for
// `model` and `effort`, and the estate held ZERO charters — nothing selected
// one, and the shipped prompt template named `PLOT_HARNESS`, `PLOT_MODEL` and
// `PLOT_EFFORT` zero times.
//
// THE THIRD LAYER IS THE ONE THESE TESTS EXIST FOR. A charter declared before
// this slice exported three variables into a prompt file that read none of
// them, so the agent launched exactly as before — and silently, because Plot
// never composes the command line and nothing downstream can report that a
// declaration was dropped. A test asserting the charter file's CONTENTS would
// pass against exactly that failure, which is why every assertion below reads
// the printed argv.
//
// AN UNMAPPED CAPABILITY RUNS UNBOUNDED, by the template's own design
// (`worker-prompt.sh`: "the agent runs UNBOUNDED for it"). So a capability that
// silently failed to apply looks identical to one that applied, and only the
// deny flag on the command line tells them apart.
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
const dispatch = path.join(scripts, 'plot-dispatch.sh');
const template = path.join(repoRoot, 'skills', 'plot', 'templates', 'worker-prompt.sh');
const localPrompt = path.join(repoRoot, '.plot', 'worker-prompt.sh');

/**
 * Source a prompt file with the probe on, and report the argv it built.
 *
 * THE PROBE IS THE READING AND A RECONSTRUCTION WOULD NOT BE. `.plot/worker-prompt.sh`
 * is sourced, so what comes back is what the file itself assembled; a test that
 * rebuilt the command line here would pass while the file a worker sources
 * stayed wrong — `capabilities.test.mjs`'s idiom, for its reason.
 *
 * THE HARNESS IS SHIMMED EVEN THOUGH THE PROBE EXITS BEFORE IT, and that is a
 * MEASUREMENT rather than a belt-and-braces habit. Run against a prompt file
 * with no probe block — which is every prompt file before this slice — the
 * source falls THROUGH to the invocation. On a machine with the real CLI on
 * PATH that launches an agent and the assertion waits 30 s for a timeout; on a
 * machine without it the command is not found, the captured output is empty,
 * and `includes('--model') === false` reads as "no flag was passed", which is
 * what the empty-declaration tests assert. Measured 2026-09-14 against the
 * pre-slice files: three tests hung and five passed for exactly that wrong
 * reason.
 *
 * So every harness name a case can reach is shimmed to a recorder, and a
 * fall-through is DETECTED — the recorder writes a file the probe never writes,
 * and `argv` refuses rather than returning a plausible empty list.
 */
const argv = (file, vars) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-probe-'));
  try {
    const launched = path.join(dir, 'launched');
    // Every harness a case below can name. A file that reaches its invocation
    // records the fact instead of running anything.
    for (const name of ['claude', 'some-other-harness']) {
      fs.writeFileSync(path.join(dir, name),
        `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > ${JSON.stringify(launched)}\n`);
      fs.chmodSync(path.join(dir, name), 0o755);
    }
    const env = {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      PLOT_BRANCH: 'feature/x',
      PLOT_WORKTREE: dir,
      PLOT_PRINT_INVOCATION: '1',
    };
    // A dispatched worker runs this suite, so its OWN launch variables are in
    // the environment; deleting them is what makes the absent cases observable.
    for (const v of ['PLOT_HARNESS', 'PLOT_MODEL', 'PLOT_EFFORT', 'PLOT_CAPABILITIES',
      'PLOT_SESSION_ID', 'PLOT_SESSION_FLAG']) delete env[v];
    Object.assign(env, vars);
    const out = execFileSync('bash', ['-c', 'set -uo pipefail; . "$1"', '_', file],
      { encoding: 'utf8', env, timeout: 30_000 });
    assert.equal(fs.existsSync(launched), false,
      `${file} reached its invocation under PLOT_PRINT_INVOCATION=1 — the probe is `
      + 'absent or sits below the launch, and every argv assertion here would be '
      + 'reading an empty list rather than a built command line');
    return out.split('\n').filter((l) => l !== '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------
// THE PROMPT FILE HONOURS WHAT A CHARTER DECLARES
// ---------------------------------------------------------------------------

for (const [label, file] of [['template', template], ["this repo's file", localPrompt]]) {
  test(`${label}: a declared model and effort reach the argv`, () => {
    const got = argv(file, { PLOT_MODEL: 'opus', PLOT_EFFORT: 'high' });
    const at = got.indexOf('--model');
    assert.notEqual(at, -1, `the declared model must reach the command\n${got.join(' ')}`);
    assert.equal(got[at + 1], 'opus', `and carry its value\n${got.join(' ')}`);
    const eat = got.findIndex((a) => /^--(reasoning-)?effort$/.test(a));
    assert.notEqual(eat, -1, `the declared effort must reach the command\n${got.join(' ')}`);
    assert.equal(got[eat + 1], 'high', `and carry its value\n${got.join(' ')}`);
  });

  test(`${label}: a declared harness becomes the command`, () => {
    // THE HARNESS IS THE COMMAND, not a flag: a charter names what runs, and a
    // file that passed it as an argument would run the repo default and hand it
    // the harness name as a word.
    const got = argv(file, { PLOT_HARNESS: 'some-other-harness' });
    assert.equal(got[0], 'some-other-harness',
      `the declared harness must be what runs\n${got.join(' ')}`);
  });

  test(`${label}: an EMPTY declaration passes no flag at all`, () => {
    // THE CASE THE `[ -n ... ]` GUARDS EXIST FOR, and it is the whole estate.
    // `plot-dispatch.sh` exports these three UNCONDITIONALLY, so a charter-less
    // dispatch hands this file three variables that are SET AND EMPTY. A
    // `${VAR+set}` test would be true for all three and would pass `--model ""`
    // on every dispatch — a malformed argument rather than a missing one.
    const got = argv(file, { PLOT_HARNESS: '', PLOT_MODEL: '', PLOT_EFFORT: '' });
    assert.equal(got.includes('--model'), false,
      `an unstated model passes no flag\n${got.join(' ')}`);
    assert.equal(got.some((a) => /^--(reasoning-)?effort$/.test(a)), false,
      `an unstated effort passes no flag\n${got.join(' ')}`);
    assert.equal(got.includes(''), false,
      'and no stray empty argument — bash 3.2 expands an empty array to one');
    assert.equal(got[0], 'claude',
      `an unnamed harness is not an unrunnable one\n${got.join(' ')}`);
  });

  test(`${label}: an UNSET declaration passes no flag either`, () => {
    // The same assertion for a caller that is not dispatch — a hand run, or a
    // loop older than the export. Absent and empty must behave alike.
    const got = argv(file, {});
    assert.equal(got.includes('--model'), false, got.join(' '));
    assert.equal(got.some((a) => /^--(reasoning-)?effort$/.test(a)), false, got.join(' '));
    assert.equal(got[0], 'claude', got.join(' '));
  });

  test(`${label}: the probe prints and launches nothing`, () => {
    // IT IS A PROBE AND NOT A LAUNCH — `argv` asserts the invocation was never
    // reached, which is the half that makes every other case here honest.
    // What this adds is that the probe prints the FLAGS and not the prompt: a
    // probe echoing the whole command line would make each assertion below
    // carry 1500 characters of prose and would break on any wording change.
    const got = argv(file, { PLOT_MODEL: 'opus' });
    assert.ok(got.length > 0, 'the probe must print something');
    assert.equal(got.includes('-p'), false,
      `the probe must not print the prompt body it would have passed\n${got.join(' ')}`);
    assert.equal(got.includes('--permission-mode'), false,
      `nor the flags that follow it\n${got.join(' ')}`);
  });
}

// ---------------------------------------------------------------------------
// NOTHING CHANGES UNTIL A CHARTER EXISTS
// ---------------------------------------------------------------------------

test('a charter-less launch is byte-identical to one with no charter support at all', () => {
  // THE PROPERTY `plot-dispatch.sh` PROMISES BY NAME: "the command line is
  // byte-identical to what it was — which is the 100% case, since zero charters
  // exist". It is asserted by running the file as it stands against the same
  // file with every launch variable absent, through a `claude` shim that
  // records the WHOLE argv — the prompt body included, since that is what
  // "byte-identical" has to mean.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ident-'));
  try {
    const seen = path.join(dir, 'argv');
    fs.writeFileSync(path.join(dir, 'claude'),
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > ${JSON.stringify(seen)}\n`);
    fs.chmodSync(path.join(dir, 'claude'), 0o755);
    const run = (vars) => {
      const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        PLOT_BRANCH: 'feature/x', PLOT_WORKTREE: dir };
      for (const v of ['PLOT_HARNESS', 'PLOT_MODEL', 'PLOT_EFFORT', 'PLOT_CAPABILITIES',
        'PLOT_PRINT_INVOCATION', 'PLOT_SESSION_ID', 'PLOT_SESSION_FLAG']) delete env[v];
      Object.assign(env, vars);
      execFileSync('bash', ['-c', 'set -uo pipefail; . "$1"', '_', localPrompt],
        { encoding: 'utf8', env, timeout: 30_000 });
      return fs.readFileSync(seen, 'utf8');
    };
    const unset = run({});
    const empty = run({ PLOT_HARNESS: '', PLOT_MODEL: '', PLOT_EFFORT: '' });
    assert.equal(empty, unset,
      'a dispatch exporting three empty strings must build the argv a hand run builds');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// THIS REPOSITORY'S FILE IS THE TEMPLATE, BUT FOR ITS OWN PROMPT
// ---------------------------------------------------------------------------

test("this repo's prompt file matches the template but for its prompt text", () => {
  // MEASURED 2026-09-14: the local file was 52 lines against the template's
  // 113 and carried no capability block at all — its invocation predated the
  // capability work entirely. It fell that far behind because it was patched in
  // place, and `plot-install-prompt.sh --check` cannot report it: that script
  // classifies by what a file PASSES rather than by comparing it to the
  // template, which is correct for its own purpose and leaves this gap
  // unreported.
  //
  // THE ASSERTION ELIDES THE PROMPT BODY FROM BOTH SIDES rather than diffing
  // raw text. A raw diff says the files differ and says nothing about how; this
  // says the difference is EXACTLY the licensed one.
  const elide = (s) => s.replace(/-p ".*?" \$\{session_args/s, '-p "<PROMPT>" ${session_args');
  const t = fs.readFileSync(template, 'utf8').split('\n');
  const l = fs.readFileSync(localPrompt, 'utf8').split('\n');
  assert.equal(l.length, t.length,
    `the local file must be a template instance, not a patched ancestor\n`
    + `template ${t.length} lines, local ${l.length}`);
  const differing = t.map((line, i) => (line === l[i] ? -1 : i)).filter((i) => i !== -1);
  for (const i of differing) {
    assert.equal(elide(l[i]), elide(t[i]),
      `line ${i + 1} differs from the template by more than its prompt text:\n`
      + `template: ${t[i].slice(0, 200)}\nlocal:    ${l[i].slice(0, 200)}`);
  }
  // AND THE PROJECT'S OWN WORDING SURVIVED. The reinstall's whole risk is
  // overwriting it with the template's.
  assert.match(fs.readFileSync(localPrompt, 'utf8'), /pnpm build:board/,
    "the project's own prompt text must survive the reinstall");
});

// ---------------------------------------------------------------------------
// THE SELECTOR
// ---------------------------------------------------------------------------

/** Run the dispatcher's argument parser and report what `PLOT_AGENT` became. */
const selected = (args, env = {}) => {
  const script = `
    PLOT_DISPATCH_SOURCED=1
    . "${dispatch}" ${args}
    printf 'AGENT=[%s]\\n' "\${PLOT_AGENT:-}"
  `;
  try {
    return { out: execFileSync('bash', ['-c', script],
      { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } }), failed: false };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, failed: true };
  }
};

test('--agent sets PLOT_AGENT, which nothing chose before', () => {
  // MEASURED 2026-09-14: `PLOT_AGENT` had ONE assignment on the estate —
  // `PLOT_AGENT="${PLOT_AGENT:-}"`, a pass-through of whatever the operator had
  // already exported. The selector existed as a variable nothing selected.
  const got = selected('--agent reviewer', { PLOT_AGENT: '' });
  assert.match(got.out, /AGENT=\[reviewer\]/, got.out);
});

test('--agent overrides a PLOT_AGENT inherited from the environment', () => {
  // A DISPATCHED WORKER RUNS WITH ITS OWN `PLOT_AGENT` SET, so a dispatch
  // launched from inside one would otherwise inherit a kind nobody asked for on
  // this run. A flag naming the kind is the more specific answer.
  const got = selected('--agent reviewer', { PLOT_AGENT: 'something-else' });
  assert.match(got.out, /AGENT=\[reviewer\]/, got.out);
});

test('no --agent leaves PLOT_AGENT exactly as it was', () => {
  // THE FALLBACK ARM, and it is the whole estate: every dispatch today names no
  // agent and must keep reaching the repo's own `Worker command`.
  const got = selected('', { PLOT_AGENT: '' });
  assert.match(got.out, /AGENT=\[\]/, got.out);
});

test('--agent with no value refuses rather than swallowing the slug', () => {
  // THE VALUE'S SHAPE IS WHY THIS DIFFERS FROM `--stop`/`--restart`/`--start`.
  // Those take a branch (`*/*`) or a count (digits), each recognisable on
  // sight, so an absent value can be left for the parser. An agent name is a
  // bare word and so is a plan slug — nothing tells `--agent reviewer` from
  // `--agent` followed by the slug. Left unconsumed, the `*)` arm would take
  // the agent name as the plan to dispatch and report "no such plan", naming
  // neither what was asked nor what went wrong.
  const got = selected('--agent');
  assert.ok(got.failed, `a missing value must refuse\n${got.out}`);
  assert.match(got.out, /--agent needs a charter name/, got.out);
});

test('--help still ends where it did, with --agent inside it', () => {
  // TWO RECORDS OF ONE FACT: `-h` prints a hardcoded line range of this file's
  // own header, so a flag added above `<slug>` moves the boundary and a stale
  // number truncates the help SILENTLY rather than failing. Nothing compares
  // them, so this does.
  const out = execFileSync('bash', [dispatch, '--help'], { encoding: 'utf8', timeout: 60_000 });
  assert.match(out, /--agent <name>/, 'the new flag must be documented in the help');
  assert.match(out.trimEnd(), /<slug>\s+the plan to fan out$/,
    `the help must still end at <slug>\n...${out.slice(-200)}`);
});

// ---------------------------------------------------------------------------
// THE DECLARED CHARTER
// ---------------------------------------------------------------------------

test('the reviewer charter exists, parses, and declares a read-only reviewer', () => {
  // THE FIRST DECLARATION ON THE ESTATE. The mechanism shipped in v2.17.0 and
  // not one agent had ever been declared, so every field it reads was read from
  // nothing.
  const file = path.join(repoRoot, '.plot', 'charters', 'reviewer.json');
  const charter = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(charter.name, 'reviewer', 'the name is the identity and the file stem');
  assert.ok(charter.capabilities?.includes('read-only'),
    'read-only is the ONE mapped capability in the shipped template');
  // IT NAMES NO HARNESS, AND THAT IS LOAD-BEARING RATHER THAN AN OMISSION.
  // `resolve_launch` refuses a harness not on PATH; `test:contracts` runs on
  // ubuntu-latest and ci.yml installs no Claude CLI. A charter naming `claude`
  // would be green on a workstation and red in CI —
  // `launch-resolution.test.mjs` records exactly that failure.
  assert.ok(!charter.harness, 'a charter naming a harness would refuse wherever that harness is absent');
  // The loop refuses a prompt file that does not exist.
  assert.ok(fs.existsSync(path.join(repoRoot, charter.prompt)),
    `the charter's prompt file must exist: ${charter.prompt}`);
});

test('the reviewer charter reaches an argv through the real resolution', () => {
  // THE WHOLE CHAIN, END TO END, and it is the assertion the plan asks for by
  // name: read from the PRINTED ARGV, never inferred from the charter file. An
  // unmapped capability runs unbounded, so a bound that failed to apply looks
  // identical to one that applied — only the flag on the command line separates
  // them.
  const resolve = `
    PLOT_DISPATCH_SOURCED=1
    . "${dispatch}"
    resolve_launch "${repoRoot}" reviewer >/dev/null 2>&1 || { echo REFUSED; exit 1; }
    printf '%s\\t%s\\t%s\\n' "$launch_harness" "$launch_model" "$launch_effort"
  `;
  const line = execFileSync('bash', ['-c', resolve], { encoding: 'utf8', timeout: 60_000 });
  assert.doesNotMatch(line, /REFUSED/, 'the declared charter must resolve');
  const [harness, model, effort] = line.replace(/\n$/, '').split('\t');
  const caps = execFileSync('node',
    [path.join(scripts, 'board', 'plot-prompt.mjs'), '--capabilities', repoRoot, 'reviewer'],
    { encoding: 'utf8', timeout: 60_000 }).trim();

  const got = argv(localPrompt, {
    PLOT_HARNESS: harness, PLOT_MODEL: model, PLOT_EFFORT: effort, PLOT_CAPABILITIES: caps,
  });
  const mat = got.indexOf('--model');
  assert.notEqual(mat, -1, `the charter's model must reach the argv\n${got.join(' ')}`);
  assert.equal(got[mat + 1], 'opus', got.join(' '));
  const eat = got.findIndex((a) => /^--(reasoning-)?effort$/.test(a));
  assert.notEqual(eat, -1, `the charter's effort must reach the argv\n${got.join(' ')}`);
  assert.equal(got[eat + 1], 'high', got.join(' '));
  const dat = got.indexOf('--disallowedTools');
  assert.notEqual(dat, -1, `the charter's capability must reach the argv\n${got.join(' ')}`);
  const denied = (got[dat + 1] ?? '').split(/[\s,]+/).filter(Boolean);
  for (const tool of ['Write', 'Edit', 'Bash']) {
    assert.ok(denied.includes(tool),
      `a read-only reviewer must be denied ${tool}\ngot: ${denied.join(' ')}`);
  }
});
