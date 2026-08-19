import type http from 'node:http';
import { dispatchAvailability } from './dispatch.js';

/**
 * THE LOOPBACK BOUNDARY, MADE A GATE.
 *
 * Every write endpoint on this server rests on one sentence: *whoever reaches
 * this address is sitting at the machine that owns the worktrees, and that IS
 * the permission*. `dispatch.ts` has stated it since the first write route
 * existed, and `/api/dispatch`, `/api/approve` and `/api/continue` each checked
 * it on the way in.
 *
 * It was never enforced. `HOST` was read once (`index.ts`), passed to the
 * handlers as a fact about the binding, and each handler chose to consult it.
 * Verified 2026-08-19: nothing stopped `HOST=0.0.0.0`, and the plan that
 * licensed this wave says *"loopback is the boundary and already in force"* —
 * which held only while nobody set it.
 *
 * ONE CHECK IN THE ROUTER, NOT FIVE IN THE HANDLERS. The per-handler shape is
 * the one this repo calls a rule: correct today, and correct tomorrow only if
 * every future write route remembers. Two of the five already differed in what
 * they consulted. Placing the check where routes are DISPATCHED means a sixth
 * write endpoint inherits it by construction — the same argument the blanket
 * 405 makes one branch further down, and for the same reason: a default that
 * refuses is a gate, a check every route must remember is not.
 *
 * IT DOES NOT REPLACE THE PER-CAPABILITY FLAGS. `dispatchAvailability` and its
 * two siblings still answer *will this button act* for the client, and still
 * ride on `/api/board`. This answers *will the server serve it at all*, which
 * is a different question asked at a different time, and the gate is the one
 * that has to be true.
 */

/**
 * The named opt-in. Deliberate and awkward on purpose.
 *
 * `PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand` rather than a bare `1`, and
 * not `--allow-remote` or `PLOT_UNSAFE=1`: the brief's constraint is that the
 * escape must not read like a convenience, because a flag that reads like one
 * gets set by someone who has not thought about it. This one cannot be typed
 * by reflex and cannot be misread as a performance switch.
 *
 * The value is checked, not merely the presence of the variable. An empty or
 * truthy-looking value (`1`, `true`, `yes`) does NOT open the gate — those are
 * what a person types when guessing, and guessing is the failure mode.
 */
export const ALLOW_REMOTE_ENV = 'PLOT_BOARD_ALLOW_REMOTE_WRITES';
export const ALLOW_REMOTE_VALUE = 'i-understand';

/** Whether the deliberate opt-in is present, read from the process env. */
export function remoteWritesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ALLOW_REMOTE_ENV] === ALLOW_REMOTE_VALUE;
}

export interface WriteGateVerdict {
  /** Whether a write endpoint may be served at all. */
  allowed: boolean;
  /** Empty when allowed; a sentence naming the cause AND the escape otherwise. */
  reason: string;
}

/**
 * May this server serve its write endpoints?
 *
 * Loopback is `localhost`, `127.0.0.1`, `::1` — the set `dispatchAvailability`
 * has always used, IMPORTED rather than restated so the two answers cannot
 * drift into disagreeing about what loopback means. Notably `0.0.0.0` is not in
 * it: it is the wildcard bind, reachable from every interface the machine has,
 * and it is exactly what the fleet user test uses to read the board over
 * Tailscale. A phone may read this board. It may not approve from it.
 *
 * THE REFUSAL NAMES THE ESCAPE. A bare 403 sends a developer who bound to
 * `0.0.0.0` for a reason to the source to find out why, and the message is the
 * only part of a gate they will read. So it says three things: what was
 * refused, that the binding is the cause, and the exact variable that opts in.
 */
export function writeGate(
  host: string,
  env: NodeJS.ProcessEnv = process.env,
): WriteGateVerdict {
  if (dispatchAvailability(host).available) return { allowed: true, reason: '' };
  if (remoteWritesAllowed(env)) return { allowed: true, reason: '' };
  return {
    allowed: false,
    reason:
      `this board is bound to ${host}, which is not loopback, so its write endpoints are refused: ` +
      'reaching a loopback address is what stands in for authentication here, and a non-loopback ' +
      'binding is reachable by things that are not sitting at this machine. ' +
      `To serve them anyway, restart the board with ${ALLOW_REMOTE_ENV}=${ALLOW_REMOTE_VALUE} — ` +
      'which grants anyone who can reach this address the ability to claim branches, approve ' +
      'plans and start agents on this machine.',
  };
}

/**
 * Refuse a write request when the gate is shut, and say so. Returns whether it
 * refused, so the caller stops.
 *
 * 403 rather than 404: hiding the endpoint would be a lie about what this
 * server is, and the developer this message exists for already knows the route
 * is there — they are asking why it will not act.
 */
export function refuseIfGated(
  res: http.ServerResponse,
  host: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const verdict = writeGate(host, env);
  if (verdict.allowed) return false;
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: verdict.reason }));
  return true;
}
