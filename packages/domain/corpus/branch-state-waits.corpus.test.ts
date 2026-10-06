import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { branchState, type BranchReadings } from '../src/rules/branch-state.js';
import { readFleetScan, type Estate } from './production.js';

/**
 * A `waits:` PREREQUISITE WITH NO PULL REQUEST, on a sandbox estate (#1305).
 *
 * The live estate reaches this case only while a plan holds a chain of
 * unstarted slices, so CI may never see it. This builds the shape: one plan
 * whose wave holds an unstarted slice, a slice waiting on it, and a slice
 * waiting on a name no plan contains. A `gh` shim answers "no pull requests
 * found" for every branch, so the host's reading is `NONE` for all three
 * prerequisites and only the plan set separates them.
 *
 * Both sides answer: the scan (`plot-fleet-scan.sh --json`, through the
 * shipped bundle) and `branchState` over the same readings.
 */

const REPO = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

const FIRST = 'feature/first-slice';
const CHAINED = 'feature/second-slice';
const TYPO = 'feature/waits-on-a-typo';
const NOBODY = 'feature/a-name-no-plan-contains';

const PLAN =
  '# A chained wait\n\n## Status\n\n- **State:** Approved\n- **Type:** feature\n'
  + '- **Impl:** own branches\n\n## Branches\n\n### Only\n\n'
  + `- \`${FIRST}\` — nobody has started it\n`
  + `- \`${CHAINED}\` <!-- waits: ${FIRST} --> — waits on its sibling\n`
  + `- \`${TYPO}\` <!-- waits: ${NOBODY} --> — waits on a name no plan contains\n`;

/** A `gh` that has never seen a pull request for any branch. */
const GH =
  '#!/usr/bin/env bash\n'
  + 'if [ "$1 $2" = "pr view" ]; then echo "no pull requests found" >&2; exit 1; fi\n'
  + 'if [ "$1 $2" = "pr list" ]; then echo "[]"; exit 0; fi\n'
  + 'echo "{}"\n';

let root: string;
let states: Map<string, string>;

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
  mkdirSync(join(work, 'docs', 'plans'), { recursive: true });
  cpSync(join(REPO, 'skills', 'plot', 'scripts'), join(work, 'skills', 'plot', 'scripts'), {
    recursive: true,
  });
  writeFileSync(
    join(work, 'CLAUDE.md'),
    '# Sandbox\n\n## Plot Config\n\n- **Branch prefixes:** feature/\n- **Plan directory:** docs/plans/\n',
  );
  writeFileSync(join(work, 'docs', 'plans', '2026-10-06-a-chained-wait.md'), PLAN);
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'sandbox');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  git(work, 'remote', 'set-head', 'origin', 'main');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), GH);
  chmodSync(join(bin, 'gh'), 0o755);
  return { root: work };
};

beforeAll(() => {
  const sandbox = estate();
  const path = process.env.PATH;
  process.env.PATH = `${join(root, 'bin')}:${path ?? ''}`;
  try {
    const pulse = readFleetScan(sandbox) as {
      plans: { waves: { branches: { branch: string; state: string }[] }[] }[];
    };
    states = new Map(
      pulse.plans.flatMap((p) => p.waves.flatMap((s) => s.branches.map((b) => [b.branch, b.state]))),
    );
  } finally {
    process.env.PATH = path;
  }
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

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

describe('a prerequisite with no pull request, on both sides', () => {
  it('scans every branch of the sandbox plan', () => {
    expect([...states.keys()].sort()).toEqual([FIRST, CHAINED, TYPO].sort());
  });

  it('reads waiting for an unstarted slice the plan names', () => {
    const rule = branchState({
      ...unstarted,
      waits: [{ branch: FIRST, pr: 'none', namedSlice: true }],
    });
    expect({ rule, shell: states.get(CHAINED) }).toEqual({ rule: 'waiting', shell: 'waiting' });
  });

  it('reads blocked for a name no plan contains', () => {
    const rule = branchState({
      ...unstarted,
      waits: [{ branch: NOBODY, pr: 'none', namedSlice: false }],
    });
    expect({ rule, shell: states.get(TYPO) }).toEqual({ rule: 'blocked', shell: 'blocked' });
  });
});
