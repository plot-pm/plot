import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readFleetScan, type Estate } from './production.js';

/**
 * THE FINISHED ESTATE, BUILT RATHER THAN WAITED FOR.
 *
 * Every other file in this tier reads the repository it runs in, which is the
 * point of a corpus: the shell and the domain are compared over real data
 * nobody shaped for the test. The cost is that WHICH CASES EXIST is decided by
 * whatever the estate happens to hold that day.
 *
 * Measured 2026-09-08: `the-board-serves-a-team` delivered all 19 of its plans,
 * so no plan was non-terminal, the scan reported `plans: []`, and SIX vacuity
 * floors failed at once on the release PR's own CI — `expected 0 to be greater
 * than 0`. A sprint finishing is the success case, and the guards read it as
 * the scan being broken.
 *
 * The estate could not be asked to reproduce that: an estate with a backlog
 * cannot demonstrate what happens when the backlog empties, and one without a
 * backlog is a state the project passes through rather than sits in. So this
 * builds the shape instead — two sandboxes, one finished and one not — and
 * pins what the scan answers for each.
 *
 * IT COMPARES THE SCAN AGAINST ITSELF, not against the domain, which is why it
 * belongs beside the comparisons rather than inside one. The claim is about the
 * INPUT the other files assume: that an empty pulse means a finished estate and
 * not a broken scan.
 */

const REPO = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

const PLAN = (slug: string, state: string, branch: string): string =>
  `# ${slug}\n\n## Status\n\n- **State:** ${state}\n- **Type:** feature\n- **Review:** pr\n`
  + `- **Impl:** own branches\n\n## Slices\n\n### The slice (Branch: ${branch})\n\n**Done when** merged.\n`;

/** Builds a sandbox estate carrying exactly the plans named. */
const estateWith = (plans: ReadonlyArray<readonly [string, string, string]>): Estate => {
  const root = mkdtempSync(join(tmpdir(), 'plot-finished-'));
  const upstream = join(root, 'upstream');
  const work = join(root, 'work');
  mkdirSync(upstream);
  mkdirSync(work);
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

  git(upstream, 'init', '-q', '--bare', '.');
  git(work, 'init', '-q', '.');
  git(work, 'remote', 'add', 'origin', upstream);
  git(work, 'config', 'user.email', 'corpus@example.invalid');
  git(work, 'config', 'user.name', 'Corpus');

  mkdirSync(join(work, 'docs', 'plans'), { recursive: true });
  // The estate runs ITS OWN scripts (`production.ts`'s `scriptIn`), so the
  // sandbox carries the ones under test rather than a copy that could drift.
  cpSync(join(REPO, 'skills', 'plot', 'scripts'), join(work, 'skills', 'plot', 'scripts'), { recursive: true });
  writeFileSync(join(work, 'CLAUDE.md'),
    '# Sandbox\n\n## Plot Config\n\n- **Branch prefixes:** feature/\n- **Plan directory:** docs/plans/\n');
  for (const [slug, state, branch] of plans) {
    writeFileSync(join(work, 'docs', 'plans', `2026-09-01-${slug}.md`), PLAN(slug, state, branch));
  }
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'sandbox');
  git(work, 'branch', '-M', 'main');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  try {
    git(work, 'remote', 'set-head', 'origin', 'main');
  } catch {
    git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  }
  return { root: work };
};

const roots: string[] = [];
const build = (plans: ReadonlyArray<readonly [string, string, string]>): Estate => {
  const estate = estateWith(plans);
  roots.push(estate.root);
  return estate;
};

let finished: Record<string, unknown>;
let working: Record<string, unknown>;

beforeAll(() => {
  finished = readFleetScan(build([['a-done-thing', 'Delivered', 'feature/done']]));
  working = readFleetScan(build([
    ['a-done-thing', 'Delivered', 'feature/done'],
    ['a-live-thing', 'Approved', 'feature/live'],
  ]));
}, 120_000);

afterAll(() => {
  for (const root of roots) rmSync(join(root, '..'), { recursive: true, force: true });
});

describe('a finished estate is a reading, not a broken scan', () => {
  it('reports no plans when every plan is terminal', () => {
    // THE SHAPE THAT FAILED CI. `plans` carries the NON-TERMINAL population, so
    // an estate whose work is all delivered reports an empty one — and the
    // summary counts agree rather than disagreeing with it.
    expect(finished.plans).toEqual([]);
    const summary = finished.summary as Record<string, number>;
    expect(summary.plans).toBe(0);
    expect(summary.branches).toBe(0);
    expect(summary.waves).toBe(0);
  });

  it('reports the backlog as soon as one plan is live', () => {
    // THE CONTROL, and it is what makes the emptiness above a measurement. The
    // two estates differ by one Approved plan; if the empty answer came from a
    // scan that could not read the sandbox at all, this would be empty too.
    const summary = working.summary as Record<string, number>;
    expect((working.plans as unknown[]).length).toBe(1);
    expect(summary.branches).toBe(1);
    expect(summary.eligible).toBe(1);
  });

  it('reports the same shape either way, so a reader need not special-case it', () => {
    // AN EMPTY PULSE IS WELL-FORMED. The floors elsewhere in this tier exist
    // because a comparison over nothing passes vacuously — but they must fail
    // on a BROKEN scan, never on a finished one, and telling those apart needs
    // the empty answer to still carry every field.
    for (const pulse of [finished, working]) {
      expect(Array.isArray(pulse.plans)).toBe(true);
      expect(pulse.main).toBe('main');
      expect(pulse.fetch_failed).toBe(false);
      const summary = pulse.summary as Record<string, unknown>;
      for (const key of ['plans', 'waves', 'branches', 'claimed', 'eligible', 'blocked']) {
        expect(typeof summary[key]).toBe('number');
      }
    }
  });
});
