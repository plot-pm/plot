import os from 'node:os';
import { resumeAvailability, type ResumeAvailability } from '@plot-pm/domain';
import { transcriptDir, transcriptFile } from './transcript.js';

/**
 * What a resume needs to know about one agent, without needing the whole entry.
 *
 * Narrowed to the three fields the reading takes so a caller holding a
 * manifest, an `AgentEntry` or a row can ask without inventing the rest.
 */
export interface ResumeSubject {
  /** The resume handle the manifest carries, or `''`. */
  resumeId: string;
  /** The desk the agent ran in — the cwd the runtime keyed its transcript on. */
  worktree: string;
}

/**
 * Whether a correction can be delivered into this agent's own conversation.
 *
 * **THE READ IS THE GATE, AND THIS IS THE ONLY PLACE IT HAPPENS.** Plot exports
 * the session id as `PLOT_SESSION_ID` and documents the `--session-id` an
 * adopting project's `.plot/worker-prompt.sh` must pass on. It can require
 * neither — that file and the harness it invokes belong to the project — so the
 * one honest test is whether a transcript exists under the id Plot asserted.
 *
 * The lookup goes through {@link transcriptFile}, which joins on
 * `${sessionId}.jsonl` and returns null when the file is absent. A second
 * matcher would be a second way to be wrong, and this one is already the board's
 * answer to *which transcript is this agent's*.
 *
 * The DIRECTORY comes from the worktree rather than from the manifest, for the
 * reason the registry's own join gives: the runtime keys its project directory
 * on the cwd it ran in. An agent with no worktree recorded has no directory to
 * look in, which reads as no transcript — unavailable, never a throw.
 *
 * @param subject The handle and the desk it ran at.
 * @param home Override for the runtime's home directory; the test seam, since
 *   the path is absolute by construction.
 * @returns The handle to resume with, or why there is none.
 */
export function readResumeAvailability(
  subject: ResumeSubject,
  home = os.homedir(),
): ResumeAvailability {
  let transcriptFound = false;
  if (subject.resumeId && subject.worktree) {
    try {
      transcriptFound = transcriptFile(transcriptDir(subject.worktree, home), subject.resumeId) !== null;
    } catch {
      // An unreadable home or a directory that vanished is not a transcript.
      // Silence is never permission: unavailable is the safe answer, and the
      // caller starts a fresh worker rather than resuming into nothing.
      transcriptFound = false;
    }
  }
  return resumeAvailability({ resumeId: subject.resumeId, transcriptFound });
}
