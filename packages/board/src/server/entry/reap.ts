// THROUGH THE NARROW PATHS, not the package roots — same discipline as
// `entry/deliver.ts`: this bundle assembles its own adapter set and acts as a
// CLI in its own right, so pulling in the package root would bundle every
// entity and rule Plot has.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { processesShell } from '@plot-pm/domain/adapters/processes/processes-shell';
import type { Host, Processes, Refs, Scripts, Trees } from '@plot-pm/domain';
import { firstReapRefusal } from '@plot-pm/domain/rules/reapable';
import { firstBranchRefusal, firstClaimRefusal, dirtyTreeOwner } from '@plot-pm/domain/rules/sweepable';
import { realCommits, isEmptyClaim, type CommitReading } from '@plot-pm/domain/rules/empty-claim';
import { deskRoot } from '@plot-pm/domain/rules/desk-root';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-reap.sh` now launches, once per estate sweep.
 *
 * ```
 * plot-reap.mjs                # report what WOULD be reaped (default)
 * plot-reap.mjs --yes          # actually remove
 * plot-reap.mjs --yes --max 5  # bound per kind
 * plot-reap.mjs --sweep-temp   # a separate mode; removes stale temp paths
 * ```
 *
 * **FOUR KINDS OF LEFTOVER**, each a different population and each bounded by
 * its own `--max`: (1) worktrees whose work has landed, with their dead
 * manifests and agent logs; (2) local branches the host merged that no
 * worktree holds; (3) orphaned claim refs a plan already recorded as deferred
 * or moved; (4) dirty trees nobody owns — reported, never deleted.
 *
 * **THE DECIDING IS NOT HERE.** This gathers readings and asks
 * `rules/reapable.ts` and `rules/sweepable.ts`, exactly as the shell always
 * did; it holds no `if` about whether something may go. Both rule files are
 * untouched — their refusals were written for the populations they sweep.
 */

/** What the command line asked for. */
interface Args {
  dryRun: boolean;
  yes: boolean;
  max: number;
  sweepTemp: boolean;
}

/** Parses argv the way the shell's `while [ $# -gt 0 ]` loop did. */
const parseArgs = (argv: readonly string[]): Args | string => {
  let yes = false;
  let max = 0;
  let sweepTemp = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes') yes = true;
    else if (arg === '--dry-run') yes = false;
    else if (arg === '--sweep-temp') sweepTemp = true;
    else if (arg === '--max') {
      const value = argv[++i];
      max = value === undefined ? 0 : Number(value) || 0;
    } else if (arg === '-h' || arg === '--help') return '__help__';
    else return `unknown argument: ${arg}`;
  }
  return { dryRun: !yes, yes, max, sweepTemp };
};

/**
 * The `-h`/`--help` text, carried verbatim from `plot-reap.sh`'s own header
 * comment (its lines 2 through the first non-`#` line, each stripped of its
 * leading `# ` or `#`). Hardcoded rather than read from the shell file at
 * runtime: a published bundle ships with no sibling `plot-reap.sh` to read.
 */
