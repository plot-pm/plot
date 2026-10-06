import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { branchState, namedSlices, type BranchReadings } from '../src/rules/branch-state.js';
import { readEstatePlanSlices, readFleetScan, readSliceNames, type Estate } from './production.js';

/**
 * A `waits:` PREREQUISITE WITH NO PULL REQUEST, on a sandbox estate (#1305).
 *
 * The live estate reaches these cases only while a plan holds an unstarted
 * prerequisite, so CI may never see them. This builds them: a plan whose
 * slices wait on a sibling, on a name no plan contains, on a slice of a second
 * plan, on a slice of a plan carried only on its branch, on a deferred slice,
 * and on a slice of a delivered plan. A `gh` shim answers "no pull requests
 * found" for every branch, so the host's reading is `NONE` for every
 * prerequisite and only the plan estate separates them.
 *
 * Both sides answer, in a full scan and in a slug run of the waiting plan:
 * the scan (`plot-fleet-scan.sh --json`, through the shipped bundle) and
 * `branchState`, whose `namedSlice` comes from `namedSlices` over the estate
 * enumerated as the scan enumerates it.
 */

const REPO = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

const FIRST = 'feature/first-slice';
const CHAINED = 'feature/second-slice';
const TYPO = 'feature/waits-on-a-typo';
const NOBODY = 'feature/a-name-no-plan-contains';
const CROSS = 'feature/waits-on-another-plan';
const OTHER = 'feature/a-slice-of-another-plan';
const ON_BRANCH_PLAN = 'feature/waits-on-a-branch-plan';
const BRANCH_ONLY = 'feature/a-slice-of-a-branch-plan';
const ON_DEFERRED = 'feature/waits-on-a-deferred-slice';
const GIVEN_UP = 'feature/a-deferred-slice';
const ON_FINISHED = 'feature/waits-on-a-delivered-plan';
const FINISHED = 'feature/a-slice-of-a-delivered-plan';
const CARRIER = 'feature/carries-a-plan';

const SLUG = '2026-10-06-a-chained-wait';

const plan = (title: string, state: string, lines: string[]): string =>
  `# ${title}\n\n## Status\n\n- **State:** ${state}\n- **Type:** feature\n`
  + `- **Impl:** own branches\n\n## Branches\n\n### Only\n\n${lines.join('\n')}\n`;

const PLAN = plan('A chained wait', 'Approved', [
  `- \`${FIRST}\` — nobody has started it`,
  `- \`${CHAINED}\` <!-- waits: ${FIRST} --> — waits on its sibling`,
  `- \`${TYPO}\` <!-- waits: ${NOBODY} --> — waits on a name no plan contains`,
  `- \`${CROSS}\` <!-- waits: ${OTHER} --> — waits on a slice of another plan`,
  `- \`${ON_BRANCH_PLAN}\` <!-- waits: ${BRANCH_ONLY} --> — waits on a slice of a plan on its branch`,
  `- \`${GIVEN_UP}\` <!-- deferred: given up --> — deferred`,
  `- \`${ON_DEFERRED}\` <!-- waits: ${GIVEN_UP} --> — waits on a deferred slice`,
  `- \`${ON_FINISHED}\` <!-- waits: ${FINISHED} --> — waits on a slice of a delivered plan`,
]);

/** A `gh` that has never seen a pull request for any branch. */
const GH =
  '#!/usr/bin/env bash\n'
  + 'if [ "$1 $2" = "pr view" ]; then echo "no pull requests found" >&2; exit 1; fi\n'
  + 'if [ "$1 $2" = "pr list" ]; then echo "[]"; exit 0; fi\n'
  + 'echo "{}"\n';

let root: string;
let sandbox: Estate;
let full: Map<string, string>;
let slug: Map<string, string>;
let shellNames: { full: string[]; slug: string[] };

