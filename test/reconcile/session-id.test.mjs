// THE WORKER PROMPT NAMES ITS SESSION — `"$PLOT_SESSION_FLAG" "$PLOT_SESSION_ID"`.
//
// THE FLAG IS THE LOOP'S SINCE 2026-09-05, and this file interpolates it. The
// prompt hardcoded `--session-id`, which asks the runtime to CREATE a session
// and succeeds exactly once — so an agent handed a SECOND slice was refused
// with `Session ID … is already in use` and its prompt exited in under a
// second. `plot-worker-loop.sh` now probes the transcript and exports
// `--session-id` or `--resume`; the assertions below are about what this file
// does with that answer, including the one it must never build.
//
// This is `a-worker-names-its-session`, wave 5 of
// docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md. Measured on
// 2026-09-04: `plot-dispatch.sh:774` exported the id, `plot-worker-loop.sh:661`
// printed the flag in its own diagnostic, and `.plot/worker-prompt.sh` passed
// it zero times. So no transcript could be attributed to an agent, and
// `plot-worker-loop.sh:1063` reported that in prose before ending the worker.
//
// THE SUBJECT IS THIS REPO'S OWN FILE, NOT A COPY OF IT. `.plot/worker-prompt.sh`
// is the estate's real invocation, and a test that rebuilt the command here
// would pass while the file a worker actually sources stayed wrong. So the file
// is sourced verbatim, with `claude` shimmed onto PATH to record its argv.
//
// BOTH BASH VERSIONS ARE ASSERTED, and the older one is the load-bearing case.
// The loop sources this file through `bash -c` (`plot-worker-loop.sh:947`),
// which resolves on PATH, so the version is not knowable at write time. On
// bash 3.2 — `/bin/bash` on every macOS — a plain `"${a[@]}"` over an EMPTY
// array expands to one empty argument, and aborts outright under `set -u`. The
// loop runs `set -uo pipefail`, so both failures are reachable and both are
// silent from the operator's side: the first hands `claude` a stray `""`, the
// second kills the run before a single prompt is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const promptFile = path.join(repoRoot, '.plot', 'worker-prompt.sh');

/**
 * The bash binaries to run the prompt under.
 *
 * `/bin/bash` is included only where it exists and is genuinely older than the
 * default — on Linux the two are the same file, and asserting twice over one
 * binary would report coverage this test does not have.
 */
const shells = () => {
  const found = ['bash'];
  if (fs.existsSync('/bin/bash')) found.push('/bin/bash');
  const seen = new Map();
  for (const sh of found) {
    let version;
    try {
      version = execFileSync(sh, ['-c', 'echo "$BASH_VERSION"'], { encoding: 'utf8' }).trim();
    } catch { continue; }
    if (!seen.has(version)) seen.set(version, { sh, version });
  }
  return [...seen.values()];
};

/**
 * Source the repo's prompt file under `sh` and return the argv `claude` saw.
 *
 * `session` is the value of `PLOT_SESSION_ID`: a string sets it, `null` unsets
 * it. `set -uo pipefail` matches what `plot-worker-loop.sh:58` runs, so a
 * version that aborts on an empty array aborts here too.
 */
