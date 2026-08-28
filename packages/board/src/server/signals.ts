import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The three cheap facts that say whether an expensive answer can still be
 * trusted — one process each, for the whole set.
 *
 * WHY THIS EXISTS. A `--json --offline` scan spawns 127 git processes, re-traced
 * 2026-08-28, and the board runs one every 5 seconds: roughly 45,000 process
 * launches an hour. The shape is `branches + plans + worktrees + ~30` — three
 * per-item loops over the three things that grow, and only the constant term is
 * bounded. It is a RATE rather than a leak (`entry.running` prevents overlapping
 * scans, and a 60 s census showed no accumulation), which is why concurrency
 * looks harmless — the spawns are sequential — and why the machine still
 * suffers beside any other spawn-heavy work.
 *
 * The larger win is not computing a cheaper answer; it is not recomputing an
 * answer that cannot have changed. These are the signals that establish
 * "cannot have changed".
 *
 * THE RULE THIS OBEYS. Manifesto Principle 1 is stateless-and-re-derived, and
 * `PLOT_TERMINAL_CACHE` already set the precedent: *"git is re-consulted every
 * pass and the entry is discarded the moment it disagrees, which is what keeps
 * it a derivation rather than a record."* A cache checked against a cheap fact
 * every pass is a derivation; one that is trusted is a record. Nothing here is
 * written to disk — a restarted board re-derives everything on its first pulse,
 * and losing the cache costs one expensive scan and nothing else.
 */

/** One signal: an opaque token that changes exactly when its subject does. */
export interface Signal {
  /** Compare with `===`. Empty means "could not be read" — never a match. */
  token: string;
  /** How many processes it cost. Asserted by tests; a looping signal is a bug. */
  spawns: number;
}

export interface Signals {
  refs: Signal;
  plans: Signal;
  worktrees: Signal;
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Every ref SHA the branch answers depend on — **heads AND remotes**.
 *
 * REMOTES ARE NOT OPTIONAL, and a heads-only signal would be wrong SILENTLY.
 * The counts this guards read `refs/remotes/origin/<main>..refs/heads/<branch>`,
 * so they depend on both endpoints — and the scan runs `git fetch` on every
 * pulse, which moves `origin/<main>` constantly. A signal over local refs alone
 * would leave every branch's ahead-count stale with no local SHA having moved.
 *
 * When `origin/<main>` moves, every cached count is invalidated. That is
 * correct rather than conservative: the range's left endpoint changed, so every
 * count in the set genuinely did.
 *
 * Measured on this repo: 275 refs in 0.007 s, one process.
 */
export function refsSignal(repoRoot: string): Signal {
  try {
    const out = git(repoRoot, [
      'for-each-ref', '--format=%(refname) %(objectname)',
      'refs/heads', 'refs/remotes',
    ]);
    return { token: out, spawns: 1 };
  } catch {
    // Unreadable is NOT unchanged. An empty token matches nothing, so the
    // caller recomputes — the safe direction, and the one that keeps a broken
    // repo from serving cached answers forever.
    return { token: '', spawns: 1 };
  }
}

/**
 * Every plan file's mtime and size — the gate, never the identity.
 *
 * THE HASH IT GATES IS NOT REPLACED. `plot-fleet-scan.sh:3004` states why the
 * scan hashes plan CONTENT: *"THE PLAN'S IDENTITY FOR THE TERMINAL CACHE — its
 * CONTENT, hashed, not its name or its mtime."* Substituting mtime for content
 * would weaken an invalidation that was deliberately made content-based.
 *
 * So this signal only answers *may I skip the hashing entirely?* On a miss the
 * caller rehashes — batched, one process (`git hash-object --stdin-paths`:
 * 164 plans in 0.014 s, measured) — and the terminal cache keeps keying on
 * content exactly as it does today.
 *
 * ACCEPTED RISK, stated: a copy that preserves mtime (`rsync -t`, `cp -p`)
 * leaves a stale oid until the next real edit. Strictly smaller than today's
 * exposure, where `git checkout` rewrites every mtime and over-invalidates.
 * Size is included because it catches the same-mtime-different-length case for
 * free.
 */
export function plansSignal(planDir: string): Signal {
  try {
    const names = fs.readdirSync(planDir).filter((f) => f.endsWith('.md')).sort();
    const parts: string[] = [];
    for (const name of names) {
      // `statSync` is not a process. The loop is over syscalls, not spawns —
      // which is the distinction this whole module is about.
      const s = fs.statSync(path.join(planDir, name));
      parts.push(`${name} ${s.mtimeMs} ${s.size}`);
    }
    return { token: parts.join('\n'), spawns: 0 };
  } catch {
    return { token: '', spawns: 0 };
  }
}

/**
 * The worktree list — which trees exist and what each has checked out.
 *
 * Guards the per-worktree `git -C <path> status` calls. A tree added, removed
 * or moved to another branch invalidates them; a tree merely being dirty does
 * NOT, and that is deliberate — dirtiness is what `status` reports, so it
 * cannot also be the signal that decides whether to ask. The caller recomputes
 * a tree's status on its own cadence; this only says whether the SET changed.
 */
export function worktreesSignal(repoRoot: string): Signal {
  try {
    const out = git(repoRoot, ['worktree', 'list', '--porcelain']);
    // `worktree` and `branch` lines only: the HEAD sha changes on every commit
    // in a tree, which would invalidate the set for a reason the set does not
    // care about.
    const token = out
      .split('\n')
      .filter((l) => l.startsWith('worktree ') || l.startsWith('branch '))
      .join('\n');
    return { token, spawns: 1 };
  } catch {
    return { token: '', spawns: 1 };
  }
}

/**
 * All three, for one pulse. Two processes and a directory read.
 *
 * Deliberately NOT parallel: three spawns is already the floor this module
 * exists to reach, and `Promise.all` over them would add an async surface for
 * no measurable gain on a 0.02 s total.
 */
export function readSignals(repoRoot: string, planDir: string): Signals {
  return {
    refs: refsSignal(repoRoot),
    plans: plansSignal(planDir),
    worktrees: worktreesSignal(repoRoot),
  };
}

/** Whether a cached answer taken under `before` may still be served. */
export function unchanged(before: Signal | undefined, now: Signal): boolean {
  // An empty token never matches — not even another empty one. "Could not read"
  // is not evidence of sameness, and treating two unknowns as equal is how a
  // broken repo serves stale answers forever.
  if (!before || !before.token || !now.token) return false;
  return before.token === now.token;
}
