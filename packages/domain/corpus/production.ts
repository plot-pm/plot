import { execFileSync } from 'node:child_process';

/**
 * PRODUCTION'S OWN READING, taken the way production takes it.
 *
 * This file runs the real scripts and parses their real output. It shares no
 * code with the adapters under test on purpose: an oracle that reused the
 * adapter's parsing could only ever agree with it, and the corpus tier exists
 * because a fixture agrees with whatever wrote it.
 *
 * It is deliberately plain — `execFileSync`, `JSON.parse`, no `PortResult` and
 * no schema. Every convenience the adapter has is a place the two could share a
 * bug.
 */

/** Where the repository and its scripts are. */
export interface Estate {
  /** The repository root, absolute and without a trailing slash. */
  root: string;
}

/** Ten megabytes: the scan's JSON over this estate exceeds the default buffer. */
const MAX_BUFFER = 10 * 1024 * 1024;

/** Ten minutes: the scan is ~21 s here and slower on a saturated runner. */
const TIMEOUT_MS = 600_000;

const scriptIn = (estate: Estate, name: string): string =>
  `${estate.root}/skills/plot/scripts/${name}`;

/**
 * Lists the plan files, the way `plot-plan-meta.sh`'s callers list them.
 *
 * @param estate - the repository to read.
 * @returns the paths relative to the root, in `LC_ALL=C` order.
 */
export const listPlanFiles = (estate: Estate): string[] =>
  execFileSync(
    'bash',
    ['-c', 'find docs/plans -maxdepth 1 -name "*.md" -type f | LC_ALL=C sort'],
    { cwd: estate.root, encoding: 'utf8', maxBuffer: MAX_BUFFER },
  )
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * Reads every plan through `plot-plan-meta.sh`, which is the format contract.
 *
 * @param estate - the repository to read.
 * @param files - the plan paths to parse.
 * @returns one raw record per plan, keyed by the wire's own field names.
 */
export const readPlanMeta = (
  estate: Estate,
  files: readonly string[],
): Record<string, unknown>[] =>
  execFileSync('bash', [scriptIn(estate, 'plot-plan-meta.sh'), ...files], {
    cwd: estate.root,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: TIMEOUT_MS,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

/**
 * Runs `plot-fleet-scan.sh --json` and parses its pulse.
 *
 * stderr is discarded rather than inherited: the scan reports its terminal-state
 * cache there on every run, and inheriting it buries the test output.
 *
 * @param estate - the repository to read.
 * @returns the raw pulse document, under the wire's own field names.
 */
export const readFleetScan = (estate: Estate): Record<string, unknown> =>
  JSON.parse(
    execFileSync('bash', [scriptIn(estate, 'plot-fleet-scan.sh'), '--json'], {
      cwd: estate.root,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  ) as Record<string, unknown>;

/**
 * Runs `plot-fleet-scan.sh --list-eligible` and returns every branch it names.
 *
 * THE CLAIM `--next` ACTS ON. `--list-eligible` is the same computation as
 * `--next` with the head not taken — one flag sets both (`--list-eligible`
 * implies `--next`), so a difference between them is impossible by
 * construction while a difference between either and the pulse is exactly what
 * this tier is for.
 *
 * Exit 1 means *nothing to start*, which is an ANSWER and not a failure — the
 * scan is deliberate about it, because exiting 0 with no output would hand a
 * caller an empty branch name as if it were work. So a non-zero exit yields an
 * empty list here, and the caller distinguishes the two by comparing against
 * what the pulse offers rather than by the exit code.
 *
 * @param estate - the repository to read.
 * @returns the claimable branch names, in the order the scan offered them.
 */
export const readListEligible = (estate: Estate): string[] => {
  try {
    return execFileSync('bash', [scriptIn(estate, 'plot-fleet-scan.sh'), '--list-eligible'], {
      cwd: estate.root,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
};
