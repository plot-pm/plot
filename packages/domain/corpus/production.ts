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

/**
 * One pull request, as `plot-host.sh pr-list` reports it.
 *
 * Only the two fields the branch derivation reads. `checks` and `draft` belong
 * to `--loose`, which this tier does not exercise.
 */
export interface PrRow {
  /** The pull request's state, as the host spells it. */
  state: string;
  /** The head branch it was opened from. */
  head: string;
}

/**
 * Runs `plot-host.sh pr-list --state all --rich`, the ONE host call the scan
 * makes per run, and returns its rows.
 *
 * SAME CALL, SAME LIMIT, ONE ROUND TRIP. The scan prefills every branch's PR
 * state from this list and asks per branch only for a branch the list omits;
 * an oracle that asked per branch instead would spend ~48 round trips to
 * re-learn what one call already said, and would measure the host's mood rather
 * than the rule.
 *
 * A non-zero exit yields an empty list, which the caller must read as *the host
 * could not answer* rather than as *this repository has no pull requests* — the
 * two are what `HostReach` exists to keep apart.
 *
 * @param estate - the repository to read.
 * @param limit - the row cap, matching the scan's `PR_LIST_LIMIT`.
 * @returns the rows, and whether the list arrived at all.
 */
export const readPrList = (
  estate: Estate,
  limit = 1000,
): { arrived: boolean; complete: boolean; rows: PrRow[] } => {
  let out: string;
  try {
    out = execFileSync(
      'bash',
      [scriptIn(estate, 'plot-host.sh'), 'pr-list', '--state', 'all', '--limit', String(limit), '--rich'],
      {
        cwd: estate.root,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        timeout: TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    return { arrived: false, complete: false, rows: [] };
  }
  const rows: PrRow[] = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parsed = JSON.parse(trimmed) as { state?: unknown; head?: unknown };
    if (typeof parsed.state !== 'string' || typeof parsed.head !== 'string') continue;
    rows.push({ state: parsed.state, head: parsed.head });
  }
  // The scan's own completeness test: fewer rows than the limit means the host
  // had no more to give. An EMPTY list is not a complete one — a host exiting 0
  // while printing nothing parses to zero rows, and reading that as *no pull
  // requests* derives absence for every branch on the estate.
  return { arrived: true, complete: rows.length > 0 && rows.length < limit, rows };
};

/**
 * Every remote-tracking ref under `origin/`, as `<branch>\t<oid>`.
 *
 * The scan's `REMOTE_REFS` batch, taken the same way: one `for-each-ref` rather
 * than a `show-ref` per branch.
 *
 * @param estate - the repository to read.
 * @returns the branch name to tip oid, for every remote ref.
 */
export const readRemoteRefs = (estate: Estate): Map<string, string> => {
  const out = execFileSync(
    'git',
    ['for-each-ref', '--format=%(refname:strip=3)\t%(objectname)', 'refs/remotes/origin'],
    { cwd: estate.root, encoding: 'utf8', maxBuffer: MAX_BUFFER },
  );
  const refs = new Map<string, string>();
  for (const line of out.split('\n')) {
    const [branch, oid] = line.split('\t');
    if (branch && oid) refs.set(branch, oid);
  }
  return refs;
};

/**
 * Every conforming merge subject on the default branch.
 *
 * `MERGE_SUBJECTS` in the scan: one `git log --merges` per run, capped, because
 * asking per branch is O(history × branches) where O(history + branches) is
 * available.
 *
 * @param estate - the repository to read.
 * @param mainBranch - the default branch's name.
 * @param limit - the walk's cap, matching `MERGE_SCAN_LIMIT`.
 * @returns the subjects, in the order git yielded them.
 */
export const readMergeSubjects = (
  estate: Estate,
  mainBranch: string,
  limit = 2000,
): string[] =>
  execFileSync(
    'git',
    ['log', `origin/${mainBranch}`, '--merges', `--max-count=${limit}`, '--pretty=%s'],
    { cwd: estate.root, encoding: 'utf8', maxBuffer: MAX_BUFFER },
  )
    .split('\n')
    .filter((line) => line.length > 0);

/**
 * How many commits a branch carries beyond the default branch, and how many of
 * those are real work.
 *
 * `real_commits_beyond_main()` in the scan, walked the same way: ONE
 * `git log --shortstat` over the range, classifying each record as it goes.
 *
 * A CLAIM MARKER IS TITLED `plot: claim …` **AND** EMPTY, and both facts are
 * required. `--shortstat` supplies the second: an empty commit produces no stat
 * line, a commit with changes produces one, which is exactly `tree == parent
 * tree` asked once for the whole range. A human commit titled
 * `plot: claim handling refactor` carrying real files therefore counts as work.
 *
 * @param estate - the repository to read.
 * @param baseOid - the default branch's tip.
 * @param tipOid - the branch's tip.
 * @returns the total count and the real count.
 */
export const readCommitsBeyond = (
  estate: Estate,
  baseOid: string,
  tipOid: string,
): { total: number; real: number } => {
  let out: string;
  try {
    out = execFileSync(
      'git',
      ['log', '--format=%H%x09%s', '--shortstat', `${baseOid}..${tipOid}`],
      { cwd: estate.root, encoding: 'utf8', maxBuffer: MAX_BUFFER },
    );
  } catch {
    return { total: 0, real: 0 };
  }
  let total = 0;
  let real = 0;
  let pending = false;
  for (const line of out.split('\n')) {
    if (line.length === 0) continue;
    if (line.includes(' file changed,') || line.includes(' files changed,')) {
      // A stat line: the record before it had changes, so it is real work even
      // if it was claim-titled.
      if (pending) {
        real += 1;
        pending = false;
      }
      continue;
    }
    // A new record. Anything still pending was claim-titled AND produced no
    // stat line — an empty claim marker, which does not count.
    pending = false;
    total += 1;
    const subject = line.slice(line.indexOf('\t') + 1);
    if (subject.startsWith('plot: claim ')) pending = true;
    else real += 1;
  }
  return { total, real };
};

/**
 * The default branch, resolved the way `plot-fleet-scan.sh:294` resolves it.
 *
 * Three steps in order: the `## Plot Config` key, then `origin/HEAD`, then the
 * literal `main`. Reproduced rather than taken from the pulse, because the scan
 * does not report it — and a hardcoded `main` here would make the comparison
 * silently vacuous in a repository that calls it something else.
 *
 * @param estate - the repository to read.
 * @returns the default branch's name.
 */
export const readMainBranch = (estate: Estate): string => {
  const configured = execFileSync(
    'bash',
    [scriptIn(estate, 'plot-config.sh'), 'get', 'Main branch', ''],
    { cwd: estate.root, encoding: 'utf8', maxBuffer: MAX_BUFFER },
  ).trim();
  if (configured !== '') return configured;
  try {
    const head = execFileSync(
      'git',
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: estate.root, encoding: 'utf8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (head !== '') return head.replace(/^origin\//, '');
  } catch {
    // No `origin/HEAD` in this checkout — the scan falls through the same way.
  }
  return 'main';
};