const HELP_TEXT = `The estate sweep. It answers ONE question of everything it looks at — is
anything here that nobody is coming back for? — and it does not care whether
the cause was a dead agent, an interrupted dispatch, a \`--stop\`, or a merge
somebody did on the host.

FOUR KINDS OF LEFTOVER, and the first is the one this script started as:

  1. worktrees whose work has landed, with their dead worker files, the
     registry manifests that named them, and the agent logs that described
     them
  2. LOCAL BRANCHES the host merged that no worktree holds
  3. ORPHANED CLAIM REFS a plan already recorded as deferred or moved
  4. DIRTY TREES NOBODY OWNS — named, never deleted

Kinds 2-4 were added 2026-09-03. Measured on this estate the day before:
85 of 98 local branches already merged and nothing looked at them, claim refs
whose agent never existed, and 2 dirty desks holding 52 and 1 files that
every run refused and nothing ever resolved.

AND ONE THING IT ONLY REPORTS: a worktree git lists whose directory is gone.
\`git worktree list --porcelain\` calls it \`prunable\`, and it is NOT a sixth
refusal. A refusal says *do not remove this* and sends an operator to look; a
vanished entry says *there is nothing to remove and the entry is stale*, with
\`git worktree prune\` as the repair. It is reported before the refusals are
asked, because it is the prior question: four of the five measure something
inside a tree that is not there. Measured 2026-09-06 on this estate, 3 of 20
worktrees were prunable and this script named none of them.

EVERY KIND KEEPS ONE SHAPE: \`--dry-run\` by default, acting on \`--yes\`,
bounded by \`--max N\`. The bound is PER KIND, because the kinds are different
acts on different populations — a run bounded to five worktrees has not
thereby been asked to leave the 85th branch alone.

THE ASYMMETRY BETWEEN KINDS IS DELIBERATE AND STAYS. A removed checkout comes
back with \`git worktree add\` and a local branch is re-fetchable from origin,
so both are swept estate-wide. A deleted REMOTE ref is not re-creatable at
all, so \`plot-release-refs.sh\` deletes those under its own licence, its own
five guards, and a blast radius bounded by one plan file.

The gap this fills was named by a comment before it existed:
\`plot-reconcile-scan.sh:323\` says "with a deferred: annotation the reaper
would offer to DELETE real work" — describing a reaper that was never
written. The scan reports; nothing reaped. Measured 2026-08-25 on this
estate: 56 worktrees, 42 of them dispatch trees, of which 29 were finished.

WHY A SCRIPT RATHER THAN AN AGENT (Manifesto Principle 3): every refusal
below is a MEASUREMENT, not a judgement. Is a process alive; is the tree
dirty; did the host merge the PR. An agent asked "is this safe to delete?"
can talk itself past any of the three. A script cannot, and judgement's
absence is exactly what licenses the delete.

AND THE DECIDING IS NOT HERE. This script GATHERS the readings, asks
\`packages/domain/src/rules/reapable.ts\`, and ACTS on the answer; it holds no
\`if\` about whether a worktree may go. The five refusals are named values the
rule returns, so each is triggerable against a fixture — including the
combinations this estate will not produce on demand, a marker and a live pid
at once and a host that cannot be asked at all. In shell they were five
\`if\`s nothing could test.

SO THIS SCRIPT NEEDS NODE, where its first version deliberately did not.
That constraint is retired rather than quietly broken: the alternative is a
second implementation of the five refusals, in shell, where nothing can test
it — and a copy drifting toward permissive fails in the direction that
deletes work. A rule that cannot be asked REFUSES, so a missing \`node\` keeps
every tree and says so per tree rather than skipping them silently.

DEFAULT IS --dry-run. Removal happens only under --yes.

  plot-reap.sh                # report what WOULD be reaped
  plot-reap.sh --yes          # actually remove them
  plot-reap.sh --yes --max 5  # bound it

What is NEVER reaped, in the order the tests run:
  1. a worktree with a LIVE worker process        (a desk someone is at)
  2. a worktree with uncommitted changes           (work that exists nowhere else)
  3. a worktree carrying a PLOT-BLOCKED* marker    (a worker waiting on a person)
  4. a branch NO PR of which merged                (the host is the authority)
  5. the main checkout, and any non-dispatch tree  (not ours to remove)

THOSE FIVE REFUSALS ARE UNCHANGED BY THE THREE NEW KINDS, in this file and in
\`packages/domain/src/rules/reapable.ts\` alike. They were written for exactly
the population they sweep, and a backstop that guesses is worse than none.
Each new kind brings its own gate instead, in \`rules/sweepable.ts\`:

  local branch  the host says merged, AND no worktree holds it. NEVER
                \`git branch -d\`, which refuses a squash-merged branch for the
                wrong reason and would have kept all 85 of them.
  claim ref     only what \`plot-reconcile-scan.sh\` section 3 ALREADY calls
                reapable — a \`deferred:\`/\`moved:\` annotation. A bare
                \`claimed:\` is reported and left for a person.
  dirty tree    nothing. There is no deletion path: where this guard is
                wrong, destruction cannot be undone.

A dispatch tree is recognised by \`.plot-worker.pid\`, which the dispatcher
writes at creation, OR by the legacy \`plot-wt-\` path. Both are supported
permanently. Identifying one by its path ALONE was the defect fixed on
2026-08-30: \`plot-wt-\` is only used when \`Worktree root\` is absent, so on a
repo that configures one the reaper matched nothing and reported
\`reapable=0 kept=0\` over nine trees.

A TREE NEITHER TEST PLACES IS REPORTED \`unknown\` AND STILL NOT TOUCHED.
The recognition test above is unchanged in strictness — this adds no tree to
the reapable population and offers no removal. What it removes is the
SILENCE: until 2026-09-10 such a tree hit \`continue\`, so it was not reaped,
not kept, not counted and not named, and that is how ten finished desks went
unnoticed while the reaper reported three. Only a tree under the configured
\`Worktree root\` qualifies; a hand-made checkout elsewhere stays silent,
because a person's tree must never become an instruction to remove it.

THE MANIFEST GOES WITH THE WORKTREE. \`readAgentRegistry\` renders one row per
manifest, so a reap that removes only the checkout converts a finished agent
into an \`unknown\` row naming a directory that no longer exists — measured
2026-08-26, twelve worktrees removed and seven such rows appearing at once.
Nothing further needs deciding to remove it: an entry whose worktree the five
tests above just cleared is covered by exactly those measurements.

AND THE LOG GOES WITH THE WORKTREE TOO. Measured 2026-08-30: 190 log files,
2.6 MB beside the repository, the oldest from 2026-08-17, and NOT ONE
belonging to live work. This script took the worktree and the manifest every
time and left the log forever, so a finished agent's last act was to leave a
file nobody would ever open again.

It is the branch's own \`plot-resolve-<branch>\` run — log, \`.state\` and
\`.prompt.md\` together, since a sweep that took the log alone would leave half
a run behind. NOT the per-plan \`plot-dispatch-<slug>.log\`, which is appended
to by every dispatch of a plan and outlives any one of its branches.

ORDER: worktree FIRST, manifest second, log LAST. The first two are ordered
because the reverse leaves a live worktree with no registration, which
\`readAgentRegistry\` answers by SYNTHESIZING an \`unknown\` entry — the same bad
row, earned a different way. A failure between them this way round leaves an
orphaned manifest, which the sweep below clears on the next run.

The log is last because it is the only one that is PURE CLEANUP: a missing
manifest orphans an agent, a missing worktree loses a desk, and a missing log
costs a record of work the host already merged. So a failure before it has
cost the least, and its own failure costs nothing.

A MISSING LOG IS NOT A REFUSAL. The five refusals above are about work that
might be lost; a log describes work that has already landed. \`rm -f\`
semantics — if it is not there, that is the desired state.

AND IT IS NOT THE TRANSCRIPT. \`<worktree>/.plot-worker.log\` is the agent's own
words and lives INSIDE the tree, so it goes when the tree does and is not
swept here. This is the dispatcher's record of what it started. Two files,
two lifetimes, and CLAUDE.md already distinguishes them.

\`--sweep-temp\` IS A SEPARATE MODE, and it runs INSTEAD of the four kinds. A
trap does not run on SIGKILL — the board ends a scan at its timeout,
\`bounded.sh\` escalates to SIGKILL, a person kills a hung script — so some temp
paths outlive every trap. It removes two populations, each owned by this user
and older than \`Temp sweep after\` hours (default 24), by the entry's own
modification time:

  - \`$TMPDIR/plot-?*\` entries directly under \`$TMPDIR\` — \`plot-\` and at least
    one more character, any separator: \`mkdtempSync\` appends six characters
    with no dot, so \`plot-host-pTFuyG\` is the common shape. Never \`plot\`,
    \`plotter-old\` or any \`tmp.*\`: that is every template-less \`mktemp\` on the
    machine, and neither owner nor age separates Plot's from another
    program's. A \`plot-reg.<pid>\` exit registry is kept while its pid lives,
    because a worker loop registers its exit command and runs for days.
  - \`$PLOT_BUDGET_HOME/memo/<pid>\` directories (default \`~/.plot/state/memo\`)
    whose pid is not alive.

It lists each candidate with \`find\` and removes it by the full path it
listed; it never passes a glob to \`rm\`, and it never reads \`/tmp\` or
\`/var/folders\` when \`$TMPDIR\` points elsewhere. The age bound is safe because
every Plot temp path belongs to one script call, one scan or one board
request, and 24 h is about 1,000 times the scan's 90 s timeout.
`;

