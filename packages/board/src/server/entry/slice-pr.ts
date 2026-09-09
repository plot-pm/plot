import {
  isSlicePrRefusal,
  openSlicePr,
  type SlicePrReadings,
  type SlicePrResult,
} from '@plot-pm/domain/rules/slice-pr';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-open-pr.sh` runs, once per slice PR.
 *
 * ```
 * node plot-slice-pr.mjs < readings.json
 * {"outcome":"decided","head":"feature/…","title":"…","body":"…","notice":"carries-work"}
 * ```
 *
 * **THE ACTION THAT HAD NO CONTROLLER.** Measured 2026-09-08 against the nine
 * endpoints the board exposes: four lifecycle actions were performed by hand
 * that afternoon and each had a controller that was not called — and the fifth,
 * opening a PR, had none to skip. Three were opened with `gh pr create`, and
 * the sprint before, fifteen branches carried finished work nobody could see
 * because no PR was raised at all. This is the missing one.
 *
 * **IT ASKS `openSlicePr` AND STOPS ON ITS ANSWER.** The plan measures three
 * endpoints that only spawn — `{"available":true}` in front of a script with
 * zero rule calls — and names them shells rather than controllers. This one
 * performs nothing: it decides, and `plot-open-pr.sh` calls `plot-host.sh
 * pr-create` with what it decided.
 *
 * **A SEVENTEENTH ARTIFACT, for the reason `entry/transition.ts` gives.**
 * `plot-ask.mjs` answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh`,
 * so a script asking the board to open its PR would be a script calling an
 * artifact that calls the script. This bundle spawns nothing and reads nothing
 * — every reading arrives on stdin, taken by the shell that owns the git and
 * host calls.
 *
 * **JSON IN, JSON OUT**, where the transition entries take tab-separated words:
 * the answer carries a multi-line markdown body, and a tab-separated wire would
 * mean the shell re-assembling a shape the rule just composed.
 */

/** What a caller asks: everything the rule decides by. */
export interface Request {
  /** What the shell measured about the branch, its plan and its commits. */
  readonly readings: SlicePrReadings;
  /** Whether to open the PR as a draft. */
  readonly draft: boolean;
}

/**
 * Read one string from a request.
 *
 * @param value - what the field held.
 * @returns the string, or `''` where the field was absent or not a string.
 */
const stringOr = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Read one whole number from a request.
 *
 * AN ABSENT COUNT IS ZERO, and for the commits that is a REFUSAL rather than a
 * guess — `branch-empty` fires, and the shell that failed to count says so
 * rather than opening a PR on a branch it never read.
 *
 * @param value - what the field held.
 * @returns the number, or 0 where the field was absent or not a finite number.
 */
const numberOr = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;

/**
 * Read what the branch's commits carried.
 *
 * ANYTHING BUT `true` OR `false` IS `unknown`, which is the answer that claims
 * nothing. A shell whose `git show` failed sends neither boolean, and reading
 * that absence as `false` would put the *carries no implementation* notice on a
 * branch whose diff was simply never taken.
 *
 * @param value - what the field held.
 * @returns the reading.
 */
const carriedWorkFrom = (value: unknown): boolean | 'unknown' =>
  typeof value === 'boolean' ? value : 'unknown';

/**
 * Read the readings a caller took.
 *
 * @param value - the request's `readings` object, or anything else.
 * @returns the readings, every absent field read as *nothing was found*.
 */
export const readingsFrom = (value: unknown): SlicePrReadings => {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    branch: stringOr(given.branch),
    base: stringOr(given.base),
    planSlug: stringOr(given.planSlug),
    planFile: stringOr(given.planFile),
    sliceName: stringOr(given.sliceName),
    briefFile: stringOr(given.briefFile),
    existingPr: numberOr(given.existingPr),
    commits: numberOr(given.commits),
    carriedWork: carriedWorkFrom(given.carriedWork),
  };
};

/**
 * Parse one request.
 *
 * @param text - the whole of stdin, one JSON object.
 * @returns the request.
 * @throws when stdin is not one JSON object carrying a `readings` object.
 */
export const requestFrom = (text: string): Request => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected one JSON object on stdin');
  }
  const body = parsed as Record<string, unknown>;
  const readings = body.readings;
  if (typeof readings !== 'object' || readings === null || Array.isArray(readings)) {
    throw new Error("expected a 'readings' object — what the shell measured about the branch");
  }
  return { readings: readingsFrom(readings), draft: body.draft === true };
};

/**
 * Decide one slice PR.
 *
 * @param request - what the caller asked.
 * @returns the domain's result — the PR to open, or the rule that refused.
 */
export const decide = (request: Request): SlicePrResult =>
  openSlicePr(request.readings, { draft: request.draft });

/**
 * Read stdin, print the decision.
 *
 * Three exit codes, because the caller repairs them differently. A refusal is
 * the branch's own state and the operator reads the sentence; unreadable input
 * is the caller's bug and no operator can act on it.
 *
 * A REFUSAL IS PRINTED WHOLE, as JSON on stdout and as `reason TAB detail` on
 * stderr: the reason is what a shell branches on without matching prose, and
 * the detail is the half a person acts on.
 *
 * @param text - the whole of stdin.
 * @param write - where the answer goes.
 * @returns the process exit code — 0 decided, 1 refused, 2 unreadable input.
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  let request: Request;
  try {
    request = requestFrom(text);
  } catch (err) {
    process.stderr.write(`plot-slice-pr: ${(err as Error).message}\n`);
    return 2;
  }
  const result = decide(request);
  write(`${JSON.stringify(result)}\n`);
  if (isSlicePrRefusal(result)) {
    process.stderr.write(`${result.reason}\t${result.detail}\n`);
    return 1;
  }
  return 0;
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
//
// AND NO ENTRY IN THIS DIRECTORY IMPORTS ANOTHER, which `entry/stack-readings.ts`
// states: in one bundle both spellings resolve to the bundle's own path, so an
// imported entry's main block matches too and runs FIRST.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
