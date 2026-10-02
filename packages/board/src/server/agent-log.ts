import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PortResult } from '@plot-pm/domain';
import { scriptsShell } from '@plot-pm/domain/adapters';
import { deskRoot, deskRootPlacement } from '@plot-pm/domain/rules/desk-root';

/**
 * Where the board's agent logs live — the ONE place that decides it.
 *
 * Nine modules spawn agents and each keeps its own log, prompt and state file
 * beside the others. Until 2026-08-30 each of them resolved the directory
 * itself, so one decision was written 22 times; this module is that decision,
 * and the nine ask it.
 *
 * WHY THE FILES SIT IN `.worktrees/`, since this is now the only place that
 * knows. Two properties are required of the location, and the directory Plot
 * owns is what satisfies both.
 *
 * It must not be WATCHED. `pnpm board` runs under `node --watch`, which walks
 * the tree and does not read `.gitignore`. A file written into a watched path
 * restarts the very server that just spawned the agent, and the restart can
 * take the agent with it. Measured 2026-08-25 walking the v2.9.0 endgame:
 * clicking *Create plan* on issue #333 wrote `.plot/idea-issue-333.md`, the
 * board log recorded `Restarting 'board-server.mjs'` in the same second, and
 * the agent's log sat at 0 bytes. It recovered on a later attempt, which is
 * worse than a clean failure: the defect is a race, so it disappears when
 * looked at. `node --watch` does not descend into `.worktrees/`.
 *
 * It must not be UNTRACKED NOISE. A log every `git status` reports and every
 * worktree inherits means a repair that dirties its own worktree cannot be
 * verified by the suite it then runs. {@link excludeDeskRoot} writes the path
 * into `info/exclude`, so the directory is ignored even where no adopter wrote
 * a `.gitignore` line.
 *
 * It must be a directory PLOT OWNS, and that is what changed on 2026-10-01.
 * "Not in the repo" used to be implemented as "the directory beside it", where
 * 190 logs totalling 2.6 MB accumulated since 2026-08-17 with nothing that
 * would ever remove one — into a directory holding a person's other checkouts.
 * The answer is now the desk root, inside the repository.
 */

/**
 * The `## Plot Config` key naming the directory fleet worktrees are created in.
 *
 * The same key `plot-config.sh` documents and `plot-dispatch.sh`'s
 * `resolve_wt_root()` reads, so a project that pointed its worktrees somewhere
 * else gets its logs there too. One key, one answer — a second key naming
 * "where logs go" would let the two drift into a log that describes a worktree
 * it does not sit beside.
 */
export const WORKTREE_ROOT_KEY = 'Worktree root';

/**
 * Where `plot-config.sh` is, when nobody said.
 *
 * The board artifact ships at `skills/plot/scripts/board/board-server.mjs`, so
 * the scripts directory is its parent — the SAME anchor `index.ts` computes for
 * `BuildBoardOptions.scriptsDir`, and the same `PLOT_SCRIPTS_DIR` override,
 * which is what the `.mjs` suites already stub.
 *
 * Derived here rather than threaded through {@link agentLogDir}'s callers on
 * purpose. Slice 1 moved 27 call sites onto `agentLogPath(repoRoot, …)` so that
 * moving the location would be one edit; growing that signature to carry a
 * scripts directory would spend those 27 edits after all, to hand every caller
 * a value that is a per-process constant rather than a per-call one.
 */
const scriptsDir = (): string =>
  process.env.PLOT_SCRIPTS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The configured `Worktree root` per repository, read ONCE per process.
 *
 * `buildBoard` asks {@link agentLogPath} once per card — `dispatchLogExists` is
 * one `stat` per plan on every 4 s pulse — so an unmemoised shell-out would put
 * one `bash` spawn per plan per pulse on a single-threaded server. That is a
 * cost the pulse was explicitly designed not to pay: the scan carries locations
 * and existence, never contents.
 *
 * A record, so it is worth saying what makes it one that cannot go stale in a
 * way that matters. The value read is a line of `CLAUDE.md`, and changing it
 * relocates every future log; a board that honoured the change mid-process
 * would write half a run's three files either side of the move. Reading it once
 * per process is the same answer `repairEnabled` gives for the same reason —
 * the honest cost is a restart, and a restart is what makes the answer whole.
 */
const worktreeRootCache = new Map<string, string>();

