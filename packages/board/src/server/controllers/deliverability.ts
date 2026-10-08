import { deliver, refused, type DeliverBranchReading } from '@plot-pm/domain';
import type { Host, PlanStore, Refs } from '@plot-pm/domain';
import { mergedRowByHead } from '@plot-pm/domain/rules/merged-row';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';

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
  /**
   * Branches whose merged PR carried no implementation.
   *
   * A FINDING, NOT A REFUSAL. `deliverable` stays true beside a non-empty list:
   * the caller prints it and delivers. See the domain's `emptySlices`.
   */
  emptySlices: string[];
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

/** How one branch's merge state resolved. */
type BranchMergeState = 'merged' | 'not-merged' | 'unknown';

/**
 * Which of these branches merged, the store asked first and the host asked
 * only for what it could not answer.
 *
 * THE STORE NEVER SAYS NO. A branch with no row, a row that is not a terminal
 * `MERGED`, or no store at all all mean *ask the host* — never *not merged* —
 * which is `PrIndexStore`'s own contract and *A Decision Reads The Index* in
 * `CLAUDE.md`. Only a branch the store answers from a `MERGED` row costs no
 * host call; every other branch asks `Host.prMerged`, ONE CALL PER BRANCH,
 * because that port is the question the domain already owns and a controller
 * may not spawn to answer it itself.
 *
 * `unknown` is reported rather than folded into `not-merged` — the defect
 * `deliverabilityOf` exists to fix: silence from the host is not permission to
 * refuse a delivery as unmerged, it is a reason to refuse as `cannot-tell`.
 *
 * @param ports - the store to read first, and the host to ask for the rest.
 * @param connector - which connector's store to read (the host's own backend word).
 * @param branches - the plan's branch names.
 * @returns one state per branch, in the same order.
 */
const mergedBranches = async (
  ports: { host: Host; prIndex: PrIndexStore },
  connector: string,
  branches: readonly string[],
): Promise<Map<string, BranchMergeState>> => {
  const read = await ports.prIndex.read(connector);
  const held = read.ok ? read.value : null;

  const states = new Map<string, BranchMergeState>();
  for (const branch of branches) {
    if (held !== null && mergedRowByHead(held, branch) !== undefined) {
      states.set(branch, 'merged');
      continue;
    }
    const answer = await ports.host.prMerged(branch);
    if (!answer.ok) states.set(branch, 'unknown');
    else states.set(branch, answer.value);
  }
  return states;
};

/**
 * Whether a merged branch's PR carried anything but a marker or a claim.
 *
 * THE MERGE COMMIT, NOT THE BRANCH. A squash-merged branch loses its ref, so
 * `origin/main...branch` cannot run for the population this is asked about —
 * measured on both slices that shipped empty. The host names the commit and git
 * reads it.
 *
 * TWO EXCLUSIONS AND NO OTHERS. `PLOT-BLOCKED*` is a worker's question to a
 * person rather than work, and the claim commit is empty so it contributes no
 * path — the same pair `plot-reconcile-scan.sh`'s section 17 excludes when it
 * asks whether a branch holds work. A documentation-only PR carried work: it is
 * a slice that wrote documentation.
 *
 * `unknown` WHERE EITHER READING FAILED, and never `false`. A host that could
 * not name the commit, and a commit git could not read, are both *cannot
 * verify*.
 *
 * @param ports - the host that names the merge commit, and the refs that read it
 * @param branch - the merged branch to ask about
 * @returns whether it carried work, or `'unknown'` where that could not be read
 */
const carriedWorkOf = async (
  ports: { host: Host; refs: Refs },
  branch: string,
): Promise<boolean | 'unknown'> => {
  const sha = await ports.host.prMergeCommit(branch);
  if (!sha.ok) return 'unknown';
  // NO MERGE COMMIT IS NOT NO WORK. The host answered that it holds no merged
  // PR for this name, while `prMerged` said the branch merged — the two
  // disagree, and a disagreement is exactly what `unknown` is for.
  if (sha.value === '') return 'unknown';

  const files = await ports.refs.commitFiles(sha.value);
  if (!files.ok) return 'unknown';
  return files.value.some((path) => !isMarker(path));
};

