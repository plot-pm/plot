import {
  type ReconcileDetail,
  type ReconcileReadings,
  type ReconcileRefusal,
  type ReconcileScope,
  reconcile,
} from '@plot-pm/domain/workflows/reconcile';
import { type Decision, type Refusal, refused } from '@plot-pm/domain/workflows/decision';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `/plot-reconcile` runs, once per sweep.
 *
 * ```
 * node plot-reconcile.mjs < readings.json
 * {"outcome":"decided","detail":{"scope":{"kind":"plan","slug":"…"},"findings":[…]}}
 * ```
 *
 * **THE TENTH ACTION.** Nine lifecycle actions reach a controller through
 * `plot-ask.mjs`; reconcile ran a shell script directly, at three call sites in
 * its SKILL.md, so its reach was whatever that one script enumerated and it
 * could not be asked about a plan, a sprint and the estate as three questions.
 * `CLAUDE.md` states what that is: *"Where no controller exists, the gap is the
 * finding."*
 *
 * **ITS OWN BUNDLE, NOT A VERB ON `plot-ask.mjs`**, for the reason
 * `entry/slice-pr.ts` gives: that artifact answers `board` and `fleet` by
 * RUNNING `plot-fleet-scan.sh`, so a script asking it to reconcile would be a
 * script calling an artifact that calls a script. And the sweep is the worst
 * candidate for that — measured 2026-09-09, ~26 git call sites inside 31 loops
 * iterated over 253 plans, which is what the sweep's 279.9 s is.
 *
 * **SO THIS SPAWNS NOTHING AND READS NOTHING.** Every reading arrives on stdin,
 * taken by the shell that owns the git and host calls.
 *
 * **AND IT PERFORMS NOTHING**, which is the property the sweep already has and
 * must keep: the decision carries an empty write list at every scope, and the
 * findings name their repairs as text. There is no `--yes`. The value of a
 * sweep an operator runs casually is that running it cannot cost anything.
 */

/** What a caller asks: the readings, and the scope to answer for. */
export interface Request {
  /** What the shell measured, at the scope it was asked for. */
  readonly readings: ReconcileReadings;
  /** The plan, the sprint, or the whole workspace. */
  readonly scope: ReconcileScope;
}

/**
 * Read one string from a request.
 *
 * @param value - what the field held.
 * @returns the string, or `''` where the field was absent or not a string.
 */
const stringOr = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Read one whole number from a request.
 *
 * @param value - what the field held.
 * @returns the number, or 0 where the field was absent or not a finite number.
 */
const numberOr = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;

/**
 * Read one array from a request.
 *
 * @param value - what the field held.
 * @returns the array, or an empty one where the field was absent or not an array.
 */
const arrayOr = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/**
 * Read one object from a request.
 *
 * @param value - what the field held.
 * @returns its fields, or an empty record where the field was absent.
 */
const objectOr = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Read the scope a caller asked for.
 *
 * AN UNRECOGNISED KIND IS THE WORKSPACE, and that is the safe direction here
 * rather than a refusal: the workspace is the widest answer, so a caller whose
 * scope was misspelled gets more than it asked for instead of a narrow answer
 * it would read as *nothing has drifted*. A scope that names a plan or sprint
 * nothing holds is refused by the rule, which is the case that matters.
 *
 * @param value - the request's `scope` field.
 * @returns the scope.
 */
export const scopeFrom = (value: unknown): ReconcileScope => {
  const given = objectOr(value);
  const kind = stringOr(given.kind);
  if (kind === 'plan') return { kind: 'plan', slug: stringOr(given.slug) };
  if (kind === 'sprint') return { kind: 'sprint', slug: stringOr(given.slug) };
  return { kind: 'workspace' };
};

/**
 * Read what the shell measured of one plan.
 *
 * ABSENT IS FALSE HERE, and it is safe in this one direction: a drift the shell
 * did not measure is one it did not find, and the sweep's contract is that it
 * reports what it read. A missing slug is the caller's bug and the rule refuses
 * on it.
 *
 * @param value - one entry of the request's `plans` array.
 * @returns the plan's readings.
 */
const planFrom = (value: unknown) => {
  const given = objectOr(value);
  return {
    slug: stringOr(given.slug),
    phaseSymlinkDrift: given.phaseSymlinkDrift === true,
    mergedNotDelivered: given.mergedNotDelivered === true,
    concurrentDelivery: given.concurrentDelivery === true,
    attention: stringOr(given.attention),
    deliveredNotReleased: given.deliveredNotReleased === true,
  };
};

/**
 * Read what the shell measured of one sprint.
 *
 * @param value - one entry of the request's `sprints` array.
 * @returns the sprint's readings.
 */
const sprintFrom = (value: unknown) => {
  const given = objectOr(value);
  return {
    slug: stringOr(given.slug),
    members: arrayOr(given.members).map(stringOr),
    staleTally: arrayOr(given.staleTally).map(stringOr),
    shippedRelease: stringOr(given.shippedRelease),
  };
};

/**
 * Read what the shell measured of one local branch.
 *
 * `hasMergedPr` is read as false unless the host said true — an unreachable
 * host answers *not merged*, so silence is never permission and a degraded
 * reading cannot become a list of deletion candidates.
 *
 * @param value - one entry of the request's `branches` array.
 * @returns the branch's readings.
 */
const branchFrom = (value: unknown) => {
  const given = objectOr(value);
  return {
    branch: stringOr(given.branch),
    defaultBranch: stringOr(given.defaultBranch),
    hasMergedPr: given.hasMergedPr === true,
    checkedOut: given.checkedOut === true,
  };
};

