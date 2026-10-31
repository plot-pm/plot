import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { hostShell } from '../src/adapters/host/host-shell.js';
import { planStoreRef } from '../src/adapters/plan-store/plan-store-ref.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';
import { isAnswered } from '../src/port-result.js';
import type { Host } from '../src/ports/host.js';
import type { BranchReadings, PrReading, WaitsReading } from '../src/rules/branch-state.js';
import { readBranchReadings, type BranchStageReadings } from '../src/workflows/plan-walk-branches.js';
import { readEstate } from '../src/workflows/plan-walk-estate.js';
import { compareField, describeDisagreement, type Disagreement } from './compare.js';
import {
  readCommitsBeyond,
  readEstatePlanMeta,
  readMainBranch,
  readPrList,
  readRemoteRefs,
  readSliceNames,
  type Estate,
  type PrRow,
} from './production.js';
import { git, sandboxWith, type Sandbox } from './sandbox.js';

/**
 * THE PLAN WALK'S BRANCH STAGE AGAINST THE SHELL SCAN: does `readBranchReadings`
 * gather, for every branch line of every live plan, the readings the scan's
 * `branch_readings` gathers?
 *
 * Both sides' readings are serialised the way `plot-fleet-scan.sh` writes them
 * and piped into the REAL `plot-branch-state.mjs` and `plot-merge-subject.mjs`
 * bundles, and the answers are compared byte for byte. Neither side re-derives
 * a state: the bundle decides, on both.
 *
 * Production side: `production.ts`'s oracles (remote refs, the PR list, commits
 * beyond main, the plan records) plus `git merge-base --is-ancestor` for the
 * ancestry the scan asks of git. Stage side: the real `Refs` adapter, the
 * ref-backed `PlanStore` and `readBranchReadings`.
 *
 * ON A DISAGREEMENT THE BRANCH STOPS. Adjusting either side to make the
 * comparison pass is the one move forbidden; the failure names the plan, the
 * branch, the field and both readings.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const BOARD = join(ROOT, 'skills', 'plot', 'scripts', 'board');

/** A plan as the oracle reads it: `plot-plan-meta.sh`'s record, narrowed. */
interface OraclePlan {
  file: string;
  phase: string;
  branches: Array<{ branch: string; deferred: boolean; waits: string[]; commits: string[] }>;
}

/** The phases the stage does not read. */
const SKIPPED = new Set(['released', 'rejected', 'superseded']);

const planConfig = (estate: Estate, key: string, fallback: string): string =>
  execFileSync('bash', [join(estate.root, 'skills', 'plot', 'scripts', 'plot-config.sh'), 'get', key, fallback], {
    cwd: estate.root,
    encoding: 'utf8',
  }).trim();

/** Runs a shipped bundle with stdin. */
const bundle = (estate: Estate, name: string, args: string[], input: string): string => {
  const run = spawnSync('node', [join(BOARD, name), ...args], {
    cwd: estate.root,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  if (run.status !== 0) throw new Error(`${name} exited ${run.status}: ${run.stderr}`);
  return run.stdout;
};

/** Whether `ancestor` is contained in `descendant`, as the scan asks git. */
const contained = (estate: Estate, ancestor: string, descendant: string): 'yes' | 'no' | 'unknown' => {
  const run = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: estate.root });
  if (run.status === 0) return 'yes';
  return run.status === 1 ? 'no' : 'unknown';
};

/** The oracle's plans, narrowed from the raw records. */
const oraclePlans = (estate: Estate, main: string, repoFiles: readonly string[]): OraclePlan[] => {
  const raws = readEstatePlanMeta(estate, main);
  if (raws.length !== repoFiles.length) throw new Error(`the oracle read ${raws.length} plans, the stage ${repoFiles.length}`);
  return raws
    .map((raw, i) => ({
      // The oracle reads plans from a scratch directory; the repository path is the stage's.
      file: basename(String(raw.file)) === basename(repoFiles[i]!) ? repoFiles[i]! : String(raw.file),
      phase: String(raw.phase ?? ''),
      branches: ((raw.waves ?? []) as Array<{ branches?: Array<Record<string, unknown>> }>).flatMap((slice) =>
        (slice.branches ?? []).map((b) => ({
          branch: String(b.branch),
          deferred: b.deferred === true,
          waits: ((b.waits_on ?? []) as string[]).map(String),
          commits: ((b.commits ?? []) as string[]).map(String),
        })),
      ),
    }))
    .filter((plan) => !SKIPPED.has(plan.phase));
};

