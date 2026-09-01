import { deliver, refused, type DeliverBranchReading } from '@plot-pm/domain';
import type { Host, PlanStore } from '@plot-pm/domain';

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
  plan: { slices: readonly { branches: readonly { branch: string; deferred: boolean }[] }[] },
): { branch: string; deferred: boolean }[] => {
  const seen = new Map<string, boolean>();
  for (const slice of plan.slices) {
    for (const b of slice.branches) {
      // A branch named twice is deferred only if EVERY mention defers it —
      // the same direction the script's per-line grep resolved to, and the
      // safe one: a branch still owed by any slice is outstanding work.
      seen.set(b.branch, (seen.get(b.branch) ?? true) && b.deferred);
    }
  }
  return [...seen].map(([branch, deferred]) => ({ branch, deferred }));
};

/**
 * Which of these branches the host says merged, asked through the port.
 *
 * ONE CALL PER BRANCH, because `Host.prMerged` is the question the domain
 * already owns: it reads the merge timestamp rather than the state (a merged PR
 * reports `CLOSED`) and asks about every PR on the branch rather than the
 * newest. `plot-impl-status.sh` answered the same question for a whole slug in
 * one process, and trading that for N calls is deliberate — a controller may
 * not spawn, and the adapter behind this port is the only thing that may.
 *
 * `unknown` counts as NOT merged, the direction `plot-pr-merged.sh` fails in:
 * silence is never permission to deliver.
 */
const mergedBranches = async (
  host: Host,
  branches: readonly string[],
): Promise<Set<string>> => {
  const merged = new Set<string>();
  for (const branch of branches) {
    const answer = await host.prMerged(branch);
    if (answer.ok && answer.value === 'merged') merged.add(branch);
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
/** The readings this controller needs, each behind its own port. */
export interface DeliverabilityPorts {
  /** Reads the plan — which branches it names, and which it gave up. */
  planStore: PlanStore;
  /** Answers whether the host merged a branch. */
  host: Host;
}

export const deliverabilityOf = async (
  ports: DeliverabilityPorts,
  slug: string,
  planFile: string,
): Promise<DeliverabilityAnswer> => {
  const empty = { slug, file: planFile, merged: 0, deferred: 0, unmerged: [] as string[] };

  // THE CONTROLLER ASKS PORTS AND NEVER SPAWNS. It ran `plot-plan-meta.sh` and
  // `plot-impl-status.sh` itself until 2026-09-01, which is the layering rule
  // inverted: a controller calls the domain, an adapter calls the script, and
  // only an adapter may. Both readings already had ports — `PlanStore.readPlan`
  // and `Host.prMerged` — so nothing was designed here, only rewired.
  //
  // Awaiting is what that costs, and it is why this function is async: every
  // port method returns a Promise because the world is slow, and a controller
  // that could not wait would be one that had to reach the world itself.
  const read = await ports.planStore.readPlan(planFile);
  if (!read.ok) {
    return {
      ...empty,
      deliverable: false,
      reason: 'plan-unparseable',
      refusal: `cannot parse '${planFile}' — refusing rather than guessing.`,
    };
  }
  const plan = read.value;

  const named = branchesOf(plan);
  const merged = await mergedBranches(ports.host, named.map((b) => b.branch));
  const branches: DeliverBranchReading[] = named.map((b) => ({
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
