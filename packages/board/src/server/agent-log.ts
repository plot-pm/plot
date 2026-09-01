import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PortResult } from '@plot-pm/domain';
import { scriptsShell } from '@plot-pm/domain/adapters';

/**
 * Where the board's agent logs live — the ONE place that decides it.
 *
 * Nine modules spawn agents and each keeps its own log, prompt and state file
 * beside the others. Until 2026-08-30 each of them resolved the directory
 * itself, so one decision was written 22 times; this module is that decision,
 * and the nine ask it.
 *
 * WHY THE FILES SIT OUTSIDE THE REPOSITORY, since this is now the only place
 * that knows: `pnpm board` runs under `node --watch`, which watches the whole
 * tree and does not read `.gitignore`. A file written INSIDE the repo restarts
 * the very server that just spawned the agent, and the restart can take the
 * agent with it. Measured 2026-08-25 walking the v2.9.0 endgame: clicking
 * *Create plan* on issue #333 wrote `.plot/idea-issue-333.md`, the board log
 * recorded `Restarting 'board-server.mjs'` in the same second, and the agent's
 * log sat at 0 bytes. It recovered on a later attempt, which is worse than a
 * clean failure: the defect is a race, so it disappears when looked at.
 *
 * The second reason is the same one in different words — a log inside the repo
 * is an untracked file every `git status` reports and every worktree inherits,
 * so a repair that dirties its own worktree cannot be verified by the suite it
 * then runs.
 *
 * `.worktrees/` satisfies both and is a directory Plot owns: it is ignored by
 * git, so it is not untracked-noise, and it is not watched into a restart.
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
};

/**
 * Forget the cached `Worktree root` readings.
 *
 * For tests, which change the configuration of a fixture repo between cases
 * inside one process — the only caller for whom the per-process read is a
 * limitation rather than the point.
 */
export const forgetWorktreeRoot = (): void => worktreeRootCache.clear();

/**
 * The directory the board's agent logs, prompts and state files live in.
 *
 * Under the configured {@link WORKTREE_ROOT_KEY}: a log belongs beside the
 * checkout it describes, and `.worktrees/` is Plot's own directory holding
 * exactly the things a dispatch creates. Before 2026-08-30 there was nowhere
 * of the sort, so "not in the repo" was implemented as "the directory beside
 * it" — which Plot does not own, and where 190 logs totalling 2.6 MB had
 * accumulated since 2026-08-17 with nothing that would ever remove one.
 *
 * THE FALLBACK IS TODAY'S LOCATION, NOT AN ERROR. A repository with no
 * `Worktree root` key has no `.worktrees/`, and creating one because a log
 * needs somewhere to go invents a directory nobody asked for. That is the same
 * precedence `resolve_wt_root()` applies, and it is read from the same key so
 * the two cannot disagree.
 *
 * Relative values resolve against `repoRoot`, absolute ones are taken as given
 * — again `resolve_wt_root()`'s rule. The result is pure string work: the
 * directory need not exist, because a first dispatch is entitled to create it.
 *
 * @param repoRoot absolute path to the repository this board serves
 * @returns an absolute directory path; it need not exist
 */
export const agentLogDir = (repoRoot: string): string => {
  const configured = readWorktreeRoot(repoRoot);
  if (configured === '') return path.resolve(repoRoot, '..');
  const root = path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
  // Normalise a trailing slash away so composed paths never double it —
  // `resolve` does this, and does it without touching the filesystem.
  return path.resolve(root);
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
): string => path.join(agentLogDir(repoRoot), `plot-${kind}-${id}${EXTENSIONS[file]}`);

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
