import { appendFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { encodeSliceSpend, type SliceSpend } from '../../entities/slice-spend.js';
import type { TranscriptLine } from '../../rules/slice-tokens.js';
import type { SliceSpendRecord } from '../../ports/slice-spend.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable that names the record's directory, for tests.
 *
 * A suite that wrote to the operator's own record would put fixture token
 * counts into the file a rollup reads.
 */
export const SLICE_SPEND_HOME_ENV = 'PLOT_SLICE_SPEND_HOME';

/**
 * The environment variable that names the transcript home, for tests.
 *
 * `~/.claude` is absolute by construction, so a test with no seam here would
 * have to read the developer's real transcripts.
 */
export const TRANSCRIPT_HOME_ENV = 'PLOT_TRANSCRIPT_HOME';

/** The record's filename, under the common git dir's `.plot/state/`. */
const FILE = 'slice-spend.jsonl';

/** The seams the adapter needs so a test never touches the operator's own files. */
export interface SliceSpendFileOptions {
  /** The repository to resolve the record for; the process's cwd when omitted. */
  cwd?: string;
  /** An explicit record directory, bypassing the git lookup. */
  home?: string;
  /** An explicit transcript home, standing in for `~`. */
  transcriptHome?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * Where the runtime keeps a worktree's transcripts.
 *
 * The slug is the absolute path with `/` and `.` both replaced by `-`. Measured
 * against this estate's own worktrees; the dots matter because worktree paths
 * routinely contain them.
 *
 * @param worktree - the desk's absolute path.
 * @param home - the transcript home, standing in for `~`.
 * @returns the directory the runtime writes that desk's sessions to.
 */
export const transcriptDirFor = (worktree: string, home: string): string =>
  join(home, '.claude', 'projects', resolve(worktree).replace(/[/.]/g, '-'));

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Reads and appends the per-slice spend record for ONE repository.
 *
 * **THE PATH COMES FROM `--git-common-dir`, AND THAT IS THE ADAPTER'S WHOLE
 * REASON FOR EXISTING SEPARATELY.** Measured 2026-09-15 in a linked worktree:
 *
 * ```
 * --show-toplevel   → …/.worktrees/feature-one-monitor-watches-the-slice   ← the DESK
 * --git-common-dir  → …/plot/.git                                          ← shared
 * ```
 *
 * Every existing writer uses `--show-toplevel`, and `plot-reap.sh` runs
 * `git worktree remove --force` over the desks. A record written to the desk is
 * destroyed by the reap on the machine that measured it, with every gate green,
 * because a test run in the main checkout cannot see the difference.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a `SliceSpendRecord` backed by one file per repository.
 */
export const sliceSpendFile = (options: SliceSpendFileOptions = {}): SliceSpendRecord => {
  const env = options.env ?? process.env;

  /**
   * The record's directory, from the COMMON git dir.
   *
   * Cached per adapter instance: the answer cannot change while a process runs,
   * and the write path would otherwise fork `git` on every append.
   */
  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[SLICE_SPEND_HOME_ENV];
    if (override !== undefined && override !== '') return override;
    if (cached !== undefined) return cached;
    const run = await runProcess('git', ['rev-parse', '--git-common-dir'], { cwd: options.cwd });
    const out = run.stdout.trim();
    if (run.code !== 0 || out === '') {
      cached = null;
      return cached;
    }
    // `--git-common-dir` answers relatively in the checkout it is run from, so
    // it is resolved against the cwd rather than trusted as absolute.
    cached = join(resolve(options.cwd ?? process.cwd(), out), '.plot', 'state');
    return cached;
  };

  const pathOf = async (): Promise<string | null> => {
    const dir = await dirOf();
    return dir === null ? null : join(dir, FILE);
  };

  const transcriptHome = (): string | null => {
    if (options.transcriptHome !== undefined && options.transcriptHome !== '') {
      return options.transcriptHome;
    }
    const override = env[TRANSCRIPT_HOME_ENV];
    if (override !== undefined && override !== '') return override;
    const home = homedir();
    return home === '' ? null : home;
  };

  return {
    location: (): PortResult<string> => {
      // Reported synchronously from the cache where the async path has already
      // resolved it, and from an override otherwise — `location` exists to tell
      // an operator where to look, not to start a subprocess.
      if (options.home !== undefined && options.home !== '') {
        return answered(join(options.home, FILE));
      }
      const override = env[SLICE_SPEND_HOME_ENV];
      if (override !== undefined && override !== '') return answered(join(override, FILE));
      return cached === undefined || cached === null
        ? failed<string>()
        : answered(join(cached, FILE));
    },

    sessions: async (
      worktree: string,
    ): Promise<PortResult<readonly (readonly TranscriptLine[])[]>> => {
      const home = transcriptHome();
      if (home === null) return failed<readonly (readonly TranscriptLine[])[]>();
      const dir = transcriptDirFor(worktree, home);
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (error) {
        // A DESK WITH NO TRANSCRIPT DIRECTORY HAS NO SESSIONS, which is an
        // answer — a worker that never ran, or a home the runtime does not use.
        // Every other error is a failure, so an unreadable directory is never
        // read as an empty one.
        if (isMissing(error)) return answered([]);
        return failed<readonly (readonly TranscriptLine[])[]>();
      }
      const sessions: TranscriptLine[][] = [];
      // SORTED so the read is deterministic. Order across sessions does not
      // change a sum, but it does decide `models` ordering, and a record whose
      // field order shifts between runs is one nobody can diff.
      for (const entry of entries.sort()) {
        // A subagent's transcript is a true statement about the wrong process.
        if (!entry.endsWith('.jsonl') || entry.startsWith('agent-')) continue;
        const full = join(dir, entry);
        let text: string;
        try {
          const st = await stat(full);
          if (!st.isFile()) continue;
          text = await readFile(full, 'utf8');
        } catch {
          // A file that vanished between readdir and read contributes nothing.
          // It is not a failure of the directory, which was read.
          continue;
        }
        const lines: TranscriptLine[] = [];
        for (const line of text.split('\n')) {
          if (line.trim() === '') continue;
          try {
            const parsed: unknown = JSON.parse(line);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              lines.push(parsed as TranscriptLine);
            }
          } catch {
            // A torn tail is not JSON and describes nothing.
            continue;
          }
        }
        if (lines.length > 0) sessions.push(lines);
      }
      return answered(sessions);
    },

    append: async (record: SliceSpend): Promise<PortResult<void>> => {
      const path = await pathOf();
      if (path === null) return failed<void>();
      try {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${encodeSliceSpend(record)}\n`, { encoding: 'utf8' });
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },

    lines: async (): Promise<PortResult<readonly string[]>> => {
      const path = await pathOf();
      if (path === null) return failed<readonly string[]>();
      try {
        const text = await readFile(path, 'utf8');
        return answered(text.split('\n').filter((line) => line !== ''));
      } catch (error) {
        // A MISSING FILE IS AN EMPTY RECORD — the state of every checkout that
        // has measured no slice yet. Reporting it as `failed` would make a
        // fresh checkout look broken, and `readSpend` keeps `absent` and
        // `unreadable` apart precisely so this distinction survives.
        if (isMissing(error)) return answered([]);
        return failed<readonly string[]>();
      }
    },
  };
};
