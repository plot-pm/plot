import { describe, expect, it } from 'vitest';
import type { FixerAttemptsRecord } from '../src/entities/fixer-attempts.js';
import { FIXER_BOUND_SECONDS } from '../src/rules/fixer-attempts.js';
import { fixerAdmission, fixerRanToBound, runningFixers } from '../src/rules/fixer-concurrency.js';

const SLOT = { held: [], headroom: 'clear', machineOverride: false } as const;

describe('fixerAdmission', () => {
  it('admits with no fixer running and a free slot', () => {
    expect(fixerAdmission({ ...SLOT, running: 0 })).toEqual({ admit: true });
  });
  it('holds fixer-busy while one fixer runs, and admits once it has ended', () => {
    expect(fixerAdmission({ ...SLOT, running: 1 })).toEqual({ admit: false, why: 'fixer-busy' });
    expect(fixerAdmission({ ...SLOT, running: 0 })).toEqual({ admit: true });
  });
  it('holds on the machine slot reasons', () => {
    expect(fixerAdmission({ ...SLOT, held: null, running: 0 })).toEqual({ admit: false, why: 'queue-unread' });
    expect(fixerAdmission({ ...SLOT, headroom: 'starved', running: 0 })).toEqual({ admit: false, why: 'starved' });
    expect(fixerAdmission({ ...SLOT, headroom: 'starved', machineOverride: true, running: 0 })).toEqual({ admit: true });
  });
});

describe('runningFixers', () => {
  const mark = { pid: 1, startedAt: '2026-11-01T00:00:00Z' };
  const record = (inFlight: boolean[]): FixerAttemptsRecord =>
    ({ v: 1, pr: 1, attempts: inFlight.map((f) => (f ? { inFlight: mark } : {})) }) as unknown as FixerAttemptsRecord;

  it('counts marked attempts that have not ended', () => {
    expect(runningFixers(record([true, false, true]), [2])).toBe(1);
    expect(runningFixers(record([true]), [0])).toBe(0);
  });
  it('reads none as zero and unreadable as one', () => {
    expect(runningFixers('none', [])).toBe(0);
    expect(runningFixers('unreadable', [])).toBe(1);
  });
});

describe('fixerRanToBound', () => {
  const start = '2026-11-01T00:00:00Z';
  const at = Date.parse(start);
  it('is false before the bound and true at it', () => {
    expect(fixerRanToBound(start, at + FIXER_BOUND_SECONDS * 1000 - 1)).toBe(false);
    expect(fixerRanToBound(start, at + FIXER_BOUND_SECONDS * 1000)).toBe(true);
  });
  it('is false for an unparseable start', () => {
    expect(fixerRanToBound('soon', at + 10 ** 9)).toBe(false);
  });
});
