import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * FOUR READERS ANSWER "IS THIS PLAN DELIVERABLE", AND THEY MUST AGREE.
 *
 * The defect this pair exists for, measured 2026-09-22: `allSlicesMerged`
 * answered `not-merged` for a plan whose branches were all deferred, while
 * `plot-deliver.sh` reported `0 merged, 1 deferred` and would have delivered
 * it. The two had disagreed through FOUR released deliveries of exactly that
 * shape and nothing noticed, because nothing compared them.
 *
 * A fourth reader was found during the panel that reviewed the fix:
 * `plot-ask.mjs deliverable` carries its own arithmetic and already sided with
 * the shell. So the estate held three implementations of one question plus the
 * rule, and the plan proposing the fix named two of them.
 *
 * THE FOUR:
 *
 *   1. `allSlicesMerged`          — the rule, in this package
 *   2. `plot-ask.mjs deliverable` — a bundle, its own counting
 *   3. `plot-deliver.sh`          — the shell an operator runs
 *   4. `planAutoDeliver`          — the board's unattended actor
 *
 * **THE FOURTH IS DELIBERATELY EXCLUDED FROM THE EQUALITY.** `planAutoDeliver`
 * is STRICTER by design: it additionally requires a branch to have landed
 * here, because it runs on the scan's clock with no switch and chains delivery
 * to a ref deletion that cannot be undone. Its own unit tests pin that
 * asymmetry. Folding it into this comparison would force one of the two to
 * move and destroy the protection — the disagreement is the feature.
 *
 * NEITHER OF THE THREE IS AUTHORITATIVE. This test says they agree.
 * `docs/shell-and-domain.md` is the contract: on a disagreement the branch
 * stops, and adjusting a side to make this pass is the one move forbidden.
 *
 * IT READS THE REAL ESTATE rather than fixtures, for the reason
 * `sprint-score.corpus.test.ts` gives: assembling readings here would compare
 * the domain against this test's parser instead of against production.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

/** One plan's counts, as a reader reports them. */
interface Counts {
  merged: number;
  deferred: number;
  deliverable: boolean;
}

const sh = (cmd: string, args: string[]): string => {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  } catch {
    return '';
  }
};

/** Reader 2: the bundle, asked without HTTP. */
const askBundle = (slug: string, file: string): Counts | null => {
  const out = sh('node', ['skills/plot/scripts/board/plot-ask.mjs', 'deliverable', slug, file]);
  if (out.trim() === '') return null;
  try {
    const j = JSON.parse(out) as Counts;
    return { merged: j.merged, deferred: j.deferred, deliverable: j.deliverable };
  } catch {
    return null;
  }
};

/** Reader 3: the shell, from its own summary line. */
const askShell = (slug: string): Counts | null => {
  const out = sh('bash', ['skills/plot/scripts/plot-deliver.sh', slug, '--dry-run']);
  const line = out.split('\n').find((l) => l.startsWith('step: verified'));
  if (line === undefined) return null;
  const merged = Number(/verified (\d+) branch/.exec(line)?.[1] ?? NaN);
  const deferred = Number(/(\d+) deferred/.exec(line)?.[1] ?? 0);
  if (Number.isNaN(merged)) return null;
  // The shell says it WOULD deliver by reaching its phase step; a refusal
  // never prints one. That is its verdict, read from what it did rather than
  // re-derived from its counts.
  return { merged, deferred, deliverable: out.includes('would flip Phase') };
};

/**
 * The plans both readers can answer about.
 *
 * **NOT `Approved`, and that is a measurement rather than a preference.** This
 * keyed on `Approved` until 2026-09-23, when the estate reached zero open
 * plans and CI went red on the population guard below — a corpus test that
 * fails when the work is finished is a gate pointing the wrong way. `Approved`
 * is a transient phase and legitimately empties; `Delivered` and `Released` do
 * not, and the two readers must agree about those too.
 *
 * **BOUNDED, because each plan costs two spawned processes.** 286 plans on
 * this estate against a corpus suite already measured at 282 s, so the newest
 * are taken — a drift between the readers shows up on recent plans first, and
 * an older plan's answer has been stable for months.
 */
const LIMIT = 12;

const comparablePlans = (): Array<{ slug: string; file: string }> => {
  const dir = path.join(ROOT, 'docs', 'plans');
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ slug: string; file: string }> = [];
  // Newest first: the filename carries the date, so a reverse sort is the order.
  for (const name of fs.readdirSync(dir).sort().reverse()) {
    if (!name.endsWith('.md')) continue;
    const rel = path.join('docs', 'plans', name);
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (!/^- \*\*State:\*\* (Approved|Delivered|Released)\s*$/m.test(text)) continue;
    out.push({ slug: name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''), file: rel });
    if (out.length >= LIMIT) break;
  }
  return out;
};

describe('deliverable — the bundle and the shell answer one question', () => {
  const plans = comparablePlans();

  it('finds a population to compare', () => {
    // A zero here is not a pass: the comparison below would assert nothing,
    // which is how a corpus test goes quietly green while the pair drifts.
    //
    // It is safe to require now that the population is `Delivered` and
    // `Released` as well as `Approved` — 299 plans on this estate, and a
    // repository with none has no readers to compare.
    expect(plans.length).toBeGreaterThan(0);
  });

  for (const { slug, file } of plans) {
    it(`agrees on ${slug}`, () => {
      const bundle = askBundle(slug, file);
      const shell = askShell(slug);

      // An unaskable reader is not a disagreement. Both are spawned processes
      // and either can fail for reasons that are not this rule's — a missing
      // node, a host timeout. Reporting that as drift would make the corpus
      // tier noisy in exactly the way that gets it switched off.
      if (bundle === null || shell === null) return;

      const subject = `deliverable :: ${slug}`;
      expect(
        { merged: bundle.merged, deferred: bundle.deferred, deliverable: bundle.deliverable },
        `${subject} :: bundle=${JSON.stringify(bundle)} shell=${JSON.stringify(shell)}`,
      ).toEqual({ merged: shell.merged, deferred: shell.deferred, deliverable: shell.deliverable });
    });
  }
});
