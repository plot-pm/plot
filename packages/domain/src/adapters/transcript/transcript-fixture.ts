import { answered, type PortResult } from '../../port-result.js';
import type { QuietReading, Transcript } from '../../ports/transcript.js';

/** What a fixture `Transcript` answers from, keyed by worktree. */
export interface TranscriptFixture {
  /** Each worktree's reading; a worktree absent here answers `unavailable`. */
  readings?: Readonly<Record<string, QuietReading>>;
  /** The conversations that have written, as `<worktree>\t<handle>` keys. */
  spoken?: readonly string[];
}

/**
 * Answers transcript questions from a table instead of the filesystem.
 *
 * @param fixture - the readings to answer from.
 * @returns a `Transcript` backed by that table.
 */
export const transcriptFixture = (fixture: TranscriptFixture = {}): Transcript => {
  const readings = fixture.readings ?? {};
  const spoken = new Set(fixture.spoken ?? []);
  return {
    spoken: async (worktree: string, handle: string): Promise<PortResult<boolean>> =>
      answered(spoken.has(`${worktree}\t${handle}`)),

    quietSeconds: async (worktree: string): Promise<PortResult<QuietReading>> =>
      answered<QuietReading>(readings[worktree] ?? { quiet: 'unavailable' }),
  };
};
