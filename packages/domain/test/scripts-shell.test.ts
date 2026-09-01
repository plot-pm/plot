import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scriptsShell } from '../src/adapters/scripts/scripts-shell.js';
import { runProcessSync, runScriptSync, asText } from '../src/adapters/run-script.js';

/**
 * THE ADAPTER THAT INVOKES PLOT'S OWN SCRIPTS, and the exit codes it maps.
 *
 * Every assertion here is about the mapping rather than about a script's output.
 * The board used to read exit 4 itself, in one place, and the reading is what
 * separates *this host has no issue tracker* from *this attempt failed* — the
 * first can never succeed and the second will once somebody logs in.
 */

const dirs: string[] = [];

/** A directory of fake helpers, each exiting with the code the test needs. */
const scriptDir = (scripts: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scripts-'));
  for (const [name, body] of Object.entries(scripts)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    fs.chmodSync(file, 0o755);
  }
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const at = (dir: string) => scriptsShell({ repoRoot: dir, scriptDir: dir });

describe('the host answer keeps three outcomes apart', () => {
  it('reads a clean exit as answered, with stdout', async () => {
    const dir = scriptDir({
      'plot-host.sh': '#!/usr/bin/env bash\nprintf "github"\n',
    });
    await expect(at(dir).hostSaid(['backend'])).resolves.toEqual({
      answer: 'answered',
      stdout: 'github',
    });
  });

  it('reads exit 4 as unaskable — this backend has no such capability', async () => {
    // The reading the board used to make by hand. Bitbucket has no issue
    // listing and never will, so a caller told to retry retries forever.
    const dir = scriptDir({
      'plot-host.sh': '#!/usr/bin/env bash\necho "no issue listing" >&2\nexit 4\n',
    });
    await expect(at(dir).hostSaid(['issue-list'])).resolves.toEqual({
      answer: 'unaskable',
      said: 'no issue listing',
    });
  });

  it('reads exit 1 and exit 3 alike as failed', async () => {
    // Both are attempts that broke. Neither is a standing fact about the host,
    // so neither may reach a caller as `unaskable`.
    for (const code of [1, 3]) {
      const dir = scriptDir({
        'plot-host.sh': `#!/usr/bin/env bash\necho "rate limit" >&2\nexit ${code}\n`,
      });
      await expect(at(dir).hostSaid(['pr-list'])).resolves.toEqual({
        answer: 'failed',
        said: 'rate limit',
      });
    }
  });

  it('carries the sentence, because a quota and a DNS blip are both failed', async () => {
    // The evidence the classification cannot supply. Only one of these is worth
    // waiting for, and the word `failed` does not say which.
    const quota = scriptDir({
      'plot-host.sh': '#!/usr/bin/env bash\necho "API rate limit already exceeded" >&2\nexit 1\n',
    });
    const blip = scriptDir({
      'plot-host.sh': '#!/usr/bin/env bash\necho "dial tcp: no such host" >&2\nexit 1\n',
    });
    const first = await at(quota).hostSaid(['issue-list']);
    const second = await at(blip).hostSaid(['issue-list']);
    expect(first).not.toEqual(second);
    expect(first).toMatchObject({ said: expect.stringContaining('rate limit') });
  });

  it('names the exit code where the script explained nothing', async () => {
    // A refusal with no sentence still gets one, so a caller never reports an
    // empty reason as the host's own account.
    const dir = scriptDir({ 'plot-host.sh': '#!/usr/bin/env bash\nexit 2\n' });
    await expect(at(dir).hostSaid(['backend'])).resolves.toEqual({
      answer: 'failed',
      said: 'plot-host.sh exited 2',
    });
  });

  it('answers unaskable through `host` too, never a bare failure', async () => {
    const dir = scriptDir({ 'plot-host.sh': '#!/usr/bin/env bash\nexit 4\n' });
    await expect(at(dir).host(['issue-list'])).resolves.toEqual({
      ok: false,
      why: 'unaskable',
    });
  });
});

describe('the plan parser is asked once, and its stdout arrives verbatim', () => {
  const parser = '#!/usr/bin/env bash\nfor f in "$@"; do printf "{\\"file\\":\\"%s\\"}\\n" "$f"; done\n';

  it('answers one line per file', async () => {
    const dir = scriptDir({ 'plot-plan-meta.sh': parser });
    const answer = await at(dir).planMeta(['a.md', 'b.md']);
    expect(answer).toEqual({ ok: true, value: '{"file":"a.md"}\n{"file":"b.md"}\n' });
  });

  it('answers an empty string for an empty file list, and starts no process', async () => {
    // A parser handed no paths would print its usage; asking it at all is the
    // wrong shape when the caller already knows there is nothing to read.
    const dir = scriptDir({ 'plot-plan-meta.sh': '#!/usr/bin/env bash\nexit 1\n' });
    await expect(at(dir).planMeta([])).resolves.toEqual({ ok: true, value: '' });
    expect(at(dir).planMetaSync([])).toEqual({ ok: true, value: '' });
  });

  it('reads a failing parser as failed rather than as no plans', () => {
    // An empty answer would report a repository with no plans, which is the
    // reassuring direction and the wrong one.
    const dir = scriptDir({ 'plot-plan-meta.sh': '#!/usr/bin/env bash\nexit 1\n' });
    expect(at(dir).planMetaSync(['a.md'])).toEqual({ ok: false, why: 'failed' });
  });

  it('answers the same bytes whether asked sync or async', async () => {
    // The two paths map through one `resultOf`, and this is what says so.
    const dir = scriptDir({ 'plot-plan-meta.sh': parser });
    const waited = await at(dir).planMeta(['a.md']);
    expect(at(dir).planMetaSync(['a.md'])).toEqual(waited);
  });
});

describe('config falls to the script, which owns the default', () => {
  it('answers what the script printed', async () => {
    const dir = scriptDir({
      'plot-config.sh': '#!/usr/bin/env bash\nprintf "%s\\n" "$3"\n',
    });
    await expect(at(dir).config('Plan directory', 'docs/plans/'))
      .resolves.toEqual({ ok: true, value: 'docs/plans/\n' });
  });

  it('reads an unreadable config as failed, so a caller chooses its own fallback', () => {
    const dir = scriptDir({ 'plot-config.sh': '#!/usr/bin/env bash\nexit 1\n' });
    expect(at(dir).configSync('Worktree root', '')).toEqual({ ok: false, why: 'failed' });
  });
});

describe('an awaited run hands back both streams and the code', () => {
  it('keeps stdout beside a non-zero exit', async () => {
    // THE SHAPE A PortResult CANNOT CARRY. `plot-dispatch.sh` reports which
    // branches it claimed and then exits non-zero on a phase gate; reading the
    // code as the answer throws the claim away.
    const dir = scriptDir({
      'plot-dispatch.sh':
        '#!/usr/bin/env bash\necho "dispatched a → /tmp/a"\necho "phase gate" >&2\nexit 1\n',
    });
    const ran = await at(dir).awaited('plot-dispatch.sh', ['--max', '1', 'slug']);
    expect(ran.code).toBe(1);
    expect(ran.stdout).toContain('dispatched a');
    expect(ran.stderr).toContain('phase gate');
  });

  it('reports code 0 for a script that succeeded', async () => {
    const dir = scriptDir({ 'plot-approve.sh': '#!/usr/bin/env bash\necho merged\n' });
    const ran = await at(dir).awaited('plot-approve.sh', ['slug']);
    expect(ran).toMatchObject({ code: 0, stdout: 'merged\n' });
  });
});

describe('a sourced script keeps its functions', () => {
  it('runs a program with the script sourced and its arguments after', () => {
    // `plot-worker-state.sh` is sourced by both of its shell callers so the
    // eight states stay one implementation; a caller here does the same.
    const dir = scriptDir({
      'plot-worker-state.sh':
        '#!/usr/bin/env bash\nplot_worker_state() { printf "running\\t%s\\n" "$1"; }\n',
    });
    const answer = at(dir).sourced(
      'plot-worker-state.sh',
      '. "$1"; shift; for wt in "$@"; do plot_worker_state "$wt"; done',
      ['/tmp/one', '/tmp/two'],
    );
    expect(answer).toEqual({ ok: true, value: 'running\t/tmp/one\nrunning\t/tmp/two\n' });
  });

  it('reads a missing script as failed rather than as an empty answer', () => {
    const dir = scriptDir({});
    expect(at(dir).sourced('plot-worker-state.sh', '. "$1"', [])).toEqual({
      ok: false,
      why: 'failed',
    });
  });
});

describe('a started script runs detached and answers that it started', () => {
  it('reports a pid for a script that came up', async () => {
    const dir = scriptDir({ 'plot-deliver.sh': '#!/usr/bin/env bash\nexit 0\n' });
    const started = at(dir).start('plot-deliver.sh', ['slug']);
    expect(started.started).toBe(true);
    expect(started.pid).toBeGreaterThan(0);
  });

  it('calls onExit with the code, which is what a chained caller waits for', async () => {
    // auto-deliver chains the reap to this exit. A handle dropped before it
    // arrives is every delivery landing and nothing ever being reaped.
    const dir = scriptDir({ 'plot-deliver.sh': '#!/usr/bin/env bash\nexit 3\n' });
    const code = await new Promise<number | null>((resolve) => {
      at(dir).start('plot-deliver.sh', ['slug'], { onExit: resolve });
    });
    expect(code).toBe(3);
  });

  it('writes both streams to the log it was given', async () => {
    const dir = scriptDir({
      'plot-reap.sh': '#!/usr/bin/env bash\necho out\necho err >&2\n',
    });
    const log = path.join(dir, 'reap.log');
    const fd = fs.openSync(log, 'a');
    await new Promise<void>((resolve) => {
      at(dir).start('plot-reap.sh', ['--yes'], { log: fd, onExit: () => resolve() });
    });
    fs.closeSync(fd);
    const written = fs.readFileSync(log, 'utf8');
    expect(written).toContain('out');
    expect(written).toContain('err');
  });

  it('reports `started: false` for a script that is not there', async () => {
    // Logging a start nobody got would report a worker no reader can find.
    const dir = scriptDir({});
    const failed = await new Promise<boolean>((resolve) => {
      const started = at(dir).start('plot-nothing.sh', [], {
        onError: () => resolve(false),
        onExit: (code) => resolve(code === 0),
      });
      if (!started.started) resolve(false);
    });
    expect(failed).toBe(false);
  });
});

describe('a streamed script delivers whole lines', () => {
  it('joins a line split across two writes', async () => {
    // A chunk boundary falls wherever the OS put it. Handing every fragment on
    // would deliver half a JSON object as a line.
    const dir = scriptDir({
      'plot-fleet-scan.sh':
        '#!/usr/bin/env bash\nprintf \'{"kind":"pl\'\nsleep 0.05\nprintf \'an"}\\n\'\n',
    });
    const lines: string[] = [];
    await at(dir).stream('plot-fleet-scan.sh', ['--stream'], (l) => lines.push(l));
    expect(lines).toEqual(['{"kind":"plan"}']);
  });

  it('delivers a trailing fragment that had no newline', async () => {
    const dir = scriptDir({
      'plot-fleet-scan.sh': '#!/usr/bin/env bash\nprintf \'last\'\n',
    });
    const lines: string[] = [];
    await at(dir).stream('plot-fleet-scan.sh', ['--stream'], (l) => lines.push(l));
    expect(lines).toEqual(['last']);
  });

  it('rejects on a non-zero exit', async () => {
    const dir = scriptDir({ 'plot-fleet-scan.sh': '#!/usr/bin/env bash\nexit 1\n' });
    await expect(
      at(dir).stream('plot-fleet-scan.sh', ['--stream'], () => {}),
    ).rejects.toThrow('exited 1');
  });

  it('rejects with the timeout its caller matches on', async () => {
    // `estateNote` matches exactly `timed out after <n>ms`, and treats every
    // other rejection as a fault the estate does not explain.
    const dir = scriptDir({ 'plot-fleet-scan.sh': '#!/usr/bin/env bash\nsleep 5\n' });
    await expect(
      at(dir).stream('plot-fleet-scan.sh', ['--stream'], () => {}, { timeoutMs: 50 }),
    ).rejects.toThrow('timed out after 50ms');
  });

  it('reads the stderr lines a caller asked for', async () => {
    // The terminal cache rides on stderr precisely so stdout stays
    // byte-identical to a run without it.
    const dir = scriptDir({
      'plot-fleet-scan.sh': '#!/usr/bin/env bash\necho "terminal: a=merged" >&2\necho ok\n',
    });
    const errors: string[] = [];
    await at(dir).stream('plot-fleet-scan.sh', ['--stream'], () => {}, {
      onErrorLine: (l) => errors.push(l),
    });
    expect(errors).toEqual(['terminal: a=merged']);
  });

  it('passes the environment the caller named', async () => {
    const dir = scriptDir({
      'plot-fleet-scan.sh': '#!/usr/bin/env bash\nprintf "%s\\n" "$PLOT_TERMINAL_CACHE"\n',
    });
    const lines: string[] = [];
    await at(dir).stream('plot-fleet-scan.sh', ['--stream'], (l) => lines.push(l), {
      env: { PLOT_TERMINAL_CACHE: 'a=merged' },
    });
    expect(lines).toEqual(['a=merged']);
  });
});

describe('the synchronous runners map through the same contract', () => {
  it('reports an exit code rather than throwing', () => {
    // `execFileSync` throws on any non-zero exit, which would deliver 1, 3 and
    // 4 as one indistinguishable Error — the collapse the mapping exists to
    // prevent, arriving through the runtime instead of a copied line.
    expect(runProcessSync('bash', ['-c', 'exit 4'])).toMatchObject({ code: 4 });
    expect(runProcessSync('bash', ['-c', 'exit 3'])).toMatchObject({ code: 3 });
  });

  it('keeps stdout from a run that then failed', () => {
    const finished = runProcessSync('bash', ['-c', 'echo partial; exit 1']);
    expect(finished.stdout.trim()).toBe('partial');
    expect(finished.code).toBe(1);
  });

  it('maps exit 4 to unaskable, as the async path does', () => {
    expect(runScriptSync('bash', ['-c', 'exit 4'], asText)).toEqual({
      ok: false,
      why: 'unaskable',
    });
  });

  it('reports a binary that does not exist as failed', () => {
    expect(runScriptSync('plot-no-such-binary-xyz', [], asText).ok).toBe(false);
  });

  it('answers a clean run', () => {
    expect(runScriptSync('bash', ['-c', 'echo hi'], asText)).toEqual({
      ok: true,
      value: 'hi',
    });
  });
});

describe('pathOf names a script without running it', () => {
  it('resolves under the context directory', () => {
    const dir = scriptDir({});
    expect(at(dir).pathOf('plot-resolve-artifact.sh'))
      .toBe(path.join(dir, 'plot-resolve-artifact.sh'));
  });
});
