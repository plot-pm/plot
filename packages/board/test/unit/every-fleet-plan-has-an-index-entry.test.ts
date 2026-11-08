// Every plan the fleet payload's rows and slices name is a key of `plans` —
// the second "Done when" proof for the fleet plan index
// (`the-fleet-payload-indexes-its-plans`). A unit test with a hand-built
// payload could assert the shape without ever exercising the read that
// produces it; this calls `buildFleet` against a real fixture — real plan
// files, real helper scripts, a real pulse — so the row names and the index
// keys come from the same server read a client would actually receive.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liveFleetdHeartbeat, rmTree } from '../helpers.mjs';
import { buildFleet, stopFleetRefresh } from '../../src/server/fleet.js';

/** The real helpers: `buildFleet` parses plan files through `plot-plan-meta.sh`. */
const REAL_SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const temps: string[] = [];
afterEach(() => {
  stopFleetRefresh();
  for (const d of temps.splice(0)) rmTree(d);
});

const slice = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred']>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state]) => ({
    branch, state, deferred: state === 'deferred', claimed: '',
    local_dirty: false, local_worktree: '',
  })),
});

const plan = (file: string, slices: ReturnType<typeof slice>[]) =>
  ({ file, phase: 'approved', slices });

const HEAD = { main: 'main', head: 'abc1234', read_ref: 'abc1234', local_head: 'abc1234' };

const FIRST_SLUG = 'a-plan-with-a-wave';
const FIRST_FILE = `2026-11-01-${FIRST_SLUG}.md`;
const SECOND_SLUG = 'another-plan-with-a-wave';
const SECOND_FILE = `2026-11-01-${SECOND_SLUG}.md`;

/** A plan file the real parser reads: Approved, with the branch named. */
const planFile = (title: string, branches: string[]) => [
  `# ${title}`, '', '## Status', '',
  '- **State:** Approved',
  '- **Type:** bug',
  '', '## Slices', '',
  '### One', '',
  ...branches.map((b) => `- \`${b}\` — a branch`),
  '', '## Changelog', '', '- a plan', '',
].join('\n');

/** The pulse a finished scan reports: both plans, one wave each. */
const FINISHED = {
  ...HEAD,
  plans: [
    plan(FIRST_FILE, [slice('One', 'eligible', [['feature/a', 'open']])]),
    plan(SECOND_FILE, [slice('One', 'complete', [['feature/b', 'merged']])]),
  ],
  summary: { plans: 2, waves: 2, branches: 2, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
};

/**
 * A repository whose scan is fake and whose other helpers — including the
 * plan-meta parser `fleetPlanIndexOf` reads through `planMetasAtDefault` — are
 * real. Modelled on `delivery-reads-the-last-finished-scan.test.ts`'s fixture.
 */
function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-plan-index-'));
  temps.push(parent);
  const repoRoot = path.join(parent, 'repo');
  const scripts = path.join(parent, 'scripts');
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  fs.mkdirSync(scripts, { recursive: true });

  fs.writeFileSync(path.join(repoRoot, 'docs/plans', FIRST_FILE),
    planFile('A plan with a wave', ['feature/a']), 'utf8');
  fs.writeFileSync(path.join(repoRoot, 'docs/plans', SECOND_FILE),
    planFile('Another plan with a wave', ['feature/b']), 'utf8');

  fs.mkdirSync(path.join(repoRoot, '.plot/state'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.plot/state/last-pulse.json'), JSON.stringify({
    version: 1, at: Date.now(), pulse: FINISHED, ages: [], branchUrlBase: '', approvedAt: [], ideaPlans: [],
  }));
  liveFleetdHeartbeat(repoRoot);
  const ctl = path.join(scripts, 'plot-fleetctl.sh');
  fs.writeFileSync(ctl, '#!/usr/bin/env bash\necho "summary: supervisor=up"\nexit 0\n');
  fs.chmodSync(ctl, 0o755);

  for (const helper of fs.readdirSync(REAL_SCRIPTS)) {
    if (helper === 'plot-fleetctl.sh') continue;
    fs.symlinkSync(path.join(REAL_SCRIPTS, helper), path.join(scripts, helper));
  }

  return { repoRoot, scriptsDir: scripts };
}

async function until<T>(
  read: () => T | Promise<T>,
  want: (v: T) => boolean,
  what: string,
  ms = 30_000,
): Promise<T> {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (want(v)) return v;
    if (Date.now() > stop) throw new Error(`timed out waiting for ${what}; last reading: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('every fleet plan has an index entry', () => {
  it('names every row\'s and every slice\'s plan as a key of fleet.plans', async () => {
    const opts = fixture();

    // Wait for the scan to produce rows and slices from the pulse above.
    const fleet = await until(
      () => buildFleet(opts),
      (f) => f.rows.length > 0 && f.slices.length > 0,
      'rows and slices derived from the finished pulse',
    );

    expect(Object.keys(fleet.plans).sort()).toEqual([FIRST_SLUG, SECOND_SLUG].sort());

    const rowPlans = fleet.rows.map((r) => r.plan).filter((p): p is string => !!p);
    expect(rowPlans.length).toBeGreaterThan(0);
    for (const slug of rowPlans) expect(fleet.plans).toHaveProperty(slug);

    const slicePlans = fleet.slices.map((w) => w.plan);
    expect(slicePlans.length).toBeGreaterThan(0);
    for (const slug of slicePlans) expect(fleet.plans).toHaveProperty(slug);

    // And each entry's own file resolves to the plan that named the slug —
    // by basename, since the working-tree fallback this fixture exercises
    // (no origin/main to resolve) reports the absolute staged path rather
    // than a repo-relative one.
    expect(path.basename(fleet.plans[FIRST_SLUG]?.file ?? '')).toBe(FIRST_FILE);
    expect(path.basename(fleet.plans[SECOND_SLUG]?.file ?? '')).toBe(SECOND_FILE);
  }, 60_000);
});
