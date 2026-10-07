import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import type { PlanSlices } from '../src/rules/branch-state.js';

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
 * @param slug - a plan slug, to scan that plan alone.
 * @returns the raw pulse document, under the wire's own field names.
 */
export const readFleetScan = (estate: Estate, slug?: string): Record<string, unknown> =>
  JSON.parse(
    execFileSync('bash', [scriptIn(estate, 'plot-fleet-scan.sh'), '--json', ...(slug ? [slug] : [])], {
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
 * `fetch: false` adds `--offline`, which skips the scan's `git fetch` and
 * nothing else: `--list-eligible` still asks the host, because the flag that
 * implies `--next` sets `HOST_LOOKUP_OK` itself (`plot-fleet-scan.sh:577`). A
 * caller that has just fetched through another scan passes it, so both
 * readings see one `origin/<main>`.
 *
 * @param estate - the repository to read.
 * @param options - `fetch`: whether the scan fetches first; default `true`.
 * @returns the claimable branch names, in the order the scan offered them.
 */
export const readListEligible = (
  estate: Estate,
  { fetch = true }: { fetch?: boolean } = {},
): string[] => {
  const flags = fetch ? ['--list-eligible'] : ['--offline', '--list-eligible'];
  try {
    return execFileSync('bash', [scriptIn(estate, 'plot-fleet-scan.sh'), ...flags], {
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
 * How far the host got — `HOST_VERDICT`'s words, derived the way the scan
 * derives them.
 *
 * `unasked` IS NOT A FAILURE, and collapsing it into one is what broke this
 * tier's first CI run. `plot-fleet-scan.sh:700` reads the CLI's stderr because
 * *"an unauthenticated CLI and a genuine mid-answer failure arrive with the
 * SAME status"* — exit 3 for both, since `plot-host.sh` treats a missing token
 * as *the op cannot proceed*. A repository with no remote lands there too.
 *
 * The direction matters and is the whole point: `failed` makes every branch
 * `unknown`, so a checkout with no credentials reports an estate on which
 * nothing can be started. Measured 2026-09-06 — CI's corpus job sets no
 * `GH_TOKEN`, so this oracle read `failed` and derived `unknown` for all 48
 * unstarted branches while the scan beside it read `unasked` and derived `open`.
 */
export type HostVerdict = 'ok' | 'unasked' | 'throttled' | 'secondary' | 'failed';

/**
 * The wordings a CLI uses when it has no identity, as the scan matches them.
 *
 * MEASURED, NOT GUESSED — the scan's own comment records that an earlier list
 * matched `auth`, `login` and `credential` and MISSED what GitHub Actions
 * actually emits, which contains none of those words. Reproduced here from that
 * list rather than re-derived, because a second guess would fail the same way.
 */
const UNASKED_PATTERNS: readonly RegExp[] = [
  /token/i,
  /auth/i,
  /login/i,
  /credential/i,
  /not logged/i,
  /no git remotes?/i,
];

const classifyHostFailure = (status: number | undefined, stderr: string): HostVerdict => {
  if (status === 5) return 'throttled';
  if (status === 6) return 'secondary';
  if (status === 4) return 'unasked';
  return UNASKED_PATTERNS.some((pattern) => pattern.test(stderr)) ? 'unasked' : 'failed';
};

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
 * A failure is CLASSIFIED rather than collapsed — see {@link HostVerdict}. The
 * caller needs *the question was never put* apart from *the question went
 * unanswered*, because the rule under test produces different states for them.
 *
 * @param estate - the repository to read.
 * @param limit - the row cap, matching the scan's `PR_LIST_LIMIT`.
 * @returns the rows, how far the host got, and whether the list was whole.
 */
export const readPrList = (
  estate: Estate,
  limit = 1000,
): { verdict: HostVerdict; complete: boolean; rows: PrRow[] } => {
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
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    const failure = error as { status?: number; stderr?: Buffer | string };
    const stderr = failure.stderr === undefined ? '' : String(failure.stderr);
    return { verdict: classifyHostFailure(failure.status, stderr), complete: false, rows: [] };
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
  return { verdict: 'ok', complete: rows.length > 0 && rows.length < limit, rows };
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

/**
 * Every plan of the estate, enumerated the way `plot-fleet-scan.sh`'s
 * `enumerate_estate` enumerates it in ref mode, and parsed by
 * `plot-plan-meta.sh`.
 *
 * The plan directory of `origin/<main>`, one level, following a symlink to its
 * target; then, for every `origin/` branch under a configured prefix in
 * `for-each-ref` order, each regular `.md` file under the plan directory that
 * the default branch does not carry and no earlier branch supplied. Read from
 * git and never from the working tree, because the scan reads the ref.
 *
 * @param estate - the repository to read.
 * @param mainBranch - the default branch's name.
 * @returns one raw `plot-plan-meta.sh` record per plan.
 */
export const readEstatePlanMeta = (estate: Estate, mainBranch: string): Record<string, unknown>[] => {
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: estate.root, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  const config = (key: string, fallback: string): string =>
    execFileSync('bash', [scriptIn(estate, 'plot-config.sh'), 'get', key, fallback], {
      cwd: estate.root,
      encoding: 'utf8',
    }).trim();
  const planDir = config('Plan directory', 'docs/plans/');
  const prefixes = config('Branch prefixes', 'idea/, feature/, bug/, docs/, infra/')
    .split(',')
    .map((p) => p.trim().replace(/\/$/, ''))
    .filter((p) => p !== '');
  const tree = (ref: string): { mode: string; path: string }[] =>
    git('ls-tree', '-z', ref, '--', planDir)
      .split('\0')
      .filter((line) => line.endsWith('.md'))
      .map((line) => ({ mode: line.split(' ')[0] ?? '', path: line.split('\t')[1] ?? '' }));
  const dir = mkdtempSync(join(tmpdir(), 'plot-estate-plans-'));
  try {
    const files: string[] = [];
    const take = (ref: string, path: string): void => {
      const target = join(dir, String(files.length));
      mkdirSync(target);
      const file = join(target, basename(path));
      writeFileSync(file, `${git('show', `${ref}:${path}`).replace(/\n$/, '')}\n`);
      files.push(file);
    };
    const main = `origin/${mainBranch}`;
    const onDefault = new Set<string>();
    for (const { mode, path } of tree(main)) {
      onDefault.add(path);
      if (mode !== '120000') {
        take(main, path);
        continue;
      }
      const link = git('show', `${main}:${path}`).trim();
      const resolved = link.startsWith('/') ? `${planDir}${basename(link)}` : join(dirname(path), link);
      take(main, resolved);
    }
    const seen = new Set<string>();
    const branches = git('for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin')
      .split('\n')
      .filter((b) => b !== '' && b !== 'HEAD' && b !== mainBranch)
      .filter((b) => prefixes.some((p) => b.startsWith(`${p}/`)));
    for (const branch of branches) {
      for (const { mode, path } of tree(`origin/${branch}`)) {
        if (!['100644', '100755'].includes(mode) || onDefault.has(path) || seen.has(path)) continue;
        seen.add(path);
        take(`origin/${branch}`, path);
      }
    }
    return files.length === 0 ? [] : readPlanMeta(estate, files);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Every plan of the estate as `namedSlices` reads it: `readEstatePlanMeta`,
 * with each plan's phase and every slice of its `waves` wire field.
 *
 * @param estate - the repository to read.
 * @param mainBranch - the default branch's name.
 * @returns one entry per plan.
 */
export const readEstatePlanSlices = (estate: Estate, mainBranch: string): PlanSlices[] =>
  readEstatePlanMeta(estate, mainBranch).map((meta) => ({
    phase: String(meta.phase ?? ''),
    slices: ((meta.waves ?? []) as { branches?: { branch?: string; deferred?: boolean }[] }[]).flatMap(
      (slice) => (slice.branches ?? []).map((b) => ({ branch: b.branch ?? '', deferred: b.deferred === true })),
    ),
  }));

/**
 * Runs `plot-fleet-scan.sh --slice-names`: the set a `waits:` name is looked
 * up in.
 *
 * @param estate - the repository to read.
 * @param slug - a plan slug, to read the set as a slug run reads it.
 * @returns the branch names, in the order the scan printed them.
 */
export const readSliceNames = (estate: Estate, slug?: string): string[] =>
  execFileSync('bash', [scriptIn(estate, 'plot-fleet-scan.sh'), '--slice-names', ...(slug ? [slug] : [])], {
    cwd: estate.root,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split('\n')
    .filter((line) => line !== '');

/**
 * One MoSCoW item, as `plot-sprint-release.sh` reports it.
 *
 * BOTH THE READINGS AND THE VERDICT. `checked`, `slug` and `delivered` are what
 * `item_state` was given; `state` is what it answered. A rule comparison needs
 * both halves from the same side, or it compares the domain against readings it
 * assembled itself.
 */
export interface SprintItemRow {
  /** The `[slug]` plan reference, or `''` when the line names no plan. */
  slug: string;
  /** The item's own wording, annotation stripped. */
  text: string;
  /** Whether the sprint file's checkbox is ticked. */
  checked: boolean;
  /**
   * What the plan estate says about the plan it names.
   *
   * `'none'` where the line names no plan, so nothing was looked up;
   * `'withdrawn'` where the plan carries `State: Rejected` or `Superseded`.
   * The shell's own spellings, carried unchanged — translating them here would
   * compare the domain against this reader.
   */
  delivered: boolean | 'none' | 'withdrawn';
  /** What `item_state` answered. */
  state: string;
}

/** One sprint's items, tier by tier, as the script reports them. */
export interface SprintRow {
  /** The sprint's slug — the filename without its week prefix. */
  sprint: string;
  /** The sprint file's path, relative to the root. */
  file: string;
  /** The Must Have items. */
  must: SprintItemRow[];
  /** The Should Have items. */
  should: SprintItemRow[];
  /** The Could Have items. */
  could: SprintItemRow[];
}

/**
 * Lists the sprint files, the way `plot-sprint-release.sh` resolves one.
 *
 * EVERY sprint, not the active one. `--- no argument` gives the single active
 * sprint, which on this estate is one file of ten; a corpus of one sprint's
 * items exercises whichever states that sprint happens to hold, and the two
 * `disputed` items live in a closed one.
 *
 * @param estate - the repository to read.
 * @returns the slugs, in `LC_ALL=C` filename order.
 */
export const listSprintSlugs = (estate: Estate): string[] => {
  const dir = execFileSync(
    'bash',
    [scriptIn(estate, 'plot-config.sh'), 'get', 'Sprint directory', 'docs/sprints/'],
    { cwd: estate.root, encoding: 'utf8', maxBuffer: MAX_BUFFER },
  ).trim().replace(/\/$/, '');
  return execFileSync(
    'bash',
    ['-c', `find ${JSON.stringify(dir)} -maxdepth 1 -name '*.md' -type f | LC_ALL=C sort`],
    { cwd: estate.root, encoding: 'utf8', maxBuffer: MAX_BUFFER },
  )
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // `2026-W38-the-board-serves-a-team.md` → `the-board-serves-a-team`, the
    // script's own derivation, because that is the name it takes as an argument.
    .map((path) => path.replace(/^.*\//, '').replace(/\.md$/, '').replace(/^\d{4}-W?\d{2}(-\d{2})?-/, ''));
};

/**
 * Reads one sprint through `plot-sprint-release.sh`, which is the shell's own
 * scoring.
 *
 * @param estate - the repository to read.
 * @param slug - the sprint's slug.
 * @returns the sprint's rows, or null when the script named no sprint file.
 */
export const readSprintRelease = (estate: Estate, slug: string): SprintRow | null => {
  const raw = JSON.parse(
    execFileSync('bash', [scriptIn(estate, 'plot-sprint-release.sh'), slug], {
      cwd: estate.root,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  ) as Record<string, unknown>;
  if (typeof raw.file !== 'string' || raw.file === '') return null;
  const tier = (key: string): SprintItemRow[] =>
    Array.isArray(raw[key]) ? (raw[key] as SprintItemRow[]) : [];
  return {
    sprint: String(raw.sprint ?? ''),
    file: raw.file,
    must: tier('must'),
    should: tier('should'),
    could: tier('could'),
  };
};

/**
 * One desk, as `plot-worker-state.sh` reads and then classifies it.
 *
 * BOTH HALVES FROM THE SAME SIDE. `readings` is the line
 * `plot_worker_readings` printed; `state` is what `plot_worker_state` answered
 * over the same desk in the same pass. A comparison that parsed the desk here
 * to build the domain's input would compare the rule against this file rather
 * than against the shell.
 */
export interface AgentStateRow {
  /** The worktree's path. */
  worktree: string;
  /** The desk's basename, for a report a person can find. */
  name: string;
  /** The tab-separated readings line, verbatim. */
  readings: string;
  /** What `plot_worker_state` answered. */
  state: string;
}

/**
 * Reads every desk on this machine, both ways, in ONE bash process.
 *
 * ONE PASS, AND THAT IS THE WHOLE OF WHY THIS IS ONE FUNCTION. A desk is live
 * state: a worker exits, a marker lands, a file is committed. Asking for the
 * readings in one process and the states in another compares two moments and
 * reports the difference as a disagreement — the flake that would teach a
 * reader to distrust the test. Both are printed from one `plot_worker_state.sh`
 * sourcing, per desk, before the loop moves on.
 *
 * The PR fact is empty on BOTH sides, which is the registry's own contract:
 * *a caller that cannot know says nothing, and a branch with work on the floor
 * then reads `stalled`*. A host call here would be one `gh` per desk.
 *
 * @param estate - the repository to read.
 * @returns one row per worktree git lists, the main checkout included.
 */
export const readDesks = (estate: Estate): AgentStateRow[] => {
  const program = [
    '. "$1"; shift',
    'git worktree list --porcelain | awk \'/^worktree /{print $2}\' | while read -r wt; do',
    '  printf \'%s\\t%s\\t%s\\n\' "$wt" "$(plot_worker_state "$wt" "" | cut -f1)" "$(plot_worker_readings "$wt")"',
    'done',
  ].join('\n');
  const out = execFileSync(
    'bash',
    ['-c', program, 'bash', scriptIn(estate, 'plot-worker-state.sh')],
    {
      cwd: estate.root,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [worktree, state, ...readings] = line.split('\t');
      return {
        worktree: worktree ?? '',
        name: (worktree ?? '').replace(/^.*\//, ''),
        // The readings are themselves tab-separated, so they are rejoined
        // rather than re-split — the seven fields are the entry point's to
        // parse, not this reader's.
        readings: readings.join('\t'),
        state: state ?? '',
      };
    });
};

