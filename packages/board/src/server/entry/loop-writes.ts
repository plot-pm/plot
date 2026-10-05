import type {
  Agents,
  BoundedRun,
  Desk,
  PortResult,
  Processes,
  Refs,
  Trees,
  Write,
} from '@plot-pm/domain';

/**
 * The loop's own subset of {@link Write} — exactly the kinds `agentLoop`
 * (`workflows/agent-loop.ts`) emits, derived by grepping that file's own
 * `kind: '...'` literals. The `Write` union also carries the plan, sprint and
 * fleet kinds, and a loop applier has no business with them: the `switch`
 * below is typed over this subset so a kind neither here nor handled fails
 * `tsc` rather than falling through a runtime `default`.
 */
export type LoopWrite = Extract<
  Write,
  {
    kind:
      | 'desk-reset'
      | 'commit'
      | 'push'
      | 'prompt-run'
      | 'agent-attempt'
      | 'agent-resume'
      | 'correction-count'
      | 'blocked-marker'
      | 'declaration'
      | 'slice-spend'
      | 'assignment-clear'
      | 'loop-end'
      | 'worker-finding';
  }
>;

/** The ports {@link performLoopWrites} applies writes through. */
export interface LoopWritePorts {
  trees: Trees;
  agents: Agents;
  desk: Desk;
  refs: Refs;
  processes: Processes;
  boundedRun: BoundedRun;
}

/** What one applied write answered, paired with the write it came from. */
export interface AppliedWrite {
  write: LoopWrite;
  result: PortResult<void>;
  /** Why the applier itself refused the write, where it did; absent when the port answered. */
  reason?: string;
}

/**
 * The take-up sequence `agentLoop` emits at row 4. Each write needs the one
 * before it: a claim commit on a desk whose reset failed claims the wrong
 * tree, and a prompt on a branch whose claim push failed runs unclaimed.
 */
const TAKE_UP: ReadonlySet<LoopWrite['kind']> = new Set(['desk-reset', 'commit', 'push', 'prompt-run']);

/**
 * Applies the loop's decided writes, in order, through the ports given.
 *
 * **THE `switch` IS EXHAUSTIVE OVER {@link LoopWrite}, NOT OVER {@link Write}.**
 * Its last arm asserts `never`, so a kind added to `agentLoop`'s own emissions
 * without a matching arm here fails `tsc` — never a runtime `default` that
 * silently drops it.
 *
 * **WRITES APPLY IN THE ORDER GIVEN.** This function does not reorder or
 * dedupe them.
 *
 * **A FAILED TAKE-UP WRITE STOPS THE PASS.** When a `desk-reset`, `commit`,
 * `push` or `prompt-run` write fails, no later write is applied, and the
 * failed write is the last entry of the result. Every other write kind is
 * independent of the others' outcome: a failed `declaration` still lets the
 * `loop-end` after it land.
 *
 * **`agent-attempt` AND `correction-count` CARRY THE NEW VALUE, NEVER AN
 * INCREMENT.** Both arms write exactly the number the decision already
 * computed, so applying either twice lands the same number — the property
 * `workflows/decision.ts` documents on both write kinds.
 *
 * **`commit` AND `push` CARRY NO WORKTREE.** They act on `worktree`, the desk
 * the pass runs in. A `commit` with empty `paths` is the claim commit, an
 * empty commit in that desk. A `commit` with non-empty `paths` answers
 * `failed` with a reason and stages nothing: no loop write stages paths.
 *
 * @param writes - the decision's writes, in application order.
 * @param ports - where each write kind lands.
 * @param worktree - the desk this pass is running in, absolute — the checkout
 *   `commit` and `push` act on.
 * @returns what each applied write answered, in the same order; shorter
 *   than `writes` when a take-up write failed.
 */
export const performLoopWrites = async (
  writes: readonly LoopWrite[],
  ports: LoopWritePorts,
  worktree: string,
): Promise<readonly AppliedWrite[]> => {
  const out: AppliedWrite[] = [];
  for (const write of writes) {
    const applied = await applyOne(write, ports, worktree);
    out.push(applied);
    if (!applied.result.ok && TAKE_UP.has(write.kind)) break;
  }
  return out;
};

/**
 * Applies one write and pairs the answer with it.
 *
 * @param write - the write to apply.
 * @param ports - where it lands.
 * @param worktree - the desk this pass is running in, for `commit` and `push`.
 * @returns the write, what the port answered, and the applier's own reason
 *   where it refused the write.
 */
const applyOne = async (write: LoopWrite, ports: LoopWritePorts, worktree: string): Promise<AppliedWrite> => {
  if (write.kind === 'commit' && write.paths.length > 0) {
    return {
      write,
      result: { ok: false, why: 'failed' },
      reason: `a loop commit stages no paths; refused ${write.paths.length} path(s)`,
    };
  }
  return { write, result: await landOne(write, ports, worktree) };
};

/**
 * Lands one write on its port.
 *
 * @param write - the write to land.
 * @param ports - where it lands.
 * @param worktree - the desk this pass is running in, for `commit` and `push`.
 * @returns what the port answered.
 */
const landOne = async (
  write: LoopWrite,
  ports: LoopWritePorts,
  worktree: string,
): Promise<PortResult<void>> => {
  switch (write.kind) {
    case 'desk-reset':
      return ports.trees.resetOnto(write.worktree, write.branch, write.base);

    case 'commit':
      return ports.trees.commit(worktree, write.message);

    case 'push':
      return ports.trees.push(worktree, write.branch);

    case 'prompt-run':
      // A RECORD, NOT AN INVOCATION. Running the prompt is `boundedRun`'s, and
      // it is called directly by the worker-loop entry (slice 3) rather than
      // through this applier — `performLoopWrites` only records that a first
      // prompt ran. There is no port operation this write lands on beyond that
      // fact, so it is reported as having happened and never dispatches a run.
      return { ok: true, value: undefined };

    case 'agent-attempt':
      return ports.agents.raiseAttempts(write.worktree, write.attempts);

    case 'agent-resume':
      // RUNNING THE RESUMED PROMPT IS `boundedRun`'S, called by the worker-loop
      // entry, matching `prompt-run`'s own division above.
      return { ok: true, value: undefined };

    case 'correction-count':
      return ports.agents.raiseCorrections(write.worktree, write.correctionAttempts);

    case 'blocked-marker':
      return ports.desk.writeBlockedMarker(write.worktree, write.question);

    case 'declaration':
      return ports.desk.sealDeclaration(write.worktree, write.branch);

    case 'slice-spend':
      // ALREADY A PORT OF ITS OWN. `record_slice_spend` asks
      // `workflows/slice-spend.ts` through the `slice-spend` port, which this
      // applier does not duplicate — it is out of this slice's scope per the
      // brief, and the caller composes it separately.
      return { ok: true, value: undefined };

    case 'assignment-clear':
      return ports.agents.clearAssignment(write.session);

    case 'loop-end':
      return ports.desk.writeEnding(write.worktree, {
        reason: write.reason,
        actor: write.actor,
        branch: write.branch,
        detail: write.detail,
      });

    case 'worker-finding':
      return ports.desk.publishFinding(write.worktree, {
        branch: write.branch,
        finding: write.finding,
        since: write.since,
        evidence: write.evidence,
      });

    /* v8 ignore next 2 -- unreachable by construction: every `LoopWrite` kind
       has its own case above, so this only fires if a kind is ADDED to the
       type with no matching arm — which fails `tsc` on `write satisfies
       never` before it ever runs. */
    default:
      return write satisfies never;
  }
};