/** Where the ports and scripts this entry needs live. */
interface Context {
  repoRoot: string;
  scriptDir: string;
  refs: Refs;
  host: Host;
  scripts: Scripts;
  trees: Trees;
  processes: Processes;
}

/** `git` run in the repository, discarding nothing from the caller. */
const runGit = async (args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('git', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: (err as { code?: number } | null)?.code ?? (err ? 1 : 0), stdout, stderr });
    });
  });
};

/** Prints to stdout, matching the script's unprefixed verdict lines. */
type Printer = (s: string) => void;

/** A table column triple, rendered with the shell's exact widths: `%-8s %-52s %s`. */
const row = (verdict: string, label: string, why: string): string =>
  `${verdict.padEnd(8)} ${label.padEnd(52)} ${why}\n`;

/**
 * The live worker's pid at a desk, or `''`.
 *
 * Mirrors `desk_worker_pid()`: the five process states map to one reading —
 * `running` is live, `finished`/`failed`/`ended`/`none` are not, and
 * `waiting`/`stalled` are desk facts discarded by name. A state the mapping
 * does not know keeps the desk: it reports the recorded pid, or `'unknown'`.
 */
const deskWorkerPid = async (processes: Processes, worktree: string, hasPr: boolean): Promise<string> => {
  const reading = await processes.workerState(worktree, hasPr);
  if (!reading.ok) return '';
  const { state, pid } = reading.value;
  switch (state) {
    case 'running':
      return pid !== '' ? pid : 'unknown';
    case 'finished':
    case 'failed':
    case 'ended':
    case 'none':
    case 'waiting':
    case 'stalled':
      return '';
    default:
      return pid !== '' ? pid : 'unknown';
  }
};

/** Commits beyond `range`, read through `Refs.commitSubjects` and counted as `realCommits` does. */
const fileChangingCommitCount = async (refs: Refs, range: string): Promise<number> => {
  const subjects = await refs.commitSubjects(range);
  if (!subjects.ok) return 0;
  const readings: CommitReading[] = subjects.value.map((s) => ({
    subject: s.subject,
    tree: s.tree,
    parentTree: s.parentTree,
  }));
  return realCommits(readings);
};

/** Whether a branch's whole range is nothing but empty claim markers (and non-empty). */
const isWhollyEmptyClaim = async (refs: Refs, range: string): Promise<boolean> => {
  const subjects = await refs.commitSubjects(range);
  if (!subjects.ok || subjects.value.length === 0) return false;
  return subjects.value.every((s) => isEmptyClaim({ subject: s.subject, tree: s.tree, parentTree: s.parentTree }));
};

/**
 * Which commits the host merged for this branch — one `headRefOid` per merged
 * PR, newest first. Mirrors `pr_merged_heads()`: a third question asked only
 * once a branch is already known `merged`, since a squash merge deletes the
 * branch and drops its remote-tracking ref, leaving the merged head as the
 * only way to tell a pushed commit from one made after the merge.
 *
 * `null` means the host could not be asked (no `gh`, or the call failed) —
 * read the same direction the shell reads it: the caller falls back to
 * keeping the desk rather than treating silence as nothing merged.
 */
