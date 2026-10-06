import { describe, it, expect } from 'vitest';
import { restartAnswer, MEMORY_CEILING_BYTES, type LoopRestartReadings } from '../src/rules/loop-restart.js';

/** A later check in a free wait: main moved forward onto a newer, clean bundle. */
const later = (over: Partial<LoopRestartReadings> = {}): LoopRestartReadings => ({
  phase: 'later',
  inFreeWait: true,
  onDefaultBranch: true,
  scriptPathsClean: true,
  headContainsRunning: 'yes',
  pinnedHash: 'new-hash',
  loadedHash: 'old-hash',
  runningHashNow: 'old-hash',
  residentBytes: 50 * 1024 * 1024,
  execveAvailable: true,
  ...over,
});

const first = (over: Partial<LoopRestartReadings> = {}): LoopRestartReadings => later({ phase: 'first', inFreeWait: false, ...over });

const same = { pinnedHash: 'same', loadedHash: 'same', runningHashNow: 'same' };

describe('restartAnswer — purity', () => {
  it('exports the rule and its ceiling only', async () => {
    const mod = await import('../src/rules/loop-restart.js');
    expect(Object.keys(mod).sort()).toEqual(['MEMORY_CEILING_BYTES', 'restartAnswer']);
  });
});

describe('restartAnswer — failure 5: a process that runs old code', () => {
  it('restarts a loop whose bundle main has since rebuilt, once main moved forward', () => {
    expect(restartAnswer(later())).toEqual({
      verdict: 'restart',
      bundle: 'pinned',
      reason: "the main checkout's HEAD moved forward onto a newer, clean bundle",
    });
  });

  it('restarts on the pinned bundle when memory is also over the ceiling', () => {
    expect(restartAnswer(later({ residentBytes: MEMORY_CEILING_BYTES + 1 }))).toMatchObject({ verdict: 'restart', bundle: 'pinned' });
  });
});

describe('restartAnswer — a differing main bundle that is blocked, logged by reason', () => {
  const cases: [string, Partial<LoopRestartReadings>, string][] = [
    ['main is off the default branch', { onDefaultBranch: false }, 'the main checkout is not on the default branch'],
    ['a script path is dirty', { scriptPathsClean: false }, "the main checkout's script paths hold uncommitted changes"],
    ['main is behind the running bundle or moved backwards', { headContainsRunning: 'no' }, 'it is behind it or moved backwards'],
    ['ancestry is unknown', { headContainsRunning: 'unknown' }, 'it cannot be read whether'],
  ];
  for (const [name, over, reason] of cases) {
    it(`stays and logs when ${name}, on both checks`, () => {
      for (const readings of [later(over), first(over)]) {
        const answer = restartAnswer(readings);
        expect(answer.verdict).toBe('stay-and-log');
        expect(answer.reason).toContain(reason);
      }
    });
  }

  it('stays and logs when the main bundle cannot be read', () => {
    expect(restartAnswer(first({ pinnedHash: '' }))).toEqual({ verdict: 'stay-and-log', reason: "the main checkout's bundle cannot be read" });
  });
});

describe('restartAnswer — no restart', () => {
  it('stays on an identical rebuild', () => {
    expect(restartAnswer(later(same))).toEqual({ verdict: 'stay', reason: 'no newer bundle and memory is within the ceiling' });
  });

  it('stays outside a free wait regardless of every other reading', () => {
    expect(restartAnswer(later({ inFreeWait: false, residentBytes: MEMORY_CEILING_BYTES + 1 }))).toEqual({ verdict: 'stay', reason: 'not in a free wait' });
  });

  it('moves a desk-started loop onto main on the first check, and never for memory', () => {
    expect(restartAnswer(first())).toEqual({
      verdict: 'restart',
      bundle: 'pinned',
      reason: "the main checkout's bundle differs from the one this loop loaded",
    });
    expect(restartAnswer(first({ ...same, residentBytes: MEMORY_CEILING_BYTES + 1 })).verdict).toBe('stay');
  });
});

describe('restartAnswer — the memory ceiling', () => {
  it('restarts on the running bundle in a free wait past the ceiling', () => {
    expect(restartAnswer(later({ ...same, residentBytes: MEMORY_CEILING_BYTES + 1 }))).toEqual({
      verdict: 'restart',
      bundle: 'running',
      reason: `resident memory ${MEMORY_CEILING_BYTES + 1} bytes passed the ${MEMORY_CEILING_BYTES} byte ceiling`,
    });
  });

  it('stays at exactly the ceiling', () => {
    expect(restartAnswer(later({ ...same, residentBytes: MEMORY_CEILING_BYTES })).verdict).toBe('stay');
  });

  it('stays and logs when the running bundle changed on disk since it was loaded', () => {
    const changed = later({ ...same, runningHashNow: 'rebuilt', residentBytes: MEMORY_CEILING_BYTES + 1 });
    expect(restartAnswer(changed)).toMatchObject({ verdict: 'stay-and-log' });
    expect(restartAnswer(changed).reason).toContain('changed on disk');
  });

  it('restarts on the running bundle when the differing main bundle is blocked', () => {
    const blocked = later({ onDefaultBranch: false, runningHashNow: 'old-hash', residentBytes: MEMORY_CEILING_BYTES + 1 });
    expect(restartAnswer(blocked)).toMatchObject({ verdict: 'restart', bundle: 'running' });
  });
});

describe('restartAnswer — no process.execve', () => {
  it('answers stay-and-log for a bundle restart and for a memory restart', () => {
    const reason = 'process.execve is not available on this Node, so the loop cannot restart itself';
    expect(restartAnswer(later({ execveAvailable: false }))).toEqual({ verdict: 'stay-and-log', reason });
    expect(restartAnswer(later({ ...same, execveAvailable: false, residentBytes: MEMORY_CEILING_BYTES + 1 }))).toEqual({ verdict: 'stay-and-log', reason });
  });

  it('answers plain stay when nothing would have restarted', () => {
    expect(restartAnswer(later({ ...same, execveAvailable: false })).verdict).toBe('stay');
  });
});
