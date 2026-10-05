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
}

/**
 * Applies the loop's decided writes, in order, through the ports given.
 *
 * **THE `switch` IS EXHAUSTIVE OVER {@link LoopWrite}, NOT OVER {@link Write}.**
 * Its last arm asserts `never`, so a kind added to `agentLoop`'s own emissions
 * without a matching arm here fails `tsc` — never a runtime `default` that
 * silently drops it.
 *
 * **ORDER IS THE CALLER'S CONTRACT, NOT THIS FUNCTION'S TO ENFORCE.**
 * `agentLoop` already orders its `writes` array so that, for instance,
 * `declaration` and `loop-end` land in the sequence `supervise` depends on;
 * this applies them in the order given and does not reorder, dedupe or skip
 * one because an earlier one failed — each write is independent of the others'
 * outcome, matching the shell's own best-effort functions.
 *
 * **`agent-attempt` AND `correction-count` CARRY THE NEW VALUE, NEVER AN
 * INCREMENT.** Both arms write exactly the number the decision already
 * computed, so applying either twice lands the same number — the property
 * `workflows/decision.ts` documents on both write kinds.
 *
 * **`commit` AND `push` CARRY NO WORKTREE**, unlike every other write kind
 * here — `CommitWrite` and `PushWrite` are shared across every workflow that
 * emits them (`approve`, `deliver`, `dispatch`, `release`, and this loop), none
 * of which name a desk because each already operates on one checkout it knows
 * externally. For the loop that checkout is always the desk the pass is
 * running in, so it travels as `worktree` here rather than being invented from
 * a write that was never given one.
 *
 * @param writes - the decision's writes, in application order.
 * @param ports - where each write kind lands.
 * @param worktree - the desk this pass is running in, absolute — the checkout
 *   `commit` and `push` act on.
 * @returns what each write answered, in the same order.
 */
export const performLoopWrites = async (
  writes: readonly LoopWrite[],
  ports: LoopWritePorts,
  worktree: string,
): Promise<readonly AppliedWrite[]> => {
  const out: AppliedWrite[] = [];
  for (const write of writes) {
    out.push({ write, result: await applyOne(write, ports, worktree) });
  }
  return out;
};

/**
 * Applies one write.
 *
 * @param write - the write to apply.
 * @param ports - where it lands.
 * @param worktree - the desk this pass is running in, for `commit` and `push`.
 * @returns what the port answered.
 */
const applyOne = async (
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
      return ports.desk.publishFinding(write.worktree, write.finding);

    /* v8 ignore next 2 -- unreachable by construction: every `LoopWrite` kind
       has its own case above, so this only fires if a kind is ADDED to the
       type with no matching arm — which fails `tsc` on `write satisfies
       never` before it ever runs. */
    default:
      return write satisfies never;
  }
};
