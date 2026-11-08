import { describe, expect, it } from 'vitest';
import {
  NO_EXIT_RECORD,
  runStateOf,
  STOPPED_RECORD,
  type RunStateReading,
} from '../src/rules/run-state.js';

const reading = (over: Partial<RunStateReading> = {}): RunStateReading => ({
  recorded: 'running 4242 1700000000000 detached',
  logExists: true,
  marker: { pid: 4242, startedAt: 1_700_000_000_000, detached: true },
  ownPid: false,
  held: false,
  alive: true,
  actualStartedAt: null,
  ...over,
});

describe('runStateOf', () => {
  it('reads a detached marker whose pid is dead and holds no exit record as failed, with its own reason', () => {
    expect(runStateOf(reading({ alive: false }))).toEqual({ state: 'failed', recorded: NO_EXIT_RECORD });
  });

  it('reads a detached marker whose pid is alive as running', () => {
    expect(runStateOf(reading())).toEqual({ state: 'running', recorded: '' });
  });

  it('reads a board marker whose pid is dead as stopped', () => {
    const marker = { pid: 4242, startedAt: null, detached: false };
    expect(runStateOf(reading({ marker, alive: false }))).toEqual({ state: 'failed', recorded: STOPPED_RECORD });
  });

  it('reads a pid that started after the recorded start as reused', () => {
    expect(runStateOf(reading({ actualStartedAt: 1_700_000_000_000 + 6000 }))).toEqual({
      state: 'failed',
      recorded: NO_EXIT_RECORD,
    });
    expect(runStateOf(reading({ actualStartedAt: 1_700_000_000_000 + 4000 })).state).toBe('running');
  });

  it('reads the reading process as running only while it holds the run', () => {
    expect(runStateOf(reading({ ownPid: true, held: true })).state).toBe('running');
    expect(runStateOf(reading({ ownPid: true, held: false })).state).toBe('failed');
  });

  it('reads an exit code as done or failed', () => {
    expect(runStateOf(reading({ recorded: '0', marker: null }))).toEqual({ state: 'done', recorded: '0' });
    expect(runStateOf(reading({ recorded: '143', marker: null }))).toEqual({ state: 'failed', recorded: '143' });
  });

  it('reads an unreadable file by the log: running with a log, unknown without', () => {
    expect(runStateOf(reading({ recorded: null, marker: null })).state).toBe('running');
    expect(runStateOf(reading({ recorded: null, marker: null, logExists: false })).state).toBe('unknown');
  });
});
