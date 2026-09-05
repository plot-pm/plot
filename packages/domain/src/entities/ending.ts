import { z } from 'zod';

/**
 * The file a worker leaves in its worktree naming why it ended.
 *
 * One per WORKER, not one per branch — which is the opposite of
 * {@link DECLARATION_FILENAME} and for the reason that separates them: a
 * declaration is about a branch a worker finished, and a worker hops, so it may
 * write several. An ending happens once, to the worker, and the branch it was
 * holding at the time is a field rather than the subject.
 *
 * It joins the family `.plot-worker.exit`, `.plot-worker.pid`,
 * `.plot-worker.log` and `.plot-worker.monitor.*.jsonl` already establish.
 */
export const ENDING_FILENAME = '.plot-worker.ending.json';

/**
 * Why a worker stopped.
 *
 * FOUR REASONS, AND `bound` IS NOT THE OTHERS. Until this record existed a
 * worker ended for two reasons and both were time — the bound expired or the
 * monitor reported idle — so an operator reading a desk could not tell a clock
 * from a finding.
 *
 * - `bound` — the wall clock ran out. It says only that time passed, and the
 *   floor fires precisely when nothing else could say why.
 * - `quiet` — the WorkerMonitor found the agent idle: alive, committed, its
 *   transcript silent past the window with nothing burning CPU behind it,
 *   across two passes. A verdict rather than an alarm.
 * - `unreadable` — the bound ended it and no transcript could be read, so
 *   nothing distinguished a thinking agent from a stopped one. The reason is an
 *   ABSENCE of a reading, which is an adopter's `.plot/worker-prompt.sh` to fix
 *   rather than an agent's fault.
 * - `spent` — the agent's context ran out. Nothing is wrong with it; it simply
 *   should not be handed another slice.
 *
 * `unreadable` IS KEPT APART FROM `bound` DELIBERATELY. Both are the floor
 * firing, and they differ in what was known WHILE the worker ran rather than in
 * what stopped it — collapsing them claims a measurement was made and came back
 * empty, when Plot never had the reading at all.
 */
export const EndingReasonSchema = z.enum(['bound', 'quiet', 'unreadable', 'spent']);
export type EndingReason = z.infer<typeof EndingReasonSchema>;

/**
 * Who ended the worker.
 *
 * The reason says WHY; the actor says which party acted, and they do not
 * determine each other. The floor ends a worker for `bound` and for
 * `unreadable` alike; the monitor ends one it found `quiet` and one it found
 * `spent`.
 *
 * - `bound` — the wall-clock watchdog.
 * - `monitor` — the WorkerMonitor.
 *
 * **TWO ACTORS, AND THE AGENT IS NOT ONE.** A third value `agent` was admitted
 * here and documented as *"the agent stopped itself"*. Nothing ever wrote it:
 * `plot-worker-loop.sh` makes three `write_ending` calls and passes `monitor`
 * and `bound` only. The agent's PROCESS runs `exit 124` at `:1296`, but the
 * party that ACTED is the watchdog that fired or the monitor that found it
 * idle — which is what the loop's own comment at `:1284` already says: *"The
 * actor is the bound either way."*
 *
 * So the value is removed rather than left admitted and unreachable, and
 * `transitions/agent.ts` states the rule that keeps it out: an ending naming
 * `agent` is an agent claiming it decided its own stop, which the design gives
 * no party for. The refusal reads a STRING rather than this type, because an
 * ending file on a desk is bytes until something validates them.
 */
export const EndingActorSchema = z.enum(['bound', 'monitor']);
export type EndingActor = z.infer<typeof EndingActorSchema>;

/**
 * The ending record's wire form.
 *
 * `reason` and `actor` are required — a record naming neither has said nothing.
 * `branch` and `detail` are what the worker knew at the time and default to
 * empty: a worker ended before it claimed anything holds no branch, and that is
 * an absence rather than a malformed record.
 *
 * Unknown keys are dropped rather than refused, the same choice
 * {@link DeclarationSchema} makes: a newer worker writing a field this parse
 * does not know has not written a broken record.
 */
export const EndingSchema = z.object({
  reason: EndingReasonSchema,
  actor: EndingActorSchema,
  branch: z.string().default(''),
  detail: z.string().default(''),
});

/**
 * One worker's account of why it stopped.
 *
 * Identity: the worktree it was written in. Recorded rather than inferred —
 * `_ended_detail` was set at three points in `plot-worker-loop.sh` and written
 * nowhere, so the distinction it drew existed for the length of one stderr line
 * and reached no reader that outlived the process.
 */
export interface Ending {
  /** Why the worker stopped. */
  reason: EndingReason;
  /** Which party ended it. */
  actor: EndingActor;
  /** The branch it held when it ended; `''` when it held none. */
  branch: string;
  /** One sentence naming the reading; `''` when none was written. */
  detail: string;
}

/**
 * The outcome of asking a desk why its worker ended.
 *
 * THREE OUTCOMES, AND THE LAST TWO ARE NOT ONE — {@link DeclarationReading}'s
 * split, applied to the same shape of question. `absent` is a desk whose worker
 * never recorded an ending: it was SIGKILLed, or it predates this record, and
 * either way nobody measured anything. `unreadable` is a file that exists and
 * does not parse, so something was written and cannot be believed.
 *
 * Reporting `unreadable` as `absent` would claim nothing was written; reporting
 * it as an ending would believe bytes nobody validated. *Cannot answer* is not
 * *no*.
 */
export type EndingReading =
  | { read: 'ended'; ending: Ending }
  | { read: 'absent' }
  | { read: 'unreadable'; why: string };

/**
 * Reads an ending from the text of one desk's file.
 *
 * Takes the text rather than a path: the domain does not touch the disk, so the
 * caller decides what it read and this decides what it means. `null` is how a
 * caller says the file was not there — an empty string is a file that exists
 * and holds nothing, which is unreadable rather than absent.
 *
 * @param text - the file's contents, or null when there is no file.
 * @returns why the worker ended, or why that could not be read.
 */
export const readEnding = (text: string | null): EndingReading => {
  if (text === null) return { read: 'absent' };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { read: 'unreadable', why: 'not JSON' };
  }

  const parsed = EndingSchema.safeParse(json);
  if (!parsed.success) {
    return { read: 'unreadable', why: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  return { read: 'ended', ending: { ...parsed.data } };
};

/**
 * Whether an ending was decided by a reading rather than by a clock.
 *
 * `quiet` and `spent` are findings: something was measured about the agent and
 * the measurement is what ended it. `bound` and `unreadable` are the floor —
 * time passed, and in the second case nothing could be read at all.
 *
 * This is the distinction the plan asserts and the estate could not draw: a
 * bound expiry and a context exhaustion are different endings.
 *
 * @param reading - what the desk was read as.
 * @returns true only for an ending a measurement produced.
 */
export const endedOnAReading = (reading: EndingReading): boolean =>
  reading.read === 'ended' && (reading.ending.reason === 'quiet' || reading.ending.reason === 'spent');

/**
 * Whether an agent ended because it had nothing left to spend.
 *
 * `spent` is not a failure and not a stall — an agent at its context ceiling
 * finished what it was doing and should not be handed another slice. It is kept
 * apart from every other reason so an operator can tell *this agent is done*
 * from *no work is available*, which is the distinction `--why-nothing` exists
 * to draw.
 *
 * @param reading - what the desk was read as.
 * @returns true only for an ending whose reason is `spent`.
 */
export const endedSpent = (reading: EndingReading): boolean =>
  reading.read === 'ended' && reading.ending.reason === 'spent';
