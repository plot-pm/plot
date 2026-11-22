import { ROLE_NAMES } from './role-command.js';

/**
 * Whether a session handle may be resumed for a branch.
 *
 * A desk's transcript directory holds the implementer's sessions beside the
 * sessions of role runs that ran with the desk as their working directory,
 * and beside sessions of earlier branches the desk held. This rule names the
 * handles a continuation or a loop run must not resume.
 *
 * @concept resume-handle
 */

/** Why {@link resumeHandleUsable} rejects a handle. */
export type ResumeHandleRejection = 'empty' | 'role-listed' | 'role-transcript' | 'other-branch';

/** What {@link resumeHandleUsable} answers. */
export type ResumeHandleVerdict = { usable: true } | { usable: false; why: ResumeHandleRejection };

/** The head of a handle's transcript: its first line, and the first `gitBranch` value in the read bound (`''` where none). */
export interface TranscriptHead {
  readonly firstLine: string;
  readonly gitBranch: string;
}

/** The readings {@link resumeHandleUsable} decides from. */
export interface ResumeHandleReadings {
  /** The candidate handle. */
  readonly handle: string;
  /** The branch the run resumes for. */
  readonly branch: string;
  /** The handles the desk's role-session record lists; empty where no record is readable. */
  readonly roleSessions: ReadonlySet<string>;
  /** The handle's transcript head, or `null` where no transcript exists. */
  readonly head: TranscriptHead | null;
}

/** Whether a transcript's first line is the `agent-setting` line of a declared role. */
const opensAsRole = (firstLine: string): boolean => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const { type, agentSetting } = parsed as { type?: unknown; agentSetting?: unknown };
  return type === 'agent-setting' && typeof agentSetting === 'string' && (ROLE_NAMES as readonly string[]).includes(agentSetting);
};

/**
 * Decides whether `handle` may be resumed for `branch`.
 *
 * Rejects, in this order: an empty handle (`empty`); a handle the role-session
 * record lists (`role-listed`); a handle whose transcript's first line is an
 * `agent-setting` line naming a role in `ROLE_NAMES` (`role-transcript`); a
 * handle whose transcript records a non-empty `gitBranch` other than `branch`
 * (`other-branch`). A `null` head, an unparseable first line, a first line of
 * another `type` or naming an undeclared agent, and an empty `gitBranch` do
 * not reject.
 *
 * @param readings - the handle, the branch, the role-session record and the transcript head.
 * @returns `{ usable: true }`, or `{ usable: false, why }`.
 */
export const resumeHandleUsable = ({ handle, branch, roleSessions, head }: ResumeHandleReadings): ResumeHandleVerdict => {
  if (handle === '') return { usable: false, why: 'empty' };
  if (roleSessions.has(handle)) return { usable: false, why: 'role-listed' };
  if (head === null) return { usable: true };
  if (opensAsRole(head.firstLine)) return { usable: false, why: 'role-transcript' };
  if (head.gitBranch !== '' && head.gitBranch !== branch) return { usable: false, why: 'other-branch' };
  return { usable: true };
};
