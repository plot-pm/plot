import * as childProcess from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { processesShell } from '../src/adapters/processes/processes-shell.js';
import { shellContext } from '../src/adapters/scripts.js';
import { signalZero } from '../src/adapters/signal-zero.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
    spawnSync: vi.fn(actual.spawnSync),
    execFile: vi.fn(actual.execFile),
    execFileSync: vi.fn(actual.execFileSync),
  };
});

/** A pid no process holds: one that just exited. */
const deadPid = (): number => {
  const run = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(run.stdout);
};

const processes = processesShell(shellContext(process.cwd()));

afterEach(() => {
  vi.clearAllMocks();
});

describe('processesShell.isAlive', () => {
  it('answers alive for this process', async () => {
    expect(await processes.isAlive(process.pid)).toEqual({ ok: true, value: true });
  });

  it('answers gone for a reaped pid', async () => {
    const pid = deadPid();
    expect(await processes.isAlive(pid)).toEqual({ ok: true, value: false });
  });

  it('answers alive for a pid another user owns (EPERM), the safe direction because every caller then holds back', async () => {
    // pid 1 belongs to root, so `kill(1, 0)` answers EPERM for any other user.
    if (process.getuid?.() === 0) return;
    expect(await processes.isAlive(1)).toEqual({ ok: true, value: true });
  });

  it('answers gone for 0, a negative and a fractional pid without asking the kernel', async () => {
    const kill = vi.spyOn(process, 'kill');
    try {
      expect(await processes.isAlive(0)).toEqual({ ok: true, value: false });
      expect(await processes.isAlive(-1)).toEqual({ ok: true, value: false });
      expect(await processes.isAlive(1.5)).toEqual({ ok: true, value: false });
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });

  it('answers nothing for a pid the kernel call rejects with another error', async () => {
    expect(await processes.isAlive(2 ** 31)).toEqual({ ok: false, why: 'failed' });
  });

  it('starts no child process', async () => {
    const gone = deadPid();
    vi.clearAllMocks();
    await processes.isAlive(process.pid);
    await processes.isAlive(gone);
    expect(vi.mocked(childProcess.spawn)).not.toHaveBeenCalled();
    expect(vi.mocked(childProcess.spawnSync)).not.toHaveBeenCalled();
    expect(vi.mocked(childProcess.execFile)).not.toHaveBeenCalled();
    expect(vi.mocked(childProcess.execFileSync)).not.toHaveBeenCalled();
  });
});

describe('signalZero', () => {
  it('maps ESRCH to gone, EPERM to alive and any other error to no answer', () => {
    const kill = vi.spyOn(process, 'kill');
    const throwing = (code: string) => () => {
      throw Object.assign(new Error(code), { code });
    };
    try {
      kill.mockImplementationOnce(() => true);
      expect(signalZero(42)).toBe(true);
      kill.mockImplementationOnce(throwing('ESRCH'));
      expect(signalZero(42)).toBe(false);
      kill.mockImplementationOnce(throwing('EPERM'));
      expect(signalZero(42)).toBe(true);
      kill.mockImplementationOnce(throwing('EINVAL'));
      expect(signalZero(42)).toBeNull();
      expect(kill).toHaveBeenCalledWith(42, 0);
    } finally {
      kill.mockRestore();
    }
  });
});
