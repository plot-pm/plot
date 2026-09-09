import fs from 'node:fs';
import path from 'node:path';

/**
 * The controller's half of `plot-controller-gate.sh` — the receipt an endpoint
 * leaves immediately before it starts a lifecycle script.
 *
 * ONLY THE CONTROLLER CAN LEAVE ONE, and that is the whole property the gate
 * rests on. `/api/dispatch` spawns `plot-dispatch.sh` and a hand-typed
 * `bash skills/plot/scripts/plot-dispatch.sh <slug>` spawns the same script;
 * the two are byte-identical at the command line and no grep separates them.
 * What separates them is that only the controller runs BEFORE the script does.
 *
 * WRITTEN HERE AND READ IN BASH, which is a duplication and a declared one.
 * `plot-state-receipt.sh` holds `record_action_receipt` for a shell caller —
 * the escape hatch, and any future script-side writer — and this writes the
 * same file for a Node one. The pair is two spellings of one four-line format,
 * so the format is stated once in each and pinned by
 * `test/reconcile/controller-gate.test.mjs`, which writes with THIS function
 * and clears with the shell's reader. A test that wrote the file by hand would
 * pin the gate against a fixture rather than against the writer, which is the
 * drift `plot-pr-merged.sh` was extracted to prevent.
 *
 * MACHINE-LOCAL, under `.plot/state/`, for `fleetSettingsPath`'s reason: a
 * receipt travelling in a commit would clear the gate on every checkout that
 * pulled it.
 */

/** The three actions a controller endpoint owns, and the script each one runs. */
export const ACTION_SCRIPTS = {
  dispatch: 'plot-dispatch.sh',
  approve: 'plot-approve.sh',
  deliver: 'plot-deliver.sh',
} as const;

/** An action a controller endpoint owns. */
export type ControllerAction = keyof typeof ACTION_SCRIPTS;

/**
 * Where one action's receipt lives — named by the script, because the script's
 * basename is what the gate reads off the command line.
 *
 * @param repoRoot - the repository this board serves.
 * @param script - the script's filename, as the gate will see it.
 * @returns the absolute path of the receipt file.
 */
export function actionReceiptPath(repoRoot: string, script: string): string {
  return path.join(repoRoot, '.plot', 'state', 'action-receipts', script);
}

/**
 * Record that this controller authorised one run of an action's script.
 *
 * Call it IMMEDIATELY BEFORE spawning, in the same function: the gate reads the
 * receipt when the script's own tool call is made, and a receipt written after
 * the spawn is a race the gate loses.
 *
 * IT IS SPENT ON THE ACTION COMPLETING, NOT ON THE GATE CLEARING, so nothing
 * here removes it — `spend_action_receipt` in `plot-state-receipt.sh` is the
 * other half, called by the script on its own exit 0. `plot-approve.sh` and
 * `plot-deliver.sh` document re-running as the repair for an interruption, and
 * a receipt spent at the gate would refuse that repair in the case it is most
 * needed.
 *
 * IT NEVER THROWS. A board that could not write a receipt must still dispatch:
 * the gate fails OPEN on its own machinery, so the cost of a failed write is a
 * refusal an operator clears with the named escape, not a lost action. Throwing
 * here would turn a missing directory into a 500 on the legitimate path — and a
 * gate that broke the legitimate path is worse than no gate.
 *
 * @param repoRoot - the repository this board serves.
 * @param action - which of the three is being run.
 * @param subject - the slug the controller named, recorded for a reader and
 *   never matched on: `/api/dispatch` names a plan and the script fans out to
 *   branches, so a gate comparing the two words would refuse the controller.
 */
export function recordActionReceipt(
  repoRoot: string,
  action: ControllerAction,
  subject: string,
): void {
  const script = ACTION_SCRIPTS[action];
  const file = actionReceiptPath(repoRoot, script);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${script}\t${subject}\t${new Date().toISOString()}\n`, 'utf8');
  } catch {
    /* the gate fails open on its own machinery; a lost receipt is not a lost action */
  }
}