/**
 * Whether a path is a blocked marker rather than work.
 *
 * `PLOT-BLOCKED*` at the repository root, the spelling the fleet scan looks for
 * and the worker writes.
 *
 * @param path - a path a commit changed, relative to the repository root
 * @returns true where the path is a marker
 */
const isMarker = (path: string): boolean => path.startsWith('PLOT-BLOCKED');

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
  /** Answers whether the host merged a branch, for what the store cannot. */
  host: Host;
  /** Reads what a merge commit changed. */
  refs: Refs;
  /** The checkout's record of what the host last said about its PRs. */
  prIndex: PrIndexStore;
}

export const deliverabilityOf = async (
  ports: DeliverabilityPorts,
  slug: string,
  planFile: string,
): Promise<DeliverabilityAnswer> => {
  const empty = {
    slug,
    file: planFile,
    merged: 0,
    deferred: 0,
    unmerged: [] as string[],
    emptySlices: [] as string[],
  };

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
  // THE CONNECTOR IS THE HOST'S OWN WORD, the same string `pr-index-lookup.ts`
  // takes — `pr-index-file`'s store is kept one file per connector, and asking
  // under the wrong name would read (or write) a different host's rows.
  const backend = await ports.host.backend();
  const connector = backend.ok ? backend.value : 'github';
  // A DEFERRED BRANCH IS NOT ASKED. It is silent by rule, so its merge state
  // decides nothing, and asking it could only spend a host call or turn an
  // `unknown` into a `cannot-tell` refusal for a branch delivery ignores.
  const merged = await mergedBranches(
    { host: ports.host, prIndex: ports.prIndex },
    connector,
    named.filter((b) => !b.deferred).map((b) => b.branch),
  );

  // A HOST THAT COULD NOT ANSWER REFUSES AS `cannot-tell`, NEVER AS UNMERGED.
  // Produced here, before `deliver` is asked, rather than inside the domain's
  // `DeliverRefusal` union: the workflow's branch reading is a plain boolean
  // and `allSlicesConfirmed`'s three-way mapping in `rules/deliverable.ts`
  // stays untouched either way, so the narrower change is the one this
  // controller can make alone.
  const unresolved = named.filter((b) => merged.get(b.branch) === 'unknown');
  if (unresolved.length > 0) {
    const confirmed = named.filter((b) => merged.get(b.branch) === 'merged').length;
    const names = unresolved.map((b) => b.branch).join(', ');
    return {
      ...empty,
      deliverable: false,
      reason: 'cannot-tell',
      refusal: `cannot tell whether ${unresolved.length} branch(es) merged: ${names}. The host did not answer — try again rather than treating silence as unmerged.`,
      merged: confirmed,
    };
  }

  const branches: DeliverBranchReading[] = [];
  for (const b of named) {
    const didMerge = merged.get(b.branch) === 'merged';
    // ASKED ONLY WHERE IT COULD REPORT. A deferred branch is silent by rule and
    // an unmerged one refuses the delivery outright, so neither is worth a host
    // call — which is what keeps this inside the per-branch budget delivery
    // already spends.
    const carriedWork = didMerge && !b.deferred
      ? await carriedWorkOf(ports, b.branch)
      : 'unknown';
    branches.push({ branch: b.branch, deferred: b.deferred, merged: didMerge, carriedWork });
  }

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
    // THE FINDING RIDES OUT WITH A SUCCESSFUL VERDICT, which is what makes it a
    // report rather than a gate: `deliverable` is true beside it.
    emptySlices: [...outcome.detail.emptySlices],
  };
};
