import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { answered, type PortResult } from '../../port-result.js';
import type { QuietReading, Transcript } from '../../ports/transcript.js';
import { transcriptDirFor, TRANSCRIPT_HOME_ENV } from '../slice-spend/slice-spend-file.js';

/** The seams a test needs so it never reads the operator's own transcripts. */
export interface TranscriptFsOptions {
  /** An explicit transcript home, standing in for `~`. */
  transcriptHome?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/** A subagent's own transcript names the wrong process — excluded, as the shell excludes it. */
const isSubagentFile = (name: string): boolean => name.startsWith('agent-');

/**
 * Reads transcripts from the filesystem — the production {@link Transcript}.
 *
 * Matches `plot_transcript_quiet_seconds` (`plot-transcript-quiet.sh`) exactly:
 * the newest mtime across every non-`agent-*` `*.jsonl` file directly inside
 * the worktree's transcript directory, clamped at zero for a clock skewed into
 * the future.
 *
 * @param options - the transcript home and environment seams.
 * @returns a `Transcript` reading this machine's `~/.claude/projects`.
 */
export const transcriptFs = (options: TranscriptFsOptions = {}): Transcript => {
  const env = options.env ?? process.env;
  const home = options.transcriptHome ?? env[TRANSCRIPT_HOME_ENV] ?? homedir();

  return {
    quietSeconds: async (worktree: string): Promise<PortResult<QuietReading>> => {
      if (worktree === '') return answered<QuietReading>({ quiet: 'unavailable' });
      const dir = transcriptDirFor(worktree, home);

      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return answered<QuietReading>({ quiet: 'unavailable' });
      }

      let newestMs = -1;
      for (const name of names) {
        if (!name.endsWith('.jsonl') || isSubagentFile(name)) continue;
        try {
          const info = await stat(join(dir, name));
          const mtimeMs = info.mtimeMs;
          if (mtimeMs > newestMs) newestMs = mtimeMs;
        } catch {
          continue;
        }
      }

      if (newestMs < 0) return answered<QuietReading>({ quiet: 'unavailable' });

      const seconds = Math.max(0, Math.round((Date.now() - newestMs) / 1000));
      return answered<QuietReading>({ quiet: 'seconds', seconds });
    },
  };
};
