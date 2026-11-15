import { describe, expect, it } from 'vitest';

import type { AgentStart, LaunchRecords } from '@plot-pm/domain/ports/worker-records';
import type { AgentEndReading } from '@plot-pm/domain/rules/worker-ending';

import { runWorkerWrapper, wrapperInput, type WrapperDeps, type WrapperInput } from '../../src/server/entry/worker-wrapper.js';
import type { Stamp } from '../../src/shared/manifest-stamp.js';

const ENV = {
  PLOT_EXIT_FILE: '/w/.plot-worker.exit',
  PLOT_PID_FILE: '/w/.plot-worker.pid',
  PLOT_PID_STARTED_FILE: '/w/.plot-worker.pid.startedAt',
  PLOT_WRAPPER_PID_FILE: '/w/.plot-worker.wrapper.pid',
  PLOT_BRANCH: 'feature/x',
  PLOT_WORKTREE: '/w',
  PLOT_MANIFEST_FILE: '/m/s.json',
  PLOT_STAMP_STARTED: '2026-11-09T08:00:00Z',
  PLOT_SCRIPT_DIR: '/s',
  PATH: '/usr/bin',
};

/** A run's every port call, in order. */
const fakes = (ending: AgentEndReading, manifestWorktree = '', agentPid: number | null = 200, tokenFails = '') => {
  const calls: string[] = [];
  const stamps: Stamp[] = [];
  const envs: Readonly<Record<string, string | undefined>>[] = [];
  const records: LaunchRecords = {
    writeWrapperPid: (pid) => (calls.push(`wrapper-pid ${pid}`), true),
    writeAgentPid: (pid) => (calls.push(`agent-pid ${pid}`), true),
    writeAgentStarted: (text) => (calls.push(`agent-started ${text}`), true),
    writeExit: (code) => (calls.push(`exit ${code}`), true),
    removeExit: () => (calls.push('remove-exit'), true),
    startedText: (pid) => (calls.push(`started-text ${pid}`), `lstart-${pid}`),
    manifestWorktree: (file) => (calls.push(`manifest-worktree ${file}`), manifestWorktree),
    appendFinding: (desk, line) => (calls.push(`finding ${desk} ${line}`), true),
  };
  const agents: AgentStart = {
    start: (command, env, tokenFd = null) => {
      calls.push(`agent ${command}${tokenFd === null ? '' : ` fd ${tokenFd}`}`);
      envs.push(env);
      return agentPid === null ? null : { pid: agentPid, ended: Promise.resolve(ending) };
    },
  };
  const deps: WrapperDeps = {
    records,
    agents,
    token: {
      read: () => ({ state: 'none', madeAtMs: null }),
      make: (desk) => {
        calls.push(`token ${desk}`);
        return tokenFails === '' ? { ok: true, token: { path: `${desk}/.plot-worker.token.fifo`, fd: 9 } } : { ok: false, reason: tokenFails };
      },
      close: (token) => calls.push(`token-close ${token.fd}`),
    },
    log: (line) => calls.push(`log ${line}`),
    finalPass: async ({ branch, worktree }) => {
      calls.push(`final-pass ${branch} ${worktree}`);
    },
    stamp: (file, stamp) => (calls.push(`stamp ${file}`), stamps.push(stamp), true),
    ignoreTerm: () => calls.push('ignore-term'),
    pid: 100,
    now: () => Date.UTC(2026, 10, 9, 8, 7, 6),
  };
  return { calls, stamps, envs, deps };
};

const input = (overrides: Partial<WrapperInput> = {}): WrapperInput => {
  const read = wrapperInput(['run-agent'], ENV);
  if (!read.ok) throw new Error(read.why);
  return { ...read.input, ...overrides };
};

describe('wrapperInput', () => {
  it('reads the command and the environment start_worker exports', () => {
    expect(input()).toMatchObject({
      command: 'run-agent',
      branch: 'feature/x',
      worktree: '/w',
      manifestFile: '/m/s.json',
      stampStarted: '2026-11-09T08:00:00Z',
      scriptDir: '/s',
    });
  });

  it('reads an unset optional variable as empty', () => {
    const read = wrapperInput(['run-agent'], {
      PLOT_EXIT_FILE: 'e',
      PLOT_PID_FILE: 'p',
      PLOT_PID_STARTED_FILE: 's',
      PLOT_WRAPPER_PID_FILE: 'w',
    });

    expect(read.ok && read.input).toMatchObject({ branch: '', worktree: '', manifestFile: '', scriptDir: '' });
  });

  it('refuses no command, two commands, and an empty one', () => {
    for (const argv of [[], ['a', 'b'], ['']]) expect(wrapperInput(argv, ENV)).toMatchObject({ ok: false });
  });

  it('refuses a missing record path by name', () => {
    expect(wrapperInput(['run-agent'], { ...ENV, PLOT_EXIT_FILE: '', PLOT_PID_FILE: undefined })).toEqual({
      ok: false,
      why: 'plot-worker-wrapper: PLOT_EXIT_FILE, PLOT_PID_FILE unset',
    });
  });
});

