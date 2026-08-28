// The monitors — asserted by SPAWN COUNT and by what they REFUSE to serve.
//
// The two halves of the contract are tested separately on purpose. A cache that
// only ever hit would pass every saving test and be wrong; the tests that matter
// most here are the ones that feed a monitor a stale or deliberately wrong entry
// and check it goes back to git.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BranchMonitor, PlanMonitor, WorktreeManager, FleetMonitors, adoptBatch } from '../../src/server/monitors.js';
import { plansSignal, refsSignal, worktreesSignal } from '../../src/server/signals.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const git = (dir: string, ...a: string[]) =>
  execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** A repo with a real `origin` remote, so ahead-counts have two endpoints. */
function repo(): { dir: string; planDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-monitors-'));
  dirs.push(root);
  const up = path.join(root, 'up.git');
  const dir = path.join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', up], { stdio: 'ignore' });
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'remote', 'add', 'origin', up);
  const planDir = path.join(dir, 'docs', 'plans');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, '2026-01-01-a.md'), '# A\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'first');
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'fetch', '-q', 'origin');
  return { dir, planDir };
}

/** A branch with `n` commits ahead of its pushed upstream. */
function branchAhead(dir: string, name: string, n: number): void {
  git(dir, 'checkout', '-q', '-b', name, 'main');
  git(dir, 'push', '-q', 'origin', name);
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(dir, `${name.replace(/\//g, '-')}-${i}.txt`), `${i}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', `c${i}`);
  }
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'fetch', '-q', 'origin');
}

// A BUDGET, NOT A CONCESSION. Every test in this block builds a real repo with
// a real remote and pushes to it — measured 4-6.5 s each on a QUIET machine,
// which is inherent to asking a real git a real question rather than a fixture.
// The suite runs 127 files in parallel, and the default 30 s budget was eaten by
// that load, not by the work. Bounding the WORK is the fix where the work is the
// problem (the real-estate file is sampled for exactly that reason); here the
// work is the test, so the budget is what moves.
describe('BranchMonitor: a quiet estate is not re-asked', { timeout: 120_000 }, () => {
  it('a second pulse over an unchanged estate spawns ZERO', () => {
    const { dir } = repo();
    const names = ['feature/a', 'feature/b', 'feature/c', 'feature/d'];
    for (const n of names) branchAhead(dir, n, 2);
    const m = new BranchMonitor(dir, 'main');

    const cold = m.counts_for(names, m.invalidate(refsSignal(dir)));
    expect(cold.stats.spawns).toBe(4);
    expect(cold.counts.get('feature/a')).toBe(2);

    const warm = m.counts_for(names, m.invalidate(refsSignal(dir)));
    // THE WHOLE POINT, asserted by count rather than by timing: a timing
    // assertion is flaky and the count is the fact that produces the timing.
    expect(warm.stats.spawns).toBe(0);
    expect(warm.stats.reused).toBe(4);
    // And the answer is the same one. A saving that changed the answer is a
    // regression, not an optimisation.
    expect([...warm.counts.entries()].sort()).toEqual([...cold.counts.entries()].sort());
  });

  it('a moved ref invalidates EXACTLY its branch, not the whole set', () => {
    const { dir } = repo();
    const names = ['feature/a', 'feature/b', 'feature/c'];
    for (const n of names) branchAhead(dir, n, 1);
    const m = new BranchMonitor(dir, 'main');
    m.counts_for(names, m.invalidate(refsSignal(dir)));

    git(dir, 'checkout', '-q', 'feature/b');
    fs.writeFileSync(path.join(dir, 'more.txt'), 'x\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'more');
    git(dir, 'checkout', '-q', 'main');

    const warm = m.counts_for(names, m.invalidate(refsSignal(dir)));
    // A monitor that recomputed everything on any change has bought nothing on
    // a busy estate — which is exactly when the board matters most.
    expect(warm.stats.spawns).toBe(1);
    expect(warm.stats.reused).toBe(2);
    expect(warm.counts.get('feature/b')).toBe(2);
    expect(warm.counts.get('feature/a')).toBe(1);
  });

  it('a fetch that moves origin/main invalidates EVERY count', () => {
    const { dir } = repo();
    const names = ['feature/a', 'feature/b'];
    for (const n of names) branchAhead(dir, n, 1);
    const m = new BranchMonitor(dir, 'main');
    m.counts_for(names, m.invalidate(refsSignal(dir)));

    // Move ONLY the remote ref — the hole a heads-only signal would leave.
    // `update-ref` rather than a commit: committing would move a local ref too
    // and the test would pass for the wrong reason.
    const tip = git(dir, 'rev-parse', 'refs/heads/feature/a').trim();
    const before = git(dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').trim();
    git(dir, 'update-ref', 'refs/remotes/origin/main', tip);
    const after = git(dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').trim();
    expect(after).toBe(before); // no LOCAL ref moved

    const warm = m.counts_for(names, m.invalidate(refsSignal(dir)));
    // The range's left endpoint changed, so every count in the set genuinely
    // did. Recomputing all of them is accurate, not conservative.
    expect(warm.stats.spawns).toBe(2);
    expect(warm.stats.reused).toBe(0);
  });

  it('an unreadable signal invalidates everything — silence is never sameness', () => {
    const { dir } = repo();
    branchAhead(dir, 'feature/a', 1);
    const m = new BranchMonitor(dir, 'main');
    m.counts_for(['feature/a'], m.invalidate(refsSignal(dir)));
    const warm = m.counts_for(['feature/a'], m.invalidate({ token: '', spawns: 1 }));
    expect(warm.stats.spawns).toBe(1);
  });

  it('a deleted branch is dropped, not served from memory', () => {
    const { dir } = repo();
    branchAhead(dir, 'feature/a', 3);
    const m = new BranchMonitor(dir, 'main');
    expect(m.counts_for(['feature/a'], m.invalidate(refsSignal(dir))).counts.get('feature/a')).toBe(3);
    git(dir, 'branch', '-D', 'feature/a');
    const warm = m.counts_for(['feature/a'], m.invalidate(refsSignal(dir)));
    // Re-asked, and git's answer — 0 — is what is served, not the cached 3.
    expect(warm.stats.spawns).toBe(1);
    expect(warm.counts.get('feature/a')).toBe(0);
  });
});

describe('PlanMonitor: mtime GATES the hash, it does not replace it', () => {
  it('a second pulse over unedited plans spawns ZERO', () => {
    const { dir, planDir } = repo();
    for (let i = 0; i < 15; i++) fs.writeFileSync(path.join(planDir, `2026-02-${10 + i}-p.md`), `# P${i}\n`);
    const m = new PlanMonitor(dir);
    const cold = m.oidsFor(planDir, plansSignal(planDir));
    // ONE process for the whole miss set, not one per plan.
    expect(cold.stats.spawns).toBe(1);
    expect(cold.stats.recomputed).toBe(16);
    const warm = m.oidsFor(planDir, plansSignal(planDir));
    expect(warm.stats.spawns).toBe(0);
    expect(warm.stats.reused).toBe(16);
    expect(warm.oids).toEqual(cold.oids);
  });

  it('the oid IS git hash-object — the content hash, unchanged', () => {
    const { dir, planDir } = repo();
    const m = new PlanMonitor(dir);
    const { oids } = m.oidsFor(planDir, plansSignal(planDir));
    const real = git(dir, 'hash-object', path.join(planDir, '2026-01-01-a.md')).trim();
    // The terminal cache validates against this value. A monitor that returned
    // anything else would silently stop every cached branch answer validating.
    expect(oids.get('2026-01-01-a.md')).toBe(real);
  });

  it('an edited plan is rehashed and only it', () => {
    const { dir, planDir } = repo();
    fs.writeFileSync(path.join(planDir, '2026-01-02-b.md'), '# B\n');
    const m = new PlanMonitor(dir);
    const cold = m.oidsFor(planDir, plansSignal(planDir));
    fs.writeFileSync(path.join(planDir, '2026-01-02-b.md'), '# B changed\n');
    const warm = m.oidsFor(planDir, plansSignal(planDir));
    expect(warm.stats.recomputed).toBe(1);
    expect(warm.stats.reused).toBe(1);
    expect(warm.oids.get('2026-01-02-b.md')).not.toBe(cold.oids.get('2026-01-02-b.md'));
    expect(warm.oids.get('2026-01-01-a.md')).toBe(cold.oids.get('2026-01-01-a.md'));
  });

  it('a plan edited with its mtime PRESERVED keeps the content oid it had', () => {
    // DONE-WHEN 9, and it pins the ACCEPTED RISK rather than a hoped-for
    // behaviour: mtime is a skip-gate and never the identity, so a write that
    // preserves the timestamp exactly is not seen until the next real edit.
    //
    // THE RESTORE IS `touch -r`, NOT `fs.utimesSync`, and the difference is the
    // finding. Node's `utimesSync` takes a Date and truncates to milliseconds,
    // so on a filesystem with nanosecond stamps (APFS, ext4) it cannot restore
    // one — measured here, 1787955546354264813 came back as 1787955546354000000.
    // That means a real `cp -p` on this platform usually DOES move the low
    // digits and is caught anyway, so the documented risk is narrower than the
    // plan states. Narrower is not absent: `touch -r` copies the full stamp, and
    // that is the case this test constructs, because a test that could not
    // reproduce the risk would be quietly asserting it away.
    const { dir, planDir } = repo();
    const f = path.join(planDir, '2026-01-01-a.md');
    const ref = path.join(planDir, '.stamp-source');
    fs.writeFileSync(ref, 'x');
    execFileSync('touch', ['-r', f, ref]); // ref now carries f's exact stamp
    const size = fs.statSync(f).size;
    const m = new PlanMonitor(dir);
    const cold = m.oidsFor(planDir, plansSignal(planDir));

    // Same length as well as same stamp: the signal carries size precisely to
    // catch a same-mtime-different-length write for free, so a shorter body
    // would be caught and the test would prove the opposite of its name.
    fs.writeFileSync(f, Buffer.alloc(size, 0x62));
    execFileSync('touch', ['-r', ref, f]);
    expect(fs.statSync(f).size).toBe(size);
    expect(fs.statSync(f, { bigint: true }).mtimeNs)
      .toBe(fs.statSync(ref, { bigint: true }).mtimeNs);

    const warm = m.oidsFor(planDir, plansSignal(planDir));
    expect(warm.stats.spawns).toBe(0);
    expect(warm.oids.get('2026-01-01-a.md')).toBe(cold.oids.get('2026-01-01-a.md'));

    // And the moment anything real moves, the true content hash returns.
    fs.writeFileSync(f, '# A truly edited\n');
    const hot = m.oidsFor(planDir, plansSignal(planDir));
    expect(hot.oids.get('2026-01-01-a.md')).toBe(git(dir, 'hash-object', f).trim());
  });

  it('a SHORT batch is discarded whole, never position-matched', () => {
    // `hash-object --stdin-paths` answers POSITIONALLY, so a reply with fewer
    // lines than paths misattributes every oid after the gap — and those oids
    // key the terminal cache, so a plan's branch answers would validate against
    // ANOTHER plan's revision. All-or-nothing is the only safe rule.
    //
    // Tested on `adoptBatch` DIRECTLY because git reaches this case by throwing
    // (measured: exit 128 on the first unreadable path; ENOBUFS on a clip), so
    // no repo state reproduces it through the caller. A guard no test can reach
    // is a comment, not a gate — and a mutation proved this one was unreached.
    const need = ['a.md', 'b.md', 'c.md'];
    const stamps = new Map(need.map((n) => [n, 's']));
    const oidStore = new Map<string, string>();
    const stampStore = new Map<string, string>();
    const out = new Map<string, string>();

    const short = 'aaa111\nbbb222\n'; // two oids for three paths
    expect(adoptBatch(short, need, stamps, oidStore, stampStore, out)).toBe(false);
    // Nothing adopted — not even the two that arrived, because which two they
    // are is exactly what a short reply fails to say.
    expect(out.size).toBe(0);
    expect(oidStore.size).toBe(0);

    const full = 'aaa111\nbbb222\nccc333\n';
    expect(adoptBatch(full, need, stamps, oidStore, stampStore, out)).toBe(true);
    expect(out.get('a.md')).toBe('aaa111');
    expect(out.get('c.md')).toBe('ccc333');
  });

  it('an unreadable plan path leaves every oid absent, none misattributed', () => {
    // The caller-visible half, on the failure git ACTUALLY produces. Measured
    // 2026-08-29: a directory named `*.md` makes `hash-object --stdin-paths`
    // abort with exit 128 after printing the oids that preceded it, so
    // `execFileSync` throws and nothing is adopted.
    const { dir, planDir } = repo();
    fs.writeFileSync(path.join(planDir, '2026-01-02-b.md'), '# B\n');
    fs.mkdirSync(path.join(planDir, '2026-01-03-zz.md'));

    const m = new PlanMonitor(dir);
    const { oids, stats } = m.oidsFor(planDir, plansSignal(planDir));
    expect(stats.spawns).toBe(1);
    expect(oids.size).toBe(0);

    // Removing the bad entry restores a clean batch, and each oid is its own.
    fs.rmdirSync(path.join(planDir, '2026-01-03-zz.md'));
    const good = m.oidsFor(planDir, plansSignal(planDir));
    expect(good.oids.get('2026-01-02-b.md'))
      .toBe(git(dir, 'hash-object', path.join(planDir, '2026-01-02-b.md')).trim());
    expect(good.oids.get('2026-01-01-a.md'))
      .toBe(git(dir, 'hash-object', path.join(planDir, '2026-01-01-a.md')).trim());
  });

  it('a plan that vanished takes its oid with it', () => {
    const { dir, planDir } = repo();
    fs.writeFileSync(path.join(planDir, '2026-01-02-b.md'), '# B\n');
    const m = new PlanMonitor(dir);
    m.oidsFor(planDir, plansSignal(planDir));
    fs.rmSync(path.join(planDir, '2026-01-02-b.md'));
    const warm = m.oidsFor(planDir, plansSignal(planDir));
    expect(warm.oids.has('2026-01-02-b.md')).toBe(false);
    expect(warm.stats.spawns).toBe(0);
  });
});