const prMergedHeads = async (branch: string): Promise<readonly string[] | null> => {
  const { execFile } = await import('node:child_process');
  const out = await new Promise<string | null>((resolve) => {
    execFile(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '100', '--json', 'mergedAt,headRefOid'],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
  if (out === null) return null;
  try {
    const rows = JSON.parse(out) as readonly { mergedAt?: string | null; headRefOid?: string }[];
    return rows.filter((r) => r.mergedAt && r.headRefOid).map((r) => r.headRefOid as string);
  } catch {
    return null;
  }
};

/**
 * Commits on `HEAD` no remote holds, short SHAs — or `'unknown'` when they
 * could not be counted. Mirrors `desk_unpushed()`.
 *
 * A merged branch gets the subtraction: a commit reachable from the merged
 * head was pushed, so excluding it from `--not --remotes` leaves only what the
 * merge did not take. When the merged head itself is unreachable (a squash
 * merge rewrites it, or the host named none), there is nothing to subtract and
 * naive `--not --remotes` would report every commit the branch ever made —
 * so the fallback reads PATCH-ID instead: `git cherry` marks a commit `+` when
 * its change is not yet upstream, and only a `+` commit the desk still holds
 * is unpushed. Fails toward keeping: an unreadable range or a failing
 * `git cherry` answers `'unknown'`.
 */
const unpushedCommits = async (
  worktree: string,
  branch: string,
  merge: 'merged' | 'not-merged',
  defaultBranch: string,
): Promise<readonly string[] | 'unknown'> => {
  const list = await runGit(['-C', worktree, 'rev-list', '--abbrev-commit', 'HEAD', '--not', '--remotes']);
  if (list.code !== 0) return 'unknown';
  const lines = list.stdout.split('\n').filter((l) => l !== '');
  if (lines.length === 0) return [];
  if (branch === '' || merge !== 'merged') return lines;

  const heads = await prMergedHeads(branch);
  if (heads === null) return 'unknown';

  const reachable: string[] = [];
  for (const h of heads) {
    const check = await runGit(['-C', worktree, 'cat-file', '-e', `${h}^{commit}`]);
    if (check.code === 0) reachable.push(h);
  }

  if (reachable.length > 0) {
    const subtracted = await runGit([
      '-C', worktree, 'rev-list', '--abbrev-commit', 'HEAD', '--not', '--remotes', ...reachable,
    ]);
    if (subtracted.code !== 0) return 'unknown';
    return subtracted.stdout.split('\n').filter((l) => l !== '');
  }

  // NO MERGED HEAD THIS DESK CONTAINS, and the host still said merged — a
  // squash merge rewrote the commits, or the host named no head at all.
  // `--not --remotes` alone would report every commit the branch ever had, so
  // the subtraction falls back to patch-id: a `+` entry from `git cherry` is a
  // change not yet upstream, and only one still present in `HEAD --not
  // --remotes` counts as unpushed.
  const full = await runGit(['-C', worktree, 'rev-list', 'HEAD', '--not', '--remotes']);
  if (full.code !== 0) return 'unknown';
  const fullSet = new Set(full.stdout.split('\n').filter((l) => l !== ''));
  const cherry = await runGit(['-C', worktree, 'cherry', `origin/${defaultBranch}`, 'HEAD']);
  if (cherry.code !== 0) return 'unknown';

  const unpushed: string[] = [];
  for (const entry of cherry.stdout.split('\n')) {
    if (!entry.startsWith('+ ')) continue;
    const sha = entry.slice(2).trim();
    if (!fullSet.has(sha)) continue;
    const short = await runGit(['-C', worktree, 'rev-parse', '--short', sha]);
    if (short.code === 0) unpushed.push(short.stdout.trim());
  }
  return unpushed;
};

// ===========================================================================
// --sweep-temp — a SEPARATE mode, run instead of the four kinds.
// ===========================================================================

/** Is a pid alive, read directly via `ps -p` — `--sweep-temp` runs with no repository context, so no port is built. */
const psAlive = async (pid: string): Promise<boolean> => {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('ps', ['-p', pid], (err) => resolve(!err));
  });
};

/** One temp entry: report it, and remove it by the exact path unless this is a dry run. */
const sweepOne = async (
  entryPath: string,
  why: string,
  dryRun: boolean,
  write: Printer,
): Promise<{ swept: boolean; removed: boolean }> => {
  if (dryRun) {
    write(`temp: would remove ${entryPath} (${why})\n`);
    return { swept: true, removed: false };
  }
  try {
    rmSync(entryPath, { recursive: true, force: true });
    write(`temp: removed ${entryPath} (${why})\n`);
    return { swept: true, removed: true };
  } catch {
    write(`temp: could not remove ${entryPath} (${why})\n`);
    return { swept: true, removed: false };
  }
};

