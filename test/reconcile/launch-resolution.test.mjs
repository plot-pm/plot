// WHAT AN AGENT RUNS — the harness, model and effort resolved through its
// charter, or the repo's single `Worker command`.
//
// This is `an-agent-declares-what-it-runs`, the one slice of
// docs/plans/2026-09-12-an-agent-declares-what-it-runs.md. Measured that day:
// `harness`, `model` and `effort` had 0 readers each, and `plot-dispatch.sh`
// read one `Worker command` key and handed the identical command line to every
// dispatched agent.
//
// THE FALLBACK ARM IS THE LOAD-BEARING ONE. The estate holds zero charters, so
// `PLOT_AGENT` unset is the path every existing worker takes; it must export
// three empty strings and leave the command line byte-identical.
//
// THE FUNCTION IS EXERCISED DIRECTLY rather than through a dispatch, which is
// `prompt-resolution.test.mjs`'s idiom one script over. Driving a real dispatch
// would need a git remote, a plan, a claim and a worktree to observe one
// `case`. `PLOT_DISPATCH_SOURCED=1` stops the script after its definitions,
// which is what that flag was added for — slicing the file instead does not
// work, because `script_dir` is derived from `BASH_SOURCE` and a copy in /tmp
// resolves every helper to /tmp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const dispatch = path.join(scripts, 'plot-dispatch.sh');

/** A repo root holding four charters — one per arm the resolution can take. */
const sandbox = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-launch-'));
  fs.mkdirSync(path.join(root, '.plot', 'charters'), { recursive: true });
  const charter = (name, body) =>
    fs.writeFileSync(path.join(root, '.plot', 'charters', `${name}.json`), body);
  charter(
    'reviewer',
    JSON.stringify({
      name: 'reviewer',
      prompt: '.plot/prompts/reviewer.sh',
      harness: 'claude',
      model: 'opus',
      effort: 'high',
    }),
  );
  // Declares ONE field. Catches an all-or-nothing resolution that wants
  // `harness` before it exports anything.
  charter('only-model', JSON.stringify({ name: 'only-model', prompt: 'p', model: 'opus' }));
  charter('carries-a-run-fact', JSON.stringify({ name: 'x', prompt: 'p', pid: '4242' }));
  charter('broken', 'not json {');
  return root;
};

/**
 * Take `resolve_launch` out of the dispatcher and run it.
 *
 * Everything above `start_worker()` is definitions, so the slice is safe to
 * source: it defines functions and runs none of them.
 */