/**
 * The configured `Worktree root`, verbatim, or `''` when there is none.
 *
 * Read through the `Scripts` port — which reaches `plot-config.sh`, the one
 * thing that knows where Plot configuration lives — rather than parsing
 * `CLAUDE.md` here. Any failure reads as *no key*: a board whose scripts are missing must still resolve a log path,
 * and the fallback that answer produces is today's location, which is correct
 * rather than merely safe.
 */
const readWorktreeRoot = (repoRoot: string): string => {
  const cached = worktreeRootCache.get(repoRoot);
  if (cached !== undefined) return cached;
  const answer = scriptsShell({ repoRoot, scriptDir: scriptsDir() })
    .configSync(WORKTREE_ROOT_KEY, '');
  const value = answer.ok ? answer.value.trim() : '';
  worktreeRootCache.set(repoRoot, value);
  return value;
};

/**
 * Fill the cache off the event loop, so no later reader has to spawn for it.
 *
 * THE READ PATH REACHES THIS FILE THROUGH ONE CALL and cannot await it.
 * `buildBoard` asks `dispatchLogExists` once per card, that resolves through
 * {@link agentLogPath}, and both are synchronous because 27 call sites in ten
 * write-route modules are — making them async is the migration
 * `production-calls-the-domain-one-rule-at-a-time` owns, not this slice's.
 *
 * So the spawn is moved rather than removed: primed once at startup through the
 * `PlanStore` port, before the first request, every later read is a `Map` hit.
 * The synchronous read above survives for the caller this priming
 * cannot reach — a test that constructs a fixture repo mid-process, and a write
 * route in a process that never primed — and it is the same blast radius the
 * plan leaves the write routes with: an operator waiting for their own click.
 *
 * The value read is a line of `CLAUDE.md` and it is read ONCE per process for
 * the reason {@link worktreeRootCache} states: changing it relocates every
 * future log, and a board that honoured the change mid-process would write half
 * a run's three files either side of the move. So priming is not a cache warm-up
 * that could also happen later — it is where the one read now happens.
 *
 * A port that cannot answer leaves the cache EMPTY rather than storing `''`.
 * Storing it would make *nobody asked yet* indistinguishable from *the project
 * declares no key*, and the second is an answer that pins the log directory for
 * the life of the process.
 *
 * @param repoRoot absolute path to the repository this board serves
 * @param config reads a `## Plot Config` key — `PlanStore.config`
 */
export const primeWorktreeRoot = async (
  repoRoot: string,
  config: (key: string, fallback: string) => Promise<PortResult<string>>,
): Promise<void> => {
  if (worktreeRootCache.has(repoRoot)) return;
  const read = await config(WORKTREE_ROOT_KEY, '');
  if (!read.ok) return;
  worktreeRootCache.set(repoRoot, read.value.trim());
  // The desk root now resolves, so create it and exclude it once, here, rather
  // than at each of the fourteen `openSync` sites that would otherwise each
  // have to remember. A board that never spawns an agent creates one empty
  // directory; a board that spawns one would have created it anyway.
  ensureAgentLogDir(repoRoot);
};

/**
 * Forget the cached `Worktree root` readings.
 *
 * For tests, which change the configuration of a fixture repo between cases
 * inside one process — the only caller for whom the per-process read is a
 * limitation rather than the point.
 */
export const forgetWorktreeRoot = (): void => {
  worktreeRootCache.clear();
  // The created-directory memo is keyed by the ANSWER, and clearing the cache
  // is how a test changes that answer. A memo surviving it would report a
  // directory as created under a configuration that never created one.
  ensured.clear();
};

/**
 * The directory the board's agent logs, prompts and state files live in.
 *
 * The desk root: `<repoRoot>/.worktrees` unless {@link WORKTREE_ROOT_KEY} is
 * configured, in which case an absolute value is taken as given and a relative
 * one resolves against `repoRoot`. The rule is `deskRoot`, which every shell
 * site asks through `board/plot-desk-root.mjs`, so the board and the scripts
 * cannot disagree about where one desk lives.
 *
 * A log belongs beside the checkout it describes, and `.worktrees/` is Plot's
 * own directory holding exactly the things a dispatch creates. The result is
 * pure string work: the directory need not exist, because a first write is
 * entitled to create it — and the caller that does calls
 * {@link excludeDeskRoot}, so it never appears as untracked files.
 *
 * `repoRoot` is resolved HERE rather than in the rule. The rule composes
 * strings and cannot reach a working directory, so a relative root handed
 * straight to it would compose a relative answer and a caller would inherit its
 * cwd. Resolving at the boundary keeps the rule pure and the contract absolute;
 * the answer is resolved again so a configured `..` compares equal to the
 * directory it names.
 *
 * @concept desk-root
 * @param repoRoot path to the repository this board serves
 * @returns an absolute directory path with no trailing slash; it need not exist
 */
