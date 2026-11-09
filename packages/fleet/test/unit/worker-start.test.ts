import { describe, expect, it } from 'vitest';

import type { Detached } from '@plot-pm/domain/ports/detached';

import { startArgs, startWorker, type StartInput } from '../../src/server/entry/worker-start.js';

/** A Detached that records each start and answers `pid`. */
const recording = (pid: number): { detached: Detached; starts: unknown[][] } => {
  const starts: unknown[][] = [];
  return {
    starts,
    detached: {
      node: (script, args, cwd, logFile, append) => {
        starts.push([script, args, cwd, logFile, append]);
        return { pid, exitCode: () => null };
      },
    },
  };
};

const input = (over: Partial<StartInput> = {}): StartInput => ({
  command: 'sleep 300',
  log: '/desk/.plot-worker.log',
  append: false,
  cwd: '/desk',
  running: '26.13.0',
  pin: '26\n',
  pinFile: '/plot/.nvmrc',
  wrapper: '/plot/skills/plot/scripts/board/plot-worker-wrapper.mjs',
  ...over,
});

describe('startArgs', () => {
  it('reads the command from the one argument and the log from PLOT_WORKER_LOG', () => {
    expect(startArgs(['sleep 300'], { PLOT_WORKER_LOG: '/desk/log' })).toEqual({ ok: true, command: 'sleep 300', log: '/desk/log', append: false });
  });

  it('reads PLOT_WORKER_LOG_APPEND=1 as an append, and any other value as a truncation', () => {
    expect(startArgs(['true'], { PLOT_WORKER_LOG: '/desk/log', PLOT_WORKER_LOG_APPEND: '1' })).toMatchObject({ append: true });
    expect(startArgs(['true'], { PLOT_WORKER_LOG: '/desk/log', PLOT_WORKER_LOG_APPEND: 'yes' })).toMatchObject({ append: false });
  });

  it('refuses no command, an empty command and a second argument', () => {
    for (const argv of [[], [''], ['a', 'b']]) {
      expect(startArgs(argv, { PLOT_WORKER_LOG: '/desk/log' })).toEqual({ ok: false, why: 'usage: plot-worker-start.mjs <worker command>' });
    }
  });

  it('refuses an unset log', () => {
    expect(startArgs(['true'], {})).toEqual({ ok: false, why: 'plot-worker-start: PLOT_WORKER_LOG unset' });
  });
});

describe('startWorker', () => {
  it('starts the wrapper with the command as its one argument, in the desk, writing to the log', () => {
    const { detached, starts } = recording(4242);
    expect(startWorker(input(), detached)).toEqual({ code: 0, pid: 4242, message: '' });
    expect(starts).toEqual([
      ['/plot/skills/plot/scripts/board/plot-worker-wrapper.mjs', ['sleep 300'], '/desk', '/desk/.plot-worker.log', false],
    ]);
  });

  it('passes an append through to the Detached port', () => {
    const { detached, starts } = recording(4242);
    startWorker(input({ append: true }), detached);
    expect(starts[0]?.[4]).toBe(true);
  });

  it('starts nothing under another major, and names both majors and the pin file', () => {
    const { detached, starts } = recording(4242);
    const outcome = startWorker(input({ running: '24.1.0' }), detached);
    expect(starts).toEqual([]);
    expect(outcome.code).toBe(1);
    expect(outcome.pid).toBe(0);
    expect(outcome.message).toContain('node on PATH is 24, Plot pins 26 (/plot/.nvmrc)');
    expect(outcome.message).toContain('Put node 26 first on PATH');
  });

  it('starts nothing when the pin cannot be read', () => {
    const { detached, starts } = recording(4242);
    const outcome = startWorker(input({ pin: '' }), detached);
    expect(starts).toEqual([]);
    expect(outcome.message).toContain('node on PATH is 26, Plot pins unreadable');
    expect(outcome.message).toContain('Put node of the pinned major first on PATH');
  });

  it('names an unreadable running version', () => {
    const { detached } = recording(4242);
    expect(startWorker(input({ running: 'garbled' }), detached).message).toContain('node on PATH is unreadable, Plot pins 26');
  });

  it('refuses when the wrapper gets no pid', () => {
    const { detached } = recording(0);
    expect(startWorker(input(), detached)).toEqual({
      code: 1,
      pid: 0,
      message: 'plot-worker-start: /plot/skills/plot/scripts/board/plot-worker-wrapper.mjs did not start\n',
    });
  });
});