/** Builds the sandbox estate and returns its working tree. */
const estate = (): Estate => {
  root = mkdtempSync(join(tmpdir(), 'plot-chained-wait-'));
  const upstream = join(root, 'upstream');
  const work = join(root, 'work');
  mkdirSync(upstream);
  mkdirSync(work);
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git(upstream, 'init', '-q', '--bare', '-b', 'main', '.');
  git(work, 'init', '-q', '-b', 'main', '.');
  git(work, 'remote', 'add', 'origin', upstream);
  git(work, 'config', 'user.email', 'corpus@example.invalid');
  git(work, 'config', 'user.name', 'Corpus');
  git(work, 'config', 'commit.gpgsign', 'false');
  const plans = join(work, 'docs', 'plans');
  mkdirSync(plans, { recursive: true });
  cpSync(join(REPO, 'skills', 'plot', 'scripts'), join(work, 'skills', 'plot', 'scripts'), {
    recursive: true,
  });
  writeFileSync(
    join(work, 'CLAUDE.md'),
    '# Sandbox\n\n## Plot Config\n\n- **Branch prefixes:** feature/\n- **Plan directory:** docs/plans/\n',
  );
  writeFileSync(join(plans, `${SLUG}.md`), PLAN);
  writeFileSync(
    join(plans, '2026-10-06-another-plan.md'),
    plan('Another plan', 'Approved', [`- \`${OTHER}\` — nobody has started it`]),
  );
  writeFileSync(
    join(plans, '2026-10-06-a-delivered-plan.md'),
    plan('A delivered plan', 'Delivered', [`- \`${FINISHED}\` — never built`]),
  );
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'sandbox');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  git(work, 'remote', 'set-head', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', CARRIER);
  writeFileSync(
    join(plans, '2026-10-06-a-plan-on-its-branch.md'),
    plan('A plan on its branch', 'Approved', [`- \`${BRANCH_ONLY}\` — nobody has started it`]),
  );
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'a plan on its branch');
  git(work, 'push', '-q', 'origin', CARRIER);
  git(work, 'checkout', '-q', 'main');
  git(work, 'fetch', '-q', 'origin');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), GH);
  chmodSync(join(bin, 'gh'), 0o755);
  return { root: work };
};

type Pulse = { plans: { waves: { branches: { branch: string; state: string }[] }[] }[] };

const statesOf = (pulse: Pulse): Map<string, string> =>
  new Map(pulse.plans.flatMap((p) => p.waves.flatMap((s) => s.branches.map((b) => [b.branch, b.state]))));

beforeAll(() => {
  sandbox = estate();
  const path = process.env.PATH;
  process.env.PATH = `${join(root, 'bin')}:${path ?? ''}`;
  try {
    full = statesOf(readFleetScan(sandbox) as Pulse);
    slug = statesOf(readFleetScan(sandbox, SLUG) as Pulse);
    shellNames = { full: readSliceNames(sandbox).sort(), slug: readSliceNames(sandbox, SLUG).sort() };
  } finally {
    process.env.PATH = path;
  }
}, 240_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The set the rule reads, from the estate as the scan enumerates it. */
const ruleNames = (): Set<string> =>
  namedSlices(readEstatePlanSlices(sandbox, 'main'));

/** An unstarted branch whose own pull request the host has never seen. */
const unstarted: BranchReadings = {
  deferredByPlan: false,
  refTip: null,
  mainTip: 'aaa',
  mergeSubjectFound: false,
  hostReach: 'ok',
  pr: 'none',
  prListComplete: false,
  commitsAhead: 0,
  realCommitsAhead: 0,
  waits: [],
};

/** What the rule answers for a branch waiting on `prerequisite`. */
const ruleFor = (prerequisite: string): string =>
  branchState({
    ...unstarted,
    waits: [{ branch: prerequisite, pr: 'none', namedSlice: ruleNames().has(prerequisite) }],
  });

describe('a prerequisite with no pull request, on both sides', () => {
  it('scans every branch of the sandbox plan in both modes', () => {
    const waiting = [FIRST, CHAINED, TYPO, CROSS, ON_BRANCH_PLAN, GIVEN_UP, ON_DEFERRED, ON_FINISHED];
    expect([...slug.keys()].sort()).toEqual([...waiting].sort());
    expect([...full.keys()].sort()).toEqual([...waiting, OTHER, BRANCH_ONLY, FINISHED].sort());
  });

  it('holds one named-slice set in the scan, in a slug run, and in the rule', () => {
    const rule = [...ruleNames()].sort();
    expect(rule).toEqual([FIRST, CHAINED, TYPO, CROSS, ON_BRANCH_PLAN, ON_DEFERRED, ON_FINISHED, OTHER, BRANCH_ONLY].sort());
    expect(shellNames).toEqual({ full: rule, slug: rule });
  });

  it.each([
    ['an unstarted sibling slice', CHAINED, FIRST, 'waiting'],
    ['a name no plan contains', TYPO, NOBODY, 'blocked'],
    ['an unstarted slice of another plan', CROSS, OTHER, 'waiting'],
    ['an unstarted slice of a plan carried on its branch', ON_BRANCH_PLAN, BRANCH_ONLY, 'waiting'],
    ['a deferred slice', ON_DEFERRED, GIVEN_UP, 'blocked'],
    ['a slice of a delivered plan', ON_FINISHED, FINISHED, 'blocked'],
  ])('reads a wait on %s the same in the rule, the full scan and the slug run', (_what, branch, prerequisite, expected) => {
    expect({ rule: ruleFor(prerequisite), full: full.get(branch), slug: slug.get(branch) }).toEqual({
      rule: expected,
      full: expected,
      slug: expected,
    });
  });
});