export const agentLogDir = (repoRoot: string): string =>
  path.resolve(deskRoot({ configured: readWorktreeRoot(repoRoot), repoRoot: path.resolve(repoRoot) }));
/**
 * Create the desk root, and keep it out of `git status`.
 *
 * {@link agentLogPath} calls this, so every writer finds the directory there.
 * It is memoised per desk root, and it reaches no process, so the resolver a
 * pulse asks once per card stays a `Set` lookup after the first call.
 *
 * @concept desk-root
 * @param repoRoot absolute path to the repository this board serves
 * @returns the directory, now existing
 */
export const ensureAgentLogDir = (repoRoot: string): string => {
  const dir = agentLogDir(repoRoot);
  if (ensured.has(dir)) return dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    excludeDeskRoot(repoRoot);
    ensured.add(dir);
  } catch {
    // Not memoised on failure, so a later write tries again. The write itself
    // reports: a caller that could not open its log has a better sentence than
    // one that could not create a directory.
  }
  return dir;
};

/**
 * The desk roots this process has already created.
 *
 * Once per directory per process, not once per write. The work is a `mkdir`
 * and reads of `.gitignore` and `info/exclude`; the board writes a
 * run's three files and appends to the log repeatedly, so paying it per write
 * would put a spawn on a path that is otherwise one `write` syscall.
 *
 * Cleared by {@link forgetWorktreeRoot}, for the caller that clears it: a test
 * that rebuilds a fixture repository under a path it already used.
 */
const ensured = new Set<string>();

/**
 * The repository's COMMON git directory, read from disk without running git.
 *
 * A main checkout holds `.git` as a directory, which is the common one. A
 * linked worktree holds a `.git` FILE naming its private gitdir, and that
 * gitdir's `commondir` file names the shared one. No `.git` at all answers
 * `undefined`: the directory is not a repository and needs no line.
 *
 * Read rather than asked of `git rev-parse`, because a read route reaches this
 * through {@link agentLogPath}, and a read route spawns nothing
 * (`a-read-route-spawns-nothing.test.ts`).
 */
const commonGitDir = (repoRoot: string): string | undefined => {
  const dotGit = path.join(repoRoot, '.git');
  const stat = fs.statSync(dotGit, { throwIfNoEntry: false });
  if (stat === undefined) return undefined;
  if (stat.isDirectory()) return dotGit;
  const named = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
  if (named === null) return undefined;
  const gitDir = path.resolve(repoRoot, named[1].trim());
  const commonFile = path.join(gitDir, 'commondir');
  return fs.existsSync(commonFile)
    ? path.resolve(gitDir, fs.readFileSync(commonFile, 'utf8').trim())
    : gitDir;
};

/** Whether a rules file holds a line naming exactly this repo-relative directory. */
const namesDirectory = (file: string, relative: string): boolean =>
  fs.existsSync(file) &&
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .some((l) => l.trim().replace(/^\/+|\/+$/g, '') === relative);

/**
 * Keep the desk root out of `git status`, when it lies inside the repository.
 *
 * The line goes into the COMMON git directory's `info/exclude`: git reads that
 * file from the common directory only, so a linked worktree's private gitdir is
 * the wrong place and a desk writing there would exclude nothing. The write is
 * idempotent — the line is appended only when absent — and `info/exclude` is
 * never committed, so this changes no contributor's checkout but this one.
 *
 * A root outside the repository needs no line, and neither does one the
 * repository's root `.gitignore` already names — the line `/plot-init` writes.
 * That is a read of the two files rather than `git check-ignore`: a pattern
 * that ignores the directory some other way gets a second, redundant rule,
 * which is untidy and changes nothing git does.
 *
 * It is best-effort. Every failure here leaves untracked files in a listing,
 * which is untidy; refusing to write a log over it would lose the agent's own
 * words, which is the greater harm.
 *
 * @concept desk-root
 * @param repoRoot absolute path to the repository this board serves
 */
