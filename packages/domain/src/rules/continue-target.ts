import type { DeskManifest } from './desk-manifest.js';
import type { DeskLoop } from './desk-loop-alive.js';
import type { EndingReading } from '../entities/ending.js';

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
 * @concept continue-target
 */

/** Continue by stamping the manifest that already names the desk. */
export interface ContinueStamp {
  readonly kind: 'continue';
  readonly manifest: 'stamp';
  /** The manifest's own path, as {@link DeskManifest}'s `named` case gives it. */
  readonly path: string;
}

/** Continue by writing a manifest that names the desk — none names it yet. */
export interface ContinueWrite {
  readonly kind: 'continue';
  readonly manifest: 'write';
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
 * 2. **A live loop refuses, whichever path would have continued.** Checked
 *    before the manifest answer is read for its own meaning, because a loop
 *    already on the desk is the one fact that blocks both stamping and
 *    writing alike.
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
 * evidence the desk is waiting for this branch's answer.
 *
 * @param reading - the branch asked about, and what the desk holds.
 * @returns where the answer goes, or why it cannot.
 */
export const continueTarget = (reading: ContinueTargetReading): ContinueTarget => {
  if (!reading.question) return { kind: 'refused', reason: 'no-question' };
  if (reading.loop.kind === 'alive') return { kind: 'refused', reason: 'loop-alive' };

  if (reading.manifest.kind === 'named') return { kind: 'continue', manifest: 'stamp', path: reading.manifest.path };
  if (reading.manifest.kind === 'several') return { kind: 'refused', reason: 'several' };

  const { ending } = reading;
  if (ending.read === 'ended' && ending.ending.reason === 'blocked' && ending.ending.branch === reading.branch) {
    return { kind: 'continue', manifest: 'write' };
  }
  return { kind: 'refused', reason: 'no-manifest' };
};
