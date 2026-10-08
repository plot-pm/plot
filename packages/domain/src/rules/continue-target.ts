import type { DeskManifest } from './desk-manifest.js';
import type { DeskLoop } from './desk-loop-alive.js';
import type { EndingReading } from '../entities/ending.js';

/** A pid the route must stop before it resolves the manifest. */
export interface StopFirst {
  /** The pid `deskLoopAlive` named for this desk — the one to signal, and no other. */
  readonly pid: string;
}

/**
 * Which desk a continuation's answer goes to, and what blocks it.
 *
 * `/api/continue` used to ask only {@link DeskManifest}: a manifest names the
 * desk, or it does not. A loop that ends writes `.plot-worker.ending.json` and
 * removes its own manifest, so a desk whose question is still unanswered can
 * be left with no manifest and no live loop — the manifest answers `unnamed`
 * and the route refused `no-manifest`, with nothing left that could deliver
 * the answer.
 *
 * This rule adds the desk's ending record as a FALLBACK, read only when the
 * manifest names nobody: a `blocked` ending for the asked branch, with an
 * unanswered marker still in the tree, is a desk whose own record says it is
 * waiting for exactly this. The fallback never substitutes for the manifest
 * when one exists, and it never fires for `several` — two manifests on one
 * desk stay an estate defect, not a case the ending record resolves.
 *
 * A live loop still refuses `loop-alive` by default — a stop can land
 * mid-turn. The one exception is a loop that recorded its OWN pid as
 * waiting free: no branch assigned, asleep in its poll loop, holding no
 * turn to lose. For that pid alone, {@link ContinueTarget} carries a
 * `stop` the route must act on before it writes anything.
 *
 * @concept continue-target
 */

/** Continue by stamping the manifest that already names the desk. */
export interface ContinueStamp {
  readonly kind: 'continue';
  readonly manifest: 'stamp';
  /** The manifest's own path, as {@link DeskManifest}'s `named` case gives it. */
  readonly path: string;
  /**
   * Present when a live loop reports a free wait on this desk: the route
   * must stop that pid before it stamps the manifest, so the loop's own
   * cleanup cannot remove what the stamp is about to write to.
   */
  readonly stop?: StopFirst;
}

/** Continue by writing a manifest that names the desk — none names it yet. */
export interface ContinueWrite {
  readonly kind: 'continue';
  readonly manifest: 'write';
  /** See {@link ContinueStamp.stop} — the same licence, for the write path. */
  readonly stop?: StopFirst;
}

/** The named refusals `/api/continue` already reports, asked by this rule instead. */
export type ContinueTargetRefusal = 'no-manifest' | 'several' | 'loop-alive' | 'no-question';

/** A refusal, naming which. */
export interface ContinueRefused {
  readonly kind: 'refused';
  readonly reason: ContinueTargetRefusal;
}

/** Where a continuation's answer goes, or why it cannot. */
export type ContinueTarget = ContinueStamp | ContinueWrite | ContinueRefused;

/** What the caller read before asking where an answer for `branch` goes. */
export interface ContinueTargetReading {
  /** The branch the answer is for — what `POST /api/continue` was asked about. */
  readonly branch: string;
  /** Which manifest, if any, names the desk. */
  readonly manifest: DeskManifest;
  /** The desk's `.plot-worker.ending.json`, read as a value. */
  readonly ending: EndingReading;
  /** Whether an unanswered `PLOT-BLOCKED*` marker sits in the desk's tree. */
  readonly question: boolean;
  /** Whether a loop already holds the desk, and which pid. */
  readonly loop: DeskLoop;
  /**
   * Whether the desk's own free-wait record names the SAME pid `loop` named.
   *
   * The caller reads the record and asks {@link deskWaitsFree} for this —
   * the rule stays pure and does no I/O of its own, matching every other
   * field here. `false` for an absent, unreadable, or wrong-pid record: a
   * free wait this rule cannot confirm for THIS pid is not a free wait.
   */
  readonly loopWaitsFree: boolean;
}

/**
 * Where an answer for `branch` goes, and what blocks it.
 *
 * Checked in this order, matching `continueOnDesk`'s own and for the reason it
 * states: every refusal is asked before any write, so a refused continuation
 * never has a partial effect to undo.
 *
 * 1. **No marker, no refusal matters more.** `no-question` first: a `blocked`
 *    ending for the right branch with no marker in the tree is not a question
 *    waiting for an answer — the marker IS the question, and the ending alone
 *    is never sufficient. This also means a desk whose manifest is `named` but
 *    whose marker is gone is `no-question`, exactly as today.
 * 2. **A live loop refuses, UNLESS it reports a free wait.** A loop already on
 *    the desk is checked before the manifest answer is read for its own
 *    meaning, because it is the one fact that can block both stamping and
 *    writing alike. But a free wait holds no turn, so stopping it loses no
 *    work — the licence `loop-alive`'s own rationale ("a stop can land
 *    mid-turn") does not extend to it. A live loop whose `loopWaitsFree` is
 *    true yields `stop: { pid }` on whichever outcome the manifest and ending
 *    would otherwise have produced; every other live loop still yields
 *    `loop-alive`, unconditionally.
 * 3. **The manifest answers.** `named` continues by stamping it. `several`
 *    refuses — two manifests on one desk is an estate defect the ending record
 *    does not resolve. `unnamed` falls to the ending record.
 * 4. **The fallback.** Only for `unnamed`: an ending that read `blocked` for
 *    THIS branch continues by writing a manifest. Anything else — a different
 *    branch, a different reason, or no ending at all — is `no-manifest`, the
 *    same refusal `unnamed` always gave.
 *
 * ABSENT IS NOT A FALLBACK. An ending the caller could not read
 * (`read: 'unreadable'`) or never wrote (`read: 'absent'`) answers
 * `no-manifest`, never `write` — a record that cannot be trusted is not
 * evidence the desk is waiting for this branch's answer. The same reading
 * applies to `loopWaitsFree`: it is the caller's job to answer `false` for an
 * absent, unreadable or wrong-pid free-wait record, and this rule trusts that
 * answer without re-deriving it.
 *
 * @param reading - the branch asked about, and what the desk holds.
 * @returns where the answer goes, or why it cannot.
 */
export const continueTarget = (reading: ContinueTargetReading): ContinueTarget => {
  if (!reading.question) return { kind: 'refused', reason: 'no-question' };

  const stop: StopFirst | undefined =
    reading.loop.kind === 'alive' && reading.loopWaitsFree ? { pid: reading.loop.pid } : undefined;
  if (reading.loop.kind === 'alive' && !stop) return { kind: 'refused', reason: 'loop-alive' };

  if (reading.manifest.kind === 'named') {
    return { kind: 'continue', manifest: 'stamp', path: reading.manifest.path, ...(stop ? { stop } : {}) };
  }
  if (reading.manifest.kind === 'several') return { kind: 'refused', reason: 'several' };

  const { ending } = reading;
  if (ending.read === 'ended' && ending.ending.reason === 'blocked' && ending.ending.branch === reading.branch) {
    return { kind: 'continue', manifest: 'write', ...(stop ? { stop } : {}) };
  }
  return { kind: 'refused', reason: 'no-manifest' };
};