/** Runs `--sweep-temp`: removes stale `$TMPDIR/plot-*` entries and dead-pid memo directories. */
const runSweepTemp = async (
  args: Args,
  cwd: string,
  scriptDir: string,
  write: Printer,
  warn: Printer,
): Promise<number> => {
  const scripts = scriptsShell({ repoRoot: cwd, scriptDir });
  const hoursResult = await scripts.config('Temp sweep after', '24');
  const rawHours = hoursResult.ok ? hoursResult.value.trim() : '24';
  if (!/^\d+$/.test(rawHours)) {
    warn(`plot-reap: 'Temp sweep after' must be a whole number of hours, not '${rawHours}'\n`);
    return 2;
  }
  const hours = Number(rawHours);
  const root = (process.env.TMPDIR ?? '/tmp').replace(/\/$/, '');
  const me = process.env.USER ?? process.env.LOGNAME ?? '';
  const cutoffMs = Date.now() - hours * 60 * 60 * 1000;

  let swept = 0;
  let removed = 0;
  let live = 0;

  const olderThan = (entryPath: string): boolean => {
    try {
      return statSync(entryPath).mtimeMs < cutoffMs;
    } catch {
      return false;
    }
  };

  const ownedByMe = (entryPath: string): boolean => {
    if (me === '' || process.getuid === undefined) return true;
    try {
      return statSync(entryPath).uid === process.getuid();
    } catch {
      return true;
    }
  };

  let rootEntries: string[] = [];
  try {
    rootEntries = readdirSync(root).filter((name) => /^plot-.+/.test(name));
  } catch {
    rootEntries = [];
  }
  for (const name of rootEntries) {
    if (args.max > 0 && swept >= args.max) break;
    const entryPath = path.join(root, name);
    if (!ownedByMe(entryPath) || !olderThan(entryPath)) continue;
    if (name.startsWith('plot-reg.')) {
      const pid = name.slice('plot-reg.'.length);
      if (await psAlive(pid)) {
        live += 1;
        continue;
      }
    }
    const outcome = await sweepOne(entryPath, `older than ${hours}h`, args.dryRun, write);
    if (outcome.swept) swept += 1;
    if (outcome.removed) removed += 1;
  }

  const budgetHome = process.env.PLOT_BUDGET_HOME ?? path.join(process.env.HOME ?? '', '.plot/state');
  const memoDir = path.join(budgetHome, 'memo');
  if (existsSync(memoDir)) {
    let memoEntries: string[] = [];
    try {
      memoEntries = readdirSync(memoDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      memoEntries = [];
    }
    for (const name of memoEntries) {
      if (args.max > 0 && swept >= args.max) break;
      if (!/^\d+$/.test(name)) continue;
      const entryPath = path.join(memoDir, name);
      if (!ownedByMe(entryPath) || !olderThan(entryPath)) continue;
      if (await psAlive(name)) {
        live += 1;
        continue;
      }
      const outcome = await sweepOne(entryPath, `memo of dead pid ${name}, older than ${hours}h`, args.dryRun, write);
      if (outcome.swept) swept += 1;
      if (outcome.removed) removed += 1;
    }
  }

  write(
    `temp-summary: swept=${swept} removed=${removed} kept_live=${live} bound_hours=${hours} root=${root} dry_run=${args.dryRun ? 1 : 0}\n`,
  );
  return 0;
};

// ===========================================================================
// KIND 1 — WORKTREES
// ===========================================================================

/** A path with its filesystem symlinks resolved, or the path unchanged when it no longer exists. */
const canonical = (p: string): string => {
  if (p === '') return '';
  let resolved = p;
  try {
    if (statSync(p).isDirectory()) resolved = realpathSync(p);
  } catch {
    // Gone already — fall through to the textual normalisation below.
  }
  if (/^\/private\/(tmp|var|etc)\//.test(resolved)) return resolved.replace(/^\/private/, '');
  return resolved;
};

/** The manifest naming a worktree, or `null`. Matches `manifest_for()`'s single-field `sed` read. */
const manifestFor = (manifestDir: string, target: string): string | null => {
  if (!existsSync(manifestDir)) return null;
  const wanted = canonical(target);
  let names: string[] = [];
  try {
    names = readdirSync(manifestDir).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  for (const name of names) {
    const file = path.join(manifestDir, name);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const match = /"worktree"\s*:\s*"([^"]*)"/.exec(text);
    if (!match) continue;
    if (canonical(match[1]) === wanted) return file;
  }
  return null;
};

/** The paths one branch's `plot-resolve-<branch>` run may have left, flattening `/` to `-`. */
const branchLogFiles = (logDir: string, branch: string): string[] => {
  const flat = branch.replace(/\//g, '-');
  return [
    path.join(logDir, `plot-resolve-${flat}.log`),
    path.join(logDir, `plot-resolve-${flat}.state`),
    path.join(logDir, `plot-resolve-${flat}.prompt.md`),
  ];
};

/** The ones of `branchLogFiles` that actually exist, as `"a.log, a.state"` or `''`. */
const presentLogs = (files: readonly string[]): string =>
  files.filter((f) => existsSync(f)).map((f) => path.basename(f)).join(', ');

/** Removes every path in `files`, best effort, matching `rm -f`. */
const removeLogs = (files: readonly string[]): void => {
  for (const f of files) {
    try {
      unlinkSync(f);
    } catch {
      // Not there — the desired state.
    }
  }
};

/** Counters the worktree loop accumulates, printed in the final summary line. */
interface ReapCounters {
  reap: number;
  kept: number;
  removed: number;
  vanished: number;
  unplaced: number;
  cleared: number;
}

const runWorktreeKind = async (
  ctx: Context,
  args: Args,
  defaultBranch: string,
  manifestDir: string,
  wtRoot: string,
  write: Printer,
): Promise<ReapCounters> => {
  const counters: ReapCounters = { reap: 0, kept: 0, removed: 0, vanished: 0, unplaced: 0, cleared: 0 };
  write('verdict  branch                                               why\n');

  const listed = await ctx.trees.list();
  if (!listed.ok) {
    write('plot-reap: could not list worktrees\n');
    return counters;
  }

  for (const tree of listed.value) {
    if (tree.isMain) continue;
    const short = tree.branch;
    const label = short !== '' ? short : `(detached) ${path.basename(tree.path)}`;

    // 4a. Git's own `prunable` answer — reported, never a sixth refusal.
    if (tree.prunable) {
      write(row('vanished', label, "directory gone — 'git worktree prune' clears the entry"));
      counters.vanished += 1;
      continue;
    }

    // 5. Only dispatch trees: a `.plot-worker.pid` file, or the legacy `plot-wt-` path.
    let isDispatchTree = false;
    if (existsSync(path.join(tree.path, '.plot-worker.pid'))) isDispatchTree = true;
    else if (tree.path.includes('/plot-wt-')) isDispatchTree = true;

    let unclassified = false;
    if (!isDispatchTree && wtRoot !== '' && tree.path.startsWith(`${wtRoot}/`)) unclassified = true;

    if (!isDispatchTree && !unclassified) continue;

    if (unclassified) {
      write(
        row(
          'unknown',
          label,
          `under ${path.basename(wtRoot)}/, no worker pid and no recognised name — needs a person`,
        ),
      );
      counters.unplaced += 1;
      continue;
    }

    // THE READINGS. Everything from here to the rule call measures; nothing decides.
    const pid = await deskWorkerPid(ctx.processes, tree.path, short !== '');

    let markerFile = '';
    const markers = await ctx.trees.markers(tree.path, 'PLOT-BLOCKED');
    if (markers.ok && markers.value.length > 0) markerFile = path.join(tree.path, markers.value[0]);
    const marker = markerFile !== '';

    let dirty = '';
    const dirtyPaths = await ctx.trees.dirtyPathsWithStatus(tree.path);
    if (dirtyPaths.ok) {
      const first = dirtyPaths.value.find((p) => !p.includes('PLOT-BLOCKED'));
      if (first !== undefined) dirty = first;
    }

    let markerRecordsWork = false;
    if (marker) {
      // `commitSubjects` resolves `HEAD` against whatever repo root built this
      // `Refs` — `ctx.refs` is fixed to the main checkout, so a range ending in
      // `HEAD` must come from a `Refs` scoped to THIS worktree instead.
      const treeRefs = refsGit({ repoRoot: tree.path, scriptDir: ctx.scriptDir });
      const fileChanging = await fileChangingCommitCount(treeRefs, `origin/${defaultBranch}..HEAD`);
      markerRecordsWork = dirty !== '' || fileChanging !== 0;
    }

    // The host: whether ANY PR for this branch merged. Ancestry first — cheap,
    // can only ADD a merged answer — then the host, never state, never newest.
    let merge: 'merged' | 'not-merged' = 'not-merged';
    let why = '';
    if (short !== '') {
      const ancestry = await ctx.refs.isMergedByAncestry(short);
      if (ancestry.ok && ancestry.value === 'merged') {
        merge = 'merged';
        why = `merged into ${defaultBranch}`;
      } else {
        const hostMerged = await ctx.host.prMerged(short);
        if (hostMerged.ok && hostMerged.value === 'merged') {
          merge = 'merged';
          why = 'PR merged (squash)';
        }
      }
    } else {
      // A detached desk has nothing to land: read against HEAD, never the name.
      const ahead = await runGit(['-C', tree.path, 'rev-list', '--count', `origin/${defaultBranch}..HEAD`]);
      if (ahead.code === 0 && ahead.stdout.trim() === '0') {
        merge = 'merged';
        why = 'detached, nothing to land';
      }
    }

    // Commits on HEAD no remote holds — lines, or 'unknown' when uncountable.
    // Asked AFTER the merge reading: the head the host merged is what
    // separates a pushed commit from an unpushed one once the remote ref is
    // gone, on the squash path `unpushedCommits` handles.
    const unpushed = await unpushedCommits(tree.path, short, merge, defaultBranch);

    const problem = firstReapRefusal({
      branch: short,
      defaultBranch,
      isMain: false,
      workerPid: pid === '' ? null : pid,
      dirtyPath: dirty,
      blockedMarker: marker,
      markerRecordsWork,
      merge,
      unpushed,
    });

    if (problem !== null) {
      let reason: string;
      switch (problem.refusal) {
        case 'live-worker':
          reason = `worker alive (pid ${problem.detail})`;
          break;
        case 'blocked-marker':
          reason = 'PLOT-BLOCKED marker — needs a person';
          break;
        case 'uncommitted-changes':
          reason = `uncommitted: ${problem.detail.slice(0, 40)}`;
          break;
        case 'unpushed-commits':
          reason = `unpushed commits: ${problem.detail.slice(0, 40)}`;
          break;
        case 'on-default-branch':
          reason = `on ${defaultBranch} — dispatched branch not checked out`;
          break;
        case 'no-merged-pr':
          reason = 'unlanded work — no merged PR';
          break;
        default:
          reason = 'rule could not be asked — keeping';
      }
      write(row('keep', label, reason));
      counters.kept += 1;
      continue;
    }

    if (args.max > 0 && counters.reap >= args.max) {
      write(row('keep', label, `--max ${args.max} reached`));
      counters.kept += 1;
      continue;
    }

    const wtReal = canonical(tree.path);
    const logFiles = branchLogFiles(wtRoot, short);
    const logs = presentLogs(logFiles);

    if (args.yes && marker && markerFile !== '') {
      const refusalsLog = path.join(ctx.repoRoot, '.plot/state/refusals.tsv');
      let markerText = '';
      try {
        markerText = readFileSync(markerFile, 'utf8').replace(/[\n\t]/g, ' ');
      } catch {
        markerText = '';
      }
      try {
        mkdirSync(path.dirname(refusalsLog), { recursive: true });
        const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        const { appendFileSync } = await import('node:fs');
        appendFileSync(refusalsLog, `${stamp}\t${label}\t${markerText}\n`);
        why = `${why}, marker saved to .plot/state/refusals.tsv`;
      } catch {
        write(row('keep', label, 'could not save PLOT-BLOCKED text to .plot/state/refusals.tsv — desk kept'));
        counters.kept += 1;
        continue;
      }
    }

    counters.reap += 1;
    if (args.dryRun) {
      write(row('would', label, `${why}${logs !== '' ? `, log ${logs}` : ''}`));
      continue;
    }

    const removedOk = await ctx.trees.removeOnly(tree.path);
    if (!removedOk.ok) {
      write(row('FAILED', label, 'git worktree remove refused'));
      counters.kept += 1;
      continue;
    }

    let finalWhy = why;
    const m = manifestFor(manifestDir, wtReal);
    if (m !== null) {
      try {
        unlinkSync(m);
        finalWhy = `${finalWhy}, manifest cleared`;
      } catch {
        // Best effort.
      }
    }
    if (logs !== '') {
      removeLogs(logFiles);
      finalWhy = `${finalWhy}, log removed`;
    }
    write(row('reaped', label, finalWhy));
    counters.removed += 1;
  }

  if (args.yes) await ctx.trees.prune();

  // The manifests whose worktree is already gone.
  if (existsSync(manifestDir)) {
    let names: string[] = [];
    try {
      names = readdirSync(manifestDir).filter((n) => n.endsWith('.json'));
    } catch {
      names = [];
    }
    for (const name of names) {
      const file = path.join(manifestDir, name);
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const match = /"worktree"\s*:\s*"([^"]*)"/.exec(text);
      if (!match || match[1] === '') continue;
      if (existsSync(match[1])) continue;
      counters.cleared += 1;
      const base = path.basename(match[1]);
      if (args.dryRun) {
        write(row('would', base, 'orphaned manifest — worktree absent'));
      } else {
        try {
          unlinkSync(file);
        } catch {
          // Best effort.
        }
        write(row('cleared', base, 'orphaned manifest — worktree absent'));
      }
    }
  }

  return counters;
};