describe('WorktreeManager: the SET is the signal, dirtiness is the answer', () => {
  it('a second pulse over an unchanged set spawns ZERO', () => {
    const { dir } = repo();
    const m = new WorktreeManager();
    m.invalidate(worktreesSignal(dir));
    const cold = m.statusFor([dir]);
    expect(cold.stats.spawns).toBe(1);
    m.invalidate(worktreesSignal(dir));
    const warm = m.statusFor([dir]);
    expect(warm.stats.spawns).toBe(0);
    expect(warm.statuses.get(dir)).toBe(cold.statuses.get(dir));
  });

  it('an added worktree drops every cached status', () => {
    const { dir } = repo();
    branchAhead(dir, 'feature/a', 1);
    const m = new WorktreeManager();
    m.invalidate(worktreesSignal(dir));
    m.statusFor([dir]);
    const wt = path.join(path.dirname(dir), 'wt-a');
    git(dir, 'worktree', 'add', '-q', wt, 'feature/a');
    const same = m.invalidate(worktreesSignal(dir));
    expect(same).toBe(false);
    expect(m.statusFor([dir]).stats.spawns).toBe(1);
  });

  it('a status older than maxAge is re-asked, never served', () => {
    // The bound that exists BECAUSE the set-level signal cannot see dirtiness:
    // an edit inside an existing tree is invisible to it, so a cache that never
    // expired would freeze one afternoon's floor state into every later pulse.
    const { dir } = repo();
    const m = new WorktreeManager(1_000);
    m.invalidate(worktreesSignal(dir));
    const t0 = Date.now();
    expect(m.statusFor([dir], t0).stats.spawns).toBe(1);
    expect(m.statusFor([dir], t0 + 500).stats.spawns).toBe(0);
    expect(m.statusFor([dir], t0 + 1_500).stats.spawns).toBe(1);
  });

  it('a dirty tree is REPORTED, and reported again once it is stale', () => {
    const { dir } = repo();
    const m = new WorktreeManager(1_000);
    m.invalidate(worktreesSignal(dir));
    const t0 = Date.now();
    expect(m.statusFor([dir], t0).statuses.get(dir)).toBe('');
    fs.writeFileSync(path.join(dir, 'dirty.txt'), 'x\n');
    // Still served from memory: the set did not change and the entry is young.
    expect(m.statusFor([dir], t0 + 100).statuses.get(dir)).toBe('');
    // Past maxAge git is asked again, and the floor state arrives.
    expect(m.statusFor([dir], t0 + 2_000).statuses.get(dir)).toContain('dirty.txt');
  });
});

