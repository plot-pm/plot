import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { marked } from 'marked';
import {
  PlanMetaSchema,
  StoryCardSchema,
  toBoardPhase,
  BOARD_PHASES,
  type Board,
  type Card,
  type Column,
  type CardPr,
  type Phase,
  type PlanStatus,
  type SprintCard,
  type SprintMember,
  type StoryCard,
  type StoryCardInput,
  type FleetPulse,
  type PlanMeta,
  type WaveSummary } from '../contract/schema.js';
import { allSlicesMerged } from '@plot-pm/domain';
import { dispatchLogExists } from './dispatch.js';
import { prsByNumber, pulseFor, pulseCompleteFor } from './fleet.js';
import { extractTopics } from './topics.js';

/**
 * Where to look. `repoRoot` is the adopting project (source of plans / sprints
 * / stories — the CWD in normal use). `scriptsDir` is where Plot's helper
 * scripts live (next to the shipped artifact); it is NOT assumed equal to
 * `repoRoot`, because the board artifact ships inside the plot plugin and reads
 * a different repo's plans.
 */
export interface BuildBoardOptions {
  repoRoot: string;
  scriptsDir: string;
  /**
   * Whether this board process may repair an artifact conflict, or only report
   * one. Absent means yes — see {@link repairEnabledFromEnv}.
   *
   * It sits on the options every layer already carries, rather than on the
   * pulse's own, because it describes the PROCESS the way `repoRoot` does.
   * That is also what lets it reach `startRepair` down a call chain none of
   * whose signatures had to change to admit it.
   */
  repairEnabled?: boolean;
}

/**
 * Resolve `repoRoot` through symlinks. Plan files are reported as real paths, so
 * the root must be resolved the same way for `path.relative` to come out
 * repo-relative (and for the /plan allowlist basenames to match card.path).
 */
function resolvedRepoRoot(opts: BuildBoardOptions): string {
  try {
    return fs.realpathSync(opts.repoRoot);
  } catch {
    return opts.repoRoot;
  }
}

/**
 * Count a release checklist: `- [x]` over `- [ ]`.
 *
 * This is a SECOND contract surface — a markdown shape no other script reads,
 * the class of dependency that let a broken board call sit unnoticed for five
 * months. It earns its place only because the Testing column asks *what is left
 * before signoff*, which "Delivered" does not answer, and because the parse is
 * small enough to pin completely with tests.
 *
 * Deliberately strict: only list items at the start of a line, only `x` (any
 * case) as done. Anything else is not counted rather than guessed at — a wrong
 * `15/27` looks exactly as authoritative as a right one.
 */
export function countChecklist(text: string): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  for (const line of text.split('\n')) {
    const m = /^\s*[-*]\s+\[([ xX])\]\s/.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] !== ' ') done += 1;
  }
  return total > 0 ? { done, total } : null;
}

/**
 * The newest release checklist, or null. A missing, empty or unparseable file
 * produces no badge — never a guessed number.
 */
