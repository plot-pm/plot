import { compareVersions } from '../entities/version.js';

/** The oldest git the object reader runs on: `--batch-command` needs 2.36 and `-z` input 2.42. */
export const GIT_MINIMUM = '2.42.0';

/** `git version X.Y.Z`, with anything git appends after the third part. */
const GIT_VERSION = /^git version (\d+)\.(\d+)(?:\.(\d+))?/;

/**
 * Reads the version `git --version` printed.
 *
 * @param output - the command's output, such as `git version 2.39.5 (Apple Git-154)`.
 * @returns the version as `X.Y.Z`, or null where the output names none.
 */
export const gitVersionOf = (output: string): string | null => {
  const m = GIT_VERSION.exec(output.trim());
  return m === null ? null : `${m[1]}.${m[2]}.${m[3] ?? '0'}`;
};

/**
 * Decides whether a start may run on the git found.
 *
 * @param output - what `git --version` printed; `''` where git did not answer.
 * @returns null for git {@link GIT_MINIMUM} or later, else the refusal line,
 *   naming the minimum and what was found.
 */
export const gitVersionRefusal = (output: string): string | null => {
  const found = gitVersionOf(output);
  if (found !== null && compareVersions(found, GIT_MINIMUM) >= 0) return null;
  const named = found === null ? (output.trim() === '' ? 'no git version' : JSON.stringify(output.trim())) : `git ${found}`;
  return `plot needs git 2.42 or later for its object reader; found ${named}`;
};