const excludeDeskRoot = (repoRoot: string): void => {
  const line = deskRootPlacement({ configured: readWorktreeRoot(repoRoot), repoRoot }).excludeLine;
  if (line === undefined) return;
  try {
    const relative = line.replace(/^\/+|\/+$/g, '');
    if (namesDirectory(path.join(repoRoot, '.gitignore'), relative)) return;
    const common = commonGitDir(repoRoot);
    if (common === undefined) return;
    const exclude = path.join(common, 'info', 'exclude');
    if (namesDirectory(exclude, relative)) return;
    const held = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, held === '' || held.endsWith('\n') ? `${line}\n` : `\n${line}\n`);
  } catch {
    // Best-effort, for the reason the block above gives.
  }
};

/**
 * What kind of agent run a file belongs to — the `plot-<kind>-…` name segment.
 *
 * A closed set rather than a string, because these names are also what a sweep
 * globs for: a caller inventing a sixth kind would write a file that the
 * cleanup does not know to remove, which is the failure this plan exists to
 * stop recurring.
 */
export const KINDS = [
  'approve',
  'commission',
  'deliver',
  'dispatch',
  'idea-issue',
  'implement',
  'interrogate',
  'release',
  'reslice',
  'resolve',
  'story-issue',
] as const;

/**
 * The kinds as a type, DERIVED from {@link KINDS} rather than declared beside
 * it.
 *
 * The union has to exist at runtime because the migration globs for these
 * names, and a hand-written union beside a hand-written array is two lists that
 * drift — which would produce exactly the failure the closed set prevents: a
 * kind the compiler accepts and the sweep does not know to move.
 */
export type AgentLogKind = (typeof KINDS)[number];

/**
 * Which of a run's three files is wanted.
 *
 * `log` is the agent's own words, `state` the outcome a later GET reads back,
 * and `prompt` the brief handed to it. All three share a directory because all
 * three share the reason for being outside the repo — and because a sweep that
 * knows about the log and not its `.state` companion leaves half a run behind.
 */
export type AgentLogFile = 'log' | 'state' | 'prompt';

const EXTENSIONS: Record<AgentLogFile, string> = {
  log: '.log',
  state: '.state',
  prompt: '.prompt.md',
};

/**
 * Where the `<file>` for a `<kind>` run keyed by `id` lives.
 *
 * `id` is whatever names the run to its module — a plan slug for `dispatch` and
 * `deliver`, an issue number for `idea-issue` and `story-issue`, a branch with
 * its slashes flattened for `resolve`. The resolver does not interpret it: the
 * module that spawned the agent knows what identifies its run, and a resolver
 * that second-guessed that would need to know all nine.
 *
 * It creates the directory through {@link ensureAgentLogDir}, which is memoised
 * per desk root, so the `mkdir` and the `info/exclude` write happen once per
 * process and every later call is a `Set` lookup. `dispatchLogExists` asks this
 * once per card on every pulse and stays one `stat`.
 *
 * @param repoRoot absolute path to the repository this board serves
 * @param kind which command spawned the run
 * @param id what names the run within that kind
 * @param file which of the run's three files is wanted
 * @returns an absolute path; the file need not exist
 */
export const agentLogPath = (
  repoRoot: string,
  kind: AgentLogKind,
  id: string | number,
  file: AgentLogFile,
): string => path.join(ensureAgentLogDir(repoRoot), `plot-${kind}-${id}${EXTENSIONS[file]}`);

/**
 * Whether a resolved path sits inside {@link agentLogDir} for this repository.
 *
 * THE INVARIANT THE RESOLVER OWNS, ASKED BY THE ROUTE THAT SERVES THESE FILES
 * TO A BROWSER. `/api/dispatch-log` validates its SLUG, and that guard is
 * directory-independent — it excludes `../` wherever the logs live. This is the
 * second question: not *is the caller's input a filename* but *did the address
 * we computed land where logs are allowed to be*. A future caller could violate
 * that without touching the slug at all.
 *
 * Compared with a trailing separator so `/tmp/logs-elsewhere` is not read as
 * being under `/tmp/logs`; the directory itself is not "inside" itself, and a
 * log is always a file within it. Both sides go through `path.resolve`, so
 * `..` segments are collapsed before the comparison rather than matched as
 * text.
 *
 * @param repoRoot absolute path to the repository this board serves
 * @param candidate the resolved path to check; need not exist
 */
