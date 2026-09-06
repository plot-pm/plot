// Contract test for skills/plot/scripts/plot-install-prompt.sh — the worker
// prompt Plot never shipped.
//
// `.plot/worker-prompt.sh` is what plot-worker-loop.sh sources on every prompt
// of every agent, and on 2026-09-05 `find skills -name '*worker-prompt*'`
// returned nothing: no template, no generator, no example. Every adopting
// project wrote the file from a comment inside the loop, and this repo's own
// copy hardcoded `--session-id` until three agents failed their second slices
// simultaneously.
//
// A TEMPLATE IS A GATE AND DOCUMENTATION IS NOT. CLAUDE.md's own test — can
// you answer "did I complete this?" without doing the work? — is answered yes
// by a documented migration and no by a file that is either present or absent.
// So the write is a script, and this file is what holds it to its two rules:
// it writes where nothing exists, and it overwrites nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const install = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-install-prompt.sh');
const template = path.join(repoRoot, 'skills', 'plot', 'templates', 'worker-prompt.sh');

let tmp;
const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/** Run the installer in `cwd`; never throws, so the outcome word is readable. */
const run = (cwd, ...args) => {
  try {
    return { code: 0, out: execFileSync('bash', [install, ...args], { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

/** A fresh repository with a hub doc, so plot-config.sh has something to read. */
const freshRepo = (hub = '# Hub\n') => {
  const r = fs.mkdtempSync(path.join(tmp, 'repo-'));
  git(r, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'), hub);
  return r;
};

const prompt = (r) => path.join(r, '.plot', 'worker-prompt.sh');

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-prompt-install-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('template: is shipped, and is a sourceable bash file', () => {
  // The gap this whole slice closes. `find skills -name '*worker-prompt*'`
  // returning nothing is the measurement; a file that exists is the fix.
  assert.ok(fs.existsSync(template), 'skills/plot/templates/worker-prompt.sh must exist');
  execFileSync('bash', ['-n', template]);
});

test('template: carries the invocation and no session decision of its own', () => {
  const t = fs.readFileSync(template, 'utf8');
  // The loop decides the flag and exports it; the template interpolates.
  assert.match(t, /PLOT_SESSION_FLAG/, 'the template must interpolate the loop\'s flag');
  assert.match(t, /claude -p/, 'the template must carry the invocation');

  // NO RULE ABOUT RESUMING MAY LIVE HERE. A rule in this file is a rule every
  // project rewrites — that is how `--session-id` came to be hardcoded in the
  // one file nobody had a template for. The assertion is on the CODE rather
  // than the comments, which explain the split at length and must be free to.
  const code = t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/--session-id\s+"?\$/.test(code), 'no hardcoded --session-id in the template body');
  assert.ok(!/--resume/.test(code), 'no --resume decision in the template body');
  assert.ok(!/wavesCount|transcript|first slice/i.test(code), 'no session probing in the template body');

  // A BLANK HANDLE MUST NEVER REACH THE RUNTIME. `--resume` is
  // optional-valued, so a blank value opens an interactive picker in a `-p`
  // run with no terminal; and bash 3.2 — `/bin/bash` on macOS — expands a
  // plain `"${a[@]}"` on an empty array to one empty argument.
  assert.match(code, /session_args=\(\)/, 'the arguments are built as an array');
  assert.match(code, /\$\{session_args\[@\]\+"\$\{session_args\[@\]\}"\}/,
    'the bash 3.2 safe expansion is what reaches claude');
});

test('template: does not ship this estate\'s own instructions', () => {
  // "Do not hardcode this repo's prompt as the template" — ours carries
  // project-specific instruction (CLAUDE.md rules, pnpm gates, board
  // artifacts). A starting point that names another repo's tooling is wrong
  // in every repo that adopts it.
  const t = fs.readFileSync(template, 'utf8');
  for (const leak of ['pnpm', 'build:board', 'changeset', 'gh api', 'plot-pm']) {
    assert.ok(!t.includes(leak), `the template must not name this estate's ${leak}`);
  }
});

test('install: writes the prompt in a fresh repository', () => {
  const r = freshRepo();
  assert.ok(!fs.existsSync(prompt(r)), 'precondition: nothing there');

  const { code, out } = run(r);
  assert.equal(code, 0, out);
  assert.match(out, /^written /, out);
  assert.ok(fs.existsSync(prompt(r)), 'the file is either present or absent — that is the gate');
  assert.equal(fs.readFileSync(prompt(r), 'utf8'), fs.readFileSync(template, 'utf8'));
  execFileSync('bash', ['-n', prompt(r)]);
});

test('install: never overwrites an existing prompt', () => {
  // A project's prompt wording is the project's. The installer cannot tell an
  // edited file from an untouched one, so it does not try: it reports and the
  // caller offers.
  const r = freshRepo();
  const mine = '#!/usr/bin/env bash\n# my own words\nclaude -p "do the thing" "$PLOT_SESSION_FLAG" "$PLOT_SESSION_ID"\n';
  fs.mkdirSync(path.join(r, '.plot'), { recursive: true });
  fs.writeFileSync(prompt(r), mine);

  const { code, out } = run(r);
  assert.equal(code, 0, out);
  assert.match(out, /^current /, out);
  assert.equal(fs.readFileSync(prompt(r), 'utf8'), mine, 'the file is untouched');
});

test('install: reports a hardcoded session flag as stale, and changes nothing', () => {
  // The measured bug, in the file it was measured in. `--session-id` is fixed
  // at launch, so an agent handed a second slice asks the runtime to CREATE a
  // session it already holds and the prompt exits in under a second.
  const r = freshRepo();
  const stale = '#!/usr/bin/env bash\nsession_args=(--session-id "$PLOT_SESSION_ID")\nclaude -p "x" "${session_args[@]}"\n';
  fs.mkdirSync(path.join(r, '.plot'), { recursive: true });
  fs.writeFileSync(prompt(r), stale);

  const { code, out } = run(r);
  assert.equal(code, 3, out);
  assert.match(out, /^stale /, out);
  assert.match(out, /the loop decides it/, 'the report must say what to change');
  assert.equal(fs.readFileSync(prompt(r), 'utf8'), stale, 'a stale file is offered the update, not given it');
});

test('install: a prompt passing no session arguments is reported, not faulted', () => {
  // Plot requires neither flag: without them the transcript is unattributable,
  // resume reports itself unavailable, and a fresh worker is started. That is
  // a capability being off, and the operator is told so.
  const r = freshRepo();
  const bare = '#!/usr/bin/env bash\nclaude -p "just do it" --permission-mode bypassPermissions\n';
  fs.mkdirSync(path.join(r, '.plot'), { recursive: true });
  fs.writeFileSync(prompt(r), bare);

  const { code, out } = run(r);
  assert.equal(code, 3, out);
  assert.match(out, /^present /, out);
  assert.equal(fs.readFileSync(prompt(r), 'utf8'), bare);
});

test('install: --check writes nothing', () => {
  // /plot-init asks before it acts, and a hook can gate on the same answer.
  const r = freshRepo();
  const { code, out } = run(r, '--check');
  assert.equal(code, 3, out);
  assert.match(out, /^absent /, out);
  assert.ok(!fs.existsSync(prompt(r)), '--check must create nothing');
});

test('install: the Worker prompt template key overrides the shipped one', () => {
  // The same shape as `Plan template`: a project that wants different starting
  // wording ships its own, and adoption copies that instead.
  const r = freshRepo('# Hub\n\n## Plot Config\n\n- **Worker prompt template:** my/template.sh\n');
  fs.mkdirSync(path.join(r, 'my'), { recursive: true });
  fs.writeFileSync(path.join(r, 'my', 'template.sh'), '#!/usr/bin/env bash\n# ours\n');

  const { code, out } = run(r);
  assert.equal(code, 0, out);
  assert.equal(fs.readFileSync(prompt(r), 'utf8'), '#!/usr/bin/env bash\n# ours\n');
});

test('install: is idempotent — a second run reports current and rewrites nothing', () => {
  const r = freshRepo();
  assert.equal(run(r).code, 0);
  const first = fs.statSync(prompt(r)).mtimeMs;
  const second = run(r);
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /^current /);
  assert.equal(fs.statSync(prompt(r)).mtimeMs, first, 'the file is not rewritten');
});

test('this estate\'s own prompt handles a second slice', () => {
  // A template nobody runs proves nothing, and this repo is where the defect
  // was measured. The check is the installer's own: `current` means the file
  // interpolates the flag the loop exports rather than hardcoding one.
  const { code, out } = run(repoRoot, '--check');
  assert.equal(code, 0, out);
  assert.match(out, /^current /, out);
});
