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

/** A top-level `agent-*` transcript belongs to no session in the directory and is excluded. */
const isSubagentFile = (name: string): boolean => name.startsWith('agent-');

/**
 * The newest mtime, in epoch milliseconds, across the `*.jsonl` files in `dir`
 * that `keep` accepts.
 *
 * @param dir - the directory to read; its subdirectories are not read.
 * @param keep - which file names count.
 * @returns the newest mtime, or `-1` where the directory cannot be read or
 *   holds no counted file.
 */
const newestJsonlMs = async (dir: string, keep: (name: string) => boolean): Promise<number> => {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return -1;
  }
  let newestMs = -1;
  for (const name of names) {
    if (!name.endsWith('.jsonl') || !keep(name)) continue;
    try {
      const info = await stat(join(dir, name));
      if (info.isFile() && info.mtimeMs > newestMs) newestMs = info.mtimeMs;
    } catch {
      continue;
    }
  }
  return newestMs;
};

/**
 * Reads transcripts from the filesystem — the production {@link Transcript}.
 *
 * Reads the newest mtime across every non-`agent-*` `*.jsonl` session file
 * directly inside the worktree's transcript directory and every `*.jsonl` file
 * in each such session's `<session>/subagents/` directory, clamped at zero for
 * a clock skewed into the future.
 *
 * @param options - the transcript home and environment seams.
 * @returns a `Transcript` reading this machine's `~/.claude/projects`.
 */
export const transcriptFs = (options: TranscriptFsOptions = {}): Transcript => {
  const env = options.env ?? process.env;
  const home = options.transcriptHome ?? env[TRANSCRIPT_HOME_ENV] ?? homedir();

  return {
    spoken: async (worktree: string, handle: string): Promise<PortResult<boolean>> => {
      if (worktree === '' || handle === '') return answered(false);
      try {
        return answered((await stat(join(transcriptDirFor(worktree, home), `${handle}.jsonl`))).isFile());
      } catch {
        return answered(false);
      }
    },

    quietSeconds: async (worktree: string): Promise<PortResult<QuietReading>> => {
      if (worktree === '') return answered<QuietReading>({ quiet: 'unavailable' });
      const dir = transcriptDirFor(worktree, home);

      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return answered<QuietReading>({ quiet: 'unavailable' });
      }

      const sessions = names.filter((name) => name.endsWith('.jsonl') && !isSubagentFile(name));
      const readings = await Promise.all([
        newestJsonlMs(dir, (name) => !isSubagentFile(name)),
        ...sessions.map((name) => newestJsonlMs(join(dir, name.slice(0, -'.jsonl'.length), 'subagents'), () => true)),
      ]);
      const newestMs = Math.max(...readings);

      if (newestMs < 0) return answered<QuietReading>({ quiet: 'unavailable' });

      const seconds = Math.max(0, Math.round((Date.now() - newestMs) / 1000));
      return answered<QuietReading>({ quiet: 'seconds', seconds });
    },
  };
};
