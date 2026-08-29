import type { FleetPulse } from '../entities/fleet.js';

/**
 * The join key this rule needs from a plan — its file path, and nothing else.
 *
 * NOT `PlanMeta`. That type is the BOARD's plan contract (`contract/schema.ts`)
 * and it stays there: it carries phase, sprint, story, assignee, PR numbers and
 * transition records, none of which this rule reads. The domain cannot import
 * it in any case — the module resolver refuses, which is the whole point of the
 * package boundary.
 *
 * Structural typing makes the narrowing free at every call site: a `PlanMeta`
 * already satisfies this, so the board passes one unchanged and no caller casts.
 * The parameter now names exactly what the rule reads, which is the honest
 * signature — the previous one claimed a dependency on thirty fields to use one.
 */
export interface PlanFile {
  /** The plan's path as the parser emitted it; joined on its basename below. */
  file: string;
}

/**
 * `path.basename`, inlined, because the domain may not import `node:path`.
 *
 * THE PURITY GATE IS A GREP, not a semantic analysis:
 *
 *     grep -rlE "from '(node:|fs|child_process|http|https|net)" packages/domain/src/
 *
 * `node:path` would fail it. The plan calls this rule "already pure" and it very
 * nearly is — `basename` touches no disk — but a gate that admits `node:path`
 * *because this one call is harmless* is a gate with a judgement call in it, and
 * the next import through that door will not be `basename`. Reproducing eight
 * lines of string arithmetic is the cheaper side of that trade.
 *
 * Behaviour matches `path.basename` on POSIX inputs INCLUDING the trailing-slash
 * case (`'docs/plans/'` → `'plans'`), which a bare `slice(lastIndexOf('/') + 1)`
 * gets wrong. A plan file path never has a trailing slash, so that branch is
 * unreachable in practice — it is here so the move is provably equivalent on all
 * inputs rather than only on the expected ones.
 */
function basename(file: string): string {
  let end = file.length;
  while (end > 0 && file[end - 1] === '/') end--;
  if (end === 0) return '';
  return file.slice(file.lastIndexOf('/', end - 1) + 1, end);
}

/**
 * Whether every one of a plan's non-deferred branches has landed — the checkable
 * input that lets a plan reach the phase after Development on its own.
 *
 * *Every wave being complete is a measurement; delivering is a decision*
 * (`docs/board-domain-model.md`). This is that measurement, and only that: it
 * asserts the code has landed, which git already knows, and nothing more. The
 * board never flips a phase to `delivered` from it — see `buildBoard`, which
 * moves the CARD's column and writes no record.
 *
 * THREE ANSWERS, NOT TWO, and the third is why this stopped returning a boolean.
 * `unknown` is *the scan did not finish, so nothing here is a measurement of
 * anything*; `not-merged` is *the work has not landed*. Those need opposite
 * responses from a reader — wait and retry, versus go finish the branch — and
 * one `false` cannot carry both. It did until 2026-08-27, when an operator was
 * told a plan whose two PRs had merged the day before had a branch that was not
 * merged: the scan had timed out, the lookup below missed, and `false` was read
 * as the negative rather than as the absence it actually was.
 *
 * `complete` is the SCAN's completeness — `entry.pulseComplete`, true only once
 * the scan's terminal line lands. It is passed in rather than read off the pulse
 * because a `FleetPulse` cannot carry it: a partial pulse is assembled by
 * `publishPartial`, which composes the plans that have arrived over the ones
 * still on screen and sets the flag BESIDE the pulse, on the cache entry.
 *
 * Merge state is read from the PULSE, never the plan file: a `merged` branch is
 * one the scan resolved against `origin/<main>`, which is the same derivation
 * `plot-fleet-scan.sh` applies when it prints `merged_not_delivered`. Reusing it
 * rather than rebuilding it is the whole point — the plan file carries no merge
 * record, and inventing one here would answer a different question than the scan.
 *
 * It reads the wave's own `verdict` rather than re-deriving completeness from
 * the branch states beneath it. The scan already decided that question and the
 * pulse already carries the answer; deciding it twice is the second
 * implementation this repo keeps removing. The branch states are still read for
 * the one thing the verdict cannot express — see the `merged > 0` guard below.
 *
 * A deferred branch is exempt, matching the scan's own rule: a shelved branch is
 * not outstanding work, so a plan holding six merged and three deferred branches
 * (measured on the Testing plans) is as complete as one holding nine merged.
 *
 * Returns `unknown` — nothing is asserted, and a caller must say so rather than
 * refuse — in two cases:
 *  - the scan did not finish (`complete` false). Its `plans` array holds only
 *    what arrived before the timeout, so a missing plan means UNREACHED, not
 *    absent, and no negative may be read from it.
 *  - no pulse at all: git has said nothing, and "nothing said" is not "all
 *    merged". A cold cache keeps a plan where it was.
 *
 * Returns `not-merged` — the plan stays in Development — in three:
 *  - a COMPLETE scan does not know this plan: it looked and did not find it,
 *    which is a real absence rather than an unfinished read.
 *  - any non-deferred wave is not `complete`: one unfinished wave and the work
 *    is not done, which is the negative the plan insists be asserted directly.
 *  - the plan has NO non-deferred branch (all deferred, or none at all): there
 *    is no landed work to testify to, so "every wave complete" is vacuously true
 *    and substantively false. The explicit `merged > 0` guard is what stops the
 *    empty reduction from promoting a plan nobody built, and it is the reason
 *    the branches are still walked at all.
 */
export type Landed = 'merged' | 'not-merged' | 'unknown';

export function allWavesMerged(
  meta: PlanFile,
  pulse: FleetPulse | null,
  complete: boolean,
): Landed {
  // ASKED BEFORE THE LOOKUP, because the lookup cannot tell the two apart. On a
  // partial pulse an absent plan is one the scan has not reached yet, and the
  // measured shape of this defect was exactly that: a plan missing from a
  // `plans` array the timeout left empty, read as a claim about its branches.
  if (!pulse || !complete) return 'unknown';
  const plan = pulse.plans.find((p) => p.file === basename(meta.file));
  // A COMPLETE scan that does not name this plan HAS looked. That is a real
  // absence, unlike the one above, and the plan stays where it is.
  if (!plan) return 'not-merged';
  let merged = 0;
  for (const wave of plan.waves) {
    // A wave of only deferred branches is not outstanding work — the scan's own
    // rule — and it contributes nothing to the `merged > 0` count either.
    const branches = wave.branches.filter((b) => b.state !== 'deferred');
    if (branches.length === 0) continue;
    // THE SCAN'S VERDICT, not a second reading of the branch states under it.
    if (wave.verdict !== 'complete') return 'not-merged';
    merged += branches.length;
  }
  // Vacuous truth caught: every wave complete over no branches at all is a plan
  // nobody built, and it must not be promoted.
  return merged > 0 ? 'merged' : 'not-merged';
}
