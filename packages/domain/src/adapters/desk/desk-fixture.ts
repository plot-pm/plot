import { answered, failed, type PortResult } from '../../port-result.js';
import type { Desk, DeskFinding, EndingRecord } from '../../ports/desk.js';

/** Every call this estate received, for a test to assert against. */
export interface DeskFixtureCalls {
  endings: { worktree: string; record: EndingRecord }[];
  blockedMarkers: { worktree: string; text: string }[];
  declarations: { worktree: string; branch: string; status?: 'ok' | 'blocked' }[];
  corrections: { worktree: string; branch: string; text: string; attempt: number; budget: number }[];
  limitedRecords: { worktree: string; resetEpoch: number; resetIso: string; limitLine: string }[];
  limitedClears: string[];
  moves: { from: string; to: string }[];
  findings: { worktree: string; finding: DeskFinding }[];
}

/** What a fixture `Desk` answers from, and what it records having been asked. */
export interface DeskFixture {
  /** Worktrees that already carry a `PLOT-BLOCKED*` marker — `writeBlockedMarker` no-ops on these. */
  markedWorktrees?: readonly string[];
  /** Worktrees whose declaration file exists and does not parse — `sealDeclaration` fails on these. */
  unreadableDeclarations?: readonly string[];
  /** Every call received, filled in as the fixture is used. */
  calls?: Partial<DeskFixtureCalls>;
}

/** A fresh, empty call log, so a caller need not pre-fill every array. */
export const deskFixtureCalls = (): DeskFixtureCalls => ({
  endings: [],
  blockedMarkers: [],
  declarations: [],
  corrections: [],
  limitedRecords: [],
  limitedClears: [],
  moves: [],
  findings: [],
});

/**
 * Answers desk-write questions from a table instead of the filesystem.
 *
 * The driven-side twin of `deskFs`: same port, no disk behind it. Every
 * operation records its call, so a test can assert on what was asked without
 * reading a tmpdir back.
 *
 * @param fixture - what this estate already holds, and where to record calls.
 * @returns a `Desk` backed by that fixture.
 */
export const deskFixture = (fixture: DeskFixture = {}): Desk => {
  const marked = new Set(fixture.markedWorktrees ?? []);
  const unreadable = new Set(fixture.unreadableDeclarations ?? []);
  const calls = fixture.calls ?? {};

  return {
    writeEnding: async (worktree, record): Promise<PortResult<void>> => {
      calls.endings?.push({ worktree, record });
      return answered(undefined);
    },

    writeBlockedMarker: async (worktree, text): Promise<PortResult<void>> => {
      // NO-OVERWRITE, matching `deskFs`: a worktree already marked gets no
      // second write recorded.
      if (marked.has(worktree)) return answered(undefined);
      calls.blockedMarkers?.push({ worktree, text });
      marked.add(worktree);
      return answered(undefined);
    },

    sealDeclaration: async (worktree, branch, status): Promise<PortResult<void>> => {
      if (branch === '') return failed<void>();
      if (unreadable.has(worktree)) return failed<void>();
      calls.declarations?.push(status === undefined ? { worktree, branch } : { worktree, branch, status });
      return answered(undefined);
    },

    writeCorrection: async (worktree, branch, text, attempt, budget): Promise<PortResult<void>> => {
      calls.corrections?.push({ worktree, branch, text, attempt, budget });
      return answered(undefined);
    },

    writeLimitedRecord: async (worktree, resetEpoch, resetIso, limitLine): Promise<PortResult<void>> => {
      calls.limitedRecords?.push({ worktree, resetEpoch, resetIso, limitLine });
      return answered(undefined);
    },

    clearLimitedRecord: async (worktree): Promise<PortResult<void>> => {
      calls.limitedClears?.push(worktree);
      return answered(undefined);
    },

    moveWorkerRecord: async (from, to): Promise<PortResult<void>> => {
      calls.moves?.push({ from, to });
      return answered(undefined);
    },

    publishFinding: async (worktree, finding): Promise<PortResult<void>> => {
      calls.findings?.push({ worktree, finding });
      return answered(undefined);
    },
  };
};