const argv = (sh, session, flag = undefined) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sessid-'));
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
    // A dispatched worker runs this suite, so its OWN PLOT_SESSION_ID and
    // PLOT_SESSION_FLAG are in the environment. Deleting both is what makes the
    // absent cases observable at all.
    delete env.PLOT_SESSION_ID;
    delete env.PLOT_SESSION_FLAG;
    if (session !== null) env.PLOT_SESSION_ID = session;
    if (flag !== undefined) env.PLOT_SESSION_FLAG = flag;
    execFileSync(sh, ['-c', 'set -uo pipefail; . "$1"', '_', promptFile],
      { encoding: 'utf8', env, timeout: 30_000 });
    return fs.readFileSync(seen, 'utf8').split('\n').filter((l) => l !== '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const ID = 'a94c1f30-0000-4000-8000-000000000001';

for (const { sh, version } of shells()) {
  // THE PLAN'S DONE-WHEN. A dispatched worker's transcript is attributable to
  // the id the manifest records, because the runtime was told which session it
  // is. Asserted on the pair, not on the flag alone: `--session-id` followed by
  // the wrong value is the same defect wearing the right name.
  //
  // NO `PLOT_SESSION_FLAG` IS SET HERE, and that is the case a loop older than
  // the export produces, along with every hand run. The default must be
  // `--session-id`: it is what this file hardcoded before 2026-09-05, so an
  // unset variable behaves exactly as the file used to.
  test(`worker-prompt: a dispatched id reaches claude as --session-id (bash ${version})`, () => {
    const got = argv(sh, ID);
    const at = got.indexOf('--session-id');
    assert.notEqual(at, -1, `the flag is passed\n${got.join(' ')}`);
    assert.equal(got[at + 1], ID, 'and carries the id the dispatcher minted');
  });

  // THE LOOP'S DECISION REACHES THE RUNTIME. `plot-worker-loop.sh` probes the
  // transcript and exports `--session-id` or `--resume`; this file interpolates
  // the answer and states no rule. Asserted on both flags with one id, because
  // the defect this replaces was a file that could only ever say one of them.
  for (const flag of ['--session-id', '--resume']) {
    test(`worker-prompt: the loop's ${flag} is what reaches claude (bash ${version})`, () => {
      const got = argv(sh, ID, flag);
      const at = got.indexOf(flag);
      assert.notEqual(at, -1, `the exported flag is passed\n${got.join(' ')}`);
      assert.equal(got[at + 1], ID, 'and carries the handle beside it');
      // ONE FLAG, NOT BOTH. `--session-id --resume <id>` would ask the runtime
      // to create and continue in one invocation.
      const other = flag === '--resume' ? '--session-id' : '--resume';
      assert.equal(got.includes(other), false,
        `only the flag the loop decided is passed\n${got.join(' ')}`);
    });
  }

  // A BARE `--resume` MUST NEVER BE BUILT, and this is the assertion the plan
  // asks for by name. `--session-id ""` is malformed and fails loudly;
  // `--resume` is OPTIONAL-VALUED — *"Resume a conversation by session ID, or
  // open interactive picker"* — so a blank value does not fail, it opens a
  // picker inside a `-p` run with no terminal and hangs. The `[ -n … ]` guard
  // prevents it; this proves the guard.
  for (const [label, value] of [['unset', null], ['empty', '']]) {
    test(`worker-prompt: an ${label} id with --resume exported passes no flag (bash ${version})`, () => {
      const got = argv(sh, value, '--resume');
      assert.equal(got.includes('--resume'), false,
        `no --resume without a handle to resume\n${got.join(' ')}`);
      assert.equal(got.includes('--session-id'), false,
        `and no session flag of any kind\n${got.join(' ')}`);
      assert.equal(got.includes(''), false,
        'and no stray empty argument — bash 3.2 expands an empty array to one');
    });
  }

  // THE OTHER ARM. A prompt file run outside dispatch has no id, and the
  // defensible answer is to pass nothing — not `--session-id ""`, which is a
  // malformed argument, and not an invented id, which would attribute the
  // transcript to an agent that does not exist.
  for (const [label, value] of [['unset', null], ['empty', '']]) {
    test(`worker-prompt: an ${label} id passes no flag at all (bash ${version})`, () => {
      const got = argv(sh, value);
      assert.equal(got.includes('--session-id'), false,
        `no flag without an id\n${got.join(' ')}`);
      assert.equal(got.includes(''), false,
        'and no stray empty argument — bash 3.2 expands an empty array to one');
      // The run is otherwise untouched: omitting the id costs attribution and
      // nothing else.
      assert.equal(got[0], '-p', 'the prompt is still the first argument');
      assert.deepEqual(got.slice(-2), ['--permission-mode', 'bypassPermissions'],
        'and the permission mode still arrives last');
    });
  }
}
