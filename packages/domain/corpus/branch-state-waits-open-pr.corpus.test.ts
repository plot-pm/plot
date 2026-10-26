import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { branchState, namedSlices, type BranchReadings } from '../src/rules/branch-state.js';
import { readEstatePlanSlices, readFleetScan, readListEligible, type Estate } from './production.js';

/**
 * A `waits:` PREREQUISITE WITH AN OPEN PULL REQUEST, under one heading and
 * across two (#an-unmerged-waits-target-blocks-eligibility).
 *
 * `branch-state-waits.corpus.test.ts`'s `gh` shim answers "no pull requests
 * found" for every branch, so every case there is `pr: 'none'` — none
 * exercises a `waits:` target that has an open PR, which is the shape
 * `manifest-retry-and-race-findings` showed: `bug/an-unstarted-continue-resumes-no-stranger`
 * waited on `bug/a-continuation-obeys-the-limits` (#2078, open draft) across
 * two `###` headings (`Continuation limits` / `Unstarted resume`). This
 * builds that shape twice — the waiter under the SAME heading as the target,
 * and under a DIFFERENT one — so the heading-count variable the bug report
 * named is actually varied, not assumed.
 */

const REPO = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

const TARGET = 'feature/open-pr-target';
const WAITER_SAME = 'feature/waits-same-heading';
const WAITER_CROSS = 'feature/waits-cross-heading';

const SLUG = '2026-10-20-a-chained-wait-on-an-open-pr';

const PLAN =
  '# A chained wait on an open PR\n\n## Status\n\n- **State:** Approved\n- **Type:** feature\n'
  + '- **Impl:** own branches\n\n## Branches\n\n### Target heading\n\n'
  + `- \`${TARGET}\` — an open draft PR\n`
  + `- \`${WAITER_SAME}\` <!-- waits: ${TARGET} --> — waits under the SAME heading\n\n`
  + `### Waiter heading\n\n`
  + `- \`${WAITER_CROSS}\` <!-- waits: ${TARGET} --> — waits under a DIFFERENT heading\n`;

/**
 * A `gh` that answers a pull request for TARGET in the given state, and none
 * for anything else. `pr-state` by branch calls `gh pr view <branch> --json
 * …`, so the branch is argv position 3 ("pr", "view", "<branch>") — not 4,
 * which lands on `--json`. `plot-fleet-scan.sh`'s bulk `pr list --state all`
 * is the dominant path for a scan with no per-branch ask, so both arms must
 * answer the same state for a fixture to exercise what the real scan reads.
 */
const ghFor = (state: 'OPEN' | 'MERGED'): string =>
  '#!/usr/bin/env bash\n'
  + 'if [ "$1 $2" = "pr view" ]; then\n'
  + '  br="$3"\n'
  + `  if [ "$br" = "${TARGET}" ]; then echo '{"number":42,"state":"${state}","headRefName":"${TARGET}","draft":${state === 'OPEN'}}'; exit 0; fi\n`
  + '  echo "no pull requests found" >&2; exit 1\n'
  + 'fi\n'
  + 'if [ "$1 $2" = "pr list" ]; then\n'
  + `  echo '[{"number":42,"state":"${state}","headRefName":"${TARGET}","draft":${state === 'OPEN'}}]'\n`
  + '  exit 0\n'
  + 'fi\n'
  + 'echo "{}"\n';

const GH = ghFor('OPEN');

let root: string;
let sandbox: Estate;
let full: Map<string, string>;
let fullMerged: Map<string, string>;
let eligibleWhileOpen: string[];

/** Builds the sandbox estate and returns its working tree. */
const estate = (): Estate => {
  root = mkdtempSync(join(tmpdir(), 'plot-open-pr-wait-'));
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
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'sandbox');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  git(work, 'remote', 'set-head', 'origin', 'main');

  // TARGET carries real work and a live ref — its PR is open, never merged.
  git(work, 'checkout', '-q', '-b', TARGET);
  writeFileSync(join(work, 'CLAUDE.md'), 'work toward the target\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'wip toward the target');
  git(work, 'push', '-q', 'origin', TARGET);
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
    eligibleWhileOpen = readListEligible(sandbox, { fetch: false });
    // TARGET's PR reading MERGED, not OPEN: the real discriminator. `waitVerdict`
    // treats every non-MERGED state alike, so a fixture that never reads MERGED
    // cannot tell "the host's OPEN answer flowed through" from "the host was
    // unreachable and the default happened to read the same".
    writeFileSync(join(root, 'bin', 'gh'), ghFor('MERGED'));
    fullMerged = statesOf(readFleetScan(sandbox) as Pulse);
  } finally {
    process.env.PATH = path;
  }
}, 240_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The set the rule reads, from the estate as the scan enumerates it. */
const ruleNames = (): Set<string> => namedSlices(readEstatePlanSlices(sandbox, 'main'));

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

/** What the rule answers for a branch waiting on `prerequisite`, reading `state`. */
const ruleFor = (prerequisite: string, state: 'OPEN' | 'MERGED'): string =>
  branchState({
    ...unstarted,
    waits: [{ branch: prerequisite, pr: state, namedSlice: ruleNames().has(prerequisite) }],
  });

describe('a prerequisite with an open pull request, under one heading and across two', () => {
  it.each([
    ['the same heading as its target', WAITER_SAME],
    ['a different heading than its target', WAITER_CROSS],
  ])('reads waiting, not eligible, for a waiter under %s', (_what, branch) => {
    expect({ rule: ruleFor(TARGET, 'OPEN'), full: full.get(branch) }).toEqual({
      rule: 'waiting',
      full: 'waiting',
    });
  });

  it('does not hand either waiter to --list-eligible', () => {
    expect(eligibleWhileOpen).not.toContain(WAITER_SAME);
    expect(eligibleWhileOpen).not.toContain(WAITER_CROSS);
  });

  it.each([
    ['the same heading as its target', WAITER_SAME],
    ['a different heading than its target', WAITER_CROSS],
  ])('clears to not-waiting once TARGET merges, for a waiter under %s', (_what, branch) => {
    expect(ruleFor(TARGET, 'MERGED')).not.toEqual('waiting');
    expect(fullMerged.get(branch)).not.toEqual('waiting');
  });
});
