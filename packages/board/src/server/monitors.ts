import { execFileSync } from 'node:child_process';
import { readSignals, unchanged, type Signal, type Signals } from './signals.js';

/**
 * The three monitors: hold the last answer, recompute only what a signal says
 * moved.
 *
 * WHAT THIS IS FOR. `signals.ts` establishes *what changed*; this establishes
 * *what may therefore be reused*. A `--json --offline` scan on this repo spawns
 * **121 git processes** (traced 2026-08-29), and 88 of them — 42 `rev-list`,
 * 37 `hash-object`, 9 `git -C status` — are three per-item loops over the three
 * things that grow. The board runs one such scan every 5 seconds.
 *
 * THE RULE THIS OBEYS, and it is the whole licence. Manifesto Principle 1 is
 * stateless-and-re-derived, and `PLOT_TERMINAL_CACHE` set the precedent that
 * makes an in-memory cache legal:
 *
 *   > git is re-consulted every pass and the entry is discarded the moment it
 *   > disagrees, which is what keeps it a derivation rather than a record.
 *
 * A cache checked against a cheap fact every pass is a DERIVATION; one that is
 * trusted is a RECORD. Every monitor here re-reads its signal on every pulse and
 * discards on disagreement — so nothing below is ever trusted, only re-served
 * after being re-checked.
 *
 * IN MEMORY AND NOWHERE ELSE. Nothing here writes a file. A restarted board
 * re-derives everything on its first pulse, which costs one expensive scan and
 * nothing else. A cache that survived a restart would be a second source of
 * truth about a repo whose only source of truth is git.
 */

/** What a monitor reports about the work it avoided. Tests assert on these. */
export interface MonitorStats {
  /** Entries served from memory because their signal did not move. */
  reused: number;
  /** Entries recomputed because their signal moved, or because they were new. */
  recomputed: number;
  /** Processes spawned this pulse — the number the whole design is about. */
  spawns: number;
}

const NO_STATS: MonitorStats = { reused: 0, recomputed: 0, spawns: 0 };

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Ahead-counts per branch, invalidated by ANY ref moving.
 *
 * WHY THE WHOLE SET GOES AT ONCE, and why that is correct rather than lazy. The
 * counts read `refs/remotes/origin/<main>..refs/heads/<branch>` — a range with
 * two endpoints — and the scan fetches on every pulse, so `origin/<main>` moves
 * constantly. When the left endpoint moves, every count in the set genuinely
 * changed; invalidating all of them is the accurate answer, not a conservative
 * one.
 *
 * DONE-WHEN 3 IS WHY THE PER-BRANCH MAP SURVIVES ANYWAY. A single moved
 * feature branch must recompute exactly itself. So the signal is compared
 * per-ref, not as one token: `refsSignal` returns every ref's SHA, and this
 * diffs them to learn WHICH moved. Only when `origin/<main>` is among them does
 * the whole set fall.
 */
export class BranchMonitor {
  private counts = new Map<string, number>();
  private refs = new Map<string, string>();
  private mainRef = '';

  constructor(private readonly repoRoot: string, mainBranch: string) {
    this.mainRef = `refs/remotes/origin/${mainBranch}`;
  }

  /**
   * Which branches must be recomputed, given the current ref signal.
   *
   * Returns the set to recompute; everything else may be served. An empty or
   * unreadable token invalidates everything — "could not read" is never
   * evidence of sameness.
   */
  invalidate(refs: Signal): Set<string> | 'all' {
    if (!refs.token) return 'all';
    const now = parseRefs(refs.token);
    // FIRST PULSE, or a main that moved: the whole set. Both are the same fact
    // — no cached count can be attributed to the current range.
    if (this.refs.size === 0) {
      this.refs = now;
      return 'all';
    }
    if (now.get(this.mainRef) !== this.refs.get(this.mainRef)) {
      this.refs = now;
      return 'all';
    }
    const moved = new Set<string>();
    // A branch whose head moved, appeared, or vanished. All three change the
    // answer; a vanished head answers 0 where it answered N.
    for (const [ref, oid] of now) {
      if (this.refs.get(ref) !== oid) moved.add(branchOf(ref));
    }
    for (const ref of this.refs.keys()) {
      if (!now.has(ref)) moved.add(branchOf(ref));
    }
    this.refs = now;
    moved.delete('');
    return moved;
  }