export const isUnderAgentLogDir = (repoRoot: string, candidate: string): boolean => {
  const dir = agentLogDir(repoRoot);
  const resolved = path.resolve(candidate);
  return resolved.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
};

/**
 * The marker recording that this repository's old logs have been moved.
 *
 * It lives in the NEW directory rather than the old one, so the record sits
 * with the thing it describes: a migration that ran is a `.worktrees/` holding
 * logs, and the marker beside them says so. A marker in the parent directory
 * would be one more file Plot left in a directory it does not own — the exact
 * shape this slice exists to stop.
 */
export const MIGRATION_MARKER = '.plot-logs-moved';

/**
 * The files a run leaves behind, as a matcher — `plot-<kind>-<id>.<ext>`.
 *
 * Built from {@link AgentLogKind} and {@link EXTENSIONS} rather than written
 * out, so a tenth kind is swept by the migration the day it is added. The
 * alternative is a second list of names that drifts from the first, which is
 * the failure the kind union was made a closed set to prevent.
 *
 * DELIBERATELY NARROW. A dispatch that touches files in the parent directory
 * does more than it says, so the boundary is the point: exactly what Plot
 * wrote, and nothing that merely looks like it.
 */
const MIGRATABLE = new RegExp(
  `^plot-(?:${KINDS.join('|')})-.+(?:${Object.values(EXTENSIONS)
    .map((e) => e.replace(/\./g, '\\.'))
    .join('|')})$`,
);

/**
 * Move this repository's pre-2026-08-30 agent logs into {@link agentLogDir},
 * once.
 *
 * THE MIGRATION IS CONVENIENCE; THE DISPATCH IS THE JOB. Every failure mode
 * here — an unreadable source directory, a file that will not move, a marker
 * that cannot be written — returns rather than throws, because a dispatch that
 * fails for want of tidying an old log has traded the job for the convenience.
 *
 * Bounded four ways, and the bounds are the design:
 *
 * - **moves only {@link MIGRATABLE} names** — `plot-<kind>-*` with one of the
 *   three extensions. A file Plot did not write is not Plot's to touch.
 * - **moves, never deletes.** A name collision in the destination leaves the
 *   source where it is; the destination is authoritative because it is the one
 *   the running board writes to.
 * - **runs once**, recorded by {@link MIGRATION_MARKER} in the destination.
 * - **cannot fail a dispatch** — see above.
 *
 * A no-op when the destination equals the source: a repository with no
 * `Worktree root` key never moved, so there is nothing to move and no marker to
 * write.
 *
 * @param repoRoot absolute path to the repository this board serves
 * @returns how many files were moved; `0` covers "already run" and "nothing to do"
 */
export const migrateAgentLogs = (repoRoot: string): number => {
  const dest = agentLogDir(repoRoot);
  const src = path.resolve(repoRoot, '..');
  if (dest === src) return 0;

  const marker = path.join(dest, MIGRATION_MARKER);
  try {
    if (fs.existsSync(marker)) return 0;
  } catch {
    return 0;
  }

  let names: string[];
  try {
    names = fs.readdirSync(src).filter((n) => MIGRATABLE.test(n));
  } catch {
    return 0;
  }

  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch {
    return 0;
  }

  let moved = 0;
  for (const name of names) {
    const to = path.join(dest, name);
    try {
      // `existsSync` then rename is a race in principle, and the race is benign:
      // both branches leave the destination file intact, which is the property
      // that matters. The check is what makes "never deletes" true for the
      // ordinary case of a migration run twice against a half-moved directory.
      if (fs.existsSync(to)) continue;
      fs.renameSync(path.join(src, name), to);
      moved += 1;
    } catch {
      // One file that will not move — a cross-device rename, a permission, a
      // file deleted between the listing and the move — must not stop the
      // others, and must not stop the dispatch.
    }
  }

  try {
    fs.writeFileSync(marker, `${new Date().toISOString()} moved=${moved}\n`);
  } catch {
    // An unwritten marker costs a re-run of an idempotent sweep, which is the
    // cheapest failure available here.
  }
  return moved;
};
