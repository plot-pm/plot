import type { PortResult } from '../port-result.js';

/**
 * One desk's transcript reading, the input {@link idleNow} (`rules/sample.ts`)
 * scores.
 *
 * Mirrors `plot_transcript_quiet_seconds`'s own answer shape
 * (`plot-transcript-quiet.sh`): a duration where a transcript could be read,
 * `unavailable` where none could — never zero, which would read a desk with no
 * transcript at all as freshly active.
 */
export type QuietReading = { readonly quiet: 'seconds'; readonly seconds: number } | { readonly quiet: 'unavailable' };

/**
 * Reads an agent's transcript — the evidence `idleNow` needs to tell a
 * thinking agent from a silent one.
 *
 * **THE AGENT, NOT THE MACHINE.** A CPU sample answers *is this process on a
 * core right now*, which is zero for most of a working agent's life; this
 * reads the newest write any of a worktree's own transcript files has made,
 * which is what a desk's silence actually means.
 *
 * **ONE OPERATION, MATCHING THE SHELL'S OWN SCOPE.** `plot-transcript-quiet.sh`
 * also answers `plot_transcript_exists` (a session-flag question `boundedRun`'s
 * caller asks once per prompt start, not once per pass) — that reading is
 * outside this port, which exists for the per-pass idle watch alone.
 */
export interface Transcript {
  /**
   * Seconds since the worktree's newest transcript line, across every session
   * file the runtime holds for it — a worker that hopped waves, or an
   * operator's own session at the same desk, can leave more than one.
   *
   * A subagent's own transcript (a file named `agent-*`) is excluded: it is a
   * true statement about the wrong process, and a worker whose subagent is
   * still writing while the worker itself has stopped must read as quiet.
   *
   * @param worktree - the desk's absolute path.
   * @returns the quiet duration, or `unavailable` where no transcript directory
   *   exists, the directory holds no session file, or the worktree is `''`.
   *   Never `unaskable` and never `failed` — a transcript this port cannot find
   *   is the same first-class answer the shell gives, not a port failure.
   */
  quietSeconds(worktree: string): Promise<PortResult<QuietReading>>;

  /**
   * Whether a conversation has written its transcript yet.
   *
   * Asked as a file's existence, never as a time: until a new conversation
   * writes its first line, the desk's newest transcript belongs to the previous
   * one. The loop reads it to choose `--session-id` or `--resume`, and the idle
   * watch reads it before it calls a quiet desk idle.
   *
   * @param worktree - the desk's absolute path.
   * @param handle - the conversation's session id.
   * @returns true where `<transcript dir>/<handle>.jsonl` exists; false for an
   *   empty path or handle, or no such file.
   */
  spoken(worktree: string, handle: string): Promise<PortResult<boolean>>;
}