/** The rank of a PR row when several share a head: open, then merged, then the rest. */
const bestPerBranch = (rows: readonly PrRow[]): Map<string, string> => {
  const rank = (state: string): number => (state === 'OPEN' ? 0 : state === 'MERGED' ? 1 : 2);
  const best = new Map<string, string>();
  for (const row of rows) {
    const held = best.get(row.head);
    if (held === undefined || rank(row.state) < rank(held)) best.set(row.head, row.state);
  }
  return best;
};

/** One serialised readings line, the scan's twelve fields. */
const line = (r: BranchReadings): string => {
  const word = (pr: PrReading): string => (pr === 'none' ? 'NONE' : pr === 'unreadable' ? '-' : pr);
  const waits = r.waits.length === 0;
  return [
    String(r.deferredByPlan),
    r.refTip ?? '-',
    r.mainTip ?? '-',
    String(r.mergeSubjectFound),
    r.hostReach,
    word(r.pr),
    String(r.commitsAhead),
    String(r.realCommitsAhead),
    waits ? '-' : r.waits.map((w) => w.branch).join(','),
    waits ? '?' : r.waits.map((w) => word(w.pr)).join(','),
    String(r.prListComplete),
    waits ? '?' : r.waits.map((w) => String(w.namedSlice)).join(','),
  ].join('\t');
};

/** The `plot-merge-subject.mjs` stdin for the refless branches of the live plans. */
const subjectInput = (
  backend: string,
  origin: string,
  merges: ReadonlyArray<{ sha: string; subject: string }>,
  plans: ReadonlyArray<{ file: string; added: string | null; branches: string[] }>,
): string =>
  [
    `@backend ${backend}`,
    `@origin ${origin}`,
    '@merges',
    ...merges.map((m) => `${m.sha} ${m.subject}`),
    ...plans.flatMap((p) => [`@plan ${p.file}`, `@added ${p.added ?? '-'}`, ...p.branches]),
    '',
  ].join('\n');

/** The branches the real subject bundle proves landed, as `<plan>\t<branch>`. */
const provenBySubject = (
  estate: Estate,
  backend: string,
  origin: string,
  merges: ReadonlyArray<{ sha: string; subject: string }>,
  plans: ReadonlyArray<{ file: string; added: string | null; branches: string[] }>,
): Set<string> => {
  const input = subjectInput(backend, origin, merges, plans);
  const pairs = bundle(estate, 'plot-merge-subject.mjs', ['pairs'], input)
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => l.split('\t'));
  const answers = pairs.map(([, , merge, added]) => `@ancestry ${merge} ${added} ${contained(estate, merge!, added!)}`);
  const proven = bundle(estate, 'plot-merge-subject.mjs', ['proven'], `${input}${answers.join('\n')}\n`)
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((f) => f[0] === 'proven');
  return new Set(proven.map((f) => `${f[1]}\t${f[2]}`));
};