describe('runWorkerWrapper', () => {
  it('writes the records in the order the sh wrapper writes them', async () => {
    const { calls, deps } = fakes({ code: 0, signal: null });

    expect(await runWorkerWrapper(input(), deps)).toBe(0);

    expect(calls).toEqual([
      'wrapper-pid 100',
      'started-text 100',
      'token /w',
      'remove-exit',
      'agent run-agent fd 9',
      'ignore-term',
      'agent-pid 200',
      'started-text 200',
      'agent-started lstart-200',
      'stamp /m/s.json',
      'manifest-worktree /m/s.json',
      'finding /w {"monitor":"WorkerMonitor","branch":"feature/x","worktree":"/w","finding":"clear","since":"2026-11-09T08:07:06Z","evidence":"the agent pid 200 exited 0; the worker is finished","measuredAt":"2026-11-09T08:07:06Z"}\n',
      'exit 0',
      'token-close 9',
      'final-pass feature/x /w',
    ]);
  });

  it('starts no AgentMonitor, whatever the environment names', async () => {
    const { calls, deps } = fakes({ code: 0, signal: null });
    await runWorkerWrapper(input({ env: { ...ENV, PLOT_AGENT_MONITOR: '/s/plot-agent-monitor.sh' } }), deps);
    expect(calls.filter((c) => c.includes('plot-agent-monitor'))).toEqual([]);
  });

  it('runs the final pass on the watched desk after a hop', async () => {
    const { calls, deps } = fakes({ code: 0, signal: null }, '/w2');
    await runWorkerWrapper(input(), deps);
    expect(calls.at(-1)).toBe('final-pass feature/x /w2');
  });

  it('stamps the agent, the wrapper and both start times, and no AgentMonitor pid', async () => {
    const { stamps, deps } = fakes({ code: 0, signal: null });
    await runWorkerWrapper(input(), deps);

    expect(stamps).toEqual([
      {
        pid: '200',
        pidStartedAt: 'lstart-200',
        startedAt: '2026-11-09T08:00:00Z',
        wrapperPid: '100',
        wrapperPidStartedAt: 'lstart-100',
        workerMonitorPid: '',
        agentMonitorPid: '',
        token: '/w/.plot-worker.token.fifo',
      },
    ]);
  });

  it('tells the agent the token is on fd 3, and drops an inherited claim of one', async () => {
    const { envs, deps } = fakes({ code: 0, signal: null });
    await runWorkerWrapper(input({ env: { ...ENV, PLOT_WORKER_TOKEN_FD: '7' } }), deps);
    expect(envs[0]?.PLOT_WORKER_TOKEN_FD).toBe('3');

    const failing = fakes({ code: 0, signal: null }, '', 200, 'mkfifo: Operation not supported');
    await runWorkerWrapper(input({ env: { ...ENV, PLOT_WORKER_TOKEN_FD: '3' } }), failing.deps);
    expect(failing.envs[0]?.PLOT_WORKER_TOKEN_FD).toBeUndefined();
  });

  it('starts the agent with no token, logs the reason and records it when the token cannot be made', async () => {
    const { calls, stamps, deps } = fakes({ code: 0, signal: null }, '', 200, '/w/.plot-worker.token.fifo.100.tmp: mkfifo: Operation not supported');
    await runWorkerWrapper(input(), deps);

    expect(calls).toContain('log plot-worker-wrapper: no liveness token: /w/.plot-worker.token.fifo.100.tmp: mkfifo: Operation not supported');
    expect(calls).toContain('agent run-agent');
    expect(calls.some((c) => c.startsWith('token-close'))).toBe(false);
    expect(stamps[0]?.token).toBe('none (/w/.plot-worker.token.fifo.100.tmp: mkfifo: Operation not supported)');
  });

  it('makes no token with no desk named', async () => {
    const { calls, stamps, deps } = fakes({ code: 0, signal: null });
    await runWorkerWrapper(input({ worktree: '' }), deps);

    expect(calls.some((c) => c.startsWith('token '))).toBe(false);
    expect(stamps[0]?.token).toBe('none (no desk named)');
  });

  it('puts the script directory first on the agent PATH', async () => {
    const { envs, deps } = fakes({ code: 0, signal: null });
    await runWorkerWrapper(input(), deps);

    expect(envs[0]?.PATH).toBe('/s:/usr/bin');
    expect(envs[0]?.PLOT_BRANCH).toBe('feature/x');
  });

  it('leaves PATH alone with no script directory', async () => {
    const { envs, deps } = fakes({ code: 0, signal: null });
    await runWorkerWrapper(input({ scriptDir: '', env: {} }), deps);

    expect(envs[0]?.PATH).toBe('');
  });

  it('writes 128 plus the signal and a gone line for a signal death', async () => {
    const { calls, deps } = fakes({ code: null, signal: 15 });
    await runWorkerWrapper(input(), deps);

    expect(calls.at(-3)).toBe('exit 143');
    expect(calls.at(-4)).toContain('"finding":"gone"');
    expect(calls.at(-4)).toContain('exited 143');
  });

  it('writes the line into the desk the manifest names after a hop', async () => {
    const { calls, deps } = fakes({ code: 3, signal: null }, '/w2');
    await runWorkerWrapper(input(), deps);

    expect(calls.at(-4)).toMatch(/^finding \/w2 .*"worktree":"\/w2"/);
  });

  it('writes no line with no desk to name, and still the exit', async () => {
    const { calls, deps } = fakes({ code: 3, signal: null });
    await runWorkerWrapper(input({ worktree: '' }), deps);

    expect(calls.some((c) => c.startsWith('finding') || c.startsWith('final-pass'))).toBe(false);
    expect(calls.at(-1)).toBe('exit 3');
  });

  it('writes exit 127, closes its token copy after it, and answers 1 when no agent starts', async () => {
    const { calls, deps } = fakes({ code: 0, signal: null }, '', null);

    expect(await runWorkerWrapper(input(), deps)).toBe(1);
    expect(calls.slice(-2)).toEqual(['exit 127', 'token-close 9']);
  });

  it('holds its token copy until the exit record is written, so the token never releases ahead of the record', async () => {
    const { calls, deps } = fakes({ code: 3, signal: null });
    await runWorkerWrapper(input(), deps);

    expect(calls.indexOf('token-close 9')).toBeGreaterThan(calls.indexOf('exit 3'));
    expect(calls.at(-2)).toBe('token-close 9');
  });
});
