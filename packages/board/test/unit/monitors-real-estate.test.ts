// THE MONITORS AGAINST THIS REPOSITORY, not a fixture.
//
// Done-when 2 requires the cache-miss and cache-hit paths to agree "on THIS
// repository — cold, then warm — not on a fixture. A fixture agrees with
// whatever wrote it." So this runs the monitors over the real estate — every
// local branch, every plan file — and checks each answer against git asked
// directly.
//
// SKIPPED OUTSIDE THIS REPO. A checkout without `docs/plans` (a fresh clone of
// a consumer, CI for the published package) has nothing to compare, and a test
// that silently passes on an empty set is worse than one that says it did not
// run.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { BranchMonitor, PlanMonitor } from '../../src/server/monitors.js';
import { plansSignal, refsSignal } from '../../src/server/signals.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const planDir = path.join(repoRoot, 'docs', 'plans');

/**
 * How many local branches this checkout has — the precondition that actually
 * matters, and the one the first version of this guard got wrong.
 *
 * IT CHECKED `.git` AND `docs/plans`, and CI has BOTH: the runner clones with
 * `--depth 1 --single-branch`, so `refs/heads` holds exactly one ref and
 * `for-each-ref` over it answered nothing. The estate this file exists to
 * measure was empty, and the assertions correctly refused to pass vacuously —
 * `expected 0 to be greater than 5`.
 *
 * So the guard asks the ref database rather than the filesystem. A checkout
 * with a handful of branches is not an estate, and a test that quietly passes
 * on one would be asserting nothing while looking green — the failure this
 * whole file is designed to avoid.
 */
function localBranchCount(): number {
  try {
    return execFileSync('git', ['-C', repoRoot, 'for-each-ref', '--format=x', 'refs/heads'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

// 25 rather than 1: this file's claims are about an ESTATE — 244 branches on a
// developer's checkout — and a shallow CI clone carrying one branch cannot
// witness them. Skipped there, and run where the estate exists.
const here = fs.existsSync(planDir)
  && fs.existsSync(path.join(repoRoot, '.git'))
  && localBranchCount() > 25;

describe.skipIf(!here)('the monitors agree with git on the real estate', () => {
  const git = (...a: string[]) =>
    execFileSync('git', ['-C', repoRoot, ...a], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

  it('every cached ahead-count equals what git answers directly', () => {
    // BOUNDED TO A SAMPLE, and the bound is the point rather than a concession.
    // This checkout has 244 local branches; the cold pass spawns one `rev-list`
    // each and the truth check spawns them again, so the unbounded form is ~500
    // processes and timed out at 30 s under the parallel suite — a test about
    // reducing spawn counts, failing by spawning. The property asserted here is
    // per-branch ("the cached answer equals git's"), so a sample establishes it
    // exactly as well as the full set does; what needs every branch is the
    // SPAWN-COUNT property, and that is asserted on the whole set below.
    const all = git('for-each-ref', '--format=%(refname:strip=2)', 'refs/heads')
      .split('\n').filter(Boolean);
    expect(all.length).toBeGreaterThan(5);
    // 12 rather than 25: each sampled branch costs THREE `rev-list` spawns
    // (cold, warm-check, truth) and this file measured 19.9 s on a QUIET
    // machine at 25 — comfortably over the 30 s budget once the suite runs it
    // in parallel with 126 other files. A sample proves a per-branch property;
    // it does not get truer by being slower.
    const branches = all.slice(0, 12);

    const m = new BranchMonitor(repoRoot, 'main');
    const cold = m.counts_for(branches, m.invalidate(refsSignal(repoRoot)));
    // Cold pays full price: one spawn per branch, exactly as the scan does.
    expect(cold.stats.spawns).toBe(branches.length);

    const warm = m.counts_for(branches, m.invalidate(refsSignal(repoRoot)));
    // WARM PAYS NOTHING. This is Done-when 1 on the real estate rather than on
    // four synthetic branches.
    expect(warm.stats.spawns).toBe(0);
    expect(warm.stats.reused).toBe(branches.length);

    // AND THE ANSWERS ARE GIT'S. A saving that changed an answer is a
    // regression: `--next` reads this output to pick which branch a worker
    // claims, and a wrong answer there starts the wrong work.
    for (const br of branches) {
      let truth = 0;
      try {
        const out = git('rev-list', '--count', `refs/remotes/origin/${br}..refs/heads/${br}`).trim();
        truth = /^\d+$/.test(out) ? Number(out) : 0;
      } catch {
        truth = 0;
      }
      expect(warm.counts.get(br), `ahead-count for ${br}`).toBe(truth);
      expect(cold.counts.get(br), `cold vs warm for ${br}`).toBe(warm.counts.get(br));
    }
  });

  it('a warm pass over EVERY branch on the estate spawns nothing', () => {
    // The spawn-count property on the FULL set — 244 local branches here — and
    // it is cheap precisely because the warm pass is what spawns nothing. Kept
    // separate from the agreement test above because the two have opposite cost
    // profiles: agreement needs a `rev-list` per branch to establish truth, so
    // it is sampled; this one needs none, so it takes everything.
    const all = git('for-each-ref', '--format=%(refname:strip=2)', 'refs/heads')
      .split('\n').filter(Boolean);
    expect(all.length).toBeGreaterThan(20);

    const m = new BranchMonitor(repoRoot, 'main');
    const cold = m.counts_for(all, m.invalidate(refsSignal(repoRoot)));
    expect(cold.stats.spawns).toBe(all.length);

    const warm = m.counts_for(all, m.invalidate(refsSignal(repoRoot)));
    // THE CLAIM THE CHANGE EXISTS TO MAKE, on the real estate: every branch
    // answered, no process started.
    expect(warm.stats.spawns).toBe(0);
    expect(warm.stats.reused).toBe(all.length);
    // And the warm answers are the cold ones, branch for branch.
    for (const br of all) expect(warm.counts.get(br)).toBe(cold.counts.get(br));
  }, 120_000);

  it('every cached plan oid equals git hash-object on the same file', () => {
    const m = new PlanMonitor(repoRoot);
    const cold = m.oidsFor(planDir, plansSignal(planDir));
    // ONE process for every plan on the estate — not one per plan.
    expect(cold.stats.spawns).toBe(1);
    expect(cold.oids.size).toBeGreaterThan(20);

    const warm = m.oidsFor(planDir, plansSignal(planDir));
    expect(warm.stats.spawns).toBe(0);
    expect(warm.oids).toEqual(cold.oids);

    // The terminal cache validates branch answers against this oid, so it must
    // be the content hash the scan itself computes — nothing else will do.
    const names = [...cold.oids.keys()];
    const truth = execFileSync('git', ['-C', repoRoot, 'hash-object', '--stdin-paths'], {
      encoding: 'utf8',
      input: names.map((n) => path.join(planDir, n)).join('\n') + '\n',
      maxBuffer: 32 * 1024 * 1024,
    }).split('\n').filter(Boolean);
    names.forEach((n, i) => expect(warm.oids.get(n), `oid for ${n}`).toBe(truth[i]));
  });
});
