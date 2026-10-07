import { describe, expect, it } from 'vitest';

import { deskLoopAlive, type DeskLoopReading, type DeskPidReading } from '../src/rules/desk-loop-alive.js';

const reading = (pids: readonly DeskPidReading[], aliveSet: ReadonlySet<string>): DeskLoopReading => ({
  pids,
  alive: (pid) => aliveSet.has(pid),
});

describe('deskLoopAlive', () => {
  it('answers none when no pid source carries a reading', () => {
    expect(deskLoopAlive(reading([], new Set()))).toEqual({ kind: 'none' });
  });

  it('answers none when every recorded pid is dead', () => {
    const r = reading(
      [
        { source: '.plot-worker.pid', pid: '111' },
        { source: 'manifest pid', pid: '222' },
        { source: 'manifest wrapperPid', pid: '333' },
      ],
      new Set(),
    );
    expect(deskLoopAlive(r)).toEqual({ kind: 'none' });
  });

  it('answers alive on the desk pid file alone', () => {
    const r = reading(
      [
        { source: '.plot-worker.pid', pid: '111' },
        { source: 'manifest pid', pid: '222' },
        { source: 'manifest wrapperPid', pid: '333' },
      ],
      new Set(['111']),
    );
    expect(deskLoopAlive(r)).toEqual({ kind: 'alive', pid: '111', source: '.plot-worker.pid' });
  });

  it('answers alive on the manifest pid alone', () => {
    const r = reading(
      [
        { source: '.plot-worker.pid', pid: '111' },
        { source: 'manifest pid', pid: '222' },
        { source: 'manifest wrapperPid', pid: '333' },
      ],
      new Set(['222']),
    );
    expect(deskLoopAlive(r)).toEqual({ kind: 'alive', pid: '222', source: 'manifest pid' });
  });

  it('answers alive on the manifest wrapperPid alone', () => {
    const r = reading(
      [
        { source: '.plot-worker.pid', pid: '111' },
        { source: 'manifest pid', pid: '222' },
        { source: 'manifest wrapperPid', pid: '333' },
      ],
      new Set(['333']),
    );
    expect(deskLoopAlive(r)).toEqual({ kind: 'alive', pid: '333', source: 'manifest wrapperPid' });
  });

  it('returns the first live pid in reading order when several are alive', () => {
    const r = reading(
      [
        { source: '.plot-worker.pid', pid: '111' },
        { source: 'manifest pid', pid: '222' },
      ],
      new Set(['111', '222']),
    );
    expect(deskLoopAlive(r)).toEqual({ kind: 'alive', pid: '111', source: '.plot-worker.pid' });
  });

  it('treats an absent, empty or non-numeric pid as not alive — absent is not false', () => {
    const r = reading(
      [
        { source: 'absent', pid: '' },
        { source: 'zero', pid: '0' },
        { source: 'negative', pid: '-5' },
        { source: 'text', pid: 'notapid' },
        { source: 'decimal', pid: '12.5' },
        { source: 'leading-zero', pid: '0123' },
      ],
      new Set(['', '0', '-5', 'notapid', '12.5', '0123']),
    );
    expect(deskLoopAlive(r)).toEqual({ kind: 'none' });
  });
});