describe('a deliberately wrong cached answer is discarded, never trusted', { timeout: 120_000 }, () => {
  it('BranchMonitor serves gits answer after a ref moves, not the poisoned one', () => {
    // DONE-WHEN 4. The rule that keeps this a derivation rather than a record:
    // the entry is discarded the moment the cheap fact disagrees.
    const { dir } = repo();
    branchAhead(dir, 'feature/a', 1);
    const m = new BranchMonitor(dir, 'main');
    const cold = m.counts_for(['feature/a'], m.invalidate(refsSignal(dir)));
    expect(cold.counts.get('feature/a')).toBe(1);

    git(dir, 'checkout', '-q', 'feature/a');
    for (let i = 0; i < 4; i++) {
      fs.writeFileSync(path.join(dir, `extra${i}.txt`), 'x\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-qm', `e${i}`);
    }
    git(dir, 'checkout', '-q', 'main');

    const warm = m.counts_for(['feature/a'], m.invalidate(refsSignal(dir)));
    // git says 5. The cache said 1. git wins, and that is the entire licence
    // for holding a cache at all.
    expect(warm.counts.get('feature/a')).toBe(5);
  });
});

describe('nothing is written to disk — a restart re-derives everything', { timeout: 120_000 }, () => {
  it('a full monitor pass leaves no new file behind', () => {
    // DONE-WHEN 6, asserted by ABSENCE. A file the board wrote and later
    // trusted would be the record Principle 1 forbids.
    const { dir, planDir } = repo();
    branchAhead(dir, 'feature/a', 1);
    const before = fs.readdirSync(dir).sort();
    const m = new FleetMonitors(dir, planDir, 'main');
    const sig = m.signals();
    m.branches.counts_for(['feature/a'], m.branches.invalidate(sig.refs));
    m.plans.oidsFor(planDir, sig.plans);
    m.worktrees.invalidate(sig.worktrees);
    m.worktrees.statusFor([dir]);
    expect(fs.readdirSync(dir).sort()).toEqual(before);
    expect(fs.existsSync(path.join(dir, '.plot'))).toBe(false);

    // And a fresh instance — the restarted board — knows nothing.
    const restarted = new FleetMonitors(dir, planDir, 'main');
    const s2 = restarted.signals();
    const cold = restarted.branches.counts_for(['feature/a'], restarted.branches.invalidate(s2.refs));
    expect(cold.stats.reused).toBe(0);
    expect(cold.stats.spawns).toBe(1);
  });
});
