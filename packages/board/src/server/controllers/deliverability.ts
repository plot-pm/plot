import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { PlanMetaSchema } from '../../contract/schema.js';
import type { BuildBoardOptions } from '../board.js';
import { deliver, refused, type DeliverBranchReading } from '@plot-pm/domain';

/**
 * What the shell asks about, and the shape it gets back.
 *
 * `refusal` is the sentence `plot-deliver.sh` used to compose itself, emitted
 * verbatim by the domain so the two cannot word the same rule differently.
 */
export interface DeliverabilityAnswer {
  /** The slug asked about. */
  slug: string;
  /** The plan file the slug resolved to, or `''` when none did. */
  file: string;
  /** Whether every non-deferred branch has landed. */
  deliverable: boolean;
  /** The rule that fired, or `''` when none did. */
  reason: string;
  /** Why it fired, ready to print. `''` when nothing refused. */
  refusal: string;
  /** Non-deferred branches, all of which merged when `deliverable`. */
  merged: number;
  /** Branches the plan gave up. */
  deferred: number;
  /** Branches still outstanding — empty when `deliverable`. */
  unmerged: string[];
}

/**
 * Every branch a plan names, with whether the plan gave it up.
 *
 * Read through `plot-plan-meta.sh`, the ONE parser that owns the plan format.
 * `plot-deliver.sh` carried its own `sed`/`grep` transcription of the same job
 * until this slice; the two disagreed on
 * `docs/plans/2026-08-21-waves-name-themselves.md`, whose design prose opens a
 * `## Waves` heading before the real `## Branches` section. The script's range
 * matched the first heading and closed at the next `## `, so it read three
 * example branch names out of illustrative prose — one of them `bug/one`, from
 * inside a code fence — and never reached the section that names the plan's
 * actual work.
 *
 * @param meta the parsed plan, as `plot-plan-meta.sh` emitted it
 * @returns one reading per branch, merge state left for the host to fill
 */
const branchesOf = (
  meta: { waves: { branches: { branch: string; deferred: boolean }[] }[] },
): { branch: string; deferred: boolean }[] => {
  const seen = new Map<string, boolean>();
  for (const wave of meta.waves) {
    for (const b of wave.branches) {
      // A branch named twice is deferred only if EVERY mention defers it —
      // the same direction the script's per-line grep resolved to, and the
      // safe one: a branch still owed by any slice is outstanding work.
      seen.set(b.branch, (seen.get(b.branch) ?? true) && b.deferred);
    }
  }
  return [...seen].map(([branch, deferred]) => ({ branch, deferred }));
};

/** The PR states `plot-impl-status.sh` reports, by branch. */
const mergedBranches = (opts: BuildBoardOptions, slug: string): Set<string> => {
  const merged = new Set<string>();
  try {
    const out = execFileSync(
      'bash',
      [path.join(opts.scriptsDir, 'plot-impl-status.sh'), slug],
      { cwd: opts.repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const parsed = JSON.parse(out) as { prs?: { branch?: string; state?: string }[] };
    for (const pr of parsed.prs ?? []) {
      if (pr.branch && pr.state === 'MERGED') merged.add(pr.branch);
    }
  } catch {
    // An unreachable host answers NOT MERGED, the same direction
    // `plot-pr-merged.sh` fails in: silence is never permission to deliver.
  }
  return merged;
};

/**
 * Whether a plan's work has landed — the question `plot-deliver.sh` used to
 * answer for itself.
 *
 * The reading is adaptation and stays in the scripts: `plot-plan-meta.sh` says
 * which branches the plan names, `plot-impl-status.sh` says which the host
 * merged. The DECISION — *these branches make the plan deliverable* — is the
 * domain's `deliver` workflow, asked here with those readings as plain values.
 *
 * Scoped to the branch question on purpose. `deliver` also decides what a
 * delivery would WRITE, and repointing the script's writes at it is the slice
 * after the refusals; asking for more than the gate needs would adopt two rules
 * on a branch that promised one.
 *
 * @param opts where the estate is
 * @param slug the plan to ask about
 * @param planFile the plan's path, already resolved by the caller
 * @returns the verdict, with the domain's own refusal sentence when it refuses
 */
export const deliverabilityOf = (
  opts: BuildBoardOptions,
  slug: string,
  planFile: string,
): DeliverabilityAnswer => {
  const empty = { slug, file: planFile, merged: 0, deferred: 0, unmerged: [] as string[] };

  let meta;
  try {
    const out = execFileSync(
      'bash',
      [path.join(opts.scriptsDir, 'plot-plan-meta.sh'), planFile],
      { cwd: opts.repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    const line = out.split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) throw new Error('no output');
    meta = PlanMetaSchema.parse(JSON.parse(line));
  } catch {
    return {
      ...empty,
      deliverable: false,
      reason: 'plan-unparseable',
      refusal: `cannot parse '${planFile}' — refusing rather than guessing.`,
    };
  }

  const merged = mergedBranches(opts, slug);
  const branches: DeliverBranchReading[] = branchesOf(meta).map((b) => ({
    branch: b.branch,
    deferred: b.deferred,
    merged: merged.has(b.branch),
  }));

  // Only the branch rule is asked for. The phase is the script's own refusal
  // and stays there until the refusals slice moves it, so `approved` is passed
  // unconditionally — a phase this function invented would be a second reading
  // of a fact the caller already holds.
  const outcome = deliver(
    {
      slug,
      file: planFile,
      parsed: true,
      phase: 'approved',
      branches,
      deliveredRecord: '',
      activeLink: '',
      deliveredLink: '',
      sprint: '',
      sprintFile: '',
    },
    { on: '' },
  );

  const deferred = branches.filter((b) => b.deferred).length;
  if (refused(outcome)) {
    return {
      ...empty,
      deliverable: false,
      reason: outcome.reason,
      refusal: outcome.detail,
      deferred,
      unmerged: branches.filter((b) => !b.deferred && !b.merged).map((b) => b.branch),
    };
  }

  return {
    ...empty,
    deliverable: true,
    reason: '',
    refusal: '',
    merged: branches.length - deferred,
    deferred,
  };
};