function readChecklist(repoRoot: string, releaseDir: string): { done: number; total: number } | null {
  try {
    const dir = path.join(repoRoot, releaseDir);
    const files = fs.readdirSync(dir).filter((f) => /-checklist\.md$/.test(f)).sort();
    const newest = files.at(-1);
    if (!newest) return null;
    return countChecklist(fs.readFileSync(path.join(dir, newest), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Read one `## Plot Config` key via the shared helper (with a default).
 *
 * Exported for `approve.ts`, which needs `Approve command`. Config lookup goes
 * through this one function so `plot-config.sh` stays the only thing that knows
 * where Plot configuration lives.
 */
export function readConfig(opts: BuildBoardOptions, key: string, fallback: string): string {
  try {
    const out = execFileSync(
      'bash',
      [path.join(opts.scriptsDir, 'plot-config.sh'), 'get', key, fallback],
      { cwd: opts.repoRoot, encoding: 'utf8' },
    );
    return out.trim() || fallback;
  } catch {
    return fallback;
  }
}

/**
 * A plan the board will parse, and WHERE ITS BYTES CAME FROM.
 *
 * `path` is the plan's IDENTITY — repo-relative, the string a card renders and
 * the one a slug is cut from. It is the same whichever source supplied the
 * plan, which is what lets the two be merged at all.
 *
 * `content` is set only for a plan read out of a git ref: those bytes exist in
 * no file, so they are staged to a scratch path for the parser and the
 * canonical `path` is restored afterwards. A working-tree plan leaves it
 * undefined and is parsed where it lies — staging a file that already is one
 * would be 151 pointless writes.
 *
 * `local` marks a plan the REF DID NOT HAVE. It rides here rather than being
 * recomputed later because this is the only layer that can still see both
 * sources; by the time cards exist, the distinction is gone.
 */
interface PlanSource {
  path: string;
  content?: string;
  local: boolean;
  /**
   * The real file, for a working-tree plan only — the path the parser is
   * pointed at.
   *
   * CARRIED rather than rebuilt from `repoRoot` + `path`. A plan reached
   * through an `active/` symlink is resolved with `realpathSync`, and that
   * answer is the one that opens; re-joining the relative form would hand the
   * parser a path that need not exist. Rebuilding a path already in hand is
   * where the mistakes live — the same rule `StoryCard.path` follows.
   */
  file?: string;
}

/**
 * Every plan blob in a tree, read in ONE `git cat-file --batch`.
 *
 * THE PROCESS COUNT IS THE DESIGN, not an optimisation of it. Each `git` spawn
 * costs ~55 ms regardless of how little work it does — the constraint
 * `collectBranchPlans` caches on tip SHAs to avoid — so the shape that reads
 * one blob per spawn costs that 151 times on a path the client polls every few
 * seconds. Measured on this repo's estate 2026-08-27: ~1.5 s for a per-file
 * loop against 0.011 s for one batch, 136× apart. A per-file implementation
 * would satisfy every other rule this file follows and leave the board slower
 * than the defect it was written to fix.
 *
 * PARSED AS BYTES, NEVER AS A STRING. `--batch` frames each entry as
 * `<sha> blob <size>\n<size bytes>\n`, and `size` counts BYTES while a JS
 * string index counts UTF-16 units. This repo's plans are full of `—` and `→`;
 * one such character makes the two disagree (measured: 67 on a single plan) and
 * every subsequent entry in the stream would be sliced at the wrong offset. So
 * the buffer is walked by the declared length and decoded per entry.
 *
 * Returns an empty map where the ref cannot be resolved — a repo with no
 * remote, a fresh clone. The caller distinguishes that from "no plans"; this
 * only reports what it found.
 */
function readPlansFromRef(repoRoot: string, ref: string, planDir: string): Map<string, string> {
  const found = new Map<string, string>();
  // One listing, mode-filtered: `planPathsInTree` already drops the 120000
  // symlink entries, so each plan is named ONCE by its real path. That is why
  // the de-duplication the filesystem walk needed is gone rather than ported —
  // it existed because a plan indexed under active/ appears twice on disk, and
  // it appears once in a tree.
  const out = git(repoRoot, ['ls-tree', '-r', ref, '--', planDir]);
  const paths: string[] = [];
  const shas: string[] = [];
  for (const line of out.split('\n')) {
    const m = /^(\d{6}) blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (!m) continue;
    if (m[1] !== '100644' && m[1] !== '100755') continue;
    if (!m[3].endsWith('.md')) continue;
    shas.push(m[2]);
    paths.push(m[3]);
  }
  if (paths.length === 0) return found;
  const batch = gitBuffer(repoRoot, ['cat-file', '--batch'], shas.join('\n') + '\n');
  if (!batch) return found;
  let at = 0;
  for (let i = 0; i < paths.length; i++) {
    const nl = batch.indexOf(0x0a, at);
    if (nl === -1) break;
    const header = batch.toString('utf8', at, nl);
    const m = /^[0-9a-f]+ blob (\d+)$/.exec(header);
    // A missing object answers `<sha> missing`; the stream then holds no body
    // for it, so the walk continues from the next header rather than desyncing.
    if (!m) { at = nl + 1; continue; }
    const size = Number(m[1]);
    const start = nl + 1;
    found.set(paths[i], batch.toString('utf8', start, start + size));
    at = start + size + 1; // trailing newline after the body
  }
  return found;
}

/**
 * Plan files in the working tree, by repo-relative path.
 *
 * The walk that used to be the board's ONLY source, now its lesser one: it may
 * ADD a plan the ref does not carry, never override one it does. Symlinks are
 * still resolved here because a filesystem genuinely has them — `active/` holds
 * 129 pointing at the 151 real files — and the `seen` set is still needed for
 * exactly that reason. Its removal belongs to the tree listing, which never
 * sees a second copy in the first place.
 */
interface PlanEntry {
  /** Absolute path to the resolved file (symlinks followed). */
  absPath: string;
  /** All entry names that point to this file (symlink names + real basename). */
  entryNames: Set<string>;
}

function workingTreePlans(repoRoot: string, planDir: string): Map<string, PlanEntry> {
  const byRelPath = new Map<string, PlanEntry>();
  const seen = new Map<string, string>(); // resolved path → relPath key
  const root = path.join(repoRoot, planDir);
  const dirs = [path.join(root, 'active'), path.join(root, 'delivered'), root];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      let resolved: string;
      try {
        resolved = fs.realpathSync(path.join(dir, entry));
        // A directory named "foo.md" passes the extension check; skip it so
        // plot-plan-meta.sh is never handed a directory (awk: "Is a directory").
        if (!fs.statSync(resolved).isFile()) continue;
      } catch {
        continue; // broken symlink or unreadable
      }
      const existingKey = seen.get(resolved);
      if (existingKey) {
        // Same file seen via different name (symlink); add the entry name
        byRelPath.get(existingKey)!.entryNames.add(entry);
      } else {
        const relPath = path.relative(repoRoot, resolved);
        seen.set(resolved, relPath);
        byRelPath.set(relPath, {
          absPath: resolved,
          entryNames: new Set([entry, path.basename(resolved)]),
        });
      }
    }
  }
  return byRelPath;
}

/**
 * What the board reports about WHERE THE PLAN ESTATE CAME FROM.
 *
 * `ref` is the ref that was read (`origin/main`), `resolved` whether it could
 * be. The pair is not collapsible to one nullable field: a reader meeting an
 * unresolved estate needs to know WHICH ref failed, and that is the sentence
 * the board is expected to say rather than silently rendering a checkout.
 */
interface PlanSourceReport {
  ref: string;
  resolved: boolean;
  /** Plans the ref did not carry — the ones a card marks `not pushed`. */
  localOnly: number;
  /** Commits the checkout is behind `ref`, or null where nothing can be said. */
  behind: number | null;
}

/**
 * HOW FAR THE CHECKOUT SITS BEHIND THE REF, or null where that is unanswerable.
 *
 * A diagnostic. Since the estate is read from `ref`, a stale checkout no longer
 * makes the board WRONG — it makes it unexplainable, which is what cost an hour
 * on 2026-08-27 when the worktree drifted 16 commits and nothing said so.
 *
 * THE ORDER OF THE TWO QUESTIONS IS THE WHOLE CORRECTNESS ARGUMENT, because the
 * count alone cannot tell a measurement from its absence:
 *
 * ```
 * $ git checkout --detach origin/main   # no upstream; nothing to be behind
 * $ git rev-list --count HEAD..origin/main
 * 0                                     # ← reads as "up to date"
 * ```
 *
 * Measured, not reasoned: a detached HEAD parked at the ref's tip returns 0,
 * indistinguishable from a genuinely current branch. So this asks FIRST whether
 * HEAD is a branch at all — `symbolic-full-name` fails when detached — and only
 * measures once the question is known to have an answer. Establish that the
 * question is answerable, then answer it.
 *
 * NO NETWORK. `rev-list` reads the local mirror the fleet scan already fetched
 * on its own timer, so this is a local walk on the request path, not a host
 * round trip. The number is therefore a LOWER BOUND on the true drift, which is
 * the right trade: a lower bound above zero is the entire signal, and the cost
 * of the exact answer would be host latency on a 5 s cadence.
 */
function measureBehind(repoRoot: string, ref: string, resolved: boolean): number | null {
  // Nothing to be behind. An unresolved ref is already reported by `resolved`,
  // and inventing a distance from it would be the substitution this file's
  // every other branch refuses.
  if (!resolved) return null;
  // Is HEAD a branch? Empty means detached — the case that would otherwise
  // report a confident 0. Never fall through to the count on this path.
  if (git(repoRoot, ['symbolic-ref', '--quiet', 'HEAD']).trim() === '') return null;
  const raw = git(repoRoot, ['rev-list', '--count', `HEAD..${ref}`]).trim();
  // `git()` answers '' on ANY failure, so a non-numeric reading is a failed
  // measurement rather than a zero one. Parsing loosely here would convert
  // every unforeseen git error into "up to date" — the exact false confidence
  // the null case exists to prevent.
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * THE MERGE, and it runs in ONE DIRECTION.
 *
 * | the ref says | the working tree says | the answer |
 * |---|---|---|
 * | a plan | anything | the REF's, unmarked |
 * | nothing | a plan | the tree's, marked `local` |
 * | unreadable | anything | nothing, and `resolved: false` |
 *
 * Row 1 is the safety property and the whole reason this function exists: the
 * defect being fixed is a board reporting a checkout as if it were shared
 * truth, and letting the tree win here would reintroduce it with extra steps —
 * an uncommitted edit would silently become what the board tells everyone.
 *
 * Row 2 is why local plans are SHOWN rather than hidden. A plan is invisible
 * for the minutes between writing and pushing (five were, in one session on
 * 2026-08-27), and an EDITED-but-unpushed plan would otherwise render its older
 * ref content with nothing to say the tree disagreed. A card that says `not
 * pushed` claims nothing about what everyone can see; it states exactly what it
 * is.
 *
 * Row 3 refuses to substitute. `plot-dispatch.sh`'s phase gate states the rule
 * this file is the third instance of: there is deliberately no fallback to the
 * working tree, because that "would reintroduce the bug exactly where nothing
 * can catch it". A repo with no remote gets a stated answer, not a promoted one.
 */
function collectPlanSources(
  repoRoot: string,
  planDir: string,
  ref: string,
): { sources: PlanSource[]; report: PlanSourceReport } {
  const fromRef = readPlansFromRef(repoRoot, ref, planDir);
  // An empty listing is ambiguous on its own — an unreadable ref and a repo
  // with no plans yet look identical — so the ref is resolved SEPARATELY. Only
  // `rev-parse` can tell "there is no such ref" from "there is, and it is
  // empty", and the two owe the reader different sentences.
  const resolved = git(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() !== '';
  const sources: PlanSource[] = [];
  for (const [relPath, content] of fromRef) {
    sources.push({ path: relPath, content, local: false });
  }
  let localOnly = 0;
  for (const [relPath, entry] of workingTreePlans(repoRoot, planDir)) {
    // The ref wins. Row 1: present in both means the ref's bytes, unmarked.
    if (fromRef.has(relPath)) continue;
    localOnly++;
    // No `content`: the file is already on disk, so the parser is pointed at it
    // where it lies, by the path `realpathSync` actually resolved.
    sources.push({ path: relPath, local: true, file: entry.absPath });
  }
  return { sources, report: { ref, resolved, localOnly, behind: measureBehind(repoRoot, ref, resolved) } };
}

/**
 * A plan file that lives on a branch rather than in the working tree.
 *
 * `path` is the plan's IDENTITY — its repo-relative path, the same string a
 * working-tree plan carries, and the one a card must show. `content` is the
 * blob as git holds it; it is written to a scratch file only for as long as the
 * parser needs one, because `plot-plan-meta.sh` takes paths rather than stdin.
 */
interface BranchPlan {
  path: string;
  content: string;
}

/**
 * Run a git command against the repo, or return "" if it fails.
 *
 * Every call here reads LOCAL refs. `git ls-remote` is deliberately not used
 * anywhere in this file: it costs ~459 ms against ~8 ms for `for-each-ref`
 * (measured on this repo), and the board's board endpoint is polled every few
 * seconds — the network call would make a poll loop depend on the git host
 * being reachable. The local mirror is also already correct, because the fleet
 * scan fetches on its own timer: `refs/remotes/origin/*` is as fresh as the
 * pulse the Agents tab renders from.
 */
function git(repoRoot: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

/**
 * The same read as {@link git}, but fed on stdin and answered in BYTES.
 *
 * Both halves exist for `cat-file --batch` and nothing else. It takes its
 * object list on stdin because that is the one call here whose input is
 * unbounded — 151 SHAs today, and an argument list has a limit a plan estate
 * should never be able to reach. It returns a Buffer because the batch stream
 * declares each body's length in BYTES, and decoding the whole stream to a
 * string first would make those lengths unusable the moment a plan contains a
 * non-ASCII character, which every plan in this repo does.
 *
 * `maxBuffer` is 64 MB, matching `readPlanMeta`'s: the whole estate arrives in
 * one response here too (2.1 MB measured), and the failure mode of guessing low
 * is a silent truncation midway through a stream that is parsed by offset.
 */
function gitBuffer(repoRoot: string, args: string[], input: string): Buffer | null {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/**
 * Remote-tracking refs under the configured branch prefixes, minus the default
 * branch. Prefixes come from `## Plot Config` (`idea/, feature/, bug/, …`), so
 * nothing here hardcodes `idea/` — an adopting project renames its prefixes and
 * the board follows.
 *
 * `feature/` and `bug/` are searched as well as `idea/`, deliberately: an
 * `Impl: same branch` plan rides its work branch, so its Draft phase would be
 * invisible for exactly the same reason if the net were narrowed to idea
 * branches.
 */
function prefixedBranches(
  repoRoot: string,
  prefixes: string[],
  defaultBranch: string,
): { branch: string; sha: string }[] {
  if (prefixes.length === 0) return [];
  // `repoRoot` must BE the repository, not merely sit inside one. git resolves
  // upwards from the cwd, so a plans directory nested in an unrelated checkout
  // would otherwise inherit that checkout's branches and stage plan files from
  // them — cards for work belonging to a different project entirely. Cheap to
  // check (~2 ms) and it fails the safe way: no branches, behaving exactly as
  // a repo with none.
  const top = git(repoRoot, ['rev-parse', '--show-toplevel']).trim();
  if (!top) return [];
  try {
    if (fs.realpathSync(top) !== fs.realpathSync(repoRoot)) return [];
  } catch {
    return [];
  }
  const patterns = prefixes.map((p) => `refs/remotes/origin/${p}*`);
  // The tip SHA comes back in the SAME call as the name — free here, and what
  // lets the cache below skip everything when no branch has moved.
  const out = git(repoRoot, ['for-each-ref', '--format=%(refname:short)\t%(objectname)', ...patterns]);
  const branches: { branch: string; sha: string }[] = [];
  for (const line of out.split('\n')) {
    const [ref, sha] = line.trim().split('\t');
    if (!ref || !sha) continue;
    const branch = ref.replace(/^origin\//, '');
    if (!branch || branch === defaultBranch) continue;
    branches.push({ branch, sha });
  }
  return branches;
}

/**
 * The default branch, resolved WITHOUT the network — same order as
 * `plot-fleet-scan.sh`, which is the script this file's git reading has to
 * agree with: the `Main branch` config key, then the local `origin/HEAD`
 * symbolic ref, then `main`.
 *
 * Deliberately not `plot-host.sh default-branch`: on GitHub that shells out to
 * `gh repo view`, and the board's plan walk runs on every /api/board request.
 * The one place a host CLI belongs is the PR fetch, which has its own slow
 * timer for exactly this reason.
 */
function defaultBranchOf(opts: BuildBoardOptions, repoRoot: string): string {
  const configured = readConfig(opts, 'Main branch', '');
  if (configured) return configured;
  const symbolic = git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    .trim()
    .replace(/^origin\//, '');
  return symbolic || 'main';
}

/** Plan-file paths in a tree — regular blobs only, never the active/ symlinks. */
function planPathsInTree(repoRoot: string, ref: string, planDir: string): Set<string> {
  const paths = new Set<string>();
  // `-r` to recurse; the full ls-tree format is needed for the MODE, which is
  // what separates a plan file from the symlink pointing at it. A 120000 entry
  // holds its target's path as content, so parsing one would hand
  // plot-plan-meta.sh a line of text where a plan should be — and would also
  // double-count every plan that is indexed under active/.
  const out = git(repoRoot, ['ls-tree', '-r', ref, '--', planDir]);
  for (const line of out.split('\n')) {
    const m = /^(\d{6}) blob [0-9a-f]+\t(.+)$/.exec(line);
    if (!m) continue;
    if (m[1] !== '100644' && m[1] !== '100755') continue;
    if (!m[2].endsWith('.md')) continue;
    paths.add(m[2]);
  }
  return paths;
}

/**
 * Plan files that exist on a prefixed branch and NOT on the default branch.
 *
 * That set is the Draft plans, and it needs no new convention to be true: a
 * plan under review lives on its own branch until the plan PR merges, and
 * everything else on that branch matches the default branch because the branch
 * was cut from it. Nothing is inferred from the branch NAME beyond where to
 * look — the phase is still read out of the file by `plot-plan-meta.sh`,
 * exactly as for a working-tree plan.
 *
 * Returns the plan CONTENT rather than a file: staging is the caller's problem,
 * and keeping it out of here is what lets the result be cached across requests.
 */
function readBranchPlans(
  repoRoot: string,
  planDir: string,
  branches: { branch: string; sha: string }[],
  defaultBranch: string,
): BranchPlan[] {
  const onDefault = planPathsInTree(repoRoot, `origin/${defaultBranch}`, planDir);
  const plans: BranchPlan[] = [];
  // De-duplicate by canonical path, matching collectPlanFiles's contract: two
  // branches cut from the same point carry the same plan file, and a card per
  // branch would report one plan as several.
  const seen = new Set<string>();
  for (const { branch } of branches) {
    for (const relPath of planPathsInTree(repoRoot, `origin/${branch}`, planDir)) {
      if (onDefault.has(relPath) || seen.has(relPath)) continue;
      const content = git(repoRoot, ['show', `origin/${branch}:${relPath}`]);
      // An unreadable blob yields "" — skipped rather than parsed, so a branch
      // the board cannot read costs a card and never produces a blank one.
      if (!content) continue;
      seen.add(relPath);
      plans.push({ path: relPath, content });
    }
  }
  return plans;
}

/**
 * Branch plans, re-read only when a branch tip has actually moved.
 *
 * Each `git` invocation costs ~55 ms of process spawn regardless of how little
 * work it does, so reading eight branches' trees is ~0.5 s — on a path the
 * client polls every few seconds. The refs, though, barely move: a plan branch
 * changes when someone pushes to it, which is minutes apart at best.
 *
 * So the tip SHAs (which `for-each-ref` already returned, in the one call that
 * has to happen anyway) are the cache key. An unchanged fleet of branches costs
 * exactly that one call; a moved one re-reads everything. The key covers branch
 * names as well as SHAs, so a branch appearing or disappearing invalidates too.
 *
 * Keyed by repo, because the module is shared and the board takes its root as a
 * parameter — the same reason `fleet.ts` keys its cache that way.
 */
const branchPlanCache = new Map<string, { key: string; plans: BranchPlan[] }>();

function collectBranchPlans(
  repoRoot: string,
  planDir: string,
  prefixes: string[],
  defaultBranch: string,
): BranchPlan[] {
  const branches = prefixedBranches(repoRoot, prefixes, defaultBranch);
  if (branches.length === 0) {
    branchPlanCache.delete(repoRoot);
    return [];
  }
  const key = branches.map((b) => `${b.branch}@${b.sha}`).join(' ');
  const cached = branchPlanCache.get(repoRoot);
  if (cached && cached.key === key) return cached.plans;
  const plans = readBranchPlans(repoRoot, planDir, branches, defaultBranch);
  branchPlanCache.set(repoRoot, { key, plans });
  return plans;
}

/**
 * Condense a plan's wave state for its card, reading each source where that
 * source is authoritative.
 *
 * Shape comes from the plan (`waves`, `branches`, `deferred`): the plan file is
 * what says how the work is divided, and it says so whether or not git can be
 * read. Occupancy comes from the PULSE (`claimed`, `eligible`): a claim is an
 * empty `plot: claim <branch>` commit pushed as a ref, so the plan's `claimed`
 * annotation is a note *about* a claim that nobody writes — which is why the
 * card's count was not merely stale but permanently 0.
 *
 * A missing pulse omits both counts rather than reporting zeros. `claimed: 0`
 * must not be the same rendering as "git has not been read yet"; that
 * indistinguishability IS the bug.
 *
 * `eligible` counts branches that could be started right now: still `open` (not
 * claimed, not merged), in a wave the scan judged `eligible`. A blocked wave's
 * open branches are outstanding work but not startable work, and conflating
 * them would answer a different question than the one a tile is asked.
 */
export function summariseFromPulse(meta: PlanMeta, pulse: FleetPulse | null): WaveSummary {
  let branches = 0, deferred = 0;
  for (const w of meta.waves) {
    for (const b of w.branches) {
      if (b.deferred) deferred += 1;
      else branches += 1;
    }
  }
  const summary: WaveSummary = { waves: meta.waves.length, branches, deferred };

  // The pulse names plans by basename (symlink-resolved), while meta.file is an
  // absolute real path — so the basename is the join key both sides agree on.
  const plan = pulse?.plans.find((p) => p.file === path.basename(meta.file));
  if (!plan) return summary;

  let claimed = 0, eligible = 0;
  for (const wave of plan.slices) {
    for (const b of wave.branches) {
      if (b.state === 'claimed') claimed += 1;
      else if (b.state === 'open' && wave.verdict === 'eligible') eligible += 1;
    }
  }
  summary.claimed = claimed;
  summary.eligible = eligible;
  return summary;
}

/**
 * The deliverable rule now lives in `@plot-pm/domain` as `allSlicesMerged`.
 *
 * TEMPORARY ALIAS: the call sites still say `allWavesMerged`, and renaming them
 * is a separable change. Remove it once they read the domain name.
 */
export { allSlicesMerged as allWavesMerged, type Landed } from '@plot-pm/domain';

/**
 * Whether the pulse shows a claim ref on any of this plan's branches — the
 * fleet's half of the *someone picked this up* fact that `Started:` records are
 * the plan file's half of.
 *
 * A claim is a pushed ref, the atomic act of taking a branch; the `claimed`
 * annotation in the file is only its reflection. So `in-progress` splits from
 * `approved` on EITHER signal — a `Started:` record OR a claim the scan saw —
 * because both mean the same thing and either can arrive first.
 *
 * Joined on basename, the same key `allWavesMerged` uses. Absent plan, cold
 * cache, or an unmatched name all read as *no claim*, which is the honest
 * answer: the scan has said nothing to the contrary.
 */
function anyBranchClaimed(meta: PlanMeta, pulse: FleetPulse | null): boolean {
  const plan = pulse?.plans.find((p) => p.file === path.basename(meta.file));
  if (!plan) return false;
  return plan.slices.some((w) => w.branches.some((b) => b.state === 'claimed'));
}

/**
 * A plan's MEASURED status — one of seven, derived every scan and stored
 * nowhere. See {@link PlanStatus} for the contract and the measurement-vs-
 * decision distinction this field exists to hold.
 *
 * Composed from the plan file (`meta`: phase, review channel, `Started:` count)
 * and the pulse (merge state, claim refs). It returns a string and touches
 * nothing — no phase is flipped, no record written — exactly as `allWavesMerged`
 * returns a boolean and `deriveWaves` returns waves.
 *
 * The phase is read FIRST, and three of the seven are read straight off it:
 * `released`, `delivered`, and the two draft-side values. Those three can never
 * disagree with `phase` because they ARE the phase — a test that constructs a
 * disagreement (a delivered plan with an open branch) must still read
 * `delivered`, and this ordering is why.
 *
 * Only within `approved` does the measurement matter, and it splits three ways
 * in a fixed order:
 *   - `deliverable` first — every non-deferred branch merged (`allWavesMerged`),
 *     the decision outstanding. It is the value that earns the field, so it is
 *     tested before the two that would otherwise also hold.
 *   - `in-progress` — a `Started:` record OR a claim ref: someone picked it up.
 *   - `approved` — none of the above: the queue the Start button serves.
 *
 * `open` vs `draft` is the draft-side split, and it is about the PLAN's own PR,
 * not availability. `Review: pr` is the channel that leaves a PR to observe; a
 * draft plan on it is out for approval (`open`). A `Review: in-session` plan has
 * no plan PR and moves draft → approved WITHOUT passing through `open` — a legal
 * path, not an error, and the reason this reads the channel rather than probing
 * for a PR that a whole class of plans never has.
 */
export function planStatus(
  meta: PlanMeta,
  pulse: FleetPulse | null,
  complete: boolean,
): PlanStatus {
  switch (meta.phase) {
    case 'released':
      return 'released';
    case 'delivered':
      return 'delivered';
    case 'approved':
      // `unknown` is not `deliverable` and not a reason to call the plan
      // in-progress either — it is the scan having said nothing. The card falls
      // through to the claim/`Started:` reading below, which is a fact about the
      // plan FILE and survives a partial pulse; a plan the scan never reached
      // keeps whatever those say rather than being told its work is unfinished.
      if (allSlicesMerged(meta, pulse, complete) === 'merged') return 'deliverable';
      if (meta.started_raw.length > 0 || anyBranchClaimed(meta, pulse)) return 'in-progress';
      return 'approved';
    default:
      // Draft, Design, and anything the mapper does not advance past the
      // draft side. `open` is the plan's own PR being up — `Review: pr` — and
      // everything else is `draft`. An in-session plan has no plan PR, so it is
      // `draft` here and `approved` above, never `open` between them.
      return meta.review === 'pr' ? 'open' : 'draft';
  }
}

/**
 * Where this plan's branches are checked out on THIS machine, from the pulse.
 *
 * Presence, not dirtiness — the inverse of what lifts a row's group, and
 * deliberately so: dirtiness is evidence of *work*, presence is evidence of
 * *location*, and the modal this feeds asks about location. A clean checkout
 * answers "where did I put this" exactly as well as a dirty one.
 *
 * Empty where this machine has no worktree for any of the plan's branches,
 * which is the common case and the one that keeps the field honest: a path is
 * true here and meaningless anywhere else, so a reader elsewhere gets nothing
 * rather than a directory that does not exist for them.
 */
export function worktreesFromPulse(
  meta: PlanMeta,
  pulse: FleetPulse | null,
): { branch: string; path: string }[] {
  // Same join key as `summariseFromPulse`: the pulse names plans by basename
  // (symlink-resolved), while meta.file is an absolute real path.
  const plan = pulse?.plans.find((p) => p.file === path.basename(meta.file));
  if (!plan) return [];
  const found: { branch: string; path: string }[] = [];
  for (const wave of plan.slices) {
    for (const b of wave.branches) {
      if (b.local_worktree) found.push({ branch: b.branch, path: b.local_worktree });
    }
  }
  return found;
}

/**
 * The `YYYY-MM-DD` at the head of a transition record, or "".
 *
 * The records are written by hand and carry a tail — `2026-08-16, v2.3.0`,
 * `2026-08-16, jwloka, plan-PR #146 merged` — so only the leading date is read.
 * A record that does not begin with one yields "" rather than being coerced:
 * this is the same rule `approvalDates` in `fleet.ts` states, and for the same
 * reason. `Date.parse` is lenient enough to turn a typo into a confident wrong
 * answer, and a wrong date here reorders a column silently.
 */
export function leadingDate(record: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?![\d-])/.exec(record.trim());
  return m ? m[1] : '';
}

/**
 * The date belonging to a card's OWN phase — the whole reason the card carries
 * one field rather than four.
 *
 * Each column measures recency on its own clock: `Released` by when the work
 * shipped, `Testing` by when it was delivered, `Development` by when the plan
 * was approved, `Design` by when it entered Design. Reading one record for
 * every column would sort most of them by a date that is not theirs.
 *
 * `Design` and `Development` read DIFFERENT records now that Design is its own
 * phase: a plan in Design has an `Approved:` date only if it later leaves for
 * Approved, so while it sits in Design the only date it owns is `Design:`.
 *
 * `Discovery` has none, and that is correct rather than a gap: a Draft plan has
 * recorded no transition yet, so there is no date to be recent by. Such cards
 * keep the order they arrived in.
 *
 * Exported for test — this mapping is the load-bearing half of the truncation,
 * and getting it wrong produces a column that looks sorted and is not.
 */
export function phaseDateOf(phase: Phase, meta: PlanMeta): string {
  switch (phase) {
    case 'Released':
      return leadingDate(meta.released_raw);
    case 'Testing':
      return leadingDate(meta.delivered_raw);
    case 'Design':
      return leadingDate(meta.design_raw);
    case 'Development':
      return leadingDate(meta.approved_raw);
    case 'Discovery':
      return '';
  }
}

/** slug from a date-prefixed plan filename (YYYY-MM-DD-<slug>.md). */
function planSlug(file: string): string {
  const base = path.basename(file, '.md');
  const m = base.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return m ? m[1] : base;
}

/** Run the plan-format helper once over all plan files → validated records. */
function readPlanMeta(scriptsDir: string, files: string[]) {
  if (files.length === 0) return [];
  const out = execFileSync('bash', [path.join(scriptsDir, 'plot-plan-meta.sh'), ...files], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => PlanMetaSchema.parse(JSON.parse(l)));
}

/**
 * The MoSCoW heading a member line sits under → the tier it carries. A heading
 * outside this map (Sprint Goal, Notes, prose) puts the cursor in no tier, so
 * checkbox lines there are not members.
 */
const SPRINT_TIER_HEADINGS: ReadonlyArray<readonly [RegExp, SprintMember['tier']]> = [
  [/^### Must Have\b/, 'must'],
  [/^### Should Have\b/, 'should'],
  [/^### Could Have\b/, 'could'],
  [/^### Deferred\b/, 'deferred'],
];

/**
 * A sprint member line: `- [ ] [slug] …` or `- [x] [slug] …`. The first bracket
 * is the checkbox, the second is the plan slug. A `### Deferred` bullet written
 * as prose (`- **Renaming Endgame.** …`) has no `[slug]` and does not match.
 */
const SPRINT_MEMBER_LINE = /^- \[( |x)\] \[([^\]]+)\]/;

/**
 * Read a sprint file's members: the `- [ ] [slug]` / `- [x] [slug]` lines, the
 * MoSCoW tier each sits under, and whether it is ticked. A plan sliced across
 * waves lists its slug once per wave; the sprint contains it once, so members
 * are deduped by slug with the FIRST occurrence winning — the file is read
 * top-down and the sections run Must → Should → Could → Deferred, so a plan
 * keeps its strongest tier.
 *
 * Every member is emitted `known: true`; only `collectSprints`, which sees the
 * plan estate, can say otherwise.
 */
function parseSprintMembers(content: string): SprintMember[] {
  const members: SprintMember[] = [];
  const seen = new Set<string>();
  let tier: SprintMember['tier'] | null = null;
  for (const line of content.split('\n')) {
    if (line.startsWith('### ') || line.startsWith('## ')) {
      // A new heading resets the cursor: an unrecognised heading is no tier, so
      // its checkboxes are not counted.
      tier = SPRINT_TIER_HEADINGS.find(([re]) => re.test(line))?.[1] ?? null;
      continue;
    }
    if (!tier) continue;
    const m = line.match(SPRINT_MEMBER_LINE);
    if (!m) continue;
    const slug = m[2].trim();
    if (seen.has(slug)) continue;
    seen.add(slug);
    members.push({ slug, tier, checked: m[1] === 'x', known: true });
  }
  return members;
}

/**
 * Sprint files are not plan files, so they are read here rather than via
 * plot-plan-meta.sh (which owns the plan format only). Minimal, faithful port
 * of the previous walker's parseSprint, plus the member list.
 */
export function parseSprintFile(absPath: string): SprintCard | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  return parseSprintContent(content, path.basename(absPath));
}

/**
 * The same parse, over bytes that need not be a file.
 *
 * Split out so a sprint read from a git ref goes through ONE parser with the
 * working-tree one rather than a copy that drifts. `name` is the BASENAME the
 * slug and the fallback title are cut from — the identity a ref blob has as
 * surely as a file does, and the only thing the parse needed a path for.
 */
export function parseSprintContent(content: string, name: string): SprintCard | null {
  const base = path.basename(name);
  const titleMatch = content.match(/^# Sprint: (.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(base, '.md');
  const slugMatch = base.match(/^\d{4}-W\d{2}-(.+)\.md$/);
  const slug = slugMatch ? slugMatch[1] : path.basename(base, '.md');
  const statusSection = content.match(/## Status\s*\n([\s\S]*?)(?=\n## |$)/);
  const statusBody = statusSection ? statusSection[1] : '';
  const phaseMatch = statusBody.match(/^- \*\*Phase:\*\* (.+)$/m);
  const phase = phaseMatch ? phaseMatch[1].trim() : '';
  if (!phase) return null;
  // The sprint's target release, read from the same `## Status` block as the
  // phase and the same `- **Field:** value` shape. "" where the file names none:
  // the control renders nothing rather than a placeholder, so absence must reach
  // it as an empty string rather than a guess.
  const releaseMatch = statusBody.match(/^- \*\*Release:\*\* (.+)$/m);
  const release = releaseMatch ? releaseMatch[1].trim() : '';
  // Start and end dates from `## Status`.
  const startMatch = statusBody.match(/^- \*\*Start:\*\* (.+)$/m);
  const start = startMatch ? startMatch[1].trim() : '';
  const endMatch = statusBody.match(/^- \*\*End:\*\* (.+)$/m);
  const end = endMatch ? endMatch[1].trim() : '';
  // Sprint goal — the bold statement from `## Sprint Goal`. Extract the first
  // bold line as the goal headline.
  const goalSection = content.match(/## Sprint Goal\s*\n([\s\S]*?)(?=\n## |$)/);
  const goalBody = goalSection ? goalSection[1].trim() : '';
  const goalMatch = goalBody.match(/^\*\*(.+?)\*\*/m);
  const goal = goalMatch ? goalMatch[1].trim() : '';
  return { slug, title, phase, release, goal, start, end, members: parseSprintMembers(content) };
}

/**
 * Discover the sprints under `<sprintDir>/active/`.
 *
 * `knownSlugs`, when supplied, is the set of plan slugs the board actually
 * found; a member whose slug is not in it is flagged `known: false` and kept —
 * a sprint listing a renamed or deleted plan must still report it, or its own
 * scope becomes unknowable. Omitting the set leaves every member `known: true`
 * (the file's own answer), which is what a caller with no plan estate wants.
 */
export function collectSprints(
  repoRoot: string,
  sprintDir: string,
  knownSlugs?: ReadonlySet<string>,
  ref?: string,
): SprintCard[] {
  const sprints: SprintCard[] = [];
  // SPRINTS COME FROM THE REF TOO, by the same rule and for a sharper reason
  // than the plans: a sprint feeds the release gate and the tally, so reading a
  // stale one is a WRONG RELEASE DECISION rather than a cosmetic lag. Same
  // one-directional merge — the ref's sprints win, the working tree may only
  // add one the ref lacks.
  //
  // `ref` is optional because this function is exported and called with a plan
  // estate it does not own; omitting it reads the working tree alone, which is
  // what a caller with no repo behind it wants.
  const fromRef = ref
    ? readPlansFromRef(repoRoot, ref, path.join(sprintDir, 'active'))
    : new Map<string, string>();
  const takenSlugs = new Set<string>();
  const add = (sprint: SprintCard | null) => {
    if (!sprint || takenSlugs.has(sprint.slug)) return;
    takenSlugs.add(sprint.slug);
    if (knownSlugs) {
      sprint.members = sprint.members.map((m) =>
        knownSlugs.has(m.slug) ? m : { ...m, known: false },
      );
    }
    sprints.push(sprint);
  };
  for (const [relPath, content] of fromRef) {
    add(parseSprintContent(content, path.basename(relPath)));
  }
  const dir = path.join(repoRoot, sprintDir, 'active');
  if (!fs.existsSync(dir)) return sprints;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return sprints;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    let resolved: string;
    try {
      resolved = fs.realpathSync(path.join(dir, entry));
    } catch {
      continue;
    }
    // The ref wins where both carry the sprint — `add` drops a slug already
    // taken, so a working-tree sprint can only ADD.
    const sprint = parseSprintFile(resolved);
    if (!sprint) continue;
    add(sprint);
  }
  return sprints;
}

/**
 * Extract a markdown section by heading. Returns the content between the heading
 * and the next heading of equal or higher level (## or #), or end of document.
 */
function extractSection(content: string, heading: string): string {
  // Match ## Heading (level 2) - escape special regex chars in heading
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Use multiline flag for ^ matching line start. The lookahead finds the next
  // ## heading or end of string (using (?![\s\S]) which never matches anything).
  const pattern = new RegExp(`^## ${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n# |$(?![\\s\\S]))`, 'm');
  const match = content.match(pattern);
  if (!match) return '';
  return match[1].trim();
}

/**
 * Truncate text to approximately maxLen characters, breaking at word boundary
 * and adding ellipsis if truncated.
 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '…';
}

/**
 * List DESIGN-*.md files in a story directory.
 */
function listDesignDocs(storyDir: string): string[] {
  try {
    return fs.readdirSync(storyDir)
      .filter((f) => /^DESIGN-.*\.md$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Parse a story file to extract all metadata and content sections.
 * Story files use story-tracking's YAML front matter.
 */
function parseStoryFile(absPath: string, slug: string, relPath: string, storyDir: string): StoryCardInput | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }

  // Parse YAML frontmatter
  let title = '';
  let status = '';
  let author = '';
  let created = '';
  let updated = '';

  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const frontmatter = fm[1];
    const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
    if (titleMatch) title = titleMatch[1].trim();
    const statusMatch = frontmatter.match(/^status:\s*(.+)$/m);
    if (statusMatch) status = statusMatch[1].trim();
    const authorMatch = frontmatter.match(/^author:\s*(.+)$/m);
    if (authorMatch) author = authorMatch[1].trim();
    const createdMatch = frontmatter.match(/^created:\s*(.+)$/m);
    if (createdMatch) created = createdMatch[1].trim();
    const updatedMatch = frontmatter.match(/^updated:\s*(.+)$/m);
    if (updatedMatch) updated = updatedMatch[1].trim();
  }

  // Fall back to H1 heading for title
  if (!title) {
    const h1 = content.match(/^# (.+)$/m);
    title = h1 ? h1[1].trim() : slug;
  }

  // Extract content sections
  const objectiveFull = extractSection(content, 'Objective');
  const objective = truncateText(objectiveFull, 200);
  const design = extractSection(content, 'Design');
  const hasOpenPoints = /^## Open Points\s*$/m.test(content);
  const hasSessionLog = /^## Session Log\s*$/m.test(content);

  // List DESIGN-*.md files in the story directory
  const designDocs = listDesignDocs(storyDir);

  return {
    slug,
    title,
    status,
    author,
    created,
    updated,
    objective,
    design,
    path: relPath,
    designDocs,
    hasOpenPoints,
    hasSessionLog,
  };
}

/**
 * Derive story status from plan phases.
 *
 * - All plans released → 'archived'
 * - All plans delivered (or released) → 'done'
 * - Any approved plan (in progress) → 'active'
 * - Otherwise → 'draft'
 *
 * A story with no plans stays at its declared status (or 'draft').
 */
function deriveStoryStatus(declaredStatus: string, plans: Array<{ phase: string }>): string {
  if (plans.length === 0) return declaredStatus || 'draft';

  const phases = plans.map((p) => p.phase.toLowerCase());
  const allReleased = phases.every((p) => p === 'released');
  const allDelivered = phases.every((p) => p === 'released' || p === 'delivered');
  const hasApproved = phases.some((p) => p === 'approved');

  if (allReleased) return 'archived';
  if (allDelivered) return 'done';
  if (hasApproved) return 'active';
  return declaredStatus || 'draft';
}

/**
 * Compute status drift: when a story's manual `status:` field conflicts with
 * the derived status from plan phases. Returns a warning message, or null if no drift.
 */
function computeStatusDrift(declaredStatus: string, derivedStatus: string): string | null {
  if (!declaredStatus) return null;
  if (declaredStatus === derivedStatus) return null;

  // Only warn when the declared status is behind the derived status
  const statusOrder = ['draft', 'active', 'done', 'archived'];
  const declaredIdx = statusOrder.indexOf(declaredStatus);
  const derivedIdx = statusOrder.indexOf(derivedStatus);

  if (derivedIdx > declaredIdx) {
    const messages: Record<string, string> = {
      archived: 'All plans released',
      done: 'All plans delivered',
      active: 'Has approved plans',
    };
    return messages[derivedStatus] || null;
  }

  return null;
}

/**
 * Discover stories under docs/stories/<slug>/STORY-<slug>.md. The glob depth
 * (one directory down) naturally excludes docs/stories/archived/<slug>/…, so
 * archived stories never populate the filter list.
 *
 * Also computes plan counts and status drift by querying the provided plans.
 */
function collectStories(repoRoot: string, storyDir: string, allPlans: PlanMeta[]): StoryCard[] {
  const root = path.join(repoRoot, storyDir);
  if (!fs.existsSync(root)) return [];
  const stories: StoryCard[] = [];

  // Build a map of story slug -> plans for efficient lookup
  const plansByStory = new Map<string, PlanMeta[]>();
  for (const plan of allPlans) {
    if (plan.story) {
      const existing = plansByStory.get(plan.story) || [];
      existing.push(plan);
      plansByStory.set(plan.story, existing);
    }
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'archived') continue;
    const dir = path.join(root, entry.name);
    let storyFile: string | undefined;
    try {
      storyFile = fs.readdirSync(dir).find((f) => /^STORY-.*\.md$/.test(f));
    } catch {
      continue;
    }
    if (!storyFile) continue;
    const m = storyFile.match(/^STORY-(.+)\.md$/);
    const slug = m ? m[1] : entry.name;
    const abs = path.join(dir, storyFile);
    // Repo-relative, computed once here rather than reassembled by whoever
    // needs it. Same rule as `planFile` on a fleet row: stripping and rebuilding
    // a path is where the mistakes live, so the consumer is handed the answer.
    const input = parseStoryFile(abs, slug, path.relative(repoRoot, abs), dir);
    if (!input) continue;

    // Get plans for this story and compute counts
    const storyPlans = plansByStory.get(slug) || [];
    const planCount = storyPlans.length;
    const deliveredCount = storyPlans.filter(
      (p) => p.phase === 'released' || p.phase === 'delivered'
    ).length;

    // Build plan references for the card
    const plans = storyPlans.map((p) => ({
      slug: planSlug(p.file),
      title: p.title,
      phase: p.phase,
      sprint: p.sprint,
    }));

    // Compute sprints with plan counts
    const sprintCounts = new Map<string, number>();
    for (const p of storyPlans) {
      if (p.sprint) {
        sprintCounts.set(p.sprint, (sprintCounts.get(p.sprint) || 0) + 1);
      }
    }
    const sprints = Array.from(sprintCounts.entries()).map(([sprintSlug, count]) => ({
      slug: sprintSlug,
      planCount: count,
    }));

    // Derive status from plans and compute drift from declared status
    const derivedStatus = deriveStoryStatus(input.status, storyPlans);
    const statusDrift = computeStatusDrift(input.status, derivedStatus);

    // Merge computed fields into input, using derived status
    const fullInput: StoryCardInput = {
      ...input,
      status: derivedStatus,
      planCount,
      deliveredCount,
      plans,
      sprints,
      statusDrift,
    };

    // Parse through Zod to apply defaults and validate
    const parsed = StoryCardSchema.safeParse(fullInput);
    if (parsed.success) stories.push(parsed.data);
  }
  return stories;
}

/**
 * Resolve a story SLUG to its absolute file, restricted to the stories the
 * board itself collects.
 *
 * The slug is a directory name AND a filename component (`<dir>/STORY-<slug>.md`),
 * so it is checked against the collected stories rather than joined into a path
 * — the same structural defence `resolvePlanFile` uses, and for the sharper
 * reason: two path positions means two places a `../` could land.
 */
function resolveStoryFile(opts: BuildBoardOptions, slug: string): string | null {
  if (!slug) return null;
  const repoRoot = resolvedRepoRoot(opts);
  const storyDir = readConfig(opts, 'Story directory', 'docs/stories/');
  // Pass empty plans array - resolveStoryFile only needs the path, not plan counts
  for (const story of collectStories(repoRoot, storyDir, [])) {
    // `story.slug` came from a real STORY-*.md filename the board walked; a
    // request naming anything else — traversal, an archived story, a typo —
    // matches nothing and 404s.
    if (story.slug === slug) return path.join(repoRoot, story.path);
  }
  return null;
}

/**
 * Build the board JSON: plans (via the plan-format helper) grouped into the
 * four phase columns, plus discovered sprints and stories for the filters.
 * Plans whose phase is not a board phase (rejected / superseded / legacy) are
 * omitted, matching the previous walker.
 */
export function buildBoard(opts: BuildBoardOptions): Board {
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const sprintDir = readConfig(opts, 'Sprint directory', 'docs/sprints/');
  const storyDir = readConfig(opts, 'Story directory', 'docs/stories/');

  const repoRoot = resolvedRepoRoot(opts);
  const defaultBranch = defaultBranchOf(opts, repoRoot);
  // THE PLAN ESTATE COMES FROM THE REF, and the working tree may only add to
  // it. See `collectPlanSources` for the one-directional rule and why the
  // direction is the whole fix.
  const { sources: planSources, report: planSource } = collectPlanSources(
    repoRoot, planDir, `origin/${defaultBranch}`,
  );
  // Which plans the ref did not have — carried by repo-relative path, the one
  // identity that survives staging, so the card can be marked after parsing.
  const localOnlyPaths = new Set(
    planSources.filter((src) => src.local).map((src) => src.path),
  );

  // Plans under review are not in the working tree at all: a plan PR keeps its
  // file on its own branch until it merges, so of every plan file on the
  // default branch, none is in phase Draft. Reading only the filesystem is
  // therefore not merely incomplete — it makes Draft unreachable, which is why
  // the Discovery column could never fill.
  //
  // The staging directory is created per build and removed in the `finally`
  // below: the parser needs real paths, and nothing outside this function may
  // ever see one.
  const prefixes = readConfig(opts, 'Branch prefixes', '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  let stageDir: string | null = null;
  // The canonical path per staged file, so the card can be given its identity
  // back after parsing. `meta.file` would otherwise be the staging path, and
  // PlanCard renders `card.path` verbatim.
  const canonicalPath = new Map<string, string>();
  // Everything the parser will be handed, as real paths. ONE list, because
  // `plot-plan-meta.sh` is spawned ONCE over all of it — a ~55 ms spawn per
  // plan would be ~8 s on this estate and would undo the batch read entirely.
  const files: string[] = [];
  // Ref-read plans have bytes but no file, so each is staged; working-tree
  // plans already are files and are parsed where they lie.
  for (const src of planSources) {
    if (src.content === undefined) {
      if (src.file) files.push(src.file);
      continue;
    }
    if (stageDir === null) {
      stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-plans-'));
    }
    // Written under a numbered subdirectory rather than as a renamed file, so
    // the BASENAME survives intact — `planSlug` cuts the slug out of it, and a
    // mangled name would be a second thing to undo. The canonical path is
    // restored after parsing either way.
    const dir = path.join(stageDir, String(canonicalPath.size));
    const file = path.join(dir, path.basename(src.path));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, src.content, 'utf8');
    canonicalPath.set(file, src.path);
    files.push(file);
  }
  // Plans under review are not on the default branch at all: a plan PR keeps
  // its file on its own branch until it merges, so of every plan the ref above
  // carries, none is in phase Draft. Reading the default branch alone is
  // therefore not merely incomplete — it makes Draft unreachable, which is why
  // the Discovery column could never fill.
  const staged: string[] = [];
  try {
    if (prefixes.length > 0) {
      const branchPlans = collectBranchPlans(repoRoot, planDir, prefixes, defaultBranch);
      if (branchPlans.length > 0) {
        if (stageDir === null) {
          stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-plans-'));
        }
        for (const plan of branchPlans) {
          // Numbered off the same counter as the ref plans above, so the two
          // staged populations cannot collide on a shared basename.
          const dir = path.join(stageDir, String(canonicalPath.size));
          const file = path.join(dir, path.basename(plan.path));
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, plan.content, 'utf8');
          canonicalPath.set(file, plan.path);
          staged.push(file);
        }
      }
    }
  } catch {
    // A repo with no git, no origin, or no readable refs simply contributes no
    // branch plans. Additive and silent when empty — the common case for an
    // adopting project, and it must behave exactly as before.
  }
  // Links come from the host adapter's own `url`, read out of the fleet's PR
  // cache — the board holds no rule for turning a number into an address. null
  // until the first fetch lands, which costs a card its link and never a wrong
  // one.
  const prLinks = prsByNumber(opts);
  // Claims live in git refs, so the card's occupancy counts are read from the
  // same cached pulse the Agents tab classifies from — one source, so a card
  // and a row can no longer disagree about whether work is in flight. null on a
  // cold cache, and the counts are then omitted rather than zeroed.
  const pulse = pulseFor(opts);
  // Beside the pulse, never inside it: a partial pulse holds only the plans that
  // arrived before the scan was cut short, and nothing in its shape says so. A
  // card must not read a plan's absence from an unfinished read as its work
  // being unfinished.
  const pulseComplete = pulseCompleteFor(opts);
  const cards: Card[] = [];
  let metas: PlanMeta[];
  try {
    metas = readPlanMeta(opts.scriptsDir, [...files, ...staged]);
  } finally {
    // The staged copies exist only for the duration of that one parse. Removed
    // in a `finally` so a parser failure cannot leave temp directories behind
    // on a path the server walks every few seconds.
    if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
  }
  for (const meta of metas) {
    // A plan's identity is its canonical path, never wherever it was staged for
    // parsing. Restored here, BEFORE anything is derived from it, so the slug
    // and `card.path` are the same strings a working-tree plan would produce —
    // otherwise a Discovery card would render `/var/folders/…/probe.md`, which
    // fails silently and merely looks untidy.
    const canonical = canonicalPath.get(meta.file);
    const relPath = canonical ?? path.relative(repoRoot, meta.file);
    // `started` no longer moves the phase — an approved plan is Development with
    // or without a Started: record — but toBoardPhase keeps the parameter so the
    // board and rowPhase compose the one mapping, and passing the real value
    // keeps this call honest rather than hard-coding a flag the answer ignores.
    const started = meta.started_raw.length > 0;
    const mapped = toBoardPhase(meta.phase, started);
    if (!mapped) continue;
    // An approved plan whose every non-deferred branch has merged reaches the
    // phase after Development on its own — the code has landed and git can prove
    // it, so the column need not wait for a person to remember `/plot-deliver`.
    // This computes the CARD's column and nothing else: no phase is flipped in
    // the plan file, no `Delivered:` record is written, no PR is merged. Reaching
    // the column asserts the work landed; delivering stays a decision a person
    // makes from here (`docs/board-domain-model.md`). Guarded on `mapped` rather
    // than `meta.phase` so a plan the mapper already advanced past Development —
    // `delivered`, `released` — is left exactly where it was, untouched.
    // The plan's MEASURED status, computed ONCE and read three ways below: the
    // card's `status` field, its `deliverable` bit, and the auto-bump into
    // Testing. `deliverable` is now DERIVED from `status` rather than computed
    // beside it — `status === 'deliverable'` is the one word the plan settled
    // the Deliver button's rule on, so the affordance, the column bump and the
    // reported status cannot disagree by construction. `planStatus` reports
    // `deliverable` exactly when the plan is approved and every non-deferred
    // branch has merged, which is the same condition the old inline boolean
    // tested — with the `mapped === 'Development'` guard folded into its own
    // phase switch (`released`/`delivered` return before the merge test).
    const status = planStatus(meta, pulse, pulseComplete);
    const deliverable = status === 'deliverable';
    const phase = deliverable ? toBoardPhase('delivered')! : mapped;
    if (!phase) continue;
    const slug = planSlug(relPath);
    const card: Card = {
      slug,
      title: meta.title || slug,
      type: meta.type || 'unknown',
      phase,
      path: relPath,
      prs: meta.prs.map((number): CardPr => ({
        number,
        url: prLinks?.get(number)?.url ?? '',
      })),
      // Read from the record this card's OWN column measures recency by. Always
      // present (possibly "") rather than conditionally attached like the fields
      // below: "" is a real answer here — this plan records no date for its
      // phase — and a truncating column must be able to tell that apart from a
      // card built by a server too old to have looked.
      phaseDate: phaseDateOf(phase, meta),
    };
    if (meta.sprint) card.sprint = meta.sprint;
    if (meta.story) card.story = meta.story;
    if (meta.assignee) card.assignee = meta.assignee;
    // `!== undefined` rather than a truthiness test, deliberately: a recorded
    // `round: 0` is a real answer (the block exists, no round has completed) and
    // must survive to the client as 0. Only the parser's OWN silence — no block,
    // or an unreadable one — leaves the field off the card.
    if (meta.rounds !== undefined) card.rounds = meta.rounds;
    // Kept for the tile's Ready/In-progress badge; the column now says the same
    // thing, but a Development card still benefits from the explicit flag. Gated
    // on the card's OWN phase, not the plan's: an approved plan whose waves have
    // all merged has been bumped out of Development, and the Ready/In-progress
    // badge is a Development affordance that must not ride along into Testing.
    //
    // SETTLED 2026-08-26 (the-board-reads-approval-not-phase): the phase gate
    // is KEPT, not moved onto `started_raw`. The two conditions — `phase ===
    // 'Development'` here and `started` (`started_raw.length > 0`) above — agree
    // on every plan today and diverge in exactly one case: a plan bumped out of
    // Development that still carries `Started:` records (all its waves merged, so
    // its card sits in Testing as `deliverable`). There, `started` is true but
    // the phase is not Development, and the gate is RIGHT to withhold the badge:
    // Ready/In-progress answers *can an agent pick this up*, and a plan whose
    // work has all landed is past that question. Gating on `started_raw` would
    // ride the Development affordance into Testing — the very thing this comment
    // forbids. The phase is the correct gate; the record is not.
    if (phase === 'Development') card.started = started;
    // Computed for every plan that HAS waves, single-wave ones included. The
    // old `> 1` guard was right about "2 waves · 3 branches" being noise on a
    // one-wave plan and wrong about the rest: whether anyone is working on a
    // single-wave plan's one branch is the same question, and this repo's plans
    // are mostly single-wave. What the tile renders stays a display decision.
    if (meta.waves.length > 0) card.waveSummary = summariseFromPulse(meta, pulse);
    // Only where this machine actually has one. An empty array and "no
    // worktrees here" are the same statement, so the field is simply absent
    // rather than present-and-empty — the modal then renders nothing, which is
    // the right answer everywhere the path would not exist.
    const worktrees = worktreesFromPulse(meta, pulse);
    if (worktrees.length > 0) card.worktrees = worktrees;
    // Whether the DISPATCHER left a log for this plan — one `stat`, so the row's
    // menu can offer a `Status` entry that reads it on demand. Attached only when
    // true, like the fields above: absent and false are the same statement (*no
    // dispatcher has run this plan*), and the client leaves the entry off either
    // way. The log's contents never ride the pulse — see `dispatchLogExists`.
    if (dispatchLogExists(repoRoot, slug)) card.hasDispatchLog = true;
    // The plan's MEASURED status — always attached, because every card that
    // reaches the board has one of the seven (a plan the mapper drops never
    // becomes a card). Unlike `deliverable` below, absent is NOT a meaningful
    // value here: a card with no status is one an older server built, and the
    // client falls back to reading `phase` and `deliverable` as it did before
    // the field. It is derived from the SAME `planStatus` call the `deliverable`
    // bit and the column bump read, so all three agree by construction.
    card.status = status;
    // The affordance the Deliver control reads. Attached only when true, like
    // the fields above: absent and false are the same statement (*this plan is
    // not deliverable*), and the client leaves the control off either way. It is
    // `status === 'deliverable'`, so a card in Testing that is not marked here is
    // a plan already delivered — its decision made — and must offer nothing.
    if (deliverable) card.deliverable = true;
    // A plan the REF DID NOT HAVE — written here but not yet pushed, so what
    // this card reports is true of one machine and of nowhere else.
    //
    // Attached only when true, like the fields above: absent and false are the
    // same statement, and the overwhelmingly common card is one the ref carries.
    // In the board's own dedicated checkout this fires for NOTHING (measured
    // 2026-08-27: zero local-only plans there, because nobody authors in it),
    // and that silence is the intended reading rather than evidence the feature
    // is dead — it exists for an AUTHORING checkout, where `pnpm board` is also
    // legitimately run and where five plans were each invisible for the minutes
    // between being written and being pushed.
    if (localOnlyPaths.has(relPath)) card.notPushed = true;
    cards.push(card);
  }

  const columns: Column[] = BOARD_PHASES.map((phase) => ({
    phase,
    cards: cards.filter((c) => c.phase === phase),
  }));

  const stories = collectStories(repoRoot, storyDir, metas);

  return {
    generatedAt: new Date().toISOString(),
    columns,
    // WHERE THE PLANS ABOVE CAME FROM. Reported on every board, not only a
    // broken one: "these came from origin/main" is a fact a reader needs stated
    // rather than inferred from the absence of a warning, and its absence is
    // exactly what made a wrong badge and a refusing Deliver button mysteries
    // rather than diagnoses on 2026-08-27.
    planSource,
    // Unavailable until the server says otherwise: this walker reads plans and
    // knows nothing about the socket the board is bound to, and "can I start
    // work" is a question about that socket. index.ts overwrites it at response
    // time, where the binding is known.
    dispatch: { available: false, reason: '' },
    // Empty for the same reason and by the same hand: the port is known only
    // inside `listen()`, so index.ts overwrites this at response time. An empty
    // command renders no restart hint rather than a guessed one.
    server: { restartCommand: '', port: 0, branch: '', repo: '' },
    // Same rule, same reason: whether the board may approve depends on the
    // socket AND on a config key, and this walker reads plans. index.ts
    // overwrites it where both are known.
    approve: { available: false, reason: '' },
    // And again for continuing an answered agent — the same socket question,
    // the same hand overwriting it. Unavailable here means *this walker cannot
    // say*, never *the answer is no*.
    continue: { available: false, reason: '' },
    // And once more for turning an issue into a plan. Same socket question,
    // same hand overwriting it in index.ts. Unavailable here means *this walker
    // cannot say*, never *the answer is no* — the distinction the other three
    // record, and the one that keeps a default from becoming a claim.
    idea: { available: false, reason: '' },
    // And once more for commissioning design — the same socket question, the
    // same hand overwriting it in index.ts. Unavailable here means *this walker
    // cannot say*, never *the answer is no*, exactly as the four above.
    commission: { available: false, reason: '' },
    // And once more for reslicing a tangled wave — the same socket question,
    // the same hand overwriting it in index.ts. Unavailable here means *this
    // walker cannot say*, never *the answer is no*, exactly as the five above.
    reslice: { available: false, reason: '' },
    // And once more for delivering a fully-merged plan — the same socket
    // question, the same hand overwriting it in index.ts. Unavailable here means
    // *this walker cannot say*, never *the answer is no*, exactly as the six
    // above. Whether a given plan is deliverable rides on each card's own
    // `deliverable` bit, which this walker DOES know and sets above.
    deliver: { available: false, reason: '' },
    // And once more for implementing an approved plan — the same socket question,
    // the same hand overwriting it in index.ts. Unavailable here means *this
    // walker cannot say*, never *the answer is no*, exactly as the seven above.
    // Whether a given plan has eligible work rides on each card's own
    // `waveSummary`, which the fleet fills in, not this walker.
    implement: { available: false, reason: '' },
    // And once more for dropping a broken agent's manifest — the ninth write
    // route, and the same socket question: who can reach localhost can remove a
    // file from this disk. Unavailable here means *this walker cannot say*,
    // never *the answer is no*, exactly as the eight above. Whether a given
    // agent can be dropped rides on its state, which the endpoint checks.
    drop: { available: false, reason: '' },
    // And once more for turning a ticket into a story — the tenth write route,
    // and the same socket question it has asked nine times. Unavailable here
    // means *this walker cannot say*, never *the answer is no*, exactly as the
    // nine above. Whether the repo configured `Story command`, and whether it
    // declares one story home or several, rides on the endpoint, which reads
    // both keys and refuses by naming the one that is missing or ambiguous.
    story: { available: false, reason: '' },
    checklist: readChecklist(repoRoot, readConfig(opts, 'Release directory', 'docs/releases/')),
    // The plan slugs the board actually found, so a sprint member naming a
    // renamed or deleted plan is flagged rather than silently dropped. `slug` on
    // a card is `planSlug(relPath)` — the same date-stripped basename a sprint's
    // `[slug]` carries, so the two join directly.
    sprints: collectSprints(
      repoRoot, sprintDir, new Set(cards.map((c) => c.slug)), `origin/${defaultBranch}`,
    ),
    stories,
    // Semantic topics extracted from story and plan titles using TF-IDF
    topics: extractTopics(stories.map((s) => ({
      slug: s.slug,
      title: s.title || s.slug.replace(/-/g, ' '),
      planTitles: (s.plans || []).map((p) => p.title || p.slug.replace(/-/g, ' ')),
    }))),
  };
}

/**
 * Every plan's MEASURED status, keyed by slug — the join the fleet's per-sprint
 * counts read. It calls {@link planStatus}, the ONE function that answers *is
 * this plan done?*; it does not re-derive that answer. This plan is the field's
 * first consumer, and a second computation of the same thing here is precisely
 * the "fifth definition of done" `a-plan-has-a-phase-and-a-status` exists to
 * prevent.
 *
 * WORKING-TREE PLANS ONLY, and that is exactly right for these counts rather
 * than a shortcut. The four the fleet tallies — `delivered`, `deliverable`,
 * `in-progress`, `approved` — are all post-approval statuses, and an approved
 * plan lives in the working tree (its plan PR merged). A plan that lives only on
 * a prefixed branch is under review, so its status is `draft` or `open`, which
 * no count here holds. Reading branch plans would stage git trees on the render
 * clock to produce statuses no consumer of this map counts.
 *
 * The pulse supplies merge and claim state; `planStatus` composes it with each
 * plan's phase, review channel and `Started:` count. A null pulse yields the
 * plan-only answer — `deliverable` collapses to `in-progress`/`approved`, since
 * nothing can say a wave merged — exactly as `planStatus` specifies.
 */
export function planStatusBySlug(
  opts: BuildBoardOptions,
  pulse: FleetPulse | null,
  complete: boolean,
): Map<string, PlanStatus> {
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const repoRoot = resolvedRepoRoot(opts);
  // THE SAME ESTATE THE CARDS COME FROM, read the same way. This map is what
  // the Deliver control's gate consults, and it reading a checkout while the
  // cards read a ref is how one row came to hold two answers of different ages
  // — the defect, in the one place whose wrongness is a refused button rather
  // than a stale label.
  const { sources } = collectPlanSources(
    repoRoot, planDir, `origin/${defaultBranchOf(opts, repoRoot)}`,
  );
  const bySlug = new Map<string, PlanStatus>();
  // Ref-read plans have no file, so the parse needs a scratch copy — the same
  // staging `buildBoard` does, and removed in the same `finally` for the same
  // reason. `slug` is cut from the CANONICAL path, never the staged one.
  let stageDir: string | null = null;
  const canonicalPath = new Map<string, string>();
  const files: string[] = [];
  try {
    for (const src of sources) {
      if (src.content === undefined) {
        if (src.file) files.push(src.file);
        continue;
      }
      if (stageDir === null) {
        stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-status-'));
      }
      const dir = path.join(stageDir, String(canonicalPath.size));
      const file = path.join(dir, path.basename(src.path));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, src.content, 'utf8');
      canonicalPath.set(file, src.path);
      files.push(file);
    }
    for (const meta of readPlanMeta(opts.scriptsDir, files)) {
      const canonical = canonicalPath.get(meta.file);
      const relPath = canonical ?? path.relative(repoRoot, meta.file);
      bySlug.set(planSlug(relPath), planStatus(meta, pulse, complete));
    }
  } finally {
    if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
  }
  return bySlug;
}

// ─── Plan viewer: render a single plan file to HTML ──────────────────────────

/** Strip a leading YAML front-matter block so it isn't rendered as markdown. */
function stripFrontMatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

/** Escape text interpolated into the page shell (the `<title>`). */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/**
 * Resolve a plan file *basename* to its absolute path, restricted to the plans
 * that actually exist under the configured plan dir — so a request can never
 * name a file outside it. Path traversal is blocked structurally, not by string
 * sanitizing; the leading basename check just rejects any separators up front.
 * Returns null for anything not in the allowlist (→ 404).
 *
 * DELIBERATELY STILL A FILESYSTEM QUESTION, though the board now reads its
 * cards from a ref. This resolves a path something will `readFileSync`, and a
 * ref blob has no path to return — a plan that exists only on the ref is served
 * by `readPlanMarkdown`'s git branch instead, which already reads content
 * rather than resolving a file. Widening this to ref paths would hand a
 * non-existent path to an opener; the two questions stay apart.
 */
function resolvePlanFile(opts: BuildBoardOptions, filename: string): string | null {
  if (!filename || filename !== path.basename(filename) || !filename.endsWith('.md')) return null;
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const repoRoot = resolvedRepoRoot(opts);
  for (const entry of workingTreePlans(repoRoot, planDir).values()) {
    // Match against any entry name (symlink names or real basename)
    if (entry.entryNames.has(filename)) return entry.absPath;
  }
  return null;
}

/**
 * The markdown behind a plan name, from EITHER source the board draws cards
 * from — the working tree, or a plan that lives only on a prefixed branch.
 *
 * The second half is why this exists. Cards gained a branch source, so the
 * board renders Discovery cards for plans under PR review; `/plan/<file>` kept
 * resolving against the working tree alone and answered 404 for exactly those
 * cards. One consumer, two sources, and it saw half of them: opening a
 * Discovery plan failed with "Failed to load plan: HTTP 404" while its card sat
 * on screen.
 *
 * Branch plans are read from git rather than staged to disk, because the
 * content is already in hand — `collectBranchPlans` carries it — and a request
 * path has no business creating temp files.
 */
function readPlanMarkdown(opts: BuildBoardOptions, filename: string): string | null {
  const file = resolvePlanFile(opts, filename);
  if (file) return fs.readFileSync(file, 'utf8');

  if (!filename || filename !== path.basename(filename) || !filename.endsWith('.md')) return null;
  const repoRoot = resolvedRepoRoot(opts);
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  // A plan the REF has and this checkout does not. Cards are read from the ref
  // now, so a stale checkout renders cards for plans whose files it has never
  // seen — and without this branch every one of them would 404 on click, which
  // is the same "two sources of different ages" defect wearing a 404.
  //
  // The basename is matched against paths the tree listing produced, so a
  // request still cannot name anything outside the plan dir: the allowlist is
  // the ref's own contents, exactly as the working-tree arm's is the disk's.
  const fromRef = readPlansFromRef(
    repoRoot, `origin/${defaultBranchOf(opts, repoRoot)}`, planDir,
  );
  for (const [relPath, content] of fromRef) {
    if (path.basename(relPath) === filename) return content;
  }
  const prefixes = readConfig(opts, 'Branch prefixes', '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (prefixes.length === 0) return null;
  for (const plan of collectBranchPlans(repoRoot, planDir, prefixes, defaultBranchOf(opts, repoRoot))) {
    if (path.basename(plan.path) === filename) return plan.content;
  }
  return null;
}

/** Minimal, theme-aware page CSS — readable plan prose, no external assets. */
const PLAN_PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1e293b; background: #ffffff;
  }
  .plan-titlebar {
    position: sticky; top: 0; z-index: 1;
    padding: 0.7rem 1rem; border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }
  .plan-back { color: #2563eb; text-decoration: none; font-weight: 500; font-size: 0.9rem; }
  .plan-back:hover { text-decoration: underline; }
  main { max-width: 52rem; margin: 0 auto; padding: 2rem 1rem; }
  h1, h2, h3 { line-height: 1.25; margin: 1.6em 0 0.5em; }
  h1 { font-size: 1.7rem; } h2 { font-size: 1.3rem; } h3 { font-size: 1.1rem; }
  a { color: #2563eb; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em;
    background: #f1f5f9; padding: 0.1em 0.35em; border-radius: 4px; }
  pre { background: #f1f5f9; padding: 0.9rem 1rem; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding-left: 1rem; border-left: 3px solid #cbd5e1; color: #475569; }
  table { border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 0.4rem 0.7rem; }
  img { max-width: 100%; }
  @media (prefers-color-scheme: dark) {
    body { color: #e2e8f0; background: #0f172a; }
    a, .plan-back { color: #60a5fa; }
    code, pre { background: #1e293b; }
    blockquote { border-left-color: #475569; color: #94a3b8; }
    th, td { border-color: #334155; }
    .plan-titlebar { border-bottom-color: #1e293b; background: #0b1220; }
  }
`;

export interface RenderPlanOptions {
  /**
   * When true, omit the "back to board" titlebar. The in-board modal injects
   * `?embed=1` so its embedded view is chrome-free; the standalone new-tab /
   * direct-URL view (no param) keeps the titlebar for navigation.
   */
  embed?: boolean;
}

/**
 * Markdown → the standalone, theme-aware page both viewer routes serve.
 *
 * Shared for the same reason the request handler is: the two documents differ
 * in where their markdown comes from and in nothing else, and a second copy of
 * the shell is a second place for the front-matter strip or the titlebar to
 * drift. `fallbackTitle` is used only when the document has no `# ` heading.
 */
/**
 * Transform relative plan/story links to absolute board routes.
 *
 * Story files contain links like `[plan](../../plans/2026-08-16-slug.md)` —
 * these break when rendered at `/story/...` because:
 * 1. The relative path doesn't resolve correctly in the browser
 * 2. The filename may include a date prefix that doesn't match the actual file
 *
 * This extracts the slug from the filename and rewrites to `/plan/<slug>.md`.
 */
function rewritePlanLinks(href: string): string {
  // Match relative paths to plans (with optional date prefix in filename)
  const planMatch = href.match(/(?:\.\.\/)*plans\/(?:\d{4}-\d{2}-\d{2}-)?([^/]+\.md)$/);
  if (planMatch) {
    return `/plan/${planMatch[1]}`;
  }
  // Match relative paths to stories
  const storyMatch = href.match(/(?:\.\.\/)*stories\/([^/]+)\/STORY-[^/]+\.md$/);
  if (storyMatch) {
    return `/story/${storyMatch[1]}`;
  }
  return href;
}

function renderMarkdownPage(md: string, fallbackTitle: string, embed: boolean): string {
  let body = marked.parse(stripFrontMatter(md), { async: false }) as string;
  // Post-process HTML to rewrite relative plan/story links to absolute routes
  body = body.replace(/href="([^"]+)"/g, (match, href) => {
    const rewritten = rewritePlanLinks(href);
    return rewritten !== href ? `href="${rewritten}"` : match;
  });
  const heading = md.match(/^#\s+(.+)$/m);
  const title = heading ? heading[1].trim() : fallbackTitle;
  const titlebar = embed
    ? ''
    : '<header class="plan-titlebar"><a class="plan-back" href="/">← Board</a></header>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PLAN_PAGE_STYLE}</style>
</head>
<body>${titlebar}<main>${body}</main></body>
</html>`;
}

/**
 * Render a plan file to a standalone, theme-aware HTML page — or null if the
 * name doesn't resolve to a board plan (→ 404). One response serves both the
 * new-tab route (with a back-to-board titlebar) and the modal's fetched srcdoc
 * (embed=1, no titlebar).
 */
export function renderPlanPage(
  opts: BuildBoardOptions,
  filename: string,
  { embed = false }: RenderPlanOptions = {},
): string | null {
  const md = readPlanMarkdown(opts, filename);
  if (md === null) return null;
  return renderMarkdownPage(md, filename, embed);
}

/**
 * Render a story's STORY-<slug>.md the way `renderPlanPage` renders a plan — or
 * null if the slug names no collected story (→ 404).
 *
 * Only the working tree, deliberately: a story is a long-lived umbrella that
 * lives on the default branch, unlike a Draft plan whose file exists only on
 * its review branch. There is no branch fallback to write, because there is no
 * equivalent state to miss.
 */
export function renderStoryPage(
  opts: BuildBoardOptions,
  slug: string,
  { embed = false }: RenderPlanOptions = {},
): string | null {
  const file = resolveStoryFile(opts, slug);
  if (!file) return null;
  let md: string;
  try {
    md = fs.readFileSync(file, 'utf8');
  } catch {
    // The allowlist named it a moment ago; if it is gone now, that is a 404
    // rather than a 500 — the answer a reader can act on.
    return null;
  }
  return renderMarkdownPage(md, slug, embed);
}

/**
 * Render a design doc (DESIGN-*.md) from a story directory — or null if not
 * found (→ 404).
 *
 * The path format is `<story-slug>/<design-doc-name>`, e.g.
 * `the-master-agent-holds-the-fleet/DESIGN-entities.md`.
 *
 * Security: only files matching DESIGN-*.md in collected story directories are
 * served — no traversal, no arbitrary files.
 */
export function renderDesignDocPage(
  opts: BuildBoardOptions,
  docPath: string,
  { embed = false }: RenderPlanOptions = {},
): string | null {
  // Parse the path: <story-slug>/<design-doc-name>
  const parts = docPath.split('/');
  if (parts.length !== 2) return null;
  const [storySlug, docName] = parts;

  // Validate docName matches DESIGN-*.md pattern
  if (!docName || !/^DESIGN-[\w-]+\.md$/.test(docName)) return null;

  // Resolve the story directory
  const storyDir = readConfig(opts, 'Story directory', 'docs/stories/');
  const repoRoot = resolvedRepoRoot(opts);
  const storyPath = path.join(repoRoot, storyDir, storySlug);

  // Check the story directory exists (validates storySlug against allowlist)
  if (!fs.existsSync(storyPath) || !fs.statSync(storyPath).isDirectory()) {
    return null;
  }

  // Read the design doc
  const docFile = path.join(storyPath, docName);
  let md: string;
  try {
    md = fs.readFileSync(docFile, 'utf8');
  } catch {
    return null;
  }

  return renderMarkdownPage(md, docName, embed);
}