// ===========================================================================
// KIND 2 — LOCAL BRANCHES
// ===========================================================================

interface BranchCounters {
  swept: number;
  deleted: number;
  kept: number;
}

const runBranchKind = async (
  ctx: Context,
  args: Args,
  defaultBranch: string,
  write: Printer,
): Promise<BranchCounters> => {
  const counters: BranchCounters = { swept: 0, deleted: 0, kept: 0 };
  write('\n-- local branches --\n');

  const checkedOutResult = await ctx.trees.list();
  const checkedOut = new Set(
    checkedOutResult.ok ? checkedOutResult.value.map((t) => t.branch).filter((b) => b !== '') : [],
  );

  const branchesResult = await ctx.refs.listBranches(false);
  const branches = branchesResult.ok ? branchesResult.value : [];

  for (const br of branches) {
    let merged = false;
    let bwhy = '';
    const ancestry = await ctx.refs.isMergedByAncestry(br);
    if (ancestry.ok && ancestry.value === 'merged') {
      merged = true;
      bwhy = `merged into ${defaultBranch}`;
    } else {
      const hostMerged = await ctx.host.prMerged(br);
      if (hostMerged.ok && hostMerged.value === 'merged') {
        merged = true;
        bwhy = 'PR merged (squash)';
      }
    }

    const held = checkedOut.has(br);

    const refusal = firstBranchRefusal({ branch: br, defaultBranch, hasMergedPr: merged, checkedOut: held });

    if (refusal !== null) {
      let reason: string;
      switch (refusal) {
        case 'default-branch':
          reason = 'the default branch — never deleted';
          break;
        case 'no-merged-pr':
          reason = 'unlanded work — no merged PR';
          break;
        case 'checked-out':
          reason = 'checked out in a worktree — somebody is reading it';
          break;
        default:
          reason = 'rule could not be asked — keeping';
      }
      write(row('keep', br, reason));
      counters.kept += 1;
      continue;
    }

    if (args.max > 0 && counters.swept >= args.max) {
      write(row('keep', br, `--max ${args.max} reached`));
      counters.kept += 1;
      continue;
    }

    counters.swept += 1;
    if (args.dryRun) {
      write(row('would', br, `${bwhy}, no worktree holds it`));
      continue;
    }

    const deleted = await runGit(['-C', ctx.repoRoot, 'branch', '-D', br]);
    if (deleted.code === 0) {
      write(row('deleted', br, `${bwhy}, local ref deleted`));
      counters.deleted += 1;
    } else {
      write(row('FAILED', br, 'git branch -D refused'));
      counters.kept += 1;
    }
  }

  return counters;
};

