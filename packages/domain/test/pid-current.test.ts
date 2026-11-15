import { describe, expect, it } from 'vitest';

import { agentAlive, isoStampMs, lstartMs, pidIsCurrent, type ProcessRow } from '../src/rules/pid-current.js';

const at = (text: string): number => new Date(text).getTime();

describe('lstartMs reads ps -o lstart= in the C locale', () => {
  it('reads a single-digit day padded with two spaces, as local time', () => {
    expect(lstartMs('Mon Nov  9 08:42:51 2026')).toBe(new Date(2026, 10, 9, 8, 42, 51).getTime());
  });

  it('reads trailing padding ps leaves after the year', () => {
    expect(lstartMs('Tue Mar 10 13:14:40 2026    ')).toBe(new Date(2026, 2, 10, 13, 14, 40).getTime());
  });

  it('reads the German and French forms macOS prints', () => {
    expect(lstartMs('Mo.  9 Nov. 13:52:01 2026   ')).toBe(new Date(2026, 10, 9, 13, 52, 1).getTime());
    expect(lstartMs('Mi.  4 März 12:14:40 2026')).toBe(new Date(2026, 2, 4, 12, 14, 40).getTime());
    expect(lstartMs('lun.  9 nov. 13:52:01 2026')).toBe(new Date(2026, 10, 9, 13, 52, 1).getTime());
    expect(lstartMs('dim.  9 août 13:14:40 2026')).toBe(new Date(2026, 7, 9, 13, 14, 40).getTime());
  });

  it('reads an unknown weekday or month as nothing', () => {
    expect(lstartMs('Xyz Nov  9 08:42:51 2026')).toBeNull();
    expect(lstartMs('Mon Xyz  9 08:42:51 2026')).toBeNull();
    expect(lstartMs('Mo.  9 Xyz. 13:52:01 2026')).toBeNull();
    expect(lstartMs('Xy.  9 Nov. 13:52:01 2026')).toBeNull();
    expect(lstartMs('')).toBeNull();
  });
});

describe('isoStampMs reads a manifest startedAt', () => {
  it('reads the UTC stamp', () => {
    expect(isoStampMs('2026-11-09T08:42:51Z')).toBe(Date.UTC(2026, 10, 9, 8, 42, 51));
  });

  it('reads another shape as nothing', () => {
    expect(isoStampMs('2026-11-09 08:42:51')).toBeNull();
    expect(isoStampMs('')).toBeNull();
  });
});

describe('pidIsCurrent', () => {
  const own = 'Mon Nov  9 08:42:51 2026';
  const ownMs = new Date(2026, 10, 9, 8, 42, 51).getTime();

  it('accepts a live start within 3 s of the pid\'s own recorded start, either side', () => {
    expect(pidIsCurrent({ startedAt: '', pidStartedAt: own }, ownMs)).toBe(true);
    expect(pidIsCurrent({ startedAt: '', pidStartedAt: own }, ownMs + 3_000)).toBe(true);
    expect(pidIsCurrent({ startedAt: '', pidStartedAt: own }, ownMs - 3_000)).toBe(true);
  });

  it('refuses a live start more than 3 s from the pid\'s own recorded start', () => {
    expect(pidIsCurrent({ startedAt: '', pidStartedAt: own }, ownMs + 4_000)).toBe(false);
    expect(pidIsCurrent({ startedAt: '', pidStartedAt: own }, ownMs - 4_000)).toBe(false);
  });

  it('prefers the pid\'s own start over the manifest stamp', () => {
    expect(pidIsCurrent({ startedAt: '2020-01-01T00:00:00Z', pidStartedAt: own }, ownMs + 60_000)).toBe(false);
  });

  it('refuses an unreadable own start', () => {
    expect(pidIsCurrent({ startedAt: '', pidStartedAt: 'Xy.  9 Nov. 08:42:51 2026' }, ownMs)).toBe(false);
  });

  it('with no own start, accepts a live start at or after the stamp less 3 s', () => {
    const stamp = '2026-11-09T08:42:51Z';
    const stampMs = at(stamp);
    expect(pidIsCurrent({ startedAt: stamp, pidStartedAt: '' }, stampMs - 3_000)).toBe(true);
    expect(pidIsCurrent({ startedAt: stamp, pidStartedAt: '' }, stampMs + 86_400_000)).toBe(true);
    expect(pidIsCurrent({ startedAt: stamp, pidStartedAt: '' }, stampMs - 4_000)).toBe(false);
  });

  it('refuses an unreadable stamp and an unknown live start', () => {
    expect(pidIsCurrent({ startedAt: 'yesterday', pidStartedAt: '' }, ownMs)).toBe(false);
    expect(pidIsCurrent({ startedAt: '', pidStartedAt: own }, null)).toBe(false);
  });
});

describe('agentAlive', () => {
  const now = 1_000_000_000;
  const row = (pid: number, ppid: number, comm: string, ageSeconds = 600): ProcessRow => ({
    pid,
    ppid,
    startedAt: now - ageSeconds * 1000,
    cpuCentis: 0,
    comm,
  });
  const options = { agentProcess: 'claude', graceSeconds: 30 };

  it('finds the agent at any depth below the wrapper', () => {
    const table = [row(10, 1, '/bin/sh'), row(11, 10, 'bash'), row(12, 11, 'bash'), row(13, 12, '/usr/local/bin/claude')];
    expect(agentAlive(table, 10, now, options)).toBe('present');
  });

  it('reads a subtree with no agent as absent, and never counts the wrapper itself', () => {
    const table = [row(10, 1, '/usr/local/bin/claude'), row(11, 10, 'bash'), row(20, 1, 'claude')];
    expect(agentAlive(table, 10, now, options)).toBe('absent');
  });

  it('matches the executable basename, not a directory naming the agent', () => {
    const table = [row(10, 1, 'sh'), row(11, 10, '/opt/claude/bin/node')];
    expect(agentAlive(table, 10, now, options)).toBe('absent');
  });

  it('reads a wrapper younger than the grace as unaskable, never absent', () => {
    expect(agentAlive([row(10, 1, 'sh', 5)], 10, now, options)).toBe('unaskable');
    expect(agentAlive([row(10, 1, 'sh', 30)], 10, now, options)).toBe('absent');
  });

  it('reads a wrapper with no readable start past the grace check', () => {
    expect(agentAlive([{ ...row(10, 1, 'sh'), startedAt: null }], 10, now, options)).toBe('absent');
  });

  it('reads a pid the table does not hold as unaskable', () => {
    expect(agentAlive([row(11, 1, 'claude')], 10, now, options)).toBe('unaskable');
  });

  it('matches nothing with an empty agent process name', () => {
    const table = [row(10, 1, 'sh'), row(11, 10, 'claude')];
    expect(agentAlive(table, 10, now, { ...options, agentProcess: '' })).toBe('absent');
  });
});
