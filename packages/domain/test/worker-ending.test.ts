import { describe, expect, it } from 'vitest';

import { agentExitCode, monitorTime, workerEnding, workerEndingLine } from '../src/rules/worker-ending.js';

describe('agentExitCode', () => {
  it('reads a normal exit as its own code', () => {
    expect(agentExitCode({ code: 0, signal: null })).toBe(0);
    expect(agentExitCode({ code: 3, signal: null })).toBe(3);
  });

  it('reads a signal death as 128 plus the signal number, as `wait` reports it in sh', () => {
    expect(agentExitCode({ code: null, signal: 9 })).toBe(137);
    expect(agentExitCode({ code: null, signal: 15 })).toBe(143);
  });

  it('reads an ending with neither a code nor a signal as 1', () => {
    expect(agentExitCode({ code: null, signal: null })).toBe(1);
  });
});

describe('workerEnding', () => {
  it('reads exit 0 as clear: the worker is finished', () => {
    expect(workerEnding(0, 4242)).toEqual({
      finding: 'clear',
      evidence: 'the agent pid 4242 exited 0; the worker is finished',
    });
  });

  it('reads any non-zero exit as gone', () => {
    for (const code of [1, 3, 124, 137, 143]) {
      expect(workerEnding(code, 7)).toEqual({
        finding: 'gone',
        evidence: `the agent pid 7 exited ${code}; the wrapper that started it is unattended`,
      });
    }
  });
});

describe('monitorTime', () => {
  it('prints UTC to the second, as `date -u +%Y-%m-%dT%H:%M:%SZ` does', () => {
    expect(monitorTime(Date.UTC(2026, 10, 9, 8, 7, 6, 543))).toBe('2026-11-09T08:07:06Z');
  });
});

describe('workerEndingLine', () => {
  it('writes the WorkerMonitor line in the field order `publish()` uses, with a newline', () => {
    const line = workerEndingLine({
      branch: 'feature/x',
      desk: '/w/x',
      ending: workerEnding(3, 11),
      at: '2026-11-09T08:07:06Z',
    });

    expect(line).toBe(
      '{"monitor":"WorkerMonitor","branch":"feature/x","worktree":"/w/x","finding":"gone",'
        + '"since":"2026-11-09T08:07:06Z","evidence":"the agent pid 11 exited 3; the wrapper that started it is unattended",'
        + '"measuredAt":"2026-11-09T08:07:06Z"}\n',
    );
  });

  it('escapes a value that JSON cannot hold verbatim', () => {
    const line = workerEndingLine({ branch: 'a"b', desk: '/w', ending: workerEnding(0, 1), at: 't' });

    expect(JSON.parse(line).branch).toBe('a"b');
  });
});