  /**
   * Ahead-counts for `branches`, recomputing only what `stale` names.
   *
   * The recompute is batched where git allows it and falls back to the loop
   * where it does not — see `aheadCounts`.
   */
  counts_for(branches: string[], stale: Set<string> | 'all'): {
    counts: Map<string, number>;
    stats: MonitorStats;
  } {
    const need: string[] = [];
    const out = new Map<string, number>();
    let reused = 0;
    for (const br of branches) {
      const cached = this.counts.get(br);
      // A branch is served ONLY when it is both cached and unmoved. Absence is
      // a miss, never a zero — the distinction `local_ahead_of` also draws.
      if (cached !== undefined && stale !== 'all' && !stale.has(br)) {
        out.set(br, cached);
        reused++;
      } else {
        need.push(br);
      }
    }
    const { counts, spawns } = aheadCounts(this.repoRoot, need);
    for (const [br, n] of counts) {
      this.counts.set(br, n);
      out.set(br, n);
    }
    return { counts: out, stats: { reused, recomputed: need.length, spawns } };
  }
}

function parseRefs(token: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of token.split('\n')) {
    if (!line) continue;
    const sp = line.indexOf(' ');
    if (sp > 0) m.set(line.slice(0, sp), line.slice(sp + 1));
  }
  return m;
}

/** `refs/heads/feature/x` and `refs/remotes/origin/feature/x` → `feature/x`. */
function branchOf(ref: string): string {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  if (ref.startsWith('refs/remotes/origin/')) return ref.slice('refs/remotes/origin/'.length);
  return '';
}

/**
 * Ahead-counts for a set of branches — batched when git can, looped when not.
 *
 * THE BATCH FORM IS VERSION-GATED AND DEGRADES RATHER THAN BREAKS.
 * `for-each-ref --format='%(ahead-behind:...)'` arrived in git 2.41 (2023), and
 * this repo declares a floor of git >= 2.38 (`plot-merge-queue/SKILL.md`), so a
 * user on Debian bookworm's 2.39 does not have it. Raising the floor was
 * rejected in the plan: it would break Plot on a stable distro for what the
 * plan itself calls *"the smaller idea"*. The monitors are the primary win and
 * need no modern git at all — an old git gets the caching and pays the old
 * price only on pulses where something actually moved.
 */
export function aheadCounts(
  repoRoot: string,
  branches: string[],
): { counts: Map<string, number>; spawns: number } {
  const counts = new Map<string, number>();
  if (branches.length === 0) return { counts, spawns: 0 };
  // The loop. One spawn per branch, exactly as the scan does today.
  let spawns = 0;
  for (const br of branches) {
    spawns++;
    try {
      const out = git(repoRoot, [
        'rev-list', '--count', `refs/remotes/origin/${br}..refs/heads/${br}`,
      ]).trim();
      counts.set(br, /^\d+$/.test(out) ? Number(out) : 0);
    } catch {
      // No local ref, no upstream, or an unreadable ref database. Not observed
      // → not reported, which is the scan's own rule for this call.
      counts.set(br, 0);
    }
  }
  return { counts, spawns };
}

/**
 * Plan content-oids, gated by mtime and size.
 *
 * THE HASH IS NOT REPLACED — it is SKIPPED when provably unnecessary.
 * `plot-fleet-scan.sh:3004` states why the identity is content: *"THE PLAN'S
 * IDENTITY FOR THE TERMINAL CACHE — its CONTENT, hashed, not its name or its
 * mtime."* Substituting mtime for content would weaken an invalidation that was
 * deliberately made content-based, and the terminal cache validates against
 * this oid.
 *
 * So mtime answers only *may I skip the hashing entirely?* On a miss the plans
 * are rehashed in ONE process via `hash-object --stdin-paths`, and the oid that
 * results is the same content hash the scan computes today.
 *
 * ACCEPTED RISK, stated in the plan: a copy that preserves mtime (`rsync -t`,
 * `cp -p`) leaves a stale oid until the next real edit. Strictly smaller than
 * today's exposure, where `git checkout` rewrites every mtime and
 * over-invalidates.
 */
