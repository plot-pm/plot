import { describe, it, expect } from 'vitest';
import { restartAnswer, MEMORY_CEILING_BYTES, type LoopRestartReadings } from '../src/rules/loop-restart.js';

/**
 * A later check mid-free-wait, with a newer clean bundle on the default
 * branch and HEAD confirmed ahead — the case the plan calls a restart.
 */
const later = (over: Partial<LoopRestartReadings> = {}): LoopRestartReadings => ({
  phase: 'later',
  inFreeWait: true,
  onDefaultBranch: true,
  bundlePathsClean: true,
  headContainsLoaded: 'yes',
  pinnedHash: 'new-hash',
  loadedHash: 'old-hash',
  residentBytes: 50 * 1024 * 1024,
  execveAvailable: true,
  ...over,
});

const first = (over: Partial<LoopRestartReadings> = {}): LoopRestartReadings => ({
  phase: 'first',
  inFreeWait: false,
  onDefaultBranch: true,
  bundlePathsClean: true,
  headContainsLoaded: 'unknown',
  pinnedHash: 'new-hash',
  loadedHash: 'old-hash',
  residentBytes: 50 * 1024 * 1024,
  execveAvailable: true,
  ...over,
});

describe('restartAnswer — purity', () => {
  it('imports nothing but its own types', async () => {
    const mod = await import('../src/rules/loop-restart.js');
    expect(Object.keys(mod).sort()).toEqual(['MEMORY_CEILING_BYTES', 'restartAnswer'].sort());
  });
});

describe('restartAnswer — the later check, during a free wait', () => {
  it('restarts when the checkout moved forward onto a newer, clean bundle', () => {
    expect(restartAnswer(later())).toEqual({
      verdict: 'restart',
      reason: "the main checkout's HEAD moved forward onto a newer, clean bundle",
    });
  });

  it('stays when the hash is unchanged — an identical rebuild restarts nothing', () => {
    expect(restartAnswer(later({ pinnedHash: 'same', loadedHash: 'same' }))).toEqual({
      verdict: 'stay',
      reason: 'no newer bundle and memory is within the ceiling',
    });
  });

  it('stays when the checkout is not on the default branch', () => {
    expect(restartAnswer(later({ onDefaultBranch: false })).verdict).toBe('stay');
  });

  it('stays when the bundle paths are dirty', () => {
    expect(restartAnswer(later({ bundlePathsClean: false })).verdict).toBe('stay');
  });

  it('stays when HEAD does not contain the loaded commit — the checkout moved backwards', () => {
    expect(restartAnswer(later({ headContainsLoaded: 'no' })).verdict).toBe('stay');
  });

  it('stays when ancestry is unknown — absent is not confirmation of forward motion', () => {
    expect(restartAnswer(later({ headContainsLoaded: 'unknown' })).verdict).toBe('stay');
  });

  it('stays outside a free wait regardless of every other reading', () => {
    expect(restartAnswer(later({ inFreeWait: false }))).toEqual({
      verdict: 'stay',
      reason: 'not in a free wait',
    });
  });
});

describe('restartAnswer — the first check, before the first pass', () => {
  it('restarts on a differing hash with a clean default-branch checkout', () => {
    expect(restartAnswer(first())).toEqual({
      verdict: 'restart',
      reason: "the main checkout's bundle differs from the one this loop loaded",
    });
  });

  it('never reads ancestry — ignores headContainsLoaded entirely', () => {
    expect(restartAnswer(first({ headContainsLoaded: 'no' })).verdict).toBe('restart');
  });

  it('stays when not on the default branch', () => {
    expect(restartAnswer(first({ onDefaultBranch: false })).verdict).toBe('stay');
  });

  it('stays when the bundle paths are dirty', () => {
    expect(restartAnswer(first({ bundlePathsClean: false })).verdict).toBe('stay');
  });

  it('stays on a matching hash', () => {
    expect(restartAnswer(first({ pinnedHash: 'same', loadedHash: 'same' })).verdict).toBe('stay');
  });

  it('never restarts for the memory ceiling — the ceiling is a later-phase-only concern', () => {
    const over = first({ pinnedHash: 'same', loadedHash: 'same', residentBytes: MEMORY_CEILING_BYTES + 1 });
    expect(restartAnswer(over).verdict).toBe('stay');
  });
});

describe('restartAnswer — the memory ceiling', () => {
  it('restarts in a free wait once resident memory passes the ceiling', () => {
    const over = later({
      pinnedHash: 'same',
      loadedHash: 'same',
      residentBytes: MEMORY_CEILING_BYTES + 1,
    });
    expect(restartAnswer(over)).toEqual({
      verdict: 'restart',
      reason: `resident memory ${MEMORY_CEILING_BYTES + 1} bytes passed the ${MEMORY_CEILING_BYTES} byte ceiling`,
    });
  });

  it('stays at exactly the ceiling — the bound is exclusive', () => {
    const atCeiling = later({ pinnedHash: 'same', loadedHash: 'same', residentBytes: MEMORY_CEILING_BYTES });
    expect(restartAnswer(atCeiling).verdict).toBe('stay');
  });

  it('never restarts for memory outside a free wait', () => {
    const over = later({
      inFreeWait: false,
      pinnedHash: 'same',
      loadedHash: 'same',
      residentBytes: MEMORY_CEILING_BYTES + 1,
    });
    expect(restartAnswer(over).verdict).toBe('stay');
  });
});

describe('restartAnswer — no process.execve', () => {
  it('answers stay-and-log instead of restart, for a bundle-driven restart', () => {
    expect(restartAnswer(later({ execveAvailable: false }))).toEqual({
      verdict: 'stay-and-log',
      reason: 'process.execve is not available on this Node, so the loop cannot restart itself',
    });
  });

  it('answers stay-and-log instead of restart, for a memory-driven restart', () => {
    const over = later({
      execveAvailable: false,
      pinnedHash: 'same',
      loadedHash: 'same',
      residentBytes: MEMORY_CEILING_BYTES + 1,
    });
    expect(restartAnswer(over).verdict).toBe('stay-and-log');
  });

  it('answers plain stay, never stay-and-log, when nothing would have restarted anyway', () => {
    expect(restartAnswer(later({ execveAvailable: false, pinnedHash: 'same', loadedHash: 'same' }))).toEqual({
      verdict: 'stay',
      reason: 'no newer bundle and memory is within the ceiling',
    });
  });
});
