// `plot-dispatch.sh`'s detached wrapper records the agent pid's OWN start
// time (`ps -o lstart`) beside `.plot-worker.pid`, so a later reuse of that
// pid by an unrelated process can be told apart from the run this sidecar
// names (#2757). This test extracts the wrapper's `sh -c` body from the
// script's source — the same technique
// `packages/fleet/test/unit/manifest-stamp-parity.test.ts` uses for the
// dispatcher's awk — and runs it directly, so a future edit that drops the
// sidecar write (or breaks what it writes) fails here rather than only in a
// live dispatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatch = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-dispatch.sh');

/**
 * The wrapper's `sh -c` body, extracted from the script's source between the
 * `exec nohup sh -c '` it is written with and the closing quote before
 * ` \` — the same slice `plot-dispatch.sh` itself passes to `sh -c`.
 *
 * The source splices two things into this single-quoted string that only
 * mean something inside `plot-dispatch.sh`'s OWN quoting, and both are
 * rewritten so the extracted text is valid on its own:
 *   - `$cmd` arrives as `'"$cmd"'` — a close-quote, an outer-script
 *     interpolation, and a re-open — rewritten to a plain `$cmd` reference;
 *     the caller runs this body with `cmd` set as an ordinary shell variable.
 *   - every single quote INSIDE the embedded awk program arrives as `'"'"'`
 *     — the four-byte escape a single-quoted string uses to carry a literal
 *     `'` — rewritten back to `'`, the same undoing
 *     `manifest-stamp-parity.test.ts`'s `awkProgram()` performs for the same
 *     reason.
 */
function wrapperBody() {
  const src = fs.readFileSync(dispatch, 'utf8');
  const open = "exec nohup sh -c 'printf \"%s\" \"$$\" > \"$PLOT_WRAPPER_PID_FILE\";";
  const at = src.indexOf(open);
  assert.notEqual(at, -1, 'the dispatcher wrapper moved — update this extractor');
  const from = at + "exec nohup sh -c '".length;
  const close = "' \\\n";
  const end = src.indexOf(close, from);
  assert.notEqual(end, -1, 'could not find the end of the wrapper body');
  const body = src.slice(from, end);
  const cmdSplice = '\'"$cmd"\'';
  assert.ok(body.includes(cmdSplice), 'the $cmd splice moved — update this extractor');
  const quoteSplice = '\'"\'"\'';
  assert.ok(body.includes(quoteSplice), 'the embedded-quote splice moved — update this extractor');
  return body.split(cmdSplice).join('$cmd').split(quoteSplice).join('\'');
}

test('dispatch wrapper: .plot-worker.pid.startedAt is written beside .plot-worker.pid, parseable by Date', () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-pid-started-'));
  try {
    const pidFile = path.join(wt, '.plot-worker.pid');
    const pidStartedFile = path.join(wt, '.plot-worker.pid.startedAt');
    const wrapperPidFile = path.join(wt, '.plot-worker.wrapper.pid');
    const exitFile = path.join(wt, '.plot-worker.exit');

    execFileSync('sh', ['-c', wrapperBody()], {
      cwd: wt,
      env: {
        ...process.env,
        cmd: 'sleep 1',
        PLOT_WORKTREE: wt,
        PLOT_BRANCH: 'feature/x',
        PLOT_MANIFEST_FILE: '',
        PLOT_STAMP_STARTED: '',
        PLOT_AGENT_MONITOR: '',
        PLOT_EXIT_FILE: exitFile,
        PLOT_PID_FILE: pidFile,
        PLOT_PID_STARTED_FILE: pidStartedFile,
        PLOT_WRAPPER_PID_FILE: wrapperPidFile,
        PLOT_SCRIPT_DIR: path.join(here, '..', '..', 'skills', 'plot', 'scripts'),
      },
    });

    assert.ok(fs.existsSync(pidFile), '.plot-worker.pid was written');
    const started = fs.readFileSync(pidStartedFile, 'utf8');
    assert.notEqual(started, '', '.plot-worker.pid.startedAt is not empty');
    assert.ok(!Number.isNaN(Date.parse(started)), `.plot-worker.pid.startedAt is not Date-parseable: ${started}`);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