// ===========================================================================
// KIND 3 — ORPHANED CLAIM REFS
// ===========================================================================

interface ClaimCounters {
  swept: number;
  deleted: number;
  kept: number;
}

/** How the plan annotation classified a claim: `abandoned` (deferred/moved) or `unresolved`. */
const claimDisposition = (activeDir: string, branch: string): 'abandoned' | 'unresolved' => {
  let files: string[] = [];
  try {
    files = readdirSync(activeDir).filter((n) => n.endsWith('.md'));
  } catch {
    files = [];
  }
  for (const name of files) {
    let text: string;
    try {
      text = readFileSync(path.join(activeDir, name), 'utf8');
    } catch {
      continue;
    }
    const line = text.split('\n').find((l) => l.includes(`\`${branch}\``));
    if (line === undefined) continue;
    if (line.includes('<!-- deferred:') || line.includes('<!-- moved:')) return 'abandoned';
  }
  return 'unresolved';
};

const runClaimKind = async (
  ctx: Context,
  args: Args,
  defaultBranch: string,
  activeDir: string,
  write: Printer,
): Promise<ClaimCounters> => {
  const counters: ClaimCounters = { swept: 0, deleted: 0, kept: 0 };
  write('\n-- orphaned claim refs --\n');

  const branchesResult = await ctx.refs.listBranches(false);
  const branches = branchesResult.ok ? branchesResult.value : [];

  for (const br of branches) {
    if (br === defaultBranch) continue;

    const empty = await isWhollyEmptyClaim(ctx.refs, `origin/${defaultBranch}..${br}`);
    if (!empty) continue;

    const disp = claimDisposition(activeDir, br);
    const refusal = firstClaimRefusal({ branch: br, isEmptyClaim: empty, disposition: disp });

    if (refusal !== null) {
      const reason =
        refusal === 'needs-judgment'
          ? 'still claimed, no commits → needs judgment (worker thinking, or dead)'
          : refusal === 'not-an-empty-claim'
            ? 'carries real work — not a claim'
            : 'rule could not be asked — keeping';
      write(row('keep', br, reason));
      counters.kept += 1;
      continue;
    }

    if (args.max > 0 && counters.swept >= args.max) {
      write(row('keep', br, `--max ${args.max} reached`));
      counters.kept += 1;
      continue;
    }

    counters.swept += 1;
    if (args.dryRun) {
      write(row('would', br, 'abandoned claim (plan says deferred/moved)'));
      continue;
    }

    const deleted = await runGit(['-C', ctx.repoRoot, 'branch', '-D', br]);
    if (deleted.code === 0) {
      write(row('deleted', br, 'abandoned claim — local ref deleted'));
      counters.deleted += 1;
    } else {
      write(row('FAILED', br, 'git branch -D refused'));
      counters.kept += 1;
    }
  }

  return counters;
};

// ===========================================================================
// KIND 4 — DIRTY TREES NOBODY OWNS (reported, never deleted)
// ===========================================================================