/**
 * Read what the shell measured of one orphaned claim ref.
 *
 * A disposition that is not `abandoned` is `unresolved`, which needs judgment —
 * the direction that keeps a ref rather than offering to delete it.
 *
 * @param value - one entry of the request's `claims` array.
 * @returns the claim's readings.
 */
const claimFrom = (value: unknown) => {
  const given = objectOr(value);
  return {
    branch: stringOr(given.branch),
    isEmptyClaim: given.isEmptyClaim === true,
    disposition:
      stringOr(given.disposition) === 'abandoned' ? ('abandoned' as const) : ('unresolved' as const),
  };
};

/**
 * Read what the shell measured of one tree.
 *
 * @param value - one entry of the request's `trees` array.
 * @returns the tree's readings.
 */
const treeFrom = (value: unknown) => {
  const given = objectOr(value);
  const pid = given.workerPid;
  return {
    path: stringOr(given.path),
    branch: stringOr(given.branch),
    dirtyCount: numberOr(given.dirtyCount),
    workerPid: typeof pid === 'string' && pid !== '' ? pid : null,
    manifest: stringOr(given.manifest),
  };
};

/**
 * Read what the shell measured of one desk.
 *
 * `isDispatchTree` is read as false unless the shell said true: a tree this
 * cannot place is outside the reaper's population rather than inside it, which
 * is the refusing direction `reap.ts` chose for the same field.
 *
 * @param value - one entry of the request's `desks.candidates` array.
 * @returns the desk and what was measured of it.
 */
const candidateFrom = (value: unknown) => {
  const given = objectOr(value);
  const tree = objectOr(given.tree);
  const evidence = objectOr(given.evidence);
  return {
    tree: {
      path: stringOr(tree.path),
      branch: stringOr(tree.branch),
      detached: tree.detached === true,
      isMain: tree.isMain === true,
      clean: tree.clean === true,
      agentSession: stringOr(tree.agentSession),
      prunable: tree.prunable === true,
    },
    evidence: {
      workerAlive: evidence.workerAlive === true,
      blockedMarker: evidence.blockedMarker === true,
      hasMergedPr: evidence.hasMergedPr === true,
      isDispatchTree: evidence.isDispatchTree === true,
      manifest: stringOr(evidence.manifest),
      hasLog: evidence.hasLog === true,
    },
  };
};

/**
 * Read the readings a caller took.
 *
 * @param value - the request's `readings` object, or anything else.
 * @returns the readings, every absent field read as *nothing was found*.
 */
export const readingsFrom = (value: unknown): ReconcileReadings => {
  const given = objectOr(value);
  const desks = objectOr(given.desks);
  return {
    plans: arrayOr(given.plans).map(planFrom),
    sprints: arrayOr(given.sprints).map(sprintFrom),
    branches: arrayOr(given.branches).map(branchFrom),
    claims: arrayOr(given.claims).map(claimFrom),
    trees: arrayOr(given.trees).map(treeFrom),
    desks: {
      candidates: arrayOr(desks.candidates).map(candidateFrom),
      orphanedManifests: arrayOr(desks.orphanedManifests).map((m) => {
        const given = objectOr(m);
        return { file: stringOr(given.file), worktree: stringOr(given.worktree) };
      }),
      defaultBranch: stringOr(desks.defaultBranch),
    },
  };
};

/**
 * Parse one request.
 *
 * @param text - the whole of stdin, one JSON object.
 * @returns the request.
 * @throws when stdin is not one JSON object carrying a `readings` object.
 */
export const requestFrom = (text: string): Request => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected one JSON object on stdin');
  }
  const body = parsed as Record<string, unknown>;
  const readings = body.readings;
  if (typeof readings !== 'object' || readings === null || Array.isArray(readings)) {
    throw new Error("expected a 'readings' object — what the shell measured of the estate");
  }
  return { readings: readingsFrom(readings), scope: scopeFrom(body.scope) };
};

/**
 * Decide one reconcile.
 *
 * @param request - what the caller asked.
 * @returns the domain's answer — the findings, or the rule that refused.
 */
export const decide = (
  request: Request,
): Decision<ReconcileDetail> | Refusal<ReconcileRefusal> =>
  reconcile(request.readings, request.scope);

/**
 * Read stdin, print the answer.
 *
 * Three exit codes, because the caller repairs them differently. A refusal is
 * the scope's own state and the operator reads the sentence; unreadable input
 * is the caller's bug and no operator can act on it.
 *
 * **FINDINGS ARE NOT A REFUSAL.** A sweep that found drift exits 0 — the drift
 * is the answer it was asked for, and `/plot-reconcile` reports rather than
 * gates. The caller counts `detail.blocking` where it needs a gate, which is
 * what `/plot-deliver` does with the blocking sections.
 *
 * @param text - the whole of stdin.
 * @param write - where the answer goes.
 * @returns the process exit code — 0 answered, 1 refused, 2 unreadable input.
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  let request: Request;
  try {
    request = requestFrom(text);
  } catch (err) {
    process.stderr.write(`plot-reconcile: ${(err as Error).message}\n`);
    return 2;
  }
  const result = decide(request);
  write(`${JSON.stringify(result)}\n`);
  if (refused(result)) {
    process.stderr.write(`${result.reason}\t${result.detail}\n`);
    return 1;
  }
  return 0;
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
//
// AND NO ENTRY IN THIS DIRECTORY IMPORTS ANOTHER, which `entry/stack-readings.ts`
// states: in one bundle both spellings resolve to the bundle's own path, so an
// imported entry's main block matches too and runs FIRST.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