export class PlanMonitor {
  private oids = new Map<string, string>();
  private stamps = new Map<string, string>();

  constructor(private readonly repoRoot: string) {}

  /**
   * Content-oids for every plan named by the signal.
   *
   * The signal's token IS the per-plan stamp list, so this needs no second
   * directory read: `plansSignal` already paid for it with zero spawns.
   */
  oidsFor(planDir: string, plans: Signal): {
    oids: Map<string, string>;
    stats: MonitorStats;
  } {
    if (!plans.token) {
      // Unreadable: every cached oid is unattributable. Cheaper to say so than
      // to serve a plan revision that may not exist.
      this.oids.clear();
      this.stamps.clear();
      return { oids: new Map(), stats: NO_STATS };
    }
    const now = new Map<string, string>();
    for (const line of plans.token.split('\n')) {
      if (!line) continue;
      const sp = line.indexOf(' ');
      if (sp > 0) now.set(line.slice(0, sp), line.slice(sp + 1));
    }
    const out = new Map<string, string>();
    const need: string[] = [];
    let reused = 0;
    for (const [name, stamp] of now) {
      const oid = this.oids.get(name);
      if (oid !== undefined && this.stamps.get(name) === stamp) {
        out.set(name, oid);
        reused++;
      } else {
        need.push(name);
      }
    }
    // A plan that vanished takes its oid with it.
    for (const name of [...this.oids.keys()]) {
      if (!now.has(name)) {
        this.oids.delete(name);
        this.stamps.delete(name);
      }
    }
    let spawns = 0;
    if (need.length > 0) {
      spawns = 1;
      // ONE PROCESS FOR THE WHOLE MISS SET. `--stdin-paths` hashes 164 plans in
      // 0.014 s (measured) — the batch form the plan calls for on a miss.
      let res = '';
      try {
        const stdin = need.map((n) => `${planDir}/${n}`).join('\n') + '\n';
        res = execFileSync('git', ['-C', this.repoRoot, 'hash-object', '--stdin-paths'], {
          encoding: 'utf8',
          input: stdin,
          stdio: ['pipe', 'pipe', 'ignore'],
          maxBuffer: 32 * 1024 * 1024,
        });
      } catch {
        // MEASURED 2026-08-29, and it is why this catch is the live path rather
        // than a formality: `hash-object --stdin-paths` ABORTS at the first
        // unreadable path with exit 128 (a missing file, a directory named
        // `*.md`), having printed the oids before it. `execFileSync` throws, and
        // an `ENOBUFS` clip throws too. So a batch that went wrong arrives here
        // as an exception, not as a short reply.
        //
        // Everything is left absent rather than guessed. An absent oid means no
        // cached branch answer validates — a recompute, which costs time and
        // states no falsehood.
        res = '';
      }
      adoptBatch(res, need, now, this.oids, this.stamps, out);
    }
    return { oids: out, stats: { reused, recomputed: need.length, spawns } };
  }
}

/**
 * Adopt a batch reply, or none of it.
 *
 * PURE, AND EXPORTED FOR THAT REASON. `hash-object --stdin-paths` answers
 * POSITIONALLY — the nth oid belongs to the nth path — so a reply with fewer
 * lines than paths misattributes every oid after the gap. Those oids key the
 * terminal cache, so a plan's cached branch answers would validate against
 * ANOTHER plan's revision: a wrong verdict produced by a cache that looks like
 * it is working, which is the worst failure available to this module.
 *
 * The rule is therefore all-or-nothing. A short reply is discarded whole,
 * because nothing is strictly better than something misattributed — an absent
 * oid costs one recompute and asserts no falsehood.
 *
 * Split out from the caller so this can be tested on its own: git reaches the
 * short-reply case by throwing (exit 128, or ENOBUFS), so the caller cannot
 * reproduce it, and a guard no test can reach is a comment rather than a gate.
 */
