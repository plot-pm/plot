import { execFileSync } from 'node:child_process';

import { beforeAll, describe, expect, it } from 'vitest';

import { isChainedHeading, type ChainedBranchLine } from '../src/rules/slice-chain.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';
import { readEstatePlanMeta, readMainBranch, type Estate } from './production.js';

/**
 * THE SECOND RULE-VERSUS-SHELL COMPARISON: does `isChainedHeading` answer what
 * `plot-reconcile-scan.sh` section 7 answers, through the one bundle both the
 * shell and this test call — `board/plot-slice-chain.mjs` — over every
 * multi-branch heading on this repository's real estate?
 *
 * NEITHER SIDE IS AUTHORITATIVE. The test says they agree. `docs/shell-and-domain.md`
 * is the contract this is built to; on a disagreement the branch stops, and
 * adjusting either side to make this pass is the one move forbidden.
 *
 * Both sides are fed the SAME heading, read once from `plot-plan-meta.sh`'s
 * `waves[].branches[]` — assembling two separate readings from the plan text
 * would compare this test's parser against itself. The shell side is the
 * bundle's own process, invoked exactly as section 7 invokes it, so a
 * disagreement here is a disagreement between the wire and the rule rather
 * than between two parsers of the plan.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };
const BUNDLE = new URL('../../../skills/plot/scripts/board/plot-slice-chain.mjs', import.meta.url).pathname;

/** The pair this file compares, and the words its report uses. */
const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

/** One heading's branches, as `plot-plan-meta.sh` emits them on the wire. */
type WireBranch = ChainedBranchLine & Record<string, unknown>;

/** One multi-branch heading, named for a disagreement to point at. */
interface Heading {
  /** The plan file this heading came from, relative to the repo root. */
  file: string;
  /** The heading's name, or `''` for an unnamed wave. */
  name: string;
  /** The heading's branches, in plan order. */
  branches: WireBranch[];
}

/** Asks the bundle exactly as section 7 asks it: one JSON line, one word back. */
const shellAnswer = (branches: readonly ChainedBranchLine[]): string =>
  execFileSync('node', [BUNDLE], {
    input: `${JSON.stringify({ branches })}\n`,
    encoding: 'utf8',
  }).trim();

let headings: Heading[];

beforeAll(() => {
  const mainBranch = readMainBranch(estate);
  const plans = readEstatePlanMeta(estate, mainBranch);
  headings = plans.flatMap((meta) => {
    const file = String(meta.file ?? '');
    const waves = (meta.waves ?? []) as { name?: string; branches?: WireBranch[] }[];
    return waves
      .filter((wave) => (wave.branches?.length ?? 0) > 1)
      .map((wave) => ({ file, name: String(wave.name ?? ''), branches: wave.branches ?? [] }));
  });
}, 240_000);

describe('isChainedHeading agrees with plot-slice-chain.mjs', () => {
  it('reads a corpus worth comparing', () => {
    // A floor, not a constant — a new multi-branch heading is a normal week
    // here, and `manifest-retry-and-race-findings` alone carries two.
    expect(headings.length).toBeGreaterThan(0);
  });

  it('exercises both answers, so this is not vacuous', () => {
    const answers = new Set(headings.map((h) => (isChainedHeading(h.branches) ? 'chained' : 'uncut')));
    expect([...answers].sort()).toEqual(['chained', 'uncut']);
  });

  it('answers what the shell answers, on every multi-branch heading on the estate', () => {
    const found: Disagreement[] = [];
    for (const heading of headings) {
      const subject = `${heading.file} :: ${heading.name || '(unnamed wave)'}`;
      const rule = isChainedHeading(heading.branches) ? 'chained' : 'uncut';
      compareField(found, subject, 'chain', rule, shellAnswer(heading.branches));
    }
    // One comparison rather than one assertion per heading: a failure has to
    // name every disagreeing heading, because one heading disagreeing and
    // every heading disagreeing are different findings pointing at different
    // bugs.
    expect(found.map(report)).toEqual([]);
  });

  it('reads the manifest-retry-and-race-findings heading as chained, on both sides', () => {
    // THE CASE THAT MOTIVATED THIS BRANCH, reached here through the real wire
    // rather than a hand-built fixture. `### Continuation` from the unit
    // test's fixture has since been resliced into two single-branch waves —
    // `/plot-reslice` landed while this branch was in flight — so `Start and
    // stop` is the one multi-branch heading this plan still carries on `main`.
    const named = headings.filter((h) => h.file.includes('manifest-retry-and-race-findings'));
    expect(named.length).toBeGreaterThanOrEqual(1);
    for (const heading of named) {
      expect(isChainedHeading(heading.branches)).toBe(true);
      expect(shellAnswer(heading.branches)).toBe('chained');
    }
  });

  it('reports a disagreement naming the subject and both answers', () => {
    // THE REPORT IS THE DELIVERABLE, so it is asserted rather than assumed.
    const line = report({
      subject: 'docs/plans/2026-10-17-manifest-retry-and-race-findings.md :: Continuation',
      field: 'chain',
      adapter: '"chained"',
      production: '"uncut"',
    });
    expect(line).toBe(
      'docs/plans/2026-10-17-manifest-retry-and-race-findings.md :: Continuation :: chain :: rule="chained" shell="uncut"',
    );
  });
});
