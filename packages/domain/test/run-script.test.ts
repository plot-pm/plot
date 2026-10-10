import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import {
  asJson,
  asJsonLines,
  asLines,
  asText,
  KILL_GRACE_MS,
  killGroup,
  resultOf,
  runProcess,
  runScript,
  type ScriptRun,
} from '../src/adapters/run-script.js';

/**
 * The exit-code contract, asserted in the one place it is written.
 *
 * Every other adapter delegates here, so these assertions are what stop exit 3
 * and exit 4 from collapsing into each other — a collapse that turns a
 * permanent configuration fact into a transient incident.
 */

const run = (code: number, stdout = ''): ScriptRun => ({ code, stdout, stderr: '' });

describe('the exit code is the result type', () => {
  it('reads exit 0 as answered', () => {
    expect(resultOf(run(0, '7'), Number)).toEqual({ ok: true, value: 7 });
  });

  it('reads an empty payload on exit 0 as an answer', () => {
    // `NONE` is a payload. A branch with no PR and a host that could not be
    // asked are different facts, and only the second is a failure.
    expect(resultOf(run(0, ''), asLines)).toEqual({ ok: true, value: [] });
  });

  it('reads exit 1 as failed', () => {
    expect(resultOf(run(1), asText)).toEqual({ ok: false, why: 'failed' });
  });

  it('reads exit 3 as failed — asked, and it broke', () => {
    expect(resultOf(run(3), asText)).toEqual({ ok: false, why: 'failed' });
  });

  it('reads exit 4 as unaskable — this source has no answer at all', () => {
    expect(resultOf(run(4), asText)).toEqual({ ok: false, why: 'unaskable' });
  });

  it('keeps 3 and 4 apart', () => {
    // The whole reason the mapping is written once. An expired token will
    // succeed once somebody logs in; a Bitbucket repo with no tracker never
    // will, and a caller told to retry it retries forever.
    expect(resultOf(run(3), asText)).not.toEqual(resultOf(run(4), asText));
  });

  it('reads an unrecognised exit code as failed, never as unaskable', () => {
    // Guessing `unaskable` would turn a broken call into a confident
    // "there is none" — wrong in the reassuring direction.
    expect(resultOf(run(2), asText)).toEqual({ ok: false, why: 'failed' });
    expect(resultOf(run(127), asText)).toEqual({ ok: false, why: 'failed' });
  });

  it('reads malformed output on exit 0 as failed, not unaskable', () => {
    // The script was asked and answered nonsense: that is a break, and a
    // caller must keep retrying it rather than give the source up.
    expect(resultOf(run(0, 'not json'), asJson)).toEqual({ ok: false, why: 'failed' });
  });
});

describe('a process reports its exit code rather than throwing', () => {
  it('answers a command that succeeded', async () => {
    const result = await runScript('bash', ['-c', 'echo hello'], asText);
    expect(result).toEqual({ ok: true, value: 'hello' });
  });

  it('does not reject when the command exits non-zero', async () => {
    // `execFile` rejects on ANY non-zero exit, which would deliver 1, 3 and 4
    // as one indistinguishable Error — the collapse above, arriving through
    // the runtime instead of through a copied line.
    await expect(runProcess('bash', ['-c', 'exit 4'])).resolves.toMatchObject({ code: 4 });
    await expect(runProcess('bash', ['-c', 'exit 3'])).resolves.toMatchObject({ code: 3 });
  });

  it('maps a real exit 4 through to unaskable', async () => {
    const result = await runScript('bash', ['-c', 'exit 4'], asText);
    expect(result).toEqual({ ok: false, why: 'unaskable' });
  });

  it('reports a command that could not be started as failed', async () => {
    const result = await runScript('plot-no-such-binary-xyz', [], asText);
    expect(result.ok).toBe(false);
  });

  it('keeps stderr apart from stdout', async () => {
    const finished = await runProcess('bash', ['-c', 'echo out; echo err >&2']);
    expect(finished.stdout.trim()).toBe('out');
    expect(finished.stderr.trim()).toBe('err');
  });
});

