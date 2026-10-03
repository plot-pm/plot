import { describe, expect, it } from 'vitest';
import {
  deskExit,
  deskLifecycle,
  deskState,
  REFUSALS_LOG,
  type DeskReadings,
  type DeskState,
} from '../src/rules/desk-lifecycle.js';

/** Every member of {@link DeskState}, named once so totality is tested over the real set. */
const EVERY_STATE: readonly DeskState[] = [
  'working',
  'finished',
  'orphaned',
  'refused-empty',
  'refused-with-work',
  'holding-work',
  'unplaced',
];

/**
 * A clean, claimed, unmerged desk with nothing on the floor and no worker —
 * every test below names the ONE reading it changes.
 */
const base = (over: Partial<DeskReadings> = {}): DeskReadings => ({
  workerPid: null,
  dirtyPath: '',
  blockedMarker: false,
  merge: 'not-merged',
  fileChangingCommits: 0,
  claimRef: true,
  markerRecordsWork: false,
  manifestKnown: true,
  ...over,
});

describe('deskExit — totality over DeskState', () => {
  it('maps every declared state to an exit', () => {
    for (const state of EVERY_STATE) {
      expect(deskExit(state)).toBeDefined();
    }
  });

  it('gives every exit of a person a non-empty reason', () => {
    for (const state of EVERY_STATE) {
      const exit = deskExit(state);
      if (exit.kind === 'person') {
        expect(exit.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('deskState — a live worker outranks everything else', () => {
  it('reads working whatever else the desk holds', () => {
    const working = base({
      workerPid: '4242',
      blockedMarker: true,
      dirtyPath: 'M a.ts',
      merge: 'merged',
      claimRef: false,
    });
    expect(deskState(working)).toBe('working');
    expect(deskExit('working')).toEqual({ kind: 're-read' });
  });

  it('reads no pid as no worker — an empty pid record does not mask a marker', () => {
    // An empty pid file is not a live process. If it masked the marker check
    // the desk would read `working` for the wrong reason — a live worker —
    // rather than for the reason this slice gives healthy claimed desks.
    expect(deskState(base({ workerPid: '', blockedMarker: true }))).toBe('refused-empty');
  });
});

describe('deskState — an unmerged desk with nothing stuck is not drift either', () => {
  it('reads a claimed, clean desk with no marker and no live worker as working — re-read, not report', () => {
    // Every active branch on the estate: a claim ref, nothing on the floor,
    // not yet merged, no question for a person. Reporting this as any of the
    // other six states would make the sweep's output grow with the fleet's
    // health rather than with its problems — the same exclusion the old
    // `NEEDS_A_PERSON` set made for `no-merged-pr` alone.
    const healthy = base();
    expect(deskState(healthy)).toBe('working');
    expect(deskExit('working')).toEqual({ kind: 're-read' });
  });
});

describe('deskState — unplaced, read before anything else about the desk', () => {
  it('reads unplaced when no manifest names the desk', () => {
    expect(deskState(base({ manifestKnown: false }))).toBe('unplaced');
  });

  it('a person resolves it', () => {
    expect(deskExit('unplaced').kind).toBe('person');
  });
});

describe('deskState — finished, read from the host merge answer', () => {
  it('reads finished once the host says merged, clean tree', () => {
    expect(deskState(base({ merge: 'merged' }))).toBe('finished');
  });

  it('reaps a finished desk outright', () => {
    expect(deskExit('finished')).toEqual({ kind: 'reap' });
  });

  it('never reads finished from an unreachable host', () => {
    expect(deskState(base({ merge: 'unreachable' }))).not.toBe('finished');
  });
});

describe('deskState — orphaned: all four hold at once', () => {
  it('reads a claim-only desk with no claim ref, no worker, no marker, clean tree as orphaned', () => {
    const orphaned = base({ claimRef: false, fileChangingCommits: 0 });
    expect(deskState(orphaned)).toBe('orphaned');
  });

  it('is detached then reaped', () => {
    expect(deskExit('orphaned')).toEqual({ kind: 'detach-then-reap' });
  });

  it('a missing claim ref alone is not orphaned — a file-changing commit keeps it as holding-work', () => {
    const holding = base({ claimRef: false, fileChangingCommits: 1 });
    expect(deskState(holding)).toBe('holding-work');
  });

  it('a missing claim ref alone is not orphaned — uncommitted work keeps it as holding-work', () => {
    const holding = base({ claimRef: false, dirtyPath: 'M a.ts' });
    expect(deskState(holding)).toBe('holding-work');
  });

  it('a missing claim ref alone is not orphaned — unpushed commits keep it as holding-work', () => {
    const holding = base({ claimRef: false, unpushed: ['a1b2c3d'] });
    expect(deskState(holding)).toBe('holding-work');
  });

  it('rejects reading an absent claim ref alone as unknown-keep — the estate measured this exact case', () => {
    // free-50562867: one claim commit, no file changed, no ref, dead worker.
    // `plot-worker-loop.sh:963-972` read the missing `@{upstream}` as unknown
    // and kept the desk; this rule reads all four and reaches `orphaned`.
    const measured = base({ claimRef: false, fileChangingCommits: 0, workerPid: null });
    expect(deskState(measured)).toBe('orphaned');
  });
});

describe('deskState — refused-empty vs refused-with-work', () => {
  it('reads refused-empty: only a marker, no worker, no file-changing commit, clean tree', () => {
    const empty = base({ blockedMarker: true, markerRecordsWork: false });
    expect(deskState(empty)).toBe('refused-empty');
  });

  it('is reapable, after its marker text is copied to the refusals log', () => {
    expect(deskExit('refused-empty')).toEqual({
      kind: 'copy-then-reap',
      destination: REFUSALS_LOG,
    });
  });

  it('reads refused-with-work: the same desk with one extra dirty path', () => {
    const withWork = base({ blockedMarker: true, markerRecordsWork: true, dirtyPath: 'M a.ts' });
    expect(deskState(withWork)).toBe('refused-with-work');
  });

  it('reads refused-with-work: the same desk with one file-changing commit', () => {
    const withWork = base({
      blockedMarker: true,
      markerRecordsWork: true,
      fileChangingCommits: 1,
    });
    expect(deskState(withWork)).toBe('refused-with-work');
  });

  it('is not reapable — a person resolves it, named on the board', () => {
    const exit = deskExit('refused-with-work');
    expect(exit.kind).toBe('person');
    expect(exit.kind === 'person' && exit.reason).toContain('PLOT-BLOCKED');
  });

  it('markerRecordsWork is a reading the caller supplies, not a parse of the marker text', () => {
    // The rule never looks at marker prose; it trusts the caller's answer.
    const trusted = base({ blockedMarker: true, markerRecordsWork: true });
    expect(deskState(trusted)).toBe('refused-with-work');
  });
});

describe('deskState — holding-work', () => {
  it('reads holding-work: unlanded work, no marker, no live worker', () => {
    const holding = base({ fileChangingCommits: 2 });
    expect(deskState(holding)).toBe('holding-work');
  });

  it('a person decides whether to push it or let it go', () => {
    expect(deskExit('holding-work').kind).toBe('person');
  });

  it('dirty paths beside a clean claim ref also read holding-work', () => {
    expect(deskState(base({ dirtyPath: 'M a.ts' }))).toBe('holding-work');
  });

  it('unpushed commits alone also read holding-work', () => {
    expect(deskState(base({ unpushed: ['a1b2c3d'] }))).toBe('holding-work');
  });
});

describe('deskState — unknown never licenses a removal', () => {
  it('unknown unpushed, no claim ref, is not orphaned and not finished', () => {
    const unknown = base({ claimRef: false, unpushed: 'unknown' });
    const state = deskState(unknown);
    expect(state).not.toBe('orphaned');
    expect(state).not.toBe('finished');
    expect(state).toBe('holding-work');
    expect(deskExit(state).kind).not.toBe('reap');
    expect(deskExit(state).kind).not.toBe('detach-then-reap');
  });
});

describe('deskLifecycle — state and exit together', () => {
  it('answers both in one call', () => {
    expect(deskLifecycle(base({ merge: 'merged' }))).toEqual({
      state: 'finished',
      exit: { kind: 'reap' },
    });
  });
});