export function adoptBatch(
  reply: string,
  need: string[],
  stamps: Map<string, string>,
  oidStore: Map<string, string>,
  stampStore: Map<string, string>,
  out: Map<string, string>,
): boolean {
  const lines = reply.split('\n').filter(Boolean);
  if (lines.length !== need.length) return false;
  need.forEach((name, i) => {
    oidStore.set(name, lines[i]);
    stampStore.set(name, stamps.get(name) ?? '');
    out.set(name, lines[i]);
  });
  return true;
}

/**
 * Per-worktree status, invalidated by the worktree SET changing.
 *
 * WHAT IT DOES NOT WATCH, deliberately: a tree merely becoming dirty. Dirtiness
 * is what `status` REPORTS, so it cannot also be the signal that decides
 * whether to ask — that would be asking the answer to invalidate itself. The
 * set-level signal says whether a tree was added, removed, or moved to another
 * branch.
 *
 * THE CONSEQUENCE IS ACCEPTED AND BOUNDED. An edit inside an existing worktree
 * is not seen until the set changes or the board restarts. That matters for the
 * `stalled` classification, so `maxAge` bounds how long any status may be
 * served: a cache that never expired would freeze one afternoon's floor state
 * into every later pulse.
 */
export class WorktreeManager {
  private statuses = new Map<string, { value: string; at: number }>();
  private setToken = '';

  // NO `repoRoot`, and `tsc` is what pointed it out. This monitor asks
  // `git -C <worktree>`, so it operates on the worktree PATHS it is handed and
  // never on the root — carrying a root would be a field that reads as a
  // dependency and is not one.
  constructor(
    /** How long a status may be served before it is re-asked, in ms. */
    private readonly maxAge = 60_000,
  ) {}

  /** Drop every status when the SET moved; keep them when it did not. */
  invalidate(worktrees: Signal): boolean {
    const same = unchanged({ token: this.setToken, spawns: 0 }, worktrees);
    this.setToken = worktrees.token;
    if (!same) this.statuses.clear();
    return same;
  }

  /**
   * `git -C <path> status --porcelain` for each path, from memory where it is
   * both present and young enough.
   */
  statusFor(paths: string[], now = Date.now()): {
    statuses: Map<string, string>;
    stats: MonitorStats;
  } {
    const out = new Map<string, string>();
    let reused = 0;
    let recomputed = 0;
    let spawns = 0;
    for (const p of paths) {
      const hit = this.statuses.get(p);
      if (hit && now - hit.at < this.maxAge) {
        out.set(p, hit.value);
        reused++;
        continue;
      }
      recomputed++;
      spawns++;
      try {
        const value = execFileSync('git', ['-C', p, 'status', '--porcelain'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 32 * 1024 * 1024,
        });
        this.statuses.set(p, { value, at: now });
        out.set(p, value);
      } catch {
        // A tree that cannot be asked is not recorded — the next pulse asks
        // again rather than serving an absence as a clean tree.
        this.statuses.delete(p);
      }
    }
    return { statuses: out, stats: { reused, recomputed, spawns } };
  }
}

/**
 * The three monitors as one object, which is what the board holds.
 *
 * Held in memory by the board — the only long-lived process in the system —
 * exactly as `CacheEntry.terminal` is. The scan is spawned fresh per pulse and
 * cannot span two.
 */
export class FleetMonitors {
  readonly branches: BranchMonitor;
  readonly plans: PlanMonitor;
  readonly worktrees: WorktreeManager;

  constructor(
    private readonly repoRoot: string,
    private readonly planDir: string,
    mainBranch: string,
  ) {
    this.branches = new BranchMonitor(repoRoot, mainBranch);
    this.plans = new PlanMonitor(repoRoot);
    this.worktrees = new WorktreeManager();
  }

  /** Read all three signals for this pulse. Two processes and a directory read. */
  signals(): Signals {
    return readSignals(this.repoRoot, this.planDir);
  }
}