describe('the parsers read what the scripts print', () => {
  it('reads one JSON document', () => {
    expect(asJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads JSON lines, ignoring blank ones', () => {
    expect(asJsonLines<{ n: number }>('{"n":1}\n\n{"n":2}\n')).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('reads plain lines, dropping empties', () => {
    expect(asLines('a\n\n b \n')).toEqual(['a', 'b']);
  });

  it('trims one line of text', () => {
    expect(asText('  main \n')).toBe('main');
  });
});

describe('a timeout ends the whole process group (#1084)', () => {
  // The script starts a child that would outlive it, prints the child's pid,
  // then waits on it, as `plot-fleet-scan.sh` waits on `plot-host.sh`.
  const SCRIPT = 'sleep 30 & echo $!; wait';

  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 300));

  it('leaves no child running after runProcess times out', async () => {
    const started = Date.now();
    const run = await runProcess('bash', ['-c', `${SCRIPT}`], { timeoutMs: 500 });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(run.code).not.toBe(0);
    const child = Number(run.stdout.trim());
    expect(child).toBeGreaterThan(0);
    await settle();
    expect(alive(child)).toBe(false);
  });

  it('marks a run ended by the timeout as interrupted', async () => {
    const run = await runProcess('bash', ['-c', 'echo summary; sleep 30'], { timeoutMs: 500 });
    expect(run.code).toBe(1);
    expect(run.interrupted).toBe('timeout');
    expect(run.stdout).toBe('summary\n');
  });

  it('marks a run ended by a signal as interrupted', async () => {
    const run = await runProcess('bash', ['-c', 'kill -TERM $$'], { timeoutMs: 5_000 });
    expect(run.code).toBe(1);
    expect(run.interrupted).toBe('signal');
  });

  it('leaves a run that exits 1 on its own unmarked', async () => {
    const run = await runProcess('bash', ['-c', 'exit 1'], { timeoutMs: 5_000 });
    expect(run.code).toBe(1);
    expect(run.interrupted).toBeUndefined();
  });

  it('leaves a child started by a script that exits on its own', async () => {
    // A plain non-zero exit is not a timeout: a script may start work that is
    // meant to outlive it, and the group is left alone.
    const run = await runProcess('bash', ['-c', 'sleep 30 >/dev/null 2>&1 & echo $!; exit 3'], { timeoutMs: 5_000 });
    expect(run.code).toBe(3);
    const child = Number(run.stdout.trim());
    try {
      expect(alive(child)).toBe(true);
    } finally {
      process.kill(child, 'SIGKILL');
    }
  });
});

describe('a timeout sends TERM before KILL', () => {
  const PLOT_TMP = resolve(__dirname, '../../../skills/plot/scripts/plot-tmp.sh');

  const exited = (child: ChildProcess): Promise<NodeJS.Signals | null> =>
    new Promise((done) => child.once('exit', (_code, signal) => done(signal)));

  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const gone = async (pid: number): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  };

  it('waits five seconds between TERM and KILL by default', () => {
    expect(KILL_GRACE_MS).toBe(5_000);
  });

  it('ends a group that exits on TERM by TERM, and the later KILL finds no group', async () => {
    const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    const kill = vi.spyOn(process, 'kill');
    try {
      const ended = exited(child);
      killGroup(child, 100);
      expect(await ended).toBe('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      expect(kill.mock.calls).toEqual([
        [-child.pid!, 'SIGTERM'],
        [-child.pid!, 'SIGKILL'],
      ]);
    } finally {
      kill.mockRestore();
    }
  });

  it('sends KILL to a child that ignores TERM after its leader exited on TERM (#1084)', async () => {
    const leader = spawn(
      'bash',
      ['-c', `sh -c 'trap "" TERM; sleep 30' & echo $!; wait`],
      { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const straggler = await new Promise<number>((done) =>
      leader.stdout.once('data', (chunk: Buffer) => done(Number(chunk.toString().trim()))),
    );
    try {
      await new Promise((r) => setTimeout(r, 200));
      const ended = exited(leader);
      killGroup(leader, 300);
      expect(await ended).toBe('SIGTERM');
      expect(alive(straggler)).toBe(true);
      await gone(straggler);
      expect(alive(straggler)).toBe(false);
    } finally {
      if (alive(straggler)) process.kill(-leader.pid!, 'SIGKILL');
    }
  });

  it('sends KILL to a group that ignores TERM once the grace has passed', async () => {
    // An ignored signal stays ignored across `exec`, so `sleep` ignores TERM too.
    const child = spawn('sh', ['-c', 'trap "" TERM; sleep 30'], { detached: true, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 200));
    const ended = exited(child);
    killGroup(child, 100);
    expect(await ended).toBe('SIGKILL');
  });

  it('signals the child alone when the group cannot be signalled', async () => {
    const kill = vi.fn();
    const child = { pid: 99_999_999, kill, once: vi.fn() } as unknown as ChildProcess;
    killGroup(child, 10);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    await new Promise((r) => setTimeout(r, 100));
    expect(kill).toHaveBeenLastCalledWith('SIGKILL');
  });

  it('does nothing for a child that never started', () => {
    expect(() => killGroup({ pid: undefined } as unknown as ChildProcess)).not.toThrow();
  });

  it('lets a timed-out script remove the temp paths it registered', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'plot-kill-term-'));
    try {
      const started = Date.now();
      const run = await runProcess(
        'bash',
        ['-c', `source "${PLOT_TMP}"; plot_tmpdir work probe; echo "$$ $work"; sleep 30`],
        { timeoutMs: 1_000, env: { TMPDIR: tmp } },
      );
      expect(Date.now() - started).toBeLessThan(KILL_GRACE_MS);
      expect(run.code).toBe(1);
      const [pid, work] = run.stdout.trim().split(' ');
      expect(work.startsWith(tmp)).toBe(true);
      await gone(Number(pid));
      expect(alive(Number(pid))).toBe(false);
      expect(existsSync(work)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
