import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { marked } from 'marked';
import {
  PlanMetaSchema,
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
  type FleetPulse,
  type PlanMeta,
  type WaveSummary } from '../contract/schema.js';
import { dispatchLogExists } from './dispatch.js';
import { prsByNumber, pulseFor } from './fleet.js';

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
 * Collect plan files, de-duplicated by real path. Walk order (active/ →
 * delivered/ → the plans root) mirrors the previous walker so a plan symlinked
 * from active/ is counted once, under its canonical docs/plans/ path.
 */
function collectPlanFiles(repoRoot: string, planDir: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  const root = path.join(repoRoot, planDir);
  const dirs = [path.join(root, 'active'), path.join(root, 'delivered'), root];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
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
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      files.push(resolved);
    }
  }
  return files;
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
  for (const wave of plan.waves) {
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
 * True when every one of a plan's non-deferred branches has merged — the
 * checkable input that lets a plan reach the phase after Development on its own.
 *
 * *Every wave being complete is a measurement; delivering is a decision*
 * (`docs/board-domain-model.md`). This is that measurement, and only that: it
 * asserts the code has landed, which git already knows, and nothing more. The
 * board never flips a phase to `delivered` from it — see `buildBoard`, which
 * moves the CARD's column and writes no record.
 *
 * Merge state is read from the PULSE, never the plan file: a `merged` branch is
 * one the scan resolved against `origin/<main>`, which is the same derivation
 * `plot-fleet-scan.sh` applies when it prints `merged_not_delivered`. Reusing it
 * rather than rebuilding it is the whole point — the plan file carries no merge
 * record, and inventing one here would answer a different question than the scan.
 *
 * A deferred branch is exempt, matching the scan's own rule: a shelved branch is
 * not outstanding work, so a plan holding six merged and three deferred branches
 * (measured on the Testing plans) is as complete as one holding nine merged.
 *
 * Returns false — the plan stays in Development — in three cases that must not be
 * confused with each other but share one answer here:
 *  - no pulse, or the pulse does not know this plan: git has said nothing, and
 *    "nothing said" is not "all merged". A cold cache keeps a plan where it was.
 *  - any non-deferred branch is not `merged`: one open wave and the work is not
 *    done, which is the negative the plan insists be asserted directly.
 *  - the plan has NO non-deferred branch (all deferred, or none at all): there
 *    is no landed work to testify to, so "every branch merged" is vacuously true
 *    and substantively false. The explicit `merged > 0` guard is what stops the
 *    empty reduction from promoting a plan nobody built.
 */
export function allWavesMerged(meta: PlanMeta, pulse: FleetPulse | null): boolean {
  const plan = pulse?.plans.find((p) => p.file === path.basename(meta.file));
  if (!plan) return false;
  let merged = 0;
  for (const wave of plan.waves) {
    for (const b of wave.branches) {
      if (b.state === 'deferred') continue;
      if (b.state !== 'merged') return false;
      merged += 1;
    }
  }
  return merged > 0;
}

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
  return plan.waves.some((w) => w.branches.some((b) => b.state === 'claimed'));
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
export function planStatus(meta: PlanMeta, pulse: FleetPulse | null): PlanStatus {
  switch (meta.phase) {
    case 'released':
      return 'released';
    case 'delivered':
      return 'delivered';
    case 'approved':
      if (allWavesMerged(meta, pulse)) return 'deliverable';
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
  for (const wave of plan.waves) {
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
  const titleMatch = content.match(/^# Sprint: (.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(absPath, '.md');
  const slugMatch = path.basename(absPath).match(/^\d{4}-W\d{2}-(.+)\.md$/);
  const slug = slugMatch ? slugMatch[1] : path.basename(absPath, '.md');
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
  return { slug, title, phase, release, members: parseSprintMembers(content) };
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
): SprintCard[] {
  const dir = path.join(repoRoot, sprintDir, 'active');
  if (!fs.existsSync(dir)) return [];
  const sprints: SprintCard[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.md')) continue;
    let resolved: string;
    try {
      resolved = fs.realpathSync(path.join(dir, entry));
    } catch {
      continue;
    }
    const sprint = parseSprintFile(resolved);
    if (!sprint) continue;
    if (knownSlugs) {
      sprint.members = sprint.members.map((m) =>
        knownSlugs.has(m.slug) ? m : { ...m, known: false },
      );
    }
    sprints.push(sprint);
  }
  return sprints;
}

/** Story files use story-tracking's YAML front matter (title + status). */
function parseStoryFile(absPath: string, slug: string, relPath: string): StoryCard | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  let title = '';
  let status = '';
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const t = fm[1].match(/^title:\s*(.+)$/m);
    if (t) title = t[1].trim();
    const s = fm[1].match(/^status:\s*(.+)$/m);
    if (s) status = s[1].trim();
  }
  if (!title) {
    const h1 = content.match(/^# (.+)$/m);
    title = h1 ? h1[1].trim() : slug;
  }
  return { slug, title, status, path: relPath };
}

/**
 * Discover stories under docs/stories/<slug>/STORY-<slug>.md. The glob depth
 * (one directory down) naturally excludes docs/stories/archived/<slug>/…, so
 * archived stories never populate the filter list.
 */
function collectStories(repoRoot: string, storyDir: string): StoryCard[] {
  const root = path.join(repoRoot, storyDir);
  if (!fs.existsSync(root)) return [];
  const stories: StoryCard[] = [];
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
    const card = parseStoryFile(abs, slug, path.relative(repoRoot, abs));
    if (card) stories.push(card);
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
  for (const story of collectStories(repoRoot, storyDir)) {
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
  const files = collectPlanFiles(repoRoot, planDir);

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
  const staged: string[] = [];
  try {
    if (prefixes.length > 0) {
      const branchPlans = collectBranchPlans(
        repoRoot, planDir, prefixes, defaultBranchOf(opts, repoRoot),
      );
      if (branchPlans.length > 0) {
        stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-branch-'));
        branchPlans.forEach((plan, i) => {
          // Written under a numbered subdirectory rather than as a renamed
          // file, so the BASENAME survives intact: two branches can carry
          // same-named plans, and a mangled name would be a second thing to
          // undo. The canonical path is restored after parsing either way.
          const dir = path.join(stageDir!, String(i));
          const file = path.join(dir, path.basename(plan.path));
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, plan.content, 'utf8');
          canonicalPath.set(file, plan.path);
          staged.push(file);
        });
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
    const status = planStatus(meta, pulse);
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
    cards.push(card);
  }

  const columns: Column[] = BOARD_PHASES.map((phase) => ({
    phase,
    cards: cards.filter((c) => c.phase === phase),
  }));

  return {
    generatedAt: new Date().toISOString(),
    columns,
    // Unavailable until the server says otherwise: this walker reads plans and
    // knows nothing about the socket the board is bound to, and "can I start
    // work" is a question about that socket. index.ts overwrites it at response
    // time, where the binding is known.
    dispatch: { available: false, reason: '' },
    // Empty for the same reason and by the same hand: the port is known only
    // inside `listen()`, so index.ts overwrites this at response time. An empty
    // command renders no restart hint rather than a guessed one.
    server: { restartCommand: '', port: 0, branch: '' },
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
    checklist: readChecklist(repoRoot, readConfig(opts, 'Release directory', 'docs/releases/')),
    // The plan slugs the board actually found, so a sprint member naming a
    // renamed or deleted plan is flagged rather than silently dropped. `slug` on
    // a card is `planSlug(relPath)` — the same date-stripped basename a sprint's
    // `[slug]` carries, so the two join directly.
    sprints: collectSprints(repoRoot, sprintDir, new Set(cards.map((c) => c.slug))),
    stories: collectStories(repoRoot, storyDir),
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
): Map<string, PlanStatus> {
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const repoRoot = resolvedRepoRoot(opts);
  const files = collectPlanFiles(repoRoot, planDir);
  const bySlug = new Map<string, PlanStatus>();
  for (const meta of readPlanMeta(opts.scriptsDir, files)) {
    bySlug.set(planSlug(path.relative(repoRoot, meta.file)), planStatus(meta, pulse));
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
 * the board itself collects. The candidates come from `collectPlanFiles`, which
 * only walks the configured plan dir — so a request can never name a file
 * outside it. Path traversal is blocked structurally, not by string sanitizing;
 * the leading basename check just rejects any separators up front. Returns null
 * for anything not in the allowlist (→ 404).
 */
function resolvePlanFile(opts: BuildBoardOptions, filename: string): string | null {
  if (!filename || filename !== path.basename(filename) || !filename.endsWith('.md')) return null;
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  for (const file of collectPlanFiles(resolvedRepoRoot(opts), planDir)) {
    if (path.basename(file) === filename) return file;
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
function renderMarkdownPage(md: string, fallbackTitle: string, embed: boolean): string {
  const body = marked.parse(stripFrontMatter(md), { async: false });
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