const runDirtyKind = async (ctx: Context, manifestDir: string, write: Printer): Promise<number> => {
  write('\n-- dirty trees nobody owns --\n');
  let dirtyTrees = 0;

  const listed = await ctx.trees.list();
  if (!listed.ok) return 0;

  let mainCheckout = '';
  const commonDir = await runGit(['rev-parse', '--git-common-dir']);
  if (commonDir.code === 0) {
    try {
      mainCheckout = realpathSync(path.join(commonDir.stdout.trim(), '..'));
    } catch {
      mainCheckout = '';
    }
  }

  for (const tree of listed.value) {
    if (mainCheckout !== '' && canonical(tree.path) === canonical(mainCheckout)) continue;

    const dirtyPaths = await ctx.trees.dirtyPaths(tree.path);
    const dirtyCount = dirtyPaths.ok ? dirtyPaths.value.length : 0;
    if (dirtyCount <= 0) continue;

    const pid = await deskWorkerPid(ctx.processes, tree.path, tree.branch !== '');
    const m = manifestFor(manifestDir, canonical(tree.path));
    const manifest = m !== null ? path.basename(m) : '';

    const owner = dirtyTreeOwner({
      path: '',
      branch: '',
      dirtyCount: 1,
      workerPid: pid === '' ? null : pid,
      manifest,
    });
    if (owner !== 'nobody') continue;

    dirtyTrees += 1;
    write(
      row(
        'LEFTOVER',
        tree.branch !== '' ? tree.branch : '(detached)',
        `${dirtyCount} uncommitted, owner: nobody — clear it by hand: ${tree.path}`,
      ),
    );
  }

  if (dirtyTrees > 0) {
    write('  ^ ' + `${dirtyTrees} dirty tree(s) nobody owns. Nothing was deleted from them,\n`);
    write('    deliberately: where this guard is wrong, destruction cannot be undone.\n');
  }

  return dirtyTrees;
};

/**
 * Runs the four-kind sweep.
 *
 * @returns the process exit code.
 */
const runReap = async (ctx: Context, args: Args, write: Printer, warn: Printer): Promise<number> => {
  const hostDefault = await ctx.scripts.host(['default-branch']);
  const defaultBranch = hostDefault.ok && hostDefault.value.trim() !== '' ? hostDefault.value.trim() : 'main';

  await runGit(['-C', ctx.repoRoot, 'fetch', 'origin', defaultBranch, '--quiet']);

  const manifestDirCfg = await ctx.scripts.config('Agent registry', '.plot/agents');
  const manifestDirRaw = manifestDirCfg.ok && manifestDirCfg.value.trim() !== '' ? manifestDirCfg.value.trim() : '.plot/agents';
  const manifestDir = path.isAbsolute(manifestDirRaw) ? manifestDirRaw : path.join(ctx.repoRoot, manifestDirRaw);

  // The desk root, resolved against the MAIN checkout — never the cwd's
  // worktree, which would resolve `.worktrees` beneath a desk that holds none.
  const wtRootCfg = await ctx.scripts.config('Worktree root', '');
  const wtRoot = deskRoot({ configured: wtRootCfg.ok ? wtRootCfg.value.trim() : '', repoRoot: ctx.repoRoot });
  if (wtRoot === '') {
    warn('plot-reap: cannot resolve the desk root — nothing was reaped.\n');
    return 2;
  }

  const activeDirCfg = await ctx.scripts.config('Active index', 'docs/plans/active/');
  const activeDirRaw = activeDirCfg.ok && activeDirCfg.value.trim() !== '' ? activeDirCfg.value.trim() : 'docs/plans/active/';
  const activeDir = path.isAbsolute(activeDirRaw) ? activeDirRaw : path.join(ctx.repoRoot, activeDirRaw);

  const wt = await runWorktreeKind(ctx, args, defaultBranch, manifestDir, wtRoot, write);
  const br = await runBranchKind(ctx, args, defaultBranch, write);
  const cl = await runClaimKind(ctx, args, defaultBranch, activeDir, write);
  const dirtyTrees = await runDirtyKind(ctx, manifestDir, write);

  write(
    `summary: reapable=${wt.reap} removed=${wt.removed} kept=${wt.kept} vanished=${wt.vanished} unplaced=${wt.unplaced} cleared=${wt.cleared} branches=${br.swept} branches_deleted=${br.deleted} branches_kept=${br.kept} claims=${cl.swept} claims_deleted=${cl.deleted} claims_kept=${cl.kept} dirty_trees=${dirtyTrees} dry_run=${args.dryRun ? 1 : 0}\n`,
  );
  return 0;
};

/**
 * Runs `plot-reap`.
 *
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    if (parsed === '__help__') {
      write(HELP_TEXT);
      return 0;
    }
    warn(`plot-reap: ${parsed}\n`);
    return 2;
  }

  if (parsed.sweepTemp) {
    return runSweepTemp(parsed, cwd, scriptDir, write, warn);
  }

  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn('plot-reap: not a git repository\n');
    return 2;
  }

  // THE MAIN CHECKOUT, NEVER `--show-toplevel` ALONE. `probe` answers the
  // worktree the process runs FROM, which is the desk inside a linked
  // worktree when the reaper is dispatched from one — `plot-desk-root.sh:24-27`
  // names the exact failure this caused on 2026-09-10 ("every tree read as
  // unplaceable") and fixes it by preferring `--git-common-dir`'s parent.
  // `trees.list()`'s first entry is the same answer through the port this
  // entry already needs for every other reading — `isMain: trees.length === 0`
  // (`trees-git.ts`) and `deskFs`'s own `mainCheckoutPath` rely on the same
  // ordering, so this keeps one definition of "main" rather than a second.
  const bootstrapTrees = treesGit({ repoRoot: probe.value, scriptDir });
  const trees = await bootstrapTrees.list();
  const repoRoot = trees.ok ? (trees.value[0]?.path ?? probe.value) : probe.value;
  const context = { repoRoot, scriptDir };
  const ctx: Context = {
    repoRoot,
    scriptDir,
    refs: refsGit(context),
    host: hostShell(context),
    scripts: scriptsShell(context),
    trees: treesGit(context),
    processes: processesShell(context),
  };

  return runReap(ctx, parsed, write, warn);
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `deliver.ts` records: `/tmp` is a symlink on macOS.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
