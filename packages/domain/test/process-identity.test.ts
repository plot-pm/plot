import { describe, expect, it } from 'vitest';

import { isRecordedProcess, type LockedProcess, type ProcessSighting } from '../src/rules/implement-lock.js';

const SKEW_MS = 3000;

const recorded: LockedProcess = { pid: 4100, startedAt: 1_760_000_000_000 };

const sighting = (over: Partial<ProcessSighting> = {}): ProcessSighting => ({
  alive: true,
  startedAt: recorded.startedAt,
  ...over,
});

describe('isRecordedProcess', () => {
  it('reads a dead pid as not the recorded process', () => {
    expect(isRecordedProcess(sighting({ alive: false, startedAt: recorded.startedAt }), recorded, SKEW_MS)).toBe(
      false,
    );
  });

  it('reads an unaskable table, or an unreadable live start, as the recorded process', () => {
    expect(isRecordedProcess(sighting({ alive: null, startedAt: null }), recorded, SKEW_MS)).toBe(true);
    expect(isRecordedProcess(sighting({ alive: true, startedAt: null }), recorded, SKEW_MS)).toBe(true);
  });

  it('holds just inside the skew on the early side', () => {
    const s = sighting({ startedAt: recorded.startedAt - (SKEW_MS - 1) });
    expect(isRecordedProcess(s, recorded, SKEW_MS)).toBe(true);
  });

  it('holds just inside the skew on the late side', () => {
    const s = sighting({ startedAt: recorded.startedAt + (SKEW_MS - 1) });
    expect(isRecordedProcess(s, recorded, SKEW_MS)).toBe(true);
  });

  it('holds exactly at the recorded moment', () => {
    expect(isRecordedProcess(sighting({ startedAt: recorded.startedAt }), recorded, SKEW_MS)).toBe(true);
  });

  it('frees at the skew boundary itself, on either side', () => {
    expect(isRecordedProcess(sighting({ startedAt: recorded.startedAt - SKEW_MS }), recorded, SKEW_MS)).toBe(false);
    expect(isRecordedProcess(sighting({ startedAt: recorded.startedAt + SKEW_MS }), recorded, SKEW_MS)).toBe(false);
  });

  it('frees just past the skew on either side', () => {
    expect(isRecordedProcess(sighting({ startedAt: recorded.startedAt - SKEW_MS - 1 }), recorded, SKEW_MS)).toBe(
      false,
    );
    expect(isRecordedProcess(sighting({ startedAt: recorded.startedAt + SKEW_MS + 1 }), recorded, SKEW_MS)).toBe(
      false,
    );
  });
});