const resolve = (root, agent, { scriptDir = null } = {}) => {
  // `script_dir` is reassigned AFTER sourcing, for the missing-bundle case:
  // the script derives it from `BASH_SOURCE` and a test cannot pass it in.
  const override = scriptDir === null ? '' : `script_dir="${scriptDir}"`;
  const script = `
    PLOT_DISPATCH_SOURCED=1
    . "${dispatch}"
    ${override}
    if resolve_launch "${root}" "${agent}"; then
      printf 'ok\\t%s\\t%s\\t%s\\t%s\\n' "$launch_harness" "$launch_model" "$launch_effort" "$launch_agent"
    else
      printf 'refused\\t%s\\n' "$launch_why"
    fi
  `;
  // STDERR IS CAPTURED ON BOTH PATHS. `execFileSync` only hands it back via the
  // thrown error, and the missing-bundle case SUCCEEDS while writing to stderr —
  // so reading it only in the catch reported an empty string for the one case
  // whose whole assertion is what it said.
  const err = path.join(os.tmpdir(), `plot-launch-err-${process.pid}-${Math.random()}`);
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('bash', ['-c', `{ ${script} } 2>"${err}"`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    stdout = e.stdout ?? '';
  }
  try {
    stderr = fs.readFileSync(err, 'utf8');
  } catch {
    stderr = '';
  }
  fs.rmSync(err, { force: true });
  // TRIM THE NEWLINE ONLY, never the tabs. `trim()` eats the trailing empty
  // fields, so a fallback's four empty names collapsed to `[]` and an assertion
  // on ['', '', '', ''] failed against an implementation that was correct.
  const [verdict, ...rest] = stdout.replace(/\n$/, '').split('\t');
  return { verdict, rest, stderr };
};

test('an agent that named no charter exports nothing — the estate today', () => {
  // THE REGRESSION LOCK FOR THE WHOLE ESTATE. Zero charters exist, so this is
  // the path every current worker takes. Three empty strings means a prompt
  // file interpolating ${PLOT_MODEL:-} gets exactly what it got before.
  const root = sandbox();
  try {
    const { verdict, rest } = resolve(root, '');
    assert.equal(verdict, 'ok');
    assert.deepEqual(rest, ['', '', '', '']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a named agent with no charter on this clone exports nothing', () => {
  const root = sandbox();
  try {
    const { verdict, rest } = resolve(root, 'nobody');
    assert.equal(verdict, 'ok');
    assert.deepEqual(rest, ['', '', '', '']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a charter carries its harness, model and effort to the launch', () => {
  const root = sandbox();
  try {
    const { verdict, rest } = resolve(root, 'reviewer');
    assert.equal(verdict, 'ok');
    assert.deepEqual(rest, ['claude', 'opus', 'high', 'reviewer']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a charter declaring only a model leaves the other two empty', () => {
  // Catches an all-or-nothing resolution. The schema defaults all three to ''
  // precisely so a charter may state one and stay silent on the rest.
  const root = sandbox();
  try {
    const { verdict, rest } = resolve(root, 'only-model');
    assert.equal(verdict, 'ok');
    assert.deepEqual(rest, ['', 'opus', '', 'only-model']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a charter that cannot be parsed REFUSES rather than falling back', () => {
  // `absent` and `unreadable` must not collapse. The fallback would run,
  // successfully, under an invocation nobody asked for.
  const root = sandbox();
  try {
    const { verdict, rest } = resolve(root, 'broken');
    assert.equal(verdict, 'refused');
    assert.match(rest[0], /broken/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a charter carrying a run fact refuses', () => {
  const root = sandbox();
  try {
    const { verdict } = resolve(root, 'carries-a-run-fact');
    assert.equal(verdict, 'refused');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the refusal names the charter it could not read', () => {
  // Catches a bare non-zero return. A refusal reading only "could not start"
  // sends the operator nowhere.
  const root = sandbox();
  try {
    const { rest } = resolve(root, 'broken');
    assert.match(rest[0], /charter 'broken'/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a MISSING bundle falls back and says it could not ask', () => {
  // A bundle that cannot be asked is not a refusal: a checkout without
  // plot-prompt.mjs is a broken Plot installation, not a statement about this
  // agent. It must start, and it must say so.
  const root = sandbox();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-nobundle-'));
  try {
    const { verdict, rest, stderr } = resolve(root, 'reviewer', { scriptDir: empty });
    assert.equal(verdict, 'ok', 'a missing bundle must not refuse');
    assert.deepEqual(rest, ['', '', '', '']);
    assert.match(stderr, /no plot-prompt\.mjs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

/**
 * Call `start_worker` with a charter and report what it did to the desk.
 *
 * The refusal's WHOLE POINT is that it happens before anything is written, so
 * the assertion has to be about side effects rather than about the return code
 * alone: a test asserting only the refusal passes an implementation that
 * refuses after cutting the desk.
 */
const startWorker = (root, agent, wt) => {
  const script = `
    PLOT_DISPATCH_SOURCED=1
    . "${dispatch}"
    repo_root="${root}"
    PLOT_AGENT="${agent}"
    worker_cmd_declined=0
    slug=''
    if start_worker 'some/branch' '${wt}'; then echo 'STARTED'; else echo "REFUSED $?"; fi
  `;
  const err = path.join(os.tmpdir(), `plot-sw-err-${process.pid}-${Math.random()}`);
  let stdout = '';
  try {
    stdout = execFileSync('bash', ['-c', `{ ${script} } 2>"${err}"`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    stdout = e.stdout ?? '';
  }
  let stderr = '';
  try {
    stderr = fs.readFileSync(err, 'utf8');
  } catch {
    stderr = '';
  }
  fs.rmSync(err, { force: true });
  return { stdout: stdout.trim(), stderr };
};

test('the refusal fires BEFORE the desk is touched', () => {
  // BOTH HALVES, because the non-zero outcome alone would pass an
  // implementation that refuses after cutting the desk — which is the thing the
  // plan says not to build. `.plot-worker.exit` is the tell: `start_worker`
  // removes it four lines into its own body, so a file that survives proves the
  // refusal came first. No manifest and no pid file are the other two.
  const root = sandbox();
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-desk-'));
  try {
    fs.writeFileSync(path.join(wt, '.plot-worker.exit'), '0');
    const { stdout } = startWorker(root, 'broken', wt);

    assert.match(stdout, /^REFUSED/, 'an unbelievable charter must not start a worker');
    assert.ok(
      fs.existsSync(path.join(wt, '.plot-worker.exit')),
      'the desk was touched: start_worker removed .plot-worker.exit before refusing',
    );
    assert.ok(!fs.existsSync(path.join(wt, '.plot-worker.pid')), 'no pid file may be written');
    assert.equal(
      fs.existsSync(path.join(root, '.plot', 'agents'))
        ? fs.readdirSync(path.join(root, '.plot', 'agents')).length
        : 0,
      0,
      'no manifest may be written',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('the refusal names the charter, its path and the remedy', () => {
  // Catches a bare non-zero return. `resolve_prompt_file`'s refusal prints the
  // charter path and the way out; a refusal reading only "could not start"
  // sends the operator nowhere.
  const root = sandbox();
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-desk-'));
  try {
    const { stderr } = startWorker(root, 'broken', wt);

    assert.match(stderr, /charter 'broken'/, 'the charter is named');
    assert.match(stderr, /\.plot\/charters\/broken\.json/, 'the path to fix is named');
    assert.match(stderr, /unset PLOT_AGENT/, 'the deliberate way out is named');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