/** Every disagreement between the stage and the oracle over one estate. */
const compareEstate = async (
  estate: Estate,
  host: Host,
  backend: string,
  oracleHostReading: () => { verdict: string; complete: boolean; rows: PrRow[] },
): Promise<{ compared: number; found: Disagreement[]; stage: BranchStageReadings }> => {
  const main = readMainBranch(estate);
  const context = shellContext(estate.root);
  const refsPort = refsGit(context);
  const store = planStoreRef(refsPort, context, `origin/${main}`);
  const planDir = planConfig(estate, 'Plan directory', 'docs/plans/');
  const prefixes = planConfig(estate, 'Branch prefixes', 'idea/, feature/, bug/, docs/, infra/')
    .split(',')
    .map((p) => p.trim().replace(/\/$/, ''))
    .filter((p) => p !== '');
  const walkedEstate = await readEstate(refsPort, store, {
    mainBranch: main,
    planDir,
    activeDir: planConfig(estate, 'Active index', 'docs/plans/active/'),
    deliveredDir: planConfig(estate, 'Delivered index', 'docs/plans/delivered/'),
    prefixes,
  });
  if (!isAnswered(walkedEstate)) throw new Error(`the estate stage failed: ${walkedEstate.why}`);
  const walked = await readBranchReadings(refsPort, host, walkedEstate.value, { mainBranch: main, planDir });
  if (!isAnswered(walked)) throw new Error(`the branch stage failed: ${walked.why}`);

  const refs = readRemoteRefs(estate);
  const mainTip = refs.get(main) ?? null;
  const list = oracleHostReading();
  const best = bestPerBranch(list.rows);
  const prFor = (branch: string): PrReading => {
    const held = best.get(branch);
    if (held === 'OPEN' || held === 'MERGED' || held === 'CLOSED') return held;
    if (held !== undefined) return 'unreadable';
    return list.complete ? 'none' : 'unreadable';
  };
  const sliceNames = new Set(readSliceNames(estate));
  const plans = oraclePlans(estate, main, walkedEstate.value.plans.map((p) => p.record.file));

  const merges = execFileSync('git', ['log', `origin/${main}`, '--merges', '--max-count=20000', '--format=%H %s'], {
    cwd: estate.root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => ({ sha: l.slice(0, l.indexOf(' ')), subject: l.slice(l.indexOf(' ') + 1) }));
  const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: estate.root, encoding: 'utf8' }).trim();
  const addedOf = (file: string): string | null => {
    const out = execFileSync('git', ['log', `origin/${main}`, '--first-parent', '--diff-filter=A', '--format=%H', '--', file], {
      cwd: estate.root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((l) => l !== '');
    return out.length === 0 ? null : out[out.length - 1]!;
  };
  const refless = plans.map((p) => ({
    file: p.file,
    added: addedOf(p.file),
    branches: p.branches.filter((b) => !refs.has(b.branch)).map((b) => b.branch),
  }));
  const proven = provenBySubject(estate, backend, origin, merges, refless);

  const found: Disagreement[] = [];
  let compared = 0;
  const byKey = new Map(walked.value.branches.map((b) => [`${b.plan}\t${b.branch}`, b] as const));
  for (const plan of plans) {
    const stageLines: string[] = [];
    const oracleLines: string[] = [];
    const names: string[] = [];
    for (const b of plan.branches) {
      const subject = `${plan.file} :: ${b.branch}`;
      const stage = byKey.get(`${plan.file}\t${b.branch}`);
      if (stage === undefined) {
        found.push({ subject, field: 'present', adapter: 'missing', production: 'read' });
        continue;
      }
      compared += 1;
      const refTip = refs.get(b.branch) ?? null;
      const counts = refTip !== null && mainTip !== null ? readCommitsBeyond(estate, mainTip, refTip) : { total: 0, real: 0 };
      const landed = b.commits.length > 0 && b.commits.every((c) => !c.includes('@') && contained(estate, c, `origin/${main}`) === 'yes');
      const waits: WaitsReading[] = b.waits.map((name) => ({ branch: name, pr: prFor(name), namedSlice: sliceNames.has(name) }));
      const oracle: BranchReadings = {
        deferredByPlan: b.deferred,
        refTip,
        mainTip,
        mergeSubjectFound: refTip === null && (proven.has(`${plan.file}\t${b.branch}`) || landed),
        hostReach: list.verdict as BranchReadings['hostReach'],
        pr: prFor(b.branch),
        prListComplete: list.complete,
        commitsAhead: counts.total,
        realCommitsAhead: counts.real,
        waits,
      };
      for (const field of ['deferredByPlan', 'refTip', 'mainTip', 'mergeSubjectFound', 'hostReach', 'pr', 'prListComplete', 'commitsAhead', 'realCommitsAhead'] as const) {
        compareField(found, subject, field, stage.readings[field], oracle[field]);
      }
      compareField(found, subject, 'waits', JSON.stringify(stage.readings.waits), JSON.stringify(oracle.waits));
      names.push(b.branch);
      stageLines.push(line(stage.readings));
      oracleLines.push(line(oracle));
    }
    if (names.length === 0) continue;
    const arg = names.join('\n');
    const stageAnswer = bundle(estate, 'plot-branch-state.mjs', [arg], `${stageLines.join('\n')}\n`);
    const oracleAnswer = bundle(estate, 'plot-branch-state.mjs', [arg], `${oracleLines.join('\n')}\n`);
    compareField(found, plan.file, 'bundle answer', stageAnswer, oracleAnswer);
  }
  return { compared, found, stage: walked.value };
};

describe('the branch stage agrees with the shell scan on this repository', () => {
  const estate: Estate = { root: ROOT };
  let result: Awaited<ReturnType<typeof compareEstate>>;

  beforeAll(async () => {
    result = await compareEstate(estate, hostShell(shellContext(ROOT)), process.env.PLOT_HOST ?? 'github', () => readPrList(estate));
  }, 500_000);

  it('reads a corpus worth comparing', () => {
    // A FLOOR: every assertion is universally quantified over this set, and a
    // stage that read nothing agrees with an oracle that read nothing.
    expect(result.compared).toBeGreaterThan(0);
    expect(result.stage.branches.length).toBe(result.compared);
  });

  it('gathers the same readings, and the real bundle answers the same, for every branch', () => {
    expect(result.found.map(describeDisagreement)).toEqual([]);
  });
});

describe('the branch stage agrees with the Bitbucket merge subject on a sandbox', () => {
  let box: Sandbox;
  let result: Awaited<ReturnType<typeof compareEstate>>;

  beforeAll(async () => {
    box = sandboxWith([['gone', 'Approved', 'feature/gone'], ['kept', 'Approved', 'feature/kept']], 'plot-branches-bb-');
    const { root } = box;
    // `feature/gone` merged the Bitbucket way after the plans were added, and
    // its ref is deleted; `feature/kept` still has a ref and a commit.
    for (const branch of ['feature/gone', 'feature/kept']) {
      git(root, 'checkout', '-q', '-b', branch, 'main');
      writeFileSync(join(root, `${branch.replace('/', '-')}.txt`), 'work\n');
      git(root, 'add', '-A');
      git(root, 'commit', '-qm', `work on ${branch}`);
      git(root, 'push', '-q', 'origin', branch);
    }
    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', '--no-ff', '-q', '-m', 'Merged in feature/gone (pull request #7)', 'feature/gone');
    git(root, 'push', '-q', 'origin', 'main');
    git(root, 'push', '-q', 'origin', '--delete', 'feature/gone');
    git(root, 'fetch', '-q', '--prune', 'origin');
    result = await compareEstate(box, hostFixture({ backend: 'bitbucket' }), 'bitbucket', () => ({
      verdict: 'ok',
      complete: false,
      rows: [],
    }));
  }, 120_000);

  afterAll(() => {
    rmSync(box.dir, { recursive: true, force: true });
  });

  it('compares both branches', () => {
    expect(result.compared).toBe(2);
  });

  it('proves the deleted branch by its Bitbucket subject, and only that one', () => {
    const found = result.stage.branches.map((b) => [b.branch, b.readings.mergeSubjectFound]);
    expect(found).toEqual(expect.arrayContaining([['feature/gone', true], ['feature/kept', false]]));
  });

  it('gathers the same readings, and the real bundle answers the same', () => {
    expect(result.found.map(describeDisagreement)).toEqual([]);
  });
});
